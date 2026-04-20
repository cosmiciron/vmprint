import type { Box, Element, ElementStyle, RichLine } from '../types';
import type { LayoutProcessor } from './layout-core';
import type { FlowBox } from './layout-core-types';
import { LayoutUtils } from './layout-utils';
import type { SpatialMap } from './packagers/spatial-map';
import { SpatialFieldGeometryCapability } from './packagers/spatial-field-capability';

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

type SpatialFieldReflowOptions = {
    processor: LayoutProcessor;
    element: Element;
    path: number[];
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
    const flowBox = anyProcessor.shapeElement(options.element, { path: options.path }) as FlowBox;
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
    const richSegments = anyProcessor.getRichSegments(options.element, style);
    if (!Array.isArray(richSegments) || richSegments.length === 0) return null;

    const font = anyProcessor.resolveMeasurementFontForStyle(style);
    const letterSpacing = Number(style.letterSpacing || 0);
    const textIndent = Number(style.textIndent || 0);
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
    const minUsableSlotWidth = Math.max(0, Number(options.minUsableSlotWidth || 0));
    const rejectSubMinimumSlots = options.rejectSubMinimumSlots !== false && minUsableSlotWidth > 0;

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
    const lineLayoutOut: { widths: number[]; offsets: number[]; yOffsets: number[] } = {
        widths: [],
        offsets: [],
        yOffsets: []
    };
    const lineSlotWidths: number[] = [];
    const selectedSlotXOffsets: number[] = [];
    const selectedContainmentAnchors: Array<'left' | 'right' | 'center'> = [];
    const resolver = (): { width: number; xOffset: number; yOffset: number } => {
        if (pendingSlots.length > 0) {
            const slot = pendingSlots.shift()!;
            lineSlotWidths.push(slot.width);
            if (laneMode === 'contain') {
                selectedSlotXOffsets.push(slot.xOffset);
                selectedContainmentAnchors.push(slot.anchor ?? 'center');
            }
            return slot;
        }

        let lineY = elementStartY + (physicalLineCount * uniformLH) + accumulatedYBonus;
        while (options.spatialMap.hasTopBottomBlock(lineY, uniformLH, queryZIndex)) {
            const clearY = options.spatialMap.topBottomClearY(lineY, queryZIndex);
            accumulatedYBonus += clearY - lineY;
            lineY = elementStartY + (physicalLineCount * uniformLH) + accumulatedYBonus;
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
        const normalizedIntervals = laneMode === 'contain'
            ? rawIntervals.map((interval): ContainmentInterval => {
                const intervalLeft = Number(interval.x || 0);
                const intervalRight = intervalLeft + Number(interval.w || 0);
                const contentLeft = insetLeft;
                const contentRight = Math.max(contentLeft, options.availableWidth - insetRight);
                const clippedLeft = Math.max(contentLeft, intervalLeft);
                const clippedRight = Math.min(contentRight, intervalRight);
                return {
                    x: clippedLeft - insetLeft,
                    w: Math.max(0, clippedRight - clippedLeft),
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
                .slice()
                .sort((a, b) => Number(a.x || 0) - Number(b.x || 0))
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

        for (let i = 1; i < resolvedSlots.length; i++) {
            pendingSlots.push(resolvedSlots[i]!);
        }

        const slot = resolvedSlots[0]!;
        if (laneMode === 'contain') {
            selectedSlotXOffsets.push(slot.xOffset);
            selectedContainmentAnchors.push(slot.anchor ?? 'center');
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
        lineLayoutOut
    );
    if (!Array.isArray(lines) || lines.length === 0) return null;

    const linesHeight = anyProcessor.calculateLineBlockHeight(lines, style, lineLayoutOut.yOffsets);
    const contentHeight = linesHeight + insetV;
    const colliderStatsAfter = options.spatialMap.getStatsSnapshot();
    recordColliderFieldProfileDelta(session, colliderStatsBefore, colliderStatsAfter);
    const clipProperties = laneMode === 'contain'
        ? new SpatialFieldGeometryCapability(options.element).buildClipProperties()
        : {};
    if (
        laneMode === 'contain'
        && (!style.textAlign || style.textAlign === 'left')
        && lineLayoutOut.offsets.length === lines.length
    ) {
        for (let index = 0; index < lines.length; index++) {
            const slotWidth = Number(lineLayoutOut.widths[index] || 0);
            const slotOffset = Number(selectedSlotXOffsets[index] ?? lineLayoutOut.offsets[index] ?? 0);
            const anchor = selectedContainmentAnchors[index] ?? 'center';
            const measuredLineWidth = measureRichLineWidth(lines[index]);
            const adjustedLineWidth = Math.max(0, measuredLineWidth - letterSpacing);
            const remainingWidth = Math.max(0, slotWidth - adjustedLineWidth);
            const anchoredOffset = anchor === 'left'
                ? slotOffset
                : anchor === 'right'
                    ? slotOffset + remainingWidth
                    : slotOffset + (remainingWidth / 2);
            lineLayoutOut.offsets[index] = anchoredOffset;
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
                ...clipProperties,
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

function resolveContainmentAnchor(interval: ContainmentInterval): 'left' | 'right' | 'center' {
    const touchesLeft = interval.touchesLeft === true;
    const touchesRight = interval.touchesRight === true;
    if (touchesLeft && !touchesRight) return 'left';
    if (touchesRight && !touchesLeft) return 'right';
    return 'center';
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
