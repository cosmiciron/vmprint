import type { Box, Page } from '../types';
import { SequentialPageChunkPolicy, type ChunkPolicy } from './chunk-policy';
import type {
    PageAdvanceOutcome,
    PaginationLoopAction
} from './runtime/session/session-pagination-types';
import type { PaginationState } from './runtime/session/session-lifecycle-types';
import type { PageFinalizationState } from './runtime/session/session-state-types';
import {
    collectScriptRegionsFromPageSummaries,
    findScriptRegionByNameInRegions,
    type ScriptRegionRef
} from './script-region-query';
import { summarizePageRegions, type PageRegionSummary } from './page-region-summary';

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
    private pageRegionSummaries: PageRegionSummary[] = [];
    private cachedScriptRegions: readonly ScriptRegionRef[] | null = null;
    private readonly chunkPolicy: ChunkPolicy;

    constructor(
        private readonly host: LifecycleRuntimeHost,
        chunkPolicy: ChunkPolicy = new SequentialPageChunkPolicy()
    ) {
        this.chunkPolicy = chunkPolicy;
    }

    resetForSimulation(): void {
        this.finalizedPages = [];
        this.pageRegionSummaries = [];
        this.cachedScriptRegions = null;
        this.pageFinalizationStates.clear();
        this.logicalPageNumberCursor = 0;
    }

    recordFinalizedPage(page: Page): void {
        this.finalizedPages.push(page);
        this.pageRegionSummaries.push(summarizePageRegions(page));
        this.cachedScriptRegions = null;
    }

    advancePage(
        pages: Page[],
        currentPageBoxes: Box[],
        currentPageIndex: number,
        pageWidth: number,
        pageHeight: number,
        nextPageTopY: number
    ): PageAdvanceOutcome {
        const advanced = this.chunkPolicy.advanceChunk({
            pages,
            currentChunkBoxes: currentPageBoxes,
            currentChunkIndex: currentPageIndex,
            chunkWidth: pageWidth,
            chunkHeight: pageHeight,
            nextChunkStartY: nextPageTopY,
            finalizeChunk: (chunkIndex, width, height, boxes) =>
                this.host.finalizeCommittedPage(chunkIndex, width, height, boxes),
            notifyChunkStart: (chunkIndex, width, height, boxes) =>
                this.host.notifyPageStart(chunkIndex, width, height, boxes)
        });

        return {
            nextPageIndex: advanced.nextChunkIndex,
            nextPageBoxes: advanced.nextChunkBoxes,
            nextCurrentY: advanced.nextCurrentY,
            nextLastSpacingAfter: advanced.nextLastSpacingAfter
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

    resolveChunkOriginWorldY(chunkIndex: number, chunkHeight: number): number {
        return this.chunkPolicy.resolveChunkOriginWorldY(chunkIndex, chunkHeight);
    }

    setFinalizedPages(pages: Page[]): void {
        this.finalizedPages = pages;
        this.pageRegionSummaries = pages.map((page) => summarizePageRegions(page));
        this.cachedScriptRegions = null;
    }

    getFinalizedPages(): readonly Page[] {
        return this.finalizedPages;
    }

    getPageRegionSummaries(): readonly PageRegionSummary[] {
        return this.pageRegionSummaries;
    }

    getScriptRegions(): readonly ScriptRegionRef[] {
        if (this.cachedScriptRegions) {
            return this.cachedScriptRegions;
        }
        this.cachedScriptRegions = collectScriptRegionsFromPageSummaries(this.pageRegionSummaries);
        return this.cachedScriptRegions;
    }

    findScriptRegionByName(name: string): ScriptRegionRef | null {
        const normalized = String(name || '').trim();
        if (!normalized) return null;
        return findScriptRegionByNameInRegions(this.getScriptRegions(), normalized);
    }
}
