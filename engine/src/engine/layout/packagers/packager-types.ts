import { Box } from '../../types';
import { LayoutProcessor } from '../layout-core';
import { FlowBox } from '../layout-core-types';
import type { ActorSignal, ActorSignalDraft } from '../actor-event-bus';
import type { AsyncThoughtHandle, AsyncThoughtRequest } from '../async-thought-host';
import type { SpatialExclusion } from '../layout-session-types';

export interface LayoutBox extends Box { }

export type SpatialFrontier = {
    pageIndex: number;
    cursorY?: number;
    worldY?: number;
    actorIndex?: number;
    actorId?: string;
    sourceId?: string;
};

export type ActorActivationState = 'dormant' | 'event-awakened' | 'active' | 'suspended';

export type ActorUpdateKind = 'none' | 'content-only' | 'geometry';

export type ObservationResult = {
    changed: boolean;
    geometryChanged: boolean;
    updateKind?: ActorUpdateKind;
    earliestAffectedFrontier?: SpatialFrontier;
};

export interface PackagerContext {
    processor: any; // We'll cast to LayoutProcessor
    pageIndex: number;
    cursorY: number;
    simulationTick?: number;
    actorIndex?: number;
    layoutBefore?: number;
    chunkOriginWorldY?: number;
    viewportHeight?: number;
    getPageExclusions?: (pageIndex: number) => ReadonlyArray<SpatialExclusion>;
    getWorldTraversalExclusions?: (pageIndex: number) => ReadonlyArray<SpatialExclusion>;
    margins: { top: number; right: number; bottom: number; left: number };
    pageWidth: number;
    pageHeight: number;
    /**
     * Optional override for the text line-wrapping width.
     * Set by zone sub-sessions (zone-map packager) so that flow-box packagers
     * wrap text at the zone column width rather than the page content width.
     * NOT set by the main layout loop or exclusion-lane logic, so that those
     * actors continue to wrap at their natural style-based content width.
     */
    contentWidthOverride?: number;
    publishActorSignal(signal: ActorSignalDraft): ActorSignal;
    readActorSignals(topic?: string): readonly ActorSignal[];
    requestAsyncThought?(request: AsyncThoughtRequest): AsyncThoughtHandle | undefined;
    readAsyncThoughtResult?(key: string): AsyncThoughtHandle | undefined;
}

export function resolvePackagerChunkOriginWorldY(
    context: Pick<PackagerContext, 'chunkOriginWorldY'>
): number | undefined {
    if (Number.isFinite(context.chunkOriginWorldY)) {
        return Number(context.chunkOriginWorldY);
    }
    return undefined;
}

export function resolvePackagerWorldYAtCursor(
    context: Pick<PackagerContext, 'chunkOriginWorldY' | 'cursorY'>
): number | undefined {
    const chunkOriginWorldY = resolvePackagerChunkOriginWorldY(context);
    if (!Number.isFinite(chunkOriginWorldY) || !Number.isFinite(context.cursorY)) {
        return undefined;
    }
    return Number(chunkOriginWorldY) + Number(context.cursorY);
}

export function bindPackagerSignalPublisher(
    publishActorSignal: (signal: ActorSignalDraft) => ActorSignal,
    pageIndex: number,
    cursorY: number,
    worldY?: number
): (signal: ActorSignalDraft) => ActorSignal {
    return (signal: ActorSignalDraft) =>
        publishActorSignal({
            ...signal,
            pageIndex: Number.isFinite(signal.pageIndex) ? Number(signal.pageIndex) : pageIndex,
            cursorY: Number.isFinite(signal.cursorY) ? Number(signal.cursorY) : cursorY,
            ...(Number.isFinite(signal.worldY)
                ? { worldY: Number(signal.worldY) }
                : Number.isFinite(worldY)
                    ? { worldY: Number(worldY) }
                    : {})
        });
}

export type PackagerReshapeResult = {
    currentFragment: PackagerUnit | null;
    continuationFragment: PackagerUnit | null;
};

export type PackagerPreparationPhase = 'commit' | 'lookahead';

export type PackagerReshapeKind = 'split' | 'clone' | 'morph' | 'reshape';

export type PackagerReshapeCapability = {
    kind: PackagerReshapeKind;
    preservesIdentity?: boolean;
    producesContinuation?: boolean;
    reflowsContent?: boolean;
    clonesStableSubstructure?: boolean;
};

export type PackagerReshapeProfile = {
    supportedReshapes?: PackagerReshapeKind[];
    capabilities?: PackagerReshapeCapability[];
};

export type PackagerPlacementPreference = {
    minimumWidth?: number | null;
    acceptsFrame?: boolean | null;
};

/** @deprecated Use PackagerReshapeResult */
export type PackagerSplitResult = PackagerReshapeResult;
/** @deprecated Use PackagerReshapeKind */
export type PackagerTransformKind = PackagerReshapeKind;
/** @deprecated Use PackagerReshapeCapability */
export type PackagerTransformCapability = PackagerReshapeCapability;
/** @deprecated Use PackagerReshapeProfile */
export type PackagerTransformProfile = PackagerReshapeProfile;

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
     * Declares the reshape kinds this actor can legitimately perform as part
     * of the runtime simulation.
     */
    getReshapeProfile?(): PackagerReshapeProfile | null | undefined;

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
    observeCommittedState?(context: PackagerContext): ObservationResult | null | undefined;

    /**
     * Declares which committed signal topics should wake this actor.
     * Omit or return an empty array to preserve broad checkpoint polling.
     */
    getCommittedSignalSubscriptions?(): readonly string[] | null | undefined;

    /**
     * Optional generic activation/update entrypoint for committed state changes.
     * If absent, the runtime falls back to observeCommittedSignals().
     */
    updateCommittedState?(context: PackagerContext): ObservationResult | null | undefined;

    /**
     * @deprecated Use observeCommittedState() or updateCommittedState().
     * Retained as a compatibility fallback for older reactive actors.
     */
    observeCommittedSignals?(context: PackagerContext): ObservationResult | null | undefined;

    /**
     * Optional kernel-owned stepped update entrypoint.
     * Called once per simulation tick for actors that opt into active stepping.
     */
    stepSimulationTick?(context: PackagerContext): ObservationResult | null | undefined;

    /**
     * Optional stepped-actor liveness check.
     * Returning true keeps the simulation progressing even if no committed-signal
     * observer fired in the previous settle cycle.
     */
    wantsSimulationTicks?(context: PackagerContext): boolean;

    /**
     * Reshapes this unit for a boundary crossing (split, morph, clone, etc.).
     */
    reshape(availableHeight: number, context: PackagerContext): PackagerReshapeResult;

    /**
     * Required height for the last materialized state (after emitBoxes).
     */
    getRequiredHeight(): number;

    getZIndex?(): number | null | undefined;
    occupiesFlowSpace?(): boolean;

    isUnbreakable(availableHeight: number): boolean;

    getLeadingSpacing(): number;
    getTrailingSpacing(): number;

    readonly pageBreakBefore?: boolean;
    readonly keepWithNext?: boolean;
}

export function resolvePackagerZIndex(unit: PackagerUnit): number {
    const raw = unit.getZIndex?.();
    return Number.isFinite(Number(raw)) ? Number(raw) : 0;
}

export function packagerOccupiesFlowSpace(unit: PackagerUnit): boolean {
    return unit.occupiesFlowSpace?.() ?? true;
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

export function resolvePackagerReshapeProfile(unit: PackagerUnit): PackagerReshapeProfile | null {
    const profile = unit.getReshapeProfile?.();
    if (!profile) {
        return null;
    }

    const normalizedCapabilities = new Map<PackagerReshapeKind, PackagerReshapeCapability>();

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

    if (Array.isArray(profile.supportedReshapes)) {
        for (const kind of profile.supportedReshapes) {
            if (!normalizedCapabilities.has(kind)) {
                normalizedCapabilities.set(kind, { kind });
            }
        }
    }

    if (normalizedCapabilities.size === 0) {
        return null;
    }

    return {
        supportedReshapes: Array.from(normalizedCapabilities.keys()),
        capabilities: Array.from(normalizedCapabilities.values())
    };
}

/** @deprecated Use resolvePackagerReshapeProfile */
export function resolvePackagerTransformProfile(unit: PackagerUnit): PackagerReshapeProfile | null {
    return resolvePackagerReshapeProfile(unit);
}

export function normalizeObservationResult(result: ObservationResult | null | undefined): ObservationResult | null {
    if (!result) {
        return null;
    }

    const updateKind: ActorUpdateKind = result.updateKind
        ?? (result.geometryChanged ? 'geometry' : (result.changed ? 'content-only' : 'none'));

    return {
        ...result,
        geometryChanged: updateKind === 'geometry',
        changed: result.changed,
        updateKind
    };
}
