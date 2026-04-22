import type { Context } from '../../contracts';
import { Box, ElementStyle } from '../types';
import { parseEmbeddedImagePayloadCached } from '../image-data';
import { parseSvgPathSubpaths } from '../geometry/svg-path';
import { LayoutUtils } from '../layout/layout-utils';
import { RendererLineSegment } from './types';

type ImageBytesResolver = (base64Data: string) => Uint8Array;

type ImageClipAssemblyMember = {
    x: number;
    y: number;
    w: number;
    h: number;
    shape?: 'rect' | 'circle' | 'ellipse' | 'polygon';
    path?: string;
};

type ClipDescriptor = {
    shape: string;
    path: string;
    assembly: ImageClipAssemblyMember[];
};

export const resolveClipDescriptor = (box: Box): ClipDescriptor => ({
    shape: String(
        box.properties?._clipShape
        || box.properties?._imageClipShape
        || box.properties?.space?.shape
        || box.properties?.spatialField?.shape
        || ''
    ).trim(),
    path: String(
        box.properties?._clipPath
        || box.properties?._imageClipPath
        || box.properties?.space?.path
        || box.properties?.spatialField?.path
        || ''
    ).trim(),
    assembly: Array.isArray(box.properties?._clipAssembly)
        ? (box.properties?._clipAssembly as ImageClipAssemblyMember[])
        : (Array.isArray(box.properties?._imageClipAssembly)
            ? (box.properties?._imageClipAssembly as ImageClipAssemblyMember[])
            : [])
});

function drawEllipsePath(context: Context, x: number, y: number, w: number, h: number): void {
    const rx = Math.max(0, w / 2);
    const ry = Math.max(0, h / 2);
    if (rx <= 0 || ry <= 0) return;

    const cx = x + rx;
    const cy = y + ry;
    const kappa = 0.5522847498307936;
    const ox = rx * kappa;
    const oy = ry * kappa;

    context.moveTo(cx + rx, cy);
    context.bezierCurveTo(cx + rx, cy + oy, cx + ox, cy + ry, cx, cy + ry);
    context.bezierCurveTo(cx - ox, cy + ry, cx - rx, cy + oy, cx - rx, cy);
    context.bezierCurveTo(cx - rx, cy - oy, cx - ox, cy - ry, cx, cy - ry);
    context.bezierCurveTo(cx + ox, cy - ry, cx + rx, cy - oy, cx + rx, cy);
}

export const applyClipPath = (
    context: Context,
    x: number,
    y: number,
    w: number,
    h: number,
    clip: ClipDescriptor
): boolean => {
    const traced = traceClipPath(context, x, y, w, h, clip);
    if (traced) {
        context.clip();
    }
    return traced;
};

export const traceClipPath = (
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
            } else if (member.shape === 'ellipse') {
                drawEllipsePath(context, memberX, memberY, memberW, memberH);
            } else if (member.shape === 'polygon' && typeof member.path === 'string' && member.path.trim()) {
                drawPolygonPath(context, parseSvgPathSubpaths(member.path), memberX, memberY, 1, 1);
            } else {
                context.rect(memberX, memberY, memberW, memberH);
            }
        }
        return true;
    }
    if (clip.shape === 'circle') {
        const radius = Math.max(0, Math.min(w, h) / 2);
        if (radius > 0) {
            context.circle(x + (w / 2), y + (h / 2), radius);
            return true;
        }
    }
    if (clip.shape === 'ellipse') {
        drawEllipsePath(context, x, y, w, h);
        return true;
    }
    if (clip.shape === 'polygon' && clip.path) {
        drawPolygonPath(context, parseSvgPathSubpaths(clip.path), x, y, 1, 1);
        return true;
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
    if (clip.assembly.length > 0 || !!clip.shape || !!clip.path) {
        context.save();
        if (traceClipPath(context, box.x, box.y, box.w, box.h, clip)) {
            context.fillColor(boxStyle.backgroundColor).fill();
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

    const carrySourceOffsetY = Number(box.properties?._carrySourceOffsetY ?? 0);
    const authoredOriginalBoxWidth = Number(box.properties?._carryOriginalBoxWidth);
    const authoredOriginalBoxHeight = Number(box.properties?._carryOriginalBoxHeight);
    const originalBoxWidth = Number.isFinite(authoredOriginalBoxWidth)
        ? Math.max(1, authoredOriginalBoxWidth)
        : box.w;
    const originalBoxHeight = Number.isFinite(authoredOriginalBoxHeight)
        ? Math.max(1, authoredOriginalBoxHeight)
        : box.h;
    const hasCarryViewport =
        (Number.isFinite(carrySourceOffsetY) && carrySourceOffsetY > 0)
        || Math.abs(originalBoxWidth - box.w) > 0.001
        || Math.abs(originalBoxHeight - box.h) > 0.001;
    const originalContentWidth = Math.max(0, originalBoxWidth - paddingLeft - paddingRight - borderLeft - borderRight);
    const originalContentHeight = Math.max(0, originalBoxHeight - paddingTop - paddingBottom - borderTop - borderBottom);
    if (hasCarryViewport && (originalContentWidth <= 0 || originalContentHeight <= 0)) return;

    let drawX = contentX;
    let drawY = contentY;
    let drawWidth = hasCarryViewport ? originalContentWidth : contentWidth;
    let drawHeight = hasCarryViewport ? originalContentHeight : contentHeight;

    if (image.fit !== 'fill') {
        const intrinsicWidth = Math.max(1, Number(image.intrinsicWidth || 1));
        const intrinsicHeight = Math.max(1, Number(image.intrinsicHeight || 1));
        const fitWidth = hasCarryViewport ? originalContentWidth : contentWidth;
        const fitHeight = hasCarryViewport ? originalContentHeight : contentHeight;
        const scale = Math.min(fitWidth / intrinsicWidth, fitHeight / intrinsicHeight);
        drawWidth = intrinsicWidth * scale;
        drawHeight = intrinsicHeight * scale;
        const anchorWidth = hasCarryViewport ? originalContentWidth : contentWidth;
        const anchorHeight = hasCarryViewport ? originalContentHeight : contentHeight;
        drawX = contentX + ((anchorWidth - drawWidth) / 2);
        drawY = contentY + ((anchorHeight - drawHeight) / 2);
    }

    if (hasCarryViewport) {
        const originalToDrawScaleY = originalContentHeight > 0 ? (drawHeight / originalContentHeight) : 1;
        drawY -= carrySourceOffsetY * originalToDrawScaleY;
    }

    const bytes = getImageBytes(image.base64Data);
    const clip = resolveClipDescriptor(box);
    const clipShape = clip.shape;
    const clipAssembly = clip.assembly;
    const clipBoxWidth = hasCarryViewport ? originalBoxWidth : box.w;
    const clipBoxHeight = hasCarryViewport ? originalBoxHeight : box.h;
    const clipScaleX = clipBoxWidth > 0 ? drawWidth / clipBoxWidth : 1;
    const clipScaleY = clipBoxHeight > 0 ? drawHeight / clipBoxHeight : 1;
    if (clipAssembly.length > 0) {
        context.save();
        if (hasCarryViewport) {
            context.rect(contentX, contentY, contentWidth, contentHeight).clip();
        }
        for (const member of clipAssembly) {
            const memberX = drawX + (Number(member.x || 0) * clipScaleX);
            const memberY = drawY + (Number(member.y || 0) * clipScaleY);
            const memberW = Math.max(0, Number(member.w || 0) * clipScaleX);
            const memberH = Math.max(0, Number(member.h || 0) * clipScaleY);
            if (memberW <= 0 || memberH <= 0) continue;
            if (member.shape === 'circle') {
                context.circle(
                    memberX + (memberW / 2),
                    memberY + (memberH / 2),
                    Math.max(0, Math.min(memberW, memberH) / 2)
                );
            } else if (member.shape === 'ellipse') {
                drawEllipsePath(context, memberX, memberY, memberW, memberH);
            } else if (member.shape === 'polygon' && typeof member.path === 'string' && member.path.trim()) {
                drawPolygonPath(context, parseSvgPathSubpaths(member.path), memberX, memberY, clipScaleX, clipScaleY);
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
            if (hasCarryViewport) {
                context.rect(contentX, contentY, contentWidth, contentHeight).clip();
            }
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
    if (clipShape === 'ellipse') {
        context.save();
        if (hasCarryViewport) {
            context.rect(contentX, contentY, contentWidth, contentHeight).clip();
        }
        drawEllipsePath(context, drawX, drawY, drawWidth, drawHeight);
        context.clip();
        context.image(bytes, drawX, drawY, {
            width: drawWidth,
            height: drawHeight,
            mimeType: image.mimeType
        });
        context.restore();
        return;
    }
    if (clipShape === 'polygon' && clip.path) {
        context.save();
        if (hasCarryViewport) {
            context.rect(contentX, contentY, contentWidth, contentHeight).clip();
        }
        drawPolygonPath(
            context,
            parseSvgPathSubpaths(clip.path),
            drawX,
            drawY,
            clipScaleX,
            clipScaleY
        );
        context.clip();
        context.image(bytes, drawX, drawY, {
            width: drawWidth,
            height: drawHeight,
            mimeType: image.mimeType
        });
        context.restore();
        return;
    }
    if (hasCarryViewport) {
        context.save();
        context.rect(contentX, contentY, contentWidth, contentHeight).clip();
        context.image(bytes, drawX, drawY, {
            width: drawWidth,
            height: drawHeight,
            mimeType: image.mimeType
        });
        context.restore();
        return;
    }
    context.image(bytes, drawX, drawY, {
        width: drawWidth,
        height: drawHeight,
        mimeType: image.mimeType
    });
};

function drawPolygonPath(
    context: Context,
    subpaths: ReturnType<typeof parseSvgPathSubpaths>,
    offsetX: number,
    offsetY: number,
    scaleX: number,
    scaleY: number
): void {
    for (const subpath of subpaths) {
        if (!Array.isArray(subpath.points) || subpath.points.length === 0) continue;
        const first = subpath.points[0]!;
        context.moveTo(offsetX + (first.x * scaleX), offsetY + (first.y * scaleY));
        for (let index = 1; index < subpath.points.length; index++) {
            const point = subpath.points[index]!;
            context.lineTo(offsetX + (point.x * scaleX), offsetY + (point.y * scaleY));
        }
        if (subpath.closed) {
            context.lineTo(offsetX + (first.x * scaleX), offsetY + (first.y * scaleY));
        }
    }
}

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
    const clip = resolveClipDescriptor(box);
    const hasClip = clip.assembly.length > 0 || !!clip.shape || !!clip.path;
    if (
        hasClip
        && borderWidth > 0
        && box.properties?._isFirstLine
        && box.properties?._isLastLine
        && box.properties?._isFirstFragmentInLine
        && box.properties?._isLastFragmentInLine
    ) {
        context.save();
        if (traceClipPath(context, box.x, box.y, box.w, box.h, clip)) {
            context.lineWidth(borderWidth).strokeColor(borderColor).stroke();
            context.restore();
            return;
        }
        context.restore();
    }

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
