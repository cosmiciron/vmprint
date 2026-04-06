import type { Box, Page } from '../../../types';
import type { KeepWithNextFormationPlan } from '../../actor-formation';
import type { ActorSignal, ActorSignalDraft } from '../../actor-event-bus';
import type { ContinuationArtifacts, FlowBox } from '../../layout-core-types';
import type { PackagerContext, PackagerReshapeResult } from '../../packagers/packager-types';
import type { PackagerUnit } from '../../packagers/packager-types';
import type { PageRegionSummary } from '../../page-region-summary';
import type { ScriptRegionRef } from '../../script-region-query';
import type { SimulationArtifactKey, SimulationArtifactMap } from '../../simulation-report';
import type { CollaboratorConstraintField } from './session-constraint-types';
import type { PageSurface, PaginationLoopState, SplitAttempt } from './session-lifecycle-types';
import type { FragmentTransition, PageCaptureRecord, PageCaptureState, PageFinalizationState, ViewportRect } from './session-state-types';
import type { PageExclusionIntent, PageReservationIntent, RegionReservation, SpatialExclusion } from './session-spatial-types';

export type RuntimeProfileMetric =
    | 'createCalls'
    | 'createMs'
    | 'docQueryCalls'
    | 'documentChangedCalls'
    | 'documentChangedMs'
    | 'handlerCalls'
    | 'handlerMs'
    | 'insertCalls'
    | 'keepWithNextEarlyExitCalls'
    | 'keepWithNextPlanCalls'
    | 'keepWithNextPlanMs'
    | 'keepWithNextPreparedActors'
    | 'loadCalls'
    | 'loadMs'
    | 'messageHandlerCalls'
    | 'messageSendCalls'
    | 'readyCalls'
    | 'readyMs'
    | 'removeCalls'
    | 'refreshCalls'
    | 'refreshMs'
    | 'replayRequests'
    | 'replaceCalls'
    | 'reservationArtifactMs'
    | 'reservationCommitProbeCalls'
    | 'reservationCommitProbeMs'
    | 'setContentCalls';

export type PageCaptureStateParams = {
    pageIndex: number;
    worldTopY: number;
    pageWidth: number;
    pageHeight: number;
    margins: { top: number; right: number; bottom: number; left: number };
    headerRect?: ViewportRect | null;
    footerRect?: ViewportRect | null;
};

/**
 * The bounded host surface exposed to collaborators.
 * Collaborators receive this instead of the concrete LayoutSession,
 * keeping them decoupled from session internals and reusable across
 * VMPrint, VMCanvas, and ourobor-os without modification.
 */
export interface CollaboratorHost {
    // Profiling
    recordProfile(metric: RuntimeProfileMetric, delta: number): void;
    recordKeepWithNextPrepare(actorKind: string, durationMs: number): void;

    // Signal bus
    publishActorSignal(signal: ActorSignalDraft): ActorSignal;
    getActorSignalSequence(): number;

    // Artifact store
    publishArtifact<K extends SimulationArtifactKey>(key: K, value: SimulationArtifactMap[K]): void;

    // Keep-with-next planning
    getPaginationLoopState(): PaginationLoopState | null;
    getKeepWithNextPlan(actorId: string, signature?: string | null): KeepWithNextFormationPlan | undefined;
    setKeepWithNextPlan(actorId: string, plan: KeepWithNextFormationPlan, signature?: string | null): void;
    getSplitMarkerReserve(actor: PackagerUnit): number;

    // Spatial mutations
    reserveCurrentPageSpace(reservation: RegionReservation): void;
    reservePageSpace(reservation: PageReservationIntent, pageIndex?: number): void;
    excludePageSpace(exclusion: PageExclusionIntent, pageIndex?: number): void;

    // Continuation staging
    ensureContinuationArtifacts(actor: PackagerUnit): ContinuationArtifacts | undefined;
    stageMarkersAfterSplit(fragmentActorId: string, markers: FlowBox[]): void;
    stageActorsBeforeContinuation(continuationActorId: string, actors: PackagerUnit[]): void;

    // World state reads
    getFinalizedPages(): readonly Page[];
    getPageFinalizationStates(): readonly PageFinalizationState[];
    getPageFinalizationState(pageIndex: number): PageFinalizationState | undefined;
    getPageCaptures(): readonly PageCaptureRecord[];
    getSimulationTick(): number;
    getRegisteredActors(): readonly PackagerUnit[];

    // Spatial reads
    getPageReservations(pageIndex: number): readonly RegionReservation[];
    getReservationPageIndices(): readonly number[];
    getPageExclusions(pageIndex: number): readonly SpatialExclusion[];
    getExclusionPageIndices(): readonly number[];
    getSpatialConstraintPageIndices(): readonly number[];
    getPageRegionSummaries(): readonly PageRegionSummary[];

    // Transition reads
    getFragmentTransitionSourceIds(): readonly string[];
    getFragmentTransitionsBySource(sourceActorId: string): readonly FragmentTransition[];

    // Script reads
    getScriptRegions(): readonly ScriptRegionRef[];
    findScriptRegionByName(name: string): ScriptRegionRef | null;

    // Page finalization (PageRegionCollaborator)
    allocateLogicalPageNumber(usesLogicalNumbering: boolean): number | null;
    resetLogicalPageNumbering(startAt: number): void;
    notifyActorSpawn(actor: PackagerUnit): void;
    recordPageCapture(record: PageCaptureRecord): void;
    recordPageFinalization(state: PageFinalizationState): void;
    createPageCaptureState(params: PageCaptureStateParams): PageCaptureState;
}

export interface Collaborator {
    /**
     * Declares whether this collaborator shapes simulation behavior (coordinator)
     * or only reads committed state (observer). Coordinators run before observers
     * at lifecycle boundaries where ordering matters (onPageFinalized, onSimulationComplete).
     * Defaults to 'coordinator' when absent for safety.
     */
    readonly mutationMode?: 'coordinator' | 'observer';

    onSimulationStart?(host: CollaboratorHost): void;
    onActorSpawn?(actor: PackagerUnit, host: CollaboratorHost): void;
    onPageStart?(pageIndex: number, surface: PageSurface, host: CollaboratorHost): void;
    onConstraintNegotiation?(actor: PackagerUnit, constraints: CollaboratorConstraintField, host: CollaboratorHost): void;
    onActorPrepared?(actor: PackagerUnit, host: CollaboratorHost): void;
    onSplitAttempt?(attempt: SplitAttempt, host: CollaboratorHost): void;
    onSplitAccepted?(attempt: SplitAttempt, result: PackagerReshapeResult, host: CollaboratorHost): void;
    onContinuationEnqueued?(predecessor: PackagerUnit, successor: PackagerUnit, host: CollaboratorHost): void;
    onActorCommitted?(actor: PackagerUnit, committed: Box[], surface: PageSurface, host: CollaboratorHost): void;
    onContinuationProduced?(predecessor: PackagerUnit, successor: PackagerUnit, host: CollaboratorHost): void;
    onPageFinalized?(surface: PageSurface, host: CollaboratorHost): void;
    onSimulationComplete?(host: CollaboratorHost): boolean | void;
}
