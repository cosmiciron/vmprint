import type { Box, Page } from '../types';
import type {
    PageAdvanceOutcome,
    PageFinalizationState,
    PaginationLoopAction,
    PaginationState
} from './layout-session-types';

export type LifecycleRuntimeHost = {
    finalizeCommittedPage(
        pageIndex: number,
        width: number,
        height: number,
        boxes: readonly Box[]
    ): Page;
    notifyPageStart(pageIndex: number, width: number, height: number, boxes: Box[]): void;
    createContinueLoopAction(
        paginationState: PaginationState,
        nextActorIndex: number
    ): PaginationLoopAction;
};

export class LifecycleRuntime {
    private readonly pageFinalizationStates = new Map<number, PageFinalizationState>();
    private logicalPageNumberCursor = 0;
    private finalizedPages: Page[] = [];

    constructor(
        private readonly host: LifecycleRuntimeHost
    ) { }

    resetForSimulation(): void {
        this.finalizedPages = [];
        this.pageFinalizationStates.clear();
        this.logicalPageNumberCursor = 0;
    }

    advancePage(
        pages: Page[],
        currentPageBoxes: Box[],
        currentPageIndex: number,
        pageWidth: number,
        pageHeight: number,
        nextPageTopY: number
    ): PageAdvanceOutcome {
        if (currentPageBoxes.length > 0) {
            pages.push(this.host.finalizeCommittedPage(currentPageIndex, pageWidth, pageHeight, currentPageBoxes));
        }

        const nextPageIndex = currentPageIndex + 1;
        const nextPageBoxes: Box[] = [];
        this.host.notifyPageStart(nextPageIndex, pageWidth, pageHeight, nextPageBoxes);

        return {
            nextPageIndex,
            nextPageBoxes,
            nextCurrentY: nextPageTopY,
            nextLastSpacingAfter: 0
        };
    }

    closePagination(
        pages: Page[],
        currentPageBoxes: readonly Box[],
        currentPageIndex: number,
        pageWidth: number,
        pageHeight: number
    ): void {
        if (currentPageBoxes.length === 0) return;
        pages.push(this.host.finalizeCommittedPage(currentPageIndex, pageWidth, pageHeight, currentPageBoxes));
    }

    restartCurrentActorOnNextPage(
        pages: Page[],
        currentPageBoxes: Box[],
        currentPageIndex: number,
        pageWidth: number,
        pageHeight: number,
        nextPageTopY: number,
        actorIndex: number
    ): PaginationLoopAction {
        const pageAdvance = this.advancePage(
            pages,
            currentPageBoxes,
            currentPageIndex,
            pageWidth,
            pageHeight,
            nextPageTopY
        );
        return this.host.createContinueLoopAction(
            {
                currentPageIndex: pageAdvance.nextPageIndex,
                currentPageBoxes: pageAdvance.nextPageBoxes,
                currentY: pageAdvance.nextCurrentY,
                lastSpacingAfter: pageAdvance.nextLastSpacingAfter
            },
            actorIndex
        );
    }

    recordPageFinalization(state: PageFinalizationState): void {
        this.pageFinalizationStates.set(state.pageIndex, state);
    }

    resetLogicalPageNumbering(startAt: number): void {
        const normalized = Number.isFinite(startAt) ? Math.floor(Number(startAt)) : 1;
        this.logicalPageNumberCursor = Math.max(0, normalized - 1);
    }

    allocateLogicalPageNumber(usesLogicalNumbering: boolean): number | null {
        if (!usesLogicalNumbering) {
            return null;
        }
        this.logicalPageNumberCursor += 1;
        return this.logicalPageNumberCursor;
    }

    getPageFinalizationState(pageIndex: number): PageFinalizationState | undefined {
        return this.pageFinalizationStates.get(pageIndex);
    }

    getPageFinalizationStates(): readonly PageFinalizationState[] {
        return Array.from(this.pageFinalizationStates.values()).sort((a, b) => a.pageIndex - b.pageIndex);
    }

    setFinalizedPages(pages: Page[]): void {
        this.finalizedPages = pages;
    }

    getFinalizedPages(): readonly Page[] {
        return this.finalizedPages;
    }
}
