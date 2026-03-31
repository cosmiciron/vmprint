import type { Box, BoxMeta, ElementStyle, LayoutConfig, Page } from './types';
import { LayoutUtils } from './layout/layout-utils';
import { LAYOUT_DEFAULTS } from './layout/defaults';
import {
    buildParagraphMetrics,
    computeAlignedLineX,
    computeJustifyExtraAfter,
    computeLineWidth,
    createLineFrameAccessors
} from './render/rich-line-layout';
import { reorderItemsForVisualBidi, resolveParagraphDirection } from './render/direction';
import type { RendererBoxProperties, RendererLine, RendererLineItem, RendererLineSegment } from './render/types';

export type VmprintInteractionUnit = {
    absoluteOffset: number;
    lineIndex: number;
    unitIndex: number;
    text: string;
    x0: number;
    x1: number;
    y0: number;
    y1: number;
    segmentKey?: string;
    segmentUnitCount?: number;
    segmentX0?: number;
    segmentX1?: number;
    segmentIsShaped?: boolean;
    segmentLogicalIndex?: number;
    segmentDirection?: 'ltr' | 'rtl';
};

export type VmprintInteractionLine = {
    index: number;
    startOffset: number;
    endOffset: number;
    top: number;
    baseline: number;
    bottom: number;
    left: number;
    right: number;
    direction: 'ltr' | 'rtl';
};

export type VmprintInteractionTarget = {
    targetId: string;
    pageIndex: number;
    sourceId: string;
    engineKey: string;
    sourceType: string;
    selectableText: boolean;
    fragmentIndex: number;
    isContinuation: boolean;
    generated: boolean;
    transformKind?: 'clone' | 'split' | 'morph';
    x: number;
    y: number;
    w: number;
    h: number;
    contentBox: { x: number; y: number; w: number; h: number };
    containerSourceId?: string;
    containerType?: string;
    containerEngineKey?: string;
    totalLength: number;
    units: VmprintInteractionUnit[];
    lines: VmprintInteractionLine[];
};

export type VmprintInteractionPage = {
    index: number;
    width: number;
    height: number;
    targets: VmprintInteractionTarget[];
    flattenedSpans: VmprintInteractionFlattenedSpan[];
};

export type VmprintInteractionFlattenedSpan = {
    order: number;
    pageIndex: number;
    targetId: string;
    sourceId: string;
    selectableText: boolean;
    containerSourceId?: string;
    containerType?: string;
    top: number;
    bottom: number;
    left: number;
    right: number;
};

export type VmprintInteractionSelectionPoint = {
    pageIndex: number;
    targetId: string;
    sourceId: string;
    x: number;
    y: number;
    absoluteOffset: number;
};

export type VmprintInteractionSelectionState = {
    pageIndex: number;
    targetId: string;
    sourceId: string;
    selectedOffsets: number[];
    caretOffset: number;
    caretTargetId?: string;
    targetSelections?: Array<{
        targetId: string;
        sourceId: string;
        selectedOffsets: number[];
    }>;
};

export type VmprintInteractionSelectionMode = 'continuous' | 'spatial';

export type VmprintInteractionCaretRect = {
    x: number;
    y0: number;
    y1: number;
};

export type VmprintInteractionHit = {
    pageIndex: number;
    targetId: string;
    sourceId: string;
    selectableText: boolean;
    containerSourceId?: string;
    containerType?: string;
    point: { x: number; y: number };
};

export type VmprintInteractionOverlayModel = {
    targetId: string;
    sourceId: string;
    frameRect: { x: number; y: number; w: number; h: number };
    selectionRects: Array<{ x: number; y: number; w: number; h: number }>;
    caretRect: VmprintInteractionCaretRect | null;
};

const getSelectionEntries = (
    selection: VmprintInteractionSelectionState | null | undefined
): Array<{ targetId: string; sourceId: string; selectedOffsets: number[] }> => {
    if (!selection) return [];
    if (selection.targetSelections?.length) return selection.targetSelections;
    return [{
        targetId: selection.targetId,
        sourceId: selection.sourceId,
        selectedOffsets: selection.selectedOffsets
    }];
};

const toNumber = (value: unknown, fallback = 0): number => {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
};

const sortUniqueNumbers = (values: number[]): number[] => Array.from(new Set(values)).sort((a, b) => a - b);
const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

const isTextSelectableBox = (box: Box): boolean => {
    const sourceId = String(box.meta?.sourceId || '');
    if (!sourceId) return false;
    return (
        (Array.isArray(box.lines) && box.lines.length > 0)
        || (typeof box.content === 'string' && box.content.length > 0)
        || (Array.isArray(box.glyphs) && box.glyphs.length > 0)
    );
};

const isInteractableBox = (box: Box): boolean => {
    const sourceId = String(box.meta?.sourceId || '');
    if (!sourceId) return false;
    return (
        isTextSelectableBox(box)
        || !!box.image
        || box.type === 'image'
        || box.type === 'box'
    );
};

const buildTargetId = (meta: BoxMeta | undefined, pageIndex: number): string => {
    const engineKey = String(meta?.engineKey || '');
    if (engineKey) return engineKey;
    const sourceId = String(meta?.sourceId || 'unknown');
    const fragmentIndex = Number(meta?.fragmentIndex || 0);
    return `${sourceId}#${fragmentIndex}@${pageIndex}`;
};

const resolveContentBox = (box: Box) => {
    const style = box.style || {};
    const paddingLeft = LayoutUtils.validateUnit(style.paddingLeft ?? style.padding ?? 0);
    const paddingRight = LayoutUtils.validateUnit(style.paddingRight ?? style.padding ?? 0);
    const paddingTop = LayoutUtils.validateUnit(style.paddingTop ?? style.padding ?? 0);
    const paddingBottom = LayoutUtils.validateUnit(style.paddingBottom ?? style.padding ?? 0);
    const borderLeft = LayoutUtils.validateUnit(style.borderLeftWidth ?? style.borderWidth ?? 0);
    const borderRight = LayoutUtils.validateUnit(style.borderRightWidth ?? style.borderWidth ?? 0);
    const borderTop = LayoutUtils.validateUnit(style.borderTopWidth ?? style.borderWidth ?? 0);
    const borderBottom = LayoutUtils.validateUnit(style.borderBottomWidth ?? style.borderWidth ?? 0);

    return {
        x: box.x + paddingLeft + borderLeft,
        y: box.y + paddingTop + borderTop,
        w: Math.max(0, box.w - paddingLeft - paddingRight - borderLeft - borderRight),
        h: Math.max(0, box.h - paddingTop - paddingBottom - borderTop - borderBottom)
    };
};

const buildFallbackUnits = (
    text: string,
    drawX: number,
    lineIndex: number,
    top: number,
    bottom: number,
    absoluteOffsetRef: { value: number },
    width: number,
    segmentMeta?: {
        key: string;
        unitCount: number;
        x0: number;
        x1: number;
        shaped: boolean;
        logicalIndex: number;
        direction: 'ltr' | 'rtl';
    }
): VmprintInteractionUnit[] => {
    const glyphs = Array.from(text || '');
    if (glyphs.length === 0) return [];
    const unitWidth = glyphs.length > 0 ? (width / glyphs.length) : 0;
    return glyphs.map((glyph, unitIndex) => {
        const x0 = drawX + (unitIndex * unitWidth);
        const x1 = unitIndex === glyphs.length - 1 ? (drawX + width) : (x0 + unitWidth);
        const unit: VmprintInteractionUnit = {
            absoluteOffset: absoluteOffsetRef.value,
            lineIndex,
            unitIndex,
            text: glyph,
            x0,
            x1,
            y0: top,
            y1: bottom,
            segmentKey: segmentMeta?.key,
            segmentUnitCount: segmentMeta?.unitCount,
            segmentX0: segmentMeta?.x0,
            segmentX1: segmentMeta?.x1,
            segmentIsShaped: segmentMeta?.shaped,
            segmentLogicalIndex: segmentMeta?.logicalIndex,
            segmentDirection: segmentMeta?.direction
        };
        absoluteOffsetRef.value += 1;
        return unit;
    });
};

const buildGlyphUnits = (
    glyphs: Array<{ char: string; x: number; y: number }>,
    drawX: number,
    lineIndex: number,
    top: number,
    bottom: number,
    absoluteOffsetRef: { value: number },
    segmentWidth: number,
    segmentMeta?: {
        key: string;
        unitCount: number;
        x0: number;
        x1: number;
        shaped: boolean;
        logicalIndex: number;
        direction: 'ltr' | 'rtl';
    }
): VmprintInteractionUnit[] => {
    if (!Array.isArray(glyphs) || glyphs.length === 0) return [];

    return glyphs.map((glyph, unitIndex) => {
        const start = drawX + toNumber(glyph.x, 0);
        const next = glyphs[unitIndex + 1];
        const fallbackEnd = drawX + segmentWidth;
        const end = next
            ? Math.max(start, drawX + toNumber(next.x, segmentWidth))
            : fallbackEnd;
        const unit: VmprintInteractionUnit = {
            absoluteOffset: absoluteOffsetRef.value,
            lineIndex,
            unitIndex,
            text: String(glyph.char || ''),
            x0: start,
            x1: end,
            y0: top,
            y1: bottom,
            segmentKey: segmentMeta?.key,
            segmentUnitCount: segmentMeta?.unitCount,
            segmentX0: segmentMeta?.x0,
            segmentX1: segmentMeta?.x1,
            segmentIsShaped: segmentMeta?.shaped,
            segmentLogicalIndex: segmentMeta?.logicalIndex,
            segmentDirection: segmentMeta?.direction
        };
        absoluteOffsetRef.value += 1;
        return unit;
    });
};

const buildSegmentUnits = (
    segment: RendererLineSegment,
    drawX: number,
    lineIndex: number,
    top: number,
    bottom: number,
    absoluteOffsetRef: { value: number },
    segmentMeta?: {
        key: string;
        unitCount: number;
        x0: number;
        x1: number;
        shaped: boolean;
        logicalIndex: number;
        direction: 'ltr' | 'rtl';
    }
): VmprintInteractionUnit[] => {
    const segmentWidth = Math.max(0, toNumber(segment.width, 0));
    if (Array.isArray(segment.glyphs) && segment.glyphs.length > 0) {
        return buildGlyphUnits(segment.glyphs, drawX, lineIndex, top, bottom, absoluteOffsetRef, segmentWidth, segmentMeta);
    }
    return buildFallbackUnits(String(segment.text || ''), drawX, lineIndex, top, bottom, absoluteOffsetRef, segmentWidth, segmentMeta);
};

const buildInteractionTarget = (
    box: Box,
    pageIndex: number,
    layout: LayoutConfig['layout']
): VmprintInteractionTarget | null => {
    if (!isInteractableBox(box)) return null;

    const rendererLines = (box.lines || []) as RendererLine[];
    const boxStyle = box.style || {};
    const contentBox = resolveContentBox(box);
    const baseFontSize = Number(boxStyle.fontSize || layout.fontSize);
    const lineHeight = Number(boxStyle.lineHeight || layout.lineHeight);
    const paragraphMetrics = buildParagraphMetrics(rendererLines, baseFontSize, lineHeight);
    const lineFrame = createLineFrameAccessors((box.properties || {}) as RendererBoxProperties, contentBox.y, contentBox.w);
    const paragraphDirection = resolveParagraphDirection(
        rendererLines,
        boxStyle,
        layout.direction,
        LAYOUT_DEFAULTS.textLayout.direction
    );
    const letterSpacing = LayoutUtils.validateUnit(boxStyle.letterSpacing || 0);
    const textIndent = LayoutUtils.validateUnit(boxStyle.textIndent || 0);
    const align = boxStyle.textAlign;
    const justifyEngine = boxStyle.justifyEngine || layout.justifyEngine || LAYOUT_DEFAULTS.textLayout.justifyEngine;

    const lines: VmprintInteractionLine[] = [];
    const units: VmprintInteractionUnit[] = [];
    const absoluteOffsetRef = { value: 0 };
    let currentY = contentBox.y;

    rendererLines.forEach((line, lineIndex) => {
        if (!Array.isArray(line)) return;

        const metric = paragraphMetrics.lineMetrics[lineIndex];
        const actualLineFontSize = metric?.lineFontSize ?? baseFontSize;
        const referenceAscentScale = metric?.referenceAscentScale ?? paragraphMetrics.paragraphReferenceAscentScale;
        const effectiveLineHeight = paragraphMetrics.paragraphHasInlineObjects
            ? (metric?.effectiveLineHeight ?? paragraphMetrics.uniformLineHeight)
            : paragraphMetrics.uniformLineHeight;
        const nominalLineHeight = actualLineFontSize * lineHeight;
        const nominalLeading = nominalLineHeight - actualLineFontSize;
        const vOffset = nominalLeading / 2;
        const lineOffset = lineFrame.getLineOffset(lineIndex);
        const lineWidthLimit = lineFrame.getLineWidth(lineIndex);
        const lineOriginX = contentBox.x + lineOffset;
        const lineTop = lineFrame.getLineY(lineIndex) ?? currentY;
        const baseline = lineTop + vOffset + (referenceAscentScale * actualLineFontSize);
        const bottom = lineTop + effectiveLineHeight;
        const lineWidth = computeLineWidth(line);
        const adjustedLineWidth = lineWidth - letterSpacing;
        const lineX = computeAlignedLineX(
            lineIndex,
            paragraphDirection,
            lineOriginX,
            lineWidthLimit,
            textIndent,
            align,
            adjustedLineWidth
        );
        const justifyExtraAfter = computeJustifyExtraAfter(
            line,
            lineIndex,
            rendererLines.length,
            align,
            justifyEngine,
            lineWidthLimit,
            lineWidth
        );

        const rawItems: Array<RendererLineItem & { logicalIndex: number }> = line.map((seg, index) => ({
            seg,
            extra: justifyExtraAfter[index] || 0,
            logicalIndex: index
        }));
        const lineItems = reorderItemsForVisualBidi(rawItems, paragraphDirection);

        const lineStartOffset = absoluteOffsetRef.value;
        let currentX = lineX;
        const lineUnits: VmprintInteractionUnit[] = [];

        for (let segmentIndex = 0; segmentIndex < lineItems.length; segmentIndex += 1) {
            const { seg, extra } = lineItems[segmentIndex];
            const segWidth = Math.max(0, toNumber(seg.width, 0));
            if (paragraphDirection === 'rtl') {
                currentX -= segWidth;
            }
            const drawX = currentX;
            const segmentText = String(seg.text || '');
            const segmentUnitCount = Array.from(segmentText).length || seg.glyphs?.length || 0;
            const segmentDirection: 'ltr' | 'rtl' = seg.direction === 'rtl' ? 'rtl' : 'ltr';
            const segmentMeta = {
                key: `${pageIndex}:${buildTargetId(box.meta, pageIndex)}:${lineIndex}:${segmentIndex}`,
                unitCount: segmentUnitCount,
                x0: drawX,
                x1: drawX + segWidth,
                shaped: Array.isArray(seg.shapedGlyphs) && seg.shapedGlyphs.length > 0 && seg.direction === 'rtl',
                logicalIndex: lineItems[segmentIndex].logicalIndex,
                direction: segmentDirection
            };
            lineUnits.push(...buildSegmentUnits(seg, drawX, lineIndex, lineTop, bottom, absoluteOffsetRef, segmentMeta));
            if (paragraphDirection === 'rtl') {
                currentX -= extra;
            } else {
                currentX += segWidth + extra;
            }
        }

        units.push(...lineUnits);

        const left = lineUnits.length > 0
            ? Math.min(...lineUnits.map((unit) => unit.x0))
            : lineX;
        const right = lineUnits.length > 0
            ? Math.max(...lineUnits.map((unit) => unit.x1))
            : lineX;

        lines.push({
            index: lineIndex,
            startOffset: lineStartOffset,
            endOffset: absoluteOffsetRef.value,
            top: lineTop,
            baseline,
            bottom,
            left,
            right,
            direction: paragraphDirection
        });

        if (lineIndex < rendererLines.length - 1) {
            absoluteOffsetRef.value += 1;
        }

        if (lineFrame.hasExplicitLineYOffsets) {
            currentY = Math.max(currentY, bottom);
        } else {
            currentY += effectiveLineHeight;
        }
    });

    const properties = box.properties || {};
    return {
        targetId: buildTargetId(box.meta, pageIndex),
        pageIndex,
        sourceId: String(box.meta?.sourceId || ''),
        engineKey: String(box.meta?.engineKey || ''),
        sourceType: String(box.meta?.sourceType || ''),
        selectableText: isTextSelectableBox(box),
        fragmentIndex: Number(box.meta?.fragmentIndex || 0),
        isContinuation: Boolean(box.meta?.isContinuation),
        generated: Boolean(box.meta?.generated),
        transformKind: box.meta?.transformKind,
        x: Number(box.x || 0),
        y: Number(box.y || 0),
        w: Number(box.w || 0),
        h: Number(box.h || 0),
        contentBox,
        containerSourceId: typeof properties._interactionContainerSourceId === 'string'
            ? properties._interactionContainerSourceId
            : undefined,
        containerType: typeof properties._interactionContainerType === 'string'
            ? properties._interactionContainerType
            : undefined,
        containerEngineKey: typeof properties._interactionContainerEngineKey === 'string'
            ? properties._interactionContainerEngineKey
            : undefined,
        totalLength: absoluteOffsetRef.value,
        units,
        lines
    };
};

const buildFlattenedInteractionSpans = (
    pageIndex: number,
    targets: VmprintInteractionTarget[]
): VmprintInteractionFlattenedSpan[] =>
    sortTargetsInVisualOrder(targets).map((target, order) => ({
        order,
        pageIndex,
        targetId: target.targetId,
        sourceId: target.sourceId,
        selectableText: target.selectableText,
        containerSourceId: target.containerSourceId,
        containerType: target.containerType,
        top: target.y,
        bottom: target.y + target.h,
        left: target.x,
        right: target.x + target.w
    }));

export const buildInteractionPages = (
    pages: readonly Page[],
    layout: LayoutConfig['layout']
): VmprintInteractionPage[] => pages.map((page) => {
    const index = Number(page.index || 0);
    const targets = (page.boxes || [])
        .map((box) => buildInteractionTarget(box, index, layout))
        .filter((target): target is VmprintInteractionTarget => target !== null);
    return {
        index,
        width: Number(page.width || 0),
        height: Number(page.height || 0),
        targets,
        flattenedSpans: buildFlattenedInteractionSpans(index, targets)
    };
});

export const findInteractionTarget = (
    page: VmprintInteractionPage | null | undefined,
    targetId: string | null | undefined
): VmprintInteractionTarget | null => {
    const normalized = String(targetId || '');
    if (!normalized) return null;
    return page?.targets.find((target) => target.targetId === normalized) ?? null;
};

const sortTargetsInVisualOrder = (targets: VmprintInteractionTarget[]): VmprintInteractionTarget[] =>
    [...targets].sort((left, right) => {
        const byY = left.y - right.y;
        if (Math.abs(byY) > 0.5) return byY;
        const byX = left.x - right.x;
        if (Math.abs(byX) > 0.5) return byX;
        return left.targetId.localeCompare(right.targetId);
    });

const getFlattenedTraversalTargets = (page: VmprintInteractionPage): VmprintInteractionTarget[] =>
    page.flattenedSpans
        .map((span) => findInteractionTarget(page, span.targetId))
        .filter((target): target is VmprintInteractionTarget => target !== null);

const getRectDistanceSq = (
    rect: { x: number; y: number; w: number; h: number },
    point: { x: number; y: number }
): number => {
    const nearestX = clamp(point.x, rect.x, rect.x + rect.w);
    const nearestY = clamp(point.y, rect.y, rect.y + rect.h);
    const dx = point.x - nearestX;
    const dy = point.y - nearestY;
    return (dx * dx) + (dy * dy);
};

export const hitTestInteractionTarget = (
    page: VmprintInteractionPage | null | undefined,
    x: number,
    y: number
): VmprintInteractionTarget | null => {
    const targets = page?.targets || [];
    for (let index = targets.length - 1; index >= 0; index -= 1) {
        const target = targets[index];
        if (x >= target.x && x <= target.x + target.w && y >= target.y && y <= target.y + target.h) {
            return target;
        }
    }
    return null;
};

export const hitTestInteraction = (
    page: VmprintInteractionPage | null | undefined,
    x: number,
    y: number
): VmprintInteractionHit | null => {
    const target = hitTestInteractionTarget(page, x, y);
    if (!target) return null;
    return {
        pageIndex: target.pageIndex,
        targetId: target.targetId,
        sourceId: target.sourceId,
        selectableText: target.selectableText,
        containerSourceId: target.containerSourceId,
        containerType: target.containerType,
        point: { x, y }
    };
};

const resolveFocusTarget = (
    page: VmprintInteractionPage,
    anchorTarget: VmprintInteractionTarget,
    point: { x: number; y: number }
): VmprintInteractionTarget => {
    const direct = hitTestInteractionTarget(page, point.x, point.y);
    const group = getFlattenedTraversalTargets(page);
    if (direct && group.some((candidate) => candidate.targetId === direct.targetId)) {
        return direct;
    }
    let nearest = anchorTarget;
    let nearestDistance = getRectDistanceSq(anchorTarget, point);
    for (const candidate of group) {
        const distance = getRectDistanceSq(candidate, point);
        if (distance < nearestDistance) {
            nearest = candidate;
            nearestDistance = distance;
        }
    }
    return nearest;
};

export const getNearestInteractionSelectionOffset = (
    target: VmprintInteractionTarget,
    x: number,
    y: number
): number => {
    if (target.units.length === 0) return 0;
    const lineIndexes = sortUniqueNumbers(target.units.map((unit) => unit.lineIndex));
    let targetLineIndex = lineIndexes[0] || 0;
    let nearestLineDistance = Number.POSITIVE_INFINITY;

    for (const lineIndex of lineIndexes) {
        const line = target.lines.find((candidate) => candidate.index === lineIndex);
        if (!line) continue;
        const lineCenterY = (line.top + line.bottom) / 2;
        const lineDistance =
            y < line.top ? (line.top - y) :
            y > line.bottom ? (y - line.bottom) :
            Math.abs(lineCenterY - y) * 0.25;
        if (lineDistance < nearestLineDistance) {
            nearestLineDistance = lineDistance;
            targetLineIndex = lineIndex;
        }
    }

    const line = target.lines.find((candidate) => candidate.index === targetLineIndex);
    const lineUnits = target.units.filter((unit) => unit.lineIndex === targetLineIndex);
    if (!line || lineUnits.length === 0) return 0;

    const first = lineUnits[0];
    const last = lineUnits[lineUnits.length - 1];

    if (x <= first.x0) return line.startOffset;
    if (x >= last.x1) return line.endOffset;

    for (const unit of lineUnits) {
        const centerX = (unit.x0 + unit.x1) / 2;
        if (x < centerX) return unit.absoluteOffset;
        if (x <= unit.x1) return unit.absoluteOffset + 1;
    }

    return line.endOffset;
};

export const createInteractionSelectionPoint = (
    page: VmprintInteractionPage | null | undefined,
    x: number,
    y: number
): VmprintInteractionSelectionPoint | null => {
    const hit = hitTestInteraction(page, x, y);
    if (!hit) return null;
    const target = findInteractionTarget(page, hit.targetId);
    if (!target) return null;
    return {
        pageIndex: hit.pageIndex,
        targetId: hit.targetId,
        sourceId: hit.sourceId,
        x,
        y,
        absoluteOffset: getNearestInteractionSelectionOffset(target, x, y)
    };
};

export const normalizeInteractionSelectedOffsets = (
    target: VmprintInteractionTarget,
    offsets: number[]
): number[] => {
    const validOffsets = new Set(target.units.map((unit) => unit.absoluteOffset));
    return sortUniqueNumbers(offsets.filter((offset) => validOffsets.has(offset)));
};

export const getSpatiallySelectedInteractionOffsets = (
    target: VmprintInteractionTarget,
    anchor: VmprintInteractionSelectionPoint,
    point: { x: number; y: number }
): number[] => {
    const x0 = Math.min(anchor.x, point.x);
    const y0 = Math.min(anchor.y, point.y) - 4;
    const x1 = Math.max(anchor.x, point.x);
    const y1 = Math.max(anchor.y, point.y) + 4;

    return normalizeInteractionSelectedOffsets(
        target,
        target.units
            .filter((unit) => {
                const centerX = (unit.x0 + unit.x1) / 2;
                const centerY = (unit.y0 + unit.y1) / 2;
                return centerX >= x0 && centerX <= x1 && centerY >= y0 && centerY <= y1;
            })
            .map((unit) => unit.absoluteOffset)
    );
};

export const buildContinuousInteractionOffsets = (
    target: VmprintInteractionTarget,
    anchorOffset: number,
    focusOffset: number
): number[] => {
    const start = Math.max(0, Math.min(anchorOffset, focusOffset));
    const end = Math.max(0, Math.max(anchorOffset, focusOffset));
    const offsets: number[] = [];
    for (let offset = start; offset < end; offset += 1) {
        offsets.push(offset);
    }
    return normalizeInteractionSelectedOffsets(target, offsets);
};

export const getInteractionCaretRect = (
    target: VmprintInteractionTarget,
    offset: number
): VmprintInteractionCaretRect | null => {
    if (target.lines.length === 0) return null;

    for (const line of target.lines) {
        const lineUnits = target.units.filter((unit) => unit.lineIndex === line.index);
        if (lineUnits.length === 0) continue;

        if (offset <= line.startOffset) {
            return { x: lineUnits[0].x0, y0: line.top, y1: line.bottom };
        }
        if (offset <= line.endOffset) {
            const unit = lineUnits.find((candidate) => (candidate.absoluteOffset + 1) >= offset);
            if (!unit) {
                return { x: lineUnits[lineUnits.length - 1].x1, y0: line.top, y1: line.bottom };
            }
            const x = offset <= unit.absoluteOffset ? unit.x0 : unit.x1;
            return { x, y0: line.top, y1: line.bottom };
        }
    }

    const lastLine = target.lines[target.lines.length - 1];
    const lastUnits = target.units.filter((unit) => unit.lineIndex === lastLine.index);
    if (lastUnits.length === 0) return null;
    return { x: lastUnits[lastUnits.length - 1].x1, y0: lastLine.top, y1: lastLine.bottom };
};

export const buildInteractionSelectionRects = (
    target: VmprintInteractionTarget,
    selection: VmprintInteractionSelectionState | null | undefined
): Array<{ x: number; y: number; w: number; h: number }> => {
    if (!selection || selection.pageIndex !== target.pageIndex) {
        return [];
    }

    const targetSelection = selection.targetSelections?.find((entry) => entry.targetId === target.targetId);
    const offsets = new Set(targetSelection?.selectedOffsets ?? (
        selection.targetId === target.targetId ? selection.selectedOffsets : []
    ));
    const rects: Array<{ x: number; y: number; w: number; h: number }> = [];

    for (const line of target.lines) {
        const selectedLineUnits = target.units
            .filter((unit) => unit.lineIndex === line.index && offsets.has(unit.absoluteOffset))
            .sort((a, b) => a.x0 - b.x0);
        if (selectedLineUnits.length === 0) continue;

        const lineUnitsBySegment = new Map<string, VmprintInteractionUnit[]>();
        for (const unit of target.units.filter((candidate) => candidate.lineIndex === line.index && candidate.segmentKey)) {
            const key = String(unit.segmentKey);
            const bucket = lineUnitsBySegment.get(key);
            if (bucket) {
                bucket.push(unit);
            } else {
                lineUnitsBySegment.set(key, [unit]);
            }
        }

        const mergedLineUnits: Array<{ x0: number; x1: number; y0: number; y1: number; absoluteOffset: number }> = [];
        let index = 0;
        while (index < selectedLineUnits.length) {
            const unit = selectedLineUnits[index];
            if (unit.segmentIsShaped && unit.segmentKey) {
                const sameSegmentSelected = selectedLineUnits.filter((candidate) => candidate.segmentKey === unit.segmentKey);
                const sameSegmentAll = lineUnitsBySegment.get(unit.segmentKey) || sameSegmentSelected;
                const fullySelected =
                    sameSegmentAll.length > 0 &&
                    sameSegmentSelected.length === sameSegmentAll.length;
                mergedLineUnits.push({
                    x0: fullySelected ? (unit.segmentX0 ?? sameSegmentSelected[0].x0) : Math.min(...sameSegmentSelected.map((candidate) => candidate.x0)),
                    x1: fullySelected ? (unit.segmentX1 ?? sameSegmentSelected[sameSegmentSelected.length - 1].x1) : Math.max(...sameSegmentSelected.map((candidate) => candidate.x1)),
                    y0: Math.min(...sameSegmentSelected.map((candidate) => candidate.y0)),
                    y1: Math.max(...sameSegmentSelected.map((candidate) => candidate.y1)),
                    absoluteOffset: Math.min(...sameSegmentSelected.map((candidate) => candidate.absoluteOffset))
                });
                index += sameSegmentSelected.length;
                continue;
            }
            mergedLineUnits.push({
                x0: unit.x0,
                x1: unit.x1,
                y0: unit.y0,
                y1: unit.y1,
                absoluteOffset: unit.absoluteOffset
            });
            index += 1;
        }

        let current = {
            x: mergedLineUnits[0].x0,
            y: mergedLineUnits[0].y0,
            w: Math.max(1, mergedLineUnits[0].x1 - mergedLineUnits[0].x0),
            h: Math.max(1, mergedLineUnits[0].y1 - mergedLineUnits[0].y0)
        };

        for (let index = 1; index < mergedLineUnits.length; index += 1) {
            const unit = mergedLineUnits[index];
            const gap = unit.x0 - (current.x + current.w);
            const previousUnit = mergedLineUnits[index - 1];
            const visuallyContiguous = gap <= 1.5;
            const logicallyContiguous = unit.absoluteOffset <= (previousUnit.absoluteOffset + 1);
            if (visuallyContiguous || logicallyContiguous) {
                current.w = Math.max(1, unit.x1 - current.x);
                current.h = Math.max(current.h, unit.y1 - current.y);
                continue;
            }
            rects.push(current);
            current = {
                x: unit.x0,
                y: unit.y0,
                w: Math.max(1, unit.x1 - unit.x0),
                h: Math.max(1, unit.y1 - unit.y0)
            };
        }

        rects.push(current);
    }

    return rects;
};

export const resolveInteractionSelection = (
    page: VmprintInteractionPage | null | undefined,
    anchor: VmprintInteractionSelectionPoint | null | undefined,
    focusPoint: { x: number; y: number },
    mode: VmprintInteractionSelectionMode = 'continuous'
): VmprintInteractionSelectionState | null => {
    if (!page || !anchor) return null;
    const anchorTarget = findInteractionTarget(page, anchor.targetId);
    if (!anchorTarget) return null;
    const focusTarget = resolveFocusTarget(page, anchorTarget, focusPoint);
    const caretOffset = getNearestInteractionSelectionOffset(focusTarget, focusPoint.x, focusPoint.y);

    if (mode === 'spatial' || focusTarget.targetId === anchorTarget.targetId) {
        const selectedOffsets = mode === 'spatial'
            ? getSpatiallySelectedInteractionOffsets(anchorTarget, anchor, focusPoint)
            : buildContinuousInteractionOffsets(anchorTarget, anchor.absoluteOffset, caretOffset);
        return {
            pageIndex: anchor.pageIndex,
            targetId: anchor.targetId,
            sourceId: anchor.sourceId,
            selectedOffsets,
            caretOffset,
            caretTargetId: focusTarget.targetId,
            targetSelections: [{
                targetId: anchorTarget.targetId,
                sourceId: anchorTarget.sourceId,
                selectedOffsets
            }]
        };
    }

    const group = getFlattenedTraversalTargets(page);
    const anchorIndex = group.findIndex((target) => target.targetId === anchorTarget.targetId);
    const focusIndex = group.findIndex((target) => target.targetId === focusTarget.targetId);
    if (anchorIndex < 0 || focusIndex < 0) return null;

    const forward = focusIndex >= anchorIndex;
    const startIndex = Math.min(anchorIndex, focusIndex);
    const endIndex = Math.max(anchorIndex, focusIndex);
    const targetSelections = group.slice(startIndex, endIndex + 1).map((target, relativeIndex, slice) => {
        const isFirst = relativeIndex === 0;
        const isLast = relativeIndex === slice.length - 1;
        let selectedOffsets: number[];

        if (forward) {
            if (isFirst) {
                selectedOffsets = buildContinuousInteractionOffsets(target, anchor.absoluteOffset, target.totalLength);
            } else if (isLast) {
                selectedOffsets = buildContinuousInteractionOffsets(target, 0, caretOffset);
            } else {
                selectedOffsets = normalizeInteractionSelectedOffsets(
                    target,
                    target.units.map((unit) => unit.absoluteOffset)
                );
            }
        } else {
            if (isFirst) {
                selectedOffsets = buildContinuousInteractionOffsets(target, 0, caretOffset);
            } else if (isLast) {
                selectedOffsets = buildContinuousInteractionOffsets(target, anchor.absoluteOffset, target.totalLength);
            } else {
                selectedOffsets = normalizeInteractionSelectedOffsets(
                    target,
                    target.units.map((unit) => unit.absoluteOffset)
                );
            }
        }

        return {
            targetId: target.targetId,
            sourceId: target.sourceId,
            selectedOffsets
        };
    });

    return {
        pageIndex: anchor.pageIndex,
        targetId: anchorTarget.targetId,
        sourceId: anchor.sourceId,
        selectedOffsets: targetSelections.find((entry) => entry.targetId === anchorTarget.targetId)?.selectedOffsets ?? [],
        caretOffset,
        caretTargetId: focusTarget.targetId,
        targetSelections
    };
};

export const buildInteractionOverlayModel = (
    page: VmprintInteractionPage | null | undefined,
    selection: VmprintInteractionSelectionState | null | undefined,
    selectedTargetId?: string | null
): VmprintInteractionOverlayModel | null => {
    const targetId = String(selectedTargetId || selection?.targetId || '');
    if (!page || !targetId) return null;
    const target = findInteractionTarget(page, targetId);
    if (!target) return null;
    const caretTarget = selection?.caretTargetId
        ? findInteractionTarget(page, selection.caretTargetId)
        : target;
    return {
        targetId: target.targetId,
        sourceId: target.sourceId,
        frameRect: { x: target.x, y: target.y, w: target.w, h: target.h },
        selectionRects: selection?.targetSelections?.length
            ? selection.targetSelections.flatMap((entry) => {
                const selectionTarget = findInteractionTarget(page, entry.targetId);
                if (!selectionTarget) return [];
                return buildInteractionSelectionRects(selectionTarget, selection);
            })
            : buildInteractionSelectionRects(target, selection),
        caretRect: selection && caretTarget ? getInteractionCaretRect(caretTarget, selection.caretOffset) : null
    };
};

export const serializeInteractionSelectionText = (
    page: VmprintInteractionPage | null | undefined,
    selection: VmprintInteractionSelectionState | null | undefined
): string => {
    if (!page || !selection) return '';

    const chunks: string[] = [];
    for (const entry of getSelectionEntries(selection)) {
        const target = findInteractionTarget(page, entry.targetId);
        if (!target || entry.selectedOffsets.length === 0) continue;

        const selectedOffsets = new Set(entry.selectedOffsets);
        const lineChunks: string[] = [];

        for (const line of target.lines) {
            const selectedLineUnits = target.units
                .filter((unit) => unit.lineIndex === line.index && selectedOffsets.has(unit.absoluteOffset));
            if (selectedLineUnits.length === 0) continue;

            const bySegment = new Map<string, VmprintInteractionUnit[]>();
            for (const unit of selectedLineUnits) {
                const key = unit.segmentKey || `${unit.lineIndex}:${unit.segmentLogicalIndex ?? 0}`;
                const bucket = bySegment.get(key);
                if (bucket) bucket.push(unit);
                else bySegment.set(key, [unit]);
            }

            const lineText = [...bySegment.values()]
                .sort((left, right) => {
                    const leftIndex = left[0]?.segmentLogicalIndex ?? 0;
                    const rightIndex = right[0]?.segmentLogicalIndex ?? 0;
                    return leftIndex - rightIndex;
                })
                .map((segmentUnits) => {
                    const direction = segmentUnits[0]?.segmentDirection || 'ltr';
                    const orderedUnits = [...segmentUnits].sort((left, right) => (
                        direction === 'rtl'
                            ? right.x0 - left.x0
                            : left.x0 - right.x0
                    ));
                    return orderedUnits.map((unit) => unit.text).join('');
                })
                .join('');
            if (lineText) lineChunks.push(lineText);
        }

        if (lineChunks.length > 0) {
            chunks.push(lineChunks.join('\n'));
        }
    }

    return chunks.join('\n');
};
