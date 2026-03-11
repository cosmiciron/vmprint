import type { Box, Page, PageRegionContent, PageReservationSelector } from '../types';
import type { EngineRuntime } from '../runtime';
import type { ContinuationArtifacts, FlowBox } from './layout-core-types';
import type { PackagerUnit } from './packagers/packager-types';
import type { KeepWithNextFormationPlan } from './actor-formation';
import type { PackagerContext } from './packagers/packager-types';
import type { PackagerSplitResult } from './packagers/packager-types';
import { LAYOUT_DEFAULTS } from './defaults';
import { rejectsPlacementFrame, resolvePackagerPlacementPreference } from './packagers/packager-types';
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

        let leftInset = 0;
        let rightInset = 0;

        for (const exclusion of activeBand.exclusions) {
            const left = Number.isFinite(exclusion.x) ? Math.max(0, Number(exclusion.x)) : 0;
            const width = Number.isFinite(exclusion.w) ? Math.max(0, Number(exclusion.w)) : 0;
            const right = left + width;

            if (left <= LAYOUT_DEFAULTS.wrapTolerance) {
                leftInset = Math.max(leftInset, right);
            }

            if (right >= this.availableWidth - LAYOUT_DEFAULTS.wrapTolerance) {
                rightInset = Math.max(rightInset, Math.max(0, this.availableWidth - left));
            }
        }

        if (leftInset <= 0 && rightInset <= 0) return null;
        const laneWidth = Math.max(0, this.availableWidth - leftInset - rightInset);
        return {
            xOffset: leftInset,
            width: laneWidth
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

export type ActorSplitFailureHandlingOutcome = {
    committed: { boxes: Box[]; currentY: number; lastSpacingAfter: number } | null;
    shouldAdvancePage: boolean;
    shouldAdvanceIndex: boolean;
};

export type DeferredSplitPlacementOutcome = {
    shouldAdvancePage: boolean;
    nextCurrentY: number;
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
    availableWidth: number;
    availableHeight: number;
    lastSpacingAfter: number;
    isAtPageTop: boolean;
    context: PackagerContext;
};

type LayoutSessionOptions = {
    runtime: EngineRuntime;
    collaborators?: readonly LayoutCollaborator[];
};

export class LayoutSession {
    readonly runtime: EngineRuntime;
    readonly collaborators: readonly LayoutCollaborator[];
    readonly actorRegistry: PackagerUnit[] = [];
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
    private readonly continuationArtifacts = new Map<string, ContinuationArtifacts>();
    private readonly stagedContinuationActors = new Map<string, PackagerUnit[]>();
    private readonly stagedAfterSplitMarkers = new Map<string, FlowBox[]>();
    private readonly keepWithNextPlans = new Map<string, KeepWithNextFormationPlan>();
    private readonly fragmentTransitions: FragmentTransition[] = [];
    private readonly fragmentTransitionsByActor = new Map<string, FragmentTransition>();
    private readonly fragmentTransitionsBySource = new Map<string, FragmentTransition[]>();
    private readonly pageReservationsByPage = new Map<number, RegionReservation[]>();
    private readonly pageExclusionsByPage = new Map<number, SpatialExclusion[]>();
    private readonly pageFinalizationStates = new Map<number, PageFinalizationState>();
    private readonly artifacts = new Map<string, unknown>();
    private finalizedPages: Page[] = [];
    private simulationReport?: SimulationReport;
    private simulationReportReader: SimulationReportReader = createSimulationReportReader(undefined);
    private paginationLoopState: PaginationLoopState | null = null;
    private currentPageReservations: RegionReservation[] = [];
    private currentPageExclusions: SpatialExclusion[] = [];

    currentPageIndex = 0;
    currentY = 0;
    currentConstraintField: ConstraintField | null = null;
    currentSurface: PageSurface | null = null;

    constructor(options: LayoutSessionOptions) {
        this.runtime = options.runtime;
        this.collaborators = options.collaborators ?? [];
    }

    notifySimulationStart(): void {
        this.finalizedPages = [];
        this.pageReservationsByPage.clear();
        this.pageExclusionsByPage.clear();
        this.pageFinalizationStates.clear();
        this.currentPageReservations = [];
        this.currentPageExclusions = [];
        for (const collaborator of this.collaborators) {
            collaborator.onSimulationStart?.(this);
        }
    }

    notifyActorSpawn(actor: PackagerUnit): void {
        this.actorRegistry.push(actor);
        for (const collaborator of this.collaborators) {
            collaborator.onActorSpawn?.(actor, this);
        }
    }

    notifyPageStart(pageIndex: number, width: number, height: number, boxes: Box[]): void {
        this.currentPageIndex = pageIndex;
        this.currentSurface = new PageSurface(pageIndex, width, height, boxes);
        this.currentPageReservations = [];
        this.currentPageExclusions = [];
        for (const collaborator of this.collaborators) {
            collaborator.onPageStart?.(pageIndex, this.currentSurface, this);
        }
    }

    notifyConstraintNegotiation(actor: PackagerUnit, constraints: ConstraintField): void {
        this.currentConstraintField = constraints;
        const startedAt = performance.now();
        this.recordProfile('reservationConstraintNegotiationCalls', 1);
        for (const reservation of this.currentPageReservations) {
            constraints.reservations.push({ ...reservation });
            this.recordProfile('reservationConstraintApplications', 1);
        }
        for (const exclusion of this.currentPageExclusions) {
            constraints.exclusions.push({ ...exclusion });
        }
        this.recordProfile('reservationConstraintNegotiationMs', performance.now() - startedAt);
        for (const collaborator of this.collaborators) {
            collaborator.onConstraintNegotiation?.(actor, constraints, this);
        }
    }

    notifyActorPrepared(actor: PackagerUnit): void {
        for (const collaborator of this.collaborators) {
            collaborator.onActorPrepared?.(actor, this);
        }
    }

    notifySplitAttempt(attempt: SplitAttempt): void {
        for (const collaborator of this.collaborators) {
            collaborator.onSplitAttempt?.(attempt, this);
        }
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
        const transition: FragmentTransition = {
            predecessorActorId: attempt.actor.actorId,
            currentFragmentActorId: result.currentFragment?.actorId ?? null,
            continuationActorId: result.continuationFragment?.actorId ?? null,
            sourceActorId: attempt.actor.sourceId,
            pageIndex: attempt.context.pageIndex,
            availableWidth: attempt.availableWidth,
            availableHeight: attempt.availableHeight,
            continuationEnqueued: false
        };
        this.fragmentTransitions.push(transition);
        this.fragmentTransitionsByActor.set(attempt.actor.actorId, transition);
        const sourceTransitions = this.fragmentTransitionsBySource.get(transition.sourceActorId) ?? [];
        sourceTransitions.push(transition);
        this.fragmentTransitionsBySource.set(transition.sourceActorId, sourceTransitions);
        if (result.currentFragment) {
            this.fragmentTransitionsByActor.set(result.currentFragment.actorId, transition);
        }
        if (result.continuationFragment) {
            this.fragmentTransitionsByActor.set(result.continuationFragment.actorId, transition);
        }
        for (const collaborator of this.collaborators) {
            collaborator.onSplitAccepted?.(attempt, result, this);
        }
    }

    notifyActorCommitted(actor: PackagerUnit, committed: Box[]): void {
        if (!this.currentSurface) return;
        for (const collaborator of this.collaborators) {
            collaborator.onActorCommitted?.(actor, committed, this.currentSurface, this);
        }
    }

    notifyContinuationProduced(predecessor: PackagerUnit, successor: PackagerUnit): void {
        this.actorRegistry.push(successor);
        for (const collaborator of this.collaborators) {
            collaborator.onContinuationProduced?.(predecessor, successor, this);
        }
    }

    notifyContinuationEnqueued(predecessor: PackagerUnit, successor: PackagerUnit): void {
        this.actorRegistry.push(successor);
        const transition = this.fragmentTransitionsByActor.get(successor.actorId)
            ?? this.fragmentTransitionsByActor.get(predecessor.actorId);
        if (transition) {
            transition.continuationEnqueued = true;
        }
        for (const collaborator of this.collaborators) {
            collaborator.onContinuationEnqueued?.(predecessor, successor, this);
            collaborator.onContinuationProduced?.(predecessor, successor, this);
        }
    }

    finalizePages(pages: Page[]): Page[] {
        const finalizedPages = pages.map((page) => {
            const surface = new PageSurface(page.index, page.width, page.height, [...page.boxes]);
            for (const collaborator of this.collaborators) {
                collaborator.onPageFinalized?.(surface, this);
            }
            return surface.finalize();
        });

        this.finalizedPages = finalizedPages;

        for (const collaborator of this.collaborators) {
            collaborator.onSimulationComplete?.(this);
        }

        this.setSimulationReport(this.buildSimulationReport());

        return finalizedPages;
    }

    // Collaborator-facing artifact publication. Downstream consumers should prefer
    // getSimulationReport() over reading individual artifacts directly.
    publishArtifact<K extends SimulationArtifactKey>(key: K, value: SimulationArtifactMap[K]): void;
    publishArtifact(key: string, value: unknown): void;
    publishArtifact(key: string, value: unknown): void {
        this.artifacts.set(key, value);
    }

    // Report assembly helper. The raw artifact registry remains internal;
    // downstream consumers should read the consolidated simulation report.
    buildSimulationArtifacts(): SimulationArtifacts {
        const artifacts: SimulationArtifacts = {
            fragmentationSummary: this.artifacts.get(simulationArtifactKeys.fragmentationSummary) as SimulationArtifactMap['fragmentationSummary'],
            pageNumberSummary: this.artifacts.get(simulationArtifactKeys.pageNumberSummary) as SimulationArtifactMap['pageNumberSummary'],
            pageOverrideSummary: this.artifacts.get(simulationArtifactKeys.pageOverrideSummary) as SimulationArtifactMap['pageOverrideSummary'],
            pageExclusionSummary: this.artifacts.get(simulationArtifactKeys.pageExclusionSummary) as SimulationArtifactMap['pageExclusionSummary'],
            pageReservationSummary: this.artifacts.get(simulationArtifactKeys.pageReservationSummary) as SimulationArtifactMap['pageReservationSummary'],
            pageSpatialConstraintSummary: this.artifacts.get(simulationArtifactKeys.pageSpatialConstraintSummary) as SimulationArtifactMap['pageSpatialConstraintSummary'],
            pageRegionSummary: this.artifacts.get(simulationArtifactKeys.pageRegionSummary) as SimulationArtifactMap['pageRegionSummary'],
            sourcePositionMap: this.artifacts.get(simulationArtifactKeys.sourcePositionMap) as SimulationArtifactMap['sourcePositionMap']
        };

        for (const [key, value] of this.artifacts.entries()) {
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
        if (pageIndex === this.currentPageIndex) {
            this.currentPageReservations.push(normalized);
        }
        const pageReservations = this.pageReservationsByPage.get(pageIndex) ?? [];
        pageReservations.push(normalized);
        this.pageReservationsByPage.set(pageIndex, pageReservations);
        this.recordProfile('reservationWrites', 1);
    }

    reserveCurrentPageSpace(reservation: RegionReservation): void {
        this.reservePageSpace(reservation, this.currentPageIndex);
    }

    getCurrentPageReservations(): readonly RegionReservation[] {
        return this.currentPageReservations;
    }

    getPageReservations(pageIndex: number): readonly RegionReservation[] {
        return this.pageReservationsByPage.get(pageIndex) ?? [];
    }

    getReservationPageIndices(): readonly number[] {
        return Array.from(this.pageReservationsByPage.keys()).sort((a, b) => a - b);
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

        if (pageIndex === this.currentPageIndex) {
            this.currentPageExclusions.push(normalized);
        }
        const pageExclusions = this.pageExclusionsByPage.get(pageIndex) ?? [];
        pageExclusions.push(normalized);
        this.pageExclusionsByPage.set(pageIndex, pageExclusions);
    }

    getPageExclusions(pageIndex: number): readonly SpatialExclusion[] {
        return this.pageExclusionsByPage.get(pageIndex) ?? [];
    }

    getExclusionPageIndices(): readonly number[] {
        return Array.from(this.pageExclusionsByPage.keys()).sort((a, b) => a - b);
    }

    getSpatialConstraintPageIndices(): readonly number[] {
        return Array.from(new Set([
            ...this.pageReservationsByPage.keys(),
            ...this.pageExclusionsByPage.keys()
        ])).sort((a, b) => a - b);
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
            actorCount: this.actorRegistry.length,
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
        this.continuationArtifacts.set(actorId, artifacts);
    }

    getContinuationArtifacts(actorId: string): ContinuationArtifacts | undefined {
        return this.continuationArtifacts.get(actorId);
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
        if (!actors.length) return;
        this.stagedContinuationActors.set(continuationActorId, actors);
        for (const actor of actors) {
            this.notifyActorSpawn(actor);
        }
    }

    consumeActorsBeforeContinuation(continuationActorId: string): PackagerUnit[] {
        const actors = this.stagedContinuationActors.get(continuationActorId) ?? [];
        this.stagedContinuationActors.delete(continuationActorId);
        return actors;
    }

    stageMarkersAfterSplit(fragmentActorId: string, markers: FlowBox[]): void {
        if (!markers.length) return;
        this.stagedAfterSplitMarkers.set(fragmentActorId, markers);
    }

    consumeMarkersAfterSplit(fragmentActorId: string): FlowBox[] {
        const markers = this.stagedAfterSplitMarkers.get(fragmentActorId) ?? [];
        this.stagedAfterSplitMarkers.delete(fragmentActorId);
        return markers;
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
            ...this.captureLocalQueueSnapshot(actorQueue),
            ...this.captureLocalSplitStateSnapshot()
        };
    }

    captureLocalQueueSnapshot(
        actorQueue: readonly PackagerUnit[]
    ): LocalQueueSnapshot {
        return {
            actorQueue: [...actorQueue],
            stagedContinuationActors: new Map(
                Array.from(this.stagedContinuationActors.entries(), ([actorId, actors]) => [actorId, [...actors]])
            ),
            stagedAfterSplitMarkers: new Map(
                Array.from(this.stagedAfterSplitMarkers.entries(), ([actorId, markers]) => [actorId, [...markers]])
            )
        };
    }

    captureLocalSplitStateSnapshot(): LocalSplitStateSnapshot {
        return {
            currentPageReservations: this.currentPageReservations.map((reservation) => ({ ...reservation })),
            currentPageExclusions: this.currentPageExclusions.map((exclusion) => ({ ...exclusion })),
            fragmentTransitions: [...this.fragmentTransitions],
            fragmentTransitionsByActor: new Map(this.fragmentTransitionsByActor),
            fragmentTransitionsBySource: new Map(
                Array.from(this.fragmentTransitionsBySource.entries(), ([sourceActorId, transitions]) => [
                    sourceActorId,
                    [...transitions]
                ])
            )
        };
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
        this.rollbackContinuationQueue(actorQueue, snapshot);
        this.restoreLocalSplitStateSnapshot(snapshot);
        return this.restoreLocalTransitionSnapshot(pageBoxes, snapshot);
    }

    restoreLocalQueueSnapshot(
        actorQueue: PackagerUnit[],
        snapshot: LocalQueueSnapshot
    ): void {
        actorQueue.splice(0, actorQueue.length, ...snapshot.actorQueue);
        this.stagedContinuationActors.clear();
        for (const [actorId, actors] of snapshot.stagedContinuationActors.entries()) {
            this.stagedContinuationActors.set(actorId, [...actors]);
        }
        this.stagedAfterSplitMarkers.clear();
        for (const [actorId, markers] of snapshot.stagedAfterSplitMarkers.entries()) {
            this.stagedAfterSplitMarkers.set(actorId, [...markers]);
        }
    }

    rollbackContinuationQueue(
        actorQueue: PackagerUnit[],
        snapshot: LocalQueueSnapshot
    ): void {
        this.restoreLocalQueueSnapshot(actorQueue, snapshot);
    }

    restoreLocalSplitStateSnapshot(snapshot: LocalSplitStateSnapshot): void {
        this.currentPageReservations = snapshot.currentPageReservations.map((reservation) => ({ ...reservation }));
        this.currentPageExclusions = snapshot.currentPageExclusions.map((exclusion) => ({ ...exclusion }));

        this.fragmentTransitions.length = 0;
        this.fragmentTransitions.push(...snapshot.fragmentTransitions);

        this.fragmentTransitionsByActor.clear();
        for (const [actorId, transition] of snapshot.fragmentTransitionsByActor.entries()) {
            this.fragmentTransitionsByActor.set(actorId, transition);
        }

        this.fragmentTransitionsBySource.clear();
        for (const [sourceActorId, transitions] of snapshot.fragmentTransitionsBySource.entries()) {
            this.fragmentTransitionsBySource.set(sourceActorId, [...transitions]);
        }
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
        if (!continuation) {
            actorQueue.splice(startIndex, replaceCount);
            return false;
        }

        if (options.notify !== false) {
            this.notifyContinuationEnqueued(predecessor, continuation);
        }
        const stagedActors = this.consumeActorsBeforeContinuation(continuation.actorId);
        if (stagedActors.length > 0) {
            actorQueue.splice(startIndex, replaceCount, ...stagedActors, continuation);
            return true;
        }

        actorQueue.splice(startIndex, replaceCount, continuation);
        return true;
    }

    settleContinuationQueue(
        actorQueue: PackagerUnit[],
        startIndex: number,
        replaceCount: number,
        predecessor: PackagerUnit,
        continuation: PackagerUnit | null | undefined,
        options: { notify?: boolean } = {}
    ): ContinuationQueueOutcome {
        const snapshot = this.captureLocalQueueSnapshot(actorQueue);
        return {
            snapshot,
            continuationInstalled: this.installContinuationIntoQueue(
                actorQueue,
                startIndex,
                replaceCount,
                predecessor,
                continuation,
                options
            )
        };
    }

    previewContinuationQueueSettlement(
        actorQueue: PackagerUnit[],
        startIndex: number,
        replaceCount: number,
        predecessor: PackagerUnit,
        continuation: PackagerUnit | null | undefined
    ): ContinuationQueueOutcome {
        const preview = this.settleContinuationQueue(
            actorQueue,
            startIndex,
            replaceCount,
            predecessor,
            continuation,
            { notify: false }
        );
        this.rollbackContinuationQueue(actorQueue, preview.snapshot);
        return preview;
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

    setKeepWithNextPlan(actorId: string, plan: KeepWithNextFormationPlan): void {
        this.keepWithNextPlans.set(actorId, plan);
    }

    getKeepWithNextPlan(actorId: string): KeepWithNextFormationPlan | undefined {
        return this.keepWithNextPlans.get(actorId);
    }

    setPaginationLoopState(state: PaginationLoopState): void {
        this.paginationLoopState = state;
    }

    getPaginationLoopState(): PaginationLoopState | null {
        return this.paginationLoopState;
    }

    getFragmentTransitions(): readonly FragmentTransition[] {
        return this.fragmentTransitions;
    }

    getFragmentTransition(actorId: string): FragmentTransition | undefined {
        return this.fragmentTransitionsByActor.get(actorId);
    }

    getFragmentTransitionsBySource(sourceActorId: string): readonly FragmentTransition[] {
        return this.fragmentTransitionsBySource.get(sourceActorId) ?? [];
    }

    getFragmentTransitionSourceIds(): readonly string[] {
        return Array.from(this.fragmentTransitionsBySource.keys());
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
