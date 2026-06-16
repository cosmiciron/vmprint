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
    PackagerCaretInput,
    PackagerCaretResult,
    PackagerHitTestInput,
    PackagerHitTestResult,
    PackagerSpatialCaretMoveInput
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

type RichTextPointPlacement = {
    box: LayoutBox;
    lines: RendererLine[];
    line: RendererLine;
    lineIndex: number;
    placement: SegmentPlacement;
    localX: number;
    segmentDirection: 'ltr' | 'rtl';
    segmentIsShaped: boolean;
};

type RichTextLineContext = {
    box: LayoutBox;
    line: RendererLine;
    lineIndex: number;
    lineTopY: number;
    effectiveLineHeight: number;
    lineItems: RendererLineItem[];
    lineDirection: 'ltr' | 'rtl';
    lineX: number;
};

type VisualCaretSlot = {
    sourceOffset: number;
    characterIndex: number;
    lineIndex: number;
    segmentIndex: number;
    x: number;
    y: number;
    height: number;
    affinity: 'before' | 'after';
    segmentDirection: 'ltr' | 'rtl';
    segmentIsShaped: boolean;
};

const VISUAL_CARET_POSITION_EPSILON = 0.01;

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

const findGlyphCaretAtPoint = (
    segment: RendererLineSegment,
    localX: number,
    direction: 'ltr' | 'rtl'
): { sourceOffset: number; characterIndex: number; localX: number; affinity: 'before' | 'after' } | null => {
    const glyphs = Array.isArray(segment.glyphs) ? segment.glyphs : [];
    const text = String(segment.text || '');
    const sourceStart = Number.isFinite(Number(segment.sourceStart)) ? Number(segment.sourceStart) : 0;
    const chars = Array.from(text);
    const segmentWidth = Math.max(0, Number(segment.width || 0));

    if (glyphs.length === 0) {
        if (chars.length === 0) {
            return { sourceOffset: sourceStart, characterIndex: 0, localX: 0, affinity: 'before' };
        }
        if (chars.length !== 1) return null;
        const after = localX > segmentWidth / 2;
        return {
            sourceOffset: sourceStart + (after ? 1 : 0),
            characterIndex: after ? 1 : 0,
            localX: after ? segmentWidth : 0,
            affinity: after ? 'after' : 'before'
        };
    }

    const spans = glyphs.map((glyph, index) => {
        const logicalStart = Math.max(0, Math.min(segmentWidth, Number(glyph.x || 0)));
        const next = glyphs[index + 1];
        const logicalEnd = next
            ? Math.max(logicalStart, Math.min(segmentWidth, Number(next.x || segmentWidth)))
            : segmentWidth;
        const visualStart = direction === 'rtl'
            ? Math.max(0, segmentWidth - logicalEnd)
            : logicalStart;
        const visualEnd = direction === 'rtl'
            ? Math.max(0, segmentWidth - logicalStart)
            : logicalEnd;
        return {
            index,
            char: String(glyph.char || chars[index] || ''),
            x0: Math.min(visualStart, visualEnd),
            x1: Math.max(visualStart, visualEnd)
        };
    });

    let target = spans[0];
    let nearestDistance = distanceToRange(localX, target.x0, target.x1);
    for (const span of spans.slice(1)) {
        const distance = distanceToRange(localX, span.x0, span.x1);
        if (distance < nearestDistance) {
            target = span;
            nearestDistance = distance;
        }
    }

    const isWhitespace = /\s/u.test(target.char);
    const midpoint = (target.x0 + target.x1) / 2;
    const logicalAfter = isWhitespace
        ? (direction === 'rtl' ? localX < midpoint : localX >= midpoint)
        : true;
    const characterIndex = Math.max(0, Math.min(chars.length, target.index + (logicalAfter ? 1 : 0)));
    const caretX = direction === 'rtl'
        ? (logicalAfter ? target.x0 : target.x1)
        : (logicalAfter ? target.x1 : target.x0);

    return {
        sourceOffset: sourceStart + characterIndex,
        characterIndex,
        localX: caretX,
        affinity: logicalAfter ? 'after' : 'before'
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

const resolveRichTextLineContext = (
    box: LayoutBox,
    lineIndex: number,
    runtime: TextHitRuntime = {}
): RichTextLineContext | null => {
    const lines = Array.isArray(box.lines) ? box.lines as RendererLine[] : [];
    if (lines.length === 0) return null;

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

    const resolvedLineIndex = Math.max(0, Math.min(lines.length - 1, Math.floor(Number(lineIndex || 0))));

    const line = lines[resolvedLineIndex];
    if (!Array.isArray(line) || line.length === 0) return null;

    const effectiveLineHeight = paragraphMetrics.lineMetrics[resolvedLineIndex]?.effectiveLineHeight
        ?? paragraphMetrics.uniformLineHeight;
    const lineOffset = lineFrame.getLineOffset(resolvedLineIndex);
    const lineWidthLimit = lineFrame.getLineWidth(resolvedLineIndex);
    const lineOriginX = contentFrame.x + lineOffset;
    const lineTopY = lineFrame.getLineY(resolvedLineIndex) ?? (
        contentFrame.y
        + paragraphMetrics.lineMetrics
            .slice(0, resolvedLineIndex)
            .reduce((sum, metric) => sum + (metric?.effectiveLineHeight ?? paragraphMetrics.uniformLineHeight), 0)
    );
    const lineWidth = computeLineWidth(line);
    const adjustedLineWidth = lineWidth - (letterSpacing || 0);
    const lineDirection = paragraphDirection;
    const lineX = computeAlignedLineX(
        resolvedLineIndex,
        lineDirection,
        lineOriginX,
        lineWidthLimit,
        textIndent,
        align,
        adjustedLineWidth
    );
    const justifyExtraAfter = computeJustifyExtraAfter(
        line,
        resolvedLineIndex,
        lines.length,
        align,
        justifyEngine,
        lineWidthLimit,
        lineWidth
    );
    const rawItems = line.map((segment, index) => ({ seg: segment, extra: justifyExtraAfter[index] || 0 }));
    const lineItems = reorderItemsForVisualBidi(rawItems, lineDirection);

    return {
        box,
        line,
        lineIndex: resolvedLineIndex,
        lineTopY,
        effectiveLineHeight,
        lineItems,
        lineDirection,
        lineX
    };
};

const resolveRichTextPointPlacement = (
    input: PackagerHitTestInput,
    runtime: TextHitRuntime = {}
): RichTextPointPlacement | null => {
    const box: LayoutBox = input.box;
    const lines = Array.isArray(box.lines) ? box.lines as RendererLine[] : [];
    if (lines.length === 0) return null;

    const style: ElementStyle = box.style || {};
    const layout = runtime.layout || {};
    const fontSize = Number(style.fontSize || layout.fontSize || 12);
    const lineHeight = Number(style.lineHeight || layout.lineHeight || 1.2);
    const contentFrame = resolveTextContentFrame(box, style);
    const lineFrame = createLineFrameAccessors(box.properties, contentFrame.y, contentFrame.width);
    const paragraphMetrics = buildParagraphMetrics(lines, fontSize, lineHeight, {
        mode: layout.lineHeightMode,
        adjustment: layout.lineHeightAdjustment
    });

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

    const lineContext = resolveRichTextLineContext(box, nearestLineIndex, runtime);
    if (!lineContext) return null;

    const placement = findSegmentPlacement(
        lineContext.line,
        lineContext.lineItems,
        lineContext.lineDirection,
        input.pagePoint.x,
        lineContext.lineTopY,
        lineContext.effectiveLineHeight,
        lineContext.lineX
    );
    if (!placement) return null;

    const segment = placement.segment;
    const localX = Math.max(0, Math.min(placement.w, input.pagePoint.x - placement.x));
    const segmentDirection = segment.direction === 'rtl' ? 'rtl' : 'ltr';
    const segmentIsShaped = Array.isArray(segment.shapedGlyphs) && segment.shapedGlyphs.length > 0 && segmentDirection === 'rtl';

    return {
        box,
        lines,
        line: lineContext.line,
        lineIndex: lineContext.lineIndex,
        placement,
        localX,
        segmentDirection,
        segmentIsShaped
    };
};

const buildVisualCaretSlotsForPlacement = (
    placement: SegmentPlacement,
    lineIndex: number,
    lineTopY: number,
    effectiveLineHeight: number
): VisualCaretSlot[] => {
    const segment = placement.segment;
    const segmentDirection = segment.direction === 'rtl' ? 'rtl' : 'ltr';
    const segmentIsShaped = Array.isArray(segment.shapedGlyphs) && segment.shapedGlyphs.length > 0 && segmentDirection === 'rtl';
    if (segmentIsShaped) return [];

    const glyphs = Array.isArray(segment.glyphs) ? segment.glyphs : [];
    const text = String(segment.text || '');
    const chars = Array.from(text);
    const sourceStart = Number.isFinite(Number(segment.sourceStart)) ? Number(segment.sourceStart) : 0;
    const segmentWidth = Math.max(0, Number(segment.width || placement.w || 0));
    if (glyphs.length === 0) {
        if (chars.length === 0) {
            return [{
                sourceOffset: sourceStart,
                characterIndex: 0,
                lineIndex,
                segmentIndex: placement.segmentIndex,
                x: placement.x,
                y: lineTopY,
                height: effectiveLineHeight,
                affinity: 'before',
                segmentDirection,
                segmentIsShaped: false
            }];
        }
        if (chars.length !== 1) return [];
        return [
            {
                sourceOffset: sourceStart,
                characterIndex: 0,
                lineIndex,
                segmentIndex: placement.segmentIndex,
                x: placement.x,
                y: lineTopY,
                height: effectiveLineHeight,
                affinity: 'before',
                segmentDirection,
                segmentIsShaped: false
            },
            {
                sourceOffset: sourceStart + 1,
                characterIndex: 1,
                lineIndex,
                segmentIndex: placement.segmentIndex,
                x: placement.x + segmentWidth,
                y: lineTopY,
                height: effectiveLineHeight,
                affinity: 'after',
                segmentDirection,
                segmentIsShaped: false
            }
        ];
    }

    const slots: VisualCaretSlot[] = [];
    for (let index = 0; index < glyphs.length; index += 1) {
        const glyph = glyphs[index];
        const logicalStart = Math.max(0, Math.min(segmentWidth, Number(glyph.x || 0)));
        const next = glyphs[index + 1];
        const logicalEnd = next
            ? Math.max(logicalStart, Math.min(segmentWidth, Number(next.x || segmentWidth)))
            : segmentWidth;
        const visualStart = segmentDirection === 'rtl'
            ? Math.max(0, segmentWidth - logicalEnd)
            : logicalStart;
        const visualEnd = segmentDirection === 'rtl'
            ? Math.max(0, segmentWidth - logicalStart)
            : logicalEnd;
        const x0 = placement.x + Math.min(visualStart, visualEnd);
        const x1 = placement.x + Math.max(visualStart, visualEnd);
        slots.push({
            sourceOffset: sourceStart + index,
            characterIndex: index,
            lineIndex,
            segmentIndex: placement.segmentIndex,
            x: segmentDirection === 'rtl' ? x1 : x0,
            y: lineTopY,
            height: effectiveLineHeight,
            affinity: 'before',
            segmentDirection,
            segmentIsShaped: false
        });
        slots.push({
            sourceOffset: sourceStart + index + 1,
            characterIndex: index + 1,
            lineIndex,
            segmentIndex: placement.segmentIndex,
            x: segmentDirection === 'rtl' ? x0 : x1,
            y: lineTopY,
            height: effectiveLineHeight,
            affinity: 'after',
            segmentDirection,
            segmentIsShaped: false
        });
    }
    return slots;
};

const buildVisualCaretSlotsForLine = (lineContext: RichTextLineContext): VisualCaretSlot[] => {
    let currentX = lineContext.lineX;
    const slots: VisualCaretSlot[] = [];
    for (const item of lineContext.lineItems) {
        const segmentWidth = Math.max(0, Number(item.seg.width || 0));
        if (lineContext.lineDirection === 'rtl') currentX -= segmentWidth;
        const placement: SegmentPlacement = {
            segment: item.seg,
            segmentIndex: resolveSegmentIndex(lineContext.line, item.seg),
            x: currentX,
            y: lineContext.lineTopY,
            w: segmentWidth,
            h: lineContext.effectiveLineHeight
        };
        slots.push(...buildVisualCaretSlotsForPlacement(
            placement,
            lineContext.lineIndex,
            lineContext.lineTopY,
            lineContext.effectiveLineHeight
        ));
        if (lineContext.lineDirection === 'rtl') {
            currentX -= item.extra;
        } else {
            currentX += segmentWidth + item.extra;
        }
    }

    return slots.sort((a, b) => a.x - b.x || a.sourceOffset - b.sourceOffset);
};

const pickVisualSlotAtPosition = (
    slots: VisualCaretSlot[],
    direction: PackagerSpatialCaretMoveInput['direction']
): VisualCaretSlot => {
    if (slots.length === 1) return slots[0];
    const sorted = [...slots].sort((a, b) => a.sourceOffset - b.sourceOffset);
    if (direction === 'inlineForward') {
        return sorted.some((slot) => slot.segmentDirection === 'rtl')
            ? sorted[0]
            : sorted[sorted.length - 1];
    }
    return sorted.some((slot) => slot.segmentDirection === 'rtl')
        ? sorted[sorted.length - 1]
        : sorted[0];
};

const collapseVisualCaretSlots = (
    slots: VisualCaretSlot[],
    direction: PackagerSpatialCaretMoveInput['direction']
): VisualCaretSlot[] => {
    const collapsed: VisualCaretSlot[] = [];
    let group: VisualCaretSlot[] = [];

    for (const slot of slots) {
        const anchor = group[0];
        if (!anchor || Math.abs(anchor.x - slot.x) <= VISUAL_CARET_POSITION_EPSILON) {
            group.push(slot);
            continue;
        }
        collapsed.push(pickVisualSlotAtPosition(group, direction));
        group = [slot];
    }
    if (group.length > 0) collapsed.push(pickVisualSlotAtPosition(group, direction));
    return collapsed;
};

const toCaretResult = (slot: VisualCaretSlot, owner: TextHitOwner): PackagerCaretResult => ({
    kind: 'caret',
    actorId: owner.actorId,
    sourceId: owner.sourceId,
    sourceOffset: slot.sourceOffset,
    lineIndex: slot.lineIndex,
    segmentIndex: slot.segmentIndex,
    x: slot.x,
    y: slot.y,
    height: slot.height,
    affinity: slot.affinity,
    segmentDirection: slot.segmentDirection,
    segmentIsShaped: slot.segmentIsShaped
});

const translateVisualCaretSlot = (slot: VisualCaretSlot, deltaX: number, deltaY: number): VisualCaretSlot => ({
    ...slot,
    x: slot.x + deltaX,
    y: slot.y + deltaY
});

export function hitTestRichTextBox(
    input: PackagerHitTestInput,
    owner: TextHitOwner,
    runtime: TextHitRuntime = {}
): PackagerHitTestResult | null {
    const resolved = resolveRichTextPointPlacement(input, runtime);
    if (!resolved) {
        return { kind: 'box', actorId: owner.actorId, sourceId: owner.sourceId, reason: 'no-text-segment' };
    }

    const segment = resolved.placement.segment;
    const glyphHit = resolved.segmentIsShaped
        ? null
        : findGlyphCharacterAtPoint(segment, resolved.localX, resolved.segmentDirection);
    return {
        kind: 'text',
        actorId: owner.actorId,
        sourceId: owner.sourceId,
        lineIndex: resolved.lineIndex,
        segmentIndex: resolved.placement.segmentIndex,
        text: String(segment.text || ''),
        sourceStart: Number.isFinite(Number(segment.sourceStart)) ? Number(segment.sourceStart) : undefined,
        sourceEnd: Number.isFinite(Number(segment.sourceEnd)) ? Number(segment.sourceEnd) : undefined,
        segmentDirection: resolved.segmentDirection,
        segmentIsShaped: resolved.segmentIsShaped,
        ...(glyphHit
            ? glyphHit
            : { reason: resolved.segmentIsShaped ? 'shaped-segment-range' : 'missing-character-boundaries' })
    };
}

export function resolveCaretInRichTextBox(
    input: PackagerCaretInput,
    owner: TextHitOwner,
    runtime: TextHitRuntime = {}
): PackagerCaretResult | null {
    const resolved = resolveRichTextPointPlacement(input, runtime);
    if (!resolved) return null;
    if (resolved.segmentIsShaped) {
        return {
            kind: 'caret',
            actorId: owner.actorId,
            sourceId: owner.sourceId,
            sourceOffset: Number.isFinite(Number(resolved.placement.segment.sourceStart))
                ? Number(resolved.placement.segment.sourceStart)
                : 0,
            lineIndex: resolved.lineIndex,
            segmentIndex: resolved.placement.segmentIndex,
            x: resolved.placement.x,
            y: resolved.placement.y,
            height: resolved.placement.h,
            affinity: 'before',
            segmentDirection: resolved.segmentDirection,
            segmentIsShaped: true,
            reason: 'shaped-segment-caret-unresolved'
        };
    }

    const caret = findGlyphCaretAtPoint(
        resolved.placement.segment,
        resolved.localX,
        resolved.segmentDirection
    );
    if (!caret) return null;

    return {
        kind: 'caret',
        actorId: owner.actorId,
        sourceId: owner.sourceId,
        sourceOffset: caret.sourceOffset,
        lineIndex: resolved.lineIndex,
        segmentIndex: resolved.placement.segmentIndex,
        x: resolved.placement.x + caret.localX,
        y: resolved.placement.y,
        height: resolved.placement.h,
        affinity: caret.affinity,
        segmentDirection: resolved.segmentDirection,
        segmentIsShaped: false
    };
}

const findLineContextForCaret = (
    boxes: LayoutBox[],
    caret: PackagerCaretResult,
    runtime: TextHitRuntime
): { box: LayoutBox; lineContext: RichTextLineContext } | null => {
    for (const box of boxes) {
        const exactLineContext = resolveRichTextLineContext(box, caret.lineIndex, runtime);
        if (exactLineContext) return { box, lineContext: exactLineContext };
    }

    const caretCenterY = Number(caret.y || 0) + Math.max(1, Number(caret.height || 0)) / 2;
    let nearest: { box: LayoutBox; lineContext: RichTextLineContext; distance: number } | null = null;

    for (const box of boxes) {
        const lines = Array.isArray(box.lines) ? box.lines as RendererLine[] : [];
        if (lines.length === 0) continue;
        for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
            const lineContext = resolveRichTextLineContext(box, lineIndex, runtime);
            if (!lineContext) continue;
            const distance = distanceToRange(
                caretCenterY,
                lineContext.lineTopY,
                lineContext.lineTopY + lineContext.effectiveLineHeight
            );
            const lineIndexPenalty = lineContext.lineIndex === caret.lineIndex ? 0 : 0.25;
            const score = distance + lineIndexPenalty;
            if (!nearest || score < nearest.distance) {
                nearest = { box, lineContext, distance: score };
            }
        }
    }

    return nearest ? { box: nearest.box, lineContext: nearest.lineContext } : null;
};

const findCurrentVisualSlotIndex = (slots: VisualCaretSlot[], caret: PackagerCaretResult): number => {
    let nearestIndex = -1;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (let index = 0; index < slots.length; index += 1) {
        const slot = slots[index];
        const sourceTieBreaker = slot.sourceOffset === caret.sourceOffset ? 0 : 0.001;
        const segmentTieBreaker = slot.segmentIndex === caret.segmentIndex ? 0 : 0.0001;
        const distance = Math.abs(slot.x - Number(caret.x || 0))
            + Math.abs(slot.y - Number(caret.y || 0)) * 0.1
            + sourceTieBreaker
            + segmentTieBreaker;
        if (distance < nearestDistance) {
            nearestIndex = index;
            nearestDistance = distance;
        }
    }
    return nearestIndex;
};

const resolveAdjacentLineSlot = (
    box: LayoutBox,
    fromLineIndex: number,
    direction: PackagerSpatialCaretMoveInput['direction'],
    owner: TextHitOwner,
    runtime: TextHitRuntime,
    deltaX: number,
    deltaY: number
): PackagerCaretResult | null => {
    const lines = Array.isArray(box.lines) ? box.lines as RendererLine[] : [];
    const nextLineIndex = direction === 'inlineForward' ? fromLineIndex + 1 : fromLineIndex - 1;
    if (nextLineIndex < 0 || nextLineIndex >= lines.length) return null;

    const nextLineContext = resolveRichTextLineContext(box, nextLineIndex, runtime);
    if (!nextLineContext) return null;
    const nextSlots = collapseVisualCaretSlots(buildVisualCaretSlotsForLine(nextLineContext), direction);
    if (nextSlots.length === 0) return null;
    const slot = direction === 'inlineForward'
        ? nextSlots[0]
        : nextSlots[nextSlots.length - 1];
    return toCaretResult(translateVisualCaretSlot(slot, deltaX, deltaY), owner);
};

const resolveBlockLineSlot = (
    box: LayoutBox,
    fromLineIndex: number,
    direction: PackagerSpatialCaretMoveInput['direction'],
    owner: TextHitOwner,
    runtime: TextHitRuntime,
    targetX: number,
    deltaX: number,
    deltaY: number
): PackagerCaretResult | null => {
    const lines = Array.isArray(box.lines) ? box.lines as RendererLine[] : [];
    const nextLineIndex = direction === 'blockForward' ? fromLineIndex + 1 : fromLineIndex - 1;
    if (nextLineIndex < 0 || nextLineIndex >= lines.length) return null;

    const nextLineContext = resolveRichTextLineContext(box, nextLineIndex, runtime);
    if (!nextLineContext) return null;
    const nextSlots = collapseVisualCaretSlots(buildVisualCaretSlotsForLine(nextLineContext), direction);
    if (nextSlots.length === 0) return null;

    let nearest = nextSlots[0];
    let nearestDistance = Math.abs((nearest.x + deltaX) - targetX);
    for (const slot of nextSlots.slice(1)) {
        const distance = Math.abs((slot.x + deltaX) - targetX);
        if (distance < nearestDistance) {
            nearest = slot;
            nearestDistance = distance;
        }
    }
    return toCaretResult(translateVisualCaretSlot(nearest, deltaX, deltaY), owner);
};

export function resolveSpatialCaretMoveInRichTextBoxes(
    input: PackagerSpatialCaretMoveInput,
    boxes: LayoutBox[],
    owner: TextHitOwner,
    runtime: TextHitRuntime = {}
): PackagerCaretResult | null {
    if (
        input.direction !== 'inlineForward'
        && input.direction !== 'inlineBackward'
        && input.direction !== 'blockForward'
        && input.direction !== 'blockBackward'
    ) return null;
    const match = findLineContextForCaret(boxes, input.caret, runtime);
    if (!match) return null;

    const slots = collapseVisualCaretSlots(buildVisualCaretSlotsForLine(match.lineContext), input.direction);
    if (slots.length === 0) return null;

    const currentIndex = findCurrentVisualSlotIndex(slots, input.caret);
    if (currentIndex < 0) return null;
    const currentSlot = slots[currentIndex];
    const deltaX = Number(input.caret.x || 0) - currentSlot.x;
    const deltaY = Number(input.caret.y || 0) - currentSlot.y;
    if (input.direction === 'blockForward' || input.direction === 'blockBackward') {
        return resolveBlockLineSlot(
            match.box,
            match.lineContext.lineIndex,
            input.direction,
            owner,
            runtime,
            Number(input.caret.x || 0),
            deltaX,
            deltaY
        );
    }

    const nextIndex = input.direction === 'inlineForward'
        ? currentIndex + 1
        : currentIndex - 1;
    const nextSlot = slots[nextIndex];
    if (nextSlot) return toCaretResult(translateVisualCaretSlot(nextSlot, deltaX, deltaY), owner);

    return resolveAdjacentLineSlot(
        match.box,
        match.lineContext.lineIndex,
        input.direction,
        owner,
        runtime,
        deltaX,
        deltaY
    );
}
