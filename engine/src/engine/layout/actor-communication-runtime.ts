import { performance } from 'node:perf_hooks';
import type { Box, Page } from '../types';
import { ActorEventBus, type ActorEventBusSnapshot, type ActorSignal, type ActorSignalDraft } from './actor-event-bus';
import type { FlowBox } from './layout-core-types';
import type { LayoutProfileMetrics } from './layout-session-types';
import {
    normalizeObservationResult,
    type ObservationResult,
    type PackagerContext,
    type PackagerUnit,
    type SpatialFrontier
} from './packagers/packager-types';

export type LocalActorSignalSnapshot = {
    busSnapshot: ActorEventBusSnapshot;
    awakenedObserverIds: string[];
};

export type ObserverSweepResult = {
    changed: boolean;
    geometryChanged: boolean;
    earliestAffectedFrontier?: SpatialFrontier;
    contentOnlyActors: PackagerUnit[];
};

export type SafeCheckpointPageState = {
    pageBoxes: Box[];
};

export type SafeCheckpoint<
    TTransitionSnapshot extends { currentY: number; lastSpacingAfter: number },
    TBranchStateSnapshot extends object
> = {
    id: string;
    snapshotToken: string;
    kind: 'page' | 'actor';
    pageIndex: number;
    actorIndex: number;
    anchorActorId?: string;
    anchorSourceId?: string;
    frontier: SpatialFrontier;
    pagesPrefix: Page[];
    snapshot: TTransitionSnapshot & TBranchStateSnapshot & SafeCheckpointPageState;
};

type QueueSnapshotLike = {
    actorQueue: PackagerUnit[];
    stagedContinuationActors: Map<string, PackagerUnit[]>;
    stagedAfterSplitMarkers: Map<string, FlowBox[]>;
};

export class ActorCommunicationRuntime<
    TTransitionSnapshot extends { currentY: number; lastSpacingAfter: number },
    TBranchStateSnapshot extends QueueSnapshotLike & object
> {
    private readonly actorEventBus = new ActorEventBus();
    private readonly observerRegistry = new Map<string, PackagerUnit>();
    private readonly steppedActorRegistry = new Map<string, PackagerUnit>();
    private readonly observerTopicSubscriptions = new Map<string, Set<string>>();
    private readonly broadlyPolledObserverIds = new Set<string>();
    private readonly awakenedObserverIds = new Set<string>();
    private readonly actorIndexByActorId = new Map<string, number>();
    private readonly actorIndexBySourceId = new Map<string, number>();
    private safeCheckpoints: SafeCheckpoint<TTransitionSnapshot, TBranchStateSnapshot>[] = [];
    private safeCheckpointSequence = 0;

    constructor(
        private readonly callbacks: {
            recordObserverCheckpointSweep: () => void;
            recordProfile: (metric: keyof LayoutProfileMetrics, delta: number) => void;
        }
    ) { }

    resetForSimulation(): void {
        this.actorEventBus.resetForSimulation();
        this.observerRegistry.clear();
        this.steppedActorRegistry.clear();
        this.observerTopicSubscriptions.clear();
        this.broadlyPolledObserverIds.clear();
        this.awakenedObserverIds.clear();
        this.actorIndexByActorId.clear();
        this.actorIndexBySourceId.clear();
        this.safeCheckpoints = [];
        this.safeCheckpointSequence = 0;
    }

    publishActorSignal(signal: ActorSignalDraft): ActorSignal {
        const published = this.actorEventBus.publish(signal);
        this.awakenObserversForSignal(published.topic);
        return published;
    }

    getActorSignals(topic?: string): readonly ActorSignal[] {
        return this.actorEventBus.read(topic);
    }

    getActorSignalSequence(): number {
        return this.actorEventBus.getSequence();
    }

    captureLocalActorSignalSnapshot(): LocalActorSignalSnapshot {
        return {
            busSnapshot: this.actorEventBus.captureSnapshot(),
            awakenedObserverIds: [...this.awakenedObserverIds]
        };
    }

    restoreLocalActorSignalSnapshot(snapshot: LocalActorSignalSnapshot): void {
        this.actorEventBus.restoreSnapshot(snapshot.busSnapshot);
        this.awakenedObserverIds.clear();
        for (const actorId of snapshot.awakenedObserverIds) {
            this.awakenedObserverIds.add(actorId);
        }
    }

    notifyActorSpawn(actor: PackagerUnit): void {
        if (typeof actor.stepSimulationTick === 'function') {
            this.steppedActorRegistry.set(actor.actorId, actor);
        }
        const hasCommittedUpdater =
            typeof actor.updateCommittedState === 'function'
            || typeof actor.observeCommittedSignals === 'function';
        if (!hasCommittedUpdater) return;

        this.observerRegistry.set(actor.actorId, actor);
        const subscriptions = actor.getCommittedSignalSubscriptions?.()
            ?.map((topic) => String(topic || '').trim())
            .filter((topic) => topic.length > 0) ?? [];
        if (subscriptions.length === 0) {
            this.broadlyPolledObserverIds.add(actor.actorId);
            return;
        }

        for (const topic of subscriptions) {
            const entry = this.observerTopicSubscriptions.get(topic) ?? new Set<string>();
            entry.add(actor.actorId);
            this.observerTopicSubscriptions.set(topic, entry);
        }
    }

    notifyActorDespawn(actor: PackagerUnit): void {
        this.observerRegistry.delete(actor.actorId);
        this.steppedActorRegistry.delete(actor.actorId);
        this.broadlyPolledObserverIds.delete(actor.actorId);
        this.awakenedObserverIds.delete(actor.actorId);
        this.actorIndexByActorId.delete(actor.actorId);
        this.actorIndexBySourceId.delete(actor.sourceId);

        for (const subscriptions of this.observerTopicSubscriptions.values()) {
            subscriptions.delete(actor.actorId);
        }
    }

    insertActorsInCheckpointQueues(
        targetActorId: string,
        insertions: readonly PackagerUnit[],
        position: 'before' | 'after'
    ): void {
        if (insertions.length === 0) return;
        for (const checkpoint of this.safeCheckpoints) {
            const actorQueue = checkpoint.snapshot.actorQueue;
            const index = actorQueue.findIndex((actor) => actor.actorId === targetActorId);
            if (index < 0) continue;
            const insertionIndex = position === 'before' ? index : index + 1;
            actorQueue.splice(insertionIndex, 0, ...insertions);
        }
    }

    deleteActorInCheckpointQueues(targetActorId: string): void {
        for (const checkpoint of this.safeCheckpoints) {
            const actorQueue = checkpoint.snapshot.actorQueue;
            const index = actorQueue.findIndex((actor) => actor.actorId === targetActorId);
            if (index < 0) continue;
            actorQueue.splice(index, 1);

            if (checkpoint.anchorActorId === targetActorId) {
                const nextActor = actorQueue[index] ?? actorQueue[index - 1];
                checkpoint.anchorActorId = nextActor?.actorId;
                checkpoint.anchorSourceId = nextActor?.sourceId;
                checkpoint.frontier = {
                    ...checkpoint.frontier,
                    actorId: nextActor?.actorId,
                    sourceId: nextActor?.sourceId
                };
            }
        }
    }

    replaceActorInCheckpointQueues(targetActorId: string, replacements: readonly PackagerUnit[]): void {
        for (const checkpoint of this.safeCheckpoints) {
            const actorQueue = checkpoint.snapshot.actorQueue;
            const index = actorQueue.findIndex((actor) => actor.actorId === targetActorId);
            if (index < 0) continue;
            actorQueue.splice(index, 1, ...replacements);

            if (checkpoint.anchorActorId === targetActorId) {
                const first = replacements[0];
                checkpoint.anchorActorId = first?.actorId;
                checkpoint.anchorSourceId = first?.sourceId;
                checkpoint.frontier = {
                    ...checkpoint.frontier,
                    actorId: first?.actorId,
                    sourceId: first?.sourceId
                };
            }
        }
    }

    hasCommittedSignalObservers(): boolean {
        return this.observerRegistry.size > 0;
    }

    hasSteppedActors(): boolean {
        return this.steppedActorRegistry.size > 0;
    }

    hasActiveSteppedActors(
        contextBase: Omit<PackagerContext, 'pageIndex' | 'cursorY'>,
        pageIndex: number,
        cursorY: number
    ): boolean {
        if (this.steppedActorRegistry.size === 0) {
            return false;
        }
        const context: PackagerContext = {
            ...contextBase,
            pageIndex,
            cursorY
        };
        for (const actor of this.steppedActorRegistry.values()) {
            if (actor.wantsSimulationTicks?.(context)) {
                return true;
            }
        }
        return false;
    }

    noteActorIndex(actor: PackagerUnit | undefined, actorIndex: number): void {
        if (!actor) return;

        const indexedActor = this.actorIndexByActorId.get(actor.actorId);
        if (indexedActor === undefined || actorIndex < indexedActor) {
            this.actorIndexByActorId.set(actor.actorId, actorIndex);
        }

        const indexedSource = this.actorIndexBySourceId.get(actor.sourceId);
        if (indexedSource === undefined || actorIndex < indexedSource) {
            this.actorIndexBySourceId.set(actor.sourceId, actorIndex);
        }
    }

    recordSafeCheckpoint(
        actorQueue: readonly PackagerUnit[],
        actorIndex: number,
        pagesPrefix: readonly Page[],
        currentPageBoxes: readonly Box[],
        currentPageIndex: number,
        currentY: number,
        kind: 'page' | 'actor',
        captureTransitionSnapshot: () => TTransitionSnapshot,
        captureBranchStateSnapshot: () => TBranchStateSnapshot
    ): SafeCheckpoint<TTransitionSnapshot, TBranchStateSnapshot> {
        const anchorActor = actorQueue[actorIndex];
        const checkpoint: SafeCheckpoint<TTransitionSnapshot, TBranchStateSnapshot> = {
            id: `checkpoint:${++this.safeCheckpointSequence}`,
            snapshotToken: `checkpoint:${this.safeCheckpointSequence}`,
            kind,
            pageIndex: currentPageIndex,
            actorIndex,
            anchorActorId: anchorActor?.actorId,
            anchorSourceId: anchorActor?.sourceId,
            frontier: {
                pageIndex: currentPageIndex,
                cursorY: currentY,
                actorIndex,
                actorId: anchorActor?.actorId,
                sourceId: anchorActor?.sourceId
            },
            pagesPrefix: pagesPrefix.map(clonePage),
            snapshot: {
                pageBoxes: currentPageBoxes.map(cloneBox),
                ...captureTransitionSnapshot(),
                ...captureBranchStateSnapshot()
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
            this.safeCheckpoints.sort(sortCheckpointsAscending);
        }

        return checkpoint;
    }

    evaluateObserverRegistry(
        contextBase: Omit<PackagerContext, 'pageIndex' | 'cursorY'>,
        pageIndex: number,
        cursorY: number
    ): ObserverSweepResult {
        this.callbacks.recordObserverCheckpointSweep();

        let changed = false;
        let geometryChanged = false;
        let earliestAffectedFrontier: SpatialFrontier | undefined;
        const contentOnlyActors: PackagerUnit[] = [];

        const context: PackagerContext = {
            ...contextBase,
            pageIndex,
            cursorY
        };

        const pendingAwakened = new Set(this.awakenedObserverIds);
        const processed = new Set<string>();

        while (true) {
            let processedAny = false;

            for (const observer of this.observerRegistry.values()) {
                if (processed.has(observer.actorId)) continue;

                const shouldProcess =
                    this.broadlyPolledObserverIds.has(observer.actorId)
                    || pendingAwakened.has(observer.actorId);
                if (!shouldProcess) {
                    continue;
                }

                processedAny = true;
                processed.add(observer.actorId);
                pendingAwakened.delete(observer.actorId);

                const startedAt = performance.now();
                this.callbacks.recordProfile('actorUpdateCalls', 1);
                const result = normalizeObservationResult(
                    observer.updateCommittedState?.(context)
                    ?? observer.observeCommittedSignals?.(context)
                );
                this.callbacks.recordProfile('actorUpdateMs', performance.now() - startedAt);

                if (!result || !result.changed) {
                    this.callbacks.recordProfile('actorUpdateNoopCalls', 1);
                } else {
                    if (result.updateKind === 'geometry') {
                        this.callbacks.recordProfile('actorUpdateGeometryCalls', 1);
                    } else if (result.updateKind === 'content-only') {
                        this.callbacks.recordProfile('actorUpdateContentOnlyCalls', 1);
                        contentOnlyActors.push(observer);
                    }

                    changed = true;
                    if (result.geometryChanged) {
                        geometryChanged = true;
                        if (isEarlierFrontier(result, earliestAffectedFrontier)) {
                            earliestAffectedFrontier = result.earliestAffectedFrontier;
                        }
                    }
                }
            }

            for (const actorId of this.awakenedObserverIds) {
                if (!processed.has(actorId)) {
                    pendingAwakened.add(actorId);
                }
            }

            if (!processedAny && pendingAwakened.size === 0) {
                break;
            }
            if (!processedAny) {
                break;
            }
        }

        for (const observer of this.observerRegistry.values()) {
            if (!processed.has(observer.actorId)) {
                this.callbacks.recordProfile('actorActivationDormantSkips', 1);
            }
        }

        this.awakenedObserverIds.clear();

        return { changed, geometryChanged, earliestAffectedFrontier, contentOnlyActors };
    }

    evaluateSteppedActors(
        contextBase: Omit<PackagerContext, 'pageIndex' | 'cursorY'>,
        pageIndex: number,
        cursorY: number
    ): ObserverSweepResult {
        let changed = false;
        let geometryChanged = false;
        let earliestAffectedFrontier: SpatialFrontier | undefined;
        const contentOnlyActors: PackagerUnit[] = [];

        const context: PackagerContext = {
            ...contextBase,
            pageIndex,
            cursorY
        };

        for (const actor of this.steppedActorRegistry.values()) {
            if (actor.wantsSimulationTicks && !actor.wantsSimulationTicks(context)) {
                this.callbacks.recordProfile('actorActivationDormantSkips', 1);
                continue;
            }
            this.callbacks.recordProfile('actorActivationAwakenCalls', 1);
            this.callbacks.recordProfile('actorActivationScheduledWakeCalls', 1);

            const startedAt = performance.now();
            this.callbacks.recordProfile('actorUpdateCalls', 1);
            const result = normalizeObservationResult(actor.stepSimulationTick?.(context));
            this.callbacks.recordProfile('actorUpdateMs', performance.now() - startedAt);

            if (!result || !result.changed) {
                this.callbacks.recordProfile('actorUpdateNoopCalls', 1);
                continue;
            }

            if (result.updateKind === 'geometry') {
                this.callbacks.recordProfile('actorUpdateGeometryCalls', 1);
            } else if (result.updateKind === 'content-only') {
                this.callbacks.recordProfile('actorUpdateContentOnlyCalls', 1);
                contentOnlyActors.push(actor);
            }

            changed = true;
            if (!result.geometryChanged) continue;

            geometryChanged = true;
            if (isEarlierFrontier(result, earliestAffectedFrontier)) {
                earliestAffectedFrontier = result.earliestAffectedFrontier;
            }
        }

        return { changed, geometryChanged, earliestAffectedFrontier, contentOnlyActors };
    }

    resolveSafeCheckpoint(
        frontier: SpatialFrontier
    ): SafeCheckpoint<TTransitionSnapshot, TBranchStateSnapshot> | null {
        const frontierActorIndex =
            frontier.actorIndex
            ?? (frontier.sourceId ? this.actorIndexBySourceId.get(frontier.sourceId) : undefined)
            ?? (frontier.actorId ? this.actorIndexByActorId.get(frontier.actorId) : undefined)
            ?? Number.POSITIVE_INFINITY;

        const anchoredCandidates = this.safeCheckpoints
            .filter((checkpoint) =>
                isCheckpointAtOrBeforeFrontier(checkpoint, frontier, frontierActorIndex)
                && (
                    (frontier.sourceId && checkpoint.anchorSourceId === frontier.sourceId)
                    || (frontier.actorId && checkpoint.anchorActorId === frontier.actorId)
                )
            )
            .sort(sortCheckpointsDescending);
        if (anchoredCandidates.length > 0) {
            return anchoredCandidates[0];
        }

        const candidates = this.safeCheckpoints
            .filter((checkpoint) => isCheckpointAtOrBeforeFrontier(checkpoint, frontier, frontierActorIndex))
            .sort(sortCheckpointsDescending);
        return candidates[0] ?? null;
    }

    restoreSafeCheckpoint(
        pages: Page[],
        actorQueue: PackagerUnit[],
        checkpoint: SafeCheckpoint<TTransitionSnapshot, TBranchStateSnapshot>,
        restoreBranchStateSnapshot: (actorQueue: PackagerUnit[], snapshot: TBranchStateSnapshot) => void
    ): { currentPageBoxes: Box[]; currentY: number; lastSpacingAfter: number } {
        pages.splice(0, pages.length, ...checkpoint.pagesPrefix.map(clonePage));
        restoreBranchStateSnapshot(actorQueue, checkpoint.snapshot);

        return {
            currentPageBoxes: checkpoint.snapshot.pageBoxes.map(cloneBox),
            currentY: checkpoint.snapshot.currentY,
            lastSpacingAfter: checkpoint.snapshot.lastSpacingAfter
        };
    }

    private awakenObserversForSignal(topic: string): void {
        const normalizedTopic = String(topic || '').trim();
        if (!normalizedTopic) return;

        const specific = this.observerTopicSubscriptions.get(normalizedTopic);
        if (!specific || specific.size === 0) {
            return;
        }

        for (const actorId of specific) {
            if (this.awakenedObserverIds.has(actorId)) continue;
            this.awakenedObserverIds.add(actorId);
            this.callbacks.recordProfile('actorActivationAwakenCalls', 1);
            this.callbacks.recordProfile('actorActivationSignalWakeCalls', 1);
        }
    }
}

function isEarlierFrontier(
    result: ObservationResult,
    current: SpatialFrontier | undefined
): result is ObservationResult & { earliestAffectedFrontier: SpatialFrontier } {
    if (!result.earliestAffectedFrontier) {
        return false;
    }

    if (!current) {
        return true;
    }

    if (result.earliestAffectedFrontier.pageIndex !== current.pageIndex) {
        return result.earliestAffectedFrontier.pageIndex < current.pageIndex;
    }

    const nextCursorY = Number.isFinite(result.earliestAffectedFrontier.cursorY)
        ? Number(result.earliestAffectedFrontier.cursorY)
        : Number.POSITIVE_INFINITY;
    const currentCursorY = Number.isFinite(current.cursorY)
        ? Number(current.cursorY)
        : Number.POSITIVE_INFINITY;
    if (Math.abs(nextCursorY - currentCursorY) > 0.01) {
        return nextCursorY < currentCursorY;
    }

    const nextActorIndex = Number.isFinite(result.earliestAffectedFrontier.actorIndex)
        ? Number(result.earliestAffectedFrontier.actorIndex)
        : Number.POSITIVE_INFINITY;
    const currentActorIndex = Number.isFinite(current.actorIndex)
        ? Number(current.actorIndex)
        : Number.POSITIVE_INFINITY;
    return nextActorIndex < currentActorIndex;
}

function sortCheckpointsDescending<
    TTransitionSnapshot extends { currentY: number; lastSpacingAfter: number },
    TBranchStateSnapshot extends object
>(
    a: SafeCheckpoint<TTransitionSnapshot, TBranchStateSnapshot>,
    b: SafeCheckpoint<TTransitionSnapshot, TBranchStateSnapshot>
): number {
    if (a.pageIndex !== b.pageIndex) return b.pageIndex - a.pageIndex;
    const aCursorY = Number.isFinite(a.frontier.cursorY) ? Number(a.frontier.cursorY) : Number.NEGATIVE_INFINITY;
    const bCursorY = Number.isFinite(b.frontier.cursorY) ? Number(b.frontier.cursorY) : Number.NEGATIVE_INFINITY;
    if (Math.abs(aCursorY - bCursorY) > 0.01) return bCursorY - aCursorY;
    if (a.actorIndex !== b.actorIndex) return b.actorIndex - a.actorIndex;
    return b.id.localeCompare(a.id);
}

function sortCheckpointsAscending<
    TTransitionSnapshot extends { currentY: number; lastSpacingAfter: number },
    TBranchStateSnapshot extends object
>(
    a: SafeCheckpoint<TTransitionSnapshot, TBranchStateSnapshot>,
    b: SafeCheckpoint<TTransitionSnapshot, TBranchStateSnapshot>
): number {
    if (a.pageIndex !== b.pageIndex) return a.pageIndex - b.pageIndex;
    const aCursorY = Number.isFinite(a.frontier.cursorY) ? Number(a.frontier.cursorY) : Number.POSITIVE_INFINITY;
    const bCursorY = Number.isFinite(b.frontier.cursorY) ? Number(b.frontier.cursorY) : Number.POSITIVE_INFINITY;
    if (Math.abs(aCursorY - bCursorY) > 0.01) return aCursorY - bCursorY;
    if (a.actorIndex !== b.actorIndex) return a.actorIndex - b.actorIndex;
    return a.id.localeCompare(b.id);
}

function isCheckpointAtOrBeforeFrontier<
    TTransitionSnapshot extends { currentY: number; lastSpacingAfter: number },
    TBranchStateSnapshot extends object
>(
    checkpoint: SafeCheckpoint<TTransitionSnapshot, TBranchStateSnapshot>,
    frontier: SpatialFrontier,
    frontierActorIndex: number
): boolean {
    if (checkpoint.pageIndex !== frontier.pageIndex) {
        return checkpoint.pageIndex < frontier.pageIndex;
    }

    const checkpointCursorY = Number.isFinite(checkpoint.frontier.cursorY)
        ? Number(checkpoint.frontier.cursorY)
        : Number.POSITIVE_INFINITY;
    const frontierCursorY = Number.isFinite(frontier.cursorY)
        ? Number(frontier.cursorY)
        : Number.POSITIVE_INFINITY;
    if (Number.isFinite(checkpointCursorY) && Number.isFinite(frontierCursorY) && Math.abs(checkpointCursorY - frontierCursorY) > 0.01) {
        return checkpointCursorY <= frontierCursorY;
    }

    return checkpoint.actorIndex <= frontierActorIndex;
}

function clonePage(page: Page): Page {
    return {
        ...page,
        boxes: page.boxes.map(cloneBox)
    };
}

function cloneBox(box: Box): Box {
    return {
        ...box,
        properties: box.properties ? { ...box.properties } : box.properties,
        meta: box.meta ? { ...box.meta } : box.meta
    };
}
