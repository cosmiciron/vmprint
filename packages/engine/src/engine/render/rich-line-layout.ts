import { ElementStyle } from '../types';
import { RendererBoxProperties, RendererLine, RendererParagraphMetrics, RendererRichLine } from './types';

export type RendererLineFrameAccessors = {
    hasExplicitLineYOffsets: boolean;
    getLineOffset: (lineIndex: number) => number;
    getLineWidth: (lineIndex: number) => number;
    getLineY: (lineIndex: number) => number | null;
};

const lineEndsWithForcedBreak = (line: RendererLine): boolean => {
    if (!Array.isArray(line) || line.length === 0) return false;
    return !!line[line.length - 1]?.forcedBreakAfter;
};

const getReferenceAscentScale = (line: RendererRichLine): number => {
    if (line.length === 0) return 0;
    const textLikeSegments = line.filter((seg) => !seg?.inlineObject);
    const source = textLikeSegments.length > 0 ? textLikeSegments : line;
    let maxAscent = 0;
    for (const seg of source) {
        if (seg.ascent === undefined) {
            throw new Error(`[Renderer] Missing precomputed ascent for segment "${(seg.text || '').slice(0, 24)}".`);
        }
        if (seg.ascent > maxAscent) maxAscent = seg.ascent;
    }
    return maxAscent / 1000;
};

const computeEffectiveLineHeight = (
    line: RendererRichLine,
    baseFontSize: number,
    lineHeight: number,
    referenceAscentScale: number,
): number => {
    const lineFontSize = line.reduce(
        (max, seg) => Math.max(max, Number(seg.style?.fontSize || baseFontSize)),
        Number(baseFontSize),
    );
    const nominal = lineFontSize * lineHeight;
    if (line.length === 0) return nominal;

    let maxAscentFromBaseline = 0;
    let maxDescentFromBaseline = 0;
    for (const seg of line) {
        const segFontSize = Number(seg.style?.fontSize || baseFontSize);
        if (seg.ascent === undefined) {
            throw new Error(`[Renderer] Missing precomputed ascent for segment "${(seg.text || '').slice(0, 24)}".`);
        }
        const segAscent = (seg.ascent / 1000) * segFontSize;
        if (segAscent > maxAscentFromBaseline) maxAscentFromBaseline = segAscent;
        if (seg.descent === undefined) {
            throw new Error(`[Renderer] Missing precomputed descent for segment "${(seg.text || '').slice(0, 24)}".`);
        }
        const segDescent = (seg.descent / 1000) * segFontSize;
        if (segDescent > maxDescentFromBaseline) maxDescentFromBaseline = segDescent;
    }

    const baselineOffset = referenceAscentScale * lineFontSize;
    const neededAscentFromTop = Math.max(maxAscentFromBaseline, baselineOffset);
    const neededTextHeight = neededAscentFromTop + maxDescentFromBaseline;
    const lead = nominal - lineFontSize;
    const neededHeight = neededTextHeight + lead;
    return Math.max(nominal, neededHeight);
};

export const buildParagraphMetrics = (
    lines: RendererLine[],
    fontSize: number,
    lineHeight: number,
): RendererParagraphMetrics => {
    const lineHasInlineObject = (line: RendererRichLine): boolean => line.some((seg) => !!seg?.inlineObject);
    const paragraphHasInlineObjects = lines.some((line) => Array.isArray(line) && lineHasInlineObject(line));

    // Use a paragraph-level baseline reference to prevent per-line baseline jitter
    // when one line contains taller fallback-script ascenders than adjacent lines.
    let paragraphReferenceAscentScale = 0;
    for (const line of lines) {
        if (!Array.isArray(line)) continue;
        const ref = getReferenceAscentScale(line);
        if (ref > paragraphReferenceAscentScale) paragraphReferenceAscentScale = ref;
    }

    const lineMetrics = lines.map((line) => {
        if (!Array.isArray(line)) {
            return {
                lineFontSize: Number(fontSize),
                referenceAscentScale: paragraphReferenceAscentScale,
                effectiveLineHeight: Number(fontSize) * lineHeight,
            };
        }

        const lineFontSize = line.reduce(
            (max, seg) => Math.max(max, Number(seg.style?.fontSize || fontSize)),
            Number(fontSize),
        );
        const referenceAscentScale = paragraphHasInlineObjects
            ? getReferenceAscentScale(line)
            : paragraphReferenceAscentScale;

        return {
            lineFontSize,
            referenceAscentScale,
            effectiveLineHeight: computeEffectiveLineHeight(line, fontSize, lineHeight, referenceAscentScale),
        };
    });

    let uniformLineHeight = 0;
    for (const metric of lineMetrics) {
        if (metric.effectiveLineHeight > uniformLineHeight) uniformLineHeight = metric.effectiveLineHeight;
    }

    return {
        paragraphHasInlineObjects,
        paragraphReferenceAscentScale,
        lineMetrics,
        uniformLineHeight,
    };
};

export const computeLineWidth = (line: RendererLine): number => {
    if (!Array.isArray(line)) return 0;
    return line.reduce((width, seg) => {
        if (seg.width === undefined) {
            throw new Error(`[Renderer] Missing precomputed width for segment "${(seg.text || '').slice(0, 24)}".`);
        }
        return width + seg.width;
    }, 0);
};

export const computeAlignedLineX = (
    lineIndex: number,
    lineDirection: 'ltr' | 'rtl',
    lineOriginX: number,
    lineWidthLimit: number,
    textIndent: number,
    align: ElementStyle['textAlign'] | undefined,
    adjustedLineWidth: number,
): number => {
    let lineX = lineIndex === 0 ? lineOriginX + textIndent : lineOriginX;
    if (lineDirection === 'rtl') {
        lineX = lineIndex === 0 ? lineOriginX + lineWidthLimit - textIndent : lineOriginX + lineWidthLimit;
        if (align === 'right') {
            lineX = lineOriginX + adjustedLineWidth;
        } else if (align === 'center') {
            lineX = lineOriginX + (lineWidthLimit + adjustedLineWidth) / 2;
        }
        return lineX;
    }

    if (align && align !== 'left') {
        if (align === 'right') {
            lineX = lineOriginX + (lineWidthLimit - adjustedLineWidth);
        } else if (align === 'center') {
            lineX = lineOriginX + (lineWidthLimit - adjustedLineWidth) / 2;
        }
    }

    return lineX;
};

export const computeJustifyExtraAfter = (
    line: RendererLine,
    lineIndex: number,
    lineCount: number,
    align: ElementStyle['textAlign'] | undefined,
    justifyEngine: string,
    lineWidthLimit: number,
    lineWidth: number,
): number[] => {
    if (align !== 'justify') return [];
    if (lineIndex === lineCount - 1) return [];
    if (lineEndsWithForcedBreak(line)) return [];
    if (!Array.isArray(line)) return [];

    if (justifyEngine === 'advanced') {
        return line.map((seg) => Number(seg.justifyAfter || 0));
    }

    const availableExtra = lineWidthLimit - lineWidth;
    if (availableExtra <= 0.0001) return [];

    const hasWhitespace = line.some((seg) => /\s/.test(seg.text || ''));
    const isCjkLike = (text: string) => /[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff\uac00-\ud7af]/.test(text);
    const isPunct = (text: string) =>
        /^[\s.,;:!?\uFF0C\u3002\uFF1B\uFF1A\uFF01\uFF1F\u3001\uFF08\uFF09()\u300A\u300B\u3010\u3011'"\u201C\u201D\u2018\u2019\u2026-]*$/.test(
            text,
        );
    const shouldStretchBoundary = (left: string, right: string): boolean => {
        if (!left || !right) return false;
        if (/\s$/.test(left) || /^\s/.test(right)) return true;
        if (hasWhitespace) return false;
        if (isPunct(left) || isPunct(right)) return false;
        return isCjkLike(left) && isCjkLike(right);
    };

    const boundaries: number[] = [];
    for (let i = 0; i < line.length - 1; i++) {
        const left = line[i]?.text || '';
        const right = line[i + 1]?.text || '';
        if (shouldStretchBoundary(left, right)) boundaries.push(i);
    }
    if (boundaries.length === 0) return [];

    const perBoundary = availableExtra / boundaries.length;
    const justifyExtraAfter = new Array(line.length).fill(0);
    boundaries.forEach((idx) => {
        justifyExtraAfter[idx] = perBoundary;
    });
    return justifyExtraAfter;
};

export const createLineFrameAccessors = (
    boxProperties: RendererBoxProperties | undefined,
    startY: number,
    width: number,
): RendererLineFrameAccessors => {
    const lineOffsets: number[] = Array.isArray(boxProperties?._lineOffsets) ? boxProperties._lineOffsets : [];
    const lineWidths: number[] = Array.isArray(boxProperties?._lineWidths) ? boxProperties._lineWidths : [];
    const lineYOffsets: number[] = Array.isArray(boxProperties?._lineYOffsets) ? boxProperties._lineYOffsets : [];
    const hasExplicitLineYOffsets = lineYOffsets.length > 0;

    return {
        hasExplicitLineYOffsets,
        getLineOffset: (lineIndex: number): number => {
            const candidate = lineOffsets[lineIndex];
            return Number.isFinite(candidate) ? Number(candidate) : 0;
        },
        getLineWidth: (lineIndex: number): number => {
            const candidate = lineWidths[lineIndex];
            if (Number.isFinite(candidate) && Number(candidate) > 0) return Number(candidate);
            return width;
        },
        getLineY: (lineIndex: number): number | null => {
            if (!hasExplicitLineYOffsets) return null;
            const candidate = lineYOffsets[lineIndex];
            if (!Number.isFinite(candidate)) return null;
            return startY + Math.max(0, Number(candidate));
        },
    };
};
