import { performance } from 'node:perf_hooks';
import type { Box, Page } from '../types';
import type { FlowBox } from './layout-core-types';
import { getTailSplitPostAttemptOutcome, getWholeFormationOverflowHandling, type WholeFormationOverflowHandling } from './actor-formation';
import { computeKeepWithNextPlan } from './keep-with-next-collaborator';
import {
    type KeepWithNextFormationPlan,
    type KeepWithNextOverflowActionInput,
    type KeepWithNextPlanningResolution,
    type PaginationLoopAction,
    type PaginationState,
    type TailSplitFormationSettlementOutcome,
    type WholeFormationOverflowEntryOutcome,
    type WholeFormationOverflowEntrySettlementOutcome,
    type WholeFormationOverflowResolution
} from './layout-session';
import type { PackagerContext, PackagerUnit } from './packagers/packager-types';

export type AIRuntimeHost = {
    advancePage(
        pages: Page[],
        currentPageBoxes: Box[],
        currentPageIndex: number,
        pageWidth: number,
        pageHeight: number,
        nextPageTopY: number
    ): {
        nextPageIndex: number;
        nextPageBoxes: Box[];
        nextCurrentY: number;
        nextLastSpacingAfter: number;
    };
    toPaginationLoopAction(
        outcome: TailSplitFormationSettlementOutcome | WholeFormationOverflowEntrySettlementOutcome
    ): PaginationLoopAction;
    executeTailSplitFormationBranch(
        pages: Page[],
        currentPageBoxes: Box[],
        currentPageIndex: number,
        pageWidth: number,
        pageHeight: number,
        nextPageTopY: number,
        currentActorIndex: number,
        actorQueue: PackagerUnit[],
        tailSplitExecution: {
            prefix: PackagerUnit[];
            splitCandidate: PackagerUnit;
            replaceCount: number;
            splitMarkerReserve: number;
        },
        state: {
            currentY: number;
            lastSpacingAfter: number;
            pageLimit: number;
            availableWidth: number;
        },
        contextBase: Omit<PackagerContext, 'pageIndex' | 'cursorY'>,
        shouldAdvancePageOnFailure: boolean,
        positionMarker: (marker: FlowBox, currentY: number, layoutBefore: number, availableWidth: number, pageIndex: number) => Box | Box[]
    ): TailSplitFormationSettlementOutcome;
    recordProfile(metric: 'keepWithNextBranchCalls' | 'keepWithNextBranchMs', delta: number): void;
};

export class AIRuntime {
    private readonly keepWithNextPlans = new Map<string, KeepWithNextFormationPlan>();

    constructor(
        private readonly host: AIRuntimeHost
    ) { }

    setKeepWithNextPlan(actorId: string, plan: KeepWithNextFormationPlan): void {
        this.keepWithNextPlans.set(actorId, plan);
    }

    getKeepWithNextPlan(actorId: string): KeepWithNextFormationPlan | undefined {
        return this.keepWithNextPlans.get(actorId);
    }

    handleWholeFormationOverflowEntry(
        handling: WholeFormationOverflowHandling,
        pages: Page[],
        currentPageBoxes: Box[],
        currentPageIndex: number,
        pageWidth: number,
        pageHeight: number,
        nextPageTop: number
    ): WholeFormationOverflowEntryOutcome {
        if (handling.tailSplitExecution) {
            return {
                action: 'continue-tail-split',
                tailSplitExecution: handling.tailSplitExecution
            };
        }

        if (handling.fallbackHandling === 'advance-page') {
            const advanced = this.host.advancePage(
                pages,
                currentPageBoxes,
                currentPageIndex,
                pageWidth,
                pageHeight,
                nextPageTop
            );
            return {
                action: 'advance-page',
                nextPageIndex: advanced.nextPageIndex,
                nextPageBoxes: advanced.nextPageBoxes,
                nextCurrentY: advanced.nextCurrentY,
                nextLastSpacingAfter: advanced.nextLastSpacingAfter
            };
        }

        return { action: 'fallthrough-local-overflow' };
    }

    settleWholeFormationOverflowEntry(
        currentActorIndex: number,
        outcome: WholeFormationOverflowEntryOutcome
    ): WholeFormationOverflowEntrySettlementOutcome {
        if (outcome.action === 'advance-page') {
            return {
                action: 'advance-page',
                nextPageIndex: outcome.nextPageIndex,
                nextPageBoxes: outcome.nextPageBoxes,
                nextCurrentY: outcome.nextCurrentY,
                nextLastSpacingAfter: outcome.nextLastSpacingAfter,
                nextActorIndex: currentActorIndex
            };
        }

        if (outcome.action === 'continue-tail-split') {
            return outcome;
        }

        return outcome;
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
        if (!input.handling) {
            return {
                handling: null,
                fallbackOutcome: null,
                action: null,
                tailSplitExecution: null
            };
        }

        const settled = this.settleWholeFormationOverflowEntry(
            input.currentActorIndex,
            this.handleWholeFormationOverflowEntry(
                input.handling,
                input.pages,
                input.currentPageBoxes,
                input.currentPageIndex,
                input.pageWidth,
                input.pageHeight,
                input.nextPageTop
            )
        );
        const action = this.host.toPaginationLoopAction(settled);

        return {
            handling: input.handling,
            fallbackOutcome: input.handling.fallbackHandling ?? null,
            action,
            tailSplitExecution: action.action === 'continue-tail-split'
                ? action.tailSplitExecution
                : (input.handling.tailSplitExecution ?? null)
        };
    }

    resolveKeepWithNextOverflowAction(input: KeepWithNextOverflowActionInput): PaginationLoopAction | null {
        const overflowsCurrentPlacement = input.planning?.plan
            ? input.wholeFormationOverflow.handling !== null
            : ((input.effectiveHeight - input.marginBottom) > input.effectiveAvailableHeight);
        if (!overflowsCurrentPlacement) {
            return null;
        }

        if (input.planning?.plan && input.wholeFormationOverflow.tailSplitExecution) {
            const keepBranchStart = performance.now();
            const settlement = this.host.executeTailSplitFormationBranch(
                input.pages,
                input.currentPageBoxes,
                input.currentPageIndex,
                input.pageWidth,
                input.pageHeight,
                input.nextPageTopY,
                input.currentActorIndex,
                input.actorQueue,
                input.wholeFormationOverflow.tailSplitExecution,
                input.state,
                input.contextBase,
                input.planning.tailSplitFailureOutcome === 'advance-page',
                input.positionMarker
            );
            this.host.recordProfile('keepWithNextBranchCalls', 1);
            this.host.recordProfile('keepWithNextBranchMs', performance.now() - keepBranchStart);
            return this.host.toPaginationLoopAction(settlement);
        }

        if (input.wholeFormationOverflow.action?.action === 'continue-loop') {
            return input.wholeFormationOverflow.action;
        }

        return null;
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
        const plan = this.getKeepWithNextPlan(input.actorId) ?? computeKeepWithNextPlan({
            actorQueue: input.actorQueue,
            actorIndex: input.actorIndex,
            paginationState: input.paginationState,
            availableWidth: input.availableWidth,
            availableHeight: input.availableHeight,
            lastSpacingAfter: input.lastSpacingAfter,
            isAtPageTop: input.isAtPageTop,
            context: input.context
        });
        if (!plan) return null;

        const handling = getWholeFormationOverflowHandling(plan, input.isAtPageTop);
        return {
            plan,
            handling,
            tailSplitSuccessOutcome: getTailSplitPostAttemptOutcome(plan, true, input.isAtPageTop),
            tailSplitFailureOutcome: getTailSplitPostAttemptOutcome(plan, false, input.isAtPageTop)
        };
    }
}
