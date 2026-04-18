export type ElementType = string;
export type TextDirection = 'ltr' | 'rtl' | 'auto';
export type HyphenationMode = 'off' | 'auto' | 'soft';
export type JustifyEngineMode = 'legacy' | 'advanced';
export type JustifyStrategy = 'auto' | 'space' | 'inter-character';
export type ImageFitMode = 'contain' | 'fill';
export type PageReservationSelector = 'first' | 'odd' | 'even' | 'all';
export type VmprintDocumentVersion = '1.1';
export type VmprintIRVersion = '1.0';
export type ScriptMethodSource = string | string[];
export type SimulationProgressionPolicy = 'until-settled' | 'fixed-tick-count';
export type SimulationStopReason = 'settled' | 'fixed-tick-count';

export interface SimulationProgressionConfig {
    policy?: SimulationProgressionPolicy;
    maxTicks?: number;
    tickRateHz?: number;
}

export interface LayoutScriptingConfig {
    methods?: Record<string, ScriptMethodSource>;
    vars?: Record<string, unknown>;
    onBeforeLayout?: string;
    onAfterSettle?: string;
}

export type ShapedGlyph = {
    id: number;
    codePoints: number[];
    xAdvance: number;
    xOffset: number;
    yOffset: number;
};

export type TextSegment = {
    text: string,
    fontFamily?: string,
    linkTarget?: string,
    style?: Record<string, any>,
    inlineObject?: InlineObjectSegment,
    inlineMetrics?: InlineObjectMetrics,
    /** Per-glyph positions from the active text delegate, used for LTR kerned text. */
    glyphs?: { char: string, x: number, y: number }[],
    /**
     * Delegate-provided shaped glyph data for RTL / CTL text when available.
     * Some legacy renderers can consume this directly without re-running shaping.
     */
    shapedGlyphs?: ShapedGlyph[],
    width?: number,
    ascent?: number,
    descent?: number,
    resolvedFontId?: string,
    resolvedFontAscent?: number,
    justifyAfter?: number,
    forcedBreakAfter?: boolean,
    scriptClass?: string,
    direction?: 'ltr' | 'rtl'
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
export type ZoneFrameOverflow = 'move-whole' | 'continue';
export type ZoneWorldBehavior = 'fixed' | 'spanning' | 'expandable';

export interface ZoneRegionRect {
    x: number;
    y: number;
    width: number;
    height?: number;
}

/**
 * A spatial region on a `zone-map` element.
 *
 * A ZoneDefinition is NOT an Element — it is a region descriptor. It has no
 * `type`, no `children`, and no DOM-style nesting semantics. It describes a
 * bounded area on the page map and the actors (`elements`) assigned to inhabit
 * that area. Each zone runs an independent, non-paginating layout pass.
 */
export interface ZoneDefinition {
    /** Optional identifier for the zone (for debugging and future linked-frame support). */
    id?: string;
    /** Optional explicit region geometry in zone-field local/world coordinates. */
    region?: ZoneRegionRect;
    /** Block-level elements assigned to this zone. Laid out independently of all other zones. */
    elements: Element[];
    /** Per-zone style overrides (e.g. backgroundColor for the zone cell background). */
    style?: Record<string, any>;
}

/**
 * A compact horizontal slot on a `strip` element.
 *
 * A StripSlot is not a DOM child node. It is a bounded authored region used
 * for one-row horizontal composition.
 */
export interface StripSlot {
    id?: string;
    elements: Element[];
    style?: Record<string, any>;
}

export interface Element {
    type: ElementType;
    name?: string;
    content: string;
    children?: Element[];
    /** Embedded image payload. Required on `type: "image"` elements. */
    image?: EmbeddedImagePayload;
    /** Table layout model. Required on `type: "table"` elements. */
    table?: TableLayoutOptions;
    /**
     * Strip slots. Each entry is an independent compact region in a one-row
     * horizontal composition band. Only meaningful for `type: "strip"`.
     */
    slots?: StripSlot[];
    /** Story-level multi-column count (only meaningful for `type: "story"`). */
    columns?: number;
    /** Story-level inter-column gap in points (only for `type: "story"`). */
    gutter?: number;
    /**
     * When `true`, column height is set to `ceil(totalContentHeight / columns)`
     * so content distributes evenly across all columns instead of packing into
     * the first column (CSS `column-fill: balance` semantics).
     * Only meaningful for `type: "story"` with `columns > 1`.
     */
    balance?: boolean;
    /**
     * Zone-map spatial regions. Each entry is an independent layout context
     * (a room on the map). Only meaningful for `type: "zone-map"`.
     * Column widths and gap are declared in `zoneLayout`.
     */
    zones?: ZoneDefinition[];
    /** Zone-map layout model. Preferred on AST 1.1+. */
    zoneLayout?: ZoneLayoutOptions;
    /** Strip track model. Preferred on AST 1.1+. */
    stripLayout?: StripLayoutOptions;
    /** Drop-cap configuration. */
    dropCap?: DropCapSpec;
    /** Story-local full-width span directive. */
    columnSpan?: 'all' | number;
    /**
     * Story-local placement directive. Declares how this element participates
     * in a story's spatial layout — as a float anchored to the text cursor,
     * or as an absolutely positioned element pinned within the story area.
     * Only meaningful for direct children of a `story` element.
     */
    placement?: StoryLayoutDirective;
    properties?: ElementProperties;
}

export interface EmbeddedImagePayload {
    data: string;
    mimeType?: string;
    fit?: ImageFitMode;
}

export interface PageRegionContent {
    elements: Element[];
    style?: ElementStyle;
}

export interface PageRegionDefinition {
    default?: PageRegionContent | null;
    firstPage?: PageRegionContent | null;
    odd?: PageRegionContent | null;
    even?: PageRegionContent | null;
}

export interface BoxImagePayload {
    base64Data: string;
    mimeType: string;
    intrinsicWidth: number;
    intrinsicHeight: number;
    fit: ImageFitMode;
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

/**
 * Layout options for a `zone-map` element.
 * Column widths are resolved via `solveTrackSizing` (same solver as tables).
 */
export interface ZoneLayoutOptions {
    /** Column track definitions. Reuses `TableColumnSizing` (fixed/auto/flex modes). */
    columns?: TableColumnSizing[];
    /** Gap between columns in points. Defaults to 0. */
    gap?: number;
    /**
     * How the zone field behaves at page boundaries.
     * `move-whole` preserves the shipped V1 behavior.
     * `continue` allows the zone host to begin in the current chunk/page frame
     * and continue onto later ones according to `worldBehavior`.
     */
    frameOverflow?: ZoneFrameOverflow;
    /**
     * Authored world behavior for this zone field.
     * `fixed` is the conservative default.
     */
    worldBehavior?: ZoneWorldBehavior;
}

/**
 * Layout options for a `strip` element.
 * Track sizing reuses the same vocabulary as tables and zone maps.
 */
export interface StripLayoutOptions {
    tracks?: TableColumnSizing[];
    gap?: number;
}

export interface WorldPlainOptions {
    style?: ElementStyle;
    frameOverflow?: ZoneFrameOverflow;
    worldBehavior?: ZoneWorldBehavior;
    rootFlowMode?: 'wrapped' | 'traverse';
    traversalInteractionDefault?: TraversalInteractionPolicy;
}

export interface ElementProperties extends Record<string, any> {
    style?: Record<string, any>;
    colSpan?: number;
    rowSpan?: number;
    sourceId?: string;
    linkTarget?: string;
    semanticRole?: string;
    reflowKey?: string;
    keepWithNext?: boolean;
    onResolve?: string;
    onMessage?: string;
    marginTop?: number;
    marginBottom?: number;
    paginationContinuation?: Record<string, any>;
    pageReservationAfter?: number;
    /** Table of Contents options. Declared on `toc` elements. */
    toc?: {
        title?: string;
        levelFilter?: number[];
        style?: Record<string, unknown>;
    };
    /**
     * Preferred public name for spatial influence / exclusion behavior.
     */
    space?: SpatialFieldDirective;
    /**
     * VMPrint-authored alias accepted as an input seam when consuming existing
     * VMPrint documents and fixtures.
     */
    spatialField?: SpatialFieldDirective;
    /**
     * Preferred public name for simple built-in declarative movement.
     * Kept intentionally narrow so small motion does not require scripting.
     */
    motion?: ElementSimulationDirective;
    pageOverrides?: {
        header?: PageRegionContent | null;
        footer?: PageRegionContent | null;
    };
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
export type TraversalInteractionPolicy = 'auto' | 'wrap' | 'overpass' | 'ignore';

/** Which margin a float anchors to. */
export type StoryFloatAlign = 'left' | 'right' | 'center';

/**
 * The exclusion-zone shape used for text wrapping:
 *   'rect'   – rectangular bounding box (default)
 *   'circle' – circle inscribed in the bounding box; text conforms to the arc
 */
export type StoryFloatShape = 'rect' | 'circle' | 'polygon';

export interface StoryExclusionAssemblyMember {
    /** Local X offset from the float/story-absolute anchor box. */
    x: number;
    /** Local Y offset from the float/story-absolute anchor box. */
    y: number;
    /** Primitive width in points. */
    w: number;
    /** Primitive height in points. */
    h: number;
    /** Primitive wrap shape. */
    shape?: StoryFloatShape;
    /** Local SVG path used when `shape` is `polygon`. */
    path?: string;
    /** Optional depth override for this primitive. */
    zIndex?: number;
    /** Optional explicit interaction policy for traversing/root flow. */
    traversalInteraction?: TraversalInteractionPolicy;
}

export interface StoryExclusionAssembly {
    members: StoryExclusionAssemblyMember[];
}

export interface SpatialFieldDirective {
    kind?: 'exclude';
    x?: number;
    y?: number;
    align?: StoryFloatAlign;
    wrap?: StoryWrapMode;
    gap?: number;
    shape?: StoryFloatShape;
    path?: string;
    exclusionAssembly?: StoryExclusionAssembly;
    hidden?: boolean;
    zIndex?: number;
    traversalInteraction?: TraversalInteractionPolicy;
}

export interface SimulationMotionAxis {
    /** Position at time 0 in local actor coordinates. */
    start?: number;
    /** Deterministic units advanced per simulated second. */
    velocity?: number;
    /** Optional sine-wave offset amplitude. */
    amplitude?: number;
    /** Optional sine-wave angular frequency in radians per simulated second. */
    frequency?: number;
    /** Optional sine-wave phase offset in radians. */
    phase?: number;
}

export interface ElementSimulationDirective {
    enabled?: boolean;
    /**
     * Optional liveness bound for until-settled runs. Fixed-tick-count runs are
     * bounded by layout.progression.maxTicks, so this may be omitted there.
     */
    maxTicks?: number;
    /**
     * Defaults to geometry because moving actors usually alter the spatial
     * world. Use content-only only when geometry is intentionally stable.
     */
    updateKind?: 'content-only' | 'geometry';
    x?: SimulationMotionAxis;
    y?: SimulationMotionAxis;
    label?: string;
}

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
    /** Exclusion-zone shape for text wrapping (default 'rect'). */
    shape?: StoryFloatShape;
    /** Local SVG path used when `shape` is `polygon`. */
    path?: string;
    /**
     * Optional composed exclusion field built from simple primitives.
     * When present, text wrapping uses the union of these members instead of a
     * single rect/circle obstacle.
     */
    exclusionAssembly?: StoryExclusionAssembly;
    /** Optional depth for float/story-absolute obstacle interaction. */
    zIndex?: number;
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
        pageSize: 'A4' | 'LETTER' | { width: number, height: number };
        orientation?: 'portrait' | 'landscape';
        margins: { top: number; right: number; bottom: number; left: number };
        fontFamily: string;
        fontSize: number;
        lineHeight: number;
        /** Background fill colour for every page, e.g. "#fdf6ee" for a warm paper tone. */
        pageBackground?: string;
        /** Optical story wrap underhang: allow full-width lines once their top clears an obstacle bottom. */
        storyWrapOpticalUnderhang?: boolean;
        /** Optional world substrate for this document. When present, root elements inhabit the world plain. */
        worldPlain?: WorldPlainOptions;
        headerInsetTop?: number;
        headerInsetBottom?: number;
        footerInsetTop?: number;
        footerInsetBottom?: number;
        pageReservationOnFirstPageStart?: number;
        pageStartReservationSelector?: PageReservationSelector;
        pageStartExclusionTop?: number;
        pageStartExclusionHeight?: number;
        pageStartExclusionX?: number;
        pageStartExclusionWidth?: number;
        pageStartExclusionX2?: number;
        pageStartExclusionWidth2?: number;
        pageStartExclusionLeftWidth?: number;
        pageStartExclusionRightWidth?: number;
        pageStartExclusionSelector?: PageReservationSelector;
        pageNumberStart?: number;
        lang?: string;
        direction?: TextDirection;
        hyphenation?: HyphenationMode;
        hyphenateCaps?: boolean;
        hyphenMinWordLength?: number;
        hyphenMinPrefix?: number;
        hyphenMinSuffix?: number;
        justifyEngine?: JustifyEngineMode;
        justifyStrategy?: JustifyStrategy;
        progression?: SimulationProgressionConfig;
        /**
         * Internal opt-in for building the post-layout interaction map.
         * Disabled by default so non-interactive callers do not pay the cost.
         */
        emitInteractionMap?: boolean;
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
    header?: PageRegionDefinition;
    footer?: PageRegionDefinition;
    printPipeline?: {
        tableOfContents?: {
            reservedPageCount: number;
            title?: string;
            titleType?: string;
            entryType?: string;
            indentPerLevel?: number;
            includeTitle?: boolean;
        };
    };
    scripting?: LayoutScriptingConfig;
    preloadFontFamilies?: string[];
    debug?: boolean;
}

export interface DocumentInput {
    documentVersion: VmprintDocumentVersion;
    layout: LayoutConfig['layout'];
    fonts?: LayoutConfig['fonts'];
    styles: LayoutConfig['styles'];
    elements: Element[];
    header?: PageRegionDefinition;
    footer?: PageRegionDefinition;
    printPipeline?: LayoutConfig['printPipeline'];
    methods?: Record<string, ScriptMethodSource>;
    scriptVars?: Record<string, unknown>;
    onBeforeLayout?: string;
    onAfterSettle?: string;
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
    glyphs?: { char: string, x: number, y: number }[];
    ascent?: number;
    style: ElementStyle;
    decorationOffset?: number;
    properties?: Record<string, any>;
    meta?: BoxMeta;
}

export interface BoxMeta {
    actorId?: string;
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
    transformKind?: 'clone' | 'split' | 'morph';
    clonedFromSourceId?: string;
}

export interface DebugRegion {
    fieldActorId: string;
    fieldSourceId: string;
    sourceKind: 'zone-map' | 'world-plain';
    regionId?: string;
    regionIndex: number;
    zoneId?: string;
    zoneIndex: number;
    x: number;
    y: number;
    w: number;
    h: number;
    frameOverflowMode: 'move-whole' | 'continue';
    worldBehaviorMode: ZoneWorldBehavior;
}

export interface Page {
    index: number;
    boxes: Box[];
    width: number;
    height: number;
    debugRegions?: DebugRegion[];
}

export interface AnnotatedLayoutStream {
    streamVersion: '1.0';
    config: Omit<LayoutConfig, 'debug'>;
    pages: Page[];
}
