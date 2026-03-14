import { LAYOUT_DEFAULTS } from './defaults';
import {
    type ActorOverflowEntryHandlingOutcome,
    type ActorOverflowEntrySettlementOutcome,
    type ActorOverflowPreSplitHandlingOutcome,
    type ActorOverflowResolution,
    type ActorOverflowSplitEntryHandlingOutcome,
    type FragmentCommitState,
    type PaginationLoopAction,
    type SplitExecution
} from './layout-session-types';
import type { Box, Page } from '../types';
import { getActorOverflowHandling, type ActorOverflowHandling } from './actor-overflow';
import type { PackagerContext, PackagerUnit } from './packagers/packager-types';

type PackagerWithFlowBox = PackagerUnit & {
    flowBox?: {
        properties?: {
            _tableModel?: unknown;
        };
    };
};

type PackagerWithStoryElement = PackagerUnit & {
    storyElement?: unknown;
};

export type CollisionRuntimeHost = {
    commitFragmentBoxes(
        actor: PackagerUnit,
        boxes: readonly Box[],
        state: FragmentCommitState
    ): { boxes: Box[]; currentY: number; lastSpacingAfter: number };
    executeSplitAttempt(
        actor: PackagerUnit,
        availableWidth: number,
        availableHeight: number,
        context: PackagerContext
    ): SplitExecution | null;
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
    resolveNextActorIndex(currentIndex: number, shouldAdvanceIndex: boolean): number;
    toPaginationLoopAction(outcome: ActorOverflowEntrySettlementOutcome): PaginationLoopAction;
    getSplitMarkerReserve(actor: PackagerUnit): number;
};

export class CollisionRuntime {
    constructor(
        private readonly host: CollisionRuntimeHost
    ) { }

    finalizeForcedOverflowCommit(
        actor: PackagerUnit,
        boxes: readonly Box[],
        state: FragmentCommitState
    ): { committed: { boxes: Box[]; currentY: number; lastSpacingAfter: number }; shouldAdvancePage: true } {
        return {
            committed: this.host.commitFragmentBoxes(actor, boxes, state),
            shouldAdvancePage: true
        };
    }

    handleActorOverflowPreSplit(
        outcome: 'force-commit-at-top' | 'advance-page-before-split',
        actor: PackagerUnit,
        boxes: readonly Box[] | null,
        state: FragmentCommitState
    ): ActorOverflowPreSplitHandlingOutcome {
        if (outcome === 'advance-page-before-split') {
            return {
                committed: null,
                shouldAdvancePage: true,
                shouldAdvanceIndex: false
            };
        }

        const forced = this.finalizeForcedOverflowCommit(actor, boxes ?? [], state);
        return {
            committed: forced.committed,
            shouldAdvancePage: forced.shouldAdvancePage,
            shouldAdvanceIndex: true
        };
    }

    handleActorOverflowSplitEntry(
        outcome: 'advance-page-for-top-split' | 'attempt-split-now',
        actor: PackagerUnit,
        availableWidth: number,
        availableHeight: number,
        context: PackagerContext
    ): ActorOverflowSplitEntryHandlingOutcome {
        if (outcome === 'advance-page-for-top-split') {
            return {
                splitExecution: null,
                shouldAdvancePage: true
            };
        }

        return {
            splitExecution: this.host.executeSplitAttempt(actor, availableWidth, availableHeight, context),
            shouldAdvancePage: false
        };
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
    ): ActorOverflowEntryHandlingOutcome {
        if (overflowHandling.preSplitOutcome !== 'continue-to-split-phase') {
            const outcome = this.handleActorOverflowPreSplit(
                overflowHandling.preSplitOutcome,
                actor,
                boxes,
                state
            );
            return {
                action: 'handled',
                nextCurrentY: outcome.committed?.currentY ?? currentY,
                nextLastSpacingAfter: outcome.committed?.lastSpacingAfter ?? lastSpacingAfter,
                shouldAdvancePage: outcome.shouldAdvancePage,
                shouldAdvanceIndex: outcome.shouldAdvanceIndex,
                committedBoxes: outcome.committed?.boxes ?? []
            };
        }

        const splitEntry = this.handleActorOverflowSplitEntry(
            overflowHandling.splitEntryOutcome!,
            actor,
            availableWidth,
            availableHeight,
            context
        );

        if (splitEntry.shouldAdvancePage || !splitEntry.splitExecution) {
            return {
                action: 'handled',
                nextCurrentY: currentY,
                nextLastSpacingAfter: lastSpacingAfter,
                shouldAdvancePage: true,
                shouldAdvanceIndex: false,
                committedBoxes: []
            };
        }

        return {
            action: 'continue-to-split',
            splitExecution: splitEntry.splitExecution
        };
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
        if (overflowEntry.action === 'continue-to-split') {
            return overflowEntry;
        }

        currentPageBoxes.push(...overflowEntry.committedBoxes);

        if (!overflowEntry.shouldAdvancePage) {
            return {
                action: 'handled',
                nextPageIndex: currentPageIndex,
                nextPageBoxes: currentPageBoxes,
                nextCurrentY: overflowEntry.nextCurrentY,
                nextLastSpacingAfter: overflowEntry.nextLastSpacingAfter,
                nextActorIndex: this.host.resolveNextActorIndex(currentActorIndex, overflowEntry.shouldAdvanceIndex)
            };
        }

        const advanced = this.host.advancePage(
            pages,
            currentPageBoxes,
            currentPageIndex,
            pageWidth,
            pageHeight,
            nextPageTopY
        );
        return {
            action: 'handled',
            nextPageIndex: advanced.nextPageIndex,
            nextPageBoxes: advanced.nextPageBoxes,
            nextCurrentY: advanced.nextCurrentY,
            nextLastSpacingAfter: advanced.nextLastSpacingAfter,
            nextActorIndex: this.host.resolveNextActorIndex(currentActorIndex, overflowEntry.shouldAdvanceIndex)
        };
    }

    resolveActorOverflow(input: {
        actor: PackagerUnit;
        isAtPageTop: boolean;
        effectiveAvailableHeight: number;
        availableWidth: number;
        availableHeightAdjusted: number;
        context: PackagerContext;
        contentHeight: number;
        marginTop: number;
        marginBottom: number;
        pageLimit: number;
        pageTop: number;
        pages: Page[];
        currentPageBoxes: Box[];
        currentPageIndex: number;
        pageWidth: number;
        pageHeight: number;
        nextPageTopY: number;
        currentActorIndex: number;
        currentY: number;
        lastSpacingAfter: number;
        state: FragmentCommitState;
    }): ActorOverflowResolution {
        const overflowHandling = this.resolveActorOverflowHandling({
            actor: input.actor,
            isAtPageTop: input.isAtPageTop,
            effectiveAvailableHeight: input.effectiveAvailableHeight,
            availableWidth: input.availableWidth,
            availableHeightAdjusted: input.availableHeightAdjusted,
            context: input.context,
            contentHeight: input.contentHeight,
            marginTop: input.marginTop,
            marginBottom: input.marginBottom,
            pageLimit: input.pageLimit,
            pageTop: input.pageTop
        });
        const markerReserve = this.host.getSplitMarkerReserve(input.actor);
        const splitAvailableHeight = input.availableHeightAdjusted - markerReserve;
        const preSplitBoxes = overflowHandling.preSplitOutcome === 'force-commit-at-top'
            ? (input.actor.emitBoxes(input.availableWidth, input.availableHeightAdjusted, input.context) || [])
            : null;
        const overflowEntry = this.handleActorOverflowEntry(
            overflowHandling,
            input.actor,
            preSplitBoxes,
            input.state,
            input.availableWidth,
            splitAvailableHeight,
            input.context,
            input.currentY,
            input.lastSpacingAfter
        );

        if (overflowEntry.action === 'continue-to-split') {
            return {
                action: 'continue-to-split',
                splitExecution: overflowEntry.splitExecution
            };
        }

        const settlement = this.settleActorOverflowEntry(
            input.pages,
            input.currentPageBoxes,
            input.currentPageIndex,
            input.pageWidth,
            input.pageHeight,
            input.nextPageTopY,
            input.currentActorIndex,
            overflowEntry
        );
        if (settlement.action !== 'handled') {
            throw new Error('Expected handled overflow settlement.');
        }

        return {
            action: 'handled',
            loopAction: this.host.toPaginationLoopAction(settlement)
        };
    }

    resolveActorOverflowHandling(input: {
        actor: PackagerUnit;
        isAtPageTop: boolean;
        effectiveAvailableHeight: number;
        availableWidth: number;
        availableHeightAdjusted: number;
        context: PackagerContext;
        contentHeight: number;
        marginTop: number;
        marginBottom: number;
        pageLimit: number;
        pageTop: number;
    }): ActorOverflowHandling {
        const overflowIsUnbreakable = input.actor.isUnbreakable(input.effectiveAvailableHeight);
        const overflowPreviewBoxes = input.isAtPageTop
            ? true
            : !!input.actor.emitBoxes(input.availableWidth, input.availableHeightAdjusted, input.context);
        const isTablePackager = this.hasTableFlowBox(input.actor);
        const isStoryPackager = this.hasStoryElement(input.actor);
        const allowsMidPageSplit = isTablePackager || isStoryPackager;
        const emptyLayoutBefore = input.marginTop;
        const emptyAvailable = input.pageLimit - input.pageTop;
        const requiredOnEmpty = input.contentHeight + emptyLayoutBefore + input.marginBottom;

        return getActorOverflowHandling({
            isAtPageTop: input.isAtPageTop,
            isUnbreakable: overflowIsUnbreakable,
            hasPreviewBoxes: overflowPreviewBoxes,
            allowsMidPageSplit,
            overflowsEmptyPage: requiredOnEmpty > emptyAvailable + LAYOUT_DEFAULTS.wrapTolerance
        });
    }

    private hasTableFlowBox(actor: PackagerUnit): actor is PackagerWithFlowBox {
        return !!(actor as PackagerWithFlowBox).flowBox?.properties?._tableModel;
    }

    private hasStoryElement(actor: PackagerUnit): actor is PackagerWithStoryElement {
        return !!(actor as PackagerWithStoryElement).storyElement;
    }
}
