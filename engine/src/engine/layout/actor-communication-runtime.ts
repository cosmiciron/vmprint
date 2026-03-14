import type { Box, Page } from '../types';
import { ActorEventBus, type ActorEventBusSnapshot, type ActorSignal, type ActorSignalDraft } from './actor-event-bus';
import type { FlowBox } from './layout-core-types';
import type { ObservationResult, PackagerContext, PackagerUnit, SpatialFrontier } from './packagers/packager-types';

export type LocalActorSignalSnapshot = ActorEventBusSnapshot;

export type ObserverSweepResult = {
    changed: boolean;
    geometryChanged: boolean;
    earliestAffectedFrontier?: SpatialFrontier;
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
    private readonly actorIndexByActorId = new Map<string, number>();
    private readonly actorIndexBySourceId = new Map<string, number>();
    private safeCheckpoints: SafeCheckpoint<TTransitionSnapshot, TBranchStateSnapshot>[] = [];
    private safeCheckpointSequence = 0;

    constructor(
        private readonly recordObserverCheckpointSweep: () => void
    ) { }

    resetForSimulation(): void {
        this.actorEventBus.resetForSimulation();
        this.observerRegistry.clear();
        this.actorIndexByActorId.clear();
        this.actorIndexBySourceId.clear();
        this.safeCheckpoints = [];
        this.safeCheckpointSequence = 0;
    }

    publishActorSignal(signal: ActorSignalDraft): ActorSignal {
        return this.actorEventBus.publish(signal);
    }

    getActorSignals(topic?: string): readonly ActorSignal[] {
        return this.actorEventBus.read(topic);
    }

    captureLocalActorSignalSnapshot(): LocalActorSignalSnapshot {
        return this.actorEventBus.captureSnapshot();
    }

    restoreLocalActorSignalSnapshot(snapshot: LocalActorSignalSnapshot): void {
        this.actorEventBus.restoreSnapshot(snapshot);
    }

    notifyActorSpawn(actor: PackagerUnit): void {
        if (typeof actor.observeCommittedSignals === 'function') {
            this.observerRegistry.set(actor.actorId, actor);
        }
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
        this.recordObserverCheckpointSweep();

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
            if (isEarlierFrontier(result, earliestAffectedFrontier)) {
                earliestAffectedFrontier = result.earliestAffectedFrontier;
            }
        }

        return { changed, geometryChanged, earliestAffectedFrontier };
    }

    resolveSafeCheckpoint(
        frontier: SpatialFrontier
    ): SafeCheckpoint<TTransitionSnapshot, TBranchStateSnapshot> | null {
        const anchoredCandidates = this.safeCheckpoints
            .filter((checkpoint) =>
                checkpoint.pageIndex === frontier.pageIndex
                && (
                    (frontier.sourceId && checkpoint.anchorSourceId === frontier.sourceId)
                    || (frontier.actorId && checkpoint.anchorActorId === frontier.actorId)
                )
            )
            .sort(sortCheckpointsDescending);
        if (anchoredCandidates.length > 0) {
            return anchoredCandidates[0];
        }

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
}

function isEarlierFrontier(
    result: ObservationResult,
    current: SpatialFrontier | undefined
): result is ObservationResult & { earliestAffectedFrontier: SpatialFrontier } {
    if (!result.earliestAffectedFrontier) {
        return false;
    }

    return !current || result.earliestAffectedFrontier.pageIndex < current.pageIndex;
}

function sortCheckpointsDescending<
    TTransitionSnapshot extends { currentY: number; lastSpacingAfter: number },
    TBranchStateSnapshot extends object
>(
    a: SafeCheckpoint<TTransitionSnapshot, TBranchStateSnapshot>,
    b: SafeCheckpoint<TTransitionSnapshot, TBranchStateSnapshot>
): number {
    if (a.pageIndex !== b.pageIndex) return b.pageIndex - a.pageIndex;
    if (a.actorIndex !== b.actorIndex) return b.actorIndex - a.actorIndex;
    return b.id.localeCompare(a.id);
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
