import type { MeasureTextOptions, MeasuredTextResult, TextDelegate, VerticalTextMetrics } from '@vmprint/contracts';

const fontVerticalMetricsCache = new WeakMap<object, VerticalTextMetrics>();

export class FontkitTextDelegate implements TextDelegate {
    constructor(
        private readonly getClusterCodePoints: (cluster: string) => number[],
        private readonly isIgnorableCodePoint: (codePoint: number) => boolean,
        private readonly cloneShapedGlyphs: (glyphs: import('../types').ShapedGlyph[]) => import('../types').ShapedGlyph[]
    ) { }

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
        for (const cp of this.getClusterCodePoints(cluster)) {
            if (this.isIgnorableCodePoint(cp)) continue;
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
            shapedGlyphs: isRtl ? this.cloneShapedGlyphs(shapedGlyphs) : undefined,
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
