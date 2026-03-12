import { performance } from 'node:perf_hooks';
import type { Box, Page, PageRegionContent, PageReservationSelector } from '../types';
import type { EngineRuntime } from '../runtime';
import type { ContinuationArtifacts, FlowBox } from './layout-core-types';
import { getActorOverflowHandling, type ActorOverflowHandling } from './actor-overflow';
import type { PackagerUnit } from './packagers/packager-types';
import type { KeepWithNextFormationPlan, WholeFormationOverflowHandling } from './actor-formation';
import type { PackagerContext } from './packagers/packager-types';
import type { PackagerSplitResult } from './packagers/packager-types';
import { getTailSplitPostAttemptOutcome, getWholeFormationOverflowHandling } from './actor-formation';
import { LAYOUT_DEFAULTS } from './defaults';
import { computeKeepWithNextPlan } from './keep-with-next-collaborator';
import { LayoutCollaboratorDispatcher } from './layout-collaborator-dispatcher';
import { Kernel } from './kernel';
import { preparePackagerForPhase, rejectsPlacementFrame, resolvePackagerPlacementPreference } from './packagers/packager-types';
import type {
    SimulationArtifactKey,
    SimulationArtifactMap,
    SimulationArtifacts,
    SimulationReport,
    SimulationReportReader
} from './simulation-report';
import { createSimulationReportReader, simulationArtifactKeys } from './simulation-report';

export type LayoutProfileMetrics = {
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
            const boxTop = Number.isFinite(box.y) ? Number(box.y) : 0;
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
        public readonly boxes: Box[]
    ) { }

    finalize(): Page {
        return {
            index: this.pageIndex,
            width: this.width,
            height: this.height,
            boxes: this.boxes
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

export type TailSplitFormationOutcome = {
    branchSnapshot: LocalBranchSnapshot;
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
    branchSnapshot: LocalBranchSnapshot;
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

export type LocalBranchStateSnapshot = LocalQueueSnapshot & LocalSplitStateSnapshot;

export type LocalBranchSnapshot = LocalTransitionSnapshot & LocalQueueSnapshot & LocalSplitStateSnapshot;

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

export interface LayoutCollaborator {
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

type LayoutSessionOptions = {
    runtime: EngineRuntime;
    collaborators?: readonly LayoutCollaborator[];
};

export class LayoutSession {
    readonly runtime: EngineRuntime;
    readonly collaborators: readonly LayoutCollaborator[];
    readonly collaboratorDispatcher: LayoutCollaboratorDispatcher;
    readonly kernel = new Kernel();
    readonly profile: LayoutProfileMetrics = {
        keepWithNextPlanCalls: 0,
        keepWithNextPlanMs: 0,
        keepWithNextBranchCalls: 0,
        keepWithNextBranchMs: 0,
        keepWithNextPreparedActors: 0,
        keepWithNextEarlyExitCalls: 0,
        keepWithNextPrepareByKind: {},
        reservationCommitProbeCalls: 0,
        reservationCommitProbeMs: 0,
        reservationConstraintNegotiationCalls: 0,
        reservationConstraintNegotiationMs: 0,
        reservationConstraintApplications: 0,
        reservationWrites: 0,
        reservationArtifactMs: 0,
        exclusionBlockedCursorCalls: 0,
        exclusionBlockedCursorMs: 0,
        exclusionBandResolutionCalls: 0,
        exclusionBandResolutionMs: 0,
        exclusionLaneApplications: 0
    };
    private readonly keepWithNextPlans = new Map<string, KeepWithNextFormationPlan>();
    private readonly pageFinalizationStates = new Map<number, PageFinalizationState>();
    private logicalPageNumberCursor = 0;
    private finalizedPages: Page[] = [];
    private simulationReport?: SimulationReport;
    private simulationReportReader: SimulationReportReader = createSimulationReportReader(undefined);
    private paginationLoopState: PaginationLoopState | null = null;

    currentPageIndex = 0;
    currentY = 0;
    currentConstraintField: ConstraintField | null = null;
    currentSurface: PageSurface | null = null;

    constructor(options: LayoutSessionOptions) {
        this.runtime = options.runtime;
        this.collaborators = options.collaborators ?? [];
        this.collaboratorDispatcher = new LayoutCollaboratorDispatcher(this.collaborators);
    }

    notifySimulationStart(): void {
        this.finalizedPages = [];
        this.kernel.resetForSimulation();
        this.pageFinalizationStates.clear();
        this.logicalPageNumberCursor = 0;
        this.collaboratorDispatcher.onSimulationStart(this);
    }

    notifyActorSpawn(actor: PackagerUnit): void {
        this.kernel.registerActor(actor);
        this.collaboratorDispatcher.onActorSpawn(actor, this);
    }

    notifyPageStart(pageIndex: number, width: number, height: number, boxes: Box[]): void {
        this.currentPageIndex = pageIndex;
        this.currentSurface = new PageSurface(pageIndex, width, height, boxes);
        this.kernel.beginPage();
        this.collaboratorDispatcher.onPageStart(pageIndex, this.currentSurface, this);
    }

    advancePage(
        pages: Page[],
        currentPageBoxes: Box[],
        currentPageIndex: number,
        pageWidth: number,
        pageHeight: number,
        nextPageTopY: number
    ): PageAdvanceOutcome {
        if (currentPageBoxes.length > 0) {
            pages.push(this.finalizeCommittedPage(currentPageIndex, pageWidth, pageHeight, currentPageBoxes));
        }

        const nextPageIndex = currentPageIndex + 1;
        const nextPageBoxes: Box[] = [];
        this.notifyPageStart(nextPageIndex, pageWidth, pageHeight, nextPageBoxes);

        return {
            nextPageIndex,
            nextPageBoxes,
            nextCurrentY: nextPageTopY,
            nextLastSpacingAfter: 0
        };
    }

    notifyConstraintNegotiation(actor: PackagerUnit, constraints: ConstraintField): void {
        this.currentConstraintField = constraints;
        const startedAt = performance.now();
        this.recordProfile('reservationConstraintNegotiationCalls', 1);
        for (const reservation of this.kernel.getCurrentPageReservations()) {
            constraints.reservations.push({ ...reservation });
            this.recordProfile('reservationConstraintApplications', 1);
        }
        for (const exclusion of this.kernel.getCurrentPageExclusions()) {
            constraints.exclusions.push({ ...exclusion });
        }
        this.recordProfile('reservationConstraintNegotiationMs', performance.now() - startedAt);
        this.collaboratorDispatcher.onConstraintNegotiation(actor, constraints, this);
    }

    notifyActorPrepared(actor: PackagerUnit): void {
        this.collaboratorDispatcher.onActorPrepared(actor, this);
    }

    notifySplitAttempt(attempt: SplitAttempt): void {
        this.collaboratorDispatcher.onSplitAttempt(attempt, this);
    }

    executeSplitAttempt(
        actor: PackagerUnit,
        availableWidth: number,
        availableHeight: number,
        context: PackagerContext
    ): SplitExecution {
        const attempt = {
            actor,
            availableWidth,
            availableHeight,
            context
        };
        this.notifySplitAttempt(attempt);
        return {
            attempt,
            result: actor.split(availableHeight, context)
        };
    }

    executePositionedSplitAttempt(
        actor: PackagerUnit,
        availableWidth: number,
        currentY: number,
        lastSpacingAfter: number,
        pageLimit: number,
        pageIndex: number,
        markerReserve: number,
        contextBase: Omit<PackagerContext, 'pageIndex' | 'cursorY'>
    ): PositionedSplitExecution {
        const marginTop = actor.getMarginTop();
        const layoutBefore = lastSpacingAfter + marginTop;
        const layoutDelta = layoutBefore - marginTop;
        const emitAvailableHeight = (pageLimit - currentY) - layoutDelta;
        const context = {
            ...contextBase,
            pageIndex,
            cursorY: currentY
        };

        return {
            execution: this.executeSplitAttempt(
                actor,
                availableWidth,
                emitAvailableHeight - markerReserve,
                context
            ),
            layoutDelta,
            emitAvailableHeight
        };
    }

    notifySplitAccepted(attempt: SplitAttempt, result: PackagerSplitResult): void {
        this.kernel.registerSplitAccepted(attempt, result);
        this.collaboratorDispatcher.onSplitAccepted(attempt, result, this);
    }

    notifyActorCommitted(actor: PackagerUnit, committed: Box[]): void {
        if (!this.currentSurface) return;
        this.collaboratorDispatcher.onActorCommitted(actor, committed, this.currentSurface, this);
    }

    notifyContinuationProduced(predecessor: PackagerUnit, successor: PackagerUnit): void {
        this.kernel.markContinuationProduced(successor);
        this.collaboratorDispatcher.onContinuationProduced(predecessor, successor, this);
    }

    notifyContinuationEnqueued(predecessor: PackagerUnit, successor: PackagerUnit): void {
        this.kernel.markContinuationEnqueued(predecessor, successor);
        this.collaboratorDispatcher.onContinuationEnqueued(predecessor, successor, this);
    }

    finalizeCommittedPage(pageIndex: number, width: number, height: number, boxes: readonly Box[]): Page {
        const surface = new PageSurface(pageIndex, width, height, [...boxes]);
        this.collaboratorDispatcher.onPageFinalized(surface, this);
        return surface.finalize();
    }

    closePagination(
        pages: Page[],
        currentPageBoxes: readonly Box[],
        currentPageIndex: number,
        pageWidth: number,
        pageHeight: number
    ): void {
        if (currentPageBoxes.length === 0) return;
        pages.push(this.finalizeCommittedPage(currentPageIndex, pageWidth, pageHeight, currentPageBoxes));
    }

    resolveNextActorIndex(currentIndex: number, shouldAdvanceIndex: boolean): number {
        return shouldAdvanceIndex ? currentIndex + 1 : currentIndex;
    }

    applyPaginationState(target: PaginationState, next: PaginationState): void {
        target.currentPageIndex = next.currentPageIndex;
        target.currentPageBoxes = next.currentPageBoxes;
        target.currentY = next.currentY;
        target.lastSpacingAfter = next.lastSpacingAfter;
    }

    createContinueLoopAction(
        paginationState: PaginationState,
        nextActorIndex: number
    ): PaginationLoopAction {
        return {
            action: 'continue-loop',
            paginationState,
            nextActorIndex
        };
    }

    restartCurrentActorOnNextPage(
        pages: Page[],
        currentPageBoxes: Box[],
        currentPageIndex: number,
        pageWidth: number,
        pageHeight: number,
        nextPageTopY: number,
        actorIndex: number
    ): PaginationLoopAction {
        const pageAdvance = this.advancePage(
            pages,
            currentPageBoxes,
            currentPageIndex,
            pageWidth,
            pageHeight,
            nextPageTopY
        );
        return this.createContinueLoopAction(
            {
                currentPageIndex: pageAdvance.nextPageIndex,
                currentPageBoxes: pageAdvance.nextPageBoxes,
                currentY: pageAdvance.nextCurrentY,
                lastSpacingAfter: pageAdvance.nextLastSpacingAfter
            },
            actorIndex
        );
    }

    preparePaginationPlacement(input: {
        actor: PackagerUnit;
        currentActorIndex: number;
        pages: Page[];
        currentPageBoxes: Box[];
        currentPageIndex: number;
        currentY: number;
        lastSpacingAfter: number;
        pageWidth: number;
        pageHeight: number;
        pageLimit: number;
        margins: { top: number; right: number; bottom: number; left: number };
        contextBase: Omit<PackagerContext, 'pageIndex' | 'cursorY'>;
    }): PaginationPlacementPreparation {
        const fullAvailableWidth = input.pageWidth - input.margins.left - input.margins.right;
        let availableWidth = fullAvailableWidth;
        let availableHeight = input.pageLimit - input.currentY;

        if (availableHeight <= 0 && input.currentY > input.margins.top) {
            return {
                action: 'continue-loop',
                loopAction: this.restartCurrentActorOnNextPage(
                    input.pages,
                    input.currentPageBoxes,
                    input.currentPageIndex,
                    input.pageWidth,
                    input.pageHeight,
                    input.margins.top,
                    input.currentActorIndex
                )
            };
        }

        const isAtPageTop = input.currentY === input.margins.top && input.currentPageBoxes.length === 0;
        if (input.actor.pageBreakBefore && !isAtPageTop) {
            return {
                action: 'continue-loop',
                loopAction: this.restartCurrentActorOnNextPage(
                    input.pages,
                    input.currentPageBoxes,
                    input.currentPageIndex,
                    input.pageWidth,
                    input.pageHeight,
                    input.margins.top,
                    input.currentActorIndex
                )
            };
        }

        const marginTop = input.actor.getMarginTop();
        const layoutBefore = input.lastSpacingAfter + marginTop;
        const layoutDelta = layoutBefore - marginTop;
        const constraintField = new ConstraintField(availableWidth, availableHeight - layoutDelta);
        this.notifyConstraintNegotiation(input.actor, constraintField);
        const placementSurfaceStart = performance.now();
        const placementFrame = constraintField.resolvePlacementFrame(input.currentY + layoutBefore, {
            left: input.margins.left,
            right: input.margins.right
        });
        this.recordProfile('exclusionBlockedCursorCalls', 1);
        this.recordProfile('exclusionBandResolutionCalls', 1);
        const placementSurfaceDuration = performance.now() - placementSurfaceStart;
        this.recordProfile('exclusionBlockedCursorMs', placementSurfaceDuration);
        this.recordProfile('exclusionBandResolutionMs', placementSurfaceDuration);

        let currentY = input.currentY;
        if (placementFrame.cursorY > input.currentY + layoutBefore + LAYOUT_DEFAULTS.wrapTolerance) {
            currentY = placementFrame.cursorY - layoutBefore;
            availableHeight = input.pageLimit - currentY;
            if (availableHeight <= 0 && currentY > input.margins.top) {
                return {
                    action: 'continue-loop',
                    loopAction: this.restartCurrentActorOnNextPage(
                        input.pages,
                        input.currentPageBoxes,
                        input.currentPageIndex,
                        input.pageWidth,
                        input.pageHeight,
                        input.margins.top,
                        input.currentActorIndex
                    )
                };
            }
        }

        if (placementFrame.contentBand) {
            this.recordProfile('exclusionLaneApplications', 1);
        }

        availableWidth = placementFrame.availableWidth;
        const context: PackagerContext = {
            ...input.contextBase,
            pageIndex: input.currentPageIndex,
            cursorY: currentY,
            margins: {
                ...input.margins,
                left: placementFrame.margins.left,
                right: placementFrame.margins.right
            }
        };
        const availableHeightAdjusted = constraintField.effectiveAvailableHeight;
        const effectiveAvailableHeight = layoutDelta + availableHeightAdjusted;

        return {
            action: 'ready',
            currentY,
            availableWidth,
            availableHeight,
            isAtPageTop,
            layoutBefore,
            layoutDelta,
            constraintField,
            placementFrame,
            context,
            availableHeightAdjusted,
            effectiveAvailableHeight,
            resolveDeferredCursorY: (candidate: PackagerUnit): number | null => {
                if (!placementFrame.contentBand) return null;

                const placementPreference = resolvePackagerPlacementPreference(
                    candidate,
                    constraintField.availableWidth,
                    context
                );
                const minimumPlacementWidth = placementPreference?.minimumWidth;
                if (
                    minimumPlacementWidth !== null &&
                    minimumPlacementWidth !== undefined &&
                    placementFrame.availableWidth + LAYOUT_DEFAULTS.wrapTolerance < minimumPlacementWidth
                ) {
                    return placementFrame.activeBand?.bottom ?? placementFrame.cursorY;
                }

                if (
                    rejectsPlacementFrame(
                        candidate,
                        placementFrame.availableWidth,
                        constraintField.availableWidth,
                        context
                    )
                ) {
                    return placementFrame.activeBand?.bottom ?? placementFrame.cursorY;
                }

                return null;
            }
        };
    }

    applyPaginationLoopAction(
        target: PaginationState,
        action: PaginationLoopAction
    ): number {
        if (action.action !== 'continue-loop') {
            throw new Error(`Cannot apply non-continuation loop action directly: ${action.action}`);
        }
        this.applyPaginationState(target, action.paginationState);
        return action.nextActorIndex;
    }

    finalizePages(pages: Page[]): Page[] {
        this.finalizedPages = pages;

        this.collaboratorDispatcher.onSimulationComplete(this);

        this.setSimulationReport(this.buildSimulationReport());

        return pages;
    }

    // Collaborator-facing artifact publication. Downstream consumers should prefer
    // getSimulationReport() over reading individual artifacts directly.
    publishArtifact<K extends SimulationArtifactKey>(key: K, value: SimulationArtifactMap[K]): void;
    publishArtifact(key: string, value: unknown): void;
    publishArtifact(key: string, value: unknown): void {
        this.kernel.publishArtifact(key, value);
    }

    // Report assembly helper. The raw artifact registry remains internal;
    // downstream consumers should read the consolidated simulation report.
    buildSimulationArtifacts(): SimulationArtifacts {
        const publishedArtifacts = this.kernel.getPublishedArtifacts();
        const artifacts: SimulationArtifacts = {
            fragmentationSummary: publishedArtifacts.get(simulationArtifactKeys.fragmentationSummary) as SimulationArtifactMap['fragmentationSummary'],
            transformCapabilitySummary: publishedArtifacts.get(simulationArtifactKeys.transformCapabilitySummary) as SimulationArtifactMap['transformCapabilitySummary'],
            transformSummary: publishedArtifacts.get(simulationArtifactKeys.transformSummary) as SimulationArtifactMap['transformSummary'],
            pageNumberSummary: publishedArtifacts.get(simulationArtifactKeys.pageNumberSummary) as SimulationArtifactMap['pageNumberSummary'],
            pageOverrideSummary: publishedArtifacts.get(simulationArtifactKeys.pageOverrideSummary) as SimulationArtifactMap['pageOverrideSummary'],
            pageExclusionSummary: publishedArtifacts.get(simulationArtifactKeys.pageExclusionSummary) as SimulationArtifactMap['pageExclusionSummary'],
            pageReservationSummary: publishedArtifacts.get(simulationArtifactKeys.pageReservationSummary) as SimulationArtifactMap['pageReservationSummary'],
            pageSpatialConstraintSummary: publishedArtifacts.get(simulationArtifactKeys.pageSpatialConstraintSummary) as SimulationArtifactMap['pageSpatialConstraintSummary'],
            pageRegionSummary: publishedArtifacts.get(simulationArtifactKeys.pageRegionSummary) as SimulationArtifactMap['pageRegionSummary'],
            sourcePositionMap: publishedArtifacts.get(simulationArtifactKeys.sourcePositionMap) as SimulationArtifactMap['sourcePositionMap'],
            headingTelemetry: publishedArtifacts.get(simulationArtifactKeys.headingTelemetry) as SimulationArtifactMap['headingTelemetry']
        };

        for (const [key, value] of publishedArtifacts.entries()) {
            if (key in artifacts && artifacts[key] !== undefined) continue;
            artifacts[key] = value;
        }

        return artifacts;
    }

    getFinalizedPages(): readonly Page[] {
        return this.finalizedPages;
    }

    recordPageFinalization(state: PageFinalizationState): void {
        this.pageFinalizationStates.set(state.pageIndex, state);
    }

    resetLogicalPageNumbering(startAt: number): void {
        const normalized = Number.isFinite(startAt) ? Math.floor(Number(startAt)) : 1;
        this.logicalPageNumberCursor = Math.max(0, normalized - 1);
    }

    allocateLogicalPageNumber(usesLogicalNumbering: boolean): number | null {
        if (!usesLogicalNumbering) {
            return null;
        }
        this.logicalPageNumberCursor += 1;
        return this.logicalPageNumberCursor;
    }

    getPageFinalizationState(pageIndex: number): PageFinalizationState | undefined {
        return this.pageFinalizationStates.get(pageIndex);
    }

    getPageFinalizationStates(): readonly PageFinalizationState[] {
        return Array.from(this.pageFinalizationStates.values()).sort((a, b) => a.pageIndex - b.pageIndex);
    }

    reservePageSpace(reservation: PageReservationIntent, pageIndex: number = this.currentPageIndex): void {
        const selector = reservation.selector ?? 'current';
        if (selector !== 'current' && !this.matchesPageReservationSelector(pageIndex, selector)) {
            return;
        }

        const normalizedHeight = Number.isFinite(reservation.height) ? Math.max(0, Number(reservation.height)) : 0;
        if (!(normalizedHeight > 0)) return;

        const normalized: RegionReservation = {
            ...reservation,
            height: normalizedHeight
        };
        this.kernel.storePageReservation(pageIndex, this.currentPageIndex, normalized);
        this.recordProfile('reservationWrites', 1);
    }

    reserveCurrentPageSpace(reservation: RegionReservation): void {
        this.reservePageSpace(reservation, this.currentPageIndex);
    }

    getCurrentPageReservations(): readonly RegionReservation[] {
        return this.kernel.getCurrentPageReservations();
    }

    getPageReservations(pageIndex: number): readonly RegionReservation[] {
        return this.kernel.getPageReservations(pageIndex);
    }

    getReservationPageIndices(): readonly number[] {
        return this.kernel.getReservationPageIndices();
    }

    excludePageSpace(exclusion: PageExclusionIntent, pageIndex: number = this.currentPageIndex): void {
        const selector = exclusion.selector ?? 'current';
        if (selector !== 'current' && !this.matchesPageSelector(pageIndex, selector)) {
            return;
        }

        const normalized: SpatialExclusion = {
            ...exclusion,
            x: Number.isFinite(exclusion.x) ? Number(exclusion.x) : 0,
            y: Number.isFinite(exclusion.y) ? Math.max(0, Number(exclusion.y)) : 0,
            w: Number.isFinite(exclusion.w) ? Math.max(0, Number(exclusion.w)) : 0,
            h: Number.isFinite(exclusion.h) ? Math.max(0, Number(exclusion.h)) : 0
        };
        if (!(normalized.w > 0) || !(normalized.h > 0)) return;

        this.kernel.storePageExclusion(pageIndex, this.currentPageIndex, normalized);
    }

    getPageExclusions(pageIndex: number): readonly SpatialExclusion[] {
        return this.kernel.getPageExclusions(pageIndex);
    }

    getExclusionPageIndices(): readonly number[] {
        return this.kernel.getExclusionPageIndices();
    }

    getSpatialConstraintPageIndices(): readonly number[] {
        return this.kernel.getSpatialConstraintPageIndices();
    }

    matchesPageSelector(pageIndex: number, selector: PageReservationSelector = 'first'): boolean {
        if (!Number.isFinite(pageIndex) || pageIndex < 0) return false;

        switch (selector) {
            case 'all':
                return true;
            case 'odd':
                return pageIndex % 2 === 0;
            case 'even':
                return pageIndex % 2 === 1;
            case 'first':
            default:
                return pageIndex === 0;
        }
    }

    matchesPageReservationSelector(pageIndex: number, selector: PageReservationSelector = 'first'): boolean {
        return this.matchesPageSelector(pageIndex, selector);
    }

    buildSimulationReport(): SimulationReport {
        const pages = this.finalizedPages;
        const generatedBoxCount = pages.reduce((sum, page) => {
            return sum + (page.boxes || []).reduce((pageSum, box) => {
                return pageSum + (box.meta?.generated === true ? 1 : 0);
            }, 0);
        }, 0);

        return {
            pageCount: pages.length,
            actorCount: this.kernel.actorRegistry.length,
            splitTransitionCount: this.getFragmentTransitions().length,
            generatedBoxCount,
            profile: {
                ...this.profile,
                keepWithNextPrepareByKind: { ...this.profile.keepWithNextPrepareByKind }
            },
            artifacts: this.buildSimulationArtifacts()
        };
    }

    setSimulationReport(report: SimulationReport): void {
        this.simulationReport = report;
        this.simulationReportReader = createSimulationReportReader(report);
    }

    getSimulationReport(): SimulationReport | undefined {
        return this.simulationReport;
    }

    getSimulationReportReader(): SimulationReportReader {
        return this.simulationReportReader;
    }

    setContinuationArtifacts(actorId: string, artifacts: ContinuationArtifacts): void {
        this.kernel.setContinuationArtifacts(actorId, artifacts);
    }

    getContinuationArtifacts(actorId: string): ContinuationArtifacts | undefined {
        return this.kernel.getContinuationArtifacts(actorId);
    }

    ensureContinuationArtifacts(actor: PackagerUnit): ContinuationArtifacts | undefined {
        const cached = this.getContinuationArtifacts(actor.actorId);
        if (cached) return cached;

        const resolved = this.resolveContinuationArtifacts(actor);
        if (resolved) {
            this.setContinuationArtifacts(actor.actorId, resolved);
        }
        return resolved;
    }

    getSplitMarkerReserve(actor: PackagerUnit): number {
        const artifacts = this.ensureContinuationArtifacts(actor);
        const marker = artifacts?.markerAfterSplit;
        if (!marker) return 0;

        return (
            Math.max(0, marker.measuredContentHeight || 0) +
            Math.max(0, marker.marginTop || 0) +
            Math.max(0, marker.marginBottom || 0)
        );
    }

    stageActorsBeforeContinuation(continuationActorId: string, actors: PackagerUnit[]): void {
        this.kernel.stageActorsBeforeContinuation(continuationActorId, actors);
        for (const actor of actors) {
            this.notifyActorSpawn(actor);
        }
    }

    consumeActorsBeforeContinuation(continuationActorId: string): PackagerUnit[] {
        return this.kernel.consumeActorsBeforeContinuation(continuationActorId);
    }

    stageMarkersAfterSplit(fragmentActorId: string, markers: FlowBox[]): void {
        this.kernel.stageMarkersAfterSplit(fragmentActorId, markers);
    }

    consumeMarkersAfterSplit(fragmentActorId: string): FlowBox[] {
        return this.kernel.consumeMarkersAfterSplit(fragmentActorId);
    }

    placeSplitMarkersAfterFragment(
        fragmentActorId: string,
        state: SplitMarkerPlacementState,
        positionMarker: (marker: FlowBox, currentY: number, layoutBefore: number, availableWidth: number, pageIndex: number) => Box | Box[]
    ): { boxes: Box[]; currentY: number; lastSpacingAfter: number } {
        const markers = this.consumeMarkersAfterSplit(fragmentActorId);
        const placedBoxes: Box[] = [];
        let currentY = state.currentY;
        let lastSpacingAfter = state.lastSpacingAfter;

        for (const marker of markers) {
            const markerMarginTop = Math.max(0, marker.marginTop || 0);
            const markerMarginBottom = Math.max(0, marker.marginBottom || 0);
            const markerLayoutBefore = lastSpacingAfter + markerMarginTop;
            const markerTotalHeight =
                Math.max(0, marker.measuredContentHeight || 0) +
                markerLayoutBefore +
                markerMarginBottom;
            if (currentY + markerTotalHeight > state.pageLimit + LAYOUT_DEFAULTS.wrapTolerance) {
                continue;
            }

            const positioned = positionMarker(
                marker,
                currentY,
                markerLayoutBefore,
                state.availableWidth,
                state.pageIndex
            );
            const markerBoxes = Array.isArray(positioned) ? positioned : [positioned];
            for (const box of markerBoxes) {
                if (box.meta) box.meta = { ...box.meta, pageIndex: state.pageIndex };
                placedBoxes.push(box);
            }

            const markerEffectiveHeight = Math.max(markerTotalHeight, LAYOUT_DEFAULTS.minEffectiveHeight);
            currentY += markerEffectiveHeight - markerMarginBottom;
            lastSpacingAfter = markerMarginBottom;
        }

        return { boxes: placedBoxes, currentY, lastSpacingAfter };
    }

    placeActorSequence(
        actors: readonly PackagerUnit[],
        state: SequencePlacementState,
        contextBase: Omit<PackagerContext, 'pageIndex' | 'cursorY'>
    ): { boxes: Box[]; currentY: number; lastSpacingAfter: number } {
        const placedBoxes: Box[] = [];
        let currentY = state.currentY;
        let lastSpacingAfter = state.lastSpacingAfter;

        for (const actor of actors) {
            const marginTop = actor.getMarginTop();
            const marginBottom = actor.getMarginBottom();
            const layoutBefore = lastSpacingAfter + marginTop;
            const layoutDelta = layoutBefore - marginTop;
            const availableHeight = (state.pageLimit - currentY) - layoutDelta;
            const context = {
                ...contextBase,
                pageIndex: state.pageIndex,
                cursorY: currentY
            };
            const boxes = actor.emitBoxes(state.availableWidth, availableHeight, context) || [];
            for (const box of boxes) {
                const placed = {
                    ...box,
                    y: (box.y || 0) + currentY + layoutDelta
                };
                if (placed.meta) {
                    placed.meta = { ...placed.meta, pageIndex: state.pageIndex };
                }
                placedBoxes.push(placed);
            }

            const contentHeight = Math.max(0, actor.getRequiredHeight() - marginTop - marginBottom);
            const requiredHeight = contentHeight + layoutBefore + marginBottom;
            const effectiveHeight = Math.max(requiredHeight, LAYOUT_DEFAULTS.minEffectiveHeight);
            currentY += effectiveHeight - marginBottom;
            lastSpacingAfter = marginBottom;
        }

        return { boxes: placedBoxes, currentY, lastSpacingAfter };
    }

    captureLocalTransitionSnapshot(
        pageBoxes: readonly Box[],
        currentY: number,
        lastSpacingAfter: number
    ): LocalTransitionSnapshot {
        return {
            boxStartIndex: pageBoxes.length,
            currentY,
            lastSpacingAfter
        };
    }

    captureLocalBranchSnapshot(
        pageBoxes: readonly Box[],
        actorQueue: readonly PackagerUnit[],
        currentY: number,
        lastSpacingAfter: number
    ): LocalBranchSnapshot {
        return {
            ...this.captureLocalTransitionSnapshot(pageBoxes, currentY, lastSpacingAfter),
            ...this.kernel.captureLocalBranchStateSnapshot(actorQueue)
        };
    }

    captureLocalQueueSnapshot(
        actorQueue: readonly PackagerUnit[]
    ): LocalQueueSnapshot {
        return this.kernel.captureLocalQueueSnapshot(actorQueue);
    }

    captureLocalSplitStateSnapshot(): LocalSplitStateSnapshot {
        return this.kernel.captureLocalSplitStateSnapshot();
    }

    restoreLocalTransitionSnapshot(
        pageBoxes: Box[],
        snapshot: LocalTransitionSnapshot
    ): { currentY: number; lastSpacingAfter: number } {
        pageBoxes.splice(snapshot.boxStartIndex);
        return {
            currentY: snapshot.currentY,
            lastSpacingAfter: snapshot.lastSpacingAfter
        };
    }

    restoreLocalBranchSnapshot(
        pageBoxes: Box[],
        actorQueue: PackagerUnit[],
        snapshot: LocalBranchSnapshot
    ): { currentY: number; lastSpacingAfter: number } {
        this.kernel.restoreLocalBranchStateSnapshot(actorQueue, snapshot);
        return this.restoreLocalTransitionSnapshot(pageBoxes, snapshot);
    }

    restoreLocalQueueSnapshot(
        actorQueue: PackagerUnit[],
        snapshot: LocalQueueSnapshot
    ): void {
        actorQueue.splice(0, actorQueue.length, ...snapshot.actorQueue);
        this.kernel.restoreLocalQueueSnapshot(snapshot);
    }

    rollbackContinuationQueue(
        actorQueue: PackagerUnit[],
        snapshot: LocalQueueSnapshot
    ): void {
        this.kernel.rollbackContinuationQueue(actorQueue, snapshot);
    }

    restoreLocalSplitStateSnapshot(snapshot: LocalSplitStateSnapshot): void {
        this.kernel.restoreLocalSplitStateSnapshot(snapshot);
    }

    rollbackAcceptedSplitBranch(
        pageBoxes: Box[],
        actorQueue: PackagerUnit[],
        snapshot: LocalBranchSnapshot
    ): { currentY: number; lastSpacingAfter: number } {
        return this.restoreLocalBranchSnapshot(pageBoxes, actorQueue, snapshot);
    }

    rollbackActorSequencePlacement(
        pageBoxes: Box[],
        checkpoint: SequencePlacementCheckpoint
    ): { currentY: number; lastSpacingAfter: number } {
        return this.restoreLocalTransitionSnapshot(pageBoxes, checkpoint);
    }

    commitFragmentBoxes(
        actor: PackagerUnit,
        boxes: readonly Box[],
        state: FragmentCommitState
    ): { boxes: Box[]; currentY: number; lastSpacingAfter: number } {
        const committedBoxes = boxes.map((box) => {
            const committed = {
                ...box,
                y: (box.y || 0) + state.currentY + state.layoutDelta
            };
            if (committed.meta) {
                committed.meta = { ...committed.meta, pageIndex: state.pageIndex };
            }
            return committed;
        });

        this.notifyActorCommitted(actor, committedBoxes);

        return {
            boxes: committedBoxes,
            currentY: state.currentY + state.effectiveHeight - state.marginBottom,
            lastSpacingAfter: state.marginBottom
        };
    }

    commitSplitFragmentWithMarkers(
        actor: PackagerUnit,
        boxes: readonly Box[],
        state: SplitFragmentAftermathState,
        positionMarker: (marker: FlowBox, currentY: number, layoutBefore: number, availableWidth: number, pageIndex: number) => Box | Box[]
    ): { boxes: Box[]; currentY: number; lastSpacingAfter: number } {
        const committed = this.commitFragmentBoxes(actor, boxes, state);
        const markerPlacement = this.placeSplitMarkersAfterFragment(
            state.actorId,
            {
                currentY: committed.currentY,
                lastSpacingAfter: committed.lastSpacingAfter,
                pageLimit: state.pageLimit,
                pageIndex: state.pageIndex,
                availableWidth: state.availableWidth
            },
            positionMarker
        );

        return {
            boxes: [...committed.boxes, ...markerPlacement.boxes],
            currentY: markerPlacement.currentY,
            lastSpacingAfter: markerPlacement.lastSpacingAfter
        };
    }

    acceptAndCommitSplitFragment(
        attempt: SplitAttempt,
        result: PackagerSplitResult,
        boxes: readonly Box[],
        state: SplitFragmentAftermathState,
        positionMarker: (marker: FlowBox, currentY: number, layoutBefore: number, availableWidth: number, pageIndex: number) => Box | Box[]
    ): { boxes: Box[]; currentY: number; lastSpacingAfter: number } {
        this.notifySplitAccepted(attempt, result);
        return this.commitSplitFragmentWithMarkers(
            result.currentFragment as PackagerUnit,
            boxes,
            state,
            positionMarker
        );
    }

    createSplitFragmentAftermathState(
        actor: PackagerUnit,
        input: SplitFragmentAftermathInput
    ): SplitFragmentAftermathState {
        const marginTop = actor.getMarginTop();
        const marginBottom = actor.getMarginBottom();
        const layoutBefore = input.lastSpacingAfter + marginTop;
        const contentHeight = Math.max(0, actor.getRequiredHeight() - marginTop - marginBottom);
        const requiredHeight = contentHeight + layoutBefore + marginBottom;

        return {
            currentY: input.currentY,
            layoutDelta: input.layoutDelta,
            effectiveHeight: Math.max(requiredHeight, LAYOUT_DEFAULTS.minEffectiveHeight),
            marginBottom,
            pageIndex: input.pageIndex,
            actorId: actor.actorId,
            lastSpacingAfter: input.lastSpacingAfter,
            pageLimit: input.pageLimit,
            availableWidth: input.availableWidth
        };
    }

    installContinuationIntoQueue(
        actorQueue: PackagerUnit[],
        startIndex: number,
        replaceCount: number,
        predecessor: PackagerUnit,
        continuation: PackagerUnit | null | undefined,
        options: { notify?: boolean } = {}
    ): boolean {
        if (continuation && options.notify !== false) {
            this.notifyContinuationEnqueued(predecessor, continuation);
        }
        return this.kernel.installContinuationIntoQueue(
            actorQueue,
            startIndex,
            replaceCount,
            continuation
        );
    }

    settleContinuationQueue(
        actorQueue: PackagerUnit[],
        startIndex: number,
        replaceCount: number,
        predecessor: PackagerUnit,
        continuation: PackagerUnit | null | undefined,
        options: { notify?: boolean } = {}
    ): ContinuationQueueOutcome {
        if (continuation && options.notify !== false) {
            this.notifyContinuationEnqueued(predecessor, continuation);
        }
        return this.kernel.settleContinuationQueue(
            actorQueue,
            startIndex,
            replaceCount,
            continuation
        );
    }

    previewContinuationQueueSettlement(
        actorQueue: PackagerUnit[],
        startIndex: number,
        replaceCount: number,
        _predecessor: PackagerUnit,
        continuation: PackagerUnit | null | undefined
    ): ContinuationQueueOutcome {
        return this.kernel.previewContinuationQueueSettlement(
            actorQueue,
            startIndex,
            replaceCount,
            continuation
        );
    }

    getAcceptedSplitQueueHandling(preview: ContinuationQueueOutcome): AcceptedSplitQueueHandling {
        return {
            shouldAdvanceIndex: !preview.continuationInstalled
        };
    }

    previewAcceptedSplitSettlement(
        pageBoxes: readonly Box[],
        actorQueue: PackagerUnit[],
        startIndex: number,
        replaceCount: number,
        predecessor: PackagerUnit,
        continuation: PackagerUnit | null | undefined,
        attempt: SplitAttempt,
        result: PackagerSplitResult,
        boxes: readonly Box[],
        state: SplitFragmentAftermathState,
        positionMarker: (marker: FlowBox, currentY: number, layoutBefore: number, availableWidth: number, pageIndex: number) => Box | Box[]
    ): { queuePreview: ContinuationQueueOutcome; queueHandling: AcceptedSplitQueueHandling } {
        const snapshot = this.captureLocalBranchSnapshot(
            pageBoxes,
            actorQueue,
            state.currentY,
            state.lastSpacingAfter
        );

        this.acceptAndCommitSplitFragment(
            attempt,
            result,
            boxes,
            state,
            positionMarker
        );
        const queuePreview = this.settleContinuationQueue(
            actorQueue,
            startIndex,
            replaceCount,
            predecessor,
            continuation,
            { notify: false }
        );
        this.rollbackAcceptedSplitBranch(pageBoxes as Box[], actorQueue, snapshot);

        return {
            queuePreview,
            queueHandling: this.getAcceptedSplitQueueHandling(queuePreview)
        };
    }

    finalizeTailSplitFormation(
        pageBoxes: readonly Box[],
        actorQueue: PackagerUnit[],
        startIndex: number,
        replaceCount: number,
        predecessor: PackagerUnit,
        continuation: PackagerUnit | null | undefined,
        attempt: SplitAttempt,
        result: PackagerSplitResult,
        boxes: readonly Box[],
        state: SplitFragmentAftermathState,
        positionMarker: (marker: FlowBox, currentY: number, layoutBefore: number, availableWidth: number, pageIndex: number) => Box | Box[]
    ): TailSplitFormationOutcome {
        const snapshot = this.captureLocalBranchSnapshot(
            pageBoxes,
            actorQueue,
            state.currentY,
            state.lastSpacingAfter
        );
        const committed = this.acceptAndCommitSplitFragment(
            attempt,
            result,
            boxes,
            state,
            positionMarker
        );
        const preview = this.previewAcceptedSplitSettlement(
            pageBoxes,
            actorQueue,
            startIndex,
            replaceCount,
            predecessor,
            continuation,
            attempt,
            result,
            boxes,
            state,
            positionMarker
        );
        this.settleContinuationQueue(
            actorQueue,
            startIndex,
            replaceCount,
            predecessor,
            continuation
        );

        return {
            branchSnapshot: snapshot,
            committed,
            queuePreview: preview.queuePreview,
            queueHandling: preview.queueHandling
        };
    }

    settleTailSplitFormation(
        pages: Page[],
        currentPageBoxes: Box[],
        currentPageIndex: number,
        pageWidth: number,
        pageHeight: number,
        nextPageTopY: number,
        currentActorIndex: number,
        outcome: TailSplitFormationOutcome
    ): TailSplitFormationSettlementOutcome {
        currentPageBoxes.push(...outcome.committed.boxes);
        const advanced = this.advancePage(
            pages,
            currentPageBoxes,
            currentPageIndex,
            pageWidth,
            pageHeight,
            nextPageTopY
        );
        return {
            nextPageIndex: advanced.nextPageIndex,
            nextPageBoxes: advanced.nextPageBoxes,
            nextCurrentY: advanced.nextCurrentY,
            nextLastSpacingAfter: advanced.nextLastSpacingAfter,
            nextActorIndex: this.resolveNextActorIndex(currentActorIndex, outcome.queueHandling.shouldAdvanceIndex)
        };
    }

    settleTailSplitFailure(
        pages: Page[],
        currentPageBoxes: Box[],
        currentPageIndex: number,
        pageWidth: number,
        pageHeight: number,
        nextPageTop: number,
        currentActorIndex: number,
        actorQueue: PackagerUnit[],
        checkpoint: ReturnType<LayoutSession['captureLocalBranchSnapshot']>,
        shouldAdvancePage: boolean
    ): TailSplitFailureSettlementOutcome {
        const rolledBack = this.restoreLocalBranchSnapshot(currentPageBoxes, actorQueue, checkpoint);
        if (!shouldAdvancePage) {
            return {
                nextPageIndex: currentPageIndex,
                nextPageBoxes: currentPageBoxes,
                nextCurrentY: rolledBack.currentY,
                nextLastSpacingAfter: rolledBack.lastSpacingAfter,
                nextActorIndex: currentActorIndex
            };
        }

        const advanced = this.advancePage(
            pages,
            currentPageBoxes,
            currentPageIndex,
            pageWidth,
            pageHeight,
            nextPageTop
        );
        return {
            nextPageIndex: advanced.nextPageIndex,
            nextPageBoxes: advanced.nextPageBoxes,
            nextCurrentY: advanced.nextCurrentY,
            nextLastSpacingAfter: advanced.nextLastSpacingAfter,
            nextActorIndex: currentActorIndex
        };
    }

    executeTailSplitFormationBranch(
        pages: Page[],
        currentPageBoxes: Box[],
        currentPageIndex: number,
        pageWidth: number,
        pageHeight: number,
        nextPageTopY: number,
        currentActorIndex: number,
        actorQueue: PackagerUnit[],
        tailSplitExecution: {
            prefix: PackagerUnit[];
            splitCandidate: PackagerUnit;
            replaceCount: number;
            splitMarkerReserve: number;
        },
        state: {
            currentY: number;
            lastSpacingAfter: number;
            pageLimit: number;
            availableWidth: number;
        },
        contextBase: Omit<PackagerContext, 'pageIndex' | 'cursorY'>,
        shouldAdvancePageOnFailure: boolean,
        positionMarker: (
            marker: FlowBox,
            currentY: number,
            layoutBefore: number,
            availableWidth: number,
            pageIndex: number
        ) => Box | Box[]
    ): TailSplitFormationSettlementOutcome | TailSplitFailureSettlementOutcome {
        const { prefix, splitCandidate, replaceCount, splitMarkerReserve } = tailSplitExecution;
        const checkpoint = this.captureLocalBranchSnapshot(
            currentPageBoxes,
            actorQueue,
            state.currentY,
            state.lastSpacingAfter
        );

        const placedPrefix = this.placeActorSequence(prefix, {
            currentY: state.currentY,
            lastSpacingAfter: state.lastSpacingAfter,
            pageIndex: currentPageIndex,
            pageLimit: state.pageLimit,
            availableWidth: state.availableWidth
        }, contextBase);
        currentPageBoxes.push(...placedPrefix.boxes);

        const splitExecution = this.executePositionedSplitAttempt(
            splitCandidate,
            state.availableWidth,
            placedPrefix.currentY,
            placedPrefix.lastSpacingAfter,
            state.pageLimit,
            currentPageIndex,
            splitMarkerReserve,
            contextBase
        );
        const splitAttempt = splitExecution.execution.attempt;
        const { currentFragment: partA, continuationFragment: partB } = splitExecution.execution.result;

        if (partA && partB) {
            const partAContext = {
                ...contextBase,
                pageIndex: currentPageIndex,
                cursorY: placedPrefix.currentY
            };
            const partABoxes = partA.emitBoxes(
                state.availableWidth,
                splitExecution.emitAvailableHeight,
                partAContext
            ) || [];
            const outcome = this.finalizeTailSplitFormation(
                currentPageBoxes,
                actorQueue,
                currentActorIndex,
                replaceCount,
                splitCandidate,
                partB,
                splitAttempt,
                {
                    currentFragment: partA,
                    continuationFragment: partB
                },
                partABoxes,
                this.createSplitFragmentAftermathState(partA, {
                    currentY: placedPrefix.currentY,
                    layoutDelta: splitExecution.layoutDelta,
                    lastSpacingAfter: placedPrefix.lastSpacingAfter,
                    pageLimit: state.pageLimit,
                    availableWidth: state.availableWidth,
                    pageIndex: currentPageIndex
                }),
                positionMarker
            );
            return this.settleTailSplitFormation(
                pages,
                currentPageBoxes,
                currentPageIndex,
                pageWidth,
                pageHeight,
                nextPageTopY,
                currentActorIndex,
                outcome
            );
        }

        return this.settleTailSplitFailure(
            pages,
            currentPageBoxes,
            currentPageIndex,
            pageWidth,
            pageHeight,
            nextPageTopY,
            currentActorIndex,
            actorQueue,
            checkpoint,
            shouldAdvancePageOnFailure
        );
    }

    handleWholeFormationOverflowEntry(
        handling: WholeFormationOverflowHandling,
        pages: Page[],
        currentPageBoxes: Box[],
        currentPageIndex: number,
        pageWidth: number,
        pageHeight: number,
        nextPageTop: number
    ): WholeFormationOverflowEntryOutcome {
        if (handling.tailSplitExecution) {
            return {
                action: 'continue-tail-split',
                tailSplitExecution: handling.tailSplitExecution
            };
        }

        if (handling.fallbackHandling === 'advance-page') {
            const advanced = this.advancePage(
                pages,
                currentPageBoxes,
                currentPageIndex,
                pageWidth,
                pageHeight,
                nextPageTop
            );
            return {
                action: 'advance-page',
                nextPageIndex: advanced.nextPageIndex,
                nextPageBoxes: advanced.nextPageBoxes,
                nextCurrentY: advanced.nextCurrentY,
                nextLastSpacingAfter: advanced.nextLastSpacingAfter
            };
        }

        return { action: 'fallthrough-local-overflow' };
    }

    settleWholeFormationOverflowEntry(
        currentActorIndex: number,
        outcome: WholeFormationOverflowEntryOutcome
    ): WholeFormationOverflowEntrySettlementOutcome {
        if (outcome.action === 'advance-page') {
            return {
                action: 'advance-page',
                nextPageIndex: outcome.nextPageIndex,
                nextPageBoxes: outcome.nextPageBoxes,
                nextCurrentY: outcome.nextCurrentY,
                nextLastSpacingAfter: outcome.nextLastSpacingAfter,
                nextActorIndex: currentActorIndex
            };
        }

        if (outcome.action === 'continue-tail-split') {
            return outcome;
        }

        return outcome;
    }

    resolveWholeFormationOverflow(input: {
        currentActorIndex: number;
        handling: WholeFormationOverflowHandling | null;
        pages: Page[];
        currentPageBoxes: Box[];
        currentPageIndex: number;
        pageWidth: number;
        pageHeight: number;
        nextPageTop: number;
    }): WholeFormationOverflowResolution {
        if (!input.handling) {
            return {
                handling: null,
                fallbackOutcome: null,
                action: null,
                tailSplitExecution: null
            };
        }

        const settled = this.settleWholeFormationOverflowEntry(
            input.currentActorIndex,
            this.handleWholeFormationOverflowEntry(
                input.handling,
                input.pages,
                input.currentPageBoxes,
                input.currentPageIndex,
                input.pageWidth,
                input.pageHeight,
                input.nextPageTop
            )
        );
        const action = this.toPaginationLoopAction(settled);

        return {
            handling: input.handling,
            fallbackOutcome: input.handling.fallbackHandling ?? null,
            action,
            tailSplitExecution: action.action === 'continue-tail-split'
                ? action.tailSplitExecution
                : (input.handling.tailSplitExecution ?? null)
        };
    }

    resolveKeepWithNextOverflowAction(input: KeepWithNextOverflowActionInput): PaginationLoopAction | null {
        const overflowsCurrentPlacement = input.planning?.plan
            ? input.wholeFormationOverflow.handling !== null
            : ((input.effectiveHeight - input.marginBottom) > input.effectiveAvailableHeight);
        if (!overflowsCurrentPlacement) {
            return null;
        }

        if (input.planning?.plan && input.wholeFormationOverflow.tailSplitExecution) {
            const keepBranchStart = performance.now();
            const settlement = this.executeTailSplitFormationBranch(
                input.pages,
                input.currentPageBoxes,
                input.currentPageIndex,
                input.pageWidth,
                input.pageHeight,
                input.nextPageTopY,
                input.currentActorIndex,
                input.actorQueue,
                input.wholeFormationOverflow.tailSplitExecution,
                input.state,
                input.contextBase,
                input.planning.tailSplitFailureOutcome === 'advance-page',
                input.positionMarker
            );
            this.recordProfile('keepWithNextBranchCalls', 1);
            this.recordProfile('keepWithNextBranchMs', performance.now() - keepBranchStart);
            return this.toPaginationLoopAction(settlement);
        }

        if (input.wholeFormationOverflow.action?.action === 'continue-loop') {
            return input.wholeFormationOverflow.action;
        }

        return null;
    }

    toPaginationLoopAction(outcome: TailSplitFormationSettlementOutcome): PaginationLoopAction;
    toPaginationLoopAction(outcome: WholeFormationOverflowEntrySettlementOutcome): PaginationLoopAction;
    toPaginationLoopAction(outcome: ActorOverflowEntrySettlementOutcome): PaginationLoopAction;
    toPaginationLoopAction(outcome: ActorSplitFailureSettlementOutcome): PaginationLoopAction;
    toPaginationLoopAction(outcome: GenericSplitSuccessSettlementOutcome): PaginationLoopAction;
    toPaginationLoopAction(outcome: ActorPlacementSettlementOutcome): PaginationLoopAction;
    toPaginationLoopAction(outcome: DeferredSplitPlacementSettlementOutcome): PaginationLoopAction;
    toPaginationLoopAction(outcome: {
        action?: string;
        tailSplitExecution?: {
            prefix: PackagerUnit[];
            splitCandidate: PackagerUnit;
            replaceCount: number;
            splitMarkerReserve: number;
        };
        splitExecution?: SplitExecution;
        nextPageIndex?: number;
        nextPageBoxes?: Box[];
        nextCurrentY?: number;
        nextLastSpacingAfter?: number;
        nextActorIndex?: number;
    }, nextActorIndex?: number): PaginationLoopAction {
        if (outcome.action === 'continue-tail-split') {
            if (!outcome.tailSplitExecution) {
                throw new Error('continue-tail-split outcome missing tailSplitExecution');
            }
            return {
                action: 'continue-tail-split',
                tailSplitExecution: outcome.tailSplitExecution
            };
        }
        if (outcome.action === 'continue-to-split') {
            if (!outcome.splitExecution) {
                throw new Error('continue-to-split outcome missing splitExecution');
            }
            return {
                action: 'continue-to-split',
                splitExecution: outcome.splitExecution
            };
        }
        if (outcome.action === 'fallthrough-local-overflow') {
            return { action: 'fallthrough-local-overflow' };
        }
        if (
            outcome.nextPageIndex === undefined
            || outcome.nextPageBoxes === undefined
            || outcome.nextCurrentY === undefined
            || outcome.nextLastSpacingAfter === undefined
            || (nextActorIndex === undefined && outcome.nextActorIndex === undefined)
        ) {
            throw new Error('continue-loop outcome missing pagination state');
        }
        return this.createContinueLoopAction(
            {
                currentPageIndex: outcome.nextPageIndex,
                currentPageBoxes: outcome.nextPageBoxes,
                currentY: outcome.nextCurrentY,
                lastSpacingAfter: outcome.nextLastSpacingAfter
            },
            nextActorIndex ?? outcome.nextActorIndex!
        );
    }

    finalizeGenericAcceptedSplit(
        pageBoxes: readonly Box[],
        actorQueue: PackagerUnit[],
        startIndex: number,
        predecessor: PackagerUnit,
        continuation: PackagerUnit | null | undefined,
        attempt: SplitAttempt,
        result: PackagerSplitResult,
        boxes: readonly Box[],
        state: SplitFragmentAftermathState,
        positionMarker: (marker: FlowBox, currentY: number, layoutBefore: number, availableWidth: number, pageIndex: number) => Box | Box[]
    ): GenericSplitOutcome {
        const snapshot = this.captureLocalBranchSnapshot(
            pageBoxes,
            actorQueue,
            state.currentY,
            state.lastSpacingAfter
        );
        const committed = this.acceptAndCommitSplitFragment(
            attempt,
            result,
            boxes,
            state,
            positionMarker
        );

        const preview = this.previewAcceptedSplitSettlement(
            pageBoxes,
            actorQueue,
            startIndex,
            1,
            predecessor,
            continuation,
            attempt,
            result,
            boxes,
            state,
            positionMarker
        );
        this.settleContinuationQueue(
            actorQueue,
            startIndex,
            1,
            predecessor,
            continuation
        );

        return {
            branchSnapshot: snapshot,
            committed,
            queuePreview: preview.queuePreview,
            queueHandling: preview.queueHandling
        };
    }

    finalizeForcedOverflowCommit(
        actor: PackagerUnit,
        boxes: readonly Box[],
        state: FragmentCommitState
    ): ForcedOverflowCommitOutcome {
        return {
            committed: this.commitFragmentBoxes(actor, boxes, state),
            shouldAdvancePage: true
        };
    }

    handleActorOverflowPreSplit(
        outcome: 'force-commit-at-top' | 'advance-page-before-split',
        actor: PackagerUnit,
        boxes: readonly Box[] | null,
        state: FragmentCommitState
    ): ActorOverflowPreSplitHandlingOutcome {
        if (outcome === 'advance-page-before-split') {
            return {
                committed: null,
                shouldAdvancePage: true,
                shouldAdvanceIndex: false
            };
        }

        const forced = this.finalizeForcedOverflowCommit(actor, boxes ?? [], state);
        return {
            committed: forced.committed,
            shouldAdvancePage: forced.shouldAdvancePage,
            shouldAdvanceIndex: true
        };
    }

    handleActorOverflowSplitEntry(
        outcome: 'advance-page-for-top-split' | 'attempt-split-now',
        actor: PackagerUnit,
        availableWidth: number,
        availableHeight: number,
        context: PackagerContext
    ): ActorOverflowSplitEntryHandlingOutcome {
        if (outcome === 'advance-page-for-top-split') {
            return {
                splitExecution: null,
                shouldAdvancePage: true
            };
        }

        return {
            splitExecution: this.executeSplitAttempt(actor, availableWidth, availableHeight, context),
            shouldAdvancePage: false
        };
    }

    handleActorOverflowEntry(
        overflowHandling: ActorOverflowHandling,
        actor: PackagerUnit,
        boxes: readonly Box[] | null,
        state: FragmentCommitState,
        availableWidth: number,
        availableHeight: number,
        context: PackagerContext,
        currentY: number,
        lastSpacingAfter: number
    ): ActorOverflowEntryHandlingOutcome {
        if (overflowHandling.preSplitOutcome !== 'continue-to-split-phase') {
            const outcome = this.handleActorOverflowPreSplit(
                overflowHandling.preSplitOutcome,
                actor,
                boxes,
                state
            );
            return {
                action: 'handled',
                nextCurrentY: outcome.committed?.currentY ?? currentY,
                nextLastSpacingAfter: outcome.committed?.lastSpacingAfter ?? lastSpacingAfter,
                shouldAdvancePage: outcome.shouldAdvancePage,
                shouldAdvanceIndex: outcome.shouldAdvanceIndex
            };
        }

        const splitEntry = this.handleActorOverflowSplitEntry(
            overflowHandling.splitEntryOutcome!,
            actor,
            availableWidth,
            availableHeight,
            context
        );

        if (splitEntry.shouldAdvancePage || !splitEntry.splitExecution) {
            return {
                action: 'handled',
                nextCurrentY: currentY,
                nextLastSpacingAfter: lastSpacingAfter,
                shouldAdvancePage: true,
                shouldAdvanceIndex: false
            };
        }

        return {
            action: 'continue-to-split',
            splitExecution: splitEntry.splitExecution
        };
    }

    settleActorOverflowEntry(
        pages: Page[],
        currentPageBoxes: Box[],
        currentPageIndex: number,
        pageWidth: number,
        pageHeight: number,
        nextPageTopY: number,
        currentActorIndex: number,
        overflowEntry: ActorOverflowEntryHandlingOutcome
    ): ActorOverflowEntrySettlementOutcome {
        if (overflowEntry.action === 'continue-to-split') {
            return overflowEntry;
        }

        if (!overflowEntry.shouldAdvancePage) {
            return {
                action: 'handled',
                nextPageIndex: currentPageIndex,
                nextPageBoxes: currentPageBoxes,
                nextCurrentY: overflowEntry.nextCurrentY,
                nextLastSpacingAfter: overflowEntry.nextLastSpacingAfter,
                nextActorIndex: this.resolveNextActorIndex(currentActorIndex, overflowEntry.shouldAdvanceIndex)
            };
        }

        const advanced = this.advancePage(
            pages,
            currentPageBoxes,
            currentPageIndex,
            pageWidth,
            pageHeight,
            nextPageTopY
        );
        return {
            action: 'handled',
            nextPageIndex: advanced.nextPageIndex,
            nextPageBoxes: advanced.nextPageBoxes,
            nextCurrentY: advanced.nextCurrentY,
            nextLastSpacingAfter: advanced.nextLastSpacingAfter,
            nextActorIndex: this.resolveNextActorIndex(currentActorIndex, overflowEntry.shouldAdvanceIndex)
        };
    }

    resolveActorOverflow(input: {
        actor: PackagerUnit;
        isAtPageTop: boolean;
        effectiveAvailableHeight: number;
        availableWidth: number;
        availableHeightAdjusted: number;
        context: PackagerContext;
        contentHeight: number;
        marginTop: number;
        marginBottom: number;
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
        state: FragmentCommitState;
    }): ActorOverflowResolution {
        const overflowHandling = this.resolveActorOverflowHandling({
            actor: input.actor,
            isAtPageTop: input.isAtPageTop,
            effectiveAvailableHeight: input.effectiveAvailableHeight,
            availableWidth: input.availableWidth,
            availableHeightAdjusted: input.availableHeightAdjusted,
            context: input.context,
            contentHeight: input.contentHeight,
            marginTop: input.marginTop,
            marginBottom: input.marginBottom,
            pageLimit: input.pageLimit,
            pageTop: input.pageTop
        });
        const markerReserve = this.getSplitMarkerReserve(input.actor);
        const splitAvailableHeight = input.availableHeightAdjusted - markerReserve;
        const preSplitBoxes = overflowHandling.preSplitOutcome === 'force-commit-at-top'
            ? (input.actor.emitBoxes(input.availableWidth, input.availableHeightAdjusted, input.context) || [])
            : null;
        const overflowEntry = this.handleActorOverflowEntry(
            overflowHandling,
            input.actor,
            preSplitBoxes,
            input.state,
            input.availableWidth,
            splitAvailableHeight,
            input.context,
            input.currentY,
            input.lastSpacingAfter
        );

        if (overflowEntry.action === 'continue-to-split') {
            return {
                action: 'continue-to-split',
                splitExecution: overflowEntry.splitExecution
            };
        }

        const settlement = this.settleActorOverflowEntry(
            input.pages,
            input.currentPageBoxes,
            input.currentPageIndex,
            input.pageWidth,
            input.pageHeight,
            input.nextPageTopY,
            input.currentActorIndex,
            overflowEntry
        );
        if (settlement.action !== 'handled') {
            throw new Error('Expected handled overflow settlement.');
        }

        return {
            action: 'handled',
            loopAction: this.toPaginationLoopAction(settlement)
        };
    }

    resolveActorOverflowHandling(input: {
        actor: PackagerUnit;
        isAtPageTop: boolean;
        effectiveAvailableHeight: number;
        availableWidth: number;
        availableHeightAdjusted: number;
        context: PackagerContext;
        contentHeight: number;
        marginTop: number;
        marginBottom: number;
        pageLimit: number;
        pageTop: number;
    }): ActorOverflowHandling {
        const overflowIsUnbreakable = input.actor.isUnbreakable(input.effectiveAvailableHeight);
        const overflowPreviewBoxes = input.isAtPageTop
            ? true
            : !!input.actor.emitBoxes(input.availableWidth, input.availableHeightAdjusted, input.context);
        const isTablePackager = !!(input.actor as any).flowBox?.properties?._tableModel;
        const isStoryPackager = !!(input.actor as any).storyElement;
        const allowsMidPageSplit = isTablePackager || isStoryPackager;
        const emptyLayoutBefore = input.marginTop;
        const emptyAvailable = input.pageLimit - input.pageTop;
        const requiredOnEmpty = input.contentHeight + emptyLayoutBefore + input.marginBottom;

        return getActorOverflowHandling({
            isAtPageTop: input.isAtPageTop,
            isUnbreakable: overflowIsUnbreakable,
            hasPreviewBoxes: overflowPreviewBoxes,
            allowsMidPageSplit,
            overflowsEmptyPage: requiredOnEmpty > emptyAvailable + LAYOUT_DEFAULTS.wrapTolerance
        });
    }

    handleActorSplitFailure(
        actor: PackagerUnit,
        boxes: readonly Box[] | null,
        state: FragmentCommitState,
        isAtPageTop: boolean
    ): ActorSplitFailureHandlingOutcome {
        if (!isAtPageTop) {
            return {
                committed: null,
                shouldAdvancePage: true,
                shouldAdvanceIndex: false
            };
        }

        return {
            committed: this.commitFragmentBoxes(actor, boxes ?? [], state),
            shouldAdvancePage: true,
            shouldAdvanceIndex: true
        };
    }

    resolveActorSplitFailure(
        actor: PackagerUnit,
        boxes: readonly Box[] | null,
        state: FragmentCommitState,
        isAtPageTop: boolean,
        currentY: number,
        lastSpacingAfter: number
    ): ActorSplitFailureResolution {
        const outcome = this.handleActorSplitFailure(actor, boxes, state, isAtPageTop);
        return {
            nextCurrentY: outcome.committed?.currentY ?? currentY,
            nextLastSpacingAfter: outcome.committed?.lastSpacingAfter ?? lastSpacingAfter,
            shouldAdvancePage: outcome.shouldAdvancePage,
            shouldAdvanceIndex: outcome.shouldAdvanceIndex,
            committedBoxes: outcome.committed?.boxes ?? []
        };
    }

    settleActorSplitFailure(
        pages: Page[],
        currentPageBoxes: Box[],
        currentPageIndex: number,
        pageWidth: number,
        pageHeight: number,
        nextPageTopY: number,
        currentActorIndex: number,
        resolution: ActorSplitFailureResolution
    ): ActorSplitFailureSettlementOutcome {
        currentPageBoxes.push(...resolution.committedBoxes);

        if (!resolution.shouldAdvancePage) {
            return {
                nextPageIndex: currentPageIndex,
                nextPageBoxes: currentPageBoxes,
                nextCurrentY: resolution.nextCurrentY,
                nextLastSpacingAfter: resolution.nextLastSpacingAfter,
                nextActorIndex: this.resolveNextActorIndex(currentActorIndex, resolution.shouldAdvanceIndex)
            };
        }

        const advanced = this.advancePage(
            pages,
            currentPageBoxes,
            currentPageIndex,
            pageWidth,
            pageHeight,
            nextPageTopY
        );
        return {
            nextPageIndex: advanced.nextPageIndex,
            nextPageBoxes: advanced.nextPageBoxes,
            nextCurrentY: advanced.nextCurrentY,
            nextLastSpacingAfter: advanced.nextLastSpacingAfter,
            nextActorIndex: this.resolveNextActorIndex(currentActorIndex, resolution.shouldAdvanceIndex)
        };
    }

    resolveDeferredSplitPlacement(
        currentY: number,
        nextCursorY: number,
        layoutBefore: number,
        pageLimit: number,
        pageTop: number
    ): DeferredSplitPlacementOutcome {
        if (nextCursorY <= currentY + layoutBefore + LAYOUT_DEFAULTS.wrapTolerance) {
            return {
                shouldAdvancePage: true,
                nextCurrentY: currentY
            };
        }

        const nextCurrentY = Math.max(currentY, nextCursorY - layoutBefore);
        const remainingHeight = pageLimit - nextCurrentY;
        return {
            shouldAdvancePage: remainingHeight <= 0 && nextCurrentY > pageTop,
            nextCurrentY
        };
    }

    settleDeferredSplitPlacement(
        pages: Page[],
        currentPageBoxes: Box[],
        currentPageIndex: number,
        pageWidth: number,
        pageHeight: number,
        nextPageTopY: number,
        currentActorIndex: number,
        lastSpacingAfter: number,
        outcome: DeferredSplitPlacementOutcome
    ): DeferredSplitPlacementSettlementOutcome {
        if (!outcome.shouldAdvancePage) {
            return {
                nextPageIndex: currentPageIndex,
                nextPageBoxes: currentPageBoxes,
                nextCurrentY: outcome.nextCurrentY,
                nextLastSpacingAfter: lastSpacingAfter,
                nextActorIndex: currentActorIndex
            };
        }

        const advanced = this.advancePage(
            pages,
            currentPageBoxes,
            currentPageIndex,
            pageWidth,
            pageHeight,
            nextPageTopY
        );
        return {
            nextPageIndex: advanced.nextPageIndex,
            nextPageBoxes: advanced.nextPageBoxes,
            nextCurrentY: advanced.nextCurrentY,
            nextLastSpacingAfter: advanced.nextLastSpacingAfter,
            nextActorIndex: currentActorIndex
        };
    }

    handleGenericSplitSuccess(
        currentPageBoxes: readonly Box[],
        actorQueue: PackagerUnit[],
        startIndex: number,
        predecessor: PackagerUnit,
        continuation: PackagerUnit | null | undefined,
        attempt: SplitAttempt,
        result: PackagerSplitResult,
        currentFragment: PackagerUnit,
        currentBoxes: readonly Box[],
        state: SplitFragmentAftermathState,
        deferredSplitCursorY: number | null,
        layoutBefore: number,
        pageLimit: number,
        pageTop: number,
        positionMarker: (marker: FlowBox, currentY: number, layoutBefore: number, availableWidth: number, pageIndex: number) => Box | Box[]
    ): GenericSplitSuccessHandlingOutcome {
        if (deferredSplitCursorY !== null) {
            const deferred = this.resolveDeferredSplitPlacement(
                state.currentY,
                deferredSplitCursorY,
                layoutBefore,
                pageLimit,
                pageTop
            );
            return {
                nextCurrentY: deferred.nextCurrentY,
                nextLastSpacingAfter: state.lastSpacingAfter,
                shouldAdvancePage: deferred.shouldAdvancePage,
                shouldAdvanceIndex: false,
                committedBoxes: []
            };
        }

        const outcome = this.finalizeGenericAcceptedSplit(
            currentPageBoxes,
            actorQueue,
            startIndex,
            predecessor,
            continuation,
            attempt,
            result,
            currentBoxes,
            state,
            positionMarker
        );

        return {
            nextCurrentY: outcome.committed.currentY,
            nextLastSpacingAfter: outcome.committed.lastSpacingAfter,
            shouldAdvancePage: true,
            shouldAdvanceIndex: outcome.queueHandling.shouldAdvanceIndex,
            committedBoxes: outcome.committed.boxes
        };
    }

    settleGenericSplitSuccess(
        pages: Page[],
        currentPageBoxes: Box[],
        currentPageIndex: number,
        pageWidth: number,
        pageHeight: number,
        nextPageTopY: number,
        currentActorIndex: number,
        handling: GenericSplitSuccessHandlingOutcome
    ): GenericSplitSuccessSettlementOutcome {
        currentPageBoxes.push(...handling.committedBoxes);

        if (!handling.shouldAdvancePage) {
            return {
                nextPageIndex: currentPageIndex,
                nextPageBoxes: currentPageBoxes,
                nextCurrentY: handling.nextCurrentY,
                nextLastSpacingAfter: handling.nextLastSpacingAfter,
                nextActorIndex: this.resolveNextActorIndex(currentActorIndex, handling.shouldAdvanceIndex)
            };
        }

        const advanced = this.advancePage(
            pages,
            currentPageBoxes,
            currentPageIndex,
            pageWidth,
            pageHeight,
            nextPageTopY
        );
        return {
            nextPageIndex: advanced.nextPageIndex,
            nextPageBoxes: advanced.nextPageBoxes,
            nextCurrentY: advanced.nextCurrentY,
            nextLastSpacingAfter: advanced.nextLastSpacingAfter,
            nextActorIndex: this.resolveNextActorIndex(currentActorIndex, handling.shouldAdvanceIndex)
        };
    }

    executeGenericSplitBranch(
        pages: Page[],
        currentPageBoxes: Box[],
        currentPageIndex: number,
        pageWidth: number,
        pageHeight: number,
        nextPageTopY: number,
        currentActorIndex: number,
        actorQueue: PackagerUnit[],
        packager: PackagerUnit,
        splitExecution: SplitExecution,
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
        },
        contextBase: Omit<PackagerContext, 'pageIndex' | 'cursorY'>,
        resolveDeferredCursorY: (candidate: PackagerUnit) => number | null,
        positionMarker: (
            marker: FlowBox,
            currentY: number,
            layoutBefore: number,
            availableWidth: number,
            pageIndex: number
        ) => Box | Box[]
    ): ActorSplitFailureSettlementOutcome | DeferredSplitPlacementSettlementOutcome | GenericSplitSuccessSettlementOutcome {
        const { currentFragment: fitsCurrent, continuationFragment: pushedNext } = splitExecution.result;

        if (!fitsCurrent) {
            const boxes = state.currentY === state.pageTop
                ? (packager.emitBoxes(state.availableWidth, state.availableHeightAdjusted, {
                    ...contextBase,
                    pageIndex: currentPageIndex,
                    cursorY: state.currentY
                }) || [])
                : null;
            const outcome = this.resolveActorSplitFailure(
                packager,
                boxes,
                {
                    currentY: state.currentY,
                    layoutDelta: 0,
                    effectiveHeight: state.effectiveHeight,
                    marginBottom: state.marginBottom,
                    pageIndex: currentPageIndex
                },
                state.currentY === state.pageTop,
                state.currentY,
                state.lastSpacingAfter
            );
            return this.settleActorSplitFailure(
                pages,
                currentPageBoxes,
                currentPageIndex,
                pageWidth,
                pageHeight,
                nextPageTopY,
                currentActorIndex,
                outcome
            );
        }

        const splitContext: PackagerContext = {
            ...contextBase,
            pageIndex: currentPageIndex,
            cursorY: state.currentY
        };
        const fitsMarginBottom = fitsCurrent.getMarginBottom();
        const fitsMarginTop = fitsCurrent.getMarginTop();
        const fitsLayoutBefore = state.lastSpacingAfter + fitsMarginTop;
        const fitsLayoutDelta = fitsLayoutBefore - fitsMarginTop;
        const deferredSplitCursorY = resolveDeferredCursorY(fitsCurrent);
        if (deferredSplitCursorY !== null) {
            const outcome = this.resolveDeferredSplitPlacement(
                state.currentY,
                deferredSplitCursorY,
                fitsLayoutBefore,
                state.pageLimit,
                state.pageTop
            );
            return this.settleDeferredSplitPlacement(
                pages,
                currentPageBoxes,
                currentPageIndex,
                pageWidth,
                pageHeight,
                nextPageTopY,
                currentActorIndex,
                state.lastSpacingAfter,
                outcome
            );
        }

        const fitsAvailableHeightAdjusted = (state.pageLimit - state.currentY) - fitsLayoutDelta;
        const currentBoxes = fitsCurrent.emitBoxes(state.availableWidth, fitsAvailableHeightAdjusted, splitContext) || [];
        const handling = this.handleGenericSplitSuccess(
            currentPageBoxes,
            actorQueue,
            currentActorIndex,
            packager,
            pushedNext,
            splitExecution.attempt,
            splitExecution.result,
            fitsCurrent,
            currentBoxes,
            this.createSplitFragmentAftermathState(fitsCurrent, {
                currentY: state.currentY,
                layoutDelta: fitsLayoutDelta,
                lastSpacingAfter: state.lastSpacingAfter,
                pageLimit: state.pageLimit,
                availableWidth: state.availableWidth,
                pageIndex: currentPageIndex
            }),
            deferredSplitCursorY,
            fitsLayoutBefore,
            state.pageLimit,
            state.pageTop,
            positionMarker
        );
        return this.settleGenericSplitSuccess(
            pages,
            currentPageBoxes,
            currentPageIndex,
            pageWidth,
            pageHeight,
            nextPageTopY,
            currentActorIndex,
            handling
        );
    }

    resolveGenericSplitAction(input: GenericSplitActionInput): PaginationLoopAction {
        return this.toPaginationLoopAction(
            this.executeGenericSplitBranch(
                input.pages,
                input.currentPageBoxes,
                input.currentPageIndex,
                input.pageWidth,
                input.pageHeight,
                input.nextPageTopY,
                input.currentActorIndex,
                input.actorQueue,
                input.packager,
                input.splitExecution,
                input.state,
                input.contextBase,
                input.resolveDeferredCursorY,
                input.positionMarker
            )
        );
    }

    resolveDeferredActorPlacement(
        actor: PackagerUnit,
        placementFrame: ResolvedPlacementFrame,
        constraintField: ConstraintField,
        currentY: number,
        layoutBefore: number,
        pageLimit: number,
        pageTop: number,
        context: PackagerContext
    ): DeferredSplitPlacementOutcome | null {
        if (!placementFrame.contentBand) {
            return null;
        }

        const placementPreference = resolvePackagerPlacementPreference(
            actor,
            constraintField.availableWidth,
            context
        );
        const minimumPlacementWidth = placementPreference?.minimumWidth;
        if (
            minimumPlacementWidth !== null &&
            minimumPlacementWidth !== undefined &&
            placementFrame.availableWidth + LAYOUT_DEFAULTS.wrapTolerance < minimumPlacementWidth
        ) {
            return this.resolveDeferredSplitPlacement(
                currentY,
                placementFrame.activeBand?.bottom ?? placementFrame.cursorY,
                layoutBefore,
                pageLimit,
                pageTop
            );
        }

        if (
            rejectsPlacementFrame(
                actor,
                placementFrame.availableWidth,
                constraintField.availableWidth,
                context
            )
        ) {
            return this.resolveDeferredSplitPlacement(
                currentY,
                placementFrame.activeBand?.bottom ?? placementFrame.cursorY,
                layoutBefore,
                pageLimit,
                pageTop
            );
        }

        return null;
    }

    finalizeActorPlacementCommit(
        actor: PackagerUnit,
        boxes: readonly Box[],
        state: FragmentCommitState,
        constraintField: ConstraintField,
        layoutBefore: number,
        pageLimit: number,
        pageTop: number
    ): ActorPlacementCommitOutcome {
        const hasLaneConstraint = !!constraintField.resolveActiveContentBand(state.currentY + layoutBefore);
        if (hasLaneConstraint) {
            const absoluteBoxes = boxes.map((box) => ({
                ...box,
                y: (box.y || 0) + state.currentY + state.layoutDelta
            }));
            const placementDecision = constraintField.evaluatePlacement(absoluteBoxes, state.currentY + layoutBefore);
            if (placementDecision.action === 'defer') {
                const nextCurrentY = Math.max(state.currentY, placementDecision.nextCursorY - layoutBefore);
                return {
                    action: 'defer',
                    nextCurrentY,
                    shouldAdvancePage: (pageLimit - nextCurrentY) <= 0 && nextCurrentY > pageTop
                };
            }
        }

        return {
            action: 'commit',
            committed: this.commitFragmentBoxes(actor, boxes, state)
        };
    }

    executeActorPlacement(
        actor: PackagerUnit,
        availableWidth: number,
        availableHeight: number,
        context: PackagerContext,
        state: FragmentCommitState,
        constraintField: ConstraintField,
        layoutBefore: number,
        pageLimit: number,
        pageTop: number
    ): ActorPlacementExecutionOutcome {
        const boxes = actor.emitBoxes(availableWidth, availableHeight, context);
        if (!boxes) {
            return { action: 'retry-next-page' };
        }

        return this.finalizeActorPlacementCommit(
            actor,
            boxes,
            state,
            constraintField,
            layoutBefore,
            pageLimit,
            pageTop
        );
    }

    attemptActorPlacement(
        actor: PackagerUnit,
        placementFrame: ResolvedPlacementFrame,
        availableWidth: number,
        availableHeight: number,
        context: PackagerContext,
        state: FragmentCommitState,
        constraintField: ConstraintField,
        layoutBefore: number,
        pageLimit: number,
        pageTop: number
    ): ActorPlacementAttemptOutcome {
        const deferred = this.resolveDeferredActorPlacement(
            actor,
            placementFrame,
            constraintField,
            state.currentY,
            layoutBefore,
            pageLimit,
            pageTop,
            context
        );
        if (deferred) {
            return {
                action: 'defer',
                nextCurrentY: deferred.nextCurrentY,
                shouldAdvancePage: deferred.shouldAdvancePage
            };
        }

        return this.executeActorPlacement(
            actor,
            availableWidth,
            availableHeight,
            context,
            state,
            constraintField,
            layoutBefore,
            pageLimit,
            pageTop
        );
    }

    handleActorPlacementAttempt(
        currentPageBoxes: Box[],
        outcome: ActorPlacementAttemptOutcome,
        currentY: number,
        lastSpacingAfter: number
    ): ActorPlacementHandlingOutcome {
        if (outcome.action === 'retry-next-page') {
            return {
                nextCurrentY: currentY,
                nextLastSpacingAfter: lastSpacingAfter,
                shouldAdvancePage: true,
                shouldAdvanceIndex: false
            };
        }

        if (outcome.action === 'defer') {
            return {
                nextCurrentY: outcome.nextCurrentY,
                nextLastSpacingAfter: lastSpacingAfter,
                shouldAdvancePage: outcome.shouldAdvancePage,
                shouldAdvanceIndex: false
            };
        }

        currentPageBoxes.push(...outcome.committed.boxes);
        return {
            nextCurrentY: outcome.committed.currentY,
            nextLastSpacingAfter: outcome.committed.lastSpacingAfter,
            shouldAdvancePage: false,
            shouldAdvanceIndex: true
        };
    }

    settleActorPlacementAttempt(
        pages: Page[],
        currentPageBoxes: Box[],
        currentPageIndex: number,
        pageWidth: number,
        pageHeight: number,
        nextPageTopY: number,
        currentActorIndex: number,
        outcome: ActorPlacementAttemptOutcome,
        currentY: number,
        lastSpacingAfter: number
    ): ActorPlacementSettlementOutcome {
        const handling = this.handleActorPlacementAttempt(
            currentPageBoxes,
            outcome,
            currentY,
            lastSpacingAfter
        );

        if (!handling.shouldAdvancePage) {
            return {
                nextPageIndex: currentPageIndex,
                nextPageBoxes: currentPageBoxes,
                nextCurrentY: handling.nextCurrentY,
                nextLastSpacingAfter: handling.nextLastSpacingAfter,
                nextActorIndex: this.resolveNextActorIndex(currentActorIndex, handling.shouldAdvanceIndex)
            };
        }

        const advanced = this.advancePage(
            pages,
            currentPageBoxes,
            currentPageIndex,
            pageWidth,
            pageHeight,
            nextPageTopY
        );
        return {
            nextPageIndex: advanced.nextPageIndex,
            nextPageBoxes: advanced.nextPageBoxes,
            nextCurrentY: advanced.nextCurrentY,
            nextLastSpacingAfter: advanced.nextLastSpacingAfter,
            nextActorIndex: this.resolveNextActorIndex(currentActorIndex, handling.shouldAdvanceIndex)
        };
    }

    resolveActorPlacementAction(input: ActorPlacementActionInput): PaginationLoopAction {
        return this.toPaginationLoopAction(
            this.settleActorPlacementAttempt(
                input.pages,
                input.currentPageBoxes,
                input.currentPageIndex,
                input.pageWidth,
                input.pageHeight,
                input.nextPageTopY,
                input.currentActorIndex,
                this.attemptActorPlacement(
                    input.actor,
                    input.placementFrame,
                    input.availableWidth,
                    input.availableHeight,
                    input.context,
                    input.state,
                    input.constraintField,
                    input.layoutBefore,
                    input.pageLimit,
                    input.pageTop
                ),
                input.currentY,
                input.lastSpacingAfter
            )
        );
    }

    setKeepWithNextPlan(actorId: string, plan: KeepWithNextFormationPlan): void {
        this.keepWithNextPlans.set(actorId, plan);
    }

    getKeepWithNextPlan(actorId: string): KeepWithNextFormationPlan | undefined {
        return this.keepWithNextPlans.get(actorId);
    }

    resolveKeepWithNextOverflow(
        input: {
            actorId: string;
            isAtPageTop: boolean;
            actorQueue: PackagerUnit[];
            actorIndex: number;
            paginationState: PaginationState;
            availableWidth: number;
            availableHeight: number;
            lastSpacingAfter: number;
            context: PackagerContext;
        }
    ): KeepWithNextPlanningResolution | null {
        const plan = this.getKeepWithNextPlan(input.actorId) ?? computeKeepWithNextPlan({
            actorQueue: input.actorQueue,
            actorIndex: input.actorIndex,
            paginationState: input.paginationState,
            availableWidth: input.availableWidth,
            availableHeight: input.availableHeight,
            lastSpacingAfter: input.lastSpacingAfter,
            isAtPageTop: input.isAtPageTop,
            context: input.context
        });
        if (!plan) return null;

        const handling = getWholeFormationOverflowHandling(plan, input.isAtPageTop);
        return {
            plan,
            handling,
            tailSplitSuccessOutcome: getTailSplitPostAttemptOutcome(plan, true, input.isAtPageTop),
            tailSplitFailureOutcome: getTailSplitPostAttemptOutcome(plan, false, input.isAtPageTop)
        };
    }

    setPaginationLoopState(state: PaginationLoopState): void {
        this.paginationLoopState = state;
    }

    getPaginationLoopState(): PaginationLoopState | null {
        return this.paginationLoopState;
    }

    getRegisteredActors(): readonly PackagerUnit[] {
        return this.kernel.actorRegistry;
    }

    getFragmentTransitions(): readonly FragmentTransition[] {
        return this.kernel.getFragmentTransitions();
    }

    getFragmentTransition(actorId: string): FragmentTransition | undefined {
        return this.kernel.getFragmentTransition(actorId);
    }

    getFragmentTransitionsBySource(sourceActorId: string): readonly FragmentTransition[] {
        return this.kernel.getFragmentTransitionsBySource(sourceActorId);
    }

    getFragmentTransitionSourceIds(): readonly string[] {
        return this.kernel.getFragmentTransitionSourceIds();
    }

    measurePreparedActor(
        actor: PackagerUnit,
        availableWidth: number,
        availableHeight: number,
        layoutBefore: number,
        context: PackagerContext
    ): ActorMeasurement {
        preparePackagerForPhase(actor, 'commit', availableWidth, availableHeight, context);
        this.notifyActorPrepared(actor);

        const marginTop = actor.getMarginTop();
        const marginBottom = actor.getMarginBottom();
        const contentHeight = Math.max(0, actor.getRequiredHeight() - marginTop - marginBottom);
        const requiredHeight = contentHeight + layoutBefore + marginBottom;

        return {
            marginTop,
            marginBottom,
            contentHeight,
            requiredHeight,
            effectiveHeight: Math.max(requiredHeight, LAYOUT_DEFAULTS.minEffectiveHeight)
        };
    }

    recordProfile(metric: keyof LayoutProfileMetrics, delta: number): void {
        const value = Number.isFinite(delta) ? Number(delta) : 0;
        if (typeof this.profile[metric] === 'number') {
            (this.profile[metric] as number) += value;
        }
    }

    recordKeepWithNextPrepare(actorKind: string, durationMs: number): void {
        const normalizedKind = actorKind || 'unknown';
        const entry = this.profile.keepWithNextPrepareByKind[normalizedKind] ?? { calls: 0, ms: 0 };
        entry.calls += 1;
        entry.ms += Number.isFinite(durationMs) ? Number(durationMs) : 0;
        this.profile.keepWithNextPrepareByKind[normalizedKind] = entry;
    }

    private resolveContinuationArtifacts(actor: PackagerUnit): ContinuationArtifacts | undefined {
        const flowBox = (actor as any).flowBox as FlowBox | undefined;
        if (!flowBox) return undefined;

        const continuationSpec =
            flowBox.properties?.paginationContinuation ??
            flowBox._sourceElement?.properties?.paginationContinuation;
        if (!continuationSpec) return undefined;

        if (flowBox.properties && flowBox.properties.paginationContinuation === undefined) {
            flowBox.properties.paginationContinuation = continuationSpec;
        }

        return ((actor as any).processor as any)?.getContinuationArtifacts?.(flowBox) as ContinuationArtifacts | undefined;
    }
}
