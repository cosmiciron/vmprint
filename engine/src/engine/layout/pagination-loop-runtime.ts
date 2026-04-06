import type {
    ActorOverflowEntrySettlementOutcome,
    ActorPlacementSettlementOutcome,
    ActorSplitFailureSettlementOutcome,
    DeferredSplitPlacementSettlementOutcome,
    GenericSplitSuccessSettlementOutcome,
    TailSplitFormationSettlementOutcome,
    WholeFormationOverflowEntrySettlementOutcome
} from './runtime/session/session-pagination-types';
import type { PaginationState } from './runtime/session/session-lifecycle-types';
import type { PaginationLoopAction } from './runtime/session/session-pagination-types';

export class PaginationLoopRuntime {
    resolveNextActorIndex(currentIndex: number, shouldAdvanceIndex: boolean): number {
        return shouldAdvanceIndex ? currentIndex + 1 : currentIndex;
    }

    applyPaginationState(target: PaginationState, next: PaginationState): void {
        target.currentPageIndex = next.currentPageIndex;
        target.currentPageBoxes = next.currentPageBoxes;
        target.currentY = next.currentY;
        target.lastSpacingAfter = next.lastSpacingAfter;
    }

    createContinueLoopAction(
        paginationState: PaginationState,
        nextActorIndex: number
    ): PaginationLoopAction {
        return {
            action: 'continue-loop',
            paginationState,
            nextActorIndex
        };
    }

    applyPaginationLoopAction(
        target: PaginationState,
        action: PaginationLoopAction
    ): number {
        if (action.action !== 'continue-loop') {
            throw new Error(`Cannot apply non-continuation loop action directly: ${action.action}`);
        }
        this.applyPaginationState(target, action.paginationState);
        return action.nextActorIndex;
    }

    toPaginationLoopAction(outcome: TailSplitFormationSettlementOutcome): PaginationLoopAction;
    toPaginationLoopAction(outcome: WholeFormationOverflowEntrySettlementOutcome): PaginationLoopAction;
    toPaginationLoopAction(outcome: ActorOverflowEntrySettlementOutcome): PaginationLoopAction;
    toPaginationLoopAction(outcome: ActorSplitFailureSettlementOutcome): PaginationLoopAction;
    toPaginationLoopAction(outcome: GenericSplitSuccessSettlementOutcome): PaginationLoopAction;
    toPaginationLoopAction(outcome: ActorPlacementSettlementOutcome): PaginationLoopAction;
    toPaginationLoopAction(outcome: DeferredSplitPlacementSettlementOutcome): PaginationLoopAction;
    toPaginationLoopAction(outcome: {
        action?: string;
        tailSplitExecution?: {
            prefix: any[];
            splitCandidate: any;
            replaceCount: number;
            splitMarkerReserve: number;
        };
        splitExecution?: any;
        nextPageIndex?: number;
        nextPageBoxes?: any[];
        nextCurrentY?: number;
        nextLastSpacingAfter?: number;
        nextActorIndex?: number;
    }, nextActorIndex?: number): PaginationLoopAction;
    toPaginationLoopAction(outcome: {
        action?: string;
        tailSplitExecution?: {
            prefix: any[];
            splitCandidate: any;
            replaceCount: number;
            splitMarkerReserve: number;
        };
        splitExecution?: any;
        nextPageIndex?: number;
        nextPageBoxes?: any[];
        nextCurrentY?: number;
        nextLastSpacingAfter?: number;
        nextActorIndex?: number;
    }, nextActorIndex?: number): PaginationLoopAction {
        if (outcome.action === 'continue-tail-split') {
            if (!outcome.tailSplitExecution) {
                throw new Error('continue-tail-split outcome missing tailSplitExecution');
            }
            return {
                action: 'continue-tail-split',
                tailSplitExecution: outcome.tailSplitExecution
            };
        }
        if (outcome.action === 'continue-to-split') {
            if (!outcome.splitExecution) {
                throw new Error('continue-to-split outcome missing splitExecution');
            }
            return {
                action: 'continue-to-split',
                splitExecution: outcome.splitExecution
            };
        }
        if (outcome.action === 'fallthrough-local-overflow') {
            return { action: 'fallthrough-local-overflow' };
        }
        if (
            outcome.nextPageIndex === undefined
            || outcome.nextPageBoxes === undefined
            || outcome.nextCurrentY === undefined
            || outcome.nextLastSpacingAfter === undefined
            || (nextActorIndex === undefined && outcome.nextActorIndex === undefined)
        ) {
            throw new Error('continue-loop outcome missing pagination state');
        }
        return this.createContinueLoopAction(
            {
                currentPageIndex: outcome.nextPageIndex,
                currentPageBoxes: outcome.nextPageBoxes,
                currentY: outcome.nextCurrentY,
                lastSpacingAfter: outcome.nextLastSpacingAfter
            },
            nextActorIndex ?? outcome.nextActorIndex!
        );
    }
}
