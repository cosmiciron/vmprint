import { runtimePerformance as performance } from '../performance';
import type { Box, Page, PageReservationSelector, BoxMeta, Element } from '../types';
import type { EngineRuntime } from '../runtime';
import type { ContinuationArtifacts, FlowBox } from './layout-core-types';
import type { KeepWithNextFormationPlan, WholeFormationOverflowHandling } from './actor-formation';
import type { PackagerUnit } from './packagers/packager-types';
import type { ObservationResult, PackagerContext, SpatialFrontier } from './packagers/packager-types';
import type { PackagerReshapeResult } from './packagers/packager-types';
import { bindPackagerSignalPublisher, resolvePackagerZIndex } from './packagers/packager-types';
import { AIRuntime } from './ai-runtime';
import type { ActorSignal, ActorSignalDraft } from './actor-event-bus';
import {
    ActorCommunicationRuntime,
    type LocalActorSignalSnapshot,
    type ObserverSweepResult
} from './actor-communication-runtime';
import { LAYOUT_DEFAULTS } from './defaults';
import { ConstraintField, type ResolvedPlacementFrame } from './constraint-field';
import { EventDispatcher } from './event-dispatcher';
import { FragmentSessionRuntime } from './fragment-session-runtime';
import { Kernel } from './kernel';
import { CollisionRuntime } from './collision-runtime';
import { LifecycleRuntime } from './lifecycle-runtime';
import { PaginationLoopRuntime } from './pagination-loop-runtime';
import { PlacementSessionRuntime } from './placement-session-runtime';
import { PhysicsRuntime } from './physics-runtime';
import { SessionCollaborationRuntime } from './runtime/session/session-collaboration-runtime';
import { SessionCollaboratorHost } from './runtime/session/session-collaborator-host';
import { SessionLiveRuntimeHost } from './runtime/session/session-live-runtime-host';
import type { Collaborator } from './runtime/session/session-runtime-types';
import { SessionWorldRuntime } from './session-world-runtime';
import { SimulationClock } from './simulation-clock';
import { AsyncThoughtHost, type AsyncThoughtHandle, type AsyncThoughtRequest } from './async-thought-host';
import { TransitionsRuntime } from './transitions-runtime';
import type {
    SimulationArtifactKey,
    SimulationArtifactMap,
    SimulationArtifacts,
    SimulationCapturePolicy,
    SimulationReport,
    SimulationReportReader,
    SimulationWorldSummary
} from './simulation-report';
import { SimulationReportBridge } from './simulation-report-bridge';
import type { PageRegionSummary } from './page-region-summary';
import type { ScriptRegionRef } from './script-region-query';

import {
    type FragmentTransition,
    type PageCaptureRecord,
    type PageCaptureState,
    type PageFinalizationState,
    type ViewportDescriptor,
    type ViewportRect,
    type ViewportTerrain,
    type WorldSpace
} from './runtime/session/session-state-types';
import type { LayoutProfileMetrics } from './runtime/session/session-profile-types';
import type {
    ContinuationQueueOutcome,
    ExecuteSpeculativeBranchInput,
    ExecuteSpeculativeBranchResult,
    KernelBranchStateSnapshot,
    LocalBranchSnapshot,
    LocalBranchStateSnapshot,
    LocalQueueSnapshot,
    LocalSplitStateSnapshot,
    LocalTransitionSnapshot,
    PositionedSplitExecution,
    SequencePlacementCheckpoint,
    SessionBranchStateSnapshot,
    SessionSafeCheckpoint,
    SimulationClockSnapshot,
    SpeculativeBranchContext,
    SpeculativeBranchReason,
    SplitExecution
} from './runtime/session/session-progression-types';
import type {
    AcceptedSplitQueueHandling,
    ActorMeasurement,
    ActorOverflowEntryHandlingOutcome,
    ActorOverflowEntrySettlementOutcome,
    ActorOverflowPreSplitHandlingOutcome,
    ActorOverflowResolution,
    ActorOverflowSplitEntryHandlingOutcome,
    ActorPlacementActionInput,
    ActorPlacementAttemptOutcome,
    ActorPlacementExecutionOutcome,
    ActorPlacementHandlingOutcome,
    ActorPlacementSettlementOutcome,
    ActorSplitFailureHandlingOutcome,
    ActorSplitFailureResolution,
    ActorSplitFailureSettlementOutcome,
    DeferredSplitPlacementOutcome,
    DeferredSplitPlacementSettlementOutcome,
    ForcedOverflowCommitOutcome,
    FragmentCommitState,
    GenericSplitActionInput,
    GenericSplitOutcome,
    GenericSplitSuccessHandlingOutcome,
    GenericSplitSuccessSettlementOutcome,
    KeepWithNextOverflowActionInput,
    KeepWithNextPlanningResolution,
    PageAdvanceOutcome,
    PaginationLoopAction,
    PaginationPlacementPreparation,
    SequencePlacementState,
    SplitFragmentAftermathInput,
    SplitFragmentAftermathState,
    SplitMarkerPlacementState,
    TailSplitFailureSettlementOutcome,
    TailSplitFormationOutcome,
    TailSplitFormationSettlementOutcome,
    WholeFormationOverflowEntryOutcome,
    WholeFormationOverflowEntrySettlementOutcome,
    WholeFormationOverflowResolution
} from './runtime/session/session-pagination-types';
import type {
    PageExclusionIntent,
    PageReservationIntent,
    RegionReservation,
    SpatialExclusion
} from './runtime/session/session-spatial-types';
import type { SimulationProgressionConfig, SimulationProgressionPolicy, SimulationStopReason } from '../types';

export { ConstraintField } from './constraint-field';
export { PageSurface } from './runtime/session/session-lifecycle-types';
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
    ExecuteSpeculativeBranchInput,
    ExecuteSpeculativeBranchResult,
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
    LayoutProfileMetrics,
    LocalBranchSnapshot,
    LocalBranchStateSnapshot,
    LocalQueueSnapshot,
    LocalSplitStateSnapshot,
    LocalTransitionSnapshot,
    PageAdvanceOutcome,
    PageCaptureRecord,
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
    ViewportDescriptor,
    ViewportRect,
    ViewportTerrain,
    SpatialPlacementDecision,
    SpatialPlacementSurface,
    SplitAttempt,
    SplitExecution,
    SplitFragmentAftermathInput,
    SplitFragmentAftermathState,
    SplitMarkerPlacementState,
    SpeculativeBranchContext,
    SpeculativeBranchReason,
    TailSplitFailureSettlementOutcome,
    TailSplitFormationOutcome,
    TailSplitFormationSettlementOutcome,
    WorldSpace,
    WholeFormationOverflowEntryOutcome,
    WholeFormationOverflowEntrySettlementOutcome,
    WholeFormationOverflowResolution
} from './layout-session-types';
import {
    PageSurface,
    type PaginationLoopState,
    type PaginationState,
    type SplitAttempt
} from './runtime/session/session-lifecycle-types';

type LayoutSessionOptions = {
    runtime: EngineRuntime;
    collaborators?: readonly Collaborator[];
    asyncThoughtHost?: AsyncThoughtHost | null;
};

export class LayoutSession {
    readonly runtime: EngineRuntime;
    readonly collaborators: readonly Collaborator[];
    readonly eventDispatcher: EventDispatcher;
    readonly kernel = new Kernel();
    readonly actorCommunicationRuntime: ActorCommunicationRuntime<LocalTransitionSnapshot, SessionBranchStateSnapshot>;
    readonly fragmentSessionRuntime: FragmentSessionRuntime;
    readonly paginationLoopRuntime: PaginationLoopRuntime;
    readonly placementSessionRuntime: PlacementSessionRuntime;
    readonly sessionWorldRuntime: SessionWorldRuntime;
    readonly aiRuntime: AIRuntime;
    readonly lifecycleRuntime: LifecycleRuntime;
    readonly collisionRuntime: CollisionRuntime;
    readonly physicsRuntime: PhysicsRuntime;
    readonly sessionCollaborationRuntime: SessionCollaborationRuntime;
    readonly collaboratorHost: SessionCollaboratorHost;
    readonly liveRuntimeHost: SessionLiveRuntimeHost;
    readonly simulationReportBridge: SimulationReportBridge;
    readonly transitionsRuntime: TransitionsRuntime;
    readonly simulationClock = new SimulationClock();
    readonly asyncThoughtHost: AsyncThoughtHost | null;
    readonly profile: LayoutProfileMetrics = {
        handlerCalls: 0,
        handlerMs: 0,
        loadCalls: 0,
        loadMs: 0,
        createCalls: 0,
        createMs: 0,
        readyCalls: 0,
        readyMs: 0,
        refreshCalls: 0,
        refreshMs: 0,
        documentChangedCalls: 0,
        documentChangedMs: 0,
        replayRequests: 0,
        replayPasses: 0,
        docQueryCalls: 0,
        setContentCalls: 0,
        replaceCalls: 0,
        insertCalls: 0,
        removeCalls: 0,
        messageSendCalls: 0,
        messageHandlerCalls: 0,
        speculativeBranchCalls: 0,
        speculativeBranchMs: 0,
        speculativeBranchAcceptedCalls: 0,
        speculativeBranchRollbackCalls: 0,
        speculativeBranchByReason: {},
        paginationPlacementPrepCalls: 0,
        paginationPlacementPrepMs: 0,
        actorMeasurementCalls: 0,
        actorMeasurementMs: 0,
        keepWithNextResolutionCalls: 0,
        keepWithNextResolutionMs: 0,
        wholeFormationOverflowCalls: 0,
        wholeFormationOverflowMs: 0,
        keepWithNextActionCalls: 0,
        keepWithNextActionMs: 0,
        actorPlacementCalls: 0,
        actorPlacementMs: 0,
        actorOverflowCalls: 0,
        actorOverflowMs: 0,
        genericSplitCalls: 0,
        genericSplitMs: 0,
        boundaryCheckpointCalls: 0,
        boundaryCheckpointMs: 0,
        checkpointRecordCalls: 0,
        checkpointRecordMs: 0,
        observerBoundaryCheckCalls: 0,
        observerBoundaryCheckMs: 0,
        actorMeasurementByKind: {},
                actorPreparedDispatchCalls: 0,
                actorPreparedDispatchMs: 0,
                flowMaterializeCalls: 0,
                flowMaterializeMs: 0,
                flowResolveLinesCalls: 0,
                flowResolveLinesMs: 0,
                flowBuildTokensCalls: 0,
                flowBuildTokensMs: 0,
                flowWrapStreamCalls: 0,
                flowWrapStreamMs: 0,
                flowBidiSplitCalls: 0,
                flowBidiSplitMs: 0,
                flowScriptSplitCalls: 0,
                flowScriptSplitMs: 0,
                flowWordSegmentCalls: 0,
                flowWordSegmentMs: 0,
                wrapOverflowTokenCalls: 0,
                wrapOverflowTokenMs: 0,
                wrapHyphenationAttemptCalls: 0,
                wrapHyphenationAttemptMs: 0,
                wrapHyphenationSuccessCalls: 0,
                wrapGraphemeFallbackCalls: 0,
                wrapGraphemeFallbackMs: 0,
                wrapGraphemeFallbackSegments: 0,
                textMeasurementCacheHits: 0,
                textMeasurementCacheMisses: 0,
                flowResolveSignatureCalls: 0,
                flowResolveSignatureUniqueCalls: 0,
                flowResolveSignatureRepeatedCalls: 0,
                flowResolveSignatureContinuationCalls: 0,
                flowResolveSignatureRepeatedContinuationCalls: 0,
                simpleProseEligibleCalls: 0,
                simpleProseIneligibleInlineObjectCalls: 0,
                simpleProseIneligibleMixedStyleCalls: 0,
                simpleProseIneligibleComplexScriptCalls: 0,
                simpleProseIneligibleRichStructureCalls: 0,
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
        colliderFieldQueryCalls: 0,
        colliderFieldBucketTouches: 0,
        colliderFieldCandidateColliders: 0,
        colliderFieldNarrowphaseCalls: 0,
        observerCheckpointSweepCalls: 0,
        observerSettleCalls: 0,
        observerActorBoundarySettles: 0,
        observerPageBoundarySettles: 0,
        actorActivationAwakenCalls: 0,
        actorActivationSignalWakeCalls: 0,
        actorActivationLifecycleWakeCalls: 0,
        actorActivationScheduledWakeCalls: 0,
        actorActivationDormantSkips: 0,
        actorUpdateCalls: 0,
        actorUpdateMs: 0,
        actorUpdateContentOnlyCalls: 0,
        actorUpdateGeometryCalls: 0,
        actorUpdateNoopCalls: 0,
        actorUpdateRedrawCalls: 0,
        actorUpdateResettlementCycles: 0,
        actorUpdateRepeatedStateDetections: 0,
        actorUpdateResettlementCapHits: 0,
        simulationTickCount: 0,
        progressionStopCalls: 0,
        progressionResumeCalls: 0,
        progressionSnapshotCalls: 0
    };
    private paginationLoopState: PaginationLoopState | null = null;
    private speculativeBranchSequence = 0;
    private readonly flowResolveSignaturesSeen = new Set<string>();
    private scriptReplayRequested = false;

    currentPageIndex = 0;
    currentY = 0;
    currentConstraintField: ConstraintField | null = null;
    currentSurface: PageSurface | null = null;

    requestScriptReplay(): void {
        this.scriptReplayRequested = true;
    }

    consumeScriptReplayRequested(): boolean {
        const value = this.scriptReplayRequested;
        this.scriptReplayRequested = false;
        return value;
    }

    constructor(options: LayoutSessionOptions) {
        this.runtime = options.runtime;
        this.asyncThoughtHost = options.asyncThoughtHost ?? null;
        this.collaborators = options.collaborators ?? [];
        this.eventDispatcher = new EventDispatcher(this.collaborators);
        this.actorCommunicationRuntime = new ActorCommunicationRuntime({
            recordObserverCheckpointSweep: () => this.recordProfile('observerCheckpointSweepCalls', 1),
            recordProfile: (metric, delta) => this.recordProfile(metric, delta)
        });
        this.fragmentSessionRuntime = new FragmentSessionRuntime(this.kernel, {
            notifyActorSpawn: (actor) => this.notifyActorSpawn(actor),
            notifyContinuationEnqueued: (predecessor, successor) => this.notifyContinuationEnqueued(predecessor, successor),
            notifySplitAccepted: (attempt, result) => this.notifySplitAccepted(attempt, result),
            notifyActorCommitted: (actor, committed) => this.notifyActorCommitted(actor, committed),
            captureSessionBranchStateSnapshot: (actorQueue) => this.captureSessionBranchStateSnapshot(actorQueue),
            restoreSessionBranchStateSnapshot: (actorQueue, snapshot) => this.restoreSessionBranchStateSnapshot(actorQueue, snapshot),
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
            executeSpeculativeBranch: (input) => this.executeSpeculativeBranch(input),
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
            recordActorMeasurementByKind: (actorKind, durationMs) => this.recordActorMeasurementByKind(actorKind, durationMs),
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
        this.simulationReportBridge = new SimulationReportBridge({
            getFinalizedPages: () => this.sessionCollaborationRuntime.getFinalizedPages(),
            getRegisteredActors: () => this.getRegisteredActors(),
            getFragmentTransitions: () => this.getFragmentTransitions(),
            getPublishedArtifacts: () => this.getPublishedArtifacts(),
            getProfileSnapshot: () => this.getProfileSnapshot(),
            getSimulationWorldSummary: () => this.sessionWorldRuntime.getSimulationWorldSummary(),
            getSimulationProgressionSummary: () => this.sessionWorldRuntime.getSimulationProgressionSummary(),
            getSimulationCaptureSummary: () => this.sessionWorldRuntime.getSimulationCaptureSummary(),
            onSimulationComplete: () => this.sessionCollaborationRuntime.onSimulationComplete()
        });
        this.sessionCollaborationRuntime = new SessionCollaborationRuntime(
            this.eventDispatcher,
            this.lifecycleRuntime,
            this.sessionWorldRuntime,
            this.simulationReportBridge,
            {
                getCollaboratorHost: () => this.collaboratorHost,
                getCurrentPageIndex: () => this.currentPageIndex,
                getProfileSnapshot: () => this.profile
            }
        );
        this.liveRuntimeHost = new SessionLiveRuntimeHost({
            publishResolvedSignal: (signal) => this.actorCommunicationRuntime.publishActorSignal(signal),
            getCurrentPageIndex: () => this.currentPageIndex,
            getCurrentCursorY: () => this.currentY,
            getCurrentSurfaceHeight: () => Number.isFinite(this.currentSurface?.height) ? Number(this.currentSurface?.height) : null,
            getSimulationTick: () => this.simulationClock.tick,
            getPaginationLoopState: () => this.paginationLoopState
        });
        this.collaboratorHost = new SessionCollaboratorHost({
            collaborationRuntime: this.sessionCollaborationRuntime,
            recordProfile: (metric, delta) => this.recordProfile(metric, delta),
            recordKeepWithNextPrepare: (actorKind, durationMs) => this.recordKeepWithNextPrepare(actorKind, durationMs),
            publishActorSignal: (signal) => this.liveRuntimeHost.publishActorSignal(signal),
            getPaginationLoopState: () => this.liveRuntimeHost.getPaginationLoopState(),
            getActorSignalSequence: () => this.actorCommunicationRuntime.getActorSignalSequence(),
            getKeepWithNextPlan: (actorId, signature) => this.aiRuntime.getKeepWithNextPlan(actorId, signature),
            setKeepWithNextPlan: (actorId, plan, signature) => this.aiRuntime.setKeepWithNextPlan(actorId, plan, signature),
            getSplitMarkerReserve: (actor) => this.transitionsRuntime.getSplitMarkerReserve(actor),
            ensureContinuationArtifacts: (actor) => this.transitionsRuntime.ensureContinuationArtifacts(actor),
            stageMarkersAfterSplit: (fragmentActorId, markers) => this.fragmentSessionRuntime.stageMarkersAfterSplit(fragmentActorId, markers),
            stageActorsBeforeContinuation: (continuationActorId, actors) => this.fragmentSessionRuntime.stageActorsBeforeContinuation(continuationActorId, actors),
            getSimulationTick: () => this.simulationClock.tick,
            getRegisteredActors: () => this.kernel.actorRegistry,
            getFragmentTransitionSourceIds: () => this.kernel.getFragmentTransitionSourceIds(),
            getFragmentTransitionsBySource: (sourceActorId) => this.kernel.getFragmentTransitionsBySource(sourceActorId),
            notifyActorSpawn: (actor) => this.notifyActorSpawn(actor)
        });
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
                speculativeReason,
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
                speculativeReason,
                contextBase,
                shouldAdvancePageOnFailure,
                positionMarker
            ),
            recordProfile: (metric, delta) => this.recordProfile(metric, delta),
            recordKeepWithNextPrepare: (actorKind, durationMs) => this.recordKeepWithNextPrepare(actorKind, durationMs),
            getSplitMarkerReserve: (actor) => this.getSplitMarkerReserve(actor),
            getActorSignalSequence: () => this.getActorSignalSequence()
        });
    }

    notifySimulationStart(): void {
        this.kernel.resetForSimulation();
        this.actorCommunicationRuntime.resetForSimulation();
        this.lifecycleRuntime.resetForSimulation();
        this.sessionWorldRuntime.resetForSimulation();
        this.eventDispatcher.onSimulationStart(this.collaboratorHost);
    }

    publishActorSignal(signal: ActorSignalDraft): ActorSignal {
        return this.liveRuntimeHost.publishActorSignal(signal);
    }

    getActorSignals(topic?: string): readonly ActorSignal[] {
        return this.actorCommunicationRuntime.getActorSignals(topic);
    }

    getActorSignalSequence(): number {
        return this.actorCommunicationRuntime.getActorSignalSequence();
    }

    notifyActorSpawn(actor: PackagerUnit): void {
        this.kernel.registerActor(actor);
        this.actorCommunicationRuntime.notifyActorSpawn(actor);
        this.eventDispatcher.onActorSpawn(actor, this.collaboratorHost);
        const hostedActors = getHostedRuntimeActors(actor);
        for (const hostedActor of hostedActors) {
            this.notifyActorSpawn(hostedActor);
        }
    }

    notifyActorDespawn(actor: PackagerUnit): void {
        const hostedActors = getHostedRuntimeActors(actor);
        for (const hostedActor of hostedActors) {
            this.notifyActorDespawn(hostedActor);
        }
        this.kernel.unregisterActor(actor);
        this.actorCommunicationRuntime.notifyActorDespawn(actor);
    }

    noteActorRuntimeIndex(actor: PackagerUnit, actorIndex: number): void {
        this.actorCommunicationRuntime.noteActorIndex(actor, actorIndex);
    }

    resolveActorRuntimeFrontier(
        actor: PackagerUnit,
        options?: {
            actorIndex?: number;
            actorId?: string;
            sourceId?: string;
        }
    ): SpatialFrontier | null {
        const owner = findHostedActorController(this.kernel.actorRegistry, actor) ?? actor;
        const state = this.paginationLoopState;
        const finalizedPages = this.getFinalizedPages();
        const currentPageBoxes = state?.paginationState.currentPageBoxes ?? [];
        const currentPageIndex = state?.paginationState.currentPageIndex ?? this.currentPageIndex;
        const refs = collectActorBoxRefs(finalizedPages as Page[], currentPageBoxes, currentPageIndex, owner.actorId);
        const queueIndex = state?.actorQueue.findIndex((entry) => entry.actorId === owner.actorId);
        const resolvedActorIndexCandidate =
            options?.actorIndex
            ?? this.actorCommunicationRuntime.resolveKnownActorIndex(owner)
            ?? (queueIndex !== undefined && queueIndex >= 0 ? queueIndex : undefined);
        const resolvedActorIndex = Number.isFinite(resolvedActorIndexCandidate) && Number(resolvedActorIndexCandidate) >= 0
            ? Number(resolvedActorIndexCandidate)
            : undefined;
        const checkpointFrontier = this.actorCommunicationRuntime.resolveActorCheckpointFrontier(owner, resolvedActorIndex)
            ?? (Number.isFinite(resolvedActorIndex)
                ? this.actorCommunicationRuntime.resolveQueueCheckpointFrontier(Number(resolvedActorIndex))
                : undefined);

        if (checkpointFrontier) {
            return {
                ...checkpointFrontier,
                ...(Number.isFinite(resolvedActorIndex) ? { actorIndex: resolvedActorIndex } : {}),
                actorId: owner.actorId,
                sourceId: owner.sourceId
            };
        }

        if (refs.length > 0) {
            let earliest = refs[0];
            for (const ref of refs.slice(1)) {
                const currentY = Number(ref.box.y || 0);
                const earliestY = Number(earliest.box.y || 0);
                if (
                    ref.pageIndex < earliest.pageIndex
                    || (ref.pageIndex === earliest.pageIndex && currentY < earliestY)
                ) {
                    earliest = ref;
                }
            }

            const pageHeight =
                finalizedPages.find((page) => page.index === earliest.pageIndex)?.height
                ?? (earliest.pageIndex === currentPageIndex
                    ? state?.context.pageHeight ?? this.currentSurface?.height
                    : this.currentSurface?.height);
            const cursorY = Number(earliest.box.y || 0);
            const chunkOriginWorldY = Number.isFinite(pageHeight)
                ? this.resolveChunkOriginWorldY(earliest.pageIndex, Number(pageHeight))
                : undefined;
            return {
                pageIndex: earliest.pageIndex,
                cursorY,
                ...(Number.isFinite(chunkOriginWorldY)
                    ? { worldY: Math.max(0, Number(chunkOriginWorldY) + cursorY) }
                    : {}),
                ...(Number.isFinite(resolvedActorIndex) ? { actorIndex: Number(resolvedActorIndex) } : {}),
                actorId: owner.actorId,
                sourceId: owner.sourceId
            };
        }

        if (Number.isFinite(resolvedActorIndex) && state) {
            return {
                pageIndex: state.paginationState.currentPageIndex,
                cursorY: state.paginationState.currentY,
                ...(Number.isFinite(this.currentSurface?.height)
                    ? {
                        worldY: Math.max(
                            0,
                            state.paginationState.currentPageIndex * Number(this.currentSurface?.height) + state.paginationState.currentY
                        )
                    }
                    : {}),
                actorIndex: Number(resolvedActorIndex),
                actorId: owner.actorId,
                sourceId: owner.sourceId
            };
        }

        return null;
    }

    resolveRuntimeFrontierAtActorIndex(actorIndex: number): SpatialFrontier | null {
        if (!Number.isFinite(actorIndex)) {
            return null;
        }

        const resolvedActorIndex = Number(actorIndex);
        const checkpointFrontier = this.actorCommunicationRuntime.resolveQueueCheckpointFrontier(resolvedActorIndex);
        if (checkpointFrontier) {
            return {
                ...checkpointFrontier,
                actorIndex: resolvedActorIndex
            };
        }

        const state = this.paginationLoopState;
        if (!state) {
            return null;
        }

        const currentPageIndex = state.paginationState.currentPageIndex;
        const currentY = state.paginationState.currentY;
        const pageHeight = this.currentSurface?.height;
        const chunkOriginWorldY = Number.isFinite(pageHeight)
            ? this.resolveChunkOriginWorldY(currentPageIndex, Number(pageHeight))
            : undefined;
        return {
            pageIndex: currentPageIndex,
            cursorY: currentY,
            ...(Number.isFinite(chunkOriginWorldY)
                ? { worldY: Math.max(0, Number(chunkOriginWorldY) + currentY) }
                : {}),
            actorIndex: resolvedActorIndex
        };
    }

    invalidateSafeCheckpointsAfterFrontier(frontier: SpatialFrontier): void {
        this.actorCommunicationRuntime.invalidateSafeCheckpointsAfterFrontier(frontier);
    }

    insertActorsInLiveQueue(
        targetActor: PackagerUnit,
        insertions: readonly PackagerUnit[],
        position: 'before' | 'after',
        sourceElements?: readonly Element[]
    ): number | null {
        if (insertions.length === 0) return null;
        const state = this.paginationLoopState;
        if (!state) return null;
        const actorQueue = state.actorQueue;
        const index = actorQueue.findIndex((actor) => actor.actorId === targetActor.actorId);
        if (index < 0) {
            return this.insertHostedActorsInLiveQueue(targetActor, insertions, position, sourceElements);
        }

        const insertionIndex = position === 'before' ? index : index + 1;
        actorQueue.splice(insertionIndex, 0, ...insertions);
        this.actorCommunicationRuntime.insertActorsInCheckpointQueues(targetActor.actorId, insertions, position);
        for (const actor of insertions) {
            this.notifyActorSpawn(actor);
        }

        return insertionIndex;
    }

    prependActorsInLiveQueue(insertions: readonly PackagerUnit[]): number | null {
        if (insertions.length === 0) return null;
        const state = this.paginationLoopState;
        if (!state) return null;
        const actorQueue = state.actorQueue;
        const anchor = actorQueue[0] ?? null;
        actorQueue.splice(0, 0, ...insertions);
        if (anchor) {
            this.actorCommunicationRuntime.insertActorsInCheckpointQueues(anchor.actorId, insertions, 'before');
        }
        for (const actor of insertions) {
            this.notifyActorSpawn(actor);
        }
        state.actorIndex += insertions.length;
        return 0;
    }

    appendActorsInLiveQueue(insertions: readonly PackagerUnit[]): number | null {
        if (insertions.length === 0) return null;
        const state = this.paginationLoopState;
        if (!state) return null;
        const actorQueue = state.actorQueue;
        const anchor = actorQueue[actorQueue.length - 1] ?? null;
        const insertionIndex = actorQueue.length;
        actorQueue.push(...insertions);
        if (anchor) {
            this.actorCommunicationRuntime.insertActorsInCheckpointQueues(anchor.actorId, insertions, 'after');
        }
        for (const actor of insertions) {
            this.notifyActorSpawn(actor);
        }
        return insertionIndex;
    }

    deleteActorInLiveQueue(targetActor: PackagerUnit): number | null {
        const state = this.paginationLoopState;
        if (!state) return null;
        const actorQueue = state.actorQueue;
        const index = actorQueue.findIndex((actor) => actor.actorId === targetActor.actorId);
        if (index < 0) {
            return this.deleteHostedActorInLiveQueue(targetActor);
        }

        actorQueue.splice(index, 1);
        this.notifyActorDespawn(targetActor);
        this.actorCommunicationRuntime.deleteActorInCheckpointQueues(targetActor.actorId);

        if (state.actorIndex > index) {
            state.actorIndex -= 1;
        } else if (state.actorIndex === index) {
            state.actorIndex = Math.max(0, index);
        }

        return index;
    }

    replaceActorInLiveQueue(
        targetActor: PackagerUnit,
        replacements: readonly PackagerUnit[],
        sourceElements?: readonly Element[]
    ): number | null {
        const state = this.paginationLoopState;
        if (!state) return null;
        const actorQueue = state.actorQueue;
        const index = actorQueue.findIndex((actor) => actor.actorId === targetActor.actorId);
        if (index < 0) {
            return this.replaceHostedActorInLiveQueue(targetActor, replacements, sourceElements);
        }

        actorQueue.splice(index, 1, ...replacements);
        this.notifyActorDespawn(targetActor);
        this.actorCommunicationRuntime.replaceActorInCheckpointQueues(targetActor.actorId, replacements);
        for (const actor of replacements) {
            this.notifyActorSpawn(actor);
        }

        if (state.actorIndex > index) {
            state.actorIndex = state.actorIndex - 1 + replacements.length;
        } else if (state.actorIndex === index) {
            state.actorIndex = index;
        }

        return index;
    }

    private insertHostedActorsInLiveQueue(
        targetActor: PackagerUnit,
        insertions: readonly PackagerUnit[],
        position: 'before' | 'after',
        sourceElements?: readonly Element[]
    ): number | null {
        const state = this.paginationLoopState;
        if (!state) return null;
        const host = findHostedActorController(this.kernel.actorRegistry, targetActor);
        if (!host) return null;
        const inserted = host.insertHostedRuntimeActors?.(targetActor, insertions, position, sourceElements);
        if (!inserted) return null;
        for (const actor of insertions) {
            this.notifyActorSpawn(actor);
        }
        return state.actorQueue.findIndex((actor) => actor.actorId === host.actorId);
    }

    private deleteHostedActorInLiveQueue(targetActor: PackagerUnit): number | null {
        const state = this.paginationLoopState;
        if (!state) return null;
        const host = findHostedActorController(this.kernel.actorRegistry, targetActor);
        if (!host) return null;
        const deleted = host.deleteHostedRuntimeActor?.(targetActor);
        if (!deleted) return null;
        this.notifyActorDespawn(targetActor);
        return state.actorQueue.findIndex((actor) => actor.actorId === host.actorId);
    }

    private replaceHostedActorInLiveQueue(
        targetActor: PackagerUnit,
        replacements: readonly PackagerUnit[],
        sourceElements?: readonly Element[]
    ): number | null {
        const state = this.paginationLoopState;
        if (!state) return null;
        const host = findHostedActorController(this.kernel.actorRegistry, targetActor);
        if (!host) return null;
        const replaced = host.replaceHostedRuntimeActor?.(targetActor, replacements, sourceElements);
        if (!replaced) return null;
        this.notifyActorDespawn(targetActor);
        for (const actor of replacements) {
            this.notifyActorSpawn(actor);
        }
        return state.actorQueue.findIndex((actor) => actor.actorId === host.actorId);
    }

    noteHostedRuntimeActorContentMutation(targetActor: PackagerUnit): number | null {
        const state = this.paginationLoopState;
        if (!state) return null;
        const host = findHostedActorController(this.kernel.actorRegistry, targetActor);
        if (!host) return null;
        const refreshed = host.refreshHostedRuntimeActor?.(targetActor);
        if (!refreshed) return null;
        return state.actorQueue.findIndex((actor) => actor.actorId === host.actorId);
    }

    hasCommittedSignalObservers(): boolean {
        return this.actorCommunicationRuntime.hasCommittedSignalObservers();
    }

    hasSteppedActors(): boolean {
        return this.actorCommunicationRuntime.hasSteppedActors();
    }

    hasActiveSteppedActors(
        contextBase: Omit<PackagerContext, 'pageIndex' | 'cursorY'>,
        pageIndex: number,
        cursorY: number
    ): boolean {
        return this.actorCommunicationRuntime.hasActiveSteppedActors(contextBase, pageIndex, cursorY);
    }

    notifyPageStart(pageIndex: number, width: number, height: number, boxes: Box[]): void {
        this.currentPageIndex = pageIndex;
        this.currentSurface = new PageSurface(pageIndex, width, height, boxes);
        this.kernel.beginPage();
        this.eventDispatcher.onPageStart(pageIndex, this.currentSurface, this.collaboratorHost);
    }

    notifyConstraintNegotiation(actor: PackagerUnit, constraints: ConstraintField): void {
        this.currentConstraintField = constraints;
        const startedAt = performance.now();
        this.recordProfile('reservationConstraintNegotiationCalls', 1);
        const actorZIndex = resolvePackagerZIndex(actor);
        for (const reservation of this.kernel.getCurrentPageReservations()) {
            constraints.reservations.push({ ...reservation });
            this.recordProfile('reservationConstraintApplications', 1);
        }
        for (const exclusion of this.kernel.getCurrentPageExclusions()) {
            if (Number.isFinite(exclusion.zIndex) && Number(exclusion.zIndex) !== actorZIndex) {
                continue;
            }
            constraints.exclusions.push({ ...exclusion });
        }
        this.recordProfile('reservationConstraintNegotiationMs', performance.now() - startedAt);
        this.eventDispatcher.onConstraintNegotiation(actor, constraints, this.collaboratorHost);
    }

    notifyActorPrepared(actor: PackagerUnit): void {
        const startedAt = performance.now();
        this.recordProfile('actorPreparedDispatchCalls', 1);
        this.eventDispatcher.onActorPrepared(actor, this.collaboratorHost);
        this.recordProfile('actorPreparedDispatchMs', performance.now() - startedAt);
    }

    notifySplitAttempt(attempt: SplitAttempt): void {
        this.eventDispatcher.onSplitAttempt(attempt, this.collaboratorHost);
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
            result: actor.reshape(availableHeight, context)
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
        const marginTop = actor.getLeadingSpacing();
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

    notifySplitAccepted(attempt: SplitAttempt, result: PackagerReshapeResult): void {
        this.kernel.registerSplitAccepted(attempt, result);
        this.eventDispatcher.onSplitAccepted(attempt, result, this.collaboratorHost);
    }

    notifyActorCommitted(actor: PackagerUnit, committed: Box[]): void {
        if (!this.currentSurface) return;
        this.eventDispatcher.onActorCommitted(actor, committed, this.currentSurface, this.collaboratorHost);
    }

    notifyContinuationProduced(predecessor: PackagerUnit, successor: PackagerUnit): void {
        this.kernel.markContinuationProduced(successor);
        this.eventDispatcher.onContinuationProduced(predecessor, successor, this.collaboratorHost);
    }

    notifyContinuationEnqueued(predecessor: PackagerUnit, successor: PackagerUnit): void {
        this.kernel.markContinuationEnqueued(predecessor, successor);
        this.eventDispatcher.onContinuationEnqueued(predecessor, successor, this.collaboratorHost);
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
        currentPageHeight: number,
        lastSpacingAfter: number,
        kind: 'page' | 'actor'
    ): SessionSafeCheckpoint {
        return this.actorCommunicationRuntime.recordSafeCheckpoint(
            actorQueue,
            actorIndex,
            pagesPrefix,
            currentPageBoxes,
            currentPageIndex,
            currentY,
            Math.max(0, currentPageIndex * currentPageHeight + currentY),
            kind,
            () => this.fragmentSessionRuntime.captureLocalTransitionSnapshot(currentPageBoxes, currentY, lastSpacingAfter),
            () => this.captureSessionBranchStateSnapshot(actorQueue)
        );
    }

    evaluateObserverRegistry(
        contextBase: Omit<PackagerContext, 'pageIndex' | 'cursorY'>,
        pageIndex: number,
        cursorY: number
    ): ObserverSweepResult {
        return this.actorCommunicationRuntime.evaluateObserverRegistry(contextBase, pageIndex, cursorY);
    }

    evaluateSteppedActors(
        contextBase: Omit<PackagerContext, 'pageIndex' | 'cursorY'>,
        pageIndex: number,
        cursorY: number
    ): ObserverSweepResult {
        return this.actorCommunicationRuntime.evaluateSteppedActors(contextBase, pageIndex, cursorY);
    }

    resolveSafeCheckpoint(frontier: SpatialFrontier): SessionSafeCheckpoint | null {
        return this.actorCommunicationRuntime.resolveSafeCheckpoint(frontier);
    }

    restoreSafeCheckpoint(
        pages: Page[],
        actorQueue: PackagerUnit[],
        checkpoint: SessionSafeCheckpoint
    ): { currentPageBoxes: Box[]; currentY: number; lastSpacingAfter: number } {
        this.recordProfile('progressionSnapshotCalls', 1);
        return this.sessionWorldRuntime.preserveCurrentProgressionState(() =>
            this.actorCommunicationRuntime.restoreSafeCheckpoint(
                pages,
                actorQueue,
                checkpoint,
                (restoredQueue, snapshot) => this.restoreSessionBranchStateSnapshot(restoredQueue, snapshot)
            )
        );
    }

    executeSpeculativeBranch<T>(
        input: ExecuteSpeculativeBranchInput<T>
    ): ExecuteSpeculativeBranchResult<T> {
        const startedAt = performance.now();
        const snapshot = this.fragmentSessionRuntime.captureLocalBranchSnapshot(
            input.pageBoxes,
            input.actorQueue,
            input.currentY,
            input.lastSpacingAfter
        );
        const branchId = `speculative:${++this.speculativeBranchSequence}`;
        this.recordProfile('speculativeBranchCalls', 1);

        const context: SpeculativeBranchContext = {
            reason: input.reason,
            branchId,
            frontier: input.frontier,
            getCurrentY: () => input.currentY,
            getLastSpacingAfter: () => input.lastSpacingAfter,
            getCurrentPageIndex: () => input.currentPageIndex,
            captureNote: () => { }
        };

        try {
            const resolution = input.run(context);
            const durationMs = performance.now() - startedAt;
            this.recordSpeculativeBranchByReason(input.reason, durationMs, resolution.accept === true);
            if (resolution.accept) {
                this.recordProfile('speculativeBranchAcceptedCalls', 1);
                return {
                    accepted: true,
                    value: resolution.value,
                    currentY: input.currentY,
                    lastSpacingAfter: input.lastSpacingAfter
                };
            }

            const restored = this.fragmentSessionRuntime.restoreLocalBranchSnapshot(
                input.pageBoxes,
                input.actorQueue,
                snapshot
            );
            this.recordProfile('speculativeBranchRollbackCalls', 1);
            return {
                accepted: false,
                value: resolution.value,
                currentY: restored.currentY,
                lastSpacingAfter: restored.lastSpacingAfter
            };
        } catch (error) {
            const durationMs = performance.now() - startedAt;
            this.fragmentSessionRuntime.restoreLocalBranchSnapshot(
                input.pageBoxes,
                input.actorQueue,
                snapshot
            );
            this.recordSpeculativeBranchByReason(input.reason, durationMs, false);
            this.recordProfile('speculativeBranchRollbackCalls', 1);
            throw error;
        }
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

    applyContentOnlyActorUpdates(
        pages: Page[],
        currentPageBoxes: Box[],
        actors: readonly PackagerUnit[],
        contextBase: Omit<PackagerContext, 'pageIndex' | 'cursorY'>
    ): { patchedActors: number; pageIndexes: number[] } {
        let patchedActors = 0;
        const touchedPageIndexes = new Set<number>();
        const actorBoxRefs = collectActorBoxRefsByActorId(pages, currentPageBoxes, this.currentPageIndex);
        for (const actor of actors) {
            const refs = actorBoxRefs.get(actor.actorId) ?? [];
            if (refs.length === 0) continue;

            const first = refs[0].box;
            const pageIndex = refs[0].pageIndex;
            const cursorY = refs.reduce((best, ref) => Math.min(best, Number(ref.box.y || 0)), Number.POSITIVE_INFINITY);
            const context: PackagerContext = {
                ...contextBase,
                pageIndex,
                cursorY: Number.isFinite(cursorY) ? cursorY : 0,
                publishActorSignal: bindPackagerSignalPublisher(
                    contextBase.publishActorSignal,
                    pageIndex,
                    Number.isFinite(cursorY) ? cursorY : 0,
                    this.currentSurface && pageIndex === this.currentPageIndex && Number.isFinite(cursorY)
                        ? pageIndex * this.currentSurface.height + Number(cursorY)
                        : undefined
                )
            };
            const availableWidth = Math.max(0, contextBase.pageWidth - contextBase.margins.left - contextBase.margins.right);
            const availableHeight = Math.max(0, contextBase.pageHeight - context.cursorY - contextBase.margins.bottom);
            actor.prepare(availableWidth, availableHeight, context);
            const rendered = actor.emitBoxes(availableWidth, availableHeight, context) ?? [];

            if (rendered.length !== refs.length && !(rendered.length === 1 && refs.length > 1)) {
                throw new Error(
                    `[LayoutSession] content-only actor "${actor.actorId}" changed box count (${refs.length} -> ${rendered.length}).`
                );
            }

            for (let index = 0; index < refs.length; index++) {
                const oldBox = refs[index].box;
                const nextBox = rendered[Math.min(index, rendered.length - 1)];
                assertContentOnlyGeometry(actor.actorId, oldBox, nextBox);
                refs[index].container[refs[index].index] = transplantBoxContent(oldBox, nextBox);
            }

            this.recordProfile('actorUpdateRedrawCalls', 1);
            patchedActors += 1;
            touchedPageIndexes.add(pageIndex);
        }
        this.sessionCollaborationRuntime.bumpPageRenderRevisions(touchedPageIndexes);
        return {
            patchedActors,
            pageIndexes: Array.from(touchedPageIndexes).sort((a, b) => a - b)
        };
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

    getPageRegionSummaries(): readonly PageRegionSummary[] {
        return this.sessionCollaborationRuntime.getPageRegionSummaries();
    }

    getScriptRegions(): readonly ScriptRegionRef[] {
        return this.sessionCollaborationRuntime.getScriptRegions();
    }

    findScriptRegionByName(name: string): ScriptRegionRef | null {
        return this.sessionCollaborationRuntime.findScriptRegionByName(name);
    }

    recordPageCapture(record: PageCaptureRecord): void {
        this.sessionCollaborationRuntime.recordPageCapture(record);
    }

    createPageCaptureState(params: {
        pageIndex: number;
        worldTopY: number;
        pageWidth: number;
        pageHeight: number;
        margins: { top: number; right: number; bottom: number; left: number };
        headerRect?: ViewportRect | null;
        footerRect?: ViewportRect | null;
    }): PageCaptureState {
        return this.sessionWorldRuntime.createPageCaptureState(params);
    }

    getPageCapture(pageIndex: number): PageCaptureRecord | undefined {
        return this.sessionCollaborationRuntime.getPageCapture(pageIndex);
    }

    getPageCaptures(): readonly PageCaptureRecord[] {
        return this.sessionCollaborationRuntime.getPageCaptures();
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

    getWorldTraversalExclusions(pageIndex: number): readonly SpatialExclusion[] {
        return this.sessionCollaborationRuntime.getWorldTraversalExclusions(pageIndex);
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

    getSimulationTick(): number {
        return this.sessionWorldRuntime.getCurrentTick();
    }

    requestAsyncThought(request: AsyncThoughtRequest): AsyncThoughtHandle | undefined {
        return this.asyncThoughtHost?.request(request);
    }

    readAsyncThoughtResult(key: string): AsyncThoughtHandle | undefined {
        return this.asyncThoughtHost?.read(key);
    }

    hasPendingAsyncThoughts(): boolean {
        return this.asyncThoughtHost?.hasPending() ?? false;
    }

    setSimulationProgressionPolicy(policy: SimulationProgressionPolicy): void {
        this.sessionWorldRuntime.setSimulationProgressionPolicy(policy);
    }

    configureSimulationRun(config: Required<SimulationProgressionConfig>): void {
        this.sessionWorldRuntime.configureSimulationRun(config);
    }

    beginSimulationRun(config: Required<SimulationProgressionConfig>): void {
        this.sessionWorldRuntime.beginSimulationRun(config);
        this.sessionWorldRuntime.resumeSimulationProgression();
    }

    getSimulationProgressionPolicy(): SimulationProgressionPolicy {
        return this.sessionWorldRuntime.getSimulationProgressionPolicy();
    }

    setSimulationCapturePolicy(policy: SimulationCapturePolicy, maxTicks: number | null = null): void {
        this.sessionWorldRuntime.setSimulationCapturePolicy(policy, maxTicks);
    }

    getSimulationCapturePolicy(): SimulationCapturePolicy {
        return this.sessionWorldRuntime.getSimulationCapturePolicy();
    }

    getSimulationCaptureMaxTicks(): number | null {
        return this.sessionWorldRuntime.getSimulationCaptureMaxTicks();
    }

    getSimulationWorldSummary(): SimulationWorldSummary {
        return this.sessionWorldRuntime.getSimulationWorldSummary();
    }

    getSimulationProgressionSummary() {
        return this.sessionWorldRuntime.getSimulationProgressionSummary();
    }

    getSimulationCaptureSummary() {
        return this.sessionWorldRuntime.getSimulationCaptureSummary();
    }

    getSimulationStopReason(): SimulationStopReason {
        return this.sessionWorldRuntime.getSimulationStopReason();
    }

    shouldContinueAfterPaginationFinalized(input: {
        currentTick: number;
        hasActiveSteppedActors: boolean;
    }): boolean {
        return this.sessionWorldRuntime.shouldContinueAfterPaginationFinalized(input);
    }

    resolveSimulationStopReason(currentTick: number): SimulationStopReason {
        return this.sessionWorldRuntime.resolveSimulationStopReason(currentTick);
    }

    isSimulationProgressionStopped(): boolean {
        return !this.sessionWorldRuntime.isSimulationProgressionActive();
    }

    advanceSimulationTickRaw(): number {
        const previousTick = this.getSimulationTick();
        const nextTick = this.simulationClock.advance();
        if (nextTick !== previousTick) {
            this.recordProfile('simulationTickCount', 1);
        }
        return nextTick;
    }

    advanceSimulationTick(): number {
        return this.sessionWorldRuntime.advanceSimulationTick();
    }

    stopSimulationProgression(reason: SimulationStopReason = 'settled'): void {
        this.sessionWorldRuntime.stopSimulationProgression(reason);
    }

    resumeSimulationProgression(): void {
        this.sessionWorldRuntime.resumeSimulationProgression();
    }

    captureSessionBranchStateSnapshot(actorQueue: readonly PackagerUnit[]): SessionBranchStateSnapshot {
        return this.sessionWorldRuntime.captureSessionBranchStateSnapshot(actorQueue);
    }

    restoreSessionBranchStateSnapshot(
        actorQueue: PackagerUnit[],
        snapshot: SessionBranchStateSnapshot
    ): void {
        this.sessionWorldRuntime.restoreSessionBranchStateSnapshot(actorQueue, snapshot);
    }

    getCurrentPageIndex(): number {
        return this.currentPageIndex;
    }

    resolveChunkOriginWorldY(chunkIndex: number, chunkHeight: number): number {
        return this.lifecycleRuntime.resolveChunkOriginWorldY(chunkIndex, chunkHeight);
    }

    getSimulationTickRaw(): number {
        return this.simulationClock.tick;
    }

    isSimulationProgressionStoppedRaw(): boolean {
        return this.simulationClock.isStopped;
    }

    resumeSimulationProgressionClockRaw(): boolean {
        if (!this.simulationClock.isStopped) return false;
        this.simulationClock.resume();
        return true;
    }

    stopSimulationProgressionClockRaw(): boolean {
        if (this.simulationClock.isStopped) return false;
        this.simulationClock.stop();
        return true;
    }

    captureSimulationClockSnapshotRaw(): SimulationClockSnapshot {
        return this.simulationClock.captureSnapshot();
    }

    restoreSimulationClockSnapshotRaw(snapshot: SimulationClockSnapshot): void {
        this.simulationClock.restoreSnapshot(snapshot);
    }

    recordReservationWrite(): void {
        this.recordProfile('reservationWrites', 1);
    }

    recordProgressionStop(): void {
        this.recordProfile('progressionStopCalls', 1);
    }

    recordProgressionResume(): void {
        this.recordProfile('progressionResumeCalls', 1);
    }

    recordProgressionSnapshot(): void {
        this.recordProfile('progressionSnapshotCalls', 1);
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

    setKeepWithNextPlan(actorId: string, plan: KeepWithNextFormationPlan, signature?: string | null): void {
        this.aiRuntime.setKeepWithNextPlan(actorId, plan, signature);
    }

    getKeepWithNextPlan(actorId: string, signature?: string | null): KeepWithNextFormationPlan | undefined {
        return this.aiRuntime.getKeepWithNextPlan(actorId, signature);
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

    recordSpeculativeBranchByReason(reason: SpeculativeBranchReason, durationMs: number, accepted: boolean): void {
        const normalizedReason = reason || 'other';
        const duration = Number.isFinite(durationMs) ? Number(durationMs) : 0;
        const entry = this.profile.speculativeBranchByReason[normalizedReason] ?? {
            calls: 0,
            ms: 0,
            acceptedCalls: 0,
            rollbackCalls: 0
        };
        entry.calls += 1;
        entry.ms += duration;
        if (accepted) {
            entry.acceptedCalls += 1;
        } else {
            entry.rollbackCalls += 1;
        }
        this.profile.speculativeBranchByReason[normalizedReason] = entry;
        this.recordProfile('speculativeBranchMs', duration);
    }

    recordActorMeasurementByKind(actorKind: string, durationMs: number): void {
        const normalizedKind = actorKind || 'unknown';
        const duration = Number.isFinite(durationMs) ? Number(durationMs) : 0;
        const entry = this.profile.actorMeasurementByKind[normalizedKind] ?? { calls: 0, ms: 0 };
        entry.calls += 1;
        entry.ms += duration;
        this.profile.actorMeasurementByKind[normalizedKind] = entry;
    }

    recordKeepWithNextPrepare(actorKind: string, durationMs: number): void {
        const normalizedKind = actorKind || 'unknown';
        const entry = this.profile.keepWithNextPrepareByKind[normalizedKind] ?? { calls: 0, ms: 0 };
        entry.calls += 1;
        entry.ms += Number.isFinite(durationMs) ? Number(durationMs) : 0;
        this.profile.keepWithNextPrepareByKind[normalizedKind] = entry;
    }

    recordFlowResolveSignature(signature: string, isContinuation: boolean): void {
        if (!signature) return;
        this.recordProfile('flowResolveSignatureCalls', 1);
        if (isContinuation) {
            this.recordProfile('flowResolveSignatureContinuationCalls', 1);
        }
        if (this.flowResolveSignaturesSeen.has(signature)) {
            this.recordProfile('flowResolveSignatureRepeatedCalls', 1);
            if (isContinuation) {
                this.recordProfile('flowResolveSignatureRepeatedContinuationCalls', 1);
            }
            return;
        }

        this.flowResolveSignaturesSeen.add(signature);
        this.recordProfile('flowResolveSignatureUniqueCalls', 1);
    }

}

type BoxRef = {
    container: Box[];
    index: number;
    box: Box;
    pageIndex: number;
};

function collectActorBoxRefs(
    pages: Page[],
    currentPageBoxes: Box[],
    currentPageIndex: number,
    actorId: string
): BoxRef[] {
    return collectActorBoxRefsByActorId(pages, currentPageBoxes, currentPageIndex).get(actorId) ?? [];
}

function collectActorBoxRefsByActorId(
    pages: Page[],
    currentPageBoxes: Box[],
    currentPageIndex: number
): Map<string, BoxRef[]> {
    const refsByActorId = new Map<string, BoxRef[]>();
    const addRef = (actorId: string | undefined, ref: BoxRef): void => {
        if (!actorId) return;
        const refs = refsByActorId.get(actorId);
        if (refs) {
            refs.push(ref);
        } else {
            refsByActorId.set(actorId, [ref]);
        }
    };
    for (const page of pages) {
        for (let index = 0; index < page.boxes.length; index++) {
            const box = page.boxes[index];
            addRef(box.meta?.actorId, { container: page.boxes, index, box, pageIndex: page.index });
        }
    }
    for (let index = 0; index < currentPageBoxes.length; index++) {
        const box = currentPageBoxes[index];
        addRef(box.meta?.actorId, { container: currentPageBoxes, index, box, pageIndex: currentPageIndex });
    }
    return refsByActorId;
}

function assertContentOnlyGeometry(actorId: string, committed: Box, next: Box): void {
    const tolerance = 0.01;
    if (Math.abs(Number(committed.w || 0) - Number(next.w || 0)) > tolerance) {
        throw new Error(`[LayoutSession] content-only actor "${actorId}" changed box width.`);
    }
    if (Math.abs(Number(committed.h || 0) - Number(next.h || 0)) > tolerance) {
        throw new Error(`[LayoutSession] content-only actor "${actorId}" changed box height.`);
    }
}

function transplantBoxContent(committed: Box, next: Box): Box {
    const nextMeta: BoxMeta | undefined = next.meta
        ? { ...committed.meta, ...next.meta, actorId: committed.meta?.actorId, pageIndex: committed.meta?.pageIndex }
        : committed.meta;
    return {
        ...next,
        x: committed.x,
        y: committed.y,
        w: committed.w,
        h: committed.h,
        meta: nextMeta
    };
}

function getHostedRuntimeActors(actor: PackagerUnit): readonly PackagerUnit[] {
    const maybeHost = actor as PackagerUnit & {
        getHostedRuntimeActors?(): readonly PackagerUnit[];
    };
    return maybeHost.getHostedRuntimeActors?.() ?? [];
}

type HostedActorController = PackagerUnit & {
    handlesHostedRuntimeActor?(targetActor: PackagerUnit): boolean;
    insertHostedRuntimeActors?(
        targetActor: PackagerUnit,
        insertions: readonly PackagerUnit[],
        position: 'before' | 'after',
        sourceElements?: readonly Element[]
    ): boolean;
    deleteHostedRuntimeActor?(targetActor: PackagerUnit): boolean;
    replaceHostedRuntimeActor?(
        targetActor: PackagerUnit,
        replacements: readonly PackagerUnit[],
        sourceElements?: readonly Element[]
    ): boolean;
    refreshHostedRuntimeActor?(targetActor: PackagerUnit): boolean;
};

function findHostedActorController(
    actors: readonly PackagerUnit[],
    targetActor: PackagerUnit
): HostedActorController | null {
    for (const actor of actors) {
        if (actor.actorId === targetActor.actorId) continue;
        const maybeController = actor as HostedActorController;
        if (maybeController.handlesHostedRuntimeActor?.(targetActor)) {
            return maybeController;
        }
    }
    return null;
}
