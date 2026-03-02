import { Context } from '@vmprint/contracts';
import { ElementStyle, LayoutConfig } from '../types';
import { LAYOUT_DEFAULTS } from '../layout/defaults';
import { LayoutUtils } from '../layout/layout-utils';
import { drawInlineBoxSegment, drawInlineImageSegment } from './box-paint';
import { drawDebugBaseline } from './debug-draw';
import { reorderItemsForRtl, resolveLineDirection } from './direction';
import { drawRichLineSegments } from './rich-line-draw';
import {
    buildParagraphMetrics,
    computeAlignedLineX,
    computeJustifyExtraAfter,
    computeLineWidth,
    createLineFrameAccessors,
} from './rich-line-layout';
import { RendererBoxProperties, RendererLine, RendererLineItem } from './types';

type DrawRichLinesRuntime = {
    layout: LayoutConfig['layout'];
    debug: boolean;
    getFontId: (family: string, weight: number | string | undefined, style: string | undefined) => string;
    getImageBytes: (base64Data: string) => Uint8Array;
};

export const drawRichLines = (
    context: Context,
    lines: RendererLine[],
    x: number,
    startY: number,
    containerStyle: ElementStyle,
    width: number,
    runtime: DrawRichLinesRuntime,
    boxProperties?: RendererBoxProperties,
): void => {
    let currentY = startY;
    const fontSize = Number(containerStyle.fontSize || runtime.layout.fontSize);
    const lineHeight = Number(containerStyle.lineHeight || runtime.layout.lineHeight);

    const baseFontFamily = containerStyle.fontFamily || runtime.layout.fontFamily;
    const baseWeight = containerStyle.fontWeight || 400;
    const baseStyle = containerStyle.fontStyle || 'normal';

    const align = containerStyle.textAlign;
    const justifyEngine =
        containerStyle.justifyEngine || runtime.layout.justifyEngine || LAYOUT_DEFAULTS.textLayout.justifyEngine;
    const letterSpacing = LayoutUtils.validateUnit(containerStyle.letterSpacing || 0);
    const textIndent = LayoutUtils.validateUnit(containerStyle.textIndent || 0);

    const lineFrame = createLineFrameAccessors(boxProperties, startY, width);
    const paragraphMetrics = buildParagraphMetrics(lines, fontSize, lineHeight);

    lines.forEach((line, lineIndex) => {
        const actualLineFontSize = paragraphMetrics.lineMetrics[lineIndex]?.lineFontSize ?? fontSize;
        const lineReferenceAscentScale =
            paragraphMetrics.lineMetrics[lineIndex]?.referenceAscentScale ??
            paragraphMetrics.paragraphReferenceAscentScale;
        const effectiveLineHeight = paragraphMetrics.paragraphHasInlineObjects
            ? (paragraphMetrics.lineMetrics[lineIndex]?.effectiveLineHeight ?? paragraphMetrics.uniformLineHeight)
            : paragraphMetrics.uniformLineHeight;
        const nominalLineHeight = actualLineFontSize * lineHeight;
        const nominalLeading = nominalLineHeight - actualLineFontSize;
        // Baseline alignment should be based on nominal leading only.
        // Any extra height added to avoid glyph clipping must not re-center text vertically.
        const vOffset = nominalLeading / 2;
        const lineOffset = lineFrame.getLineOffset(lineIndex);
        const lineWidthLimit = lineFrame.getLineWidth(lineIndex);
        const lineOriginX = x + lineOffset;
        const lineTopY = lineFrame.getLineY(lineIndex) ?? currentY;
        let lineBaselineY = lineTopY + vOffset + lineReferenceAscentScale * actualLineFontSize;
        const lineDirection = resolveLineDirection(
            line,
            containerStyle,
            runtime.layout.direction,
            LAYOUT_DEFAULTS.textLayout.direction,
        );
        const lineWidth = computeLineWidth(line);
        const adjustedLineWidth = lineWidth - (letterSpacing || 0);
        const lineX = computeAlignedLineX(
            lineIndex,
            lineDirection,
            lineOriginX,
            lineWidthLimit,
            textIndent,
            align,
            adjustedLineWidth,
        );

        const justifyExtraAfter = computeJustifyExtraAfter(
            line,
            lineIndex,
            lines.length,
            align,
            justifyEngine,
            lineWidthLimit,
            lineWidth,
        );

        if (typeof line === 'string') {
            context
                .font(runtime.getFontId(baseFontFamily, baseWeight, baseStyle))
                .fontSize(fontSize)
                .fillColor(containerStyle.color || 'black')
                .text(line, lineX, lineTopY + vOffset, {
                    width: lineWidthLimit,
                    lineBreak: false,
                    characterSpacing: letterSpacing,
                });
        } else {
            const rawItems: RendererLineItem[] = line.map((seg, idx) => ({ seg, extra: justifyExtraAfter[idx] || 0 }));
            const lineItems = lineDirection === 'rtl' ? reorderItemsForRtl(rawItems) : rawItems;
            lineBaselineY = drawRichLineSegments(context, line, lineItems, {
                lineDirection,
                lineX,
                lineTopY,
                lineWidthLimit,
                lineReferenceAscentScale,
                actualLineFontSize,
                effectiveLineHeight,
                vOffset,
                fontSize,
                letterSpacing,
                baseFontFamily,
                baseWeight,
                baseStyle,
                containerColor: containerStyle.color,
                getFontId: (family, weight, style) => runtime.getFontId(family, weight, style),
                drawInlineImageSegment: (seg, drawX, drawY, fallbackFontSize) => {
                    drawInlineImageSegment(context, seg, drawX, drawY, fallbackFontSize, (base64Data) =>
                        runtime.getImageBytes(base64Data),
                    );
                },
                drawInlineBoxSegment: (seg, drawX, drawY, fallbackFontSize) => {
                    drawInlineBoxSegment(context, seg, drawX, drawY, fallbackFontSize);
                },
            });
        }
        if (runtime.debug && Number.isFinite(lineBaselineY)) {
            drawDebugBaseline(context, lineOriginX, lineOriginX + Math.max(0, lineWidthLimit), lineBaselineY);
        }
        if (lineFrame.hasExplicitLineYOffsets) {
            currentY = Math.max(currentY, lineTopY + effectiveLineHeight);
        } else {
            currentY += effectiveLineHeight;
        }
    });
};
