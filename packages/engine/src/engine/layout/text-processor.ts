import { FontProcessor } from './font-processor';
import { Element, ElementStyle, RichLine, TextSegment } from '../types';
import { getFallbackFamilies, getFontsByFamily } from '../../font-management/ops';
import { getCachedFont } from '../../font-management/font-cache-loader';
import { LayoutUtils } from './layout-utils';
import { LAYOUT_DEFAULTS } from './defaults';
import {
    StyleSignatureCache,
    appendSegmentToLine,
    flattenSegmentsByHardBreak,
    getLineWidthLimit,
    splitToGraphemes,
} from './text-wrap-utils';
import { buildRichWrapTokens, wrapTokenStream } from './text-wrap-core';
import { resolveRichFontInfo } from './text-tokenizer';
import {
    getElementText as extractElementText,
    getNodeText as extractNodeText,
    getRichSegments as extractRichSegments,
    sliceElements as extractSlicedElements,
} from './rich-text-extractor';
import {
    getScriptClass as classifyScript,
    hasRtlScript as detectRtlScript,
    isCJKChar as isCjkCodePoint,
    isThaiChar as isThaiCodePoint,
    segmentTextByFont as segmentTextByFontBySupport,
    splitByScriptType as splitTextByScriptType,
} from './text-script-segmentation';
import { tryHyphenateSegmentToFit as hyphenateSegmentToFit } from './text-hyphenation';
import { applyAdvancedJustification as applyJustification } from './text-justification';
import { parseEmbeddedImagePayloadCached } from '../image-data';

/** Module-level cache for font vertical metrics (ascent/descent), keyed by font object. */
const fontVerticalMetricsCache = new WeakMap<object, { ascent: number; descent: number }>();

export class TextProcessor extends FontProcessor {
    private static graphemeSegmenter = new (Intl as any).Segmenter(undefined, { granularity: 'grapheme' });
    private variationFontCache = new Map<string, any>();
    private wordSegmenterCache = new Map<string, any>();
    private hydratedFamilies = new Set<string>();

    private styleSignatureCache = new StyleSignatureCache();

    private cloneGlyphs(
        glyphs: Array<{ char: string; x: number; y: number }>,
    ): Array<{ char: string; x: number; y: number }> {
        const out = new Array(glyphs.length);
        for (let i = 0; i < glyphs.length; i++) {
            const glyph = glyphs[i];
            out[i] = { char: glyph.char, x: glyph.x, y: glyph.y };
        }
        return out;
    }

    private getSegmenterLocale(style?: ElementStyle | Record<string, any>): string | undefined {
        const raw = String(style?.lang || this.config.layout.lang || LAYOUT_DEFAULTS.textLayout.lang || 'und').trim();
        if (!raw || raw.toLowerCase() === 'und') return undefined;
        return raw;
    }

    private resolveHyphenationSettings(style?: ElementStyle | Record<string, any>) {
        const mode = style?.hyphenation || this.config.layout.hyphenation || LAYOUT_DEFAULTS.textLayout.hyphenation;
        const hyphenateCaps =
            style?.hyphenateCaps ?? this.config.layout.hyphenateCaps ?? LAYOUT_DEFAULTS.textLayout.hyphenateCaps;
        const minWordLength = Math.max(
            2,
            Number(
                style?.hyphenMinWordLength ??
                    this.config.layout.hyphenMinWordLength ??
                    LAYOUT_DEFAULTS.textLayout.hyphenMinWordLength,
            ),
        );
        const minPrefix = Math.max(
            1,
            Number(
                style?.hyphenMinPrefix ??
                    this.config.layout.hyphenMinPrefix ??
                    LAYOUT_DEFAULTS.textLayout.hyphenMinPrefix,
            ),
        );
        const minSuffix = Math.max(
            1,
            Number(
                style?.hyphenMinSuffix ??
                    this.config.layout.hyphenMinSuffix ??
                    LAYOUT_DEFAULTS.textLayout.hyphenMinSuffix,
            ),
        );
        const rawLang = String(style?.lang || this.config.layout.lang || LAYOUT_DEFAULTS.textLayout.lang || 'und')
            .trim()
            .toLowerCase();
        const lang = rawLang.split('-')[0] || 'und';
        return { mode, hyphenateCaps, minWordLength, minPrefix, minSuffix, lang };
    }

    private isAdvancedJustifyEnabled(style?: ElementStyle | Record<string, any>): boolean {
        const mode =
            style?.justifyEngine || this.config.layout.justifyEngine || LAYOUT_DEFAULTS.textLayout.justifyEngine;
        return mode === 'advanced';
    }

    private makeWordSegmenter(locale: string | undefined, isCJK: boolean): any {
        const granularity = isCJK ? 'grapheme' : 'word';
        const primaryKey = `${locale || 'und'}|${granularity}`;
        const cachedPrimary = this.wordSegmenterCache.get(primaryKey);
        if (cachedPrimary) return cachedPrimary;

        try {
            const segmenter = new (Intl as any).Segmenter(locale, { granularity });
            this.wordSegmenterCache.set(primaryKey, segmenter);
            return segmenter;
        } catch {
            const fallbackKey = `und|${granularity}`;
            const cachedFallback = this.wordSegmenterCache.get(fallbackKey);
            if (cachedFallback) return cachedFallback;
            const fallback = new (Intl as any).Segmenter(undefined, { granularity });
            this.wordSegmenterCache.set(fallbackKey, fallback);
            return fallback;
        }
    }

    protected getGraphemeClusters(text: string): string[] {
        if (!text) return [];
        const clusters: string[] = [];
        for (const item of TextProcessor.graphemeSegmenter.segment(text) as any) {
            clusters.push(item.segment);
        }
        return clusters;
    }

    protected getClusterCodePoints(cluster: string): number[] {
        const codePoints: number[] = [];
        for (const ch of cluster) {
            const cp = ch.codePointAt(0);
            if (cp !== undefined) codePoints.push(cp);
        }
        return codePoints;
    }

    protected isIgnorableCodePoint(codePoint: number): boolean {
        return (
            codePoint === 0x200c || // ZWNJ
            codePoint === 0x200d || // ZWJ
            (codePoint >= 0xfe00 && codePoint <= 0xfe0f) || // Variation Selectors
            (codePoint >= 0xe0100 && codePoint <= 0xe01ef)
        ); // Variation Selectors Supplement
    }

    protected fontSupportsCluster(font: any, cluster: string): boolean {
        if (!font || !cluster) return false;
        for (const cp of this.getClusterCodePoints(cluster)) {
            if (this.isIgnorableCodePoint(cp)) continue;
            const glyph = font.glyphForCodePoint(cp);
            if (!glyph || glyph.id === 0) return false;
        }
        return true;
    }

    private getFontVerticalMetrics(font: any): { ascent: number; descent: number } {
        if (!font) {
            throw new Error('[TextProcessor] Missing font object for vertical metric extraction.');
        }
        const cached = fontVerticalMetricsCache.get(font);
        if (cached) return cached;

        const upm = Number(font.unitsPerEm);
        const rawAscent = Number(font.ascent);
        const rawDescent = Number(font.descent);
        if (!Number.isFinite(upm) || upm <= 0 || !Number.isFinite(rawAscent) || !Number.isFinite(rawDescent)) {
            const fontKey = font.postscriptName || font.familyName || 'unknown';
            throw new Error(`[TextProcessor] Invalid vertical metrics for font "${fontKey}".`);
        }

        const metrics = {
            ascent: (rawAscent / upm) * 1000,
            descent: (Math.abs(rawDescent) / upm) * 1000,
        };
        fontVerticalMetricsCache.set(font, metrics);
        return metrics;
    }

    private createEmptyMeasuredSegment(font: any, fontFamily?: string, style?: Record<string, any>): TextSegment {
        const metrics = this.getFontVerticalMetrics(font);
        return {
            text: '',
            fontFamily,
            style,
            width: 0,
            glyphs: [],
            ascent: metrics.ascent,
            descent: metrics.descent,
        };
    }

    private measureInlineObject(
        populateSegment: TextSegment,
        measurementFont: any,
        measurementFontSize: number,
    ): number {
        const inline = populateSegment.inlineObject;
        if (!inline) return 0;
        const style = (populateSegment.style || {}) as Record<string, any>;
        const verticalAlignRaw = String(style.verticalAlign || 'baseline').trim();
        const verticalAlign =
            verticalAlignRaw === 'text-top' ||
            verticalAlignRaw === 'middle' ||
            verticalAlignRaw === 'text-bottom' ||
            verticalAlignRaw === 'bottom'
                ? verticalAlignRaw
                : 'baseline';
        const baselineShift = LayoutUtils.validateUnit(style.baselineShift ?? 0);
        const marginLeft = LayoutUtils.validateUnit(style.inlineMarginLeft ?? 0);
        const marginRight = LayoutUtils.validateUnit(style.inlineMarginRight ?? 0);

        const resolveDescentPx = (contentHeight: number): number => {
            const em = Math.max(1, measurementFontSize);
            const textAscent = em * 0.8;
            const textDescent = em * 0.2;
            switch (verticalAlign) {
                case 'text-top':
                    return Math.max(0, contentHeight - textAscent - baselineShift);
                case 'middle':
                    return Math.max(0, contentHeight / 2 - em * 0.3 - baselineShift);
                case 'text-bottom':
                case 'bottom':
                    return Math.max(0, textDescent - baselineShift);
                case 'baseline':
                default:
                    return Math.max(0, -baselineShift);
            }
        };

        if (inline.kind === 'image') {
            const parsed = parseEmbeddedImagePayloadCached(inline.image);
            let contentWidth = style.width !== undefined ? LayoutUtils.validateUnit(style.width) : measurementFontSize;
            if (contentWidth <= 0) contentWidth = measurementFontSize;
            let contentHeight =
                style.height !== undefined
                    ? LayoutUtils.validateUnit(style.height)
                    : contentWidth * (parsed.intrinsicHeight / Math.max(1, parsed.intrinsicWidth));
            if (contentHeight <= 0) contentHeight = measurementFontSize;

            const rawOpticalInsetTop = LayoutUtils.validateUnit(style.inlineOpticalInsetTop ?? 0);
            const rawOpticalInsetRight = LayoutUtils.validateUnit(style.inlineOpticalInsetRight ?? 0);
            const rawOpticalInsetBottom = LayoutUtils.validateUnit(style.inlineOpticalInsetBottom ?? 0);
            const rawOpticalInsetLeft = LayoutUtils.validateUnit(style.inlineOpticalInsetLeft ?? 0);
            const opticalInsetTop = Math.max(0, Math.min(contentHeight, rawOpticalInsetTop));
            const opticalInsetBottom = Math.max(0, Math.min(contentHeight - opticalInsetTop, rawOpticalInsetBottom));
            const opticalInsetLeft = Math.max(0, Math.min(contentWidth, rawOpticalInsetLeft));
            const opticalInsetRight = Math.max(0, Math.min(contentWidth - opticalInsetLeft, rawOpticalInsetRight));
            const opticalHeight = Math.max(1, contentHeight - opticalInsetTop - opticalInsetBottom);
            const opticalWidth = Math.max(1, contentWidth - opticalInsetLeft - opticalInsetRight);

            const descentFromOpticalBottomPx = resolveDescentPx(opticalHeight);
            const descentPx = descentFromOpticalBottomPx + opticalInsetBottom;
            const ascentUnits = (Math.max(0, contentHeight - descentPx) / Math.max(1, measurementFontSize)) * 1000;
            const descentUnits = (descentPx / Math.max(1, measurementFontSize)) * 1000;
            const totalWidth = contentWidth + marginLeft + marginRight;

            populateSegment.glyphs = [];
            populateSegment.width = totalWidth;
            populateSegment.ascent = ascentUnits;
            populateSegment.descent = descentUnits;
            populateSegment.inlineMetrics = {
                width: totalWidth,
                height: contentHeight,
                contentWidth,
                contentHeight,
                opticalInsetTop,
                opticalInsetRight,
                opticalInsetBottom,
                opticalInsetLeft,
                opticalWidth,
                opticalHeight,
                descent: descentPx,
                marginLeft,
                marginRight,
                baselineShift,
                verticalAlign,
            };
            return totalWidth;
        }

        const paddingLeft = LayoutUtils.validateUnit(style.paddingLeft ?? style.padding ?? 2);
        const paddingRight = LayoutUtils.validateUnit(style.paddingRight ?? style.padding ?? 2);
        const paddingTop = LayoutUtils.validateUnit(style.paddingTop ?? style.padding ?? 1);
        const paddingBottom = LayoutUtils.validateUnit(style.paddingBottom ?? style.padding ?? 1);
        const borderWidth = LayoutUtils.validateUnit(style.borderWidth ?? 0);
        const horizontalInsets = paddingLeft + paddingRight + borderWidth * 2;
        const verticalInsets = paddingTop + paddingBottom + borderWidth * 2;
        const label = String(inline.text || '');
        const innerWidth = label
            ? this.measureText(label, measurementFont, measurementFontSize, 0)
            : Math.max(0, measurementFontSize * 0.75);

        let contentWidth =
            style.width !== undefined ? LayoutUtils.validateUnit(style.width) : innerWidth + horizontalInsets;
        if (contentWidth <= 0) contentWidth = Math.max(1, innerWidth + horizontalInsets);
        let contentHeight =
            style.height !== undefined
                ? LayoutUtils.validateUnit(style.height)
                : Math.max(measurementFontSize * 1.2, measurementFontSize + verticalInsets);
        if (contentHeight <= 0) contentHeight = Math.max(1, measurementFontSize);

        const descentPx = resolveDescentPx(contentHeight);
        const ascentUnits = (Math.max(0, contentHeight - descentPx) / Math.max(1, measurementFontSize)) * 1000;
        const descentUnits = (descentPx / Math.max(1, measurementFontSize)) * 1000;
        const totalWidth = contentWidth + marginLeft + marginRight;
        populateSegment.glyphs = [];
        populateSegment.width = totalWidth;
        populateSegment.ascent = ascentUnits;
        populateSegment.descent = descentUnits;
        populateSegment.inlineMetrics = {
            width: totalWidth,
            height: contentHeight,
            contentWidth,
            contentHeight,
            descent: descentPx,
            marginLeft,
            marginRight,
            baselineShift,
            verticalAlign,
        };
        return totalWidth;
    }

    /**
     * Returns the width in points of a given string using fontkit's layout.
     * Optionally populates the glyph positions if a segment object is provided.
     */
    protected measureText(
        text: string,
        font?: any,
        fontSize?: number,
        letterSpacing: number = 0,
        populateSegment?: TextSegment,
    ): number {
        const measurementFont = font || this.font;
        const measurementFontSize = fontSize || this.config.layout.fontSize;

        if (populateSegment?.inlineObject) {
            return this.measureInlineObject(populateSegment, measurementFont, measurementFontSize);
        }

        if (!text) return 0;

        if (!measurementFont) {
            throw new Error(
                `[TextProcessor] Missing measurement font for text "${text.slice(0, 24)}". Ensure fonts are loaded before layout.`,
            );
        }

        // Cache Key: Unique string representing the font, size, letterSpacing and text
        const fontKey = measurementFont.postscriptName || measurementFont.familyName || 'unknown';
        const variationKey =
            typeof measurementFont?.__vmprintVariationKey === 'string' ? measurementFont.__vmprintVariationKey : '';
        const cacheKey = `${fontKey}${variationKey ? `:${variationKey}` : ''}-${measurementFontSize}-${letterSpacing}-${text}`;

        const cached = this.runtime.measurementCache.get(cacheKey);
        if (cached) {
            if (populateSegment) {
                populateSegment.glyphs = this.cloneGlyphs(cached.glyphs);
                populateSegment.width = cached.width;
                populateSegment.ascent = cached.ascent;
                populateSegment.descent = cached.descent;
            }
            return cached.width;
        }

        const upm = measurementFont.unitsPerEm;
        if (!upm || !Number.isFinite(upm)) {
            throw new Error(`[TextProcessor] Invalid unitsPerEm for font "${fontKey}".`);
        }

        const scale = measurementFontSize / upm;
        try {
            const run = measurementFont.layout(text);
            let width = 0;
            const glyphs: { char: string; x: number; y: number }[] = [];

            for (let i = 0; i < run.glyphs.length; i++) {
                const glyph = run.glyphs[i];
                const pos = run.positions[i];

                const drawX = width + (pos.xOffset || 0) * scale;
                const drawY = (pos.yOffset || 0) * scale;
                const char = String.fromCodePoint(...glyph.codePoints);

                glyphs.push({ char, x: drawX, y: drawY });
                const xAdvance = pos.xAdvance !== undefined ? pos.xAdvance : glyph.advanceWidth;
                if (xAdvance === undefined || !Number.isFinite(xAdvance)) {
                    throw new Error(`[TextProcessor] Missing xAdvance for glyph in "${fontKey}".`);
                }
                width += xAdvance * scale + letterSpacing;
            }

            const { ascent, descent } = this.getFontVerticalMetrics(measurementFont);

            // Save to cache (LRU eviction: keep at most 50,000 entries)
            this.runtime.measurementCache.set(cacheKey, { width, glyphs, ascent, descent });
            if (this.runtime.measurementCache.size > 50_000) {
                const oldestKey = this.runtime.measurementCache.keys().next().value;
                if (oldestKey !== undefined) this.runtime.measurementCache.delete(oldestKey);
            }

            if (populateSegment) {
                populateSegment.glyphs = glyphs;
                populateSegment.width = width;
                populateSegment.ascent = ascent;
                populateSegment.descent = descent;
            }

            return width;
        } catch (e: any) {
            throw new Error(
                `[TextProcessor] Failed strict matrix measurement for "${text.slice(0, 24)}" using "${fontKey}": ${e?.message || e}`,
            );
        }
    }

    protected resolveLoadedFamilyFont(familyName: string, weight: number | string, style: string = 'normal'): any {
        this.hydrateFamilyWeightRanges(familyName);
        const match = LayoutUtils.resolveFontMatch(
            familyName,
            weight,
            style,
            this.runtime.fontRegistry,
            this.runtime.fontManager,
        );
        const cached = getCachedFont(match.config.src, this.runtime);
        if (!cached) {
            throw new Error(
                `[TextProcessor] Font "${match.config.name}" is not loaded. Call waitForFonts() before layout.`,
            );
        }

        return this.resolveWeightVariationFont(
            cached,
            match.config.src,
            match.resolvedWeight,
            match.usedVariableWeightRange,
        );
    }

    private hydrateFamilyWeightRanges(familyName: string): void {
        if (this.hydratedFamilies.has(familyName)) return;
        this.hydratedFamilies.add(familyName);
        const familyFonts = getFontsByFamily(familyName, this.runtime.fontRegistry, this.runtime.fontManager);
        for (const fontConfig of familyFonts) {
            if (fontConfig.weightRange) continue;
            const cached = getCachedFont(fontConfig.src, this.runtime);
            const inferred = this.inferWeightRange(cached);
            if (inferred) {
                fontConfig.weightRange = inferred;
            }
        }
    }

    private inferWeightRange(font: any): { min: number; max: number } | null {
        const axis = font?.variationAxes?.wght;
        if (!axis) return null;

        const min = Number(axis.min);
        const max = Number(axis.max);
        if (!Number.isFinite(min) || !Number.isFinite(max)) return null;

        return {
            min: Math.min(LayoutUtils.normalizeFontWeight(min), LayoutUtils.normalizeFontWeight(max)),
            max: Math.max(LayoutUtils.normalizeFontWeight(min), LayoutUtils.normalizeFontWeight(max)),
        };
    }

    private resolveWeightVariationFont(
        baseFont: any,
        src: string,
        resolvedWeight: number,
        shouldUseVariationRange: boolean,
    ): any {
        if (!baseFont || !shouldUseVariationRange) return baseFont;
        if (typeof baseFont.getVariation !== 'function') return baseFont;

        const axis = baseFont.variationAxes?.wght;
        if (!axis) return baseFont;

        const min = Number(axis.min);
        const max = Number(axis.max);
        if (!Number.isFinite(min) || !Number.isFinite(max)) return baseFont;

        const clampedWeight = Math.min(max, Math.max(min, resolvedWeight));
        const normalizedWeight = LayoutUtils.normalizeFontWeight(clampedWeight);
        const cacheKey = `${src}|wght=${normalizedWeight}`;
        const cachedVariation = this.variationFontCache.get(cacheKey);
        if (cachedVariation) return cachedVariation;

        try {
            const variation = baseFont.getVariation({ wght: normalizedWeight });
            if (!variation) return baseFont;
            try {
                variation.__vmprintVariationKey = `wght-${normalizedWeight}`;
            } catch {
                // Non-fatal: cache key falls back to postscript/family name.
            }
            this.variationFontCache.set(cacheKey, variation);
            return variation;
        } catch {
            return baseFont;
        }
    }

    /**
     * Calculates the total width of a RichLine by summing its segments.
     */
    protected measureRichLine(line: RichLine, letterSpacing: number = 0): number {
        return line.reduce((total, segment) => {
            const style = segment.style || {};
            const fontSize = Number(style.fontSize || this.config.layout.fontSize);
            const resolvedWeight = LayoutUtils.normalizeFontWeight(style.fontWeight);
            const resolvedStyle = LayoutUtils.normalizeFontStyle(style.fontStyle);

            let segmentFont = this.font;
            const familyName = segment.fontFamily || this.config.layout.fontFamily;

            segmentFont = this.resolveLoadedFamilyFont(familyName, resolvedWeight, resolvedStyle);

            return total + this.measureText(segment.text, segmentFont, fontSize, letterSpacing);
        }, 0);
    }

    /**
     * Calculates the available content width for a style definition.
     */
    protected getContentWidth(style?: any): number {
        return LayoutUtils.getContentWidth(this.config, style);
    }

    /**
     * Calculates the effective line height for a single line, accounting
     * for baseline alignment spread in mixed-script lines.
     */
    protected calculateEffectiveLineHeight(line: RichLine, baseFontSize: number, lineHeight: number): number {
        const maxLineFontSize = line.reduce(
            (max, seg) => Math.max(max, Number(seg.style?.fontSize || baseFontSize)),
            baseFontSize,
        );
        const nominalHeight = maxLineFontSize * lineHeight;

        let maxAscent = 0;
        let maxDescentFromBaseline = 0;

        for (const seg of line) {
            const segFontSize = Number(seg.style?.fontSize || baseFontSize);
            if (seg.ascent === undefined) {
                throw new Error(
                    `[TextProcessor] Missing ascent metric for segment "${(seg.text || '').slice(0, 24)}".`,
                );
            }
            if (seg.descent === undefined) {
                throw new Error(
                    `[TextProcessor] Missing descent metric for segment "${(seg.text || '').slice(0, 24)}".`,
                );
            }
            const segAscent = seg.ascent;
            if (segAscent > maxAscent) maxAscent = segAscent;

            const segDescent = (seg.descent / 1000) * segFontSize;
            if (segDescent > maxDescentFromBaseline) maxDescentFromBaseline = segDescent;
        }

        const baselineOffset = (maxAscent / 1000) * maxLineFontSize;
        const neededTextHeight = baselineOffset + maxDescentFromBaseline;
        const leading = nominalHeight - maxLineFontSize;
        const neededHeight = neededTextHeight + leading;

        return Math.max(nominalHeight, neededHeight);
    }

    /**
     * Calculates the total height of a set of wrapped lines.
     * Uses a UNIFORM line height across all lines in the element (the max
     * effective height of any single line) so that mixed-script paragraphs
     * have consistent vertical spacing throughout.
     */
    protected calculateLinesHeight(lines: RichLine[], style: any): number {
        const baseFontSize = Number(style.fontSize || this.config.layout.fontSize);
        const lineHeight = Number(style.lineHeight || this.config.layout.lineHeight);

        // First pass: find the max effective line height across ALL lines
        let uniformHeight = 0;
        for (const line of lines) {
            const h = this.calculateEffectiveLineHeight(line, baseFontSize, lineHeight);
            if (h > uniformHeight) uniformHeight = h;
        }

        return lines.length * uniformHeight;
    }

    protected splitByScriptType(text: string): { text: string; isCJK: boolean }[] {
        return splitTextByScriptType(
            text,
            (value) => this.getGraphemeClusters(value),
            (codePoint) => this.isCJKChar(codePoint),
        );
    }

    protected isCJKChar(code: number): boolean {
        return isCjkCodePoint(code);
    }

    private isThaiChar(code: number): boolean {
        return isThaiCodePoint(code);
    }

    private hasRtlScript(text: string): boolean {
        return detectRtlScript(text);
    }

    private cloneMeasuredSegment(
        base: TextSegment,
        text: string,
        font: any,
        fontSize: number,
        letterSpacing: number,
    ): { seg: TextSegment; width: number } {
        const seg: TextSegment = {
            ...base,
            text,
            glyphs: undefined,
            width: undefined,
            ascent: undefined,
            descent: undefined,
            justifyAfter: 0,
        };
        const width = this.measureText(text, font, fontSize, letterSpacing, seg);
        return { seg, width };
    }

    private tryHyphenateSegmentToFit(
        seg: TextSegment,
        font: any,
        fontSize: number,
        letterSpacing: number,
        availableWidth: number,
        style?: ElementStyle | Record<string, any>,
    ): { head: TextSegment; headWidth: number; tail: TextSegment; tailWidth: number } | null {
        return hyphenateSegmentToFit({
            seg,
            font,
            fontSize,
            letterSpacing,
            availableWidth,
            style,
            resolveHyphenationSettings: (resolvedStyle) => this.resolveHyphenationSettings(resolvedStyle),
            getGraphemeClusters: (text) => this.getGraphemeClusters(text),
            cloneMeasuredSegment: (base, value, cloneFont, cloneFontSize, cloneTracking) =>
                this.cloneMeasuredSegment(base, value, cloneFont, cloneFontSize, cloneTracking),
        });
    }

    private isCjkOrThaiCluster(text: string): boolean {
        const clusters = this.getGraphemeClusters(text);
        if (clusters.length === 0) return false;
        const cp = clusters[0].codePointAt(0) || 0;
        return this.isCJKChar(cp) || this.isThaiChar(cp);
    }

    private applyAdvancedJustification(
        lines: RichLine[],
        maxWidth: number,
        textIndent: number,
        baseStyle?: ElementStyle | Record<string, any>,
        resolveLineWidth?: (lineIndex: number, fallbackWidth: number) => number,
    ): RichLine[] {
        return applyJustification({
            lines,
            maxWidth,
            textIndent,
            baseStyle,
            layoutJustifyStrategy: this.config.layout.justifyStrategy,
            resolveLineWidth,
            isCjkOrThaiCluster: (text) => this.isCjkOrThaiCluster(text),
        });
    }

    /**
     * Classifies the dominant script of a text string based on its first
     * non-space character's Unicode code point.
     */
    protected getScriptClass(text: string): string {
        return classifyScript(
            text,
            (codePoint) => this.isCJKChar(codePoint),
            LAYOUT_DEFAULTS.opticalScaling.defaultScriptClass,
        );
    }

    /**
     * Returns the optical scaling factor for a given script class.
     * These factors adjust the rendered font size so secondary scripts
     * appear visually harmonious with the primary (Latin) text.
     */
    protected getOpticalScale(scriptClass: string): number {
        const os = this.config.layout.opticalScaling;
        if (os?.enabled === false) return LAYOUT_DEFAULTS.opticalScaling.neutral;

        // Check config override, then defaults, then fallback
        const configVal = os ? (os as any)[scriptClass] : undefined;
        if (configVal !== undefined && configVal !== null) return configVal;
        return (
            LAYOUT_DEFAULTS.opticalScaling.factors[scriptClass] ??
            LAYOUT_DEFAULTS.opticalScaling.factors.default ??
            LAYOUT_DEFAULTS.opticalScaling.neutral
        );
    }

    /**
     * Segments text into chunks based on which enabled font supports the characters.
     */
    protected segmentTextByFont(
        text: string,
        preferredFamily?: string,
        preferredLocale?: string,
    ): { text: string; fontName?: string; fontObject?: any }[] {
        return segmentTextByFontBySupport({
            text,
            preferredFamily,
            preferredLocale,
            baseFontFamily: this.config.layout.fontFamily,
            fallbackFamilies: getFallbackFamilies(this.runtime.fontRegistry, this.runtime.fontManager),
            getGraphemeClusters: (value) => this.getGraphemeClusters(value),
            resolveLoadedFamilyFont: (familyName, weight) => this.resolveLoadedFamilyFont(familyName, weight),
            fontSupportsCluster: (font, cluster) => this.fontSupportsCluster(font, cluster),
        });
    }

    protected getElementText(element: Element): string {
        return extractElementText(element);
    }

    /**
     * Slices a stream of elements by character offsets.
     */
    protected sliceElements(elements: Element[], start: number, end: number): Element[] {
        return extractSlicedElements(elements, start, end);
    }

    protected getNodeText(node: any): string {
        return extractNodeText(node);
    }

    /**
     * Recursively collects text segments from an element's children, preserving styles.
     */
    protected getRichSegments(element: Element, inheritedStyle: any = {}): TextSegment[] {
        return extractRichSegments(element, inheritedStyle, {
            transformContent: (text) => text,
            resolveStyleForType: (type) => this.config.styles[type] || {},
        });
    }

    /**
     * Specialized word-wrapper for rich text segments.
     */
    protected wrapRichSegments(
        segments: TextSegment[],
        maxWidth: number,
        font: any,
        fontSize: number,
        letterSpacing: number = 0,
        textIndent: number = 0,
        lineLayoutResolver?: (lineIndex: number) => { width: number; xOffset: number; yOffset?: number },
        lineLayoutOut?: { widths: number[]; offsets: number[]; yOffsets: number[] },
    ): RichLine[] {
        if (segments.length === 0) return [[this.createEmptyMeasuredSegment(font)]];
        const primaryStyle = (segments.find((seg) => !!seg.style)?.style || {}) as ElementStyle;
        const advancedJustify = this.isAdvancedJustifyEnabled(primaryStyle) && primaryStyle.textAlign === 'justify';
        const direction = String(
            primaryStyle.direction || this.config.layout.direction || LAYOUT_DEFAULTS.textLayout.direction,
        );
        const preserveDirectionalBoundaries = direction === 'rtl';
        const resolvedLineLayout = new Map<number, { width: number; xOffset: number; yOffset: number }>();
        const resolveLineLayout = (lineIndex: number): { width: number; xOffset: number; yOffset: number } => {
            const cached = resolvedLineLayout.get(lineIndex);
            if (cached) return cached;

            const resolved = lineLayoutResolver
                ? lineLayoutResolver(lineIndex)
                : { width: maxWidth, xOffset: 0, yOffset: 0 };
            const normalized = {
                width: Math.max(0, Number(resolved?.width ?? maxWidth)),
                xOffset: Number(resolved?.xOffset ?? 0),
                yOffset: Math.max(0, Number(resolved?.yOffset ?? 0)),
            };
            resolvedLineLayout.set(lineIndex, normalized);
            return normalized;
        };
        const flattenedSegments = flattenSegmentsByHardBreak(segments);
        const tokens = buildRichWrapTokens({
            flattenedSegments,
            defaultFontSize: fontSize,
            primaryStyle,
            advancedJustify,
            direction,
            preserveDirectionalBoundaries,
            segmentTextByFont: (value, preferredFamily, preferredLocale) =>
                this.segmentTextByFont(value, preferredFamily, preferredLocale),
            splitByScriptType: (value) => this.splitByScriptType(value),
            getScriptClass: (value) => this.getScriptClass(value),
            getOpticalScale: (scriptClass) => this.getOpticalScale(scriptClass),
            getSegmenterLocale: (style) => this.getSegmenterLocale(style),
            makeWordSegmenter: (locale, isCJK) => this.makeWordSegmenter(locale, isCJK),
            transformSegment: (segment) => segment,
            hasRtlScript: (value) => this.hasRtlScript(value),
            isAdvancedJustifyEnabled: (style) => this.isAdvancedJustifyEnabled(style),
            resolveRichFontInfo: (seg, defaultSize) =>
                resolveRichFontInfo(seg, defaultSize, this.config.layout.fontFamily, (familyName, weight) =>
                    this.resolveLoadedFamilyFont(familyName, weight),
                ),
        });
        const wrapped = wrapTokenStream({
            tokens,
            maxWidth,
            textIndent,
            letterSpacing,
            fallbackFont: font,
            hyphenate: true,
            createEmptyMeasuredSegment: (fallbackFont) => this.createEmptyMeasuredSegment(fallbackFont),
            measureText: (segmentText, segmentFont, segmentFontSize, segmentTracking, populateSegment) =>
                this.measureText(segmentText, segmentFont, segmentFontSize, segmentTracking, populateSegment),
            appendSegmentToLine: (line, segment, segmentWidth, allowMerge) =>
                appendSegmentToLine(line, segment, segmentWidth, allowMerge, (left, right) =>
                    this.styleSignatureCache.areStylesEquivalent(left, right),
                ),
            getLineWidthLimit: (totalWidth, lineIndex, firstLineIndent) => {
                const lineLayout = resolveLineLayout(lineIndex);
                return getLineWidthLimit(lineLayout.width || totalWidth, lineIndex, firstLineIndent);
            },
            tryHyphenateSegmentToFit: (seg, segFont, segFontSize, segTracking, availableWidth, style) =>
                this.tryHyphenateSegmentToFit(seg, segFont, segFontSize, segTracking, availableWidth, style),
            splitToGraphemes: (value, locale) =>
                splitToGraphemes(value, locale, (fallback) => this.getGraphemeClusters(fallback)),
            transformSegment: (segment) => segment,
            resolveRichFontInfo: (seg, defaultSize) =>
                resolveRichFontInfo(seg, defaultSize, this.config.layout.fontFamily, (familyName, weight) =>
                    this.resolveLoadedFamilyFont(familyName, weight),
                ),
        });

        if (lineLayoutOut) {
            lineLayoutOut.widths = [];
            lineLayoutOut.offsets = [];
            lineLayoutOut.yOffsets = [];
            for (let idx = 0; idx < wrapped.length; idx++) {
                const lineLayout = resolveLineLayout(idx);
                lineLayoutOut.widths.push(lineLayout.width);
                lineLayoutOut.offsets.push(lineLayout.xOffset);
                lineLayoutOut.yOffsets.push(lineLayout.yOffset);
            }
        }

        if (advancedJustify) {
            return this.applyAdvancedJustification(
                wrapped,
                maxWidth,
                textIndent,
                primaryStyle,
                (lineIndex, fallbackWidth) => resolveLineLayout(lineIndex).width || fallbackWidth,
            );
        }
        return wrapped;
    }
}
