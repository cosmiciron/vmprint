import { Context } from '@vmprint/contracts';
import { Box, ElementStyle } from '../types';
import { parseEmbeddedImagePayloadCached } from '../image-data';
import { LayoutUtils } from '../layout/layout-utils';
import { RendererLineSegment } from './types';

type ImageBytesResolver = (base64Data: string) => Uint8Array;

type DrawLineOptions = {
    color?: string;
    lineWidth?: number;
    dash?: [number, number];
};

const drawLine = (
    context: Context,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    options?: DrawLineOptions,
): void => {
    context.save();
    context.strokeColor(options?.color || 'black');
    context.lineWidth(options?.lineWidth || 1);
    if (options?.dash) {
        context.dash(options.dash[0], { space: options.dash[1] });
    } else {
        context.undash();
    }
    context.moveTo(x1, y1).lineTo(x2, y2).stroke();
    context.restore();
};

export const drawBoxBackground = (context: Context, box: Box, boxStyle: ElementStyle): void => {
    if (!boxStyle.backgroundColor) return;
    const radius = boxStyle.borderRadius || 0;
    if (radius > 0) {
        context.roundedRect(box.x, box.y, box.w, box.h, radius).fillColor(boxStyle.backgroundColor).fill();
        return;
    }
    context.rect(box.x, box.y, box.w, box.h).fillColor(boxStyle.backgroundColor).fill();
};

export const drawImageBox = (context: Context, box: Box, getImageBytes: ImageBytesResolver): void => {
    const image = box.image;
    if (!image) return;

    const boxStyle = box.style || {};
    const paddingLeft = LayoutUtils.validateUnit(boxStyle.paddingLeft ?? boxStyle.padding ?? 0);
    const paddingRight = LayoutUtils.validateUnit(boxStyle.paddingRight ?? boxStyle.padding ?? 0);
    const paddingTop = LayoutUtils.validateUnit(boxStyle.paddingTop ?? boxStyle.padding ?? 0);
    const paddingBottom = LayoutUtils.validateUnit(boxStyle.paddingBottom ?? boxStyle.padding ?? 0);
    const borderLeft = LayoutUtils.validateUnit(boxStyle.borderLeftWidth ?? boxStyle.borderWidth ?? 0);
    const borderRight = LayoutUtils.validateUnit(boxStyle.borderRightWidth ?? boxStyle.borderWidth ?? 0);
    const borderTop = LayoutUtils.validateUnit(boxStyle.borderTopWidth ?? boxStyle.borderWidth ?? 0);
    const borderBottom = LayoutUtils.validateUnit(boxStyle.borderBottomWidth ?? boxStyle.borderWidth ?? 0);

    const contentX = box.x + paddingLeft + borderLeft;
    const contentY = box.y + paddingTop + borderTop;
    const contentWidth = Math.max(0, box.w - paddingLeft - paddingRight - borderLeft - borderRight);
    const contentHeight = Math.max(0, box.h - paddingTop - paddingBottom - borderTop - borderBottom);
    if (contentWidth <= 0 || contentHeight <= 0) return;

    let drawX = contentX;
    let drawY = contentY;
    let drawWidth = contentWidth;
    let drawHeight = contentHeight;

    if (image.fit !== 'fill') {
        const intrinsicWidth = Math.max(1, Number(image.intrinsicWidth || 1));
        const intrinsicHeight = Math.max(1, Number(image.intrinsicHeight || 1));
        const scale = Math.min(contentWidth / intrinsicWidth, contentHeight / intrinsicHeight);
        drawWidth = intrinsicWidth * scale;
        drawHeight = intrinsicHeight * scale;
        drawX = contentX + (contentWidth - drawWidth) / 2;
        drawY = contentY + (contentHeight - drawHeight) / 2;
    }

    const bytes = getImageBytes(image.base64Data);
    context.image(bytes, drawX, drawY, {
        width: drawWidth,
        height: drawHeight,
        mimeType: image.mimeType,
    });
};

export const drawInlineImageSegment = (
    context: Context,
    seg: RendererLineSegment,
    drawX: number,
    drawY: number,
    fallbackFontSize: number,
    getImageBytes: ImageBytesResolver,
): void => {
    const inline = seg?.inlineObject;
    if (!inline || inline.kind !== 'image') return;

    const parsed = parseEmbeddedImagePayloadCached(inline.image);
    const style = seg?.style || {};
    const marginLeft = Number(seg?.inlineMetrics?.marginLeft || 0);
    let contentWidth = Number(seg?.inlineMetrics?.contentWidth || 0);
    if (!Number.isFinite(contentWidth) || contentWidth <= 0) {
        contentWidth = style.width !== undefined ? LayoutUtils.validateUnit(style.width) : fallbackFontSize;
    }
    let contentHeight = Number(seg?.inlineMetrics?.contentHeight || 0);
    if (!Number.isFinite(contentHeight) || contentHeight <= 0) {
        contentHeight =
            style.height !== undefined
                ? LayoutUtils.validateUnit(style.height)
                : contentWidth * (parsed.intrinsicHeight / Math.max(1, parsed.intrinsicWidth));
    }
    const bytes = getImageBytes(parsed.base64Data);
    context.image(bytes, drawX + marginLeft, drawY, {
        width: contentWidth,
        height: contentHeight,
        mimeType: parsed.mimeType,
    });
};

export const drawInlineBoxSegment = (
    context: Context,
    seg: RendererLineSegment,
    drawX: number,
    drawY: number,
    fallbackFontSize: number,
): void => {
    const inline = seg?.inlineObject;
    if (!inline || inline.kind !== 'box') return;

    const style = seg?.style || {};
    const marginLeft = Number(seg?.inlineMetrics?.marginLeft || 0);
    const boxWidth = Number(seg?.inlineMetrics?.contentWidth || style.width || fallbackFontSize);
    const boxHeight = Number(seg?.inlineMetrics?.contentHeight || style.height || fallbackFontSize * 1.2);
    const paddingLeft = LayoutUtils.validateUnit(style.paddingLeft ?? style.padding ?? 2);
    const paddingRight = LayoutUtils.validateUnit(style.paddingRight ?? style.padding ?? 2);
    const paddingTop = LayoutUtils.validateUnit(style.paddingTop ?? style.padding ?? 1);
    const borderWidth = LayoutUtils.validateUnit(style.borderWidth ?? 0);
    const bg = style.backgroundColor || '#f3f4f6';
    const borderColor = style.borderColor || '#d1d5db';
    const textColor = style.color || '#111827';
    const text = String(inline.text || '');
    const textSize = Number(style.fontSize || fallbackFontSize);

    context.save();
    const contentX = drawX + marginLeft;
    context.rect(contentX, drawY, boxWidth, boxHeight).fillColor(bg).fill();
    if (borderWidth > 0) {
        context.lineWidth(borderWidth).strokeColor(borderColor).rect(contentX, drawY, boxWidth, boxHeight).stroke();
    }
    context.fillColor(textColor);
    context.fontSize(textSize);
    context.text(text, contentX + borderWidth + paddingLeft, drawY + borderWidth + paddingTop, {
        lineBreak: false,
        width: Math.max(0, boxWidth - borderWidth * 2 - paddingLeft - paddingRight),
        characterSpacing: 0,
    });
    context.restore();
};

export const drawBoxBorders = (context: Context, box: Box, boxStyle: ElementStyle): void => {
    const borderWidth = LayoutUtils.validateUnit(boxStyle.borderWidth ?? 0);
    const borderColor = boxStyle.borderColor || 'black';

    const bTop = LayoutUtils.validateUnit(boxStyle.borderTopWidth ?? borderWidth);
    if (bTop > 0 && box.properties?._isFirstLine) {
        drawLine(context, box.x, box.y, box.x + box.w, box.y, {
            color: boxStyle.borderTopColor || borderColor,
            lineWidth: bTop,
        });
    }

    const bBottom = LayoutUtils.validateUnit(boxStyle.borderBottomWidth ?? borderWidth);
    if (bBottom > 0 && box.properties?._isLastLine) {
        drawLine(context, box.x, box.y + box.h, box.x + box.w, box.y + box.h, {
            color: boxStyle.borderBottomColor || borderColor,
            lineWidth: bBottom,
        });
    }

    const bLeft = LayoutUtils.validateUnit(boxStyle.borderLeftWidth ?? borderWidth);
    if (bLeft > 0 && box.properties?._isFirstFragmentInLine) {
        const decX = box.x - (box.decorationOffset || 0);
        drawLine(context, decX, box.y, decX, box.y + box.h, {
            color: boxStyle.borderLeftColor || borderColor,
            lineWidth: bLeft,
        });
    }

    const bRight = LayoutUtils.validateUnit(boxStyle.borderRightWidth ?? borderWidth);
    if (bRight > 0 && box.properties?._isLastFragmentInLine) {
        drawLine(context, box.x + box.w, box.y, box.x + box.w, box.y + box.h, {
            color: boxStyle.borderRightColor || borderColor,
            lineWidth: bRight,
        });
    }
};
