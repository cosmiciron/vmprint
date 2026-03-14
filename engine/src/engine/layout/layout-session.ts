import { performance } from 'node:perf_hooks';
import type { Box, Page, PageRegionContent, PageReservationSelector } from '../types';
import type { EngineRuntime } from '../runtime';
import type { ContinuationArtifacts, FlowBox } from './layout-core-types';
import { getActorOverflowHandling, type ActorOverflowHandling } from './actor-overflow';
import type { PackagerUnit } from './packagers/packager-types';
import type { KeepWithNextFormationPlan, WholeFormationOverflowHandling } from './actor-formation';
import type { ObservationResult, PackagerContext, SpatialFrontier } from './packagers/packager-types';
import type { PackagerSplitResult } from './packagers/packager-types';
import { getTailSplitPostAttemptOutcome } from './actor-formation';
import { AIRuntime } from './ai-runtime';
import { ActorEventBus, type ActorEventBusSnapshot, type ActorSignal, type ActorSignalDraft } from './actor-event-bus';
import { LAYOUT_DEFAULTS } from './defaults';
import { EventDispatcher } from './event-dispatcher';
import { Kernel } from './kernel';
import { CollisionRuntime } from './collision-runtime';
import { LifecycleRuntime } from './lifecycle-runtime';
import { PhysicsRuntime } from './physics-runtime';
import { TransitionsRuntime } from './transitions-runtime';
import type {
    SimulationArtifactKey,
    SimulationArtifactMap,
    SimulationArtifacts,
    SimulationReport,
    SimulationReportReader
} from './simulation-report';
import { SimulationReportBridge } from './simulation-report-bridge';

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
    observerCheckpointSweepCalls: number;
    observerSettleCalls: number;
    observerActorBoundarySettles: number;
    observerPageBoundarySettles: number;
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

export type LocalActorSignalSnapshot = ActorEventBusSnapshot;

export type LocalBranchStateSnapshot = LocalQueueSnapshot & LocalSplitStateSnapshot & LocalActorSignalSnapshot;

export type LocalBranchSnapshot = LocalTransitionSnapshot & LocalQueueSnapshot & LocalSplitStateSnapshot & LocalActorSignalSnapshot;

export type SafeCheckpointSnapshot = LocalTransitionSnapshot & LocalQueueSnapshot & LocalSplitStateSnapshot;
export type SafeCheckpointPageState = {
    pageBoxes: Box[];
};

export type SafeCheckpoint = {
    id: string;
    snapshotToken: string;
    kind: 'page' | 'actor';
    pageIndex: number;
    actorIndex: number;
    frontier: SpatialFrontier;
    pagesPrefix: Page[];
    snapshot: SafeCheckpointSnapshot & SafeCheckpointPageState;
};

export type ObserverSweepResult = {
    changed: boolean;
    geometryChanged: boolean;
    earliestAffectedFrontier?: SpatialFrontier;
};

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
    readonly eventDispatcher: EventDispatcher;
    readonly kernel = new Kernel();
    readonly actorEventBus = new ActorEventBus();
    readonly aiRuntime: AIRuntime;
    readonly lifecycleRuntime: LifecycleRuntime;
    readonly collisionRuntime: CollisionRuntime;
    readonly physicsRuntime: PhysicsRuntime;
    readonly simulationReportBridge: SimulationReportBridge;
    readonly transitionsRuntime: TransitionsRuntime;
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
        exclusionLaneApplications: 0,
        observerCheckpointSweepCalls: 0,
        observerSettleCalls: 0,
        observerActorBoundarySettles: 0,
        observerPageBoundarySettles: 0
    };
    private paginationLoopState: PaginationLoopState | null = null;
    private readonly observerRegistry = new Map<string, PackagerUnit>();
    private readonly actorIndexByActorId = new Map<string, number>();
    private readonly actorIndexBySourceId = new Map<string, number>();
    private safeCheckpoints: SafeCheckpoint[] = [];
    private safeCheckpointSequence = 0;

    currentPageIndex = 0;
    currentY = 0;
    currentConstraintField: ConstraintField | null = null;
    currentSurface: PageSurface | null = null;

    constructor(options: LayoutSessionOptions) {
        this.runtime = options.runtime;
        this.collaborators = options.collaborators ?? [];
        this.eventDispatcher = new EventDispatcher(this.collaborators);
        this.aiRuntime = new AIRuntime(this);
        this.lifecycleRuntime = new LifecycleRuntime(this);
        this.collisionRuntime = new CollisionRuntime(this);
        this.physicsRuntime = new PhysicsRuntime(this);
        this.simulationReportBridge = new SimulationReportBridge(this);
        this.transitionsRuntime = new TransitionsRuntime(this);
    }

    notifySimulationStart(): void {
        this.kernel.resetForSimulation();
        this.actorEventBus.resetForSimulation();
        this.lifecycleRuntime.resetForSimulation();
        this.observerRegistry.clear();
        this.actorIndexByActorId.clear();
        this.actorIndexBySourceId.clear();
        this.safeCheckpoints = [];
        this.safeCheckpointSequence = 0;
        this.eventDispatcher.onSimulationStart(this);
    }

    publishActorSignal(signal: ActorSignalDraft): ActorSignal {
        return this.actorEventBus.publish(signal);
    }

    getActorSignals(topic?: string): readonly ActorSignal[] {
        return this.actorEventBus.read(topic);
    }

    notifyActorSpawn(actor: PackagerUnit): void {
        this.kernel.registerActor(actor);
        if (typeof actor.observeCommittedSignals === 'function') {
            this.observerRegistry.set(actor.actorId, actor);
        }
        this.eventDispatcher.onActorSpawn(actor, this);
    }

    notifyPageStart(pageIndex: number, width: number, height: number, boxes: Box[]): void {
        this.currentPageIndex = pageIndex;
        this.currentSurface = new PageSurface(pageIndex, width, height, boxes);
        this.kernel.beginPage();
        this.eventDispatcher.onPageStart(pageIndex, this.currentSurface, this);
    }

    advancePage(
        pages: Page[],
        currentPageBoxes: Box[],
        currentPageIndex: number,
        pageWidth: number,
        pageHeight: number,
        nextPageTopY: number
    ): PageAdvanceOutcome {
        return this.lifecycleRuntime.advancePage(
            pages,
            currentPageBoxes,
            currentPageIndex,
            pageWidth,
            pageHeight,
            nextPageTopY
        );
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
        this.eventDispatcher.onConstraintNegotiation(actor, constraints, this);
    }

    notifyActorPrepared(actor: PackagerUnit): void {
        this.eventDispatcher.onActorPrepared(actor, this);
    }

    notifySplitAttempt(attempt: SplitAttempt): void {
        this.eventDispatcher.onSplitAttempt(attempt, this);
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
        this.eventDispatcher.onSplitAccepted(attempt, result, this);
    }

    notifyActorCommitted(actor: PackagerUnit, committed: Box[]): void {
        if (!this.currentSurface) return;
        this.eventDispatcher.onActorCommitted(actor, committed, this.currentSurface, this);
    }

    notifyContinuationProduced(predecessor: PackagerUnit, successor: PackagerUnit): void {
        this.kernel.markContinuationProduced(successor);
        this.eventDispatcher.onContinuationProduced(predecessor, successor, this);
    }

    notifyContinuationEnqueued(predecessor: PackagerUnit, successor: PackagerUnit): void {
        this.kernel.markContinuationEnqueued(predecessor, successor);
        this.eventDispatcher.onContinuationEnqueued(predecessor, successor, this);
    }

    finalizeCommittedPage(pageIndex: number, width: number, height: number, boxes: readonly Box[]): Page {
        const surface = new PageSurface(pageIndex, width, height, [...boxes]);
        this.eventDispatcher.onPageFinalized(surface, this);
        return surface.finalize();
    }

    closePagination(
        pages: Page[],
        currentPageBoxes: readonly Box[],
        currentPageIndex: number,
        pageWidth: number,
        pageHeight: number
    ): void {
        this.lifecycleRuntime.closePagination(
            pages,
            currentPageBoxes,
            currentPageIndex,
            pageWidth,
            pageHeight
        );
    }

    recordSafeCheckpoint(
        actorQueue: readonly PackagerUnit[],
        actorIndex: number,
        pagesPrefix: readonly Page[],
        currentPageBoxes: readonly Box[],
        currentPageIndex: number,
        currentY: number,
        lastSpacingAfter: number,
        kind: 'page' | 'actor'
    ): SafeCheckpoint {
        const checkpoint: SafeCheckpoint = {
            id: `checkpoint:${++this.safeCheckpointSequence}`,
            snapshotToken: `checkpoint:${this.safeCheckpointSequence}`,
            kind,
            pageIndex: currentPageIndex,
            actorIndex,
            frontier: {
                pageIndex: currentPageIndex,
                actorIndex
            },
            pagesPrefix: pagesPrefix.map((page) => ({
                ...page,
                boxes: page.boxes.map((box) => ({
                    ...box,
                    properties: box.properties ? { ...box.properties } : box.properties,
                    meta: box.meta ? { ...box.meta } : box.meta
                }))
            })),
            snapshot: {
                pageBoxes: currentPageBoxes.map((box) => ({
                    ...box,
                    properties: box.properties ? { ...box.properties } : box.properties,
                    meta: box.meta ? { ...box.meta } : box.meta
                })),
                ...this.captureLocalTransitionSnapshot(currentPageBoxes, currentY, lastSpacingAfter),
                ...this.kernel.captureLocalBranchStateSnapshot(actorQueue)
            }
        };

        const existingIndex = this.safeCheckpoints.findIndex((entry) =>
            entry.pageIndex === currentPageIndex
            && entry.actorIndex === actorIndex
            && entry.kind === kind
        );
        if (existingIndex >= 0) {
            this.safeCheckpoints.splice(existingIndex, 1, checkpoint);
        } else {
            this.safeCheckpoints.push(checkpoint);
            this.safeCheckpoints.sort((a, b) => {
                if (a.pageIndex !== b.pageIndex) return a.pageIndex - b.pageIndex;
                if (a.actorIndex !== b.actorIndex) return a.actorIndex - b.actorIndex;
                return a.id.localeCompare(b.id);
            });
        }

        return checkpoint;
    }

    evaluateObserverRegistry(
        contextBase: Omit<PackagerContext, 'pageIndex' | 'cursorY'>,
        pageIndex: number,
        cursorY: number
    ): ObserverSweepResult {
        this.recordProfile('observerCheckpointSweepCalls', 1);
        let changed = false;
        let geometryChanged = false;
        let earliestAffectedFrontier: SpatialFrontier | undefined;

        const context: PackagerContext = {
            ...contextBase,
            pageIndex,
            cursorY
        };

        for (const observer of this.observerRegistry.values()) {
            const result = observer.observeCommittedSignals?.(context);
            if (!result || !result.changed) continue;
            changed = true;
            if (!result.geometryChanged) continue;
            geometryChanged = true;
            if (
                result.earliestAffectedFrontier
                && (
                    !earliestAffectedFrontier
                    || result.earliestAffectedFrontier.pageIndex < earliestAffectedFrontier.pageIndex
                )
            ) {
                earliestAffectedFrontier = result.earliestAffectedFrontier;
            }
        }

        return {
            changed,
            geometryChanged,
            earliestAffectedFrontier
        };
    }

    resolveSafeCheckpoint(frontier: SpatialFrontier): SafeCheckpoint | null {
        const frontierActorIndex =
            frontier.actorIndex
            ?? (frontier.sourceId ? this.actorIndexBySourceId.get(frontier.sourceId) : undefined)
            ?? (frontier.actorId ? this.actorIndexByActorId.get(frontier.actorId) : undefined)
            ?? Number.POSITIVE_INFINITY;
        const candidates = this.safeCheckpoints
            .filter((checkpoint) =>
                checkpoint.pageIndex < frontier.pageIndex
                || (checkpoint.pageIndex === frontier.pageIndex && checkpoint.actorIndex <= frontierActorIndex)
            )
            .sort((a, b) => {
                if (a.pageIndex !== b.pageIndex) return b.pageIndex - a.pageIndex;
                if (a.actorIndex !== b.actorIndex) return b.actorIndex - a.actorIndex;
                return b.id.localeCompare(a.id);
            });
        return candidates[0] ?? null;
    }

    restoreSafeCheckpoint(
        pages: Page[],
        actorQueue: PackagerUnit[],
        checkpoint: SafeCheckpoint
    ): { currentPageBoxes: Box[]; currentY: number; lastSpacingAfter: number } {
        pages.splice(0, pages.length, ...checkpoint.pagesPrefix.map((page) => ({
            ...page,
            boxes: page.boxes.map((box) => ({
                ...box,
                properties: box.properties ? { ...box.properties } : box.properties,
                meta: box.meta ? { ...box.meta } : box.meta
            }))
        })));

        this.kernel.restoreLocalBranchStateSnapshot(actorQueue, checkpoint.snapshot);
        const currentPageBoxes: Box[] = checkpoint.snapshot.pageBoxes.map((box) => ({
            ...box,
            properties: box.properties ? { ...box.properties } : box.properties,
            meta: box.meta ? { ...box.meta } : box.meta
        }));
        return {
            currentPageBoxes,
            currentY: checkpoint.snapshot.currentY,
            lastSpacingAfter: checkpoint.snapshot.lastSpacingAfter
        };
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
        return this.lifecycleRuntime.restartCurrentActorOnNextPage(
            pages,
            currentPageBoxes,
            currentPageIndex,
            pageWidth,
            pageHeight,
            nextPageTopY,
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
        return this.physicsRuntime.preparePaginationPlacement(input);
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
        this.lifecycleRuntime.setFinalizedPages(pages);
        return this.simulationReportBridge.finalizePages(pages);
    }

    onSimulationComplete(): void {
        this.eventDispatcher.onSimulationComplete(this);
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
        return this.simulationReportBridge.buildSimulationArtifacts();
    }

    getFinalizedPages(): readonly Page[] {
        return this.lifecycleRuntime.getFinalizedPages();
    }

    recordPageFinalization(state: PageFinalizationState): void {
        this.lifecycleRuntime.recordPageFinalization(state);
    }

    resetLogicalPageNumbering(startAt: number): void {
        this.lifecycleRuntime.resetLogicalPageNumbering(startAt);
    }

    allocateLogicalPageNumber(usesLogicalNumbering: boolean): number | null {
        return this.lifecycleRuntime.allocateLogicalPageNumber(usesLogicalNumbering);
    }

    getPageFinalizationState(pageIndex: number): PageFinalizationState | undefined {
        return this.lifecycleRuntime.getPageFinalizationState(pageIndex);
    }

    getPageFinalizationStates(): readonly PageFinalizationState[] {
        return this.lifecycleRuntime.getPageFinalizationStates();
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
        return this.simulationReportBridge.buildSimulationReport();
    }

    setSimulationReport(report: SimulationReport): void {
        this.simulationReportBridge.setSimulationReport(report);
    }

    getSimulationReport(): SimulationReport | undefined {
        return this.simulationReportBridge.getSimulationReport();
    }

    getSimulationReportReader(): SimulationReportReader {
        return this.simulationReportBridge.getSimulationReportReader();
    }

    getProfileSnapshot(): LayoutProfileMetrics {
        return this.profile;
    }

    getPublishedArtifacts(): ReadonlyMap<string, unknown> {
        return this.kernel.getPublishedArtifacts();
    }

    setContinuationArtifacts(actorId: string, artifacts: ContinuationArtifacts): void {
        this.kernel.setContinuationArtifacts(actorId, artifacts);
    }

    getContinuationArtifacts(actorId: string): ContinuationArtifacts | undefined {
        return this.kernel.getContinuationArtifacts(actorId);
    }

    ensureContinuationArtifacts(actor: PackagerUnit): ContinuationArtifacts | undefined {
        return this.transitionsRuntime.ensureContinuationArtifacts(actor);
    }

    getSplitMarkerReserve(actor: PackagerUnit): number {
        return this.transitionsRuntime.getSplitMarkerReserve(actor);
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
            ...this.kernel.captureLocalBranchStateSnapshot(actorQueue),
            ...this.captureLocalActorSignalSnapshot()
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

    captureLocalActorSignalSnapshot(): LocalActorSignalSnapshot {
        return this.actorEventBus.captureSnapshot();
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
        this.actorEventBus.restoreSnapshot(snapshot);
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
        return this.transitionsRuntime.getAcceptedSplitQueueHandling(preview);
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
        return this.transitionsRuntime.previewAcceptedSplitSettlement(
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
        return this.transitionsRuntime.finalizeTailSplitFormation(
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
        return this.transitionsRuntime.settleTailSplitFormation(
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
        return this.transitionsRuntime.settleTailSplitFailure(
            pages,
            currentPageBoxes,
            currentPageIndex,
            pageWidth,
            pageHeight,
            nextPageTop,
            currentActorIndex,
            actorQueue,
            checkpoint,
            shouldAdvancePage
        );
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
        return this.transitionsRuntime.executeTailSplitFormationBranch(
            pages,
            currentPageBoxes,
            currentPageIndex,
            pageWidth,
            pageHeight,
            nextPageTopY,
            currentActorIndex,
            actorQueue,
            tailSplitExecution,
            state,
            contextBase,
            shouldAdvancePageOnFailure,
            positionMarker
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
        return this.aiRuntime.handleWholeFormationOverflowEntry(
            handling,
            pages,
            currentPageBoxes,
            currentPageIndex,
            pageWidth,
            pageHeight,
            nextPageTop
        );
    }

    settleWholeFormationOverflowEntry(
        currentActorIndex: number,
        outcome: WholeFormationOverflowEntryOutcome
    ): WholeFormationOverflowEntrySettlementOutcome {
        return this.aiRuntime.settleWholeFormationOverflowEntry(currentActorIndex, outcome);
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
        return this.aiRuntime.resolveWholeFormationOverflow(input);
    }

    resolveKeepWithNextOverflowAction(input: KeepWithNextOverflowActionInput): PaginationLoopAction | null {
        return this.aiRuntime.resolveKeepWithNextOverflowAction(input);
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
        return this.transitionsRuntime.finalizeGenericAcceptedSplit(
            pageBoxes,
            actorQueue,
            startIndex,
            predecessor,
            continuation,
            attempt,
            result,
            boxes,
            state,
            positionMarker
        );
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
        return this.collisionRuntime.handleActorOverflowPreSplit(outcome, actor, boxes, state);
    }

    handleActorOverflowSplitEntry(
        outcome: 'advance-page-for-top-split' | 'attempt-split-now',
        actor: PackagerUnit,
        availableWidth: number,
        availableHeight: number,
        context: PackagerContext
    ): ActorOverflowSplitEntryHandlingOutcome {
        return this.collisionRuntime.handleActorOverflowSplitEntry(
            outcome,
            actor,
            availableWidth,
            availableHeight,
            context
        );
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
        return this.collisionRuntime.handleActorOverflowEntry(
            overflowHandling,
            actor,
            boxes,
            state,
            availableWidth,
            availableHeight,
            context,
            currentY,
            lastSpacingAfter
        );
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
        return this.collisionRuntime.settleActorOverflowEntry(
            pages,
            currentPageBoxes,
            currentPageIndex,
            pageWidth,
            pageHeight,
            nextPageTopY,
            currentActorIndex,
            overflowEntry
        );
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
        return this.collisionRuntime.resolveActorOverflow(input);
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
        return this.collisionRuntime.resolveActorOverflowHandling(input);
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
        return this.transitionsRuntime.settleActorSplitFailure(
            pages,
            currentPageBoxes,
            currentPageIndex,
            pageWidth,
            pageHeight,
            nextPageTopY,
            currentActorIndex,
            resolution
        );
    }

    resolveDeferredSplitPlacement(
        currentY: number,
        nextCursorY: number,
        layoutBefore: number,
        pageLimit: number,
        pageTop: number
    ): DeferredSplitPlacementOutcome {
        return this.transitionsRuntime.resolveDeferredSplitPlacement(
            currentY,
            nextCursorY,
            layoutBefore,
            pageLimit,
            pageTop
        );
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
        return this.transitionsRuntime.settleDeferredSplitPlacement(
            pages,
            currentPageBoxes,
            currentPageIndex,
            pageWidth,
            pageHeight,
            nextPageTopY,
            currentActorIndex,
            lastSpacingAfter,
            outcome
        );
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
        return this.transitionsRuntime.handleGenericSplitSuccess(
            currentPageBoxes,
            actorQueue,
            startIndex,
            predecessor,
            continuation,
            attempt,
            result,
            currentFragment,
            currentBoxes,
            state,
            deferredSplitCursorY,
            layoutBefore,
            pageLimit,
            pageTop,
            positionMarker
        );
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
        return this.transitionsRuntime.settleGenericSplitSuccess(
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
        return this.transitionsRuntime.executeGenericSplitBranch(
            pages,
            currentPageBoxes,
            currentPageIndex,
            pageWidth,
            pageHeight,
            nextPageTopY,
            currentActorIndex,
            actorQueue,
            packager,
            splitExecution,
            state,
            contextBase,
            resolveDeferredCursorY,
            positionMarker
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
        return this.physicsRuntime.resolveDeferredActorPlacement(
            actor,
            placementFrame,
            constraintField,
            currentY,
            layoutBefore,
            pageLimit,
            pageTop,
            context
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
        return this.physicsRuntime.attemptActorPlacement(
            actor,
            placementFrame,
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
        return this.physicsRuntime.handleActorPlacementAttempt(
            currentPageBoxes,
            outcome,
            currentY,
            lastSpacingAfter
        );
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
        return this.physicsRuntime.settleActorPlacementAttempt(
            pages,
            currentPageBoxes,
            currentPageIndex,
            pageWidth,
            pageHeight,
            nextPageTopY,
            currentActorIndex,
            outcome,
            currentY,
            lastSpacingAfter
        );
    }

    resolveActorPlacementAction(input: ActorPlacementActionInput): PaginationLoopAction {
        return this.physicsRuntime.resolveActorPlacementAction(input);
    }

    setKeepWithNextPlan(actorId: string, plan: KeepWithNextFormationPlan): void {
        this.aiRuntime.setKeepWithNextPlan(actorId, plan);
    }

    getKeepWithNextPlan(actorId: string): KeepWithNextFormationPlan | undefined {
        return this.aiRuntime.getKeepWithNextPlan(actorId);
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
        return this.aiRuntime.resolveKeepWithNextOverflow(input);
    }

    setPaginationLoopState(state: PaginationLoopState): void {
        this.paginationLoopState = state;
        const currentActor = state.actorQueue[state.actorIndex];
        if (!currentActor) return;

        const actorIndex = this.actorIndexByActorId.get(currentActor.actorId);
        if (actorIndex === undefined || state.actorIndex < actorIndex) {
            this.actorIndexByActorId.set(currentActor.actorId, state.actorIndex);
        }

        const sourceActorIndex = this.actorIndexBySourceId.get(currentActor.sourceId);
        if (sourceActorIndex === undefined || state.actorIndex < sourceActorIndex) {
            this.actorIndexBySourceId.set(currentActor.sourceId, state.actorIndex);
        }
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
        return this.physicsRuntime.measurePreparedActor(
            actor,
            availableWidth,
            availableHeight,
            layoutBefore,
            context
        );
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

}
