import type { SourceTransformer } from '@vmprint/contracts';
import { Element, LayoutConfig } from './types';
import { LayoutProcessor } from './layout/layout-core';
import {
    applySpatialDocumentPageTemplate,
    applySpatialDocumentPageTemplateStrict,
    SpatialDocument,
    spatialDocumentToElements,
    spatialDocumentToElementsStrict
} from './spatial-document';
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

export interface TransformedSpatialSource {
    spatialDocument: SpatialDocument;
    layoutConfig?: LayoutConfig;
}

export interface LayoutEngineOptions<TSource = SpatialDocument> {
    sourceTransformer?: SourceTransformer<TSource, SpatialDocument | TransformedSpatialSource>;
}

const DEFAULT_ENGINE_LAYOUT_CONFIG: LayoutConfig = {
    layout: {
        pageSize: 'LETTER',
        margins: { top: 72, right: 72, bottom: 72, left: 72 },
        fontFamily: 'Helvetica',
        fontSize: 12,
        lineHeight: 1.2
    },
    fonts: {
        regular: 'Helvetica'
    },
    styles: {},
    preloadFontFamilies: [],
    debug: false
};

function isLayoutConfig(value: unknown): value is LayoutConfig {
    return !!value && typeof value === 'object' && 'layout' in value && 'styles' in value && 'fonts' in value;
}

function isSpatialDocument(value: unknown): value is SpatialDocument {
    return !!value && typeof value === 'object' && Array.isArray((value as SpatialDocument).items);
}

function isTransformedSpatialSource(value: unknown): value is TransformedSpatialSource {
    return !!value
        && typeof value === 'object'
        && 'spatialDocument' in value
        && isSpatialDocument((value as TransformedSpatialSource).spatialDocument);
}

/**
 * LayoutEngine shapes elements into flow boxes, paginates them, and returns
 * positioned page boxes for rendering.
 */
export class LayoutEngine extends LayoutProcessor {
    private readonly sourceTransformer?: SourceTransformer<any, SpatialDocument | TransformedSpatialSource>;
    private lastResolvedConfig: LayoutConfig;

    constructor(config: LayoutConfig, runtime?: EngineRuntime, options?: LayoutEngineOptions<any>);
    constructor(options: LayoutEngineOptions<any>, runtime?: EngineRuntime);
    constructor(
        configOrOptions: LayoutConfig | LayoutEngineOptions<any> = DEFAULT_ENGINE_LAYOUT_CONFIG,
        runtime?: EngineRuntime,
        options?: LayoutEngineOptions<any>
    ) {
        const config = isLayoutConfig(configOrOptions) ? configOrOptions : DEFAULT_ENGINE_LAYOUT_CONFIG;
        const resolvedOptions = isLayoutConfig(configOrOptions) ? options : configOrOptions;
        super(config, runtime);
        this.sourceTransformer = resolvedOptions?.sourceTransformer;
        this.lastResolvedConfig = config;
    }

    getLastResolvedConfig(): LayoutConfig {
        return this.lastResolvedConfig;
    }

    private resolveSpatialSource(source: unknown): TransformedSpatialSource {
        if (this.sourceTransformer) {
            const transformed = this.sourceTransformer.transform(source);
            if (isSpatialDocument(transformed)) {
                return { spatialDocument: transformed };
            }
            if (isTransformedSpatialSource(transformed)) {
                return transformed;
            }
            throw new Error('[LayoutEngine] SourceTransformer must return a SpatialDocument or { spatialDocument, layoutConfig? }.');
        }

        if (isSpatialDocument(source)) {
            return { spatialDocument: source };
        }

        throw new Error('[LayoutEngine] No SourceTransformer configured, so page() expects a SpatialDocument.');
    }

    async page(source: unknown): Promise<ReturnType<LayoutProcessor['simulate']>> {
        const prepared = this.resolveSpatialSource(source);
        const config = prepared.layoutConfig ?? this.config;
        this.lastResolvedConfig = config;
        const engine = prepared.layoutConfig ? new LayoutEngine(config, this.runtime) : this;
        engine.lastResolvedConfig = config;
        await engine.waitForFonts();
        return engine.simulateSpatialDocument(prepared.spatialDocument);
    }

    simulateSpatialDocument(document: SpatialDocument): ReturnType<LayoutProcessor['simulate']> {
        const elements = spatialDocumentToElements(document);
        const hasPageTemplateOverrides = !!(document.pageTemplate?.header || document.pageTemplate?.footer);
        if (!hasPageTemplateOverrides) {
            return this.simulate(elements);
        }
        const pageTemplate = applySpatialDocumentPageTemplate(document, {
            header: this.config.header,
            footer: this.config.footer
        });
        const derivedConfig: LayoutConfig = {
            ...this.config,
            header: pageTemplate.header,
            footer: pageTemplate.footer
        };
        const engine = new LayoutEngine(derivedConfig, this.runtime);
        return engine.simulate(elements);
    }

    simulateSpatialDocumentStrict(document: SpatialDocument): ReturnType<LayoutProcessor['simulate']> {
        const elements = spatialDocumentToElementsStrict(document);
        const hasPageTemplateOverrides = !!(document.pageTemplate?.header || document.pageTemplate?.footer);
        if (!hasPageTemplateOverrides) {
            return this.simulate(elements);
        }
        const pageTemplate = applySpatialDocumentPageTemplateStrict(document, {
            header: this.config.header,
            footer: this.config.footer
        });
        const derivedConfig: LayoutConfig = {
            ...this.config,
            header: pageTemplate.header,
            footer: pageTemplate.footer
        };
        const engine = new LayoutEngine(derivedConfig, this.runtime);
        return engine.simulate(elements);
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
        const tocPages = tocEngine.simulate(tocElements as Element[]);
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
