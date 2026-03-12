import { Element, LayoutConfig } from './types';
import { LayoutProcessor } from './layout/layout-core';
import {
    buildAssembledBookmarkTree,
    buildBookmarkTree,
    buildSourceAnchorsBySourceId,
    buildTableOfContentsElements,
    getSourceAnchorReference,
    getHeadingOutline,
    PrintAssemblyPlan,
    PrintAssemblyPageEntry,
    PrintPipelineArtifactBundle,
    PrintPipelineSnapshot,
    remapHeadingOutlineWithAssembly,
    resolvePhysicalPageReference,
    ReservedTableOfContentsPlan,
    TableOfContentsElementOptions
} from './layout/simulation-report';
import { EngineRuntime } from './runtime';

/**
 * LayoutEngine shapes elements into flow boxes, paginates them, and returns
 * positioned page boxes for rendering.
 */
export class LayoutEngine extends LayoutProcessor {
    constructor(config: LayoutConfig, runtime?: EngineRuntime) {
        super(config, runtime);
    }

    async planReservedTableOfContents(
        source: PrintPipelineSnapshot,
        reservedPageCount: number,
        options?: TableOfContentsElementOptions
    ): Promise<ReservedTableOfContentsPlan> {
        const normalizedReservation = Math.max(0, Math.floor(Number(reservedPageCount) || 0));
        const tocElements = buildTableOfContentsElements(source, options);
        const tocEngine = new LayoutEngine(this.config);
        await tocEngine.waitForFonts();
        const tocPages = tocEngine.paginate(tocElements as Element[]);
        const tocSnapshot = tocEngine.getLastPrintPipelineSnapshot();
        const overflowPageCount = Math.max(0, tocPages.length - normalizedReservation);

        return {
            reservedPageCount: normalizedReservation,
            tocElements,
            tocPages,
            tocSnapshot,
            bodyPages: source.pages,
            fitsReservation: overflowPageCount === 0,
            overflowPageCount
        };
    }

    async planConfiguredTableOfContents(
        source?: PrintPipelineSnapshot
    ): Promise<ReservedTableOfContentsPlan | null> {
        const declaration = this.config.printPipeline?.tableOfContents;
        if (!declaration) return null;

        const snapshot = source ?? this.getLastPrintPipelineSnapshot();
        return this.planReservedTableOfContents(snapshot, declaration.reservedPageCount, {
            title: declaration.title,
            titleType: declaration.titleType,
            entryType: declaration.entryType,
            indentPerLevel: declaration.indentPerLevel,
            includeTitle: declaration.includeTitle
        });
    }

    async buildPrintPipelineArtifacts(
        source?: PrintPipelineSnapshot
    ): Promise<PrintPipelineArtifactBundle> {
        const body = source ?? this.getLastPrintPipelineSnapshot();
        const tocPlan = await this.planConfiguredTableOfContents(body);
        const assembly = this.buildPrintAssemblyPlan(body, tocPlan);
        const headingOutline = getHeadingOutline(body);
        const sourceAnchorsBySourceId = buildSourceAnchorsBySourceId(body, assembly);

        const bundle: PrintPipelineArtifactBundle = {
            body,
            tableOfContents: {
                declared: !!this.config.printPipeline?.tableOfContents,
                status: !this.config.printPipeline?.tableOfContents
                    ? 'not-configured'
                    : tocPlan?.fitsReservation
                        ? 'fits-reservation'
                        : 'overflow',
                overflowPageCount: tocPlan?.overflowPageCount ?? 0,
                plan: tocPlan
            },
            assembly,
            bodyPageReferences: body.pages.map((_, pageIndex) =>
                resolvePhysicalPageReference(body, pageIndex, assembly)
            ),
            navigation: {
                headingOutline,
                assembledHeadingOutline: remapHeadingOutlineWithAssembly(headingOutline, assembly),
                bookmarkTree: buildBookmarkTree(body),
                assembledBookmarkTree: buildAssembledBookmarkTree(body, assembly),
                sourceAnchorsBySourceId
            },
            getSourceAnchor: (sourceId: string) => getSourceAnchorReference(bundle, sourceId)
        };

        return bundle;
    }

    private buildPrintAssemblyPlan(
        body: PrintPipelineSnapshot,
        tocPlan: ReservedTableOfContentsPlan | null
    ): PrintAssemblyPlan {
        if (!tocPlan) {
            const bodyPages: PrintAssemblyPageEntry[] = body.pages.map((_, index) => ({
                finalPageIndex: index,
                source: 'body',
                sourcePageIndex: index
            }));
            return {
                status: 'body-only',
                reservedFrontMatterPageCount: 0,
                bodyStartPageIndex: 0,
                omittedTocPageCount: 0,
                bodyFinalPageIndexByBodyPageIndex: body.pages.map((_, index) => index),
                tocFinalPageIndexByTocPageIndex: [],
                pages: bodyPages
            };
        }

        const pages: PrintAssemblyPageEntry[] = [];
        const reservedCount = tocPlan.reservedPageCount;
        const placedTocPages = Math.min(tocPlan.tocPages.length, reservedCount);
        const tocFinalPageIndexByTocPageIndex: Array<number | null> = tocPlan.tocPages.map((_, index) =>
            index < placedTocPages ? index : null
        );

        for (let index = 0; index < reservedCount; index++) {
            pages.push({
                finalPageIndex: index,
                source: index < placedTocPages ? 'toc' : 'reserved-empty',
                sourcePageIndex: index < placedTocPages ? index : null
            });
        }

        const bodyStartPageIndex = reservedCount;
        const bodyFinalPageIndexByBodyPageIndex: number[] = [];
        body.pages.forEach((_, index) => {
            bodyFinalPageIndexByBodyPageIndex.push(bodyStartPageIndex + index);
            pages.push({
                finalPageIndex: bodyStartPageIndex + index,
                source: 'body',
                sourcePageIndex: index
            });
        });

        return {
            status: tocPlan.fitsReservation ? 'reserved-front-matter' : 'overflow',
            reservedFrontMatterPageCount: reservedCount,
            bodyStartPageIndex,
            omittedTocPageCount: Math.max(0, tocPlan.tocPages.length - placedTocPages),
            bodyFinalPageIndexByBodyPageIndex,
            tocFinalPageIndexByTocPageIndex,
            pages
        };
    }
}
