import { CanvasContext } from '@vmprint/context-canvas';
import { PdfLiteContext } from '@vmprint/context-pdf-lite';
import {
    createEngineRuntime,
    LayoutEngine,
    LayoutUtils,
    Renderer,
    resolveDocumentPaths,
    toLayoutConfig
} from '@vmprint/engine';
import type { FontConfig, VmprintOutputStream } from '@vmprint/contracts';
import { LOCAL_FONT_ALIASES, LOCAL_FONT_REGISTRY } from '@vmprint/local-fonts/config';
import { WebFontManager, type WebFontCatalogLoadOptions, type WebFontProgressEvent } from '@vmprint/web-fonts';

export type CanvasTarget =
    | HTMLCanvasElement
    | OffscreenCanvas
    | CanvasRenderingContext2D
    | OffscreenCanvasRenderingContext2D;

export type RenderPageToCanvasOptions = {
    scale?: number;
    dpi?: number;
    clear?: boolean;
    backgroundColor?: string;
};

export type PreviewFontSource = {
    name: string;
    family: string;
    weight?: number;
    style?: 'normal' | 'italic';
    src: string;
    enabled?: boolean;
    fallback?: boolean;
    unicodeRange?: string;
};

export type PreviewFontsOptions = {
    catalogUrl?: string;
    repositoryBaseUrl?: string;
    cache?: boolean | { persistent?: boolean; dbName?: string; storeName?: string; namespace?: string };
    aliases?: Record<string, string>;
    fonts?: PreviewFontSource[];
};

export type PreviewOptions = {
    fonts?: PreviewFontsOptions;
    onFontProgress?: (event: WebFontProgressEvent) => void;
};

export type SvgExportOptions = {
    textMode?: 'glyph-path' | 'text';
};

export type PreviewSession = {
    getPageCount(): number;
    getPageSize(): { width: number; height: number };
    isDestroyed(): boolean;
    renderPageToCanvas(pageIndex: number, target: CanvasTarget, options?: RenderPageToCanvasOptions): Promise<void>;
    exportPdf(): Promise<Uint8Array>;
    exportSvgPage(pageIndex: number, options?: SvgExportOptions): Promise<string>;
    exportSvgPages(options?: SvgExportOptions): Promise<string[]>;
    updateDocument(nextDocumentInput: unknown): Promise<void>;
    destroy(): void;
};

type VmprintDocument = Record<string, unknown>;

const DEFAULT_DOCUMENT_PATH = 'browser-input.json';
const DEFAULT_PRIMARY_FONT_REPOSITORY_BASE_URL = 'https://cdn.jsdelivr.net/gh/cosmiciron/vmprint@main/font-managers/local/';
const DEFAULT_FALLBACK_FONT_REPOSITORY_BASE_URL = 'https://cdn.jsdelivr.net/gh/cosmiciron/vmprint@assets/font-managers/local/';
const FALLBACK_MAIN_BRANCH_PREFIXES = [
    'assets/fonts/NotoSansSymbol/'
];

// -- Document-aware font filtering (mirrors the ast-to-canvas-webfonts pipeline) -----------

const normalizeFamilyKeyLocal = (family: string): string =>
    String(family || '').trim().toLowerCase().replace(/["']/g, '').replace(/\s+/g, ' ');

const resolveLocalAlias = (family: string): string => {
    const normalized = normalizeFamilyKeyLocal(family);
    return LOCAL_FONT_ALIASES[normalized] || family;
};

const collectStrings = (value: unknown, bucket: string[]): void => {
    if (typeof value === 'string') { bucket.push(value); return; }
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) { (value as unknown[]).forEach((item) => collectStrings(item, bucket)); return; }
    Object.values(value as Record<string, unknown>).forEach((entry) => collectStrings(entry, bucket));
};

const collectDocumentCodePoints = (documentInput: unknown): Set<number> => {
    const strings: string[] = [];
    collectStrings(documentInput, strings);
    const codePoints = new Set<number>();
    for (const text of strings) {
        for (const char of text) {
            const cp = char.codePointAt(0);
            if (cp !== undefined) codePoints.add(cp);
        }
    }
    return codePoints;
};

const parseUnicodeRange = (unicodeRange?: string): Array<[number, number]> => {
    if (!unicodeRange) return [];
    return unicodeRange.split(',').map((p) => p.trim()).filter(Boolean).flatMap((part) => {
        const match = /^U\+([0-9A-F?]+)(?:-([0-9A-F]+))?$/i.exec(part);
        if (!match) return [];
        if (match[1].includes('?')) {
            return [[
                Number.parseInt(match[1].replace(/\?/g, '0'), 16),
                Number.parseInt(match[1].replace(/\?/g, 'F'), 16)
            ] as [number, number]];
        }
        const start = Number.parseInt(match[1], 16);
        const end = Number.parseInt(match[2] || match[1], 16);
        if (!Number.isFinite(start) || !Number.isFinite(end)) return [];
        return [[start, end] as [number, number]];
    });
};

const unicodeRangeContainsAny = (unicodeRange: string | undefined, codePoints: Set<number>): boolean => {
    if (!unicodeRange || codePoints.size === 0) return false;
    const ranges = parseUnicodeRange(unicodeRange);
    if (ranges.length === 0) return false;
    for (const cp of codePoints) {
        for (const [start, end] of ranges) {
            if (cp >= start && cp <= end) return true;
        }
    }
    return false;
};

const toRemoteFontConfig = (font: FontConfig, primaryBase: string, fallbackBase: string): FontConfig => {
    const normalizedSrc = font.src.replace(/\\/g, '/');
    const fallbackUsesMainBranch = font.fallback &&
        FALLBACK_MAIN_BRANCH_PREFIXES.some((prefix) => normalizedSrc.startsWith(prefix));
    const base = fallbackUsesMainBranch ? primaryBase : (font.fallback ? fallbackBase : primaryBase);
    return { ...font, src: `${base}${normalizedSrc}` };
};

const buildFilteredFontRegistry = (
    documentInput: unknown,
    config: any,
    primaryBase: string,
    fallbackBase: string
): FontConfig[] => {
    const requiredFamilies = new Set<string>();
    const addFamily = (family: unknown) => {
        if (typeof family !== 'string' || !family.trim()) return;
        requiredFamilies.add(resolveLocalAlias(family));
    };

    addFamily(config?.layout?.fontFamily);
    Object.values(config?.fonts || {}).forEach(addFamily);
    Object.values(config?.styles || {}).forEach((style: any) => addFamily(style?.fontFamily));
    (config?.preloadFontFamilies || []).forEach(addFamily);

    const codePoints = collectDocumentCodePoints(documentInput);
    const selectedFallbackFamilies = new Set<string>();
    for (const font of LOCAL_FONT_REGISTRY) {
        if (!font.fallback || !font.enabled) continue;
        if (unicodeRangeContainsAny(font.unicodeRange, codePoints)) {
            selectedFallbackFamilies.add(font.family);
        }
    }

    return LOCAL_FONT_REGISTRY
        .filter((font) => font.enabled && (requiredFamilies.has(font.family) || selectedFallbackFamilies.has(font.family)))
        .map((font) => toRemoteFontConfig(font, primaryBase, fallbackBase));
};

const cloneDocument = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const ensureDocumentObject = (documentInput: unknown): VmprintDocument => {
    if (typeof documentInput === 'string') {
        const parsed = JSON.parse(documentInput);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            throw new Error('[VMPrintPreview] Expected a JSON object as VMPrint document input.');
        }
        return parsed as VmprintDocument;
    }

    if (!documentInput || typeof documentInput !== 'object' || Array.isArray(documentInput)) {
        throw new Error('[VMPrintPreview] Expected a VMPrint document object or JSON string.');
    }

    return cloneDocument(documentInput as VmprintDocument);
};

const textEncoder = new TextEncoder();

class MemoryOutputStream implements VmprintOutputStream {
    private readonly chunks: Uint8Array[] = [];
    private readonly finishPromise: Promise<void>;
    private resolveFinish: (() => void) | null = null;
    private finished = false;

    constructor() {
        this.finishPromise = new Promise<void>((resolve) => {
            this.resolveFinish = resolve;
        });
    }

    write(chunk: Uint8Array | string): void {
        if (typeof chunk === 'string') {
            this.chunks.push(textEncoder.encode(chunk));
            return;
        }
        this.chunks.push(chunk);
    }

    end(): void {
        if (this.finished) return;
        this.finished = true;
        this.resolveFinish?.();
    }

    waitForFinish(): Promise<void> {
        return this.finishPromise;
    }

    toUint8Array(): Uint8Array {
        const total = this.chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
        const merged = new Uint8Array(total);
        let offset = 0;
        for (const chunk of this.chunks) {
            merged.set(chunk, offset);
            offset += chunk.byteLength;
        }
        return merged;
    }
}

const looksLikeFontSource = (value: string): boolean => (
    /^data:/i.test(value) ||
    /^[a-z][a-z0-9+\-.]*:/i.test(value) ||
    /[\\/]/.test(value) ||
    /\.(?:ttf|otf|woff2?|ttc)(?:[?#].*)?$/i.test(value)
);

const synthesizeDocumentFontConfigs = (config: any): FontConfig[] => {
    const family = String(config?.layout?.fontFamily || '').trim();
    const declaredFonts = config?.fonts || {};

    if (!family || !declaredFonts || typeof declaredFonts !== 'object') {
        return [];
    }

    const slots: Array<{ key: 'regular' | 'bold' | 'italic' | 'bolditalic'; weight: number; style: 'normal' | 'italic' }> = [
        { key: 'regular', weight: 400, style: 'normal' },
        { key: 'bold', weight: 700, style: 'normal' },
        { key: 'italic', weight: 400, style: 'italic' },
        { key: 'bolditalic', weight: 700, style: 'italic' }
    ];

    return slots.flatMap((slot) => {
        const src = declaredFonts[slot.key];
        if (typeof src !== 'string' || !looksLikeFontSource(src.trim())) {
            return [];
        }

        const styleLabel = slot.style === 'italic' && slot.weight >= 700
            ? 'Bold Italic'
            : slot.style === 'italic'
                ? 'Italic'
                : slot.weight >= 700
                    ? 'Bold'
                    : 'Regular';

        return [{
            name: `${family} ${styleLabel}`,
            family,
            weight: slot.weight,
            style: slot.style,
            src: src.trim(),
            enabled: true,
            fallback: false
        } satisfies FontConfig];
    });
};

const createPreviewFontManager = async (documentInput: VmprintDocument, config: any, options: PreviewOptions): Promise<WebFontManager> => {
    const fontOptions = options.fonts;

    if (fontOptions?.catalogUrl) {
        const catalogOptions: WebFontCatalogLoadOptions = {
            cache: fontOptions.cache,
            aliases: {
                ...LOCAL_FONT_ALIASES,
                ...(fontOptions.aliases || {})
            },
            repositoryBaseUrl: fontOptions.repositoryBaseUrl
        };
        return WebFontManager.fromCatalogUrl(fontOptions.catalogUrl, catalogOptions);
    }

    const documentFonts = synthesizeDocumentFontConfigs(config);
    const primaryBase = fontOptions?.repositoryBaseUrl || DEFAULT_PRIMARY_FONT_REPOSITORY_BASE_URL;
    const fallbackBase = fontOptions?.repositoryBaseUrl || DEFAULT_FALLBACK_FONT_REPOSITORY_BASE_URL;
    const filteredFonts = buildFilteredFontRegistry(documentInput, config, primaryBase, fallbackBase);
    const mergedFonts = [
        ...filteredFonts,
        ...documentFonts,
        ...((fontOptions?.fonts || []) as FontConfig[])
    ];

    return new WebFontManager({
        fonts: mergedFonts,
        aliases: {
            ...LOCAL_FONT_ALIASES,
            ...(fontOptions?.aliases || {})
        },
        repositoryBaseUrl: primaryBase,
        cache: fontOptions?.cache ?? true,
        onProgress: options.onFontProgress
    });
};

const renderPagesToPdfBytes = async (
    config: any,
    pages: any[],
    runtime: any,
    pageSize: { width: number; height: number }
): Promise<Uint8Array> => {
    const context = new PdfLiteContext({
        size: [pageSize.width, pageSize.height],
        margins: { top: 0, right: 0, bottom: 0, left: 0 },
        autoFirstPage: false,
        bufferPages: false
    });

    const outputStream = new MemoryOutputStream();
    context.pipe(outputStream);

    const renderer = new Renderer(config, false, runtime);
    await renderer.render(pages, context as unknown as any);
    await outputStream.waitForFinish();
    return outputStream.toUint8Array();
};

class PreviewSessionImpl implements PreviewSession {
    private destroyed = false;
    private pageCount = 0;
    private pageSize = { width: 0, height: 0 };
    private canvasContext: CanvasContext | null = null;
    private pdfBytesPromise: Promise<Uint8Array> | null = null;
    private layoutPages: any[] | null = null;
    private layoutConfig: any | null = null;
    private layoutRuntime: any | null = null;

    private constructor(
        private documentInput: VmprintDocument | null,
        private readonly options: PreviewOptions
    ) { }

    static async create(documentInput: unknown | null | undefined, options: PreviewOptions = {}): Promise<PreviewSessionImpl> {
        const session = new PreviewSessionImpl(null, options);
        if (documentInput != null) {
            const normalizedInput = ensureDocumentObject(documentInput);
            await session.rebuild(normalizedInput);
            session.documentInput = normalizedInput;
        }
        return session;
    }

    getPageCount(): number {
        this.assertActive('getPageCount');
        return this.pageCount;
    }

    getPageSize(): { width: number; height: number } {
        this.assertActive('getPageSize');
        this.assertHasDocument('getPageSize');
        return this.pageSize;
    }

    isDestroyed(): boolean {
        return this.destroyed;
    }

    async renderPageToCanvas(pageIndex: number, target: CanvasTarget, options?: RenderPageToCanvasOptions): Promise<void> {
        this.assertActive('renderPageToCanvas');
        this.assertHasDocument('renderPageToCanvas');
        if (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= this.pageCount) {
            throw new Error(`[VMPrintPreview] Page ${pageIndex} does not exist.`);
        }
        await this.canvasContext!.renderPageToCanvas(pageIndex, target as any, options);
    }

    async exportPdf(): Promise<Uint8Array> {
        this.assertActive('exportPdf');
        this.assertHasDocument('exportPdf');
        return (await this.pdfBytesPromise!).slice();
    }

    async exportSvgPage(pageIndex: number, options?: SvgExportOptions): Promise<string> {
        this.assertActive('exportSvgPage');
        this.assertHasDocument('exportSvgPage');
        if (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= this.pageCount) {
            throw new Error(`[VMPrintPreview] Page ${pageIndex} does not exist.`);
        }
        if (options?.textMode === 'text') {
            const ctx = await this.buildTextModeContext();
            return ctx.toSvgString(pageIndex);
        }
        return this.canvasContext!.toSvgString(pageIndex);
    }

    async exportSvgPages(options?: SvgExportOptions): Promise<string[]> {
        this.assertActive('exportSvgPages');
        this.assertHasDocument('exportSvgPages');
        if (options?.textMode === 'text') {
            const ctx = await this.buildTextModeContext();
            return ctx.toSvgPages();
        }
        return this.canvasContext!.toSvgPages();
    }

    async updateDocument(nextDocumentInput: unknown): Promise<void> {
        this.assertActive('updateDocument');
        const normalizedInput = ensureDocumentObject(nextDocumentInput);
        await this.rebuild(normalizedInput);
        this.documentInput = normalizedInput;
    }

    destroy(): void {
        if (this.destroyed) return;
        this.destroyed = true;
        this.canvasContext = null;
        this.pdfBytesPromise = null;
        this.layoutPages = null;
        this.layoutConfig = null;
        this.layoutRuntime = null;
    }

    private assertActive(methodName: string): void {
        if (this.destroyed) {
            throw new Error(`[VMPrintPreview] ${methodName}() called after destroy(). Create a new preview session.`);
        }
    }

    private assertHasDocument(methodName: string): void {
        if (this.documentInput === null) {
            throw new Error(`[VMPrintPreview] ${methodName}() requires a document. Call updateDocument() first.`);
        }
    }

    private async buildTextModeContext(): Promise<CanvasContext> {
        const ctx = new CanvasContext({
            size: [this.pageSize.width, this.pageSize.height],
            margins: { top: 0, right: 0, bottom: 0, left: 0 },
            autoFirstPage: false,
            bufferPages: false,
            textRenderMode: 'text'
        });
        const renderer = new Renderer(this.layoutConfig, false, this.layoutRuntime);
        await renderer.render(this.layoutPages!, ctx as unknown as any);
        return ctx;
    }

    private async rebuild(documentInput: VmprintDocument): Promise<void> {
        const documentIr = resolveDocumentPaths(documentInput as any, DEFAULT_DOCUMENT_PATH);
        const config = toLayoutConfig(documentIr, false);
        const fontManager = await createPreviewFontManager(documentInput, config, this.options);
        const runtime = createEngineRuntime({ fontManager });
        const engine = new LayoutEngine(config, runtime);
        await engine.waitForFonts();
        const pages = engine.simulate(documentIr.elements);
        const pageSize = LayoutUtils.getPageDimensions(config);

        const canvasContext = new CanvasContext({
            size: [pageSize.width, pageSize.height],
            margins: { top: 0, right: 0, bottom: 0, left: 0 },
            autoFirstPage: false,
            bufferPages: false,
            textRenderMode: 'glyph-path'
        });

        const renderer = new Renderer(config, false, runtime);
        await renderer.render(pages, canvasContext as unknown as any);

        this.canvasContext = canvasContext;
        this.pageCount = canvasContext.getPageCount();
        this.pageSize = pageSize;
        this.layoutPages = pages;
        this.layoutConfig = config;
        this.layoutRuntime = runtime;
        this.pdfBytesPromise = renderPagesToPdfBytes(config, pages, runtime, pageSize);
    }
}

export const createVMPrintPreview = async (documentInput?: unknown, options: PreviewOptions = {}): Promise<PreviewSession> =>
    PreviewSessionImpl.create(documentInput, options);

export default createVMPrintPreview;
