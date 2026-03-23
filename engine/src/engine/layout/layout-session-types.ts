import type { Box, DebugZoneRegion, Page, PageRegionContent, PageReservationSelector } from '../types';
import type { ContinuationArtifacts, FlowBox } from './layout-core-types';
import type { KeepWithNextFormationPlan, WholeFormationOverflowHandling } from './actor-formation';
import { getTailSplitPostAttemptOutcome } from './actor-formation';
import type { LocalActorSignalSnapshot, SafeCheckpoint } from './actor-communication-runtime';
import { LAYOUT_DEFAULTS } from './defaults';
import type { LayoutSession } from './layout-session';
import type { ObservationResult, PackagerContext, PackagerSplitResult, SpatialFrontier } from './packagers/packager-types';
import type { PackagerUnit } from './packagers/packager-types';

export type LayoutProfileMetrics = {
    handlerCalls: number;
    handlerMs: number;
    loadCalls: number;
    loadMs: number;
    createCalls: number;
    createMs: number;
    readyCalls: number;
    readyMs: number;
    refreshCalls: number;
    refreshMs: number;
    documentChangedCalls: number;
    documentChangedMs: number;
    replayRequests: number;
    replayPasses: number;
    docQueryCalls: number;
    setContentCalls: number;
    replaceCalls: number;
    insertCalls: number;
    removeCalls: number;
    messageSendCalls: number;
    messageHandlerCalls: number;
    speculativeBranchCalls: number;
    speculativeBranchMs: number;
    speculativeBranchAcceptedCalls: number;
    speculativeBranchRollbackCalls: number;
    speculativeBranchByReason: Record<string, {
        calls: number;
        ms: number;
        acceptedCalls: number;
        rollbackCalls: number;
    }>;
    paginationPlacementPrepCalls: number;
    paginationPlacementPrepMs: number;
    actorMeasurementCalls: number;
    actorMeasurementMs: number;
    keepWithNextResolutionCalls: number;
    keepWithNextResolutionMs: number;
    wholeFormationOverflowCalls: number;
    wholeFormationOverflowMs: number;
    keepWithNextActionCalls: number;
    keepWithNextActionMs: number;
    actorPlacementCalls: number;
    actorPlacementMs: number;
    actorOverflowCalls: number;
    actorOverflowMs: number;
    genericSplitCalls: number;
    genericSplitMs: number;
    boundaryCheckpointCalls: number;
    boundaryCheckpointMs: number;
    checkpointRecordCalls: number;
    checkpointRecordMs: number;
    observerBoundaryCheckCalls: number;
    observerBoundaryCheckMs: number;
    actorMeasurementByKind: Record<string, { calls: number; ms: number }>;
    actorPreparedDispatchCalls: number;
    actorPreparedDispatchMs: number;
    flowMaterializeCalls: number;
    flowMaterializeMs: number;
    flowResolveLinesCalls: number;
    flowResolveLinesMs: number;
    flowBuildTokensCalls: number;
    flowBuildTokensMs: number;
    flowWrapStreamCalls: number;
    flowWrapStreamMs: number;
    flowBidiSplitCalls: number;
    flowBidiSplitMs: number;
    flowScriptSplitCalls: number;
    flowScriptSplitMs: number;
    flowWordSegmentCalls: number;
    flowWordSegmentMs: number;
    wrapOverflowTokenCalls: number;
    wrapOverflowTokenMs: number;
    wrapHyphenationAttemptCalls: number;
    wrapHyphenationAttemptMs: number;
    wrapHyphenationSuccessCalls: number;
    wrapGraphemeFallbackCalls: number;
    wrapGraphemeFallbackMs: number;
    wrapGraphemeFallbackSegments: number;
    textMeasurementCacheHits: number;
    textMeasurementCacheMisses: number;
    flowResolveSignatureCalls: number;
    flowResolveSignatureUniqueCalls: number;
    flowResolveSignatureRepeatedCalls: number;
    flowResolveSignatureContinuationCalls: number;
    flowResolveSignatureRepeatedContinuationCalls: number;
    simpleProseEligibleCalls: number;
    simpleProseIneligibleInlineObjectCalls: number;
    simpleProseIneligibleMixedStyleCalls: number;
    simpleProseIneligibleComplexScriptCalls: number;
    simpleProseIneligibleRichStructureCalls: number;
    keepWithNextPlanCalls: number;
    keepWithNextPlanMs: number;
    keepWithNextBranchCalls: number;
    keepWithNextBranchMs: number;
    keepWithNextPreparedActors: number;
    keepWithNextEarlyExitCalls: number;
    keepWithNextPrepareByKind: Record<string, { calls: number; ms: number }>;
    reservationCommitProbeCalls: number;
    reservationCommitProbeMs: number;
    reservationConstraintNegotiationCalls: number;
    reservationConstraintNegotiationMs: number;
    reservationConstraintApplications: number;
    reservationWrites: number;
    reservationArtifactMs: number;
    exclusionBlockedCursorCalls: number;
    exclusionBlockedCursorMs: number;
    exclusionBandResolutionCalls: number;
    exclusionBandResolutionMs: number;
    exclusionLaneApplications: number;
    observerCheckpointSweepCalls: number;
    observerSettleCalls: number;
    observerActorBoundarySettles: number;
    observerPageBoundarySettles: number;
    actorActivationAwakenCalls: number;
    actorActivationSignalWakeCalls: number;
    actorActivationLifecycleWakeCalls: number;
    actorActivationScheduledWakeCalls: number;
    actorActivationDormantSkips: number;
    actorUpdateCalls: number;
    actorUpdateMs: number;
    actorUpdateContentOnlyCalls: number;
    actorUpdateGeometryCalls: number;
    actorUpdateNoopCalls: number;
    actorUpdateRedrawCalls: number;
    actorUpdateResettlementCycles: number;
    actorUpdateRepeatedStateDetections: number;
    actorUpdateResettlementCapHits: number;
    simulationTickCount: number;
    progressionStopCalls: number;
    progressionResumeCalls: number;
    progressionSnapshotCalls: number;
};

export type SimulationTick = number;

export type SimulationClockSnapshot = {
    tick: SimulationTick;
};

export type RegionReservation = {
    id: string;
    height: number;
    source?: string;
};

export type PageReservationIntent = RegionReservation & {
    selector?: 'current' | PageReservationSelector;
};

export type SpatialExclusion = {
    id: string;
    x: number;
    y: number;
    w: number;
    h: number;
    source?: string;
};

export type PageExclusionIntent = SpatialExclusion & {
    selector?: 'current' | PageReservationSelector;
};

export type ContentBand = {
    xOffset: number;
    width: number;
};

type HorizontalInterval = {
    start: number;
    end: number;
};

export type ActiveExclusionBand = {
    exclusions: SpatialExclusion[];
    top: number;
    bottom: number;
};

export type SpatialPlacementSurface = {
    cursorY: number;
    activeBand: ActiveExclusionBand | null;
    contentBand: ContentBand | null;
};

export type PlacementFrameMargins = {
    left: number;
    right: number;
};

export type PaginationState = {
    currentPageIndex: number;
    currentPageBoxes: Box[];
    currentY: number;
    lastSpacingAfter: number;
};

export type PaginationLoopAction =
    | {
        action: 'continue-loop';
        paginationState: PaginationState;
        nextActorIndex: number;
    }
    | {
        action: 'continue-tail-split';
        tailSplitExecution: {
            prefix: PackagerUnit[];
            splitCandidate: PackagerUnit;
            replaceCount: number;
            splitMarkerReserve: number;
        };
    }
    | {
        action: 'continue-to-split';
        splitExecution: SplitExecution;
    }
    | {
        action: 'fallthrough-local-overflow';
    };

export type ResolvedPlacementFrame = SpatialPlacementSurface & {
    availableWidth: number;
    margins: PlacementFrameMargins;
};

export type SpatialPlacementDecision =
    | { action: 'commit' }
    | { action: 'defer'; nextCursorY: number };

export type SplitMarkerPlacementState = {
    currentY: number;
    lastSpacingAfter: number;
    pageLimit: number;
    pageIndex: number;
    availableWidth: number;
};

export type FragmentCommitState = {
    currentY: number;
    layoutDelta: number;
    effectiveHeight: number;
    marginBottom: number;
    pageIndex: number;
};

export type SequencePlacementState = {
    currentY: number;
    lastSpacingAfter: number;
    pageIndex: number;
    pageLimit: number;
    availableWidth: number;
};

export type SplitFragmentAftermathState = FragmentCommitState & {
    actorId: string;
    lastSpacingAfter: number;
    pageLimit: number;
    availableWidth: number;
};

export type SplitFragmentAftermathInput = {
    currentY: number;
    layoutDelta: number;
    lastSpacingAfter: number;
    pageLimit: number;
    availableWidth: number;
    pageIndex: number;
};

export type PageRegionResolution = {
    header: PageRegionContent | null;
    footer: PageRegionContent | null;
};

export type PageOverrideState = 'inherit' | 'replace' | 'suppress';

export type WorldSpace = {
    originX: number;
    originY: number;
    width: number;
    exploredBottom: number;
};

export type ViewportRect = {
    x: number;
    y: number;
    w: number;
    h: number;
};

export type ViewportTerrain = {
    margins: PlacementFrameMargins & {
        top: number;
        bottom: number;
    };
    marginBlocks: SpatialExclusion[];
    headerBlock: SpatialExclusion | null;
    footerBlock: SpatialExclusion | null;
    reservationBlocks: SpatialExclusion[];
    exclusionBlocks: SpatialExclusion[];
    blockedRects: SpatialExclusion[];
};

export type ViewportDescriptor = {
    pageIndex: number;
    worldX: number;
    worldY: number;
    width: number;
    height: number;
    contentRect: ViewportRect;
    terrain: ViewportTerrain;
};

export type PageFinalizationState = {
    pageIndex: number;
    physicalPageNumber: number;
    logicalPageNumber: number | null;
    usesLogicalNumbering: boolean;
    resolvedRegions: PageRegionResolution;
    overrideSourceId: string | null;
    headerOverride: PageOverrideState;
    footerOverride: PageOverrideState;
    renderedHeader: boolean;
    renderedFooter: boolean;
    worldSpace: WorldSpace;
    viewport: ViewportDescriptor;
};

export class ConstraintField {
    readonly reservations: RegionReservation[] = [];
    readonly exclusions: SpatialExclusion[] = [];

    constructor(
        public availableWidth: number,
        public availableHeight: number
    ) { }

    get effectiveAvailableHeight(): number {
        const reserved = this.reservations.reduce((sum, reservation) => {
            const height = Number.isFinite(reservation.height) ? Math.max(0, Number(reservation.height)) : 0;
            return sum + height;
        }, 0);
        return Math.max(0, this.availableHeight - reserved);
    }

    resolveBlockedCursorY(cursorY: number): number {
        let resolvedY = Number.isFinite(cursorY) ? Number(cursorY) : 0;
        let advanced = true;

        while (advanced) {
            advanced = false;
            for (const exclusion of this.exclusions) {
                const top = Number.isFinite(exclusion.y) ? Math.max(0, Number(exclusion.y)) : 0;
                const bottom = top + (Number.isFinite(exclusion.h) ? Math.max(0, Number(exclusion.h)) : 0);
                const spansWidth =
                    Number(exclusion.x) <= LAYOUT_DEFAULTS.wrapTolerance &&
                    (Number(exclusion.x) + Number(exclusion.w)) >= (this.availableWidth - LAYOUT_DEFAULTS.wrapTolerance);
                if (!spansWidth) continue;
                if (resolvedY + LAYOUT_DEFAULTS.wrapTolerance < top) continue;
                if (resolvedY >= bottom - LAYOUT_DEFAULTS.wrapTolerance) continue;
                resolvedY = bottom;
                advanced = true;
            }
        }

        return resolvedY;
    }

    resolveActiveContentBand(cursorY: number): ContentBand | null {
        const activeBand = this.resolveActiveExclusionBand(cursorY);
        if (!activeBand) return null;
        const mergedIntervals = this.resolveMergedHorizontalExclusionIntervals(activeBand.exclusions);
        const contentIntervals = this.resolveAvailableHorizontalIntervals(mergedIntervals);
        if (!contentIntervals.length) return null;

        const widestInterval = contentIntervals.reduce((best, candidate) => {
            const bestWidth = best.end - best.start;
            const candidateWidth = candidate.end - candidate.start;
            if (candidateWidth > bestWidth + LAYOUT_DEFAULTS.wrapTolerance) return candidate;
            if (Math.abs(candidateWidth - bestWidth) <= LAYOUT_DEFAULTS.wrapTolerance && candidate.start < best.start) {
                return candidate;
            }
            return best;
        });

        const width = Math.max(0, widestInterval.end - widestInterval.start);
        if (width >= this.availableWidth - LAYOUT_DEFAULTS.wrapTolerance) return null;
        return {
            xOffset: widestInterval.start,
            width
        };
    }

    resolveActiveExclusionBand(cursorY: number): ActiveExclusionBand | null {
        const resolvedY = Number.isFinite(cursorY) ? Number(cursorY) : 0;
        const activeExclusions: SpatialExclusion[] = [];
        let top = Number.POSITIVE_INFINITY;
        let bottom = 0;

        for (const exclusion of this.exclusions) {
            const exclusionTop = Number.isFinite(exclusion.y) ? Math.max(0, Number(exclusion.y)) : 0;
            const exclusionBottom = exclusionTop + (Number.isFinite(exclusion.h) ? Math.max(0, Number(exclusion.h)) : 0);
            if (resolvedY + LAYOUT_DEFAULTS.wrapTolerance < exclusionTop) continue;
            if (resolvedY >= exclusionBottom - LAYOUT_DEFAULTS.wrapTolerance) continue;

            activeExclusions.push(exclusion);
            top = Math.min(top, exclusionTop);
            bottom = Math.max(bottom, exclusionBottom);
        }

        if (!activeExclusions.length) return null;
        return { exclusions: activeExclusions, top, bottom };
    }

    resolvePlacementSurface(cursorY: number): SpatialPlacementSurface {
        const resolvedCursorY = this.resolveBlockedCursorY(cursorY);
        const activeBand = this.resolveActiveExclusionBand(resolvedCursorY);
        return {
            cursorY: resolvedCursorY,
            activeBand,
            contentBand: activeBand ? this.resolveActiveContentBand(resolvedCursorY) : null
        };
    }

    resolvePlacementFrame(cursorY: number, margins: PlacementFrameMargins): ResolvedPlacementFrame {
        const surface = this.resolvePlacementSurface(cursorY);
        const laneLeftOffset = surface.contentBand?.xOffset ?? 0;
        const laneRightOffset = Math.max(
            0,
            (this.availableWidth - laneLeftOffset) - (surface.contentBand?.width ?? this.availableWidth)
        );

        return {
            ...surface,
            availableWidth: surface.contentBand?.width ?? this.availableWidth,
            margins: surface.contentBand
                ? {
                    left: margins.left + laneLeftOffset,
                    right: margins.right + laneRightOffset
                }
                : margins
        };
    }

    evaluatePlacement(boxes: readonly Box[], cursorY: number): SpatialPlacementDecision {
        const activeBand = this.resolveActiveExclusionBand(cursorY);
        if (!activeBand) {
            return { action: 'commit' };
        }

        for (const box of boxes) {
            const boxLeft = Number.isFinite(box.x) ? Number(box.x) : 0;
            const boxTop = Number.isFinite(box.y) ? Math.max(0, Number(box.y)) : 0;
            const boxRight = boxLeft + (Number.isFinite(box.w) ? Math.max(0, Number(box.w)) : 0);
            const boxBottom = boxTop + (Number.isFinite(box.h) ? Math.max(0, Number(box.h)) : 0);

            for (const exclusion of activeBand.exclusions) {
                const exclusionLeft = Number.isFinite(exclusion.x) ? Number(exclusion.x) : 0;
                const exclusionTop = Number.isFinite(exclusion.y) ? Math.max(0, Number(exclusion.y)) : 0;
                const exclusionRight = exclusionLeft + (Number.isFinite(exclusion.w) ? Math.max(0, Number(exclusion.w)) : 0);
                const exclusionBottom = exclusionTop + (Number.isFinite(exclusion.h) ? Math.max(0, Number(exclusion.h)) : 0);

                const overlapsHorizontally =
                    boxLeft < exclusionRight - LAYOUT_DEFAULTS.wrapTolerance &&
                    boxRight > exclusionLeft + LAYOUT_DEFAULTS.wrapTolerance;
                const overlapsVertically =
                    boxTop < exclusionBottom - LAYOUT_DEFAULTS.wrapTolerance &&
                    boxBottom > exclusionTop + LAYOUT_DEFAULTS.wrapTolerance;
                if (overlapsHorizontally && overlapsVertically) {
                    return {
                        action: 'defer',
                        nextCursorY: activeBand.bottom
                    };
                }
            }
        }

        return { action: 'commit' };
    }

    private resolveMergedHorizontalExclusionIntervals(exclusions: readonly SpatialExclusion[]): HorizontalInterval[] {
        const intervals = exclusions
            .map((exclusion): HorizontalInterval | null => {
                const start = Number.isFinite(exclusion.x) ? Math.max(0, Math.min(this.availableWidth, Number(exclusion.x))) : 0;
                const width = Number.isFinite(exclusion.w) ? Math.max(0, Number(exclusion.w)) : 0;
                const end = Math.max(start, Math.min(this.availableWidth, start + width));
                if (end - start <= LAYOUT_DEFAULTS.wrapTolerance) return null;
                return { start, end };
            })
            .filter((interval): interval is HorizontalInterval => interval !== null)
            .sort((a, b) => a.start - b.start);

        if (!intervals.length) return [];

        const merged: HorizontalInterval[] = [intervals[0]];
        for (let index = 1; index < intervals.length; index += 1) {
            const current = intervals[index];
            const previous = merged[merged.length - 1];
            if (current.start <= previous.end + LAYOUT_DEFAULTS.wrapTolerance) {
                previous.end = Math.max(previous.end, current.end);
                continue;
            }
            merged.push({ ...current });
        }
        return merged;
    }

    private resolveAvailableHorizontalIntervals(occupied: readonly HorizontalInterval[]): HorizontalInterval[] {
        const intervals: HorizontalInterval[] = [];
        let cursor = 0;

        for (const interval of occupied) {
            if (interval.start > cursor + LAYOUT_DEFAULTS.wrapTolerance) {
                intervals.push({ start: cursor, end: interval.start });
            }
            cursor = Math.max(cursor, interval.end);
        }

        if (cursor < this.availableWidth - LAYOUT_DEFAULTS.wrapTolerance) {
            intervals.push({ start: cursor, end: this.availableWidth });
        }

        return intervals.filter((interval) => (interval.end - interval.start) > LAYOUT_DEFAULTS.wrapTolerance);
    }
}

export class PageSurface {
    constructor(
        public readonly pageIndex: number,
        public readonly width: number,
        public readonly height: number,
        public readonly boxes: Box[],
        public readonly debugZones: DebugZoneRegion[] = []
    ) { }

    finalize(): Page {
        return {
            index: this.pageIndex,
            width: this.width,
            height: this.height,
            boxes: this.boxes,
            ...(this.debugZones.length > 0 ? { debugZones: this.debugZones.map((zone) => ({ ...zone })) } : {})
        };
    }
}

export type SplitAttempt = {
    actor: PackagerUnit;
    availableWidth: number;
    availableHeight: number;
    context: PackagerContext;
};

export type SplitExecution = {
    attempt: SplitAttempt;
    result: PackagerSplitResult;
};

export type PositionedSplitExecution = {
    execution: SplitExecution;
    layoutDelta: number;
    emitAvailableHeight: number;
};

export type ContinuationQueueOutcome = {
    continuationInstalled: boolean;
    snapshot: LocalQueueSnapshot;
};

export type SpeculativeBranchReason =
    | 'accepted-split'
    | 'continuation-queue-preview'
    | 'keep-with-next'
    | 'observer-resettle'
    | 'tail-split-formation'
    | 'other';

export type SpeculativeBranchContext = {
    readonly reason: SpeculativeBranchReason;
    readonly branchId: string;
    readonly frontier?: SpatialFrontier;
    getCurrentY(): number;
    getLastSpacingAfter(): number;
    getCurrentPageIndex(): number;
    captureNote(label: string, payload?: Record<string, unknown>): void;
};

export type SpeculativeBranchResolution<T> =
    | { accept: true; value: T }
    | { accept: false; value?: T };

export type ExecuteSpeculativeBranchInput<T> = {
    reason: SpeculativeBranchReason;
    frontier?: SpatialFrontier;
    pageBoxes: Box[];
    actorQueue: PackagerUnit[];
    currentY: number;
    lastSpacingAfter: number;
    currentPageIndex: number;
    run: (branch: SpeculativeBranchContext) => SpeculativeBranchResolution<T>;
};

export type ExecuteSpeculativeBranchResult<T> = {
    accepted: boolean;
    value?: T;
    currentY: number;
    lastSpacingAfter: number;
};

export type TailSplitFormationOutcome = {
    committed: { boxes: Box[]; currentY: number; lastSpacingAfter: number };
    queuePreview: ContinuationQueueOutcome;
    queueHandling: AcceptedSplitQueueHandling;
};

export type TailSplitFormationSettlementOutcome = {
    nextPageIndex: number;
    nextPageBoxes: Box[];
    nextCurrentY: number;
    nextLastSpacingAfter: number;
    nextActorIndex: number;
};

export type TailSplitFailureSettlementOutcome = {
    nextPageIndex: number;
    nextPageBoxes: Box[];
    nextCurrentY: number;
    nextLastSpacingAfter: number;
    nextActorIndex: number;
};

export type WholeFormationOverflowEntryOutcome =
    | {
        action: 'advance-page';
        nextPageIndex: number;
        nextPageBoxes: Box[];
        nextCurrentY: number;
        nextLastSpacingAfter: number;
    }
    | {
        action: 'continue-tail-split';
        tailSplitExecution: {
            prefix: PackagerUnit[];
            splitCandidate: PackagerUnit;
            replaceCount: number;
            splitMarkerReserve: number;
        };
    }
    | {
        action: 'fallthrough-local-overflow';
    };

export type WholeFormationOverflowEntrySettlementOutcome =
    | {
        action: 'advance-page';
        nextPageIndex: number;
        nextPageBoxes: Box[];
        nextCurrentY: number;
        nextLastSpacingAfter: number;
        nextActorIndex: number;
    }
    | {
        action: 'continue-tail-split';
        tailSplitExecution: {
            prefix: PackagerUnit[];
            splitCandidate: PackagerUnit;
            replaceCount: number;
            splitMarkerReserve: number;
        };
    }
    | {
        action: 'fallthrough-local-overflow';
    };

export type WholeFormationOverflowResolution = {
    handling: WholeFormationOverflowHandling | null;
    fallbackOutcome: WholeFormationOverflowHandling['fallbackHandling'];
    action: PaginationLoopAction | null;
    tailSplitExecution: WholeFormationOverflowHandling['tailSplitExecution'];
};

export type KeepWithNextPlanningResolution = {
    plan: KeepWithNextFormationPlan | null;
    handling: WholeFormationOverflowHandling | null;
    tailSplitSuccessOutcome: ReturnType<typeof getTailSplitPostAttemptOutcome> | null;
    tailSplitFailureOutcome: ReturnType<typeof getTailSplitPostAttemptOutcome> | null;
};

export type GenericSplitOutcome = {
    committed: { boxes: Box[]; currentY: number; lastSpacingAfter: number };
    queuePreview: ContinuationQueueOutcome;
    queueHandling: AcceptedSplitQueueHandling;
};

export type AcceptedSplitQueueHandling = {
    shouldAdvanceIndex: boolean;
};

export type ForcedOverflowCommitOutcome = {
    committed: { boxes: Box[]; currentY: number; lastSpacingAfter: number };
    shouldAdvancePage: boolean;
};

export type ActorOverflowPreSplitHandlingOutcome = {
    committed: { boxes: Box[]; currentY: number; lastSpacingAfter: number } | null;
    shouldAdvancePage: boolean;
    shouldAdvanceIndex: boolean;
};

export type ActorOverflowSplitEntryHandlingOutcome = {
    splitExecution: SplitExecution | null;
    shouldAdvancePage: boolean;
};

export type ActorOverflowEntryHandlingOutcome =
    | {
        action: 'handled';
        nextCurrentY: number;
        nextLastSpacingAfter: number;
        shouldAdvancePage: boolean;
        shouldAdvanceIndex: boolean;
        committedBoxes: Box[];
    }
    | {
        action: 'continue-to-split';
        splitExecution: SplitExecution;
    };

export type ActorOverflowEntrySettlementOutcome =
    | {
        action: 'handled';
        nextPageIndex: number;
        nextPageBoxes: Box[];
        nextCurrentY: number;
        nextLastSpacingAfter: number;
        nextActorIndex: number;
    }
    | {
        action: 'continue-to-split';
        splitExecution: SplitExecution;
    };

export type ActorOverflowResolution =
    | {
        action: 'handled';
        loopAction: PaginationLoopAction;
    }
    | {
        action: 'continue-to-split';
        splitExecution: SplitExecution;
    };

export type KeepWithNextOverflowActionInput = {
    planning: KeepWithNextPlanningResolution | null;
    wholeFormationOverflow: WholeFormationOverflowResolution;
    effectiveHeight: number;
    marginBottom: number;
    effectiveAvailableHeight: number;
    isAtPageTop: boolean;
    pages: Page[];
    currentPageBoxes: Box[];
    currentPageIndex: number;
    pageWidth: number;
    pageHeight: number;
    nextPageTopY: number;
    currentActorIndex: number;
    actorQueue: PackagerUnit[];
    state: {
        currentY: number;
        lastSpacingAfter: number;
        pageLimit: number;
        availableWidth: number;
    };
    contextBase: Omit<PackagerContext, 'pageIndex' | 'cursorY'>;
    positionMarker: (marker: FlowBox, currentY: number, layoutBefore: number, availableWidth: number, pageIndex: number) => Box | Box[];
};

export type ActorPlacementActionInput = {
    actor: PackagerUnit;
    placementFrame: ResolvedPlacementFrame;
    availableWidth: number;
    availableHeight: number;
    context: PackagerContext;
    state: FragmentCommitState;
    constraintField: ConstraintField;
    layoutBefore: number;
    pageLimit: number;
    pageTop: number;
    pages: Page[];
    currentPageBoxes: Box[];
    currentPageIndex: number;
    pageWidth: number;
    pageHeight: number;
    nextPageTopY: number;
    currentActorIndex: number;
    currentY: number;
    lastSpacingAfter: number;
};

export type GenericSplitActionInput = {
    pages: Page[];
    currentPageBoxes: Box[];
    currentPageIndex: number;
    pageWidth: number;
    pageHeight: number;
    nextPageTopY: number;
    currentActorIndex: number;
    actorQueue: PackagerUnit[];
    packager: PackagerUnit;
    splitExecution: SplitExecution;
    state: {
        currentY: number;
        lastSpacingAfter: number;
        effectiveHeight: number;
        marginBottom: number;
        availableWidth: number;
        availableHeightAdjusted: number;
        pageLimit: number;
        pageTop: number;
        layoutBefore: number;
    };
    contextBase: Omit<PackagerContext, 'pageIndex' | 'cursorY'>;
    resolveDeferredCursorY: (candidate: PackagerUnit) => number | null;
    positionMarker: (marker: FlowBox, currentY: number, layoutBefore: number, availableWidth: number, pageIndex: number) => Box | Box[];
};

export type ActorMeasurement = {
    marginTop: number;
    marginBottom: number;
    contentHeight: number;
    requiredHeight: number;
    effectiveHeight: number;
};

export type ActorSplitFailureHandlingOutcome = {
    committed: { boxes: Box[]; currentY: number; lastSpacingAfter: number } | null;
    shouldAdvancePage: boolean;
    shouldAdvanceIndex: boolean;
};

export type ActorSplitFailureResolution = {
    nextCurrentY: number;
    nextLastSpacingAfter: number;
    shouldAdvancePage: boolean;
    shouldAdvanceIndex: boolean;
    committedBoxes: Box[];
};

export type ActorSplitFailureSettlementOutcome = {
    nextPageIndex: number;
    nextPageBoxes: Box[];
    nextCurrentY: number;
    nextLastSpacingAfter: number;
    nextActorIndex: number;
};

export type DeferredSplitPlacementOutcome = {
    shouldAdvancePage: boolean;
    nextCurrentY: number;
};

export type DeferredSplitPlacementSettlementOutcome = {
    nextPageIndex: number;
    nextPageBoxes: Box[];
    nextCurrentY: number;
    nextLastSpacingAfter: number;
    nextActorIndex: number;
};

export type GenericSplitSuccessHandlingOutcome = {
    nextCurrentY: number;
    nextLastSpacingAfter: number;
    shouldAdvancePage: boolean;
    shouldAdvanceIndex: boolean;
    committedBoxes: Box[];
};

export type GenericSplitSuccessSettlementOutcome = {
    nextPageIndex: number;
    nextPageBoxes: Box[];
    nextCurrentY: number;
    nextLastSpacingAfter: number;
    nextActorIndex: number;
};

export type PageAdvanceOutcome = {
    nextPageIndex: number;
    nextPageBoxes: Box[];
    nextCurrentY: number;
    nextLastSpacingAfter: number;
};

export type ActorPlacementCommitOutcome =
    | {
        action: 'defer';
        nextCurrentY: number;
        shouldAdvancePage: boolean;
    }
    | {
        action: 'commit';
        committed: { boxes: Box[]; currentY: number; lastSpacingAfter: number };
    };

export type ActorPlacementExecutionOutcome =
    | {
        action: 'retry-next-page';
    }
    | ActorPlacementCommitOutcome;

export type ActorPlacementAttemptOutcome =
    | {
        action: 'retry-next-page';
    }
    | {
        action: 'defer';
        nextCurrentY: number;
        shouldAdvancePage: boolean;
    }
    | {
        action: 'commit';
        committed: { boxes: Box[]; currentY: number; lastSpacingAfter: number };
    };

export type ActorPlacementHandlingOutcome = {
    nextCurrentY: number;
    nextLastSpacingAfter: number;
    shouldAdvancePage: boolean;
    shouldAdvanceIndex: boolean;
};

export type ActorPlacementSettlementOutcome = {
    nextPageIndex: number;
    nextPageBoxes: Box[];
    nextCurrentY: number;
    nextLastSpacingAfter: number;
    nextActorIndex: number;
};

export type SequencePlacementCheckpoint = {
    boxStartIndex: number;
    currentY: number;
    lastSpacingAfter: number;
};

export type LocalTransitionSnapshot = {
    boxStartIndex: number;
    currentY: number;
    lastSpacingAfter: number;
};

export type LocalQueueSnapshot = {
    actorQueue: PackagerUnit[];
    stagedContinuationActors: Map<string, PackagerUnit[]>;
    stagedAfterSplitMarkers: Map<string, FlowBox[]>;
};

export type LocalSplitStateSnapshot = {
    currentPageReservations: RegionReservation[];
    currentPageExclusions: SpatialExclusion[];
    fragmentTransitions: FragmentTransition[];
    fragmentTransitionsByActor: Map<string, FragmentTransition>;
    fragmentTransitionsBySource: Map<string, FragmentTransition[]>;
};

export type ProgressionStateSnapshot = {
    simulationClockSnapshot: SimulationClockSnapshot;
};

export type KernelBranchStateSnapshot = LocalQueueSnapshot & LocalSplitStateSnapshot;

export type SessionBranchStateSnapshot = KernelBranchStateSnapshot & ProgressionStateSnapshot;

export type LocalBranchStateSnapshot = SessionBranchStateSnapshot & LocalActorSignalSnapshot;

export type LocalBranchSnapshot = LocalTransitionSnapshot & SessionBranchStateSnapshot & LocalActorSignalSnapshot;

export type SafeCheckpointSnapshot = LocalTransitionSnapshot & SessionBranchStateSnapshot;
export type SessionSafeCheckpoint = SafeCheckpoint<LocalTransitionSnapshot, SessionBranchStateSnapshot>;

export type FragmentTransition = {
    predecessorActorId: string;
    currentFragmentActorId: string | null;
    continuationActorId: string | null;
    sourceActorId: string;
    pageIndex: number;
    availableWidth: number;
    availableHeight: number;
    continuationEnqueued: boolean;
};

export interface Collaborator {
    onSimulationStart?(session: LayoutSession): void;
    onActorSpawn?(actor: PackagerUnit, session: LayoutSession): void;
    onPageStart?(pageIndex: number, surface: PageSurface, session: LayoutSession): void;
    onConstraintNegotiation?(actor: PackagerUnit, constraints: ConstraintField, session: LayoutSession): void;
    onActorPrepared?(actor: PackagerUnit, session: LayoutSession): void;
    onSplitAttempt?(attempt: SplitAttempt, session: LayoutSession): void;
    onSplitAccepted?(attempt: SplitAttempt, result: PackagerSplitResult, session: LayoutSession): void;
    onContinuationEnqueued?(predecessor: PackagerUnit, successor: PackagerUnit, session: LayoutSession): void;
    onActorCommitted?(actor: PackagerUnit, committed: Box[], surface: PageSurface, session: LayoutSession): void;
    onContinuationProduced?(predecessor: PackagerUnit, successor: PackagerUnit, session: LayoutSession): void;
    onPageFinalized?(surface: PageSurface, session: LayoutSession): void;
    onSimulationComplete?(session: LayoutSession): boolean | void;
}

export type PaginationLoopState = {
    actorQueue: PackagerUnit[];
    actorIndex: number;
    paginationState: PaginationState;
    availableWidth: number;
    availableHeight: number;
    lastSpacingAfter: number;
    isAtPageTop: boolean;
    context: PackagerContext;
};

export type PaginationPlacementPreparation =
    | {
        action: 'continue-loop';
        loopAction: PaginationLoopAction;
    }
    | {
        action: 'ready';
        currentY: number;
        availableWidth: number;
        availableHeight: number;
        isAtPageTop: boolean;
        layoutBefore: number;
        layoutDelta: number;
        constraintField: ConstraintField;
        placementFrame: ResolvedPlacementFrame;
        context: PackagerContext;
        availableHeightAdjusted: number;
        effectiveAvailableHeight: number;
        resolveDeferredCursorY: (candidate: PackagerUnit) => number | null;
    };

export type ObservedActorBoundaryResult = {
    currentY: number;
    currentPageIndex: number;
    actorQueue: PackagerUnit[];
    settled: boolean;
};

export type ObserverCheckBoundaryInput = {
    currentY: number;
    currentPageIndex: number;
    actorQueue: PackagerUnit[];
    state: {
        availableWidth: number;
        availableHeight: number;
        isAtPageTop: boolean;
        context: PackagerContext;
    };
    frontier: SpatialFrontier | null;
    observe: () => ObservationResult;
};
