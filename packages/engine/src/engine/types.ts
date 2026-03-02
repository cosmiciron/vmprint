export type ElementType = string;
export type TextDirection = 'ltr' | 'rtl' | 'auto';
export type HyphenationMode = 'off' | 'auto' | 'soft';
export type JustifyEngineMode = 'legacy' | 'advanced';
export type JustifyStrategy = 'auto' | 'space' | 'inter-character';
export type ImageFitMode = 'contain' | 'fill';
export type VmprintDocumentVersion = '1.0';
export type VmprintIRVersion = '1.0';

export type TextSegment = {
    text: string;
    fontFamily?: string;
    linkTarget?: string;
    style?: Record<string, any>;
    inlineObject?: InlineObjectSegment;
    inlineMetrics?: InlineObjectMetrics;
    glyphs?: { char: string; x: number; y: number }[];
    width?: number;
    ascent?: number;
    descent?: number;
    justifyAfter?: number;
    forcedBreakAfter?: boolean;
};

export type RichLine = TextSegment[];

export type InlineObjectKind = 'image' | 'box';

export interface InlineImageSegment {
    kind: 'image';
    image: EmbeddedImagePayload;
}

export interface InlineBoxSegment {
    kind: 'box';
    text?: string;
}

export type InlineObjectSegment = InlineImageSegment | InlineBoxSegment;

export interface InlineObjectMetrics {
    width: number;
    height: number;
    contentWidth: number;
    contentHeight: number;
    opticalInsetTop?: number;
    opticalInsetRight?: number;
    opticalInsetBottom?: number;
    opticalInsetLeft?: number;
    opticalWidth?: number;
    opticalHeight?: number;
    descent: number;
    marginLeft: number;
    marginRight: number;
    baselineShift: number;
    verticalAlign: 'baseline' | 'text-top' | 'middle' | 'text-bottom' | 'bottom';
}

export type OverflowPolicy = 'clip' | 'move-whole' | 'error';

export interface Element {
    type: ElementType;
    content: string;
    children?: Element[];
    properties?: ElementProperties;
}

export interface EmbeddedImagePayload {
    data: string;
    mimeType?: string;
    fit?: ImageFitMode;
}

export interface BoxImagePayload {
    base64Data: string;
    mimeType: string;
    intrinsicWidth: number;
    intrinsicHeight: number;
    fit: ImageFitMode;
}

export interface ElementLayoutDirectives {
    suppressPageNumber?: boolean;
}

export interface TableColumnSizing {
    mode?: 'fixed' | 'auto' | 'flex';
    value?: number;
    fr?: number;
    min?: number;
    max?: number;
    basis?: number;
    minContent?: number;
    maxContent?: number;
    grow?: number;
    shrink?: number;
}

export interface TableLayoutOptions {
    headerRows?: number;
    repeatHeader?: boolean;
    columnGap?: number;
    rowGap?: number;
    columns?: TableColumnSizing[];
    cellStyle?: Record<string, any>;
    headerCellStyle?: Record<string, any>;
}

export interface ElementProperties extends Record<string, any> {
    style?: Record<string, any>;
    image?: EmbeddedImagePayload;
    table?: TableLayoutOptions;
    colSpan?: number;
    rowSpan?: number;
    sourceId?: string;
    linkTarget?: string;
    semanticRole?: string;
    dropCap?: DropCapSpec;
    /** Story layout directive: declared on children of a `story` element. */
    layout?: StoryLayoutDirective;
    reflowKey?: string;
    keepWithNext?: boolean;
    marginTop?: number;
    marginBottom?: number;
    paginationContinuation?: Record<string, any>;
    layoutDirectives?: ElementLayoutDirectives;
}

export interface DropCapSpec {
    enabled?: boolean;
    lines?: number;
    characters?: number;
    gap?: number;
    characterStyle?: ElementStyle;
}

// ---------------------------------------------------------------------------
// Story layout directives – used by children of a `story` element to declare
// how they float or are placed relative to the story's text stream.
// ---------------------------------------------------------------------------

/** How an image inside a story is anchored. */
export type StoryLayoutMode = 'float' | 'story-absolute';

/**
 * How text reflows around an obstacle:
 *   'around'     – text snakes around the obstacle (left/right gap used)
 *   'top-bottom' – text clears the obstacle completely (no side-by-side text)
 *   'none'       – image overlays text with no reflow
 */
export type StoryWrapMode = 'around' | 'top-bottom' | 'none';

/** Which margin a float anchors to. */
export type StoryFloatAlign = 'left' | 'right' | 'center';

export interface StoryLayoutDirective {
    mode: StoryLayoutMode;
    /** story-absolute: X offset from story content-area left edge (points). */
    x?: number;
    /** story-absolute: Y offset from story origin (points). */
    y?: number;
    /** float: which margin to anchor to (default 'left'). */
    align?: StoryFloatAlign;
    /** How text interacts with this obstacle (default 'around'). */
    wrap?: StoryWrapMode;
    /** Extra whitespace clearance around the obstacle bounding box (points). */
    gap?: number;
}

export interface ElementStyle {
    fontFamily?: string;
    fontSize?: number;
    fontWeight?: number | string;
    fontStyle?: string;
    textAlign?: 'left' | 'right' | 'center' | 'justify';
    lang?: string;
    direction?: TextDirection;
    hyphenation?: HyphenationMode;
    hyphenateCaps?: boolean;
    hyphenMinWordLength?: number;
    hyphenMinPrefix?: number;
    hyphenMinSuffix?: number;
    justifyEngine?: JustifyEngineMode;
    justifyStrategy?: JustifyStrategy;

    marginTop?: number;
    marginBottom?: number;
    marginLeft?: number;
    marginRight?: number;
    textIndent?: number;
    lineHeight?: number;
    letterSpacing?: number;
    verticalAlign?: 'baseline' | 'text-top' | 'middle' | 'text-bottom' | 'bottom';
    baselineShift?: number;
    inlineMarginLeft?: number;
    inlineMarginRight?: number;
    inlineOpticalInsetTop?: number;
    inlineOpticalInsetRight?: number;
    inlineOpticalInsetBottom?: number;
    inlineOpticalInsetLeft?: number;

    padding?: number;
    paddingTop?: number;
    paddingBottom?: number;
    paddingLeft?: number;
    paddingRight?: number;

    width?: number;
    height?: number;
    zIndex?: number;

    color?: string;
    backgroundColor?: string;
    opacity?: number;

    pageBreakBefore?: boolean;
    keepWithNext?: boolean;
    allowLineSplit?: boolean;
    orphans?: number;
    widows?: number;
    overflowPolicy?: OverflowPolicy;

    borderWidth?: number;
    borderColor?: string;
    borderRadius?: number;
    borderTopWidth?: number;
    borderBottomWidth?: number;
    borderLeftWidth?: number;
    borderRightWidth?: number;
    borderTopColor?: string;
    borderBottomColor?: string;
    borderLeftColor?: string;
    borderRightColor?: string;
}

export interface LayoutConfig {
    layout: {
        pageSize: 'A4' | 'LETTER' | { width: number; height: number };
        orientation?: 'portrait' | 'landscape';
        margins: { top: number; right: number; bottom: number; left: number };
        fontFamily: string;
        fontSize: number;
        lineHeight: number;
        /** Background fill colour for every page, e.g. "#fdf6ee" for a warm paper tone. */
        pageBackground?: string;
        /** Optical story wrap underhang: allow full-width lines once their top clears an obstacle bottom. */
        storyWrapOpticalUnderhang?: boolean;
        showPageNumbers?: boolean;
        pageNumberFormat?: string;
        pageNumberStartPage?: number;
        pageNumberFontSize?: number;
        pageNumberColor?: string;
        pageNumberFont?: string;
        pageNumberPosition?: 'top' | 'bottom';
        pageNumberOffset?: number;
        pageNumberAlignment?: 'left' | 'right' | 'center';
        pageNumberOffsetTop?: number;
        pageNumberOffsetBottom?: number;
        pageNumberOffsetLeft?: number;
        pageNumberOffsetRight?: number;
        lang?: string;
        direction?: TextDirection;
        hyphenation?: HyphenationMode;
        hyphenateCaps?: boolean;
        hyphenMinWordLength?: number;
        hyphenMinPrefix?: number;
        hyphenMinSuffix?: number;
        justifyEngine?: JustifyEngineMode;
        justifyStrategy?: JustifyStrategy;
        opticalScaling?: {
            enabled?: boolean;
            cjk?: number;
            korean?: number;
            thai?: number;
            devanagari?: number;
            arabic?: number;
            cyrillic?: number;
            latin?: number;
            default?: number;
        };
    };
    fonts: {
        regular?: string;
        bold?: string;
        italic?: string;
        bolditalic?: string;
        [key: string]: string | undefined;
    };
    styles: Partial<Record<string, ElementStyle>>;
    preloadFontFamilies?: string[];
    debug?: boolean;
}

export interface DocumentInput {
    documentVersion: VmprintDocumentVersion;
    layout: LayoutConfig['layout'];
    fonts?: LayoutConfig['fonts'];
    styles: LayoutConfig['styles'];
    elements: Element[];
    debug?: boolean;
}

export interface DocumentIR extends Omit<DocumentInput, 'debug'> {
    irVersion: VmprintIRVersion;
}

export interface Box {
    type: string;
    x: number;
    y: number;
    w: number;
    h: number;
    image?: BoxImagePayload;
    content?: string;
    lines?: RichLine[];
    glyphs?: { char: string; x: number; y: number }[];
    ascent?: number;
    style: ElementStyle;
    decorationOffset?: number;
    properties?: Record<string, any>;
    meta?: BoxMeta;
}

export interface BoxMeta {
    sourceId: string;
    engineKey: string;
    sourceType: string;
    semanticRole?: string;
    reflowKey?: string;
    fragmentIndex: number;
    isContinuation: boolean;
    pageIndex?: number;
    generated?: boolean;
    originSourceId?: string;
}

export interface Page {
    index: number;
    boxes: Box[];
    width: number;
    height: number;
}

export interface AnnotatedLayoutStream {
    streamVersion: '1.0';
    config: Omit<LayoutConfig, 'debug'>;
    pages: Page[];
}
