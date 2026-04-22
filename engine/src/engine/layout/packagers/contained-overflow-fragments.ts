import { Box, Element, ElementStyle, RichLine } from '../../types';
import { createContinuationFragmentStyle, createLeadingFragmentStyle } from '../flow-fragment-state';
import { type SpatialFieldTextPlacement } from '../spatial-field-reflow';
import { type LayoutProcessor } from '../layout-core';

export type ContainedContinueFragment = {
    box: Box;
    contentHeight: number;
    lines: RichLine[];
    lineYOffsets: number[];
    lineOffsets: number[];
    lineWidths: number[];
    continuationElement: Element;
    contentSummary: ContainedContentSummaryData;
};

export type ContainedContentSummaryData = {
    overflowMode: 'continue' | 'stash';
    totalSourceCharCount: number;
    containedCharCount: number;
    stashedCharCount: number;
    overflowedCharCount: number;
};

export function resolveContainedVisibleHeight(
    flowBox: { heightOverride?: number; style?: ElementStyle } | undefined,
    style: ElementStyle | undefined
): number {
    const authoredHeight = Number(style?.height ?? flowBox?.style?.height);
    if (Number.isFinite(authoredHeight) && authoredHeight > 0) {
        return Math.max(0, authoredHeight);
    }

    const explicitHeight = Number(flowBox?.heightOverride);
    if (Number.isFinite(explicitHeight) && explicitHeight > 0) {
        return Math.max(0, explicitHeight);
    }

    return 0;
}

export function buildContainedContinueFragment(
    processor: LayoutProcessor,
    element: Element,
    box: Box,
    placed: SpatialFieldTextPlacement,
    visibleHeight: number
): ContainedContinueFragment | null {
    if (!(visibleHeight > 0)) return null;

    let consumedLineCount = -1;
    for (let index = 0; index < placed.lines.length; index++) {
        const yOff = placed.lineYOffsets.length > index ? placed.lineYOffsets[index] : index * placed.uniformLineHeight;
        const lineBottom = yOff + placed.uniformLineHeight + placed.insetV;
        if (lineBottom <= visibleHeight + 0.1) {
            consumedLineCount = index;
        }
    }

    if (consumedLineCount >= placed.lines.length - 1) {
        return null;
    }

    const leadingCount = Math.max(0, consumedLineCount + 1);
    if (leadingCount <= 0) {
        return null;
    }

    const lines = placed.lines.slice(0, leadingCount);
    const lineYOffsets = placed.lineYOffsets.slice(0, leadingCount);
    const lineOffsets = placed.lineOffsets.slice(0, leadingCount);
    const lineWidths = placed.lineWidths.slice(0, leadingCount);
    const leadingStyle = createLeadingFragmentStyle(box.style || {});
    const continuationStyle = stripContainedHostStyle(createContinuationFragmentStyle(box.style || {}));
    const contentSummary = resolveContainedContentSummary(
        processor,
        element,
        placed.lines,
        leadingCount,
        'continue'
    );
    const continuationElement = createContainedOverflowContinuationElement(
        processor,
        element,
        placed.lines,
        leadingCount,
        continuationStyle
    );

    return {
        box: {
            ...box,
            h: visibleHeight,
            lines,
            style: leadingStyle,
            properties: {
                ...(box.properties || {}),
                _lineYOffsets: lineYOffsets,
                _lineOffsets: lineOffsets,
                _lineWidths: lineWidths,
                _isLastLine: false
            }
        },
        contentHeight: visibleHeight,
        lines,
        lineYOffsets,
        lineOffsets,
        lineWidths,
        continuationElement,
        contentSummary
    };
}

export function resolveContainedContentSummary(
    processor: LayoutProcessor,
    element: Element,
    lines: RichLine[],
    visibleLineCount: number,
    overflowMode: 'continue' | 'stash'
): ContainedContentSummaryData {
    const anyProcessor = processor as any;
    const safeVisibleLineCount = Math.max(0, Math.min(lines.length, Math.floor(Number(visibleLineCount) || 0)));
    const renderedText: string = anyProcessor.getJoinedLineText(lines.slice(0, safeVisibleLineCount));
    const sourceText: string = anyProcessor.getElementText(element);
    const containedCharCount = Math.max(0, anyProcessor.resolveConsumedSourceChars(sourceText, renderedText));
    const totalSourceCharCount = sourceText.length;
    const hiddenCharCount = Math.max(0, totalSourceCharCount - containedCharCount);

    return {
        overflowMode,
        totalSourceCharCount,
        containedCharCount,
        stashedCharCount: overflowMode === 'stash' ? hiddenCharCount : 0,
        overflowedCharCount: overflowMode === 'continue' ? hiddenCharCount : 0
    };
}

function createContainedOverflowContinuationElement(
    processor: LayoutProcessor,
    element: Element,
    lines: RichLine[],
    consumedLineCount: number,
    continuationStyle: ElementStyle
): Element {
    const anyProcessor = processor as any;
    const renderedText: string = anyProcessor.getJoinedLineText(lines.slice(0, consumedLineCount));
    const sourceText: string = anyProcessor.getElementText(element);
    const consumedChars: number = anyProcessor.resolveConsumedSourceChars(sourceText, renderedText);
    const remaining = Math.max(0, sourceText.length - consumedChars);

    let continuation: Element;
    if (Array.isArray(element.children) && element.children.length > 0) {
        continuation = {
            ...element,
            content: '',
            children: anyProcessor.sliceElements(
                element.children,
                consumedChars,
                consumedChars + remaining
            )
        };
    } else {
        continuation = {
            ...element,
            content: sourceText.slice(consumedChars)
        };
    }

    const trimmed = anyProcessor.trimLeadingContinuationWhitespace(continuation) as Element;
    const properties = { ...(trimmed.properties || {}) } as Record<string, any>;
    delete properties.space;
    delete properties.spatialField;
    properties.style = continuationStyle;
    return { ...trimmed, properties };
}

function stripContainedHostStyle(style: ElementStyle): ElementStyle {
    const next: ElementStyle = { ...style };
    delete next.width;
    delete next.height;
    delete next.padding;
    delete next.paddingTop;
    delete next.paddingRight;
    delete next.paddingBottom;
    delete next.paddingLeft;
    delete next.borderWidth;
    delete next.borderColor;
    delete next.borderRadius;
    delete next.borderTopWidth;
    delete next.borderBottomWidth;
    delete next.borderLeftWidth;
    delete next.borderRightWidth;
    delete next.borderTopColor;
    delete next.borderBottomColor;
    delete next.borderLeftColor;
    delete next.borderRightColor;
    delete next.backgroundColor;
    return next;
}
