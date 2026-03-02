import { BoxImagePayload, BoxMeta, Element, ElementStyle, OverflowPolicy, RichLine } from '../types';

export type FlowBox = {
    type: string;
    meta: BoxMeta;
    style: ElementStyle;
    image?: BoxImagePayload;
    lines?: RichLine[];
    content?: string;
    glyphs?: { char: string; x: number; y: number }[];
    ascent?: number;
    properties: Record<string, any>;
    marginTop: number;
    marginBottom: number;
    keepWithNext: boolean;
    pageBreakBefore: boolean;
    allowLineSplit: boolean;
    overflowPolicy: OverflowPolicy;
    orphans: number;
    widows: number;
    heightOverride?: number;
    measuredContentHeight: number;
    measuredWidth?: number;
    _materializationMode: 'reflowable' | 'frozen';
    _materializationContextKey?: string;
    _sourceElement?: Element;
    _unresolvedElement?: Element;
};

export type FlowMaterializationContext = {
    pageIndex: number;
    cursorY: number;
    contentWidth?: number;
};

export type ResolvedLinesResult = {
    lines: RichLine[];
    lineOffsets?: number[];
    lineWidths?: number[];
    lineYOffsets?: number[];
};

export type FlowIdentitySeed = {
    path?: number[];
    sourceId?: string;
    engineKey?: string;
    sourceType?: string;
    semanticRole?: string;
    reflowKey?: string;
    fragmentIndex?: number;
    isContinuation?: boolean;
    generated?: boolean;
    originSourceId?: string;
};

export type ContinuationMarkerSpec = {
    type?: string;
    content?: string;
    style?: ElementStyle;
    properties?: Record<string, any>;
};

export type PaginationContinuationSpec = {
    enabled?: boolean;
    markerAfterSplit?: ContinuationMarkerSpec;
    markerBeforeContinuation?: ContinuationMarkerSpec;
    markersBeforeContinuation?: ContinuationMarkerSpec[];
};

export type ContinuationArtifacts = {
    markerAfterSplit?: FlowBox;
    markersBeforeContinuation: FlowBox[];
};
