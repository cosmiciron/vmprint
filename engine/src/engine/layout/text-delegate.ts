import * as fontkit from 'fontkit';
import type { FontManager, MeasureTextOptions, MeasuredTextResult, TextDelegate, TextDelegateState, VerticalTextMetrics } from '@vmprint/contracts';
import { createAfmFontProxy } from '../../font-management/afm-proxy';
import { attachStandardFontMetadata, parseStandardFontSentinelBuffer } from '../../font-management/sentinel';

const fontVerticalMetricsCache = new WeakMap<object, VerticalTextMetrics>();

export class TextDelegateLoadError extends Error {
    constructor(public readonly url: string, message: string, options?: { cause?: unknown }) {
        super(message);
        this.name = 'TextDelegateLoadError';
        if (options?.cause !== undefined) {
            (this as Error & { cause?: unknown }).cause = options.cause;
        }
    }
}

const cloneShapedGlyphs = (glyphs: import('../types').ShapedGlyph[]): import('../types').ShapedGlyph[] =>
    glyphs.map((glyph) => ({ ...glyph, codePoints: [...glyph.codePoints] }));

const getClusterCodePoints = (cluster: string): number[] => {
    const codePoints: number[] = [];
    for (const ch of cluster) {
        const cp = ch.codePointAt(0);
        if (cp !== undefined) codePoints.push(cp);
    }
    return codePoints;
};

const isIgnorableCodePoint = (codePoint: number): boolean =>
    codePoint === 0x200C ||
    codePoint === 0x200D ||
    (codePoint >= 0xFE00 && codePoint <= 0xFE0F) ||
    (codePoint >= 0xE0100 && codePoint <= 0xE01EF);

export class FontkitTextDelegate implements TextDelegate {
    loadFace(src: string, fontManager: FontManager, state: TextDelegateState): Promise<any> {
        if (state.faceCache[src]) return Promise.resolve(state.faceCache[src]);
        if (src in state.loadingPromises) return state.loadingPromises[src];

        state.loadingPromises[src] = (async () => {
            try {
                const arrayBuffer = await fontManager.loadFontBuffer(src);
                if (!arrayBuffer || arrayBuffer.byteLength === 0) {
                    throw new TextDelegateLoadError(src, 'Loaded font buffer is empty.');
                }
                state.bufferCache[src] = arrayBuffer;
                const standardFontMetadata = parseStandardFontSentinelBuffer(arrayBuffer);
                const face = standardFontMetadata
                    ? attachStandardFontMetadata(createAfmFontProxy(standardFontMetadata), standardFontMetadata)
                    : fontkit.create(new Uint8Array(arrayBuffer));
                state.faceCache[src] = face;
                return face;
            } catch (e: unknown) {
                delete state.faceCache[src];
                delete state.bufferCache[src];
                delete state.loadingPromises[src];
                if (e instanceof TextDelegateLoadError) throw e;
                throw new TextDelegateLoadError(src, `Failed to load font "${src}".`, { cause: e });
            }
        })();

        return state.loadingPromises[src];
    }

    getCachedFace(src: string, state: TextDelegateState): any {
        return state.faceCache[src];
    }

    getCachedBuffer(src: string, state: TextDelegateState): ArrayBuffer | undefined {
        return state.bufferCache[src];
    }

    registerFaceBuffer(src: string, buffer: ArrayBuffer, state: TextDelegateState): void {
        state.bufferCache[src] = buffer;
        const standardFontMetadata = parseStandardFontSentinelBuffer(buffer);
        state.faceCache[src] = standardFontMetadata
            ? attachStandardFontMetadata(createAfmFontProxy(standardFontMetadata), standardFontMetadata)
            : fontkit.create(new Uint8Array(buffer));
        state.loadingPromises[src] = Promise.resolve(state.faceCache[src]);
    }

    getFaceCacheKey(face: any): string {
        if (!face) return 'unknown';
        if (!face._vmFontKey) {
            face._vmFontKey = face.postscriptName || face.familyName || 'unknown';
        }
        return String(face._vmFontKey);
    }

    getVerticalMetrics(font: any): VerticalTextMetrics {
        if (!font) {
            throw new Error('[FontkitTextDelegate] Missing font object for vertical metric extraction.');
        }
        const cached = fontVerticalMetricsCache.get(font);
        if (cached) return cached;

        const upm = Number(font.unitsPerEm);
        const rawAscent = Number(font.ascent);
        const rawDescent = Number(font.descent);
        if (!Number.isFinite(upm) || upm <= 0 || !Number.isFinite(rawAscent) || !Number.isFinite(rawDescent)) {
            const fontKey = font.postscriptName || font.familyName || 'unknown';
            throw new Error(`[FontkitTextDelegate] Invalid vertical metrics for font "${fontKey}".`);
        }

        const metrics = {
            ascent: (rawAscent / upm) * 1000,
            descent: (Math.abs(rawDescent) / upm) * 1000
        };
        fontVerticalMetricsCache.set(font, metrics);
        return metrics;
    }

    supportsCluster(font: any, cluster: string): boolean {
        if (!font || !cluster) return false;
        for (const cp of getClusterCodePoints(cluster)) {
            if (isIgnorableCodePoint(cp)) continue;
            const glyph = font.glyphForCodePoint(cp);
            if (!glyph || glyph.id === 0) return false;
        }
        return true;
    }

    measure(text: string, font: any, fontSize: number, options: MeasureTextOptions = {}): MeasuredTextResult {
        if (!text) {
            const metrics = this.getVerticalMetrics(font);
            return {
                width: 0,
                glyphs: [],
                ascent: metrics.ascent,
                descent: metrics.descent
            };
        }

        if (!font) {
            throw new Error(`[FontkitTextDelegate] Missing measurement font for text "${text.slice(0, 24)}".`);
        }

        const upm = Number(font.unitsPerEm);
        if (!Number.isFinite(upm) || upm <= 0) {
            const fontKey = font.postscriptName || font.familyName || 'unknown';
            throw new Error(`[FontkitTextDelegate] Invalid unitsPerEm for font "${fontKey}".`);
        }

        const scale = fontSize / upm;
        const SCRIPT_MAP: Record<string, string> = {
            arabic: 'arab',
            devanagari: 'deva',
            thai: 'thai',
            korean: 'hang',
            cjk: 'hani'
        };
        const otScript = SCRIPT_MAP[options.scriptClass || ''] || 'latn';
        const otDirection = options.direction === 'rtl' ? 'rtl' : 'ltr';
        const isWhitespaceOnly = /^\s+$/u.test(text);
        const layoutText = isWhitespaceOnly ? text.replace(/[\u00A0\u202F]/g, ' ') : text;
        const containsRtlScript = /[\u0590-\u08FF\uFB1D-\uFDFD\uFE70-\uFEFC]/u.test(layoutText);
        const isRtl = otDirection === 'rtl' && containsRtlScript;

        let run: any;
        try {
            run = (!isWhitespaceOnly && isRtl)
                ? font.layout(
                    layoutText,
                    ['ccmp', 'isol', 'init', 'medi', 'fina', 'rlig', 'liga', 'calt', 'curs', 'kern'],
                    otScript,
                    undefined,
                    otDirection
                )
                : font.layout(layoutText);
        } catch {
            run = font.layout(layoutText);
        }

        let width = 0;
        const glyphs: Array<{ char: string; x: number; y: number }> = [];
        const shapedGlyphs: import('../types').ShapedGlyph[] = [];

        for (let i = 0; i < run.glyphs.length; i++) {
            const glyph = run.glyphs[i];
            const pos = run.positions[i];

            const drawX = width + (pos.xOffset || 0) * scale;
            const drawY = (pos.yOffset || 0) * scale;
            const char = (glyph.codePoints && glyph.codePoints.length > 0)
                ? String.fromCodePoint(...glyph.codePoints)
                : '';

            glyphs.push({ char, x: drawX, y: drawY });

            const xAdvance = pos.xAdvance !== undefined ? pos.xAdvance : glyph.advanceWidth;
            if (xAdvance === undefined || !Number.isFinite(xAdvance)) {
                const fontKey = font.postscriptName || font.familyName || 'unknown';
                throw new Error(`[FontkitTextDelegate] Missing xAdvance for glyph in "${fontKey}".`);
            }

            if (isRtl) {
                shapedGlyphs.push({
                    id: glyph.id,
                    codePoints: glyph.codePoints ? [...glyph.codePoints] : [],
                    xAdvance: xAdvance * scale,
                    xOffset: (pos.xOffset || 0) * scale,
                    yOffset: (pos.yOffset || 0) * scale
                });
            }

            width += (xAdvance * scale) + (options.letterSpacing || 0);
        }

        const metrics = this.getVerticalMetrics(font);
        return {
            width,
            glyphs,
            shapedGlyphs: isRtl ? cloneShapedGlyphs(shapedGlyphs) : undefined,
            ascent: metrics.ascent,
            descent: metrics.descent
        };
    }

    estimateTextBoundsMetrics(font: any, text: string): VerticalTextMetrics | null {
        if (!font || !text) return null;
        const upm = Number(font?.unitsPerEm);
        if (!Number.isFinite(upm) || upm <= 0) return null;
        if (typeof font.layout !== 'function') return null;

        try {
            const run = font.layout(text);
            if (!run?.glyphs || run.glyphs.length === 0) return null;
            let maxY = -Infinity;
            let minY = Infinity;
            for (const glyph of run.glyphs) {
                const bbox = glyph?.bbox || (typeof glyph?.getBBox === 'function' ? glyph.getBBox() : null);
                const yMax = Number(bbox?.maxY ?? bbox?.yMax);
                const yMin = Number(bbox?.minY ?? bbox?.yMin);
                if (Number.isFinite(yMax) && yMax > maxY) maxY = yMax;
                if (Number.isFinite(yMin) && yMin < minY) minY = yMin;

                const rawYMax = Number(glyph?.yMax);
                const rawYMin = Number(glyph?.yMin);
                if (Number.isFinite(rawYMax) && rawYMax > maxY) maxY = rawYMax;
                if (Number.isFinite(rawYMin) && rawYMin < minY) minY = rawYMin;
            }

            if (!Number.isFinite(maxY) || maxY <= 0) return null;
            if (!Number.isFinite(minY)) minY = 0;

            const ascent = (maxY / upm) * 1000;
            const descent = Math.max(0, Math.abs(minY) / upm) * 1000;
            if (!Number.isFinite(ascent) || ascent <= 0) return null;
            return { ascent, descent };
        } catch {
            return null;
        }
    }
}

export { FontkitTextDelegate as FontkitTextMeasurer };
