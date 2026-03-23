import type { Box, Page } from '../types';
import { CollisionRuntime } from './collision-runtime';
import type { FlowBox } from './layout-core-types';
import { PhysicsRuntime } from './physics-runtime';
import { TransitionsRuntime } from './transitions-runtime';
import type {
    ActorOverflowEntryHandlingOutcome,
    ActorOverflowEntrySettlementOutcome,
    ActorOverflowResolution,
    ActorMeasurement,
    ActorPlacementActionInput,
    ActorPlacementAttemptOutcome,
    ActorPlacementHandlingOutcome,
    ActorPlacementSettlementOutcome,
    ActorSplitFailureHandlingOutcome,
    ActorSplitFailureResolution,
    ActorSplitFailureSettlementOutcome,
    ConstraintField,
    DeferredSplitPlacementOutcome,
    DeferredSplitPlacementSettlementOutcome,
    FragmentCommitState,
    GenericSplitActionInput,
    GenericSplitSuccessHandlingOutcome,
    GenericSplitSuccessSettlementOutcome,
    PaginationLoopAction,
    ResolvedPlacementFrame,
    SplitExecution,
} from './layout-session-types';
import type { ActorOverflowHandling } from './actor-overflow';
import type { PackagerContext, PackagerUnit } from './packagers/packager-types';

export type PlacementSessionRuntimeHost = {
    commitFragmentBoxes(
        actor: PackagerUnit,
        boxes: readonly Box[],
        state: FragmentCommitState
    ): { boxes: Box[]; currentY: number; lastSpacingAfter: number };
    toPaginationLoopAction(
        outcome:
            | ActorOverflowEntrySettlementOutcome
            | ActorSplitFailureSettlementOutcome
            | DeferredSplitPlacementSettlementOutcome
            | GenericSplitSuccessSettlementOutcome
            | ActorPlacementSettlementOutcome,
        nextActorIndex?: number
    ): PaginationLoopAction;
};

export class PlacementSessionRuntime {
    constructor(
        private readonly physicsRuntime: PhysicsRuntime,
        private readonly collisionRuntime: CollisionRuntime,
        private readonly transitionsRuntime: TransitionsRuntime,
        private readonly host: PlacementSessionRuntimeHost
    ) { }

    handleActorOverflowPreSplit(
        outcome: 'force-commit-at-top' | 'advance-page-before-split',
        actor: PackagerUnit,
        boxes: readonly Box[] | null,
        state: FragmentCommitState
    ) {
        return this.collisionRuntime.handleActorOverflowPreSplit(outcome, actor, boxes, state);
    }

    handleActorOverflowSplitEntry(
        outcome: 'advance-page-for-top-split' | 'attempt-split-now',
        actor: PackagerUnit,
        availableWidth: number,
        availableHeight: number,
        context: PackagerContext
    ) {
        return this.collisionRuntime.handleActorOverflowSplitEntry(outcome, actor, availableWidth, availableHeight, context);
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
    ) {
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

    resolveActorOverflow(input: Parameters<CollisionRuntime['resolveActorOverflow']>[0]): ActorOverflowResolution {
        return this.collisionRuntime.resolveActorOverflow(input);
    }

    resolveActorOverflowHandling(input: Parameters<CollisionRuntime['resolveActorOverflowHandling']>[0]): ActorOverflowHandling {
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
            committed: this.host.commitFragmentBoxes(actor, boxes ?? [], state),
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
        ...args: Parameters<TransitionsRuntime['handleGenericSplitSuccess']>
    ): GenericSplitSuccessHandlingOutcome {
        return this.transitionsRuntime.handleGenericSplitSuccess(...args);
    }

    settleGenericSplitSuccess(
        ...args: Parameters<TransitionsRuntime['settleGenericSplitSuccess']>
    ): GenericSplitSuccessSettlementOutcome {
        return this.transitionsRuntime.settleGenericSplitSuccess(...args);
    }

    executeGenericSplitBranch(
        ...args: Parameters<TransitionsRuntime['executeGenericSplitBranch']>
    ): ReturnType<TransitionsRuntime['executeGenericSplitBranch']> {
        return this.transitionsRuntime.executeGenericSplitBranch(...args);
    }

    resolveGenericSplitAction(input: GenericSplitActionInput): PaginationLoopAction {
        return this.host.toPaginationLoopAction(
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
    ) {
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
        return this.physicsRuntime.handleActorPlacementAttempt(currentPageBoxes, outcome, currentY, lastSpacingAfter);
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

    measurePreparedActor(
        actor: PackagerUnit,
        availableWidth: number,
        availableHeight: number,
        layoutBefore: number,
        context: PackagerContext
    ): ActorMeasurement {
        return this.physicsRuntime.measurePreparedActor(actor, availableWidth, availableHeight, layoutBefore, context);
    }
}
