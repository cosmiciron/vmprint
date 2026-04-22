import type { Box, Element, ElementStyle, RichLine } from '../types';
import type { LayoutProcessor } from './layout-core';
import type { FlowBox } from './layout-core-types';
import { LayoutUtils } from './layout-utils';
import type { ResolvedMicroLanePolicy } from './micro-lane-policy';
import type { SpatialMap } from './packagers/spatial-map';
import { resolveSpatialFieldOverflow } from './packagers/spatial-field-capability';

export type SpatialFieldTextPlacement = {
    flowBox: FlowBox;
    box: Box;
    lines: RichLine[];
    lineOffsets: number[];
    lineWidths: number[];
    lineSlotWidths: number[];
    lineYOffsets: number[];
    contentHeight: number;
    insetV: number;
    marginTop: number;
    marginBottom: number;
    uniformLineHeight: number;
    elementStartY: number;
};

type ContainmentInterval = {
    x: number;
    w: number;
    touchesLeft?: boolean;
    touchesRight?: boolean;
};

type ResolvedContainmentSlot = {
    width: number;
    xOffset: number;
    yOffset: number;
    anchor?: 'left' | 'right' | 'center';
};

type SpatialFieldReflowOptions = {
    processor: LayoutProcessor;
    element: Element;
    path: number[];
    sourceFlowBox?: FlowBox;
    availableWidth: number;
    currentY: number;
    layoutBefore: number;
    spatialMap: SpatialMap;
    xOffset?: number;
    leftMargin?: number;
    pageIndex?: number;
    worldY?: number;
    opticalUnderhang?: boolean;
    clearTopBeforeStart?: boolean;
    minUsableSlotWidth?: number;
    rejectSubMinimumSlots?: boolean;
    microLanePolicy?: ResolvedMicroLanePolicy;
};

/**
 * Reflow one ordinary text actor against an already-populated spatial field.
 *
 * This sits below individual hosts: story/zone/etc. supply the spatial map,
 * cursor policy, and coordinates, while the actual scanline decomposition and
 * reassembly of the actor stays in one place.
 */
export function reflowTextElementAgainstSpatialField(options: SpatialFieldReflowOptions): SpatialFieldTextPlacement | null {
    const anyProcessor = options.processor as any;
    const session = anyProcessor.getCurrentLayoutSession?.() ?? null;
    const colliderStatsBefore = options.spatialMap.getStatsSnapshot();
    const sourceFlowBox = options.sourceFlowBox;
    const flowBox = sourceFlowBox?._materializationMode === 'reflowable'
        ? sourceFlowBox
        : (() => {
            // Contained/excluded text gets rewrapped against the spatial field below, so
            // starting from a normalized reflowable flow box avoids paying for an initial
            // rectangular line-wrap pass that would be thrown away immediately.
            const normalizedFlowBlock = anyProcessor.normalizeFlowBlock?.(options.element, { path: options.path });
            return normalizedFlowBlock
                ? anyProcessor.shapeNormalizedFlowBlock(normalizedFlowBlock) as FlowBox
                : anyProcessor.shapeElement(options.element, { path: options.path }) as FlowBox;
        })();
    if (!flowBox || flowBox._materializationMode !== 'reflowable') return null;

    const style: ElementStyle = flowBox.style || {};
    const authoredStyle = options.element.properties?.style as { zIndex?: unknown } | undefined;
    const queryZIndex = Number.isFinite(Number(style.zIndex))
        ? Number(style.zIndex)
        : (Number.isFinite(Number(authoredStyle?.zIndex)) ? Number(authoredStyle?.zIndex) : 0);
    const fontSize = Number(style.fontSize || anyProcessor.config.layout.fontSize);
    const lineHeightRatio = Number(style.lineHeight || anyProcessor.config.layout.lineHeight);
    const uniformLH = lineHeightRatio * fontSize;
    const nominalTextBandHeight = Math.max(1, fontSize);
    const nominalLeading = Math.max(0, uniformLH - nominalTextBandHeight);
    const containmentBandInset = nominalLeading / 2;
    const font = anyProcessor.resolveMeasurementFontForStyle(style);
    const letterSpacing = Number(style.letterSpacing || 0);
    const textIndent = Number(style.textIndent || 0);
    const richSegments = resolveCachedSpatialRichSegments(anyProcessor, flowBox, options.element, style);
    if (!Array.isArray(richSegments) || richSegments.length === 0) return null;
    const paddingLeft = LayoutUtils.validateUnit(style.paddingLeft ?? style.padding ?? 0);
    const paddingRight = LayoutUtils.validateUnit(style.paddingRight ?? style.padding ?? 0);
    const paddingTop = LayoutUtils.validateUnit(style.paddingTop ?? style.padding ?? 0);
    const paddingBottom = LayoutUtils.validateUnit(style.paddingBottom ?? style.padding ?? 0);
    const borderLeft = LayoutUtils.validateUnit(style.borderLeftWidth ?? style.borderWidth ?? 0);
    const borderRight = LayoutUtils.validateUnit(style.borderRightWidth ?? style.borderWidth ?? 0);
    const borderTop = LayoutUtils.validateUnit(style.borderTopWidth ?? style.borderWidth ?? 0);
    const borderBottom = LayoutUtils.validateUnit(style.borderBottomWidth ?? style.borderWidth ?? 0);
    const insetLeft = paddingLeft + borderLeft;
    const insetRight = paddingRight + borderRight;
    const insetTop = paddingTop + borderTop;
    const insetBottom = paddingBottom + borderBottom;
    const insetH = insetLeft + insetRight;
    const insetV = insetTop + insetBottom;
    const contentWidth = Math.max(0, options.availableWidth - insetH);
    const spatialDirective = (options.element.properties?.space ?? options.element.properties?.spatialField) as { kind?: string } | undefined;
    const laneMode = spatialDirective?.kind === 'contain' ? 'contain' : 'exclude';
    const expressiveContainment = laneMode === 'contain' && options.microLanePolicy !== 'typography';
    const minUsableSlotWidth = Math.max(0, Number(options.minUsableSlotWidth || 0));
    const rejectSubMinimumSlots = options.rejectSubMinimumSlots !== false && minUsableSlotWidth > 0;
    const explicitContainedHostHeight = laneMode === 'contain'
        ? resolveExplicitContainedHostHeight(flowBox, style, spatialDirective)
        : null;
    const maxVisibleContainedContentHeight = explicitContainedHostHeight !== null
        ? Math.max(0, explicitContainedHostHeight - insetV)
        : null;

    const marginTop = Math.max(0, flowBox.marginTop);
    const marginBottom = Math.max(0, flowBox.marginBottom);
    const cursorBase = options.clearTopBeforeStart
        ? options.spatialMap.topBottomClearY(options.currentY, queryZIndex)
        : options.currentY;
    const elementStartY = cursorBase + Math.max(0, options.layoutBefore);

    let accumulatedYBonus = 0;
    let physicalLineCount = 0;
    const pendingSlots: Array<{
        width: number;
        xOffset: number;
        yOffset: number;
        anchor?: 'left' | 'right' | 'center';
    }> = [];
    let pendingSlotIndex = 0;
    let previousContainmentSlot: ResolvedContainmentSlot | null = null;
    const lineLayoutOut: { widths: number[]; offsets: number[]; yOffsets: number[] } = {
        widths: [], 
        offsets: [],
        yOffsets: []
    };
    const lineSlotWidths: number[] = [];
    const selectedSlotXOffsets: number[] = [];
    const selectedContainmentAnchors: Array<'left' | 'right' | 'center'> = [];
    const resolver = (): { width: number; xOffset: number; yOffset: number } => {
        if (pendingSlotIndex < pendingSlots.length) {
            const slot = pendingSlots[pendingSlotIndex++]!;
            lineSlotWidths.push(slot.width);
            if (laneMode === 'contain') {
                selectedSlotXOffsets.push(slot.xOffset);
                selectedContainmentAnchors.push(slot.anchor ?? 'center');
            }
            return slot;
        }
        if (pendingSlotIndex > 0) {
            pendingSlots.length = 0;
            pendingSlotIndex = 0;
        }

        let lineY = elementStartY + (physicalLineCount * uniformLH) + accumulatedYBonus;
        if (laneMode !== 'contain') {
            while (options.spatialMap.hasTopBottomBlock(lineY, uniformLH, queryZIndex)) {
                const clearY = options.spatialMap.topBottomClearY(lineY, queryZIndex);
                accumulatedYBonus += clearY - lineY;
                lineY = elementStartY + (physicalLineCount * uniformLH) + accumulatedYBonus;
            }
        }

        const yOffset = (physicalLineCount * uniformLH) + accumulatedYBonus;
        const geometryQueryY = laneMode === 'contain'
            ? lineY + insetTop + containmentBandInset
            : lineY;
        const geometryQueryHeight = laneMode === 'contain'
            ? nominalTextBandHeight
            : uniformLH;

        const queryOptions = options.opticalUnderhang ? { opticalUnderhang: true, queryZIndex } : { queryZIndex };
        const rawIntervals = laneMode === 'contain'
            ? options.spatialMap.getOccupiedIntervals(geometryQueryY, geometryQueryHeight, options.availableWidth, queryOptions)
            : options.spatialMap.getAvailableIntervals(lineY, uniformLH, options.availableWidth, queryOptions);
        const containmentInkGuardX = laneMode === 'contain'
            ? resolveContainmentInkGuard(fontSize, letterSpacing, rawIntervals)
            : 0;
        const normalizedIntervals = laneMode === 'contain'
            ? rawIntervals.map((interval): ContainmentInterval => {
                const intervalLeft = Number(interval.x || 0);
                const intervalRight = intervalLeft + Number(interval.w || 0);
                const contentLeft = insetLeft;
                const contentRight = Math.max(contentLeft, options.availableWidth - insetRight);
                const clippedLeft = Math.max(contentLeft, intervalLeft);
                const clippedRight = Math.min(contentRight, intervalRight);
                const guardedLeft = Math.min(clippedRight, clippedLeft + containmentInkGuardX);
                const guardedRight = Math.max(guardedLeft, clippedRight - containmentInkGuardX);
                return {
                    x: guardedLeft - insetLeft,
                    w: Math.max(0, guardedRight - guardedLeft),
                    touchesLeft: clippedLeft <= contentLeft + 0.5,
                    touchesRight: clippedRight >= contentRight - 0.5
                };
            }).filter((interval) => interval.w > 0.5)
            : rawIntervals;
        const intervals = normalizedIntervals.filter((interval) =>
            laneMode === 'contain'
                ? Math.max(0, interval.w) >= minUsableSlotWidth
                : Math.max(0, interval.w - insetH) >= minUsableSlotWidth
        );
        if (laneMode === 'contain' && rawIntervals.length === 0) {
            const maxY = options.spatialMap.maxObstacleBottom();
            if (geometryQueryY + geometryQueryHeight <= maxY + 0.1) {
                accumulatedYBonus += uniformLH;
                return resolver();
            }
        }
        if (rawIntervals.length > 0 && intervals.length === 0 && rejectSubMinimumSlots) {
            const clearY = options.spatialMap.bandClearY(lineY, uniformLH, queryZIndex, options.opticalUnderhang === true);
            if (clearY > lineY) {
                accumulatedYBonus += clearY - lineY;
                return resolver();
            }
        }

        const usableIntervals = intervals.length > 0 ? intervals : normalizedIntervals;
        if (usableIntervals.length === 0) {
            if (laneMode === 'contain') {
                const maxY = options.spatialMap.maxObstacleBottom();
                if (geometryQueryY + geometryQueryHeight <= maxY + 0.1) {
                    accumulatedYBonus += uniformLH;
                    return resolver();
                }
            }
            physicalLineCount++;
            lineSlotWidths.push(contentWidth);
            return { width: contentWidth, xOffset: 0, yOffset };
        }

        const resolvedSlots = laneMode === 'contain'
            ? (usableIntervals as ContainmentInterval[])
                .map((interval) => ({
                    width: Math.max(0, interval.w),
                    xOffset: interval.x,
                    yOffset,
                    anchor: resolveContainmentAnchor(interval)
                }))
            : usableIntervals.map((interval) => ({
                width: Math.max(0, interval.w - insetH),
                xOffset: interval.x,
                yOffset
            }));

        const containmentResolution = laneMode === 'contain'
            ? resolveContainmentSlotsForLine(
                resolvedSlots as ResolvedContainmentSlot[],
                previousContainmentSlot,
                expressiveContainment
            )
            : null;
        const slot = laneMode === 'contain'
            ? containmentResolution!.primary
            : resolvedSlots[0]!;
        if (laneMode === 'contain') {
            if (containmentResolution!.queued.length > 0) {
                for (const queued of containmentResolution!.queued) {
                    pendingSlots.push(queued);
                }
                previousContainmentSlot = null;
            } else {
                previousContainmentSlot = slot;
            }
            selectedSlotXOffsets.push(slot.xOffset);
            selectedContainmentAnchors.push(slot.anchor ?? 'center');
        } else {
            for (let i = 1; i < resolvedSlots.length; i++) {
                pendingSlots.push(resolvedSlots[i]!);
            }
        }
        physicalLineCount++;
        lineSlotWidths.push(slot.width);
        return slot;
    };

    const lines: RichLine[] = anyProcessor.wrapRichSegments(
        richSegments,
        contentWidth,
        font,
        fontSize,
        letterSpacing,
        textIndent,
        resolver,
        lineLayoutOut,
        maxVisibleContainedContentHeight !== null
            ? (_nextLineIndex: number, nextLineLayout: { width: number; xOffset: number; yOffset: number }) => {
                const nextLineTop = Number(nextLineLayout.yOffset || 0);
                const nextLineBottom = nextLineTop + uniformLH;
                return nextLineBottom > maxVisibleContainedContentHeight + 0.1;
            }
            : undefined
    );
    if (!Array.isArray(lines) || lines.length === 0) return null;

    const linesHeight = anyProcessor.calculateLineBlockHeight(lines, style, lineLayoutOut.yOffsets);
    const contentHeight = explicitContainedHostHeight !== null
        ? explicitContainedHostHeight
        : (linesHeight + insetV);
    const colliderStatsAfter = options.spatialMap.getStatsSnapshot();
    recordColliderFieldProfileDelta(session, colliderStatsBefore, colliderStatsAfter);
    if (laneMode === 'contain' && lineLayoutOut.offsets.length === lines.length) {
        for (let index = 0; index < lines.length; index++) {
            const slotWidth = Number(lineLayoutOut.widths[index] || 0);
            const slotOffset = Number(selectedSlotXOffsets[index] ?? lineLayoutOut.offsets[index] ?? 0);
            const anchor = selectedContainmentAnchors[index] ?? 'center';
            const textAlign = style.textAlign || 'left';
            if (textAlign === 'justify') {
                const justifyBoundaryCount = countLineJustifyBoundaries(lines[index]);
                const justifyExtraWidth = measureLineJustifyExtraWidth(lines[index]);
                const perBoundary = justifyBoundaryCount > 0 ? (justifyExtraWidth / justifyBoundaryCount) : 0;
                if (justifyBoundaryCount > 0 && perBoundary > resolveContainmentJustifyBoundaryCap(fontSize, letterSpacing)) {
                    clearLineJustifyAfter(lines[index]);
                    lineLayoutOut.offsets[index] = resolveAnchoredContainmentOffset(
                        slotOffset,
                        slotWidth,
                        measureRenderedRichLineWidth(lines[index], letterSpacing),
                        anchor
                    );
                } else {
                    lineLayoutOut.offsets[index] = slotOffset;
                }
                continue;
            }

            lineLayoutOut.offsets[index] = resolveAnchoredContainmentOffset(
                slotOffset,
                slotWidth,
                measureRenderedRichLineWidth(lines[index], letterSpacing),
                anchor
            );
        }
    }

    return {
        flowBox,
        lines,
        lineOffsets: lineLayoutOut.offsets,
        lineWidths: lineLayoutOut.widths,
        lineSlotWidths,
        lineYOffsets: lineLayoutOut.yOffsets,
        contentHeight,
        insetV,
        marginTop,
        marginBottom,
        uniformLineHeight: uniformLH,
        elementStartY,
        box: {
            type: flowBox.type,
            x: Number(options.leftMargin || 0) + Number(options.xOffset || 0),
            y: elementStartY,
            w: options.availableWidth,
            h: flowBox.heightOverride ?? contentHeight,
            lines,
            style,
            properties: {
                ...(flowBox.properties || {}),
                _lineOffsets: lineLayoutOut.offsets,
                _lineWidths: lineLayoutOut.widths,
                _lineYOffsets: lineLayoutOut.yOffsets,
                _isFirstLine: true,
                _isLastLine: true,
                ...(Number.isFinite(options.worldY) ? { _worldY: Number(options.worldY) } : {})
            },
            meta: flowBox.meta
                ? { ...flowBox.meta, pageIndex: Number(options.pageIndex || 0) }
                : {
                    sourceId: String(options.element.properties?.sourceId || options.element.name || options.element.type || 'element'),
                    engineKey: `reflow:${options.path.join('.')}`,
                    sourceType: String(options.element.type || 'text'),
                    fragmentIndex: 0,
                    isContinuation: false,
                    pageIndex: Number(options.pageIndex || 0)
                }
        }
    };
}

function resolveCachedSpatialRichSegments(
    processor: any,
    flowBox: FlowBox,
    element: Element,
    style: ElementStyle
): any[] {
    const cacheHost = flowBox as FlowBox & {
        _cachedSpatialRichSegments?: any[];
        _cachedSpatialRichSegmentsStyle?: ElementStyle;
        _cachedSpatialRichSegmentsElement?: Element;
    };
    if (
        Array.isArray(cacheHost._cachedSpatialRichSegments)
        && cacheHost._cachedSpatialRichSegmentsStyle === style
        && cacheHost._cachedSpatialRichSegmentsElement === element
    ) {
        return cacheHost._cachedSpatialRichSegments;
    }

    const resolved = processor.getRichSegments(element, style);
    cacheHost._cachedSpatialRichSegments = Array.isArray(resolved) ? resolved : [];
    cacheHost._cachedSpatialRichSegmentsStyle = style;
    cacheHost._cachedSpatialRichSegmentsElement = element;
    return cacheHost._cachedSpatialRichSegments;
}

function resolveContainmentAnchor(interval: ContainmentInterval): 'left' | 'right' | 'center' {
    const touchesLeft = interval.touchesLeft === true;
    const touchesRight = interval.touchesRight === true;
    if (touchesLeft && !touchesRight) return 'left';
    if (touchesRight && !touchesLeft) return 'right';
    return 'center';
}

function resolvePreferredContainmentSlot(
    slots: ResolvedContainmentSlot[],
    previousSlot: ResolvedContainmentSlot | null
): ResolvedContainmentSlot {
    if (slots.length <= 1) {
        return slots[0]!;
    }

    if (!previousSlot) {
        return slots
            .slice()
            .sort((a, b) => {
                const widthDelta = Number(b.width || 0) - Number(a.width || 0);
                if (Math.abs(widthDelta) > 0.01) return widthDelta;
                return Math.abs((Number(a.xOffset || 0) + (Number(a.width || 0) / 2)))
                    - Math.abs((Number(b.xOffset || 0) + (Number(b.width || 0) / 2)));
            })[0]!;
    }

    const prevLeft = Number(previousSlot.xOffset || 0);
    const prevRight = prevLeft + Number(previousSlot.width || 0);
    const prevCenter = prevLeft + (Number(previousSlot.width || 0) / 2);

    return slots
        .slice()
        .sort((a, b) => {
            const overlapA = resolveHorizontalOverlap(prevLeft, prevRight, Number(a.xOffset || 0), Number(a.width || 0));
            const overlapB = resolveHorizontalOverlap(prevLeft, prevRight, Number(b.xOffset || 0), Number(b.width || 0));
            if (Math.abs(overlapB - overlapA) > 0.01) return overlapB - overlapA;

            const centerA = Number(a.xOffset || 0) + (Number(a.width || 0) / 2);
            const centerB = Number(b.xOffset || 0) + (Number(b.width || 0) / 2);
            const centerDistanceDelta = Math.abs(centerA - prevCenter) - Math.abs(centerB - prevCenter);
            if (Math.abs(centerDistanceDelta) > 0.01) return centerDistanceDelta;

            return Number(b.width || 0) - Number(a.width || 0);
        })[0]!;
}

function resolveContainmentSlotsForLine(
    slots: ResolvedContainmentSlot[],
    previousSlot: ResolvedContainmentSlot | null,
    expressiveContainment: boolean
): { primary: ResolvedContainmentSlot; queued: ResolvedContainmentSlot[] } {
    if (slots.length <= 1) {
        return { primary: slots[0]!, queued: [] };
    }

    if (expressiveContainment) {
        let bestIndex = 0;
        for (let index = 1; index < slots.length; index++) {
            const best = slots[bestIndex]!;
            const current = slots[index]!;
            const widthDelta = Number(current.width || 0) - Number(best.width || 0);
            if (widthDelta > 0.01 || (Math.abs(widthDelta) <= 0.01 && Number(current.xOffset || 0) < Number(best.xOffset || 0))) {
                bestIndex = index;
            }
        }
        const queued: ResolvedContainmentSlot[] = [];
        for (let index = 0; index < slots.length; index++) {
            if (index === bestIndex) continue;
            queued.push(slots[index]!);
        }
        queued.sort((a, b) => {
            const widthDelta = Number(b.width || 0) - Number(a.width || 0);
            if (Math.abs(widthDelta) > 0.01) return widthDelta;
            return Number(a.xOffset || 0) - Number(b.xOffset || 0);
        });
        return { primary: slots[bestIndex]!, queued };
    }

    return {
        primary: resolvePreferredContainmentSlot(slots, previousSlot),
        queued: []
    };
}

function resolveHorizontalOverlap(prevLeft: number, prevRight: number, nextLeft: number, nextWidth: number): number {
    const nextRight = nextLeft + nextWidth;
    return Math.max(0, Math.min(prevRight, nextRight) - Math.max(prevLeft, nextLeft));
}

function resolveExplicitContainedHostHeight(
    flowBox: FlowBox,
    style: ElementStyle,
    spatialDirective: { kind?: string; clip?: unknown; overflow?: unknown } | undefined
): number | null {
    if (!spatialDirective || spatialDirective.kind !== 'contain') {
        return null;
    }
    if (resolveSpatialFieldOverflow(spatialDirective as any) !== 'stash') {
        return null;
    }
    if (flowBox.overflowPolicy !== 'clip') {
        return null;
    }

    const explicitHeight = Number(flowBox.heightOverride);
    if (Number.isFinite(explicitHeight) && explicitHeight > 0) {
        return Math.max(0, explicitHeight);
    }

    const authoredHeight = Number(style.height);
    if (Number.isFinite(authoredHeight) && authoredHeight > 0) {
        return Math.max(0, authoredHeight);
    }

    return null;
}



function measureRichLineWidth(line: RichLine | undefined): number {
    if (!Array.isArray(line)) return 0;
    let width = 0;
    for (const segment of line) {
        width += Number((segment as { width?: number })?.width || 0);
    }
    return width;
}

function recordColliderFieldProfileDelta(
    session: { recordProfile(metric: string, delta: number): void } | null,
    before: { queryCalls: number; bucketTouches: number; candidateColliderCount: number; narrowphaseCalls: number },
    after: { queryCalls: number; bucketTouches: number; candidateColliderCount: number; narrowphaseCalls: number }
): void {
    if (!session) return;

    session.recordProfile('colliderFieldQueryCalls', Math.max(0, after.queryCalls - before.queryCalls));
    session.recordProfile('colliderFieldBucketTouches', Math.max(0, after.bucketTouches - before.bucketTouches));
    session.recordProfile(
        'colliderFieldCandidateColliders',
        Math.max(0, after.candidateColliderCount - before.candidateColliderCount)
    );
    session.recordProfile(
        'colliderFieldNarrowphaseCalls',
        Math.max(0, after.narrowphaseCalls - before.narrowphaseCalls)
    );
}

function resolveContainmentInkGuard(
    fontSize: number,
    letterSpacing: number,
    intervals: Array<{ w?: number }>
): number {
    const baseGuard = Math.max(0, Number(fontSize || 0) * 0.32);
    const spacingGuard = Math.max(0, Number(letterSpacing || 0) * 0.5);
    const chamberCount = Array.isArray(intervals) ? intervals.length : 0;
    const narrowestInterval = chamberCount > 0
        ? Math.min(...intervals.map((interval) => Math.max(0, Number(interval.w || 0))))
        : Infinity;
    if (chamberCount > 1 || narrowestInterval < Math.max(24, Number(fontSize || 0) * 2.5)) {
        return Math.min(2, Math.max(0.6, (baseGuard * 0.2) + (spacingGuard * 0.35) + 0.25));
    }
    return Math.min(6, baseGuard + spacingGuard + 0.75);
}

function measureLineJustifyExtraWidth(line: RichLine | undefined): number {
    if (!Array.isArray(line)) return 0;
    let extra = 0;
    for (const segment of line) {
        extra += Number((segment as { justifyAfter?: number })?.justifyAfter || 0);
    }
    return extra;
}

function countLineJustifyBoundaries(line: RichLine | undefined): number {
    if (!Array.isArray(line)) return 0;
    let count = 0;
    for (const segment of line) {
        if (Number((segment as { justifyAfter?: number })?.justifyAfter || 0) > 0.0001) {
            count++;
        }
    }
    return count;
}

function clearLineJustifyAfter(line: RichLine | undefined): void {
    if (!Array.isArray(line)) return;
    for (const segment of line) {
        (segment as { justifyAfter?: number }).justifyAfter = 0;
    }
}

function measureRenderedRichLineWidth(line: RichLine | undefined, letterSpacing: number): number {
    const measuredLineWidth = measureRichLineWidth(line);
    const justifyExtraWidth = measureLineJustifyExtraWidth(line);
    return Math.max(0, measuredLineWidth + justifyExtraWidth - Math.max(0, Number(letterSpacing || 0)));
}

function resolveAnchoredContainmentOffset(
    slotOffset: number,
    slotWidth: number,
    renderedLineWidth: number,
    anchor: 'left' | 'right' | 'center'
): number {
    const remainingWidth = Math.max(0, slotWidth - renderedLineWidth);
    return anchor === 'left'
        ? slotOffset
        : anchor === 'right'
            ? slotOffset + remainingWidth
            : slotOffset + (remainingWidth / 2);
}

function resolveContainmentJustifyBoundaryCap(fontSize: number, letterSpacing: number): number {
    const sizeCap = Math.max(1.5, Number(fontSize || 0) * 0.18);
    const spacingCap = Math.max(0, Number(letterSpacing || 0) * 0.5);
    return sizeCap + spacingCap;
}
