import type { Box, Element } from '../../types';
import type { LayoutProcessor } from '../layout-core';
import {
    type ObservationResult,
    packagerOccupiesFlowSpace,
    type PackagerContext,
    type PackagerPlacementPreference,
    type PackagerReshapeResult,
    type PackagerReshapeProfile,
    type PackagerUnit,
    resolvePackagerWorldYAtCursor
} from './packager-types';
import { type PackagerIdentity } from './packager-identity';
import { FlowBoxPackager } from './flow-box-packager';
import { SpatialFieldGeometryCapability, SpatialFieldMovementCapability } from './spatial-field-capability';

export function hasSpatialCapabilityProperties(element: Element | undefined): boolean {
    return !!(
        element?.properties?.space
        || element?.properties?.spatialField
        || element?.properties?.motion
    );
}

export class SpatialCapabilityPackager implements PackagerUnit {
    private readonly inner: FlowBoxPackager;
    private readonly geometry: SpatialFieldGeometryCapability;
    private readonly movement: SpatialFieldMovementCapability;

    readonly actorId: string;
    readonly sourceId: string;
    readonly actorKind: string;
    readonly fragmentIndex: number;
    readonly continuationOf?: string;

    get pageBreakBefore(): boolean | undefined {
        return this.inner.pageBreakBefore;
    }

    get keepWithNext(): boolean | undefined {
        return this.inner.keepWithNext;
    }

    constructor(
        private readonly element: Element,
        processor: LayoutProcessor,
        flowPackager: FlowBoxPackager,
        identity?: PackagerIdentity
    ) {
        this.inner = flowPackager;
        this.geometry = new SpatialFieldGeometryCapability(element);
        this.movement = new SpatialFieldMovementCapability(
            element.properties?.motion
        );
        this.actorId = identity?.actorId ?? flowPackager.actorId;
        this.sourceId = identity?.sourceId ?? flowPackager.sourceId;
        this.actorKind = identity?.actorKind ?? flowPackager.actorKind;
        this.fragmentIndex = identity?.fragmentIndex ?? flowPackager.fragmentIndex;
        this.continuationOf = identity?.continuationOf ?? flowPackager.continuationOf;
    }

    prepare(availableWidth: number, availableHeight: number, context: PackagerContext): void {
        this.inner.prepare(availableWidth, availableHeight, context);
        this.movement.prepare(context);
    }

    getPlacementPreference(fullAvailableWidth: number, context: PackagerContext): PackagerPlacementPreference | null {
        const base = this.inner.getPlacementPreference(fullAvailableWidth, context);
        if (!base) return null;
        const x = Math.max(0, this.movement.state.x);
        const minimumWidth = Number.isFinite(Number(base.minimumWidth)) ? Number(base.minimumWidth) : 0;
        return {
            ...base,
            minimumWidth: Math.max(minimumWidth, x + minimumWidth)
        };
    }

    getReshapeProfile(): PackagerReshapeProfile {
        return this.inner.getReshapeProfile();
    }

    emitBoxes(availableWidth: number, availableHeight: number, context: PackagerContext): Box[] {
        this.prepare(availableWidth, availableHeight, context);
        const movementState = this.movement.state;
        const clipProperties = this.geometry.buildClipProperties();
        return (this.inner.emitBoxes(availableWidth, availableHeight, context) || []).map((box) => ({
            ...box,
            x: Number(box.x || 0) + movementState.x,
            y: Number(box.y || 0) + movementState.y,
            properties: {
                ...(box.properties || {}),
                ...clipProperties,
                ...(this.movement.enabled
                    ? {
                        _motionState: {
                            tick: movementState.tick,
                            x: movementState.x,
                            y: movementState.y,
                            label: movementState.label
                        }
                    }
                    : {})
            }
        }));
    }

    wantsSimulationTicks(context: PackagerContext): boolean {
        return this.movement.wantsSimulationTicks(context);
    }

    stepSimulationTick(context: PackagerContext): ObservationResult | null {
        return this.movement.stepSimulationTick(
            context,
            {
                actorId: this.actorId,
                sourceId: this.sourceId,
                actorKind: this.actorKind,
                fragmentIndex: this.fragmentIndex
            },
            () => context.processor?.getCurrentLayoutSession?.()
                ?.resolveActorRuntimeFrontier?.(this, { actorId: this.actorId, sourceId: this.sourceId })
                ?? {
                    pageIndex: context.pageIndex,
                    cursorY: context.cursorY,
                    worldY: resolvePackagerWorldYAtCursor(context),
                    actorId: this.actorId,
                    sourceId: this.sourceId
                }
        );
    }

    getRequiredHeight(): number {
        return Math.max(0, this.movement.state.y) + this.inner.getRequiredHeight();
    }

    getZIndex(): number {
        return this.inner.getZIndex();
    }

    occupiesFlowSpace(): boolean {
        return packagerOccupiesFlowSpace(this.inner);
    }

    isUnbreakable(availableHeight: number): boolean {
        return this.inner.isUnbreakable(availableHeight);
    }

    getLeadingSpacing(): number {
        return this.inner.getLeadingSpacing();
    }

    getTrailingSpacing(): number {
        return this.inner.getTrailingSpacing();
    }

    reshape(_availableHeight: number, _context: PackagerContext): PackagerReshapeResult {
        return { currentFragment: null, continuationFragment: this };
    }
}
