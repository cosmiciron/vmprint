import { Context } from '@vmprint/contracts';
import { Box, ElementStyle } from '../types';
import { parseEmbeddedImagePayloadCached } from '../image-data';
import { LayoutUtils } from '../layout/layout-utils';
import { RendererLineSegment } from './types';

type ImageBytesResolver = (base64Data: string) => Uint8Array;

type ImageClipAssemblyMember = {
    x: number;
    y: number;
    w: number;
    h: number;
    shape?: 'rect' | 'circle';
};

type ClipDescriptor = {
    shape: string;
    assembly: ImageClipAssemblyMember[];
};

const resolveClipDescriptor = (box: Box): ClipDescriptor => ({
    shape: String(box.properties?._clipShape || box.properties?._imageClipShape || '').trim(),
    assembly: Array.isArray(box.properties?._clipAssembly)
        ? (box.properties?._clipAssembly as ImageClipAssemblyMember[])
        : (Array.isArray(box.properties?._imageClipAssembly)
            ? (box.properties?._imageClipAssembly as ImageClipAssemblyMember[])
            : [])
});

const applyClipPath = (
    context: Context,
    x: number,
    y: number,
    w: number,
    h: number,
    clip: ClipDescriptor
): boolean => {
    if (clip.assembly.length > 0) {
        for (const member of clip.assembly) {
            const memberX = x + Number(member.x || 0);
            const memberY = y + Number(member.y || 0);
            const memberW = Math.max(0, Number(member.w || 0));
            const memberH = Math.max(0, Number(member.h || 0));
            if (memberW <= 0 || memberH <= 0) continue;
            if (member.shape === 'circle') {
                context.circle(
                    memberX + (memberW / 2),
                    memberY + (memberH / 2),
                    Math.max(0, Math.min(memberW, memberH) / 2)
                );
            } else {
                context.rect(memberX, memberY, memberW, memberH);
            }
        }
        context.clip();
        return true;
    }
    if (clip.shape === 'circle') {
        const radius = Math.max(0, Math.min(w, h) / 2);
        if (radius > 0) {
            context.circle(x + (w / 2), y + (h / 2), radius).clip();
            return true;
        }
    }
    return false;
};

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
    options?: DrawLineOptions
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
    const clip = resolveClipDescriptor(box);
    const radius = boxStyle.borderRadius || 0;
    if (clip.assembly.length > 0 || clip.shape === 'circle') {
        context.save();
        if (applyClipPath(context, box.x, box.y, box.w, box.h, clip)) {
            context.rect(box.x, box.y, box.w, box.h).fillColor(boxStyle.backgroundColor).fill();
            context.restore();
            return;
        }
        context.restore();
    }
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
        drawX = contentX + ((contentWidth - drawWidth) / 2);
        drawY = contentY + ((contentHeight - drawHeight) / 2);
    }

    const bytes = getImageBytes(image.base64Data);
    const clip = resolveClipDescriptor(box);
    const clipShape = clip.shape;
    const clipAssembly = clip.assembly;
    if (clipAssembly.length > 0) {
        const scaleX = box.w > 0 ? drawWidth / box.w : 1;
        const scaleY = box.h > 0 ? drawHeight / box.h : 1;
        context.save();
        for (const member of clipAssembly) {
            const memberX = drawX + (Number(member.x || 0) * scaleX);
            const memberY = drawY + (Number(member.y || 0) * scaleY);
            const memberW = Math.max(0, Number(member.w || 0) * scaleX);
            const memberH = Math.max(0, Number(member.h || 0) * scaleY);
            if (memberW <= 0 || memberH <= 0) continue;
            if (member.shape === 'circle') {
                context.circle(
                    memberX + (memberW / 2),
                    memberY + (memberH / 2),
                    Math.max(0, Math.min(memberW, memberH) / 2)
                );
            } else {
                context.rect(memberX, memberY, memberW, memberH);
            }
        }
        context.clip();
        context.image(bytes, drawX, drawY, {
            width: drawWidth,
            height: drawHeight,
            mimeType: image.mimeType
        });
        context.restore();
        return;
    }
    if (clipShape === 'circle') {
        const radius = Math.max(0, Math.min(drawWidth, drawHeight) / 2);
        if (radius > 0) {
            context.save();
            context.circle(drawX + (drawWidth / 2), drawY + (drawHeight / 2), radius).clip();
            context.image(bytes, drawX, drawY, {
                width: drawWidth,
                height: drawHeight,
                mimeType: image.mimeType
            });
            context.restore();
            return;
        }
    }
    context.image(bytes, drawX, drawY, {
        width: drawWidth,
        height: drawHeight,
        mimeType: image.mimeType
    });
};

export const drawInlineImageSegment = (
    context: Context,
    seg: RendererLineSegment,
    drawX: number,
    drawY: number,
    fallbackFontSize: number,
    getImageBytes: ImageBytesResolver
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
        contentHeight = style.height !== undefined
            ? LayoutUtils.validateUnit(style.height)
            : contentWidth * (parsed.intrinsicHeight / Math.max(1, parsed.intrinsicWidth));
    }
    const bytes = getImageBytes(parsed.base64Data);
    context.image(bytes, drawX + marginLeft, drawY, {
        width: contentWidth,
        height: contentHeight,
        mimeType: parsed.mimeType
    });
};

export const drawInlineBoxSegment = (
    context: Context,
    seg: RendererLineSegment,
    drawX: number,
    drawY: number,
    fallbackFontSize: number,
    fontAscent: number
): void => {
    const inline = seg?.inlineObject;
    if (!inline || inline.kind !== 'box') return;

    const style = seg?.style || {};
    const marginLeft = Number(seg?.inlineMetrics?.marginLeft || 0);
    const boxWidth = Number(seg?.inlineMetrics?.contentWidth || style.width || fallbackFontSize);
    const boxHeight = Number(seg?.inlineMetrics?.contentHeight || style.height || (fallbackFontSize * 1.2));
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
        ascent: fontAscent
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
            lineWidth: bTop
        });
    }

    const bBottom = LayoutUtils.validateUnit(boxStyle.borderBottomWidth ?? borderWidth);
    if (bBottom > 0 && box.properties?._isLastLine) {
        drawLine(context, box.x, box.y + box.h, box.x + box.w, box.y + box.h, {
            color: boxStyle.borderBottomColor || borderColor,
            lineWidth: bBottom
        });
    }

    const bLeft = LayoutUtils.validateUnit(boxStyle.borderLeftWidth ?? borderWidth);
    if (bLeft > 0 && box.properties?._isFirstFragmentInLine) {
        const decX = box.x - (box.decorationOffset || 0);
        drawLine(context, decX, box.y, decX, box.y + box.h, {
            color: boxStyle.borderLeftColor || borderColor,
            lineWidth: bLeft
        });
    }

    const bRight = LayoutUtils.validateUnit(boxStyle.borderRightWidth ?? borderWidth);
    if (bRight > 0 && box.properties?._isLastFragmentInLine) {
        drawLine(context, box.x + box.w, box.y, box.x + box.w, box.y + box.h, {
            color: boxStyle.borderRightColor || borderColor,
            lineWidth: bRight
        });
    }
};
