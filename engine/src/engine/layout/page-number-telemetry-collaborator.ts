import type { LayoutConfig, Page } from '../types';
import {
    applyPageOverride,
    findWinningPageOverride,
    regionContainsLogicalPageNumber,
    resolveBaselineRegions
} from './layout-page-finalization';
import { LayoutCollaborator, LayoutSession } from './layout-session';

export type PageNumberSummary = {
    pageIndex: number;
    physicalPageNumber: number;
    logicalPageNumber: number | null;
    usesLogicalNumbering: boolean;
    renderedHeader: boolean;
    renderedFooter: boolean;
};

export class PageNumberTelemetryCollaborator implements LayoutCollaborator {
    constructor(private readonly config: LayoutConfig) {}

    onSimulationComplete(pages: Page[], session: LayoutSession): void {
        let logicalPageNumber = Math.max(0, Math.floor(Number(this.config.layout.pageNumberStart ?? 1)) - 1);
        const summaries: PageNumberSummary[] = pages.map((page) => {
            const baseline = resolveBaselineRegions(this.config, page.index);
            const override = findWinningPageOverride(page);
            const resolved = applyPageOverride(baseline, override);
            const usesLogicalNumbering =
                regionContainsLogicalPageNumber(resolved.header) ||
                regionContainsLogicalPageNumber(resolved.footer);
            const renderedHeader = (page.boxes || []).some((box) => box.meta?.sourceType === 'header');
            const renderedFooter = (page.boxes || []).some((box) => box.meta?.sourceType === 'footer');
            const nextLogicalPageNumber = usesLogicalNumbering ? ++logicalPageNumber : null;

            return {
                pageIndex: page.index,
                physicalPageNumber: page.index + 1,
                logicalPageNumber: nextLogicalPageNumber,
                usesLogicalNumbering,
                renderedHeader,
                renderedFooter
            };
        });

        session.setTelemetry('pageNumberSummary', summaries);
    }
}
