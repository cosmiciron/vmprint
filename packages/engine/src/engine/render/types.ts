import { ElementStyle, InlineObjectMetrics, InlineObjectSegment, TextSegment } from '../types';

export type RendererSegmentStyle = ElementStyle & Record<string, unknown>;

export type RendererLineSegment = Omit<TextSegment, 'style' | 'inlineObject' | 'inlineMetrics'> & {
    style?: RendererSegmentStyle;
    inlineObject?: InlineObjectSegment;
    inlineMetrics?: InlineObjectMetrics;
};

export type RendererRichLine = RendererLineSegment[];
export type RendererLine = string | RendererRichLine;

export type RendererBoxProperties = Record<string, unknown> & {
    _lineOffsets?: number[];
    _lineWidths?: number[];
    _lineYOffsets?: number[];
};

export type RendererLineMetric = {
    lineFontSize: number;
    referenceAscentScale: number;
    effectiveLineHeight: number;
};

export type RendererParagraphMetrics = {
    paragraphHasInlineObjects: boolean;
    paragraphReferenceAscentScale: number;
    lineMetrics: RendererLineMetric[];
    uniformLineHeight: number;
};

export type RendererLineItem = {
    seg: RendererLineSegment;
    extra: number;
};
