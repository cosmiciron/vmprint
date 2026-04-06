import type { PackagerUnit } from './packagers/packager-types';
import type { ContinuationArtifacts, FlowBox } from './layout-core-types';
import type { PackagerReshapeResult } from './packagers/packager-types';
import type {
    KernelBranchStateSnapshot,
    ContinuationQueueOutcome,
    FragmentTransition,
    LocalQueueSnapshot,
    LocalSplitStateSnapshot,
    RegionReservation,
    SpatialExclusion,
    SplitAttempt
} from './layout-session-types';

export class Kernel {
    readonly actorRegistry: PackagerUnit[] = [];

    private readonly continuationArtifacts = new Map<string, ContinuationArtifacts>();
    private stagedContinuationActors = new Map<string, PackagerUnit[]>();
    private stagedAfterSplitMarkers = new Map<string, FlowBox[]>();
    private stagedContinuationActorsShared = false;
    private stagedAfterSplitMarkersShared = false;
    private readonly fragmentTransitions: FragmentTransition[] = [];
    private readonly fragmentTransitionsByActor = new Map<string, FragmentTransition>();
    private readonly fragmentTransitionsBySource = new Map<string, FragmentTransition[]>();
    private readonly pageReservationsByPage = new Map<number, RegionReservation[]>();
    private readonly pageExclusionsByPage = new Map<number, SpatialExclusion[]>();
    private readonly artifacts = new Map<string, unknown>();
    private currentPageReservations: RegionReservation[] = [];
    private currentPageExclusions: SpatialExclusion[] = [];

    resetForSimulation(): void {
        this.pageReservationsByPage.clear();
        this.pageExclusionsByPage.clear();
        this.currentPageReservations = [];
        this.currentPageExclusions = [];
        this.fragmentTransitions.length = 0;
        this.fragmentTransitionsByActor.clear();
        this.fragmentTransitionsBySource.clear();
        this.stagedContinuationActors.clear();
        this.stagedAfterSplitMarkers.clear();
        this.stagedContinuationActorsShared = false;
        this.stagedAfterSplitMarkersShared = false;
        this.artifacts.clear();
    }

    beginPage(): void {
        this.currentPageReservations = [];
        this.currentPageExclusions = [];
    }

    registerActor(actor: PackagerUnit): void {
        this.actorRegistry.push(actor);
    }

    unregisterActor(actor: PackagerUnit): void {
        const index = this.actorRegistry.findIndex((entry) => entry.actorId === actor.actorId);
        if (index >= 0) {
            this.actorRegistry.splice(index, 1);
        }
    }

    registerSplitAccepted(attempt: SplitAttempt, result: PackagerReshapeResult): void {
        const transition: FragmentTransition = {
            predecessorActorId: attempt.actor.actorId,
            currentFragmentActorId: result.currentFragment?.actorId ?? null,
            continuationActorId: result.continuationFragment?.actorId ?? null,
            sourceActorId: attempt.actor.sourceId,
            pageIndex: attempt.context.pageIndex,
            cursorY: Number.isFinite(attempt.context.cursorY) ? Number(attempt.context.cursorY) : undefined,
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
    }

    markContinuationEnqueued(predecessor: PackagerUnit, successor: PackagerUnit): void {
        this.registerActor(successor);
        const transition = this.fragmentTransitionsByActor.get(successor.actorId)
            ?? this.fragmentTransitionsByActor.get(predecessor.actorId);
        if (transition) {
            transition.continuationEnqueued = true;
        }
    }

    markContinuationProduced(successor: PackagerUnit): void {
        this.registerActor(successor);
    }

    publishArtifact(key: string, value: unknown): void {
        this.artifacts.set(key, value);
    }

    getPublishedArtifacts(): ReadonlyMap<string, unknown> {
        return this.artifacts;
    }

    setContinuationArtifacts(actorId: string, artifacts: ContinuationArtifacts): void {
        this.continuationArtifacts.set(actorId, artifacts);
    }

    getContinuationArtifacts(actorId: string): ContinuationArtifacts | undefined {
        return this.continuationArtifacts.get(actorId);
    }

    stageActorsBeforeContinuation(continuationActorId: string, actors: PackagerUnit[]): void {
        if (!actors.length) return;
        this.ensureMutableStagedContinuationActors();
        this.stagedContinuationActors.set(continuationActorId, actors);
    }

    consumeActorsBeforeContinuation(continuationActorId: string): PackagerUnit[] {
        const actors = this.stagedContinuationActors.get(continuationActorId) ?? [];
        this.ensureMutableStagedContinuationActors();
        this.stagedContinuationActors.delete(continuationActorId);
        return actors;
    }

    stageMarkersAfterSplit(fragmentActorId: string, markers: FlowBox[]): void {
        if (!markers.length) return;
        this.ensureMutableStagedAfterSplitMarkers();
        this.stagedAfterSplitMarkers.set(fragmentActorId, markers);
    }

    consumeMarkersAfterSplit(fragmentActorId: string): FlowBox[] {
        const markers = this.stagedAfterSplitMarkers.get(fragmentActorId) ?? [];
        this.ensureMutableStagedAfterSplitMarkers();
        this.stagedAfterSplitMarkers.delete(fragmentActorId);
        return markers;
    }

    captureLocalQueueSnapshot(actorQueue: readonly PackagerUnit[]): LocalQueueSnapshot {
        this.stagedContinuationActorsShared = true;
        this.stagedAfterSplitMarkersShared = true;
        return {
            actorQueue: [...actorQueue],
            stagedContinuationActors: this.stagedContinuationActors,
            stagedAfterSplitMarkers: this.stagedAfterSplitMarkers
        };
    }

    restoreLocalQueueSnapshot(snapshot: LocalQueueSnapshot): void {
        this.stagedContinuationActors = snapshot.stagedContinuationActors;
        this.stagedAfterSplitMarkers = snapshot.stagedAfterSplitMarkers;
        this.stagedContinuationActorsShared = true;
        this.stagedAfterSplitMarkersShared = true;
    }

    installContinuationIntoQueue(
        actorQueue: PackagerUnit[],
        startIndex: number,
        replaceCount: number,
        continuation: PackagerUnit | null | undefined
    ): boolean {
        if (!continuation) {
            actorQueue.splice(startIndex, replaceCount);
            return false;
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
        continuation: PackagerUnit | null | undefined
    ): ContinuationQueueOutcome {
        const snapshot = this.captureLocalQueueSnapshot(actorQueue);
        return {
            snapshot,
            continuationInstalled: this.installContinuationIntoQueue(
                actorQueue,
                startIndex,
                replaceCount,
                continuation
            )
        };
    }

    rollbackContinuationQueue(
        actorQueue: PackagerUnit[],
        snapshot: LocalQueueSnapshot
    ): void {
        actorQueue.splice(0, actorQueue.length, ...snapshot.actorQueue);
        this.restoreLocalQueueSnapshot(snapshot);
    }

    previewContinuationQueueSettlement(
        actorQueue: PackagerUnit[],
        startIndex: number,
        replaceCount: number,
        continuation: PackagerUnit | null | undefined
    ): ContinuationQueueOutcome {
        const preview = this.settleContinuationQueue(
            actorQueue,
            startIndex,
            replaceCount,
            continuation
        );
        this.rollbackContinuationQueue(actorQueue, preview.snapshot);
        return preview;
    }

    captureLocalSplitStateSnapshot(): LocalSplitStateSnapshot {
        const fragmentTransitionsBySource = new Map<string, FragmentTransition[]>();
        for (const [sourceActorId, transitions] of this.fragmentTransitionsBySource) {
            fragmentTransitionsBySource.set(sourceActorId, [...transitions]);
        }
        return {
            currentPageReservations: this.currentPageReservations.map((reservation) => ({ ...reservation })),
            currentPageExclusions: this.currentPageExclusions.map((exclusion) => ({ ...exclusion })),
            fragmentTransitions: [...this.fragmentTransitions],
            fragmentTransitionsByActor: new Map(this.fragmentTransitionsByActor),
            fragmentTransitionsBySource
        };
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

    captureLocalBranchStateSnapshot(actorQueue: readonly PackagerUnit[]): KernelBranchStateSnapshot {
        return {
            ...this.captureLocalQueueSnapshot(actorQueue),
            ...this.captureLocalSplitStateSnapshot()
        };
    }

    restoreLocalBranchStateSnapshot(
        actorQueue: PackagerUnit[],
        snapshot: KernelBranchStateSnapshot
    ): void {
        this.rollbackContinuationQueue(actorQueue, snapshot);
        this.restoreLocalSplitStateSnapshot(snapshot);
    }

    private ensureMutableStagedContinuationActors(): void {
        if (!this.stagedContinuationActorsShared) return;
        this.stagedContinuationActors = new Map(this.stagedContinuationActors);
        this.stagedContinuationActorsShared = false;
    }

    private ensureMutableStagedAfterSplitMarkers(): void {
        if (!this.stagedAfterSplitMarkersShared) return;
        this.stagedAfterSplitMarkers = new Map(this.stagedAfterSplitMarkers);
        this.stagedAfterSplitMarkersShared = false;
    }

    storePageReservation(pageIndex: number, currentPageIndex: number, reservation: RegionReservation): void {
        if (pageIndex === currentPageIndex) {
            this.currentPageReservations.push(reservation);
        }
        const pageReservations = this.pageReservationsByPage.get(pageIndex) ?? [];
        pageReservations.push(reservation);
        this.pageReservationsByPage.set(pageIndex, pageReservations);
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

    storePageExclusion(pageIndex: number, currentPageIndex: number, exclusion: SpatialExclusion): void {
        if (pageIndex === currentPageIndex) {
            this.currentPageExclusions.push(exclusion);
        }
        const pageExclusions = this.pageExclusionsByPage.get(pageIndex) ?? [];
        pageExclusions.push(exclusion);
        this.pageExclusionsByPage.set(pageIndex, pageExclusions);
    }

    getCurrentPageExclusions(): readonly SpatialExclusion[] {
        return this.currentPageExclusions;
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
}
