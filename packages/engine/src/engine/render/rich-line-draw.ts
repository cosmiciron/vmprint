import { Context } from '@vmprint/contracts';
import { RendererLineItem, RendererLineSegment, RendererRichLine } from './types';

type DrawRichLineSegmentsOptions = {
    lineDirection: 'ltr' | 'rtl';
    lineX: number;
    lineTopY: number;
    lineWidthLimit: number;
    lineReferenceAscentScale: number;
    actualLineFontSize: number;
    effectiveLineHeight: number;
    vOffset: number;
    fontSize: number;
    letterSpacing: number;
    baseFontFamily: string;
    baseWeight: number | string;
    baseStyle: string;
    containerColor?: string;
    getFontId: (family: string, weight: number | string | undefined, style: string | undefined) => string;
    drawInlineImageSegment: (seg: RendererLineSegment, drawX: number, drawY: number, fallbackFontSize: number) => void;
    drawInlineBoxSegment: (seg: RendererLineSegment, drawX: number, drawY: number, fallbackFontSize: number) => void;
};

export const drawRichLineSegments = (
    context: Context,
    line: RendererRichLine,
    lineItems: RendererLineItem[],
    options: DrawRichLineSegmentsOptions,
): number => {
    let currentX = options.lineX;
    const hasInlineObjectInLine = line.some((seg) => !!seg?.inlineObject);
    let lineBaselineFromTop = options.vOffset + options.lineReferenceAscentScale * options.actualLineFontSize;

    if (hasInlineObjectInLine) {
        const lineAscentDescent = line.reduce(
            (acc, seg) => {
                const segFontSize = Number(seg?.style?.fontSize || options.fontSize);
                const segAscentPx = (Number(seg?.ascent || 0) / 1000) * segFontSize;
                const segDescentPx = (Number(seg?.descent || 0) / 1000) * segFontSize;
                if (segAscentPx > acc.maxAscentPx) acc.maxAscentPx = segAscentPx;
                if (segDescentPx > acc.maxDescentPx) acc.maxDescentPx = segDescentPx;
                return acc;
            },
            { maxAscentPx: 0, maxDescentPx: 0 },
        );
        const usedHeight = lineAscentDescent.maxAscentPx + lineAscentDescent.maxDescentPx;
        const extraLeading = Math.max(0, options.effectiveLineHeight - usedHeight);
        lineBaselineFromTop = lineAscentDescent.maxAscentPx + extraLeading / 2;
    }
    const lineBaselineY = options.lineTopY + lineBaselineFromTop;

    lineItems.forEach(({ seg, extra }) => {
        const fam = seg.fontFamily || options.baseFontFamily;
        const wt = seg.style?.fontWeight || options.baseWeight;
        const st = seg.style?.fontStyle || options.baseStyle;
        const size = seg.style?.fontSize || options.fontSize;
        const color = seg.style?.color || options.containerColor || 'black';
        const bg = seg.style?.backgroundColor;

        context.font(options.getFontId(fam, wt, st));
        context.fontSize(size);
        context.fillColor(color);

        if (seg.width === undefined) {
            throw new Error(`[Renderer] Missing precomputed width for segment "${(seg.text || '').slice(0, 24)}".`);
        }
        const segWidth = seg.width;
        if (options.lineDirection === 'rtl') {
            currentX -= segWidth;
        }
        const drawX = currentX;

        if (bg) {
            context.save();
            const rX = drawX || 0;
            const rY = options.lineTopY || 0;
            const rW = segWidth || 0;
            const rH = options.effectiveLineHeight || 0;

            if (!isNaN(rX) && !isNaN(rY) && !isNaN(rW) && !isNaN(rH)) {
                context.rect(rX, rY, rW, rH).fillColor(bg).fill();
            }
            context.restore();
        }

        let yAdjustment = 0;
        if (seg.ascent === undefined) {
            throw new Error(`[Renderer] Missing precomputed ascent for segment "${(seg.text || '').slice(0, 24)}".`);
        }
        const segAscender = seg.ascent;
        try {
            const segAscentScale = segAscender / 1000;
            const safeSegSize = Number(size) || 12;
            const segBaselineOffset = segAscentScale * safeSegSize;
            if (hasInlineObjectInLine) {
                yAdjustment = lineBaselineFromTop - segBaselineOffset;
            } else {
                const lineBaselineOffset = options.lineReferenceAscentScale * options.actualLineFontSize;
                yAdjustment = lineBaselineOffset - segBaselineOffset;
            }
            if (isNaN(yAdjustment) || !isFinite(yAdjustment)) {
                yAdjustment = 0;
            }
        } catch {
            yAdjustment = 0;
        }

        let finalY = options.lineTopY + (hasInlineObjectInLine ? yAdjustment : options.vOffset + yAdjustment) || 0;
        if (!seg.inlineObject) {
            if (seg.descent === undefined) {
                throw new Error(
                    `[Renderer] Missing precomputed descent for segment "${(seg.text || '').slice(0, 24)}".`,
                );
            }
            const segAscentPx = (segAscender / 1000) * (Number(size) || options.fontSize);
            const segDescentPx = (seg.descent / 1000) * (Number(size) || options.fontSize);
            const lineBottomY = (options.lineTopY || 0) + (options.effectiveLineHeight || 0);
            const maxTopY = lineBottomY - segAscentPx - segDescentPx;
            if (Number.isFinite(maxTopY) && finalY > maxTopY) {
                finalY = maxTopY;
            }
            if (finalY < (options.lineTopY || 0)) {
                finalY = options.lineTopY || 0;
            }
        } else if (finalY < (options.lineTopY || 0)) {
            finalY = options.lineTopY || 0;
        }

        if (seg.inlineObject) {
            if (seg.inlineObject.kind === 'image') {
                options.drawInlineImageSegment(seg, drawX, finalY, Number(size) || options.fontSize);
            } else {
                options.drawInlineBoxSegment(seg, drawX, finalY, Number(size) || options.fontSize);
            }
        } else if (!seg.linkTarget && seg.glyphs && seg.glyphs.length > 0) {
            seg.glyphs.forEach((glyph) => {
                const glyphX = drawX + glyph.x;
                const glyphY = finalY + glyph.y;
                if (typeof glyph.char === 'string' && glyph.char.length > 0) {
                    context.text(glyph.char, glyphX, glyphY, {
                        lineBreak: false,
                        characterSpacing: 0,
                        ascent: segAscender,
                        ...(seg.linkTarget ? { link: seg.linkTarget } : {}),
                    });
                }
            });
        } else {
            const dX = drawX || 0;
            const dW = options.lineWidthLimit || 0;
            const dH = options.effectiveLineHeight || 0;
            if (!isNaN(dX) && !isNaN(finalY)) {
                context.text(seg.text, dX, finalY, {
                    lineBreak: false,
                    width: dW,
                    height: dH,
                    characterSpacing: options.letterSpacing,
                    ascent: segAscender,
                    ...(seg.linkTarget ? { link: seg.linkTarget } : {}),
                });
            }
        }

        if (options.lineDirection === 'rtl') {
            currentX -= extra;
        } else {
            currentX += segWidth;
            currentX += extra;
        }
    });

    return lineBaselineY;
};
