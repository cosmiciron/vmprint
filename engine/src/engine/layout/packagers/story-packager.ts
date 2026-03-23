/**
 * StoryPackager – DTP-style "rocks in a river" layout.
 *
 * A `story` element groups a continuous stream of text and images.  Images
 * carry a `placement` directive that declares how they sit relative
 * to the text flow:
 *
 *   mode: 'float'          – anchored at the current text cursor; moves with
 *                            the text (left/right/center-aligned).
 *   mode: 'story-absolute' – pinned at a fixed (x, y) offset from the
 *                            story's own origin, independent of text flow.
 *
 *   wrap: 'around'         – text snakes to the side(s) of the obstacle.
 *   wrap: 'top-bottom'     – text clears the obstacle entirely (no side text).
 *   wrap: 'none'           – image overlaps text; no reflow at all.
 *
 * Implementation notes
 * --------------------
 * All internal coordinates are *story-local* (origin = top of the story's
 * content area).  The paginator shifts box.y by its running page cursor,
 * exactly as it does for every other PackagerUnit.
 *
 * The two-pass pour:
 *   Pass 1 – register story-absolute obstacles in the SpatialMap.
 *   Pass 2 – pour children top-to-bottom; for each text element, use a
 *             stateful lineLayoutResolver that queries the SpatialMap to
 *             supply per-line (width, xOffset, yOffset) to wrapRichSegments.
 *             The resolver also handles top-bottom obstacle skips mid-element
 *             by accumulating an extra-Y bonus that shifts subsequent lines.
 *
 * The resulting per-line layout data is stored in _lineOffsets / _lineWidths /
 * _lineYOffsets on each box, which the renderer already knows how to use
 * (same mechanism as drop-cap and other non-uniform-width layouts).
 *
 * Dual-column wrapping (text on both sides of a center obstacle)
 * --------------------------------------------------------------
 * When the SpatialMap returns multiple intervals for a single line (e.g. a
 * centered float carves a hole in the middle of the column), the resolver
 * queues secondary intervals at the same yOffset and serves them on the next
 * lineIndex call.  The token stream flows continuously across all intervals:
 * left slot is filled first, then the right slot picks up where the left left
 * off.  Both slots share the same _lineYOffsets entry, so the renderer places
 * them on the same baseline; _lineOffsets provides the per-slot X position.
 */

import { Box, BoxImagePayload, Element, ElementStyle, RichLine, StoryFloatAlign, StoryLayoutDirective, StoryWrapMode } from '../../types';
import { LayoutProcessor } from '../layout-core';
import { LayoutUtils } from '../layout-utils';
import { normalizeStoryElement, type NormalizedStoryChild } from '../normalized-story';
import { buildPackagerForElement } from './create-packagers';
import { FlowBoxPackager } from './flow-box-packager';
import { createContinuationIdentity, createElementPackagerIdentity, PackagerIdentity } from './packager-identity';
import {
    LayoutBox,
    PackagerContext,
    PackagerPlacementPreference,
    PackagerSplitResult,
    PackagerTransformProfile,
    PackagerUnit
} from './packager-types';
import { OccupiedRect, SpatialMap } from './spatial-map';

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

/** An obstacle from a previous page that extends into the current one. */
type CarryOverObstacle = {
    x: number;
    w: number;
    remainingH: number;
    wrap: StoryWrapMode;
    gap: number;
    gapTop?: number;
    gapBottom?: number;
};

type PlacedTextElement = {
    kind: 'text';
    childIndex: number;
    box: Box;
    topY: number;       // box.y (= cursorBefore + marginTop)
    contentH: number;   // box.h
    insetV: number;
    marginTop: number;
    marginBottom: number;
    cursorAfter: number;
    sourceElement: Element;
    lines: RichLine[];
    lineYOffsets: number[];
    lineOffsets: number[];
    lineWidths: number[];
    uniformLH: number;
};

type PlacedImageElement = {
    kind: 'image';
    childIndex: number;
    box: Box;
    topY: number;
    bottomY: number;
    isFloat: boolean;
    isAbsolute: boolean;
};

type PlacedFloatBlock = {
    kind: 'float-block';
    childIndex: number;
    allBoxes: Box[];
    topY: number;
    bottomY: number;
    isAbsolute: boolean;
};

type PlacedElement = PlacedTextElement | PlacedImageElement | PlacedFloatBlock;

type FullPourResult = {
    placedElements: PlacedElement[];
    registeredObstacles: OccupiedRect[];
    totalHeight: number;
    allBoxes: Box[];
};

type StoryColumnRegion = {
    index: number;
    x: number;
    w: number;
    h: number;
};

type MultiColumnContinuation = {
    continuationElement: Element | null;
    continuationPackager: PackagerUnit | null;
    nextChildIndex: number;
    carryOvers: CarryOverObstacle[];
    consumedStoryHeight: number;
};

type MultiColumnPourResult = {
    registeredObstacles: OccupiedRect[];
    occupiedHeight: number;
    totalHeight: number;
    allBoxes: Box[];
    hasOverflow: boolean;
    continuation: MultiColumnContinuation | null;
};

type StoryPourResult = FullPourResult | MultiColumnPourResult;

type StoryViewportSnapshot = {
    pageIndex: number;
    viewportWorldY: number | null;
    viewportHeight: number | null;
};

// ---------------------------------------------------------------------------
// FrozenStoryPackager – holds pre-split partA boxes
// ---------------------------------------------------------------------------

class FrozenStoryPackager implements PackagerUnit {
    private readonly frozenBoxes: Box[];
    private readonly frozenHeight: number;
    private readonly minimumPlacementWidth: number | null;
    readonly actorId: string;
    readonly sourceId: string;
    readonly actorKind: string;
    readonly fragmentIndex: number;
    readonly continuationOf?: string;

    constructor(boxes: Box[], height: number, identity: PackagerIdentity, minimumPlacementWidth?: number | null) {
        this.frozenBoxes = boxes;
        this.frozenHeight = height;
        this.minimumPlacementWidth =
            minimumPlacementWidth !== null && minimumPlacementWidth !== undefined
                ? Math.max(0, Number(minimumPlacementWidth))
                : null;
        this.actorId = identity.actorId;
        this.sourceId = identity.sourceId;
        this.actorKind = identity.actorKind;
        this.fragmentIndex = identity.fragmentIndex;
        this.continuationOf = identity.continuationOf;
    }

    prepare(_aw: number, _ah: number, _ctx: PackagerContext): void {
        // Frozen content is already materialized.
    }

    getPlacementPreference(fullAvailableWidth: number, _context: PackagerContext): PackagerPlacementPreference | null {
        if (this.minimumPlacementWidth === null) {
            return null;
        }
        return {
            minimumWidth: Math.max(this.minimumPlacementWidth, fullAvailableWidth),
            acceptsFrame: true
        };
    }

    getTransformProfile(): PackagerTransformProfile {
        return {
            capabilities: [
                {
                    kind: 'split',
                    preservesIdentity: true,
                    producesContinuation: true
                }
            ]
        };
    }

    emitBoxes(_aw: number, _ah: number, _ctx: PackagerContext): Box[] {
        return this.frozenBoxes.map((b) => ({ ...b, properties: { ...(b.properties || {}) } }));
    }

    split(_ah: number, _ctx: PackagerContext): PackagerSplitResult {
        return { currentFragment: null, continuationFragment: this };
    }

    getRequiredHeight(): number { return this.frozenHeight; }
    isUnbreakable(_ah: number): boolean { return true; }
    getMarginTop(): number { return 0; }
    getMarginBottom(): number { return 0; }
}

// ---------------------------------------------------------------------------
// StoryPackager
// ---------------------------------------------------------------------------

export class StoryPackager implements PackagerUnit {
    private readonly storyElement: Element;
    private readonly normalizedStory;
    private readonly processor: LayoutProcessor;
    private readonly storyIndex: number;
    /** Obstacles carried over from the preceding page (already started there). */
    private readonly initialObstacles: CarryOverObstacle[];
    private readonly deferredLeadingPackager: PackagerUnit | null;
    /**
     * The story-local Y of this packager's origin relative to the overall
     * story.  For page-1 this is 0; for continuation pages it equals the
     * splitH at which the preceding page ended.  Used to re-anchor
     * story-absolute images on continuation pages.
     */
    private readonly storyYOffset: number;

    private lastResult: StoryPourResult | null = null;
    private lastAvailableWidth: number = -1;
    private lastAvailableHeight: number = -1;
    private lastViewportSnapshot: StoryViewportSnapshot | null = null;

    readonly pageBreakBefore: boolean = false;
    readonly keepWithNext: boolean = false;
    readonly actorId: string;
    readonly sourceId: string;
    readonly actorKind: string;
    readonly fragmentIndex: number;
    readonly continuationOf?: string;

    constructor(
        storyElement: Element,
        processor: LayoutProcessor,
        storyIndex: number,
        initialObstacles?: CarryOverObstacle[],
        storyYOffset?: number,
        identity?: PackagerIdentity,
        deferredLeadingPackager?: PackagerUnit | null
    ) {
        this.storyElement = storyElement;
        this.normalizedStory = normalizeStoryElement(storyElement);
        this.processor = processor;
        this.storyIndex = storyIndex;
        this.initialObstacles = initialObstacles ?? [];
        this.storyYOffset = storyYOffset ?? 0;
        this.deferredLeadingPackager = deferredLeadingPackager ?? null;
        const resolvedIdentity = identity ?? createElementPackagerIdentity(storyElement, [storyIndex]);
        this.actorId = resolvedIdentity.actorId;
        this.sourceId = resolvedIdentity.sourceId;
        this.actorKind = resolvedIdentity.actorKind;
        this.fragmentIndex = resolvedIdentity.fragmentIndex;
        this.continuationOf = resolvedIdentity.continuationOf;
    }

    // -- PackagerUnit ---------------------------------------------------------

    prepare(availableWidth: number, availableHeight: number, context: PackagerContext): void {
        const viewportSnapshot = resolveViewportSnapshot(context);
        if (
            this.lastAvailableWidth === availableWidth &&
            this.lastAvailableHeight === availableHeight &&
            sameViewportSnapshot(this.lastViewportSnapshot, viewportSnapshot) &&
            this.lastResult
        ) {
            return;
        }
        const columnConfig = this.getStoryColumnConfig();
        const result =
            columnConfig.columns > 1
                ? this.pourColumns(availableWidth, availableHeight, context, columnConfig.columns, columnConfig.gutter, columnConfig.balance)
                : this.pourAll(availableWidth, context);
        this.lastResult = result;
        this.lastAvailableWidth = availableWidth;
        this.lastAvailableHeight = availableHeight;
        this.lastViewportSnapshot = viewportSnapshot;
    }

    prepareLookahead(availableWidth: number, _availableHeight: number, context: PackagerContext): void {
        const columnConfig = this.getStoryColumnConfig();
        if (columnConfig.columns <= 1) {
            this.prepare(availableWidth, _availableHeight, context);
            return;
        }
        const viewportSnapshot = resolveViewportSnapshot(context);
        if (
            this.lastAvailableWidth === availableWidth &&
            !Number.isFinite(this.lastAvailableHeight) &&
            sameViewportSnapshot(this.lastViewportSnapshot, viewportSnapshot) &&
            this.lastResult
        ) {
            return;
        }
        // Keep-with-next planning only needs a conservative fit probe. For multi-column stories,
        // reuse the cheaper width-driven full-pour instead of a commit-grade column simulation.
        this.lastResult = this.pourAll(availableWidth, context);
        this.lastAvailableWidth = availableWidth;
        this.lastAvailableHeight = Number.POSITIVE_INFINITY;
        this.lastViewportSnapshot = viewportSnapshot;
    }

    getPlacementPreference(fullAvailableWidth: number, _context: PackagerContext): PackagerPlacementPreference | null {
        const columnConfig = this.getStoryColumnConfig();
        if (columnConfig.columns > 1) {
            return {
                minimumWidth: fullAvailableWidth,
                acceptsFrame: true
            };
        }
        return null;
    }

    getTransformProfile(): PackagerTransformProfile {
        return {
            capabilities: [
                {
                    kind: 'split',
                    preservesIdentity: true,
                    producesContinuation: true
                },
                {
                    kind: 'morph',
                    preservesIdentity: true,
                    reflowsContent: true
                }
            ]
        };
    }

    emitBoxes(availableWidth: number, availableHeight: number, context: PackagerContext): LayoutBox[] {
        this.prepare(availableWidth, availableHeight, context);
        return cloneBoxes(this.lastResult?.allBoxes || [], context.pageIndex);
    }

    getRequiredHeight(): number {
        return this.lastResult?.totalHeight ?? 0;
    }

    isUnbreakable(_availableHeight: number): boolean {
        return false;
    }

    getMarginTop(): number { return 0; }
    getMarginBottom(): number { return 0; }

    split(availableHeight: number, context: PackagerContext): PackagerSplitResult {
        const availableWidth = this.lastAvailableWidth > 0
            ? this.lastAvailableWidth
            : (context.pageWidth - context.margins.left - context.margins.right);

        const columnConfig = this.getStoryColumnConfig();
        const result = this.lastResult ?? (
            columnConfig.columns > 1
                ? this.pourColumns(availableWidth, availableHeight, context, columnConfig.columns, columnConfig.gutter, columnConfig.balance)
                : this.pourAll(availableWidth, context)
        );
        if (columnConfig.columns > 1) {
            return this.splitColumns(result as MultiColumnPourResult, availableWidth);
        }
        return this.splitResult(result as FullPourResult, availableHeight, availableWidth, context.margins);
    }

    // -- Core pour ------------------------------------------------------------

    private pourAll(
        availableWidth: number,
        context: PackagerContext
    ): FullPourResult {
        const margins = context.margins;
        const children = this.normalizedStory.children;
        const storyMap = new SpatialMap();
        const registeredObstacles: OccupiedRect[] = [];
        const imageMetricsCache = new Map<number, { img: BoxImagePayload; w: number; h: number } | null>();

        const resolveImageMetrics = (child: Element, index: number): { img: BoxImagePayload; w: number; h: number } | null => {
            if (!child.image) return null;
            if (imageMetricsCache.has(index)) return imageMetricsCache.get(index)!;
            const imgData = this.resolveImage(child);
            if (!imgData) {
                imageMetricsCache.set(index, null);
                return null;
            }
            const { w, h } = this.measureImageBox(child, imgData, availableWidth);
            const cached = { img: imgData, w, h };
            imageMetricsCache.set(index, cached);
            return cached;
        };

        // Pre-register carry-over obstacles at Y=0 (they bleed in from the
        // previous page and occupy the top of this continuation page).
        for (const co of this.initialObstacles) {
            const rect: OccupiedRect = {
                x: co.x, y: 0, w: co.w, h: co.remainingH, wrap: co.wrap, gap: co.gap,
                gapTop: co.gapTop, gapBottom: co.gapBottom
            };
            storyMap.register(rect);
            registeredObstacles.push(rect);
        }

        // -------------------------------------------------------------------
        // Pass 1 – register story-absolute obstacles in the SpatialMap so
        //          that text-wrap decisions in Pass 2 can account for them.
        // -------------------------------------------------------------------
        for (let i = 0; i < children.length; i++) {
            const child = children[i];
            if (child.kind !== 'story-absolute') continue;
            const layout = child.layout!;
            if (layout.wrap === 'none') continue;

            const dims = child.element.image
                ? resolveImageMetrics(child.element, child.childIndex)
                : this.measureFloatBox(child.element, availableWidth);
            if (!dims) continue;
            const localY = layout.y - this.storyYOffset;
            if (localY + dims.h < 0) continue; // wholly before this page's origin

            const rect: OccupiedRect = {
                x: layout.x,
                y: Math.max(0, localY),
                w: dims.w,
                h: dims.h,
                wrap: layout.wrap,
                gap: layout.gap
            };
            storyMap.register(rect);
            registeredObstacles.push(rect);
        }

        // -------------------------------------------------------------------
        // Pass 2 – pour
        // -------------------------------------------------------------------
        const placedElements: PlacedElement[] = [];
        const allBoxes: Box[] = [];
        let cursorY = 0;

        for (let i = 0; i < children.length; i++) {
            const child = children[i];
            const layout = child.layout;

            // ---- story-absolute element ------------------------------------
            if (child.kind === 'story-absolute' && layout) {
                const localY = layout.y - this.storyYOffset;
                const effectiveY = Math.max(0, localY);

                if (child.element.image) {
                    const metrics = resolveImageMetrics(child.element, child.childIndex);
                    if (!metrics) continue;
                    const { img: imgData, w: imgW, h: imgH } = metrics;
                    if (localY + imgH < 0) continue; // wholly before this page's origin
                    const x = layout.x;
                    const box = this.buildImageBox(child.element, margins.left + x, effectiveY, imgW, imgH, imgData, child.childIndex);
                    allBoxes.push(box);
                    placedElements.push({
                        kind: 'image', childIndex: child.childIndex, box,
                        topY: effectiveY, bottomY: effectiveY + imgH, isFloat: false, isAbsolute: true
                    });
                    continue;
                }

                const dims = this.measureFloatBox(child.element, availableWidth);
                if (!dims) continue;
                if (localY + dims.h < 0) continue; // wholly before this page's origin
                const pkg = buildPackagerForElement(child.element, child.childIndex, this.processor);
                const absoluteContext: PackagerContext = {
                    ...this.createLocalFrameContext(
                        context,
                        dims.w,
                        {
                            cursorY: effectiveY,
                            margins: { ...margins, left: margins.left + layout.x },
                            pageHeight: Number.POSITIVE_INFINITY
                        },
                        effectiveY,
                        dims.h
                    )
                };
                pkg.prepare(dims.w, dims.h, absoluteContext);
                const emitted = (pkg.emitBoxes(dims.w, dims.h, absoluteContext) || []) as Box[];
                for (const b of emitted) b.y = (b.y || 0) + effectiveY;
                for (const b of emitted) allBoxes.push(b);
                placedElements.push({
                    kind: 'float-block',
                    childIndex: child.childIndex,
                    allBoxes: emitted,
                    topY: effectiveY,
                    bottomY: effectiveY + dims.h,
                    isAbsolute: true
                });
                continue;
            }

            // ---- float image -----------------------------------------------
            if (child.kind === 'float-image' && layout) {
                const metrics = resolveImageMetrics(child.element, child.childIndex);
                if (!metrics) continue;
                const { img: imgData, w: imgW, h: imgH } = metrics;

                // Floats anchor at the current text cursor; advance past any
                // top-bottom blocks first so they sit beside readable text.
                cursorY = storyMap.topBottomClearY(cursorY);

                const align: StoryFloatAlign = layout.align;
                const floatX = resolveFloatX(align, imgW, availableWidth);
                const wrap: StoryWrapMode = layout.wrap;
                const gap = layout.gap;

                if (wrap !== 'none') {
                    const rect: OccupiedRect = {
                        x: floatX, y: cursorY, w: imgW, h: imgH, wrap, gap
                    };
                    storyMap.register(rect);
                    registeredObstacles.push(rect);
                }

                const box = this.buildImageBox(
                    child.element, margins.left + floatX, cursorY, imgW, imgH, imgData, child.childIndex
                );
                allBoxes.push(box);
                placedElements.push({
                    kind: 'image', childIndex: child.childIndex, box,
                    topY: cursorY, bottomY: cursorY + imgH, isFloat: true, isAbsolute: false
                });
                // Floats do NOT advance cursorY — text flows alongside them.
                continue;
            }

            // ---- float block (non-image element with layout.mode === 'float') ---
            if (child.kind === 'float-block' && layout) {
                const dims = this.measureFloatBox(child.element, availableWidth);
                if (dims) {
                    cursorY = storyMap.topBottomClearY(cursorY);

                    const align: StoryFloatAlign = layout.align;
                    const floatX = resolveFloatX(align, dims.w, availableWidth);
                    const wrap: StoryWrapMode = layout.wrap;
                    const gap = layout.gap;

                    if (wrap !== 'none') {
                        const rect: OccupiedRect = { x: floatX, y: cursorY, w: dims.w, h: dims.h, wrap, gap };
                        storyMap.register(rect);
                        registeredObstacles.push(rect);
                    }

                    const pkg = buildPackagerForElement(child.element, child.childIndex, this.processor);
                    const floatContext: PackagerContext = {
                        ...this.createLocalFrameContext(
                            context,
                            dims.w,
                            {
                                cursorY,
                                margins: { ...margins, left: margins.left + floatX },
                                pageHeight: Number.POSITIVE_INFINITY
                            },
                            cursorY,
                            dims.h
                        )
                    };
                    pkg.prepare(dims.w, dims.h, floatContext);
                    const emitted = (pkg.emitBoxes(dims.w, dims.h, floatContext) || []) as Box[];
                    for (const b of emitted) b.y = (b.y || 0) + cursorY;
                    for (const b of emitted) allBoxes.push(b);
                    placedElements.push({
                        kind: 'float-block',
                        childIndex: child.childIndex,
                        allBoxes: emitted,
                        topY: cursorY,
                        bottomY: cursorY + dims.h,
                        isAbsolute: false
                    });
                    // Float blocks do NOT advance cursorY — text flows alongside them.
                    continue;
                }
                // dims is null (missing style.width/height) → fall through to pourTextChild
            }

            // ---- block image (no layout directive, or unrecognised mode) ---
            if (child.kind === 'block-image') {
                const metrics = resolveImageMetrics(child.element, child.childIndex);
                if (!metrics) continue;
                const { img: imgData, w: imgW, h: imgH } = metrics;

                cursorY = storyMap.topBottomClearY(cursorY);
                const flowBox = (this.processor as any).shapeElement(
                    child.element, { path: [this.storyIndex, child.childIndex] }
                );
                const marginTop = Math.max(0, flowBox.marginTop);
                const marginBottom = Math.max(0, flowBox.marginBottom);
                const boxY = cursorY + marginTop;

                const box = this.buildImageBox(
                    child.element, margins.left, boxY, imgW, imgH, imgData, child.childIndex
                );
                allBoxes.push(box);
                placedElements.push({
                    kind: 'image', childIndex: child.childIndex, box,
                    topY: boxY, bottomY: boxY + imgH, isFloat: false, isAbsolute: false
                });
                cursorY = boxY + imgH + marginBottom;
                continue;
            }

            // ---- text / block element --------------------------------------
            const placed = this.pourTextChild(
                child.element, child.childIndex, availableWidth, margins, storyMap, cursorY
            );
            if (placed) {
                allBoxes.push(placed.box);
                placedElements.push(placed);
                cursorY = placed.cursorAfter;
            }
        }

        // Story height = max of text cursor and the bottom of any obstacle
        // (a tall float can extend below the last line of text).
        const totalHeight = Math.max(cursorY, storyMap.maxObstacleBottom());

        return { placedElements, registeredObstacles, totalHeight, allBoxes };
    }

    // -- Text element pour ---------------------------------------------------

    private pourTextChild(
        element: Element,
        childIndex: number,
        availableWidth: number,
        margins: { left: number },
        storyMap: SpatialMap,
        cursorY: number,
        xOffset: number = 0
    ): PlacedTextElement | null {
        // Shape gives us style, meta, and margin values.
        const flowBox = (this.processor as any).shapeElement(
            element, { path: [this.storyIndex, childIndex] }
        );
        const style: ElementStyle = flowBox.style;
        const fontSize = Number(style.fontSize || (this.processor as any).config.layout.fontSize);
        const lineHeightRatio = Number(style.lineHeight || (this.processor as any).config.layout.lineHeight);
        const uniformLH = lineHeightRatio * fontSize;

        const marginTop = Math.max(0, flowBox.marginTop);
        const marginBottom = Math.max(0, flowBox.marginBottom);

        // Advance the cursor past any top-bottom obstacles before this element
        // begins.  (Mid-element top-bottom skips are handled by the resolver.)
        cursorY = storyMap.topBottomClearY(cursorY);
        const elementStartY = cursorY + marginTop; // absolute story-local Y of box top

        const richSegments = (this.processor as any).getRichSegments(element, style);
        const font = (this.processor as any).resolveMeasurementFontForStyle(style);
        const letterSpacing = Number(style.letterSpacing || 0);
        const textIndent = Number(style.textIndent || 0);
        const insetH = LayoutUtils.getHorizontalInsets(style);
        const insetV = LayoutUtils.getVerticalInsets(style);
        const contentWidth = Math.max(0, availableWidth - insetH);
        const opticalUnderhang = !!((this.processor as any).config?.layout?.storyWrapOpticalUnderhang);

        // -------------------------------------------------------------------
        // Stateful line-layout resolver with dual-stream support
        //
        // The resolver is called by wrapRichSegments with lineIndex 0, 1, 2, …
        // in strict ascending order (wrapTokenStream is a sequential pass).
        //
        // `physicalLineCount` tracks unique Y positions consumed so far.
        // `pendingSlots` holds pre-computed extra intervals for the current
        // physical row (e.g. the right flank of a centered float).  When
        // `pendingSlots` is non-empty we return the next slot at the SAME
        // yOffset as the previous call without advancing physicalLineCount —
        // producing two consecutive wrapRichSegments lines that share the
        // same Y.  The renderer already handles equal yOffset entries via
        // `_lineYOffsets` / `_lineOffsets`.
        //
        // `accumulatedYBonus` models top-bottom obstacle skips: when a line's
        // natural Y falls inside a top-bottom obstacle we advance past the
        // obstacle and add the gap to accumulatedYBonus so that all subsequent
        // lines are pushed down by the same amount.
        // -------------------------------------------------------------------
        let accumulatedYBonus = 0;
        let physicalLineCount = 0;
        const pendingSlots: Array<{ width: number; xOffset: number; yOffset: number }> = [];

        const lineLayoutOut: { widths: number[]; offsets: number[]; yOffsets: number[] } = {
            widths: [], offsets: [], yOffsets: []
        };

        const resolver = (lineIndex: number): { width: number; xOffset: number; yOffset: number } => {
            // Serve any queued secondary slots first.  These are extra
            // intervals at the same physical Y (e.g. right flank of a center
            // float).  Do NOT advance physicalLineCount for these.
            if (pendingSlots.length > 0) {
                return pendingSlots.shift()!;
            }

            // Compute the story-local Y for this new physical line.
            let lineY = elementStartY + physicalLineCount * uniformLH + accumulatedYBonus;

            // Advance past any chained top-bottom obstacles that block this line.
            while (storyMap.hasTopBottomBlock(lineY, uniformLH)) {
                const clearY = storyMap.topBottomClearY(lineY);
                accumulatedYBonus += clearY - lineY;
                lineY = elementStartY + physicalLineCount * uniformLH + accumulatedYBonus;
            }

            const yOffset = physicalLineCount * uniformLH + accumulatedYBonus;
            physicalLineCount++;

            const resolvedIntervals = storyMap.getAvailableIntervals(
                lineY,
                uniformLH,
                availableWidth,
                opticalUnderhang ? { opticalUnderhang: true } : undefined
            );

            if (resolvedIntervals.length === 0) {
                // Fully blocked (should not happen after the loop above, but
                // guard against degenerate obstacle configurations).
                return { width: contentWidth, xOffset: 0, yOffset };
            }

            if (resolvedIntervals.length > 1) {
                // Dual-stream: queue all secondary intervals at the same yOffset.
                // The token stream flows continuously: left interval is filled
                // first, then right interval picks up where left left off.
                for (let j = 1; j < resolvedIntervals.length; j++) {
                    pendingSlots.push({
                        width: Math.max(0, resolvedIntervals[j].w - insetH),
                        xOffset: resolvedIntervals[j].x,
                        yOffset
                    });
                }
            }

            return {
                width: Math.max(0, resolvedIntervals[0].w - insetH),
                xOffset: resolvedIntervals[0].x,
                yOffset
            };
        };

        const lines: RichLine[] = (this.processor as any).wrapRichSegments(
            richSegments,
            contentWidth,
            font,
            fontSize,
            letterSpacing,
            textIndent,
            resolver,
            lineLayoutOut
        );

        if (!lines || lines.length === 0) return null;

        // Height of the content area (accounts for any Y-jumps from obstacle
        // skips via calculateLineBlockHeight's lineYOffsets branch).
        const linesH: number = (this.processor as any).calculateLineBlockHeight(
            lines, style, lineLayoutOut.yOffsets
        );
        const contentH = linesH + insetV;

        const box: Box = {
            type: element.type,
            x: margins.left + xOffset,
            y: elementStartY,
            w: availableWidth + insetH,
            h: contentH,
            lines,
            style,
            properties: {
                ...(flowBox.properties || {}),
                _lineOffsets: lineLayoutOut.offsets,
                _lineWidths: lineLayoutOut.widths,
                _lineYOffsets: lineLayoutOut.yOffsets,
                _isFirstLine: true,
                _isLastLine: true,
            },
            meta: { ...flowBox.meta, pageIndex: 0 }
        };

        return {
            kind: 'text',
            childIndex,
            box,
            topY: elementStartY,
            contentH,
            insetV,
            marginTop,
            marginBottom,
            cursorAfter: elementStartY + contentH + marginBottom,
            sourceElement: element,
            lines,
            lineYOffsets: lineLayoutOut.yOffsets,
            lineOffsets: lineLayoutOut.offsets,
            lineWidths: lineLayoutOut.widths,
            uniformLH,
        };
    }

    // -- Split ---------------------------------------------------------------

    private getStoryColumnConfig(): { columns: number; gutter: number; balance: boolean } {
        return {
            columns: this.normalizedStory.columns,
            gutter: this.normalizedStory.gutter,
            balance: this.normalizedStory.balance
        };
    }

    private buildColumnRegions(
        availableWidth: number,
        availableHeight: number,
        columns: number,
        gutter: number
    ): StoryColumnRegion[] {
        const n = Math.max(1, Math.floor(columns));
        const h = Math.max(0, Number(availableHeight) || 0);
        if (n <= 1 || availableWidth <= 0) {
            return [{ index: 0, x: 0, w: Math.max(0, availableWidth), h }];
        }

        const maxGutter = n > 1 ? (availableWidth / (n - 1)) : 0;
        const normalizedGutter = Math.min(Math.max(0, gutter), maxGutter);
        const totalGutter = normalizedGutter * (n - 1);
        const baseW = Math.max(1, (availableWidth - totalGutter) / n);
        const regions: StoryColumnRegion[] = [];
        let x = 0;
        for (let idx = 0; idx < n; idx++) {
            const remaining = Math.max(1, availableWidth - x - normalizedGutter * Math.max(0, n - idx - 1));
            const w = idx === n - 1 ? remaining : Math.max(1, baseW);
            regions.push({ index: idx, x, w, h });
            x += w + normalizedGutter;
        }
        return regions;
    }

    private projectObstacleToRegion(rect: OccupiedRect, region: StoryColumnRegion): OccupiedRect | null {
        const left = Math.max(region.x, rect.x);
        const right = Math.min(region.x + region.w, rect.x + rect.w);
        if (right <= left) return null;
        return {
            x: left - region.x,
            y: rect.y,
            w: right - left,
            h: rect.h,
            wrap: rect.wrap,
            gap: rect.gap,
            gapTop: rect.gapTop,
            gapBottom: rect.gapBottom
        };
    }

    private createRegionMap(region: StoryColumnRegion, obstacles: OccupiedRect[]): SpatialMap {
        const map = new SpatialMap();
        for (const obs of obstacles) {
            const projected = this.projectObstacleToRegion(obs, region);
            if (!projected) continue;
            map.register(projected);
        }
        return map;
    }

    private resolveColumnFrontierY(
        currentCursorY: number,
        boxes: Box[],
        obstacles: OccupiedRect[]
    ): number {
        let frontierY = Math.max(0, currentCursorY);

        for (const box of boxes) {
            frontierY = Math.max(frontierY, Number(box.y || 0) + Number(box.h || 0));
        }

        for (const obstacle of obstacles) {
            frontierY = Math.max(
                frontierY,
                Number(obstacle.y || 0) + Number(obstacle.h || 0) + Number(obstacle.gapBottom ?? obstacle.gap ?? 0)
            );
        }

        return frontierY;
    }

    private pourColumns(
        availableWidth: number,
        availableHeight: number,
        context: PackagerContext,
        columns: number,
        gutter: number,
        balance: boolean = false
    ): MultiColumnPourResult {
        const margins = context.margins;
        if (!Number.isFinite(availableHeight) || availableHeight <= 0) {
            const single = this.pourAll(availableWidth, context);
            return {
                registeredObstacles: single.registeredObstacles,
                occupiedHeight: single.totalHeight,
                totalHeight: single.totalHeight,
                allBoxes: single.allBoxes,
                hasOverflow: false,
                continuation: null
            };
        }

        // --- Column balancing ------------------------------------------------
        // When balance is true, pre-measure the total content height at column
        // width, then cap each column at ceil(totalH / numColumns).  This
        // distributes content evenly (CSS `column-fill: balance` semantics)
        // instead of packing everything into the first column.
        let effectiveHeight = availableHeight;
        if (balance) {
            const tempRegions = this.buildColumnRegions(availableWidth, 1, columns, gutter);
            if (tempRegions.length > 1) {
                const colW = tempRegions[0].w;
                const probe = this.pourAll(colW, {
                    ...context,
                    margins: { left: 0, right: 0, top: 0, bottom: 0 }
                });
                if (probe.totalHeight > 0) {
                    // Add a 5 % buffer so margin / orphan rounding does not
                    // cause the last column to silently overflow by one line.
                    const target = Math.ceil((probe.totalHeight / columns) * 1.05);
                    effectiveHeight = Math.max(1, Math.min(availableHeight, target));
                }
            }
        }

        let regions = this.buildColumnRegions(availableWidth, effectiveHeight, columns, gutter);
        if (regions.length <= 1) {
            const single = this.pourAll(availableWidth, context);
            return {
                registeredObstacles: single.registeredObstacles,
                occupiedHeight: single.totalHeight,
                totalHeight: single.totalHeight,
                allBoxes: single.allBoxes,
                hasOverflow: false,
                continuation: null
            };
        }

        const children = this.normalizedStory.children;
        const registeredObstacles: OccupiedRect[] = [];
        const allObstacles: OccupiedRect[] = [];
        const allBoxes: Box[] = [];
        const imageMetricsCache = new Map<number, { img: BoxImagePayload; w: number; h: number } | null>();
        const maxRegionWidth = Math.max(...regions.map((r) => r.w));

        const resolveImageMetrics = (child: NormalizedStoryChild): { img: BoxImagePayload; w: number; h: number } | null => {
            if (!child.element.image) return null;
            if (imageMetricsCache.has(child.childIndex)) return imageMetricsCache.get(child.childIndex)!;
            const imgData = this.resolveImage(child.element);
            if (!imgData) {
                imageMetricsCache.set(child.childIndex, null);
                return null;
            }
            const { w, h } = this.measureImageBox(child.element, imgData, maxRegionWidth);
            const cached = { img: imgData, w, h };
            imageMetricsCache.set(child.childIndex, cached);
            return cached;
        };

        for (const co of this.initialObstacles) {
            const rect: OccupiedRect = {
                x: co.x,
                y: 0,
                w: co.w,
                h: co.remainingH,
                wrap: co.wrap,
                gap: co.gap,
                gapTop: co.gapTop,
                gapBottom: co.gapBottom
            };
            allObstacles.push(rect);
            registeredObstacles.push(rect);
        }

        for (let i = 0; i < children.length; i++) {
            const child = children[i];
            const layout = child.layout;
            if (child.kind !== 'story-absolute' || !layout) continue;
            if (layout.wrap === 'none') continue;

            const dims = child.element.image
                ? resolveImageMetrics(child)
                : this.measureFloatBox(child.element, maxRegionWidth);
            if (!dims) continue;
            const localY = layout.y - this.storyYOffset;
            if (localY + dims.h < 0 || localY > resolveRegionStackHeight(regions)) continue;
            const projected = projectStoryYToRegionStack(localY, regions);
            if (!projected) continue;

            const rect: OccupiedRect = {
                x: layout.x,
                y: Math.max(0, projected.y),
                w: dims.w,
                h: dims.h,
                wrap: layout.wrap,
                gap: layout.gap
            };
            allObstacles.push(rect);
            registeredObstacles.push(rect);
        }

        let regionIndex = 0;
        let cursorY = 0;
        let hasOverflow = false;
        let continuationElement: Element | null = null;
        let continuationPackager: PackagerUnit | null = null;
        let nextChildIndex = children.length;

        const goNextRegion = (): boolean => {
            if (regionIndex + 1 >= regions.length) return false;
            regionIndex += 1;
            cursorY = 0;
            return true;
        };

        const placeOpaquePackager = (
            pkg: PackagerUnit,
            childIndex: number,
            onSplit: (continuation: PackagerUnit) => void
        ): boolean => {
            opaqueLoop: while (true) {
                const region = regions[regionIndex];
                const regionStartY = resolveRegionStartY(regions, region.index);
                const remainingHeight = Math.max(0, region.h - cursorY);
                const colContext: PackagerContext = {
                    ...this.createLocalFrameContext(
                        context,
                        region.w,
                        {
                            cursorY,
                            margins: { ...margins, left: margins.left + region.x },
                            pageHeight: availableHeight
                        },
                        regionStartY + cursorY,
                        remainingHeight
                    )
                };
                const boxes = (pkg.emitBoxes(region.w, remainingHeight, colContext) || []) as Box[];
                for (const b of boxes) b.y = (b.y || 0) + cursorY;
                const cursorAfter = cursorY + pkg.getRequiredHeight();
                if (cursorAfter <= region.h + 0.1) {
                    for (const b of boxes) allBoxes.push(b);
                    cursorY = cursorAfter;
                    return true;
                }

                const split = pkg.split(remainingHeight, colContext);
                if (split.currentFragment && split.continuationFragment) {
                    const partABoxes = (split.currentFragment.emitBoxes(region.w, remainingHeight, colContext) || []) as Box[];
                    for (const b of partABoxes) {
                        b.y = (b.y || 0) + cursorY;
                        allBoxes.push(b);
                    }
                    cursorY += split.currentFragment.getRequiredHeight();
                    onSplit(split.continuationFragment);
                    hasOverflow = true;
                    nextChildIndex = childIndex + 1;
                    return false;
                }

                if (goNextRegion()) continue opaqueLoop;
                hasOverflow = true;
                nextChildIndex = childIndex;
                return false;
            }
        };

        if (this.deferredLeadingPackager) {
            const completed = placeOpaquePackager(this.deferredLeadingPackager, -1, (continuation) => {
                continuationPackager = continuation;
                nextChildIndex = 0;
            });
            if (!completed) {
                return {
                    registeredObstacles,
                    occupiedHeight: Math.min(Math.max(0, cursorY), availableHeight),
                    totalHeight: availableHeight + 1,
                    allBoxes,
                    hasOverflow,
                    continuation: {
                        continuationElement,
                        continuationPackager,
                        nextChildIndex,
                        carryOvers: [],
                        consumedStoryHeight: resolveRegionStackHeight(regions)
                    }
                };
            }
        }

        outer: for (let i = 0; i < children.length; i++) {
            const child = children[i];
            const layout = child.layout;

            if (child.kind === 'story-absolute' && layout) {
                const localY = layout.y - this.storyYOffset;
                const projected = projectStoryYToRegionStack(localY, regions);
                if (!projected) continue;

                if (child.element.image) {
                    const metrics = resolveImageMetrics(child);
                    if (!metrics) continue;
                    const { img: imgData, w: imgW, h: imgH } = metrics;
                    if (localY + imgH < 0 || localY > resolveRegionStackHeight(regions)) continue;
                    const box = this.buildImageBox(
                        child.element,
                        margins.left + layout.x,
                        Math.max(0, projected.y),
                        imgW,
                        imgH,
                        imgData,
                        child.childIndex
                    );
                    allBoxes.push(box);
                    continue;
                }

                const dims = this.measureFloatBox(child.element, maxRegionWidth);
                if (!dims) continue;
                if (localY + dims.h < 0 || localY > resolveRegionStackHeight(regions)) continue;
                const region = regions[projected.regionIndex];
                const regionStartY = resolveRegionStartY(regions, region.index);
                const pkg = buildPackagerForElement(child.element, child.childIndex, this.processor);
                const absoluteContext: PackagerContext = {
                    ...this.createLocalFrameContext(
                        context,
                        dims.w,
                        {
                            cursorY: Math.max(0, projected.y),
                            margins: { ...margins, left: margins.left + layout.x },
                            pageHeight: Number.POSITIVE_INFINITY
                        },
                        regionStartY + Math.max(0, projected.y),
                        dims.h
                    )
                };
                pkg.prepare(dims.w, dims.h, absoluteContext);
                const emitted = (pkg.emitBoxes(dims.w, dims.h, absoluteContext) || []) as Box[];
                for (const b of emitted) b.y = (b.y || 0) + Math.max(0, projected.y);
                for (const b of emitted) allBoxes.push(b);
                continue;
            }

            // ---- column-spanning element ------------------------------------
            // An element with columnSpan: 'all' (or any number ≥ 2) breaks
            // the column flow, is laid out at full story width, then column
            // flow resumes from column 0 below the spanning element.
            if (child.kind === 'column-span') {
                const spanTopY = this.resolveColumnFrontierY(cursorY, allBoxes, registeredObstacles);
                const spanContext: PackagerContext = {
                    ...this.createLocalFrameContext(
                        context,
                        availableWidth,
                        {
                            cursorY: spanTopY,
                            margins: { ...margins },
                            pageHeight: availableHeight
                        },
                        spanTopY,
                        Math.max(0, availableHeight - spanTopY)
                    )
                };
                const pkg = buildPackagerForElement(child.element, child.childIndex, this.processor);
                pkg.prepare(availableWidth, availableHeight - spanTopY, spanContext);
                const spanH = pkg.getRequiredHeight();

                if (spanTopY + spanH > availableHeight + 0.1) {
                    // Span does not fit on this page → overflow.
                    hasOverflow = true;
                    nextChildIndex = i;
                    break outer;
                }

                const emitted = (pkg.emitBoxes(availableWidth, availableHeight - spanTopY, spanContext) || []) as Box[];
                for (const b of emitted) b.y = (b.y || 0) + spanTopY;
                for (const b of emitted) allBoxes.push(b);

                // Reset column flow: restart at column 0, cursor below the span.
                regionIndex = 0;
                cursorY = spanTopY + spanH;
                continue;
            }

            if (child.kind === 'float-image' && layout) {
                const metrics = resolveImageMetrics(child);
                if (!metrics) continue;
                const { img: imgData, w: imgW, h: imgH } = metrics;

                while (true) {
                    const region = regions[regionIndex];
                    const regionMap = this.createRegionMap(region, allObstacles);
                    const anchorY = regionMap.topBottomClearY(cursorY);
                    if (anchorY > region.h + 0.1) {
                        if (goNextRegion()) continue;
                        hasOverflow = true;
                        nextChildIndex = i;
                        break outer;
                    }

                    const align: StoryFloatAlign = layout.align;
                    const localX = resolveFloatX(align, Math.min(imgW, region.w), region.w);
                    const x = region.x + localX;
                    const wrap: StoryWrapMode = layout.wrap;
                    const gap = layout.gap;
                    if (wrap !== 'none') {
                        const rect: OccupiedRect = { x, y: anchorY, w: Math.min(imgW, region.w), h: imgH, wrap, gap };
                        allObstacles.push(rect);
                        registeredObstacles.push(rect);
                    }

                    const box = this.buildImageBox(child.element, margins.left + x, anchorY, Math.min(imgW, region.w), imgH, imgData, child.childIndex);
                    allBoxes.push(box);
                    cursorY = anchorY;
                    break;
                }
                continue;
            }

            // ---- float block (non-image element with layout.mode === 'float') ---
            if (child.kind === 'float-block' && layout) {
                const dims = this.measureFloatBox(child.element, maxRegionWidth);
                if (dims) {
                    while (true) {
                        const region = regions[regionIndex];
                        const regionMap = this.createRegionMap(region, allObstacles);
                        const anchorY = regionMap.topBottomClearY(cursorY);
                        if (anchorY > region.h + 0.1) {
                            if (goNextRegion()) continue;
                            hasOverflow = true;
                            nextChildIndex = i;
                            break outer;
                        }

                        const align: StoryFloatAlign = layout.align;
                        const effectiveW = Math.min(dims.w, region.w);
                        const localX = resolveFloatX(align, effectiveW, region.w);
                        const x = region.x + localX;
                        const wrap: StoryWrapMode = layout.wrap;
                        const gap = layout.gap;

                        if (wrap !== 'none') {
                            const rect: OccupiedRect = { x, y: anchorY, w: effectiveW, h: dims.h, wrap, gap };
                            allObstacles.push(rect);
                            registeredObstacles.push(rect);
                        }

                        const pkg = buildPackagerForElement(child.element, child.childIndex, this.processor);
                        const regionStartY = resolveRegionStartY(regions, region.index);
                        const floatContext: PackagerContext = {
                            ...this.createLocalFrameContext(
                                context,
                                effectiveW,
                                {
                                    cursorY: anchorY,
                                    margins: { ...margins, left: margins.left + x },
                                    pageHeight: Number.POSITIVE_INFINITY
                                },
                                regionStartY + anchorY,
                                dims.h
                            )
                        };
                        pkg.prepare(effectiveW, dims.h, floatContext);
                        const emitted = (pkg.emitBoxes(effectiveW, dims.h, floatContext) || []) as Box[];
                        for (const b of emitted) b.y = (b.y || 0) + anchorY;
                        for (const b of emitted) allBoxes.push(b);
                        cursorY = anchorY; // float block does NOT advance cursorY
                        break;
                    }
                    continue;
                }
                // dims is null (missing style.width/height) → fall through to FlowBoxPackager path
            }

            if (child.kind === 'block-image') {
                const metrics = resolveImageMetrics(child);
                if (!metrics) continue;
                const { img: imgData, w: imgW, h: imgH } = metrics;
                while (true) {
                    const region = regions[regionIndex];
                    const regionMap = this.createRegionMap(region, allObstacles);
                    const top = regionMap.topBottomClearY(cursorY);
                    const flowBox = (this.processor as any).shapeElement(
                        child.element, { path: [this.storyIndex, child.childIndex] }
                    );
                    const marginTop = Math.max(0, flowBox.marginTop);
                    const marginBottom = Math.max(0, flowBox.marginBottom);
                    const y = top + marginTop;
                    if (y + imgH + marginBottom <= region.h + 0.1) {
                        const box = this.buildImageBox(child.element, margins.left + region.x, y, Math.min(imgW, region.w), imgH, imgData, child.childIndex);
                        allBoxes.push(box);
                        cursorY = y + imgH + marginBottom;
                        break;
                    }
                    if (goNextRegion()) continue;
                    hasOverflow = true;
                    nextChildIndex = i;
                    break outer;
                }
                continue;
            }

            // ----------------------------------------------------------
            // Resolve child to a PackagerUnit via the shared factory.
            //
            // FlowBoxPackager (plain text/box) keeps the SpatialMap-aware
            // pourTextChild path so obstacle wrapping still works.
            //
            // Any other packager (DropCap, Table, nested Story, …) uses the
            // generic column-adjusted emitBoxes path — no special-casing per
            // element type required.
            // ----------------------------------------------------------
            const pkg = buildPackagerForElement(child.element, child.childIndex, this.processor);

            if (!(pkg instanceof FlowBoxPackager)) {
                const completed = placeOpaquePackager(pkg, i, (continuation) => {
                    continuationPackager = continuation;
                });
                if (!completed) break outer;
                continue;
            }

            let workingElement: Element | null = child.element;
            while (workingElement) {
                const region = regions[regionIndex];
                const regionMap = this.createRegionMap(region, allObstacles);
                const placed = this.pourTextChild(
                    workingElement,
                    i,
                    region.w,
                    { left: margins.left },
                    regionMap,
                    cursorY,
                    region.x
                );

                if (!placed) break;
                if (placed.cursorAfter <= region.h + 0.1) {
                    allBoxes.push(placed.box);
                    cursorY = placed.cursorAfter;
                    break;
                }

                let k = -1;
                for (let j = 0; j < placed.lines.length; j++) {
                    const yOff = placed.lineYOffsets.length > j ? placed.lineYOffsets[j] : j * placed.uniformLH;
                    const lineAbsBottom = placed.topY + yOff + placed.uniformLH;
                    if (lineAbsBottom <= region.h + 0.1) k = j;
                }

                if (k >= 0) {
                    const partialYOff = placed.lineYOffsets.length > k ? placed.lineYOffsets[k] : k * placed.uniformLH;
                    const partialContentH = partialYOff + placed.uniformLH + placed.insetV;
                    allBoxes.push({
                        ...placed.box,
                        h: partialContentH,
                        lines: placed.lines.slice(0, k + 1),
                        properties: {
                            ...(placed.box.properties || {}),
                            _lineYOffsets: placed.lineYOffsets.slice(0, k + 1),
                            _lineOffsets: placed.lineOffsets.slice(0, k + 1),
                            _lineWidths: placed.lineWidths.slice(0, k + 1),
                            _isLastLine: false
                        }
                    });
                    workingElement = this.sliceSourceElement(workingElement, placed.lines, k + 1);
                    if (goNextRegion()) continue;
                    hasOverflow = true;
                    continuationElement = workingElement;
                    nextChildIndex = i + 1;
                    break outer;
                }

                if (goNextRegion()) continue;
                hasOverflow = true;
                continuationElement = workingElement;
                nextChildIndex = i;
                break outer;
            }
        }

        let occupiedHeight = 0;
        for (const box of allBoxes) {
            occupiedHeight = Math.max(occupiedHeight, Number(box.y || 0) + Number(box.h || 0));
        }
        for (const obs of registeredObstacles) {
            occupiedHeight = Math.max(occupiedHeight, obs.y + obs.h + (obs.gapBottom ?? obs.gap));
        }
        occupiedHeight = Math.min(Math.max(0, occupiedHeight), availableHeight);

        const carryOvers = hasOverflow
            ? buildCarryOverObstacles(registeredObstacles, availableHeight)
            : [];

        const continuation: MultiColumnContinuation | null = hasOverflow
            ? {
                continuationElement,
                continuationPackager,
                nextChildIndex,
                carryOvers,
                consumedStoryHeight: resolveRegionStackHeight(regions)
            }
            : null;

        return {
            registeredObstacles,
            occupiedHeight,
            totalHeight: hasOverflow ? (availableHeight + 1) : occupiedHeight,
            allBoxes,
            hasOverflow,
            continuation
        };
    }

    private splitColumns(result: MultiColumnPourResult, availableWidth: number): PackagerSplitResult {
        if (!result.hasOverflow || !result.continuation) {
            return {
                currentFragment: new FrozenStoryPackager(result.allBoxes, result.occupiedHeight, this, availableWidth),
                continuationFragment: null
            };
        }
        if (result.allBoxes.length === 0) {
            return { currentFragment: null, continuationFragment: this };
        }

        const children = this.storyElement.children ?? [];
        const partA = new FrozenStoryPackager(result.allBoxes, result.occupiedHeight, this, availableWidth);
        const partBChildren = buildStoryContinuationChildren(
            children,
            result.continuation.nextChildIndex,
            result.continuation.continuationElement
        );
        if (
            partBChildren.length === 0
            && result.continuation.carryOvers.length === 0
            && !result.continuation.continuationPackager
        ) {
            return { currentFragment: partA, continuationFragment: null };
        }

        const partBElement: Element = {
            ...this.storyElement,
            children: partBChildren
        };
        const partB = new StoryPackager(
            partBElement,
            this.processor,
            this.storyIndex,
            result.continuation.carryOvers,
            this.storyYOffset + result.continuation.consumedStoryHeight,
            createContinuationIdentity(this),
            result.continuation.continuationPackager
        );
        return { currentFragment: partA, continuationFragment: partB };
    }

    private splitResult(
        result: FullPourResult,
        splitH: number,
        availableWidth: number,
        margins: { left: number; right: number; top: number; bottom: number }
    ): PackagerSplitResult {
        const children = this.storyElement.children ?? [];

        const partABoxes: Box[] = [];
        let partAHeight = 0;
        let partBStartChildIdx = children.length; // default: all in partA
        let partBContinuationElement: Element | null = null;

        const recordPartAHeight = (candidateBottom: number): void => {
            if (candidateBottom > partAHeight) partAHeight = candidateBottom;
        };

        for (let i = 0; i < result.placedElements.length; i++) {
            const elem = result.placedElements[i];

            // ---- images ----------------------------------------------------
            if (elem.kind === 'image') {
                const bottom = elem.bottomY;

                if (elem.isAbsolute) {
                    // No-clip policy: include in partA only if fully within splitH.
                    if (bottom <= splitH) {
                        partABoxes.push({ ...elem.box });
                        recordPartAHeight(bottom);
                    }
                    // Otherwise the image box goes to partB (via carry-over
                    // obstacle + being rebuilt during partB pour).
                } else if (elem.isFloat) {
                    // Floats whose anchor is within partA zone go in partA;
                    // the carry-over logic (below) handles their remaining
                    // wrapping influence on the continuation page.
                    if (elem.topY <= splitH) {
                        partABoxes.push({ ...elem.box });
                        recordPartAHeight(bottom);
                    }
                } else {
                    // Block image (top-bottom): include only if it fits.
                    if (bottom <= splitH) {
                        partABoxes.push({ ...elem.box });
                        recordPartAHeight(bottom + (0 /* marginBottom tracked separately */));
                    } else if (elem.topY < splitH) {
                        // Straddles split: move to partB (no-clip).
                        partBStartChildIdx = Math.min(partBStartChildIdx, elem.childIndex);
                    }
                }
                continue;
            }

            // ---- float block -----------------------------------------------
            if (elem.kind === 'float-block') {
                // Absolute blocks follow the same no-clip policy as absolute images.
                if (elem.isAbsolute) {
                    if (elem.bottomY <= splitH) {
                        for (const b of elem.allBoxes) partABoxes.push({ ...b });
                        recordPartAHeight(elem.bottomY);
                    }
                    continue;
                }
                // Floats are included in partA if the anchor is within the split zone.
                if (elem.topY <= splitH) {
                    for (const b of elem.allBoxes) partABoxes.push({ ...b });
                    recordPartAHeight(elem.bottomY);
                }
                continue;
            }

            // ---- text element ----------------------------------------------
            const textEnd = elem.cursorAfter; // includes marginBottom

            if (textEnd <= splitH) {
                // Fits entirely on current page.
                partABoxes.push({ ...elem.box, properties: { ...(elem.box.properties || {}) } });
                recordPartAHeight(textEnd);
            } else if (elem.topY < splitH) {
                // Needs to be split within this element.
                let k = -1;
                for (let j = 0; j < elem.lines.length; j++) {
                    const yOff = elem.lineYOffsets.length > j
                        ? elem.lineYOffsets[j]
                        : j * elem.uniformLH;
                    // The line's absolute bottom in story coords:
                    const lineAbsBottom = elem.topY + yOff + elem.uniformLH;
                    if (lineAbsBottom <= splitH) k = j;
                }

                if (k >= 0) {
                    // Emit a partial box with lines 0..k.
                    const partialYOff = elem.lineYOffsets.length > k
                        ? elem.lineYOffsets[k]
                        : k * elem.uniformLH;
                    const partialContentH = partialYOff + elem.uniformLH + elem.insetV;

                    partABoxes.push({
                        ...elem.box,
                        h: partialContentH,
                        lines: elem.lines.slice(0, k + 1),
                        properties: {
                            ...(elem.box.properties || {}),
                            _lineYOffsets: elem.lineYOffsets.slice(0, k + 1),
                            _lineOffsets: elem.lineOffsets.slice(0, k + 1),
                            _lineWidths: elem.lineWidths.slice(0, k + 1),
                            _isLastLine: false,
                        }
                    });
                    recordPartAHeight(elem.topY + partialContentH);

                    // Build the continuation element for partB.
                    partBContinuationElement = this.sliceSourceElement(
                        elem.sourceElement,
                        elem.lines,
                        k + 1
                    );
                    partBStartChildIdx = elem.childIndex + 1;
                } else {
                    // Not even one line fits → push entire element to partB.
                    partBStartChildIdx = elem.childIndex;
                }
                break; // everything from here goes to partB

            } else {
                // Element starts below splitH → entire element to partB.
                partBStartChildIdx = elem.childIndex;
                break;
            }
        }

        if (partABoxes.length === 0) {
            // Nothing fits → cannot split (tell paginator to try a new page).
            return { currentFragment: null, continuationFragment: this };
        }

        // -- Carry-over obstacles -------------------------------------------
        const carryOvers = buildCarryOverObstacles(result.registeredObstacles, splitH);

        // -- partA (frozen) -------------------------------------------------
        const partA = new FrozenStoryPackager(partABoxes, partAHeight, this, availableWidth);

        // -- partB children -------------------------------------------------
        const partBChildren = buildStoryContinuationChildren(
            children,
            partBStartChildIdx,
            partBContinuationElement
        );

        // Also re-include any story-absolute images that appear after splitH
        // in story coordinates (they were skipped in the current pour due to
        // storyYOffset, but will be re-encountered in the partB pour).
        // No extra work needed: partB inherits the original children starting
        // from partBStartChildIdx, which includes all future story-absolute
        // images by their original index order.

        if (partBChildren.length === 0 && carryOvers.length === 0) {
            // Nothing left for partB.
            return { currentFragment: partA, continuationFragment: null };
        }

        const partBElement: Element = {
            ...this.storyElement,
            children: partBChildren
        };

        const partB = new StoryPackager(
            partBElement,
            this.processor,
            this.storyIndex,
            carryOvers,
            this.storyYOffset + splitH,
            createContinuationIdentity(this)
        );

        return { currentFragment: partA, continuationFragment: partB };
    }

    // -- Helpers -------------------------------------------------------------

    private resolveImage(element: Element): BoxImagePayload | null {
        return (this.processor as any).resolveEmbeddedImage(element) ?? null;
    }

    private measureImageBox(
        element: Element,
        imgData: BoxImagePayload,
        availableWidth: number
    ): { w: number; h: number } {
        const style = ((element.properties?.style || {}) as ElementStyle);
        const insetH = LayoutUtils.getHorizontalInsets(style);
        const insetV = LayoutUtils.getVerticalInsets(style);

        let boxW: number;
        if (style.width !== undefined) {
            boxW = Math.max(0, LayoutUtils.validateUnit(style.width));
        } else {
            const intrinsic = imgData.intrinsicWidth + insetH;
            boxW = Math.min(intrinsic, availableWidth);
        }
        if (!Number.isFinite(boxW) || boxW <= 0) boxW = availableWidth;

        const contentW = Math.max(0, boxW - insetH);

        let boxH: number;
        if (style.height !== undefined) {
            boxH = Math.max(0, LayoutUtils.validateUnit(style.height));
        } else {
            const ratio = imgData.intrinsicHeight / Math.max(1, imgData.intrinsicWidth);
            boxH = contentW * ratio + insetV;
        }
        if (!Number.isFinite(boxH)) boxH = 0;

        return { w: boxW, h: boxH };
    }

    /**
     * Resolves explicit dimensions for a non-image float block.
     * Both `style.width` and `style.height` must be present and positive.
     * Returns null if either is missing or invalid — the element falls through
     * to normal block layout instead.
     */
    private measureFloatBox(
        element: Element,
        availableWidth: number
    ): { w: number; h: number } | null {
        const style = (element.properties?.style || {}) as ElementStyle;
        if (style.width === undefined || style.height === undefined) return null;
        const w = Math.max(0, LayoutUtils.validateUnit(style.width));
        const h = Math.max(0, LayoutUtils.validateUnit(style.height));
        if (!Number.isFinite(w) || w <= 0) return null;
        if (!Number.isFinite(h) || h <= 0) return null;
        return { w: Math.min(w, availableWidth), h };
    }

    private buildImageBox(
        element: Element,
        absX: number,
        storyY: number,
        w: number,
        h: number,
        imgData: BoxImagePayload,
        childIndex: number
    ): Box {
        const flowBox = (this.processor as any).shapeElement(
            element, { path: [this.storyIndex, childIndex] }
        );
        return {
            type: element.type,
            x: absX,
            y: storyY,
            w,
            h,
            image: imgData,
            style: flowBox.style,
            properties: {
                ...(flowBox.properties || {}),
                _isFirstLine: true,
                _isLastLine: true,
                _isFirstFragmentInLine: true,
                _isLastFragmentInLine: true,
            },
            meta: { ...flowBox.meta, pageIndex: 0 }
        };
    }

    /**
     * Creates a source element containing only the text that comes after
     * the first `consumedLineCount` lines have been rendered.
     *
     * Uses the same character-slicing approach as splitFlowBoxWithCallbacks.
     */
    private sliceSourceElement(
        element: Element,
        lines: RichLine[],
        consumedLineCount: number
    ): Element {
        const renderedText: string = (this.processor as any).getJoinedLineText(
            lines.slice(0, consumedLineCount)
        );
        const sourceText: string = (this.processor as any).getElementText(element);
        const consumedChars: number = (this.processor as any).resolveConsumedSourceChars(
            sourceText, renderedText
        );
        const remaining = Math.max(0, sourceText.length - consumedChars);

        let continuation: Element;
        if (Array.isArray(element.children) && element.children.length > 0) {
            continuation = {
                ...element,
                content: '',
                children: (this.processor as any).sliceElements(
                    element.children, consumedChars, consumedChars + remaining
                )
            };
        } else {
            continuation = {
                ...element,
                content: sourceText.slice(consumedChars)
            };
        }

        return (this.processor as any).trimLeadingContinuationWhitespace(continuation) as Element;
    }

    private createNestedPackagerContext(
        context: PackagerContext,
        overrides: Partial<PackagerContext>
    ): PackagerContext {
        return {
            ...context,
            ...overrides,
            processor: this.processor,
            publishActorSignal: (signal) => {
                const session = this.processor.getCurrentLayoutSession();
                if (!session) {
                    return {
                        ...signal,
                        pageIndex: signal.pageIndex ?? context.pageIndex ?? 0,
                        sequence: -1
                    } as any;
                }
                return session.publishActorSignal(signal);
            },
            readActorSignals: (topic?: string) => {
                const session = this.processor.getCurrentLayoutSession();
                return session ? session.getActorSignals(topic) : [];
            }
        };
    }

    private createLocalFrameContext(
        context: PackagerContext,
        localFrameWidth: number,
        overrides: Partial<PackagerContext>,
        localWorldOffsetY: number = 0,
        localViewportHeight?: number
    ): PackagerContext {
        const nested = this.createNestedPackagerContext(context, overrides);
        const normalizedLocalFrameWidth = Math.max(0, Number(localFrameWidth) || 0);
        const outerViewportWorldY = Number.isFinite(context.viewportWorldY)
            ? Math.max(0, Number(context.viewportWorldY))
            : Math.max(0, Number(context.pageIndex || 0)) * Math.max(0, Number(context.pageHeight || 0));
        const resolvedViewportHeight = localViewportHeight !== undefined
            ? Math.max(0, Number(localViewportHeight) || 0)
            : (
                Number.isFinite(nested.viewportHeight)
                    ? Math.max(0, Number(nested.viewportHeight))
                    : Math.max(0, Number(nested.pageHeight || 0))
            );
        return {
            ...nested,
            pageWidth: nested.margins.left + normalizedLocalFrameWidth + nested.margins.right,
            contentWidthOverride: normalizedLocalFrameWidth,
            viewportWorldY: outerViewportWorldY + Math.max(0, Number(localWorldOffsetY) || 0),
            viewportHeight: resolvedViewportHeight
        };
    }
}

// ---------------------------------------------------------------------------
// Module-level helpers
// ---------------------------------------------------------------------------

function isColumnSpanElement(element: Element): boolean {
    const span = element.columnSpan;
    return span === 'all' || (typeof span === 'number' && span > 1);
}

function resolveFloatX(
    align: StoryFloatAlign,
    imgW: number,
    availableWidth: number
): number {
    if (align === 'right') return Math.max(0, availableWidth - imgW);
    if (align === 'center') return Math.max(0, (availableWidth - imgW) / 2);
    return 0; // 'left'
}

function cloneBoxes(boxes: Box[], pageIndex?: number): Box[] {
    return boxes.map((b) => ({
        ...b,
        properties: { ...(b.properties || {}) },
        ...(b.meta
            ? {
                meta: {
                    ...b.meta,
                    ...(pageIndex !== undefined ? { pageIndex } : {})
                }
            }
            : {})
    }));
}

function resolveViewportSnapshot(context: PackagerContext): StoryViewportSnapshot {
    return {
        pageIndex: Number.isFinite(context.pageIndex) ? Number(context.pageIndex) : 0,
        viewportWorldY: Number.isFinite(context.viewportWorldY) ? Number(context.viewportWorldY) : null,
        viewportHeight: Number.isFinite(context.viewportHeight) ? Number(context.viewportHeight) : null
    };
}

function sameViewportSnapshot(
    left: StoryViewportSnapshot | null,
    right: StoryViewportSnapshot | null
): boolean {
    if (!left || !right) return left === right;
    return left.pageIndex === right.pageIndex
        && left.viewportWorldY === right.viewportWorldY
        && left.viewportHeight === right.viewportHeight;
}

function collectDeferredStoryAbsoluteChildren(children: Element[], cutoffChildIndex: number): Element[] {
    if (!Number.isFinite(cutoffChildIndex) || cutoffChildIndex <= 0) {
        return [];
    }
    const deferred: Element[] = [];
    for (let i = 0; i < Math.min(children.length, cutoffChildIndex); i++) {
        const child = children[i];
        const layout = child.placement as StoryLayoutDirective | undefined;
        if (layout?.mode !== 'story-absolute') continue;
        deferred.push(child);
    }
    return deferred;
}

function buildStoryContinuationChildren(
    children: Element[],
    cutoffChildIndex: number,
    continuationElement: Element | null
): Element[] {
    const result: Element[] = [];
    for (const deferredAbsolute of collectDeferredStoryAbsoluteChildren(children, cutoffChildIndex)) {
        result.push(deferredAbsolute);
    }
    if (continuationElement) {
        result.push(continuationElement);
    }
    for (let i = Math.max(0, cutoffChildIndex); i < children.length; i++) {
        result.push(children[i]);
    }
    return result;
}

function buildCarryOverObstacles(obstacles: OccupiedRect[], splitY: number): CarryOverObstacle[] {
    const carryOvers: CarryOverObstacle[] = [];
    for (const obstacle of obstacles) {
        const obstacleBottom = obstacle.y + obstacle.h;
        if (obstacleBottom > splitY && obstacle.y < splitY) {
            carryOvers.push({
                x: obstacle.x,
                w: obstacle.w,
                remainingH: Math.max(0, obstacleBottom - splitY),
                wrap: obstacle.wrap,
                gap: obstacle.gap,
                gapTop: 0,
                gapBottom: obstacle.gap
            });
        }
    }
    return carryOvers;
}

function projectStoryYToRegionStack(storyY: number, regions: StoryColumnRegion[]): { regionIndex: number; y: number } | null {
    if (regions.length === 0) {
        return null;
    }
    let cursor = 0;
    for (let i = 0; i < regions.length; i++) {
        const regionHeight = Math.max(0, Number(regions[i].h || 0));
        const nextCursor = cursor + regionHeight;
        if (storyY < nextCursor || i === regions.length - 1) {
            return {
                regionIndex: i,
                y: storyY - cursor
            };
        }
        cursor = nextCursor;
    }
    return null;
}

function resolveRegionStackHeight(regions: StoryColumnRegion[]): number {
    return regions.reduce((sum, region) => sum + Math.max(0, Number(region.h || 0)), 0);
}

function resolveRegionStartY(regions: StoryColumnRegion[], regionIndex: number): number {
    let cursor = 0;
    for (let i = 0; i < Math.max(0, Math.floor(regionIndex)); i++) {
        cursor += Math.max(0, Number(regions[i]?.h || 0));
    }
    return cursor;
}
