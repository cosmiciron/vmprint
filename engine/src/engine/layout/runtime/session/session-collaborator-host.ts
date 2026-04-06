import type { Page } from '../../../types';
import type { ActorSignal, ActorSignalDraft } from '../../actor-event-bus';
import type { KeepWithNextFormationPlan } from '../../actor-formation';
import type { ContinuationArtifacts, FlowBox } from '../../layout-core-types';
import type { CollaboratorHost, PageCaptureStateParams, RuntimeProfileMetric } from './session-runtime-types';
import type { PaginationLoopState } from './session-lifecycle-types';
import type { FragmentTransition, PageCaptureRecord, PageCaptureState, PageFinalizationState } from './session-state-types';
import type { PageExclusionIntent, PageReservationIntent, RegionReservation, SpatialExclusion } from './session-spatial-types';
import type { PackagerUnit } from '../../packagers/packager-types';
import type { PageRegionSummary } from '../../page-region-summary';
import type { ScriptRegionRef } from '../../script-region-query';
import type { SimulationArtifactKey, SimulationArtifactMap } from '../../simulation-report';
import type { SessionCollaborationRuntime } from './session-collaboration-runtime';

export type SessionCollaboratorHostDeps = {
    collaborationRuntime: SessionCollaborationRuntime;
    recordProfile(metric: RuntimeProfileMetric, delta: number): void;
    recordKeepWithNextPrepare(actorKind: string, durationMs: number): void;
    publishActorSignal(signal: ActorSignalDraft): ActorSignal;
    getPaginationLoopState(): PaginationLoopState | null;
    getActorSignalSequence(): number;
    getKeepWithNextPlan(actorId: string, signature?: string | null): KeepWithNextFormationPlan | undefined;
    setKeepWithNextPlan(actorId: string, plan: KeepWithNextFormationPlan, signature?: string | null): void;
    getSplitMarkerReserve(actor: PackagerUnit): number;
    ensureContinuationArtifacts(actor: PackagerUnit): ContinuationArtifacts | undefined;
    stageMarkersAfterSplit(fragmentActorId: string, markers: FlowBox[]): void;
    stageActorsBeforeContinuation(continuationActorId: string, actors: PackagerUnit[]): void;
    getSimulationTick(): number;
    getRegisteredActors(): readonly PackagerUnit[];
    getFragmentTransitionSourceIds(): readonly string[];
    getFragmentTransitionsBySource(sourceActorId: string): readonly FragmentTransition[];
    notifyActorSpawn(actor: PackagerUnit): void;
};

export class SessionCollaboratorHost implements CollaboratorHost {
    constructor(private readonly deps: SessionCollaboratorHostDeps) { }

    recordProfile(metric: RuntimeProfileMetric, delta: number): void {
        this.deps.recordProfile(metric, delta);
    }

    recordKeepWithNextPrepare(actorKind: string, durationMs: number): void {
        this.deps.recordKeepWithNextPrepare(actorKind, durationMs);
    }

    publishActorSignal(signal: ActorSignalDraft): ActorSignal {
        return this.deps.publishActorSignal(signal);
    }

    getActorSignalSequence(): number {
        return this.deps.getActorSignalSequence();
    }

    publishArtifact<K extends SimulationArtifactKey>(key: K, value: SimulationArtifactMap[K]): void {
        this.deps.collaborationRuntime.publishArtifact(key, value);
    }

    getPaginationLoopState(): PaginationLoopState | null {
        return this.deps.getPaginationLoopState();
    }

    getKeepWithNextPlan(actorId: string, signature?: string | null): KeepWithNextFormationPlan | undefined {
        return this.deps.getKeepWithNextPlan(actorId, signature);
    }

    setKeepWithNextPlan(actorId: string, plan: KeepWithNextFormationPlan, signature?: string | null): void {
        this.deps.setKeepWithNextPlan(actorId, plan, signature);
    }

    getSplitMarkerReserve(actor: PackagerUnit): number {
        return this.deps.getSplitMarkerReserve(actor);
    }

    reserveCurrentPageSpace(reservation: RegionReservation): void {
        this.deps.collaborationRuntime.reserveCurrentPageSpace(reservation);
    }

    reservePageSpace(reservation: PageReservationIntent, pageIndex?: number): void {
        this.deps.collaborationRuntime.reservePageSpace(reservation, pageIndex);
    }

    excludePageSpace(exclusion: PageExclusionIntent, pageIndex?: number): void {
        this.deps.collaborationRuntime.excludePageSpace(exclusion, pageIndex);
    }

    ensureContinuationArtifacts(actor: PackagerUnit): ContinuationArtifacts | undefined {
        return this.deps.ensureContinuationArtifacts(actor);
    }

    stageMarkersAfterSplit(fragmentActorId: string, markers: FlowBox[]): void {
        this.deps.stageMarkersAfterSplit(fragmentActorId, markers);
    }

    stageActorsBeforeContinuation(continuationActorId: string, actors: PackagerUnit[]): void {
        this.deps.stageActorsBeforeContinuation(continuationActorId, actors);
    }

    getFinalizedPages(): readonly Page[] {
        return this.deps.collaborationRuntime.getFinalizedPages();
    }

    getPageFinalizationStates(): readonly PageFinalizationState[] {
        return this.deps.collaborationRuntime.getPageFinalizationStates();
    }

    getPageFinalizationState(pageIndex: number): PageFinalizationState | undefined {
        return this.deps.collaborationRuntime.getPageFinalizationState(pageIndex);
    }

    getPageCaptures(): readonly PageCaptureRecord[] {
        return this.deps.collaborationRuntime.getPageCaptures();
    }

    getSimulationTick(): number {
        return this.deps.getSimulationTick();
    }

    getRegisteredActors(): readonly PackagerUnit[] {
        return this.deps.getRegisteredActors();
    }

    getPageReservations(pageIndex: number): readonly RegionReservation[] {
        return this.deps.collaborationRuntime.getPageReservations(pageIndex);
    }

    getReservationPageIndices(): readonly number[] {
        return this.deps.collaborationRuntime.getReservationPageIndices();
    }

    getPageExclusions(pageIndex: number): readonly SpatialExclusion[] {
        return this.deps.collaborationRuntime.getPageExclusions(pageIndex);
    }

    getExclusionPageIndices(): readonly number[] {
        return this.deps.collaborationRuntime.getExclusionPageIndices();
    }

    getSpatialConstraintPageIndices(): readonly number[] {
        return this.deps.collaborationRuntime.getSpatialConstraintPageIndices();
    }

    getPageRegionSummaries(): readonly PageRegionSummary[] {
        return this.deps.collaborationRuntime.getPageRegionSummaries();
    }

    getFragmentTransitionSourceIds(): readonly string[] {
        return this.deps.getFragmentTransitionSourceIds();
    }

    getFragmentTransitionsBySource(sourceActorId: string): readonly FragmentTransition[] {
        return this.deps.getFragmentTransitionsBySource(sourceActorId);
    }

    getScriptRegions(): readonly ScriptRegionRef[] {
        return this.deps.collaborationRuntime.getScriptRegions();
    }

    findScriptRegionByName(name: string): ScriptRegionRef | null {
        return this.deps.collaborationRuntime.findScriptRegionByName(name);
    }

    allocateLogicalPageNumber(usesLogicalNumbering: boolean): number | null {
        return this.deps.collaborationRuntime.allocateLogicalPageNumber(usesLogicalNumbering);
    }

    resetLogicalPageNumbering(startAt: number): void {
        this.deps.collaborationRuntime.resetLogicalPageNumbering(startAt);
    }

    notifyActorSpawn(actor: PackagerUnit): void {
        this.deps.notifyActorSpawn(actor);
    }

    recordPageCapture(record: PageCaptureRecord): void {
        this.deps.collaborationRuntime.recordPageCapture(record);
    }

    recordPageFinalization(state: PageFinalizationState): void {
        this.deps.collaborationRuntime.recordPageFinalization(state);
    }

    createPageCaptureState(params: PageCaptureStateParams): PageCaptureState {
        return this.deps.collaborationRuntime.createPageCaptureState(params);
    }
}
