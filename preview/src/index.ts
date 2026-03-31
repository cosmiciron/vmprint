import { CanvasContext } from '@vmprint/context-canvas';
import { PdfLiteContext } from '@vmprint/context-pdf-lite';
import {
    buildInteractionOverlayModel,
    createInteractionSelectionPoint,
    createEngineRuntime,
    getSimulationArtifact,
    hitTestInteraction,
    LayoutEngine,
    LayoutUtils,
    Renderer,
    resolveInteractionSelection,
    resolveDocumentPaths,
    serializeInteractionSelectionMarkdown,
    serializeInteractionSelectionText,
    simulationArtifactKeys,
    toLayoutConfig
} from '@vmprint/engine';
import type {
    VmprintInteractionHit,
    VmprintInteractionOverlayModel,
    VmprintInteractionPage,
    VmprintInteractionSelectionMode,
    VmprintInteractionSelectionPoint,
    VmprintInteractionSelectionState
} from '@vmprint/engine';
import { LOCAL_FONT_ALIASES as FONT_ALIASES, LOCAL_FONT_REGISTRY as FONT_REGISTRY } from '@vmprint/local-fonts/config';
import { WebFontManager } from '@vmprint/web-fonts';

// -- Public interfaces for standalone @vmprint/preview package -----------------------------

/**
 * Common font configuration used by VMPrint components.
 */
export interface FontConfig {
    name: string;
    family: string;
    weight: number;
    style: 'normal' | 'italic';
    src: string;
    unicodeRange?: string;
    enabled: boolean;
    fallback: boolean;
}

/**
 * Stream-like target for VMPrint output contexts.
 */
export interface VmprintOutputStream {
    write(chunk: Uint8Array | string): void;
    end(): void;
}

/**
 * Status event emitted during web font loading.
 */
export interface WebFontProgressEvent {
    src: string;
    resolvedSrc: string;
    loadedBytes: number;
    totalBytes?: number;
    percent?: number;
    phase: 'cache-hit' | 'downloading' | 'finalizing' | 'caching' | 'complete';
}

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

export type PreviewLayoutSnapshotTextFragment = {
    text: string;
    width?: number;
    ascent?: number;
    descent?: number;
    fontFamily?: string;
};

export type PreviewLayoutSnapshotLineMetric = {
    index: number;
    top: number;
    baseline: number;
    bottom: number;
    height: number;
    fontSize: number;
    referenceAscentScale: number;
    ascent: number;
    descent: number;
};

export type PreviewLayoutSnapshotTextMetrics = {
    contentBox: { x: number; y: number; w: number; h: number };
    paragraphReferenceAscentScale: number;
    uniformLineHeight: number;
    lines: PreviewLayoutSnapshotLineMetric[];
};

export type PreviewLayoutSnapshotInteractionRegion = {
    sourceId: string;
    originSourceId?: string;
    clonedFromSourceId?: string;
    engineKey?: string;
    sourceType?: string;
    fragmentIndex: number;
    isContinuation: boolean;
    generated: boolean;
    transformKind?: 'clone' | 'split' | 'morph';
    selectableText: boolean;
    containerSourceId?: string;
    containerType?: string;
    containerEngineKey?: string;
};

export type PreviewLayoutSnapshotBox = {
    type: string;
    x: number;
    y: number;
    w: number;
    h: number;
    style?: {
        backgroundColor?: string;
        borderColor?: string;
        color?: string;
        borderWidth?: number;
        textAlign?: string;
        fontSize?: number;
        lineHeight?: number;
        paddingTop?: number;
        paddingRight?: number;
        paddingBottom?: number;
        paddingLeft?: number;
    };
    lines?: PreviewLayoutSnapshotTextFragment[][];
    textMetrics?: PreviewLayoutSnapshotTextMetrics;
    interaction?: PreviewLayoutSnapshotInteractionRegion;
    meta?: {
        sourceId?: string;
        engineKey?: string;
        sourceType?: string;
        fragmentIndex?: number;
        isContinuation?: boolean;
        pageIndex?: number;
    };
};

export type PreviewLayoutSnapshotPage = {
    index: number;
    width: number;
    height: number;
    boxes: PreviewLayoutSnapshotBox[];
};

export type PreviewTextCharBox = {
    x0: number;
    x1: number;
    y0: number;
    y1: number;
    lineIndex: number;
    charIndex: number;
    absoluteOffset: number;
    char: string;
};

export type PreviewTextLayoutModel = {
    sourceId: string;
    box: PreviewLayoutSnapshotBox;
    charBoxes: PreviewTextCharBox[];
    totalLength: number;
};

export type PreviewTextSelectionPoint = {
    sourceId: string;
    x: number;
    y: number;
    absoluteOffset: number;
};

export type PreviewTextSelectionState = {
    sourceId: string;
    selectedOffsets: number[];
    caretOffset: number;
};

export type PreviewSelectionOverlayOptions = {
    selectedSourceId?: string | null;
    selection?: PreviewTextSelectionState | null;
    strokeColor?: string;
    outlineColor?: string;
    selectionFill?: string;
    caretColor?: string;
    lineWidth?: number;
};

export type PreviewTextLayoutDefaults = {
    fontFamily?: string;
    fontSize?: number;
    lineHeight?: number;
};

export type PreviewSession = {
    getPageCount(): number;
    getPageSize(): { width: number; height: number };
    getLayoutSnapshotPages(): PreviewLayoutSnapshotPage[];
    getInteractionSnapshotPages(): VmprintInteractionPage[];
    hitTestPageInteraction(pageIndex: number, x: number, y: number): VmprintInteractionHit | null;
    createPageSelectionPoint(pageIndex: number, x: number, y: number): VmprintInteractionSelectionPoint | null;
    resolvePageSelection(
        pageIndex: number,
        anchor: VmprintInteractionSelectionPoint | null | undefined,
        focusPoint: { x: number; y: number },
        mode?: VmprintInteractionSelectionMode
    ): VmprintInteractionSelectionState | null;
    buildPageInteractionOverlay(
        pageIndex: number,
        selection: VmprintInteractionSelectionState | null | undefined,
        selectedTargetId?: string | null
    ): VmprintInteractionOverlayModel | null;
    getPageInteractionSelectionText(
        pageIndex: number,
        selection: VmprintInteractionSelectionState | null | undefined
    ): string;
    getPageInteractionSelectionMarkdown(
        pageIndex: number,
        selection: VmprintInteractionSelectionState | null | undefined
    ): string;
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
const DEFAULT_PRIMARY_FONT_REPOSITORY_BASE_URL = 'https://cdn.jsdelivr.net/gh/cosmiciron/vmprint@assets/font-managers/local/';
const DEFAULT_FALLBACK_FONT_REPOSITORY_BASE_URL = 'https://cdn.jsdelivr.net/gh/cosmiciron/vmprint@assets/font-managers/local/';
const FALLBACK_MAIN_BRANCH_PREFIXES = [
    'assets/fonts/NotoSansSymbol/'
];

// -- Document-aware font filtering (mirrors the ast-to-canvas-webfonts pipeline) -----------

const normalizeFamilyKeyLocal = (family: string): string =>
    String(family || '').trim().toLowerCase().replace(/["']/g, '').replace(/\s+/g, ' ');

const resolveLocalAlias = (family: string): string => {
    const normalized = normalizeFamilyKeyLocal(family);
    return FONT_ALIASES[normalized] || family;
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
    for (const font of FONT_REGISTRY) {
        if (!font.fallback || !font.enabled) continue;
        if (unicodeRangeContainsAny(font.unicodeRange, codePoints)) {
            selectedFallbackFamilies.add(font.family);
        }
    }

    return FONT_REGISTRY
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

const normalizePreviewSourceId = (value: unknown): string => String(value || '');
const stripPreviewSourcePrefixes = (value: string): string => value.replace(/^gen:/, '').replace(/^author:/, '');

const matchesPreviewSourceId = (actual: unknown, target: string): boolean => {
    const value = normalizePreviewSourceId(actual);
    const normalizedValue = stripPreviewSourcePrefixes(value);
    const normalizedTarget = stripPreviewSourcePrefixes(normalizePreviewSourceId(target));
    return (
        value === target ||
        value.endsWith(`:${target}`) ||
        target.endsWith(`:${value}`) ||
        normalizedValue === normalizedTarget ||
        normalizedValue.endsWith(`:${normalizedTarget}`) ||
        normalizedTarget.endsWith(`:${normalizedValue}`)
    );
};

const sortUniqueNumbers = (values: number[]): number[] => Array.from(new Set(values)).sort((a, b) => a - b);

let previewMeasureContext: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null = null;

const getPreviewMeasureContext = (): CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null => {
    if (previewMeasureContext) return previewMeasureContext;
    if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
        previewMeasureContext = document.createElement('canvas').getContext('2d');
        return previewMeasureContext;
    }
    if (typeof OffscreenCanvas !== 'undefined') {
        previewMeasureContext = new OffscreenCanvas(1, 1).getContext('2d');
        return previewMeasureContext;
    }
    return null;
};

const resolveCanvasContext = (target: CanvasTarget): CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D => {
    if ('canvas' in target) return target;
    const context = target.getContext('2d');
    if (!context) {
        throw new Error('[VMPrintPreview] Unable to resolve a 2D canvas context.');
    }
    return context;
};

export const getSelectablePreviewBoxes = (page: PreviewLayoutSnapshotPage | null): PreviewLayoutSnapshotBox[] =>
    (page?.boxes || []).filter((box) => (
        normalizePreviewSourceId(box.meta?.sourceId).length > 0
        && (box.interaction?.selectableText !== false)
    ));

export const hitTestPreviewBox = (page: PreviewLayoutSnapshotPage | null, x: number, y: number): PreviewLayoutSnapshotBox | null => {
    const boxes = getSelectablePreviewBoxes(page);
    for (let index = boxes.length - 1; index >= 0; index -= 1) {
        const box = boxes[index];
        if (x >= box.x && x <= box.x + box.w && y >= box.y && y <= box.y + box.h) return box;
    }
    return null;
};

export const buildPreviewTextLayoutModel = (
    box: PreviewLayoutSnapshotBox | null,
    defaults?: PreviewTextLayoutDefaults
): PreviewTextLayoutModel | null => {
    const measureContext = getPreviewMeasureContext();
    if (!box?.lines?.length || !box.textMetrics?.lines?.length || !measureContext) return null;
    const sourceId = stripPreviewSourcePrefixes(normalizePreviewSourceId(box.meta?.sourceId));
    if (!sourceId) return null;
    const fallbackFontFamily = defaults?.fontFamily || 'Arimo';
    const fallbackFontSize = Number(defaults?.fontSize || 13) || 13;
    const contentBox = box.textMetrics.contentBox;
    const align = box.style?.textAlign || 'left';
    const charBoxes: PreviewTextCharBox[] = [];
    let absoluteOffset = 0;

    box.lines.forEach((line, lineIndex) => {
        const metric = box.textMetrics?.lines?.[lineIndex];
        if (!metric) return;
        const lineWidth = (line || []).reduce((sum, segment) => sum + Number(segment.width || 0), 0);
        let lineX = contentBox.x;
        if (align === 'center') lineX = contentBox.x + ((contentBox.w - lineWidth) / 2);
        else if (align === 'right') lineX = contentBox.x + (contentBox.w - lineWidth);

        let cursorX = lineX;
        for (const segment of line || []) {
            const segmentStartX = cursorX;
            const fontSize = Number(metric.fontSize || box.style?.fontSize || fallbackFontSize) || fallbackFontSize;
            const fontFamily = segment.fontFamily || fallbackFontFamily;
            measureContext.font = `${fontSize}px "${fontFamily}"`;
            const text = String(segment.text || '');
            const targetSegmentWidth = Number(segment.width || 0);
            const measuredFullWidth = text.length > 0 ? (measureContext.measureText(text).width || 0) : 0;
            const scale = targetSegmentWidth > 0 && measuredFullWidth > 0 ? (targetSegmentWidth / measuredFullWidth) : 1;
            const fallbackWidth = text.length > 0 ? (targetSegmentWidth > 0 ? targetSegmentWidth / text.length : 0) : 0;
            let previousPrefixWidth = 0;

            for (let index = 0; index < text.length; index += 1) {
                const char = text[index];
                const prefix = text.slice(0, index + 1);
                const measuredPrefixWidth = measureContext.measureText(prefix).width || 0;
                const currentPrefixWidth = targetSegmentWidth > 0 ? (measuredPrefixWidth * scale) : measuredPrefixWidth;
                let width = currentPrefixWidth - previousPrefixWidth;
                if (!Number.isFinite(width) || width <= 0) width = fallbackWidth;
                charBoxes.push({
                    x0: segmentStartX + previousPrefixWidth,
                    x1: segmentStartX + previousPrefixWidth + width,
                    y0: metric.top,
                    y1: metric.bottom,
                    lineIndex,
                    charIndex: index,
                    absoluteOffset,
                    char
                });
                previousPrefixWidth += width;
                absoluteOffset += 1;
            }

            cursorX = targetSegmentWidth > 0 && text.length > 0
                ? (segmentStartX + targetSegmentWidth)
                : (segmentStartX + previousPrefixWidth);
        }

        if (lineIndex < (box.lines?.length || 0) - 1) absoluteOffset += 1;
    });

    return {
        sourceId,
        box,
        charBoxes,
        totalLength: absoluteOffset
    };
};

export const getNearestPreviewSelectionOffset = (layout: PreviewTextLayoutModel, x: number, y: number): number => {
    if (layout.charBoxes.length === 0) return 0;
    const lineIndexes = sortUniqueNumbers(layout.charBoxes.map((box) => box.lineIndex));
    let targetLineIndex = lineIndexes[0] || 0;
    let nearestLineDistance = Number.POSITIVE_INFINITY;

    for (const lineIndex of lineIndexes) {
        const lineBoxes = layout.charBoxes.filter((box) => box.lineIndex === lineIndex);
        const lineTop = Math.min(...lineBoxes.map((box) => box.y0));
        const lineBottom = Math.max(...lineBoxes.map((box) => box.y1));
        const lineCenterY = (lineTop + lineBottom) / 2;
        const lineDistance =
            y < lineTop ? (lineTop - y) :
            y > lineBottom ? (y - lineBottom) :
            Math.abs(lineCenterY - y) * 0.25;
        if (lineDistance < nearestLineDistance) {
            nearestLineDistance = lineDistance;
            targetLineIndex = lineIndex;
        }
    }

    const targetLineBoxes = layout.charBoxes.filter((box) => box.lineIndex === targetLineIndex);
    if (targetLineBoxes.length === 0) return 0;
    const firstBox = targetLineBoxes[0];
    const lastBox = targetLineBoxes[targetLineBoxes.length - 1];

    if (x <= firstBox.x0) return Math.max(0, Math.min(layout.totalLength, firstBox.absoluteOffset));
    if (x >= lastBox.x1) return Math.max(0, Math.min(layout.totalLength, lastBox.absoluteOffset + 1));

    for (const box of targetLineBoxes) {
        const centerX = (box.x0 + box.x1) / 2;
        if (x < centerX) return Math.max(0, Math.min(layout.totalLength, box.absoluteOffset));
        if (x <= box.x1) return Math.max(0, Math.min(layout.totalLength, box.absoluteOffset + 1));
    }

    return Math.max(0, Math.min(layout.totalLength, lastBox.absoluteOffset + 1));
};

const buildPreviewSelectionSweepRect = (
    anchor: PreviewTextSelectionPoint,
    point: { x: number; y: number }
): { x0: number; y0: number; x1: number; y1: number } => ({
    x0: Math.min(anchor.x, point.x),
    y0: Math.min(anchor.y, point.y) - 4,
    x1: Math.max(anchor.x, point.x),
    y1: Math.max(anchor.y, point.y) + 4
});

const rectContainsPreviewCharCenter = (
    rect: { x0: number; y0: number; x1: number; y1: number },
    charBox: PreviewTextCharBox
): boolean => (
    ((charBox.x0 + charBox.x1) / 2) >= rect.x0 &&
    ((charBox.x0 + charBox.x1) / 2) <= rect.x1 &&
    ((charBox.y0 + charBox.y1) / 2) >= rect.y0 &&
    ((charBox.y0 + charBox.y1) / 2) <= rect.y1
);

export const getPreviewSpatiallySelectedOffsets = (
    layout: PreviewTextLayoutModel,
    anchor: PreviewTextSelectionPoint,
    point: { x: number; y: number }
): number[] => {
    const sweepRect = buildPreviewSelectionSweepRect(anchor, point);
    return sortUniqueNumbers(
        layout.charBoxes
            .filter((charBox) => rectContainsPreviewCharCenter(sweepRect, charBox))
            .map((charBox) => charBox.absoluteOffset)
    );
};

export const buildPreviewContinuousSelectedOffsets = (
    layout: PreviewTextLayoutModel,
    anchorOffset: number,
    caretOffset: number
): number[] => {
    const start = Math.min(anchorOffset, caretOffset);
    const end = Math.max(anchorOffset, caretOffset);
    return layout.charBoxes
        .filter((charBox) => charBox.absoluteOffset >= start && charBox.absoluteOffset < end)
        .map((charBox) => charBox.absoluteOffset);
};

export const normalizePreviewSelectedOffsets = (layout: PreviewTextLayoutModel, offsets: number[]): number[] => {
    const unique = sortUniqueNumbers(offsets);
    if (unique.length === 0) return unique;
    const start = unique[0];
    const end = unique[unique.length - 1];
    return layout.charBoxes
        .filter((charBox) => charBox.absoluteOffset >= start && charBox.absoluteOffset <= end)
        .map((charBox) => charBox.absoluteOffset);
};

export const getPreviewCaretRect = (
    layout: PreviewTextLayoutModel,
    offset: number
): { x: number; y0: number; y1: number } | null => {
    if (layout.charBoxes.length === 0) return null;
    const clamped = Math.max(0, Math.min(layout.totalLength, offset));
    if (clamped === layout.totalLength) {
        const last = layout.charBoxes[layout.charBoxes.length - 1];
        return { x: last.x1, y0: last.y0, y1: last.y1 };
    }
    const char = layout.charBoxes.find((entry) => entry.absoluteOffset === clamped);
    if (!char) return null;
    return { x: char.x0, y0: char.y0, y1: char.y1 };
};

export const drawPreviewSelectionOverlay = (
    page: PreviewLayoutSnapshotPage | null,
    target: CanvasTarget,
    options: PreviewSelectionOverlayOptions = {}
): void => {
    if (!page || !options.selectedSourceId) return;
    const targetBox = getSelectablePreviewBoxes(page).find((box) => matchesPreviewSourceId(box.meta?.sourceId, options.selectedSourceId || ''));
    if (!targetBox) return;
    const context = resolveCanvasContext(target as any);
    const canvas = context.canvas as HTMLCanvasElement | OffscreenCanvas;
    const scale = (canvas.width || 1) / Math.max(1, page.width);
    const lineWidth = options.lineWidth || 1.5;

    context.save();
    context.setTransform(scale, 0, 0, scale, 0, 0);
    context.strokeStyle = options.strokeColor || '#60a5fa';
    context.lineWidth = Math.max(1, lineWidth * 2);
    context.strokeRect(targetBox.x - 2, targetBox.y - 2, targetBox.w + 4, targetBox.h + 4);
    context.setLineDash([6, 4]);
    context.strokeStyle = options.outlineColor || '#c084fc';
    context.lineWidth = lineWidth;
    context.strokeRect(targetBox.x - 5, targetBox.y - 5, targetBox.w + 10, targetBox.h + 10);

    const selection = options.selection;
    if (selection) {
        const layout = buildPreviewTextLayoutModel(targetBox);
        if (layout && selection.sourceId === layout.sourceId) {
            if (selection.selectedOffsets.length > 0) {
                context.fillStyle = options.selectionFill || 'rgba(96, 165, 250, 0.24)';
                for (const charBox of layout.charBoxes) {
                    if (!selection.selectedOffsets.includes(charBox.absoluteOffset)) continue;
                    context.fillRect(charBox.x0, charBox.y0, Math.max(1, charBox.x1 - charBox.x0), Math.max(1, charBox.y1 - charBox.y0));
                }
            }
            const caret = getPreviewCaretRect(layout, selection.caretOffset);
            if (caret) {
                context.strokeStyle = options.caretColor || '#f8fafc';
                context.lineWidth = lineWidth;
                context.setLineDash([]);
                context.beginPath();
                context.moveTo(caret.x, caret.y0);
                context.lineTo(caret.x, caret.y1);
                context.stroke();
            }
        }
    }
    context.restore();
};

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
        // We use any for catalog options to avoid complicated Omit-based type imports
        const catalogOptions: any = {
            cache: fontOptions.cache,
            aliases: {
                ...FONT_ALIASES,
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
            ...FONT_ALIASES,
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
    private layoutSnapshotPages: any[] | null = null;
    private interactionSnapshotPages: VmprintInteractionPage[] | null = null;
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

    getLayoutSnapshotPages(): PreviewLayoutSnapshotPage[] {
        this.assertActive('getLayoutSnapshotPages');
        this.assertHasDocument('getLayoutSnapshotPages');
        return (this.layoutSnapshotPages || []).map((page: any) => ({
            index: Number(page.index || 0),
            width: Number(page.width || 0),
            height: Number(page.height || 0),
            boxes: (page.boxes || []).map((box: any) => ({
                type: String(box.type || ''),
                x: Number(box.x || 0),
                y: Number(box.y || 0),
                w: Number(box.w || 0),
                h: Number(box.h || 0),
                style: {
                    backgroundColor: typeof box.style?.backgroundColor === 'string' ? box.style.backgroundColor : undefined,
                    borderColor: typeof box.style?.borderColor === 'string' ? box.style.borderColor : undefined,
                    color: typeof box.style?.color === 'string' ? box.style.color : undefined,
                    borderWidth: Number(box.style?.borderWidth || 0) || undefined,
                    textAlign: typeof box.style?.textAlign === 'string' ? box.style.textAlign : undefined,
                    fontSize: Number(box.style?.fontSize || 0) || undefined,
                    lineHeight: Number(box.style?.lineHeight || 0) || undefined,
                    paddingTop: Number(box.style?.paddingTop || 0) || undefined,
                    paddingRight: Number(box.style?.paddingRight || 0) || undefined,
                    paddingBottom: Number(box.style?.paddingBottom || 0) || undefined,
                    paddingLeft: Number(box.style?.paddingLeft || 0) || undefined
                },
                textMetrics: box.properties?.__vmprintTextMetrics ? {
                    contentBox: {
                        x: Number(box.properties.__vmprintTextMetrics.contentBox?.x || 0),
                        y: Number(box.properties.__vmprintTextMetrics.contentBox?.y || 0),
                        w: Number(box.properties.__vmprintTextMetrics.contentBox?.w || 0),
                        h: Number(box.properties.__vmprintTextMetrics.contentBox?.h || 0)
                    },
                    paragraphReferenceAscentScale: Number(box.properties.__vmprintTextMetrics.paragraphReferenceAscentScale || 0),
                    uniformLineHeight: Number(box.properties.__vmprintTextMetrics.uniformLineHeight || 0),
                    lines: (box.properties.__vmprintTextMetrics.lines || []).map((line: any) => ({
                        index: Number(line.index || 0),
                        top: Number(line.top || 0),
                        baseline: Number(line.baseline || 0),
                        bottom: Number(line.bottom || 0),
                        height: Number(line.height || 0),
                        fontSize: Number(line.fontSize || 0),
                        referenceAscentScale: Number(line.referenceAscentScale || 0),
                        ascent: Number(line.ascent || 0),
                        descent: Number(line.descent || 0)
                    }))
                } : undefined,
                interaction: box.properties?.__vmprintInteractionRegion ? {
                    sourceId: String(box.properties.__vmprintInteractionRegion.sourceId || ''),
                    originSourceId: typeof box.properties.__vmprintInteractionRegion.originSourceId === 'string'
                        ? box.properties.__vmprintInteractionRegion.originSourceId
                        : undefined,
                    clonedFromSourceId: typeof box.properties.__vmprintInteractionRegion.clonedFromSourceId === 'string'
                        ? box.properties.__vmprintInteractionRegion.clonedFromSourceId
                        : undefined,
                    engineKey: typeof box.properties.__vmprintInteractionRegion.engineKey === 'string'
                        ? box.properties.__vmprintInteractionRegion.engineKey
                        : undefined,
                    sourceType: typeof box.properties.__vmprintInteractionRegion.sourceType === 'string'
                        ? box.properties.__vmprintInteractionRegion.sourceType
                        : undefined,
                    fragmentIndex: Number(box.properties.__vmprintInteractionRegion.fragmentIndex || 0),
                    isContinuation: Boolean(box.properties.__vmprintInteractionRegion.isContinuation),
                    generated: Boolean(box.properties.__vmprintInteractionRegion.generated),
                    transformKind: box.properties.__vmprintInteractionRegion.transformKind,
                    selectableText: Boolean(box.properties.__vmprintInteractionRegion.selectableText),
                    containerSourceId: typeof box.properties.__vmprintInteractionRegion.containerSourceId === 'string'
                        ? box.properties.__vmprintInteractionRegion.containerSourceId
                        : undefined,
                    containerType: typeof box.properties.__vmprintInteractionRegion.containerType === 'string'
                        ? box.properties.__vmprintInteractionRegion.containerType
                        : undefined,
                    containerEngineKey: typeof box.properties.__vmprintInteractionRegion.containerEngineKey === 'string'
                        ? box.properties.__vmprintInteractionRegion.containerEngineKey
                        : undefined
                } : undefined,
                meta: {
                    sourceId: typeof box.meta?.sourceId === 'string' ? box.meta.sourceId : '',
                    engineKey: typeof box.meta?.engineKey === 'string' ? box.meta.engineKey : '',
                    sourceType: typeof box.meta?.sourceType === 'string' ? box.meta.sourceType : '',
                    fragmentIndex: Number(box.meta?.fragmentIndex || 0),
                    isContinuation: Boolean(box.meta?.isContinuation),
                    pageIndex: Number(box.meta?.pageIndex || 0)
                },
                lines: (box.lines || []).map((line: any[]) => (line || []).map((segment: any) => ({
                    text: String(segment.text || ''),
                    width: Number(segment.width || 0),
                    ascent: Number(segment.ascent || 0),
                    descent: Number(segment.descent || 0),
                    fontFamily: String(segment.fontFamily || '')
                })))
            }))
        }));
    }

    getInteractionSnapshotPages(): VmprintInteractionPage[] {
        this.assertActive('getInteractionSnapshotPages');
        this.assertHasDocument('getInteractionSnapshotPages');
        return (this.interactionSnapshotPages || []).map((page) => ({
            ...page,
            flattenedSpans: page.flattenedSpans.map((span) => ({ ...span })),
            targets: page.targets.map((target) => ({
                ...target,
                contentBox: { ...target.contentBox },
                units: target.units.map((unit) => ({ ...unit })),
                lines: target.lines.map((line) => ({ ...line }))
            }))
        }));
    }

    hitTestPageInteraction(pageIndex: number, x: number, y: number): VmprintInteractionHit | null {
        this.assertActive('hitTestPageInteraction');
        this.assertHasDocument('hitTestPageInteraction');
        const page = this.interactionSnapshotPages?.[pageIndex];
        return hitTestInteraction(page, x, y);
    }

    createPageSelectionPoint(pageIndex: number, x: number, y: number): VmprintInteractionSelectionPoint | null {
        this.assertActive('createPageSelectionPoint');
        this.assertHasDocument('createPageSelectionPoint');
        const page = this.interactionSnapshotPages?.[pageIndex];
        return createInteractionSelectionPoint(page, x, y);
    }

    resolvePageSelection(
        pageIndex: number,
        anchor: VmprintInteractionSelectionPoint | null | undefined,
        focusPoint: { x: number; y: number },
        mode: VmprintInteractionSelectionMode = 'continuous'
    ): VmprintInteractionSelectionState | null {
        this.assertActive('resolvePageSelection');
        this.assertHasDocument('resolvePageSelection');
        const page = this.interactionSnapshotPages?.[pageIndex];
        return resolveInteractionSelection(page, anchor, focusPoint, mode);
    }

    buildPageInteractionOverlay(
        pageIndex: number,
        selection: VmprintInteractionSelectionState | null | undefined,
        selectedTargetId?: string | null
    ): VmprintInteractionOverlayModel | null {
        this.assertActive('buildPageInteractionOverlay');
        this.assertHasDocument('buildPageInteractionOverlay');
        const page = this.interactionSnapshotPages?.[pageIndex];
        return buildInteractionOverlayModel(page, selection, selectedTargetId);
    }

    getPageInteractionSelectionText(
        pageIndex: number,
        selection: VmprintInteractionSelectionState | null | undefined
    ): string {
        this.assertActive('getPageInteractionSelectionText');
        this.assertHasDocument('getPageInteractionSelectionText');
        const page = this.interactionSnapshotPages?.[pageIndex];
        return serializeInteractionSelectionText(page, selection);
    }

    getPageInteractionSelectionMarkdown(
        pageIndex: number,
        selection: VmprintInteractionSelectionState | null | undefined
    ): string {
        this.assertActive('getPageInteractionSelectionMarkdown');
        this.assertHasDocument('getPageInteractionSelectionMarkdown');
        const page = this.interactionSnapshotPages?.[pageIndex];
        return serializeInteractionSelectionMarkdown(page, selection);
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
        this.layoutSnapshotPages = null;
        this.interactionSnapshotPages = null;
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
        const report = engine.getLastSimulationReport();
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
        this.layoutSnapshotPages = pages.map((page: any) => (renderer as any).toOverlayPage(page));
        this.interactionSnapshotPages = (getSimulationArtifact(report, simulationArtifactKeys.interactionMap) || []) as VmprintInteractionPage[];
        this.layoutConfig = config;
        this.layoutRuntime = runtime;
        this.pdfBytesPromise = renderPagesToPdfBytes(config, pages, runtime, pageSize);
    }
}

export const createVMPrintPreview = async (documentInput?: unknown, options: PreviewOptions = {}): Promise<PreviewSession> =>
    PreviewSessionImpl.create(documentInput, options);

export default createVMPrintPreview;
