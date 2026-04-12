import * as fontkit from 'fontkit';
import type {
    FallbackFontSource,
    FontConfig,
    FontManager,
    MeasureTextOptions,
    MeasuredTextResult,
    TextDelegate,
    TextDelegateState,
    VerticalTextMetrics
} from '@vmprint/contracts';
import { cloneFontRegistry } from './ops';
import { createAfmFontProxy } from './afm-proxy';
import {
    attachStandardFontMetadata,
    parseStandardFontSentinelBuffer
} from './sentinel';
import { TextDelegateLoadError } from '../engine/text-delegate-load-error';

export interface VmprintTextDelegate extends TextDelegate {
    getCachedBuffer(src: string): ArrayBuffer | undefined;
}

const DEFAULT_OT_FEATURES = ['kern', 'liga'];
const RTL_OT_FEATURES = ['ccmp', 'isol', 'init', 'medi', 'fina', 'rlig', 'liga', 'calt', 'curs', 'kern'];
const fontCharacterSetCache = new WeakMap<object, Set<number>>();

const cloneShapedGlyphsDefault = (
    glyphs: Array<{ id: number; codePoints: number[]; xAdvance: number; xOffset: number; yOffset: number }>
) => glyphs.map((glyph) => ({
    ...glyph,
    codePoints: [...glyph.codePoints]
}));

const getFontUnitsPerEm = (font: any): number => {
    const unitsPerEm = Number(font?.unitsPerEm || 1000);
    return Number.isFinite(unitsPerEm) && unitsPerEm > 0 ? unitsPerEm : 1000;
};

const scaleMetricToPerThousand = (value: unknown, unitsPerEm: number, fallback: number): number => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return fallback;
    return (numeric / unitsPerEm) * 1000;
};

const normalizeDescent = (value: unknown, unitsPerEm: number, fallback: number): number => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return fallback;
    return (Math.abs(numeric) / unitsPerEm) * 1000;
};

const getGlyphPathBounds = (glyph: any): { minY: number; maxY: number } | null => {
    const bbox = glyph?.bbox || glyph?.path?.bbox;
    const minY = Number(bbox?.minY);
    const maxY = Number(bbox?.maxY);
    if (!Number.isFinite(minY) || !Number.isFinite(maxY)) return null;
    return { minY, maxY };
};

const getRunFeatures = (options?: MeasureTextOptions): string[] =>
    options?.direction === 'rtl' ? RTL_OT_FEATURES : DEFAULT_OT_FEATURES;

const toGlyphChar = (textUnits: string[], glyphIndex: number): string =>
    textUnits[glyphIndex] ?? '';

const normalizeLayoutText = (text: string): string => {
    if (!/^\s+$/u.test(text)) return text;
    return text.replace(/[\u00A0\u202F]/g, ' ');
};

export class FontkitTextMeasurer {
    constructor(
        private readonly getClusterCodePoints: (cluster: string) => number[],
        private readonly isIgnorableCodePoint: (codePoint: number) => boolean,
        private readonly cloneShapedGlyphs: (
            glyphs: Array<{ id: number; codePoints: number[]; xAdvance: number; xOffset: number; yOffset: number }>
        ) => Array<{ id: number; codePoints: number[]; xAdvance: number; xOffset: number; yOffset: number }> = cloneShapedGlyphsDefault
    ) {}

    getVerticalMetrics(font: any): VerticalTextMetrics {
        const unitsPerEm = getFontUnitsPerEm(font);
        return {
            ascent: scaleMetricToPerThousand(font?.ascent ?? font?.ascender, unitsPerEm, 750),
            descent: normalizeDescent(font?.descent ?? font?.descender, unitsPerEm, 250)
        };
    }

    supportsCluster(font: any, cluster: string): boolean {
        if (!font || !cluster) return false;
        for (const codePoint of this.getClusterCodePoints(cluster)) {
            if (this.isIgnorableCodePoint(codePoint)) continue;
            if (typeof font?.hasGlyphForCodePoint === 'function') {
                if (!font.hasGlyphForCodePoint(codePoint)) return false;
                continue;
            }
            const characterSet = Array.isArray(font?.characterSet)
                ? (fontCharacterSetCache.get(font)
                    ?? (() => {
                        const cached = new Set<number>(font.characterSet);
                        fontCharacterSetCache.set(font, cached);
                        return cached;
                    })())
                : null;
            if (characterSet) {
                if (!characterSet.has(codePoint)) return false;
                continue;
            }
            const glyph = typeof font?.glyphForCodePoint === 'function' ? font.glyphForCodePoint(codePoint) : null;
            const glyphId = Number(glyph?.id);
            if (!Number.isFinite(glyphId) || glyphId <= 0) return false;
        }
        return true;
    }

    estimateTextBoundsMetrics(font: any, text: string): VerticalTextMetrics | null {
        if (!font || !text || typeof font?.layout !== 'function') return null;
        try {
            const run = font.layout(text, DEFAULT_OT_FEATURES);
            const unitsPerEm = getFontUnitsPerEm(font);
            let maxY = Number.NEGATIVE_INFINITY;
            let minY = Number.POSITIVE_INFINITY;
            for (const glyph of run?.glyphs || []) {
                const bounds = getGlyphPathBounds(glyph);
                if (!bounds) continue;
                maxY = Math.max(maxY, bounds.maxY);
                minY = Math.min(minY, bounds.minY);
            }
            if (!Number.isFinite(maxY) || !Number.isFinite(minY)) {
                return this.getVerticalMetrics(font);
            }
            return {
                ascent: Math.max(0, (maxY / unitsPerEm) * 1000),
                descent: Math.max(0, (Math.abs(Math.min(0, minY)) / unitsPerEm) * 1000)
            };
        } catch {
            return this.getVerticalMetrics(font);
        }
    }

    measure(text: string, font: any, fontSize: number, options: MeasureTextOptions = {}): MeasuredTextResult {
        const metrics = this.getVerticalMetrics(font);
        if (!text) {
            return {
                width: 0,
                glyphs: [],
                ascent: metrics.ascent,
                descent: metrics.descent
            };
        }
        if (!font || typeof font?.layout !== 'function') {
            throw new Error(`[FontkitTextMeasurer] Missing fontkit face for text "${text.slice(0, 24)}".`);
        }

        const unitsPerEm = getFontUnitsPerEm(font);
        const scale = fontSize / unitsPerEm;
        const layoutText = normalizeLayoutText(text);
        const textUnits = Array.from(layoutText);
        let run: any;
        try {
            run = font.layout(layoutText, getRunFeatures(options));
        } catch {
            run = font.layout(layoutText);
        }
        const positions = Array.isArray(run?.positions) ? run.positions : [];
        const runGlyphs = Array.isArray(run?.glyphs) ? run.glyphs : [];

        let cursorX = 0;
        const glyphs = runGlyphs.map((glyph: any, glyphIndex: number) => {
            const position = positions[glyphIndex] || {};
            const result = {
                char: toGlyphChar(textUnits, glyphIndex),
                x: cursorX + (Number(position.xOffset || 0) * scale),
                y: Number(position.yOffset || 0) * scale
            };
            cursorX += Number(position.xAdvance || 0) * scale;
            if ((Number(options.letterSpacing || 0) !== 0) && glyphIndex < runGlyphs.length - 1) {
                cursorX += Number(options.letterSpacing || 0);
            }
            return result;
        });

        const shapedGlyphs = options.direction === 'rtl'
            ? this.cloneShapedGlyphs(runGlyphs.map((glyph: any, glyphIndex: number) => {
                const position = positions[glyphIndex] || {};
                const fallbackCodePoint = textUnits[glyphIndex]?.codePointAt(0);
                return {
                    id: Number(glyph?.id || 0),
                    codePoints: Array.isArray(glyph?.codePoints) && glyph.codePoints.length > 0
                        ? glyph.codePoints.map((codePoint: unknown) => Number(codePoint))
                        : (fallbackCodePoint !== undefined ? [fallbackCodePoint] : []),
                    xAdvance: Number(position.xAdvance || 0) * scale,
                    xOffset: Number(position.xOffset || 0) * scale,
                    yOffset: Number(position.yOffset || 0) * scale
                };
            }))
            : undefined;

        return {
            width: cursorX,
            glyphs,
            shapedGlyphs,
            ascent: metrics.ascent,
            descent: metrics.descent
        };
    }
}

export class FontManagerTextDelegate extends FontkitTextMeasurer implements VmprintTextDelegate {
    private readonly fontRegistry: FontConfig[];
    private readonly bufferCache = new Map<string, ArrayBuffer>();
    private readonly bufferCacheMirror?: Record<string, ArrayBuffer>;
    private enabledFallbackFontsCache: FallbackFontSource[] | null = null;
    private fallbackFamiliesCache: string[] | null = null;
    private readonly fontsByFamilyCache = new Map<string, FontConfig[]>();

    constructor(
        private readonly fontManager: FontManager,
        options: {
            fontRegistry?: FontConfig[];
            bufferCacheMirror?: Record<string, ArrayBuffer>;
            getClusterCodePoints?: (cluster: string) => number[];
            isIgnorableCodePoint?: (codePoint: number) => boolean;
            cloneShapedGlyphs?: (
                glyphs: Array<{ id: number; codePoints: number[]; xAdvance: number; xOffset: number; yOffset: number }>
            ) => Array<{ id: number; codePoints: number[]; xAdvance: number; xOffset: number; yOffset: number }>;
        } = {}
    ) {
        super(
            options.getClusterCodePoints || ((cluster) => Array.from(cluster).map((char) => char.codePointAt(0) || 0)),
            options.isIgnorableCodePoint || ((codePoint) =>
                codePoint === 0x200C ||
                codePoint === 0x200D ||
                (codePoint >= 0xFE00 && codePoint <= 0xFE0F) ||
                (codePoint >= 0xE0100 && codePoint <= 0xE01EF)
            ),
            options.cloneShapedGlyphs || cloneShapedGlyphsDefault
        );
        this.fontRegistry = options.fontRegistry ? cloneFontRegistry(options.fontRegistry) : fontManager.getFontRegistrySnapshot();
        this.bufferCacheMirror = options.bufferCacheMirror;
    }

    resolveFamilyAlias(family: string): string {
        return this.fontManager.resolveFamilyAlias(family);
    }

    getFontRegistrySnapshot(): FontConfig[] {
        return cloneFontRegistry(this.fontRegistry);
    }

    getEnabledFallbackFonts(): FallbackFontSource[] {
        if (!this.enabledFallbackFontsCache) {
            this.enabledFallbackFontsCache = this.fontManager.getEnabledFallbackFonts(this.fontRegistry);
        }
        return this.enabledFallbackFontsCache;
    }

    getFontsByFamily(family: string): FontConfig[] {
        const cacheKey = String(family || '');
        const cached = this.fontsByFamilyCache.get(cacheKey);
        if (cached) return cached;
        const resolved = this.fontManager.getFontsByFamily(cacheKey, this.fontRegistry);
        this.fontsByFamilyCache.set(cacheKey, resolved);
        return resolved;
    }

    getFallbackFamilies(): string[] {
        if (!this.fallbackFamiliesCache) {
            this.fallbackFamiliesCache = this.fontManager.getFallbackFamilies(this.fontRegistry);
        }
        return this.fallbackFamiliesCache;
    }

    async loadFace(src: string, state: TextDelegateState): Promise<any> {
        const cached = this.getCachedFace(src, state);
        if (cached) return cached;
        if (src in state.loadingPromises) return state.loadingPromises[src];

        state.loadingPromises[src] = (async () => {
            try {
                const arrayBuffer = await this.fontManager.loadFontBuffer(src);
                if (!arrayBuffer || arrayBuffer.byteLength === 0) {
                    throw new TextDelegateLoadError(src, 'Loaded font buffer is empty.');
                }
                this.bufferCache.set(src, arrayBuffer);
                if (this.bufferCacheMirror) {
                    this.bufferCacheMirror[src] = arrayBuffer;
                }
                const standardFontMetadata = parseStandardFontSentinelBuffer(arrayBuffer);
                const face = standardFontMetadata
                    ? attachStandardFontMetadata(createAfmFontProxy(standardFontMetadata), standardFontMetadata)
                    : fontkit.create(new Uint8Array(arrayBuffer));
                (face as { _vmFaceCacheKey?: string })._vmFaceCacheKey = src;
                state.faceCache[src] = face;
                return face;
            } catch (error) {
                delete state.faceCache[src];
                delete state.loadingPromises[src];
                this.bufferCache.delete(src);
                if (this.bufferCacheMirror) {
                    delete this.bufferCacheMirror[src];
                }
                if (error instanceof TextDelegateLoadError) throw error;
                throw new TextDelegateLoadError(src, `Failed to load font "${src}".`, { cause: error });
            }
        })();

        return state.loadingPromises[src];
    }

    getCachedFace(src: string, state: TextDelegateState): any {
        return state.faceCache[src];
    }

    getCachedBuffer(src: string): ArrayBuffer | undefined {
        return this.bufferCache.get(src) || this.bufferCacheMirror?.[src];
    }

    getFaceCacheKey(face: any): string {
        if (!face) return 'unknown-face';
        if (typeof face === 'string') return face;
        const tagged = String((face as { _vmFaceCacheKey?: string })._vmFaceCacheKey || '').trim();
        if (tagged) return tagged;
        const postscriptName = String(face?.postscriptName || face?.fullName || face?.familyName || '').trim();
        if (postscriptName) return postscriptName;
        return 'unknown-face';
    }
}

export const createFontManagerTextDelegate = (
    fontManager: FontManager,
    options?: ConstructorParameters<typeof FontManagerTextDelegate>[1]
): FontManagerTextDelegate => new FontManagerTextDelegate(fontManager, options);
