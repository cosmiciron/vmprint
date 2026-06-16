import { ElementStyle } from '../../types';
import { LAYOUT_DEFAULTS } from '../defaults';
import { LayoutUtils } from '../layout-utils';
import { reorderItemsForVisualBidi, resolveParagraphDirection } from '../../render/direction';
import {
    buildParagraphMetrics,
    computeAlignedLineX,
    computeJustifyExtraAfter,
    computeLineWidth,
    createLineFrameAccessors
} from '../../render/rich-line-layout';
import type { RendererLine, RendererLineItem, RendererLineSegment } from '../../render/types';
import type {
    LayoutBox,
    PackagerHitTestInput,
    PackagerHitTestResult
} from './packager-types';

type TextHitRuntime = {
    layout?: {
        fontFamily?: string;
        fontSize?: number;
        lineHeight?: number;
        lineHeightMode?: 'print' | 'css';
        lineHeightAdjustment?: number;
        justifyEngine?: string;
        direction?: string;
    };
};

type TextHitOwner = {
    actorId: string;
    sourceId: string;
};

type SegmentPlacement = {
    segment: RendererLineSegment;
    segmentIndex: number;
    x: number;
    y: number;
    w: number;
    h: number;
};

const resolveTextContentFrame = (box: LayoutBox, style: ElementStyle): { x: number; y: number; width: number } => {
    const paddingLeft = LayoutUtils.validateUnit(style.paddingLeft ?? style.padding ?? 0);
    const paddingRight = LayoutUtils.validateUnit(style.paddingRight ?? style.padding ?? 0);
    const paddingTop = LayoutUtils.validateUnit(style.paddingTop ?? style.padding ?? 0);
    const borderLeft = LayoutUtils.validateUnit(style.borderLeftWidth ?? style.borderWidth ?? 0);
    const borderRight = LayoutUtils.validateUnit(style.borderRightWidth ?? style.borderWidth ?? 0);
    const borderTop = LayoutUtils.validateUnit(style.borderTopWidth ?? style.borderWidth ?? 0);
    return {
        x: Number(box.x || 0) + paddingLeft + borderLeft,
        y: Number(box.y || 0) + paddingTop + borderTop,
        width: Math.max(0, Number(box.w || 0) - paddingLeft - paddingRight - borderLeft - borderRight)
    };
};

const containsInclusive = (value: number, start: number, end: number): boolean =>
    value >= Math.min(start, end) && value <= Math.max(start, end);

const distanceToRange = (value: number, start: number, end: number): number => {
    const lo = Math.min(start, end);
    const hi = Math.max(start, end);
    if (value < lo) return lo - value;
    if (value > hi) return value - hi;
    return 0;
};

const resolveSegmentIndex = (line: RendererLine, segment: RendererLineSegment): number => {
    if (!Array.isArray(line)) return -1;
    const index = line.indexOf(segment);
    return index >= 0 ? index : 0;
};

const findGlyphCharacterAtPoint = (
    segment: RendererLineSegment,
    localX: number,
    direction: 'ltr' | 'rtl'
): { sourceOffset?: number; character?: string; characterIndex?: number } | null => {
    const glyphs = Array.isArray(segment.glyphs) ? segment.glyphs : [];
    const text = String(segment.text || '');
    if (text.length === 0) return null;

    const sourceStart = Number.isFinite(Number(segment.sourceStart)) ? Number(segment.sourceStart) : 0;
    const chars = Array.from(text);
    if (glyphs.length === 0) {
        if (chars.length !== 1) return null;
        return {
            sourceOffset: sourceStart,
            character: chars[0] || '',
            characterIndex: 0
        };
    }

    const segmentWidth = Math.max(0, Number(segment.width || 0));
    const spans = glyphs.map((glyph, index) => {
        const logicalStart = Math.max(0, Number(glyph.x || 0));
        const next = glyphs[index + 1];
        const logicalEnd = next ? Math.max(logicalStart, Number(next.x || segmentWidth)) : segmentWidth;
        return {
            index,
            x0: direction === 'rtl' ? Math.max(0, segmentWidth - logicalEnd) : logicalStart,
            x1: direction === 'rtl' ? Math.max(0, segmentWidth - logicalStart) : logicalEnd
        };
    });

    for (const span of spans) {
        if (containsInclusive(localX, span.x0, span.x1)) {
            return {
                sourceOffset: sourceStart + span.index,
                character: chars[span.index] || '',
                characterIndex: span.index
            };
        }
    }

    let nearest = spans[0];
    let nearestDistance = distanceToRange(localX, nearest.x0, nearest.x1);
    for (const span of spans.slice(1)) {
        const distance = distanceToRange(localX, span.x0, span.x1);
        if (distance < nearestDistance) {
            nearest = span;
            nearestDistance = distance;
        }
    }
    const logicalIndex = Math.max(0, Math.min(glyphs.length - 1, nearest.index));
    return {
        sourceOffset: sourceStart + logicalIndex,
        character: chars[logicalIndex] || '',
        characterIndex: logicalIndex
    };
};

const findSegmentPlacement = (
    line: RendererLine,
    lineItems: RendererLineItem[],
    lineDirection: 'ltr' | 'rtl',
    pointX: number,
    lineTopY: number,
    effectiveLineHeight: number,
    lineX: number
): SegmentPlacement | null => {
    let currentX = lineX;
    let nearest: SegmentPlacement | null = null;
    let nearestDistance = Number.POSITIVE_INFINITY;

    for (const item of lineItems) {
        const segmentWidth = Math.max(0, Number(item.seg.width || 0));
        if (lineDirection === 'rtl') currentX -= segmentWidth;
        const segmentX = currentX;
        const distance = distanceToRange(pointX, segmentX, segmentX + segmentWidth);
        const placement: SegmentPlacement = {
            segment: item.seg,
            segmentIndex: resolveSegmentIndex(line, item.seg),
            x: segmentX,
            y: lineTopY,
            w: segmentWidth,
            h: effectiveLineHeight
        };
        if (containsInclusive(pointX, segmentX, segmentX + segmentWidth)) {
            return placement;
        }
        if (distance < nearestDistance) {
            nearest = placement;
            nearestDistance = distance;
        }
        if (lineDirection === 'rtl') {
            currentX -= item.extra;
        } else {
            currentX += segmentWidth + item.extra;
        }
    }

    return nearest;
};

export function hitTestRichTextBox(
    input: PackagerHitTestInput,
    owner: TextHitOwner,
    runtime: TextHitRuntime = {}
): PackagerHitTestResult | null {
    const box: LayoutBox = input.box;
    const lines = Array.isArray(box.lines) ? box.lines as RendererLine[] : [];
    if (lines.length === 0) {
        return { kind: 'box', actorId: owner.actorId, sourceId: owner.sourceId, reason: 'no-text-lines' };
    }

    const style: ElementStyle = box.style || {};
    const layout = runtime.layout || {};
    const fontSize = Number(style.fontSize || layout.fontSize || 12);
    const lineHeight = Number(style.lineHeight || layout.lineHeight || 1.2);
    const align = style.textAlign;
    const justifyEngine = String(style.justifyEngine || layout.justifyEngine || LAYOUT_DEFAULTS.textLayout.justifyEngine);
    const letterSpacing = LayoutUtils.validateUnit(style.letterSpacing || 0);
    const textIndent = LayoutUtils.validateUnit(style.textIndent || 0);
    const contentFrame = resolveTextContentFrame(box, style);
    const lineFrame = createLineFrameAccessors(box.properties, contentFrame.y, contentFrame.width);
    const paragraphMetrics = buildParagraphMetrics(lines, fontSize, lineHeight, {
        mode: layout.lineHeightMode,
        adjustment: layout.lineHeightAdjustment
    });
    const paragraphDirection = resolveParagraphDirection(
        lines,
        style,
        layout.direction,
        LAYOUT_DEFAULTS.textLayout.direction
    );

    let currentY = contentFrame.y;
    let nearestLineIndex = 0;
    let nearestLineDistance = Number.POSITIVE_INFINITY;
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
        const effectiveLineHeight = paragraphMetrics.lineMetrics[lineIndex]?.effectiveLineHeight
            ?? paragraphMetrics.uniformLineHeight;
        const lineTopY = lineFrame.getLineY(lineIndex) ?? currentY;
        const distance = distanceToRange(input.pagePoint.y, lineTopY, lineTopY + effectiveLineHeight);
        if (distance < nearestLineDistance) {
            nearestLineIndex = lineIndex;
            nearestLineDistance = distance;
        }
        currentY = lineTopY + effectiveLineHeight;
    }

    const line = lines[nearestLineIndex];
    if (!Array.isArray(line) || line.length === 0) {
        return { kind: 'box', actorId: owner.actorId, sourceId: owner.sourceId, reason: 'empty-text-line' };
    }

    const actualLineFontSize = paragraphMetrics.lineMetrics[nearestLineIndex]?.lineFontSize ?? fontSize;
    const effectiveLineHeight = paragraphMetrics.lineMetrics[nearestLineIndex]?.effectiveLineHeight
        ?? paragraphMetrics.uniformLineHeight;
    const lineOffset = lineFrame.getLineOffset(nearestLineIndex);
    const lineWidthLimit = lineFrame.getLineWidth(nearestLineIndex);
    const lineOriginX = contentFrame.x + lineOffset;
    const lineTopY = lineFrame.getLineY(nearestLineIndex) ?? (
        contentFrame.y
        + paragraphMetrics.lineMetrics
            .slice(0, nearestLineIndex)
            .reduce((sum, metric) => sum + (metric?.effectiveLineHeight ?? paragraphMetrics.uniformLineHeight), 0)
    );
    const lineWidth = computeLineWidth(line);
    const adjustedLineWidth = lineWidth - (letterSpacing || 0);
    const lineDirection = paragraphDirection;
    const lineX = computeAlignedLineX(
        nearestLineIndex,
        lineDirection,
        lineOriginX,
        lineWidthLimit,
        textIndent,
        align,
        adjustedLineWidth
    );
    const justifyExtraAfter = computeJustifyExtraAfter(
        line,
        nearestLineIndex,
        lines.length,
        align,
        justifyEngine,
        lineWidthLimit,
        lineWidth
    );
    const rawItems = line.map((segment, index) => ({ seg: segment, extra: justifyExtraAfter[index] || 0 }));
    const lineItems = reorderItemsForVisualBidi(rawItems, lineDirection);
    const placement = findSegmentPlacement(
        line,
        lineItems,
        lineDirection,
        input.pagePoint.x,
        lineTopY,
        effectiveLineHeight,
        lineX
    );
    if (!placement) {
        return { kind: 'box', actorId: owner.actorId, sourceId: owner.sourceId, reason: 'no-text-segment' };
    }

    const segment = placement.segment;
    const localX = Math.max(0, Math.min(placement.w, input.pagePoint.x - placement.x));
    const segmentDirection = segment.direction === 'rtl' ? 'rtl' : 'ltr';
    const segmentIsShaped = Array.isArray(segment.shapedGlyphs) && segment.shapedGlyphs.length > 0 && segmentDirection === 'rtl';
    const glyphHit = segmentIsShaped
        ? null
        : findGlyphCharacterAtPoint(segment, localX, segmentDirection);
    return {
        kind: 'text',
        actorId: owner.actorId,
        sourceId: owner.sourceId,
        lineIndex: nearestLineIndex,
        segmentIndex: placement.segmentIndex,
        text: String(segment.text || ''),
        sourceStart: Number.isFinite(Number(segment.sourceStart)) ? Number(segment.sourceStart) : undefined,
        sourceEnd: Number.isFinite(Number(segment.sourceEnd)) ? Number(segment.sourceEnd) : undefined,
        segmentDirection,
        segmentIsShaped,
        ...(glyphHit
            ? glyphHit
            : { reason: segmentIsShaped ? 'shaped-segment-range' : 'missing-character-boundaries' })
    };
}
