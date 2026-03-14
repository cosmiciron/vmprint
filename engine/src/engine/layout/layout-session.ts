import { performance } from 'node:perf_hooks';
import type { Box, Page, PageReservationSelector } from '../types';
import type { EngineRuntime } from '../runtime';
import type { ContinuationArtifacts, FlowBox } from './layout-core-types';
import type { KeepWithNextFormationPlan, WholeFormationOverflowHandling } from './actor-formation';
import type { PackagerUnit } from './packagers/packager-types';
import type { ObservationResult, PackagerContext, SpatialFrontier } from './packagers/packager-types';
import type { PackagerSplitResult } from './packagers/packager-types';
import { AIRuntime } from './ai-runtime';
import type { ActorSignal, ActorSignalDraft } from './actor-event-bus';
import {
    ActorCommunicationRuntime,
    type LocalActorSignalSnapshot,
    type ObserverSweepResult
} from './actor-communication-runtime';
import { LAYOUT_DEFAULTS } from './defaults';
import { EventDispatcher } from './event-dispatcher';
import { FragmentSessionRuntime } from './fragment-session-runtime';
import { Kernel } from './kernel';
import { CollisionRuntime } from './collision-runtime';
import { LifecycleRuntime } from './lifecycle-runtime';
import { PaginationLoopRuntime } from './pagination-loop-runtime';
import { PlacementSessionRuntime } from './placement-session-runtime';
import { PhysicsRuntime } from './physics-runtime';
import { SessionCollaborationRuntime } from './session-collaboration-runtime';
import { SessionWorldRuntime } from './session-world-runtime';
import { TransitionsRuntime } from './transitions-runtime';
import type {
    SimulationArtifactKey,
    SimulationArtifactMap,
    SimulationArtifacts,
    SimulationReport,
    SimulationReportReader
} from './simulation-report';
import { SimulationReportBridge } from './simulation-report-bridge';

import {
    ConstraintField,
    PageSurface,
    type ActorMeasurement,
    type ActorOverflowEntryHandlingOutcome,
    type ActorOverflowEntrySettlementOutcome,
    type ActorOverflowPreSplitHandlingOutcome,
    type ActorOverflowResolution,
    type ActorOverflowSplitEntryHandlingOutcome,
    type ActorPlacementActionInput,
    type ActorPlacementAttemptOutcome,
    type ActorPlacementExecutionOutcome,
    type ActorPlacementHandlingOutcome,
    type ActorPlacementSettlementOutcome,
    type ActorSplitFailureHandlingOutcome,
    type ActorSplitFailureResolution,
    type ActorSplitFailureSettlementOutcome,
    type AcceptedSplitQueueHandling,
    type ContinuationQueueOutcome,
    type DeferredSplitPlacementOutcome,
    type DeferredSplitPlacementSettlementOutcome,
    type ForcedOverflowCommitOutcome,
    type FragmentCommitState,
    type FragmentTransition,
    type GenericSplitActionInput,
    type GenericSplitOutcome,
    type GenericSplitSuccessHandlingOutcome,
    type GenericSplitSuccessSettlementOutcome,
    type KernelBranchStateSnapshot,
    type KeepWithNextOverflowActionInput,
    type KeepWithNextPlanningResolution,
    type LayoutCollaborator,
    type LayoutProfileMetrics,
    type LocalBranchSnapshot,
    type LocalBranchStateSnapshot,
    type LocalQueueSnapshot,
    type LocalSplitStateSnapshot,
    type LocalTransitionSnapshot,
    type PageExclusionIntent,
    type PageAdvanceOutcome,
    type PageFinalizationState,
    type PageReservationIntent,
    type PaginationLoopAction,
    type PaginationLoopState,
    type PaginationPlacementPreparation,
    type PaginationState,
    type PositionedSplitExecution,
    type RegionReservation,
    type ResolvedPlacementFrame,
    type SequencePlacementCheckpoint,
    type SequencePlacementState,
    type SessionSafeCheckpoint,
    type SplitAttempt,
    type SplitExecution,
    type SplitMarkerPlacementState,
    type SplitFragmentAftermathInput,
    type SplitFragmentAftermathState,
    type TailSplitFailureSettlementOutcome,
    type TailSplitFormationOutcome,
    type TailSplitFormationSettlementOutcome,
    type WholeFormationOverflowEntryOutcome,
    type WholeFormationOverflowEntrySettlementOutcome,
    type WholeFormationOverflowResolution,
    type SpatialExclusion
} from './layout-session-types';

export {
    ConstraintField,
    PageSurface
} from './layout-session-types';
export type {
    AcceptedSplitQueueHandling,
    ActiveExclusionBand,
    ActorMeasurement,
    ActorOverflowEntryHandlingOutcome,
    ActorOverflowEntrySettlementOutcome,
    ActorOverflowPreSplitHandlingOutcome,
    ActorOverflowResolution,
    ActorOverflowSplitEntryHandlingOutcome,
    ActorPlacementActionInput,
    ActorPlacementAttemptOutcome,
    ActorPlacementCommitOutcome,
    ActorPlacementExecutionOutcome,
    ActorPlacementHandlingOutcome,
    ActorPlacementSettlementOutcome,
    ActorSplitFailureHandlingOutcome,
    ActorSplitFailureResolution,
    ActorSplitFailureSettlementOutcome,
    ContentBand,
    ContinuationQueueOutcome,
    DeferredSplitPlacementOutcome,
    DeferredSplitPlacementSettlementOutcome,
    ForcedOverflowCommitOutcome,
    FragmentCommitState,
    FragmentTransition,
    GenericSplitActionInput,
    GenericSplitOutcome,
    GenericSplitSuccessHandlingOutcome,
    GenericSplitSuccessSettlementOutcome,
    KeepWithNextOverflowActionInput,
    KeepWithNextPlanningResolution,
    KernelBranchStateSnapshot,
    LayoutCollaborator,
    LayoutProfileMetrics,
    LocalBranchSnapshot,
    LocalBranchStateSnapshot,
    LocalQueueSnapshot,
    LocalSplitStateSnapshot,
    LocalTransitionSnapshot,
    PageAdvanceOutcome,
    PageExclusionIntent,
    PageFinalizationState,
    PageOverrideState,
    PageRegionResolution,
    PageReservationIntent,
    PaginationLoopAction,
    PaginationLoopState,
    PaginationPlacementPreparation,
    PaginationState,
    PlacementFrameMargins,
    PositionedSplitExecution,
    RegionReservation,
    ResolvedPlacementFrame,
    SafeCheckpointSnapshot,
    SequencePlacementCheckpoint,
    SequencePlacementState,
    SessionSafeCheckpoint,
    SpatialExclusion,
    SpatialPlacementDecision,
    SpatialPlacementSurface,
    SplitAttempt,
    SplitExecution,
    SplitFragmentAftermathInput,
    SplitFragmentAftermathState,
    SplitMarkerPlacementState,
    TailSplitFailureSettlementOutcome,
    TailSplitFormationOutcome,
    TailSplitFormationSettlementOutcome,
    WholeFormationOverflowEntryOutcome,
    WholeFormationOverflowEntrySettlementOutcome,
    WholeFormationOverflowResolution
} from './layout-session-types';

type LayoutSessionOptions = {
    runtime: EngineRuntime;
    collaborators?: readonly LayoutCollaborator[];
};

export class LayoutSession {
    readonly runtime: EngineRuntime;
    readonly collaborators: readonly LayoutCollaborator[];
    readonly eventDispatcher: EventDispatcher;
    readonly kernel = new Kernel();
    readonly actorCommunicationRuntime: ActorCommunicationRuntime<LocalTransitionSnapshot, KernelBranchStateSnapshot>;
    readonly fragmentSessionRuntime: FragmentSessionRuntime;
    readonly paginationLoopRuntime: PaginationLoopRuntime;
    readonly placementSessionRuntime: PlacementSessionRuntime;
    readonly sessionWorldRuntime: SessionWorldRuntime;
    readonly aiRuntime: AIRuntime;
    readonly lifecycleRuntime: LifecycleRuntime;
    readonly collisionRuntime: CollisionRuntime;
    readonly physicsRuntime: PhysicsRuntime;
    readonly sessionCollaborationRuntime: SessionCollaborationRuntime;
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

    currentPageIndex = 0;
    currentY = 0;
    currentConstraintField: ConstraintField | null = null;
    currentSurface: PageSurface | null = null;

    constructor(options: LayoutSessionOptions) {
        this.runtime = options.runtime;
        this.collaborators = options.collaborators ?? [];
        this.eventDispatcher = new EventDispatcher(this.collaborators);
        this.actorCommunicationRuntime = new ActorCommunicationRuntime(
            () => this.recordProfile('observerCheckpointSweepCalls', 1)
        );
        this.fragmentSessionRuntime = new FragmentSessionRuntime(this.kernel, {
            notifyActorSpawn: (actor) => this.notifyActorSpawn(actor),
            notifyContinuationEnqueued: (predecessor, successor) => this.notifyContinuationEnqueued(predecessor, successor),
            notifySplitAccepted: (attempt, result) => this.notifySplitAccepted(attempt, result),
            notifyActorCommitted: (actor, committed) => this.notifyActorCommitted(actor, committed),
            captureLocalActorSignalSnapshot: () => this.captureLocalActorSignalSnapshot(),
            restoreLocalActorSignalSnapshot: (snapshot) => this.restoreLocalActorSignalSnapshot(snapshot)
        });
        this.paginationLoopRuntime = new PaginationLoopRuntime();
        this.sessionWorldRuntime = new SessionWorldRuntime(this.kernel, this);
        this.lifecycleRuntime = new LifecycleRuntime({
            finalizeCommittedPage: (pageIndex, width, height, boxes) => this.finalizeCommittedPage(pageIndex, width, height, boxes),
            notifyPageStart: (pageIndex, width, height, boxes) => this.notifyPageStart(pageIndex, width, height, boxes),
            createContinueLoopAction: (paginationState, nextActorIndex) =>
                this.paginationLoopRuntime.createContinueLoopAction(paginationState, nextActorIndex)
        });
        this.transitionsRuntime = new TransitionsRuntime({
            getContinuationArtifacts: (actorId) => this.fragmentSessionRuntime.getContinuationArtifacts(actorId),
            setContinuationArtifacts: (actorId, artifacts) => this.fragmentSessionRuntime.setContinuationArtifacts(actorId, artifacts),
            captureLocalBranchSnapshot: (pageBoxes, actorQueue, currentY, lastSpacingAfter) =>
                this.fragmentSessionRuntime.captureLocalBranchSnapshot(pageBoxes, actorQueue, currentY, lastSpacingAfter),
            acceptAndCommitSplitFragment: (attempt, result, boxes, state, positionMarker) =>
                this.fragmentSessionRuntime.acceptAndCommitSplitFragment(attempt, result, boxes, state, positionMarker),
            settleContinuationQueue: (actorQueue, startIndex, replaceCount, predecessor, continuation, options) =>
                this.fragmentSessionRuntime.settleContinuationQueue(actorQueue, startIndex, replaceCount, predecessor, continuation, options),
            rollbackAcceptedSplitBranch: (pageBoxes, actorQueue, snapshot) =>
                this.fragmentSessionRuntime.rollbackAcceptedSplitBranch(pageBoxes, actorQueue, snapshot),
            restoreLocalBranchSnapshot: (pageBoxes, actorQueue, snapshot) =>
                this.fragmentSessionRuntime.restoreLocalBranchSnapshot(pageBoxes, actorQueue, snapshot),
            placeActorSequence: (actors, state, contextBase) =>
                this.fragmentSessionRuntime.placeActorSequence(actors, state, contextBase),
            executePositionedSplitAttempt: (actor, availableWidth, currentY, lastSpacingAfter, pageLimit, pageIndex, markerReserve, contextBase) =>
                this.executePositionedSplitAttempt(actor, availableWidth, currentY, lastSpacingAfter, pageLimit, pageIndex, markerReserve, contextBase),
            createSplitFragmentAftermathState: (actor, input) =>
                this.fragmentSessionRuntime.createSplitFragmentAftermathState(actor, input),
            advancePage: (pages, currentPageBoxes, currentPageIndex, pageWidth, pageHeight, nextPageTopY) =>
                this.lifecycleRuntime.advancePage(pages, currentPageBoxes, currentPageIndex, pageWidth, pageHeight, nextPageTopY),
            resolveNextActorIndex: (currentIndex, shouldAdvanceIndex) =>
                this.paginationLoopRuntime.resolveNextActorIndex(currentIndex, shouldAdvanceIndex),
            resolveActorSplitFailure: (actor, boxes, state, forceCommitAtPageTop, currentY, lastSpacingAfter) =>
                this.placementSessionRuntime.resolveActorSplitFailure(actor, boxes, state, forceCommitAtPageTop, currentY, lastSpacingAfter)
        });
        this.collisionRuntime = new CollisionRuntime({
            commitFragmentBoxes: (actor, boxes, state) => this.fragmentSessionRuntime.commitFragmentBoxes(actor, boxes, state),
            executeSplitAttempt: (actor, availableWidth, availableHeight, context) =>
                this.executeSplitAttempt(actor, availableWidth, availableHeight, context),
            advancePage: (pages, currentPageBoxes, currentPageIndex, pageWidth, pageHeight, nextPageTopY) =>
                this.lifecycleRuntime.advancePage(pages, currentPageBoxes, currentPageIndex, pageWidth, pageHeight, nextPageTopY),
            resolveNextActorIndex: (currentIndex, shouldAdvanceIndex) =>
                this.paginationLoopRuntime.resolveNextActorIndex(currentIndex, shouldAdvanceIndex),
            toPaginationLoopAction: (outcome) => this.paginationLoopRuntime.toPaginationLoopAction(outcome),
            getSplitMarkerReserve: (actor) => this.transitionsRuntime.getSplitMarkerReserve(actor)
        });
        this.physicsRuntime = new PhysicsRuntime({
            notifyConstraintNegotiation: (actor, constraints) => this.notifyConstraintNegotiation(actor, constraints),
            notifyActorPrepared: (actor) => this.notifyActorPrepared(actor),
            restartCurrentActorOnNextPage: (pages, currentPageBoxes, currentPageIndex, pageWidth, pageHeight, nextPageTopY, actorIndex) =>
                this.lifecycleRuntime.restartCurrentActorOnNextPage(pages, currentPageBoxes, currentPageIndex, pageWidth, pageHeight, nextPageTopY, actorIndex),
            recordProfile: (metric, delta) => this.recordProfile(metric, delta),
            resolveDeferredSplitPlacement: (currentY, nextCursorY, layoutBefore, pageLimit, pageTop) =>
                this.transitionsRuntime.resolveDeferredSplitPlacement(currentY, nextCursorY, layoutBefore, pageLimit, pageTop),
            commitFragmentBoxes: (actor, boxes, state) => this.fragmentSessionRuntime.commitFragmentBoxes(actor, boxes, state),
            advancePage: (pages, currentPageBoxes, currentPageIndex, pageWidth, pageHeight, nextPageTopY) =>
                this.lifecycleRuntime.advancePage(pages, currentPageBoxes, currentPageIndex, pageWidth, pageHeight, nextPageTopY),
            resolveNextActorIndex: (currentIndex, shouldAdvanceIndex) =>
                this.paginationLoopRuntime.resolveNextActorIndex(currentIndex, shouldAdvanceIndex),
            toPaginationLoopAction: (outcome) => this.paginationLoopRuntime.toPaginationLoopAction(outcome)
        });
        this.simulationReportBridge = new SimulationReportBridge(this);
        this.sessionCollaborationRuntime = new SessionCollaborationRuntime(
            this.eventDispatcher,
            this.lifecycleRuntime,
            this.sessionWorldRuntime,
            this.simulationReportBridge,
            {
                getSession: () => this,
                getCurrentPageIndex: () => this.currentPageIndex,
                getProfileSnapshot: () => this.profile
            }
        );
        this.placementSessionRuntime = new PlacementSessionRuntime(
            this.physicsRuntime,
            this.collisionRuntime,
            this.transitionsRuntime,
            {
                commitFragmentBoxes: (actor, boxes, state) => this.fragmentSessionRuntime.commitFragmentBoxes(actor, boxes, state),
                toPaginationLoopAction: (outcome, nextActorIndex) => this.paginationLoopRuntime.toPaginationLoopAction(outcome, nextActorIndex)
            }
        );
        this.aiRuntime = new AIRuntime({
            advancePage: (pages, currentPageBoxes, currentPageIndex, pageWidth, pageHeight, nextPageTopY) =>
                this.lifecycleRuntime.advancePage(pages, currentPageBoxes, currentPageIndex, pageWidth, pageHeight, nextPageTopY),
            toPaginationLoopAction: (outcome) => this.paginationLoopRuntime.toPaginationLoopAction(outcome),
            executeTailSplitFormationBranch: (
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
            ) => this.transitionsRuntime.executeTailSplitFormationBranch(
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
            ),
            recordProfile: (metric, delta) => this.recordProfile(metric, delta)
        });
    }

    notifySimulationStart(): void {
        this.kernel.resetForSimulation();
        this.actorCommunicationRuntime.resetForSimulation();
        this.lifecycleRuntime.resetForSimulation();
        this.eventDispatcher.onSimulationStart(this);
    }

    publishActorSignal(signal: ActorSignalDraft): ActorSignal {
        return this.actorCommunicationRuntime.publishActorSignal(signal);
    }

    getActorSignals(topic?: string): readonly ActorSignal[] {
        return this.actorCommunicationRuntime.getActorSignals(topic);
    }

    notifyActorSpawn(actor: PackagerUnit): void {
        this.kernel.registerActor(actor);
        this.actorCommunicationRuntime.notifyActorSpawn(actor);
        this.eventDispatcher.onActorSpawn(actor, this);
    }

    notifyPageStart(pageIndex: number, width: number, height: number, boxes: Box[]): void {
        this.currentPageIndex = pageIndex;
        this.currentSurface = new PageSurface(pageIndex, width, height, boxes);
        this.kernel.beginPage();
        this.eventDispatcher.onPageStart(pageIndex, this.currentSurface, this);
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
        return this.sessionCollaborationRuntime.finalizeCommittedPage(pageIndex, width, height, boxes);
    }

    closePagination(
        pages: Page[],
        currentPageBoxes: readonly Box[],
        currentPageIndex: number,
        pageWidth: number,
        pageHeight: number
    ): void {
        this.sessionCollaborationRuntime.closePagination(pages, currentPageBoxes, currentPageIndex, pageWidth, pageHeight);
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
    ): SessionSafeCheckpoint {
        return this.actorCommunicationRuntime.recordSafeCheckpoint(
            actorQueue,
            actorIndex,
            pagesPrefix,
            currentPageBoxes,
            currentPageIndex,
            kind,
            () => this.fragmentSessionRuntime.captureLocalTransitionSnapshot(currentPageBoxes, currentY, lastSpacingAfter),
            () => this.kernel.captureLocalBranchStateSnapshot(actorQueue)
        );
    }

    evaluateObserverRegistry(
        contextBase: Omit<PackagerContext, 'pageIndex' | 'cursorY'>,
        pageIndex: number,
        cursorY: number
    ): ObserverSweepResult {
        return this.actorCommunicationRuntime.evaluateObserverRegistry(contextBase, pageIndex, cursorY);
    }

    resolveSafeCheckpoint(frontier: SpatialFrontier): SessionSafeCheckpoint | null {
        return this.actorCommunicationRuntime.resolveSafeCheckpoint(frontier);
    }

    restoreSafeCheckpoint(
        pages: Page[],
        actorQueue: PackagerUnit[],
        checkpoint: SessionSafeCheckpoint
    ): { currentPageBoxes: Box[]; currentY: number; lastSpacingAfter: number } {
        return this.actorCommunicationRuntime.restoreSafeCheckpoint(
            pages,
            actorQueue,
            checkpoint,
            (restoredQueue, snapshot) => this.kernel.restoreLocalBranchStateSnapshot(restoredQueue, snapshot)
        );
    }

    applyPaginationState(target: PaginationState, next: PaginationState): void {
        this.paginationLoopRuntime.applyPaginationState(target, next);
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
        return this.paginationLoopRuntime.applyPaginationLoopAction(target, action);
    }

    finalizePages(pages: Page[]): Page[] {
        return this.sessionCollaborationRuntime.finalizePages(pages);
    }

    onSimulationComplete(): void {
        this.sessionCollaborationRuntime.onSimulationComplete();
    }

    // Collaborator-facing artifact publication. Downstream consumers should prefer
    // getSimulationReport() over reading individual artifacts directly.
    publishArtifact<K extends SimulationArtifactKey>(key: K, value: SimulationArtifactMap[K]): void;
    publishArtifact(key: string, value: unknown): void;
    publishArtifact(key: string, value: unknown): void {
        this.sessionCollaborationRuntime.publishArtifact(key, value);
    }

    // Report assembly helper. The raw artifact registry remains internal;
    // downstream consumers should read the consolidated simulation report.
    buildSimulationArtifacts(): SimulationArtifacts {
        return this.sessionCollaborationRuntime.buildSimulationArtifacts();
    }

    getFinalizedPages(): readonly Page[] {
        return this.sessionCollaborationRuntime.getFinalizedPages();
    }

    recordPageFinalization(state: PageFinalizationState): void {
        this.sessionCollaborationRuntime.recordPageFinalization(state);
    }

    resetLogicalPageNumbering(startAt: number): void {
        this.sessionCollaborationRuntime.resetLogicalPageNumbering(startAt);
    }

    allocateLogicalPageNumber(usesLogicalNumbering: boolean): number | null {
        return this.sessionCollaborationRuntime.allocateLogicalPageNumber(usesLogicalNumbering);
    }

    getPageFinalizationState(pageIndex: number): PageFinalizationState | undefined {
        return this.sessionCollaborationRuntime.getPageFinalizationState(pageIndex);
    }

    getPageFinalizationStates(): readonly PageFinalizationState[] {
        return this.sessionCollaborationRuntime.getPageFinalizationStates();
    }

    reservePageSpace(reservation: PageReservationIntent, pageIndex: number = this.currentPageIndex): void {
        this.sessionCollaborationRuntime.reservePageSpace(reservation, pageIndex);
    }

    reserveCurrentPageSpace(reservation: RegionReservation): void {
        this.sessionCollaborationRuntime.reserveCurrentPageSpace(reservation);
    }

    getCurrentPageReservations(): readonly RegionReservation[] {
        return this.sessionCollaborationRuntime.getCurrentPageReservations();
    }

    getPageReservations(pageIndex: number): readonly RegionReservation[] {
        return this.sessionCollaborationRuntime.getPageReservations(pageIndex);
    }

    getReservationPageIndices(): readonly number[] {
        return this.sessionCollaborationRuntime.getReservationPageIndices();
    }

    excludePageSpace(exclusion: PageExclusionIntent, pageIndex: number = this.currentPageIndex): void {
        this.sessionCollaborationRuntime.excludePageSpace(exclusion, pageIndex);
    }

    getPageExclusions(pageIndex: number): readonly SpatialExclusion[] {
        return this.sessionCollaborationRuntime.getPageExclusions(pageIndex);
    }

    getExclusionPageIndices(): readonly number[] {
        return this.sessionCollaborationRuntime.getExclusionPageIndices();
    }

    getSpatialConstraintPageIndices(): readonly number[] {
        return this.sessionCollaborationRuntime.getSpatialConstraintPageIndices();
    }

    matchesPageSelector(pageIndex: number, selector: PageReservationSelector = 'first'): boolean {
        return this.sessionCollaborationRuntime.matchesPageSelector(pageIndex, selector);
    }

    matchesPageReservationSelector(pageIndex: number, selector: PageReservationSelector = 'first'): boolean {
        return this.sessionCollaborationRuntime.matchesPageReservationSelector(pageIndex, selector);
    }

    buildSimulationReport(): SimulationReport {
        return this.sessionCollaborationRuntime.buildSimulationReport();
    }

    setSimulationReport(report: SimulationReport): void {
        this.sessionCollaborationRuntime.setSimulationReport(report);
    }

    getSimulationReport(): SimulationReport | undefined {
        return this.sessionCollaborationRuntime.getSimulationReport();
    }

    getSimulationReportReader(): SimulationReportReader {
        return this.sessionCollaborationRuntime.getSimulationReportReader();
    }

    getProfileSnapshot(): LayoutProfileMetrics {
        return this.sessionCollaborationRuntime.getProfileSnapshot();
    }

    getCurrentPageIndex(): number {
        return this.currentPageIndex;
    }

    recordReservationWrite(): void {
        this.recordProfile('reservationWrites', 1);
    }

    getPublishedArtifacts(): ReadonlyMap<string, unknown> {
        return this.fragmentSessionRuntime.getPublishedArtifacts();
    }

    ensureContinuationArtifacts(actor: PackagerUnit): ContinuationArtifacts | undefined {
        return this.transitionsRuntime.ensureContinuationArtifacts(actor);
    }

    getSplitMarkerReserve(actor: PackagerUnit): number {
        return this.transitionsRuntime.getSplitMarkerReserve(actor);
    }

    stageActorsBeforeContinuation(continuationActorId: string, actors: PackagerUnit[]): void {
        this.fragmentSessionRuntime.stageActorsBeforeContinuation(continuationActorId, actors);
    }

    stageMarkersAfterSplit(fragmentActorId: string, markers: FlowBox[]): void {
        this.fragmentSessionRuntime.stageMarkersAfterSplit(fragmentActorId, markers);
    }

    captureLocalActorSignalSnapshot(): LocalActorSignalSnapshot {
        return this.actorCommunicationRuntime.captureLocalActorSignalSnapshot();
    }

    restoreLocalActorSignalSnapshot(snapshot: LocalActorSignalSnapshot): void {
        this.actorCommunicationRuntime.restoreLocalActorSignalSnapshot(snapshot);
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

    finalizeForcedOverflowCommit(
        actor: PackagerUnit,
        boxes: readonly Box[],
        state: FragmentCommitState
    ): ForcedOverflowCommitOutcome {
        return {
            committed: this.fragmentSessionRuntime.commitFragmentBoxes(actor, boxes, state),
            shouldAdvancePage: true
        };
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
        this.actorCommunicationRuntime.noteActorIndex(currentActor, state.actorIndex);
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
        return this.placementSessionRuntime.measurePreparedActor(
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
