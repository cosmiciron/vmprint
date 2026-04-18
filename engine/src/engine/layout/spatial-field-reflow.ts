import type { Box, Element, ElementStyle, RichLine } from '../types';
import type { LayoutProcessor } from './layout-core';
import type { FlowBox } from './layout-core-types';
import { LayoutUtils } from './layout-utils';
import type { SpatialMap } from './packagers/spatial-map';

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
    const richSegments = anyProcessor.getRichSegments(options.element, style);
    if (!Array.isArray(richSegments) || richSegments.length === 0) return null;

    const font = anyProcessor.resolveMeasurementFontForStyle(style);
    const letterSpacing = Number(style.letterSpacing || 0);
    const textIndent = Number(style.textIndent || 0);
    const insetH = LayoutUtils.getHorizontalInsets(style);
    const insetV = LayoutUtils.getVerticalInsets(style);
    const contentWidth = Math.max(0, options.availableWidth - insetH);
    const minUsableSlotWidth = Math.max(0, Number(options.minUsableSlotWidth || 0));

    const marginTop = Math.max(0, flowBox.marginTop);
    const marginBottom = Math.max(0, flowBox.marginBottom);
    const cursorBase = options.clearTopBeforeStart
        ? options.spatialMap.topBottomClearY(options.currentY, queryZIndex)
        : options.currentY;
    const elementStartY = cursorBase + Math.max(0, options.layoutBefore);

    let accumulatedYBonus = 0;
    let physicalLineCount = 0;
    const pendingSlots: Array<{ width: number; xOffset: number; yOffset: number }> = [];
    const lineLayoutOut: { widths: number[]; offsets: number[]; yOffsets: number[] } = {
        widths: [],
        offsets: [],
        yOffsets: []
    };
    const lineSlotWidths: number[] = [];

    const resolver = (): { width: number; xOffset: number; yOffset: number } => {
        if (pendingSlots.length > 0) {
            const slot = pendingSlots.shift()!;
            lineSlotWidths.push(slot.width);
            return slot;
        }

        let lineY = elementStartY + (physicalLineCount * uniformLH) + accumulatedYBonus;
        while (options.spatialMap.hasTopBottomBlock(lineY, uniformLH, queryZIndex)) {
            const clearY = options.spatialMap.topBottomClearY(lineY, queryZIndex);
            accumulatedYBonus += clearY - lineY;
            lineY = elementStartY + (physicalLineCount * uniformLH) + accumulatedYBonus;
        }

        const yOffset = (physicalLineCount * uniformLH) + accumulatedYBonus;
        physicalLineCount++;

        const rawIntervals = options.spatialMap.getAvailableIntervals(
            lineY,
            uniformLH,
            options.availableWidth,
            options.opticalUnderhang ? { opticalUnderhang: true, queryZIndex } : { queryZIndex }
        );
        const intervals = rawIntervals.filter((interval) => Math.max(0, interval.w - insetH) >= minUsableSlotWidth);
        const usableIntervals = intervals.length > 0 ? intervals : rawIntervals;
        if (usableIntervals.length === 0) {
            lineSlotWidths.push(contentWidth);
            return { width: contentWidth, xOffset: 0, yOffset };
        }

        if (usableIntervals.length > 1) {
            for (let i = 1; i < usableIntervals.length; i++) {
                pendingSlots.push({
                    width: Math.max(0, usableIntervals[i].w - insetH),
                    xOffset: usableIntervals[i].x,
                    yOffset
                });
            }
        }

        const slot = {
            width: Math.max(0, usableIntervals[0].w - insetH),
            xOffset: usableIntervals[0].x,
            yOffset
        };
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
            w: options.availableWidth + insetH,
            h: contentHeight,
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
