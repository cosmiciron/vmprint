import { Box, Element, ElementStyle } from '../../types';
import { LayoutProcessor } from '../layout-core';
import { LayoutUtils } from '../layout-utils';
import {
    ObservationResult,
    PackagerContext,
    PackagerPlacementPreference,
    PackagerReshapeResult,
    PackagerReshapeProfile,
    PackagerUnit,
    resolvePackagerWorldYAtCursor
} from './packager-types';
import { createElementPackagerIdentity, PackagerIdentity } from './packager-identity';
import { SpatialFieldGeometryCapability, SpatialFieldMovementCapability } from './spatial-field-capability';

type LayoutProcessorWithConfig = LayoutProcessor & {
    config?: {
        styles?: Record<string, ElementStyle | undefined>;
    };
};

function resolveFieldActorStyle(processor: LayoutProcessor, element: Element): ElementStyle {
    const typeStyle = ((processor as LayoutProcessorWithConfig).config?.styles?.[element.type] || {}) as ElementStyle;
    const propertyStyle = (element.properties?.style || {}) as ElementStyle;
    return {
        ...typeStyle,
        ...propertyStyle
    };
}

export function isFieldActorElement(element: Element | undefined): boolean {
    return String(element?.type || '').trim().toLowerCase() === 'field-actor';
}

export class FieldActorPackager implements PackagerUnit {
    private readonly style: ElementStyle;
    private readonly width: number;
    private readonly height: number;
    private readonly marginTop: number;
    private readonly marginBottom: number;
    private readonly properties: Record<string, unknown>;
    private readonly movement: SpatialFieldMovementCapability;
    private readonly hasSpatialField: boolean;

    readonly actorId: string;
    readonly sourceId: string;
    readonly actorKind: string;
    readonly fragmentIndex: number;
    readonly continuationOf?: string;

    constructor(
        private readonly element: Element,
        processor: LayoutProcessor,
        identity?: PackagerIdentity
    ) {
        const resolvedIdentity = identity ?? createElementPackagerIdentity(element, [0]);
        this.style = resolveFieldActorStyle(processor, element);
        this.width = Math.max(0, LayoutUtils.validateUnit(this.style.width ?? 0));
        this.height = Math.max(0, LayoutUtils.validateUnit(this.style.height ?? 0));
        this.marginTop = Math.max(0, LayoutUtils.validateUnit(this.style.marginTop ?? 0));
        this.marginBottom = LayoutUtils.validateUnit(this.style.marginBottom ?? 0);
        const geometry = new SpatialFieldGeometryCapability(element);
        this.properties = {
            ...(element.properties || {}),
            ...geometry.buildClipProperties()
        };
        this.hasSpatialField = !!(element.properties?.space || element.properties?.spatialField);
        this.movement = new SpatialFieldMovementCapability(
            element.properties?.motion
        );
        this.actorId = resolvedIdentity.actorId;
        this.sourceId = resolvedIdentity.sourceId;
        this.actorKind = 'field-actor';
        this.fragmentIndex = resolvedIdentity.fragmentIndex;
        this.continuationOf = resolvedIdentity.continuationOf;
    }

    get pageBreakBefore(): boolean | undefined {
        return Boolean(this.style.pageBreakBefore);
    }

    get keepWithNext(): boolean | undefined {
        return Boolean(this.element.properties?.keepWithNext ?? this.style.keepWithNext);
    }

    prepare(_availableWidth: number, _availableHeight: number, context: PackagerContext): void {
        this.movement.prepare(context);
        // No deferred materialization required for a simple field body actor.
    }

    getPlacementPreference(_fullAvailableWidth: number, _context: PackagerContext): PackagerPlacementPreference | null {
        return { minimumWidth: Math.max(this.width, this.movement.state.x + this.width) };
    }

    getReshapeProfile(): PackagerReshapeProfile {
        return {
            capabilities: []
        };
    }

    emitBoxes(_availableWidth: number, _availableHeight: number, context: PackagerContext): Box[] {
        const movementState = this.movement.state;
        return [{
            type: 'field-actor',
            x: Math.max(0, Number(context.margins?.left || 0)) + movementState.x,
            y: movementState.y,
            w: this.width,
            h: this.height,
            style: this.style,
            properties: {
                ...this.properties,
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
            },
            lines: [],
            meta: {
                actorId: this.actorId,
                sourceId: this.sourceId,
                engineKey: this.actorId,
                sourceType: this.element.type,
                fragmentIndex: this.fragmentIndex,
                isContinuation: false
            }
        }];
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
        return this.marginTop + Math.max(0, this.movement.state.y) + this.height + this.marginBottom;
    }

    getZIndex(): number {
        return Number.isFinite(Number(this.style.zIndex)) ? Number(this.style.zIndex) : 0;
    }

    isUnbreakable(_availableHeight: number): boolean {
        return true;
    }

    getLeadingSpacing(): number {
        return this.marginTop;
    }

    getTrailingSpacing(): number {
        return this.marginBottom;
    }

    occupiesFlowSpace(): boolean {
        // Spatial-field actors already behave as out-of-flow obstacle publishers
        // inside hosted-region settlement. Mirror that at the root/world level so
        // the same authored field does not silently change semantics based on host.
        return !this.hasSpatialField;
    }

    reshape(_availableHeight: number, _context: PackagerContext): PackagerReshapeResult {
        return { currentFragment: null, continuationFragment: this };
    }
}
