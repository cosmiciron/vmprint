import { Box } from '../../types';
import { LayoutProcessor } from '../layout-core';
import { FlowBox } from '../layout-core-types';
import type { ActorSignal, ActorSignalDraft } from '../actor-event-bus';

export interface LayoutBox extends Box { }

export type SpatialFrontier = {
    pageIndex: number;
    actorIndex?: number;
    actorId?: string;
    sourceId?: string;
};

export type ObservationResult = {
    changed: boolean;
    geometryChanged: boolean;
    earliestAffectedFrontier?: SpatialFrontier;
};

export interface PackagerContext {
    processor: any; // We'll cast to LayoutProcessor
    pageIndex: number;
    cursorY: number;
    actorIndex?: number;
    margins: { top: number; right: number; bottom: number; left: number };
    pageWidth: number;
    pageHeight: number;
    publishActorSignal(signal: ActorSignalDraft): ActorSignal;
    readActorSignals(topic?: string): readonly ActorSignal[];
}

export type PackagerSplitResult = {
    currentFragment: PackagerUnit | null;
    continuationFragment: PackagerUnit | null;
};

export type PackagerPreparationPhase = 'commit' | 'lookahead';

export type PackagerTransformKind = 'split' | 'clone' | 'morph';

export type PackagerTransformCapability = {
    kind: PackagerTransformKind;
    preservesIdentity?: boolean;
    producesContinuation?: boolean;
    reflowsContent?: boolean;
    clonesStableSubstructure?: boolean;
};

export type PackagerTransformProfile = {
    supportedTransforms?: PackagerTransformKind[];
    capabilities?: PackagerTransformCapability[];
};

export type PackagerPlacementPreference = {
    minimumWidth?: number | null;
    acceptsFrame?: boolean | null;
};

export interface PackagerUnit {
    readonly actorId: string;
    readonly sourceId: string;
    readonly actorKind: string;
    readonly fragmentIndex: number;
    readonly continuationOf?: string;

    /**
     * Prepare internal measurement/materialization state for the given space
     * without emitting boxes. Must update getRequiredHeight().
     */
    prepare(availableWidth: number, availableHeight: number, context: PackagerContext): void;

    /**
     * Prepare speculative measurement state for planning phases such as keepWithNext.
     * Implementations may use a cheaper conservative probe than commit-time prepare().
     */
    prepareLookahead?(availableWidth: number, availableHeight: number, context: PackagerContext): void;

    /**
     * Consolidated actor-owned opinion about whether a narrowed placement frame
     * is worth attempting.
     */
    getPlacementPreference?(fullAvailableWidth: number, context: PackagerContext): PackagerPlacementPreference | null | undefined;

    /**
     * Declares the transform kinds this actor can legitimately perform as part
     * of the runtime simulation.
     */
    getTransformProfile?(): PackagerTransformProfile | null | undefined;

    /**
     * The minimum width at which this actor considers a placement frame worth
     * attempting. Returning null/undefined means "no opinion".
     */
    getMinimumPlacementWidth?(fullAvailableWidth: number, context: PackagerContext): number | null | undefined;

    /**
     * Allows width-sensitive actors to reject a narrowed spatial placement frame
     * before emitBoxes() is attempted. Returning false tells the paginator to
     * defer below the constrained band instead of forcing the actor through it.
     */
    acceptsPlacementFrame?(frameAvailableWidth: number, fullAvailableWidth: number, context: PackagerContext): boolean;

    /** 
     * Emit boxes for the given available space.
     * Returns null if it absolutely cannot even start to fit.
     * Must be deterministic for the same availableWidth/context; avoid height-dependent layout.
     */
    emitBoxes(availableWidth: number, availableHeight: number, context: PackagerContext): LayoutBox[] | null;

    /**
     * Allows stateful observers to reevaluate committed bulletin-board state at
     * controlled session checkpoints.
     */
    observeCommittedSignals?(context: PackagerContext): ObservationResult | null | undefined;

    /**
     * Splits this unit.
     */
    split(availableHeight: number, context: PackagerContext): PackagerSplitResult;

    /**
     * Required height for the last materialized state (after emitBoxes).
     */
    getRequiredHeight(): number;

    isUnbreakable(availableHeight: number): boolean;

    getMarginTop(): number;
    getMarginBottom(): number;

    readonly pageBreakBefore?: boolean;
    readonly keepWithNext?: boolean;
}

export function preparePackagerForPhase(
    unit: PackagerUnit,
    phase: PackagerPreparationPhase,
    availableWidth: number,
    availableHeight: number,
    context: PackagerContext
): void {
    if (phase === 'lookahead' && unit.prepareLookahead) {
        unit.prepareLookahead(availableWidth, availableHeight, context);
        return;
    }

    unit.prepare(availableWidth, availableHeight, context);
}

export function resolvePackagerPlacementPreference(
    unit: PackagerUnit,
    fullAvailableWidth: number,
    context: PackagerContext
): PackagerPlacementPreference | null {
    const consolidated = unit.getPlacementPreference?.(fullAvailableWidth, context);
    if (consolidated) {
        return consolidated;
    }

    const minimumWidth = unit.getMinimumPlacementWidth?.(fullAvailableWidth, context) ?? null;
    if (minimumWidth === null || minimumWidth === undefined) {
        return null;
    }

    return { minimumWidth };
}

export function rejectsPlacementFrame(
    unit: PackagerUnit,
    frameAvailableWidth: number,
    fullAvailableWidth: number,
    context: PackagerContext
): boolean {
    const preference = resolvePackagerPlacementPreference(unit, fullAvailableWidth, context);
    if (
        preference &&
        preference.minimumWidth !== null &&
        preference.minimumWidth !== undefined &&
        frameAvailableWidth + 0 < preference.minimumWidth
    ) {
        return true;
    }

    if (preference && preference.acceptsFrame !== null && preference.acceptsFrame !== undefined) {
        return preference.acceptsFrame === false;
    }

    if (unit.acceptsPlacementFrame) {
        return !unit.acceptsPlacementFrame(frameAvailableWidth, fullAvailableWidth, context);
    }

    return false;
}

export function resolvePackagerTransformProfile(unit: PackagerUnit): PackagerTransformProfile | null {
    const profile = unit.getTransformProfile?.();
    if (!profile) {
        return null;
    }

    const normalizedCapabilities = new Map<PackagerTransformKind, PackagerTransformCapability>();

    if (Array.isArray(profile.capabilities)) {
        for (const capability of profile.capabilities) {
            if (!capability || !capability.kind) continue;
            normalizedCapabilities.set(capability.kind, {
                kind: capability.kind,
                preservesIdentity: capability.preservesIdentity,
                producesContinuation: capability.producesContinuation,
                reflowsContent: capability.reflowsContent,
                clonesStableSubstructure: capability.clonesStableSubstructure
            });
        }
    }

    if (Array.isArray(profile.supportedTransforms)) {
        for (const kind of profile.supportedTransforms) {
            if (!normalizedCapabilities.has(kind)) {
                normalizedCapabilities.set(kind, { kind });
            }
        }
    }

    if (normalizedCapabilities.size === 0) {
        return null;
    }

    return {
        supportedTransforms: Array.from(normalizedCapabilities.keys()),
        capabilities: Array.from(normalizedCapabilities.values())
    };
}
