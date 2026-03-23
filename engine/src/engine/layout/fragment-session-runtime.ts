import type { Box } from '../types';
import type { LocalActorSignalSnapshot } from './actor-communication-runtime';
import type { FlowBox, ContinuationArtifacts } from './layout-core-types';
import { LAYOUT_DEFAULTS } from './defaults';
import { Kernel } from './kernel';
import type {
    ContinuationQueueOutcome,
    FragmentCommitState,
    LocalBranchSnapshot,
    LocalQueueSnapshot,
    LocalSplitStateSnapshot,
    LocalTransitionSnapshot,
    SessionBranchStateSnapshot,
    SequencePlacementCheckpoint,
    SequencePlacementState,
    SplitAttempt,
    SplitFragmentAftermathInput,
    SplitFragmentAftermathState,
    SplitMarkerPlacementState
} from './layout-session-types';
import type { PackagerContext, PackagerSplitResult, PackagerUnit } from './packagers/packager-types';

type SplitMarkerPositioner = (
    marker: FlowBox,
    currentY: number,
    layoutBefore: number,
    availableWidth: number,
    pageIndex: number
) => Box | Box[];

export type FragmentSessionRuntimeHost = {
    notifyActorSpawn(actor: PackagerUnit): void;
    notifyContinuationEnqueued(predecessor: PackagerUnit, successor: PackagerUnit): void;
    notifySplitAccepted(attempt: SplitAttempt, result: PackagerSplitResult): void;
    notifyActorCommitted(actor: PackagerUnit, committed: Box[]): void;
    captureSessionBranchStateSnapshot(actorQueue: readonly PackagerUnit[]): SessionBranchStateSnapshot;
    restoreSessionBranchStateSnapshot(actorQueue: PackagerUnit[], snapshot: SessionBranchStateSnapshot): void;
    captureLocalActorSignalSnapshot(): LocalActorSignalSnapshot;
    restoreLocalActorSignalSnapshot(snapshot: LocalActorSignalSnapshot): void;
};

export class FragmentSessionRuntime {
    constructor(
        private readonly kernel: Kernel,
        private readonly host: FragmentSessionRuntimeHost
    ) { }

    getPublishedArtifacts(): ReadonlyMap<string, unknown> {
        return this.kernel.getPublishedArtifacts();
    }

    setContinuationArtifacts(actorId: string, artifacts: ContinuationArtifacts): void {
        this.kernel.setContinuationArtifacts(actorId, artifacts);
    }

    getContinuationArtifacts(actorId: string): ContinuationArtifacts | undefined {
        return this.kernel.getContinuationArtifacts(actorId);
    }

    stageActorsBeforeContinuation(continuationActorId: string, actors: PackagerUnit[]): void {
        this.kernel.stageActorsBeforeContinuation(continuationActorId, actors);
        for (const actor of actors) {
            this.host.notifyActorSpawn(actor);
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
        positionMarker: SplitMarkerPositioner
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
            ...this.host.captureSessionBranchStateSnapshot(actorQueue),
            ...this.host.captureLocalActorSignalSnapshot()
        };
    }

    captureLocalQueueSnapshot(actorQueue: readonly PackagerUnit[]): LocalQueueSnapshot {
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
        this.host.restoreSessionBranchStateSnapshot(actorQueue, snapshot);
        this.host.restoreLocalActorSignalSnapshot(snapshot);
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
                committed.meta = { ...committed.meta, actorId: actor.actorId, pageIndex: state.pageIndex };
            }
            return committed;
        });

        this.host.notifyActorCommitted(actor, committedBoxes);

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
        positionMarker: SplitMarkerPositioner
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
        positionMarker: SplitMarkerPositioner
    ): { boxes: Box[]; currentY: number; lastSpacingAfter: number } {
        this.host.notifySplitAccepted(attempt, result);
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
            this.host.notifyContinuationEnqueued(predecessor, continuation);
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
            this.host.notifyContinuationEnqueued(predecessor, continuation);
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
        continuation: PackagerUnit | null | undefined
    ): ContinuationQueueOutcome {
        return this.kernel.previewContinuationQueueSettlement(
            actorQueue,
            startIndex,
            replaceCount,
            continuation
        );
    }
}
