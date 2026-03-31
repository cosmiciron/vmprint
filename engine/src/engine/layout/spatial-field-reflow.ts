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
    opticalUnderhang?: boolean;
    clearTopBeforeStart?: boolean;
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
    const flowBox = anyProcessor.shapeElement(options.element, { path: options.path }) as FlowBox;
    if (!flowBox || flowBox._materializationMode !== 'reflowable') return null;

    const style: ElementStyle = flowBox.style || {};
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

    const marginTop = Math.max(0, flowBox.marginTop);
    const marginBottom = Math.max(0, flowBox.marginBottom);
    const cursorBase = options.clearTopBeforeStart
        ? options.spatialMap.topBottomClearY(options.currentY)
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

    const resolver = (): { width: number; xOffset: number; yOffset: number } => {
        if (pendingSlots.length > 0) {
            return pendingSlots.shift()!;
        }

        let lineY = elementStartY + (physicalLineCount * uniformLH) + accumulatedYBonus;
        while (options.spatialMap.hasTopBottomBlock(lineY, uniformLH)) {
            const clearY = options.spatialMap.topBottomClearY(lineY);
            accumulatedYBonus += clearY - lineY;
            lineY = elementStartY + (physicalLineCount * uniformLH) + accumulatedYBonus;
        }

        const yOffset = (physicalLineCount * uniformLH) + accumulatedYBonus;
        physicalLineCount++;

        const intervals = options.spatialMap.getAvailableIntervals(
            lineY,
            uniformLH,
            options.availableWidth,
            options.opticalUnderhang ? { opticalUnderhang: true } : undefined
        );
        if (intervals.length === 0) {
            return { width: contentWidth, xOffset: 0, yOffset };
        }

        if (intervals.length > 1) {
            for (let i = 1; i < intervals.length; i++) {
                pendingSlots.push({
                    width: Math.max(0, intervals[i].w - insetH),
                    xOffset: intervals[i].x,
                    yOffset
                });
            }
        }

        return {
            width: Math.max(0, intervals[0].w - insetH),
            xOffset: intervals[0].x,
            yOffset
        };
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

    return {
        flowBox,
        lines,
        lineOffsets: lineLayoutOut.offsets,
        lineWidths: lineLayoutOut.widths,
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
                _isLastLine: true
            },
            meta: flowBox.meta ? { ...flowBox.meta, pageIndex: Number(options.pageIndex || 0) } : { pageIndex: Number(options.pageIndex || 0) }
        }
    };
}
