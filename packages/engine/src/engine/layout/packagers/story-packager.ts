/**
 * StoryPackager – DTP-style "rocks in a river" layout.
 *
 * A `story` element groups a continuous stream of text and images.  Images
 * carry a `properties.layout` directive that declares how they sit relative
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

import {
    Box,
    BoxImagePayload,
    Element,
    ElementStyle,
    RichLine,
    StoryFloatAlign,
    StoryLayoutDirective,
    StoryWrapMode,
} from '../../types';
import { LayoutProcessor } from '../layout-core';
import { LayoutUtils } from '../layout-utils';
import { LayoutBox, PackagerContext, PackagerUnit } from './packager-types';
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
    topY: number; // box.y (= cursorBefore + marginTop)
    contentH: number; // box.h
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

type PlacedElement = PlacedTextElement | PlacedImageElement;

type FullPourResult = {
    placedElements: PlacedElement[];
    registeredObstacles: OccupiedRect[];
    totalHeight: number;
    allBoxes: Box[];
};

// ---------------------------------------------------------------------------
// FrozenStoryPackager – holds pre-split partA boxes
// ---------------------------------------------------------------------------

class FrozenStoryPackager implements PackagerUnit {
    private readonly frozenBoxes: Box[];
    private readonly frozenHeight: number;

    constructor(boxes: Box[], height: number) {
        this.frozenBoxes = boxes;
        this.frozenHeight = height;
    }

    emitBoxes(_aw: number, _ah: number, _ctx: PackagerContext): Box[] {
        return this.frozenBoxes.map((b) => ({ ...b, properties: { ...(b.properties || {}) } }));
    }

    split(_ah: number, _ctx: PackagerContext): [PackagerUnit | null, PackagerUnit | null] {
        return [null, this];
    }

    getRequiredHeight(): number {
        return this.frozenHeight;
    }
    isUnbreakable(_ah: number): boolean {
        return true;
    }
    getMarginTop(): number {
        return 0;
    }
    getMarginBottom(): number {
        return 0;
    }
}

// ---------------------------------------------------------------------------
// StoryPackager
// ---------------------------------------------------------------------------

export class StoryPackager implements PackagerUnit {
    private readonly storyElement: Element;
    private readonly processor: LayoutProcessor;
    private readonly storyIndex: number;
    /** Obstacles carried over from the preceding page (already started there). */
    private readonly initialObstacles: CarryOverObstacle[];
    /**
     * The story-local Y of this packager's origin relative to the overall
     * story.  For page-1 this is 0; for continuation pages it equals the
     * splitH at which the preceding page ended.  Used to re-anchor
     * story-absolute images on continuation pages.
     */
    private readonly storyYOffset: number;

    private lastResult: FullPourResult | null = null;
    private lastAvailableWidth: number = -1;

    readonly pageBreakBefore: boolean = false;
    readonly keepWithNext: boolean = false;

    constructor(
        storyElement: Element,
        processor: LayoutProcessor,
        storyIndex: number,
        initialObstacles?: CarryOverObstacle[],
        storyYOffset?: number,
    ) {
        this.storyElement = storyElement;
        this.processor = processor;
        this.storyIndex = storyIndex;
        this.initialObstacles = initialObstacles ?? [];
        this.storyYOffset = storyYOffset ?? 0;
    }

    // -- PackagerUnit ---------------------------------------------------------

    emitBoxes(availableWidth: number, _availableHeight: number, context: PackagerContext): LayoutBox[] {
        if (this.lastAvailableWidth === availableWidth && this.lastResult) {
            return cloneBoxes(this.lastResult.allBoxes);
        }
        const result = this.pourAll(availableWidth, context.margins);
        this.lastResult = result;
        this.lastAvailableWidth = availableWidth;
        return cloneBoxes(result.allBoxes);
    }

    getRequiredHeight(): number {
        return this.lastResult?.totalHeight ?? 0;
    }

    isUnbreakable(_availableHeight: number): boolean {
        return false;
    }

    getMarginTop(): number {
        return 0;
    }
    getMarginBottom(): number {
        return 0;
    }

    split(availableHeight: number, context: PackagerContext): [PackagerUnit | null, PackagerUnit | null] {
        const availableWidth =
            this.lastAvailableWidth > 0
                ? this.lastAvailableWidth
                : context.pageWidth - context.margins.left - context.margins.right;

        const result = this.lastResult ?? this.pourAll(availableWidth, context.margins);
        return this.splitResult(result, availableHeight, availableWidth, context.margins);
    }

    // -- Core pour ------------------------------------------------------------

    private pourAll(
        availableWidth: number,
        margins: { left: number; right: number; top: number; bottom: number },
    ): FullPourResult {
        const children = this.storyElement.children ?? [];
        const storyMap = new SpatialMap();
        const registeredObstacles: OccupiedRect[] = [];
        const imageMetricsCache = new Map<number, { img: BoxImagePayload; w: number; h: number } | null>();

        const resolveImageMetrics = (
            child: Element,
            index: number,
        ): { img: BoxImagePayload; w: number; h: number } | null => {
            if (!child.properties?.image) return null;
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
                x: co.x,
                y: 0,
                w: co.w,
                h: co.remainingH,
                wrap: co.wrap,
                gap: co.gap,
                gapTop: co.gapTop,
                gapBottom: co.gapBottom,
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
            const layout = child.properties?.layout as StoryLayoutDirective | undefined;
            if (layout?.mode !== 'story-absolute') continue;
            if (!child.properties?.image) continue;
            if (layout.wrap === 'none') continue;

            const metrics = resolveImageMetrics(child, i);
            if (!metrics) continue;
            const { img: imgData, w: imgW, h: imgH } = metrics;
            const localY = Math.max(0, Number(layout.y ?? 0)) - this.storyYOffset;
            if (localY + imgH < 0) continue; // wholly before this page's origin

            const rect: OccupiedRect = {
                x: Math.max(0, Number(layout.x ?? 0)),
                y: Math.max(0, localY),
                w: imgW,
                h: imgH,
                wrap: layout.wrap ?? 'around',
                gap: Math.max(0, Number(layout.gap ?? 0)),
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
            const layout = child.properties?.layout as StoryLayoutDirective | undefined;

            // ---- story-absolute image --------------------------------------
            if (layout?.mode === 'story-absolute') {
                const metrics = resolveImageMetrics(child, i);
                if (!metrics) continue;
                const { img: imgData, w: imgW, h: imgH } = metrics;
                const localY = Math.max(0, Number(layout.y ?? 0)) - this.storyYOffset;
                if (localY + imgH < 0) continue; // wholly before this page's origin
                const effectiveY = Math.max(0, localY);
                const x = Math.max(0, Number(layout.x ?? 0));
                const box = this.buildImageBox(child, margins.left + x, effectiveY, imgW, imgH, imgData, i);
                allBoxes.push(box);
                placedElements.push({
                    kind: 'image',
                    childIndex: i,
                    box,
                    topY: effectiveY,
                    bottomY: effectiveY + imgH,
                    isFloat: false,
                    isAbsolute: true,
                });
                continue;
            }

            // ---- float image -----------------------------------------------
            if (layout?.mode === 'float' && child.properties?.image) {
                const metrics = resolveImageMetrics(child, i);
                if (!metrics) continue;
                const { img: imgData, w: imgW, h: imgH } = metrics;

                // Floats anchor at the current text cursor; advance past any
                // top-bottom blocks first so they sit beside readable text.
                cursorY = storyMap.topBottomClearY(cursorY);

                const align: StoryFloatAlign = layout.align ?? 'left';
                const floatX = resolveFloatX(align, imgW, availableWidth);
                const wrap: StoryWrapMode = layout.wrap ?? 'around';
                const gap = Math.max(0, Number(layout.gap ?? 0));

                if (wrap !== 'none') {
                    const rect: OccupiedRect = {
                        x: floatX,
                        y: cursorY,
                        w: imgW,
                        h: imgH,
                        wrap,
                        gap,
                    };
                    storyMap.register(rect);
                    registeredObstacles.push(rect);
                }

                const box = this.buildImageBox(child, margins.left + floatX, cursorY, imgW, imgH, imgData, i);
                allBoxes.push(box);
                placedElements.push({
                    kind: 'image',
                    childIndex: i,
                    box,
                    topY: cursorY,
                    bottomY: cursorY + imgH,
                    isFloat: true,
                    isAbsolute: false,
                });
                // Floats do NOT advance cursorY — text flows alongside them.
                continue;
            }

            // ---- block image (no layout directive, or unrecognised mode) ---
            if (child.properties?.image && !layout?.mode) {
                const metrics = resolveImageMetrics(child, i);
                if (!metrics) continue;
                const { img: imgData, w: imgW, h: imgH } = metrics;

                cursorY = storyMap.topBottomClearY(cursorY);
                const flowBox = (this.processor as any).shapeElement(child, { path: [this.storyIndex, i] });
                const marginTop = Math.max(0, flowBox.marginTop);
                const marginBottom = Math.max(0, flowBox.marginBottom);
                const boxY = cursorY + marginTop;

                const box = this.buildImageBox(child, margins.left, boxY, imgW, imgH, imgData, i);
                allBoxes.push(box);
                placedElements.push({
                    kind: 'image',
                    childIndex: i,
                    box,
                    topY: boxY,
                    bottomY: boxY + imgH,
                    isFloat: false,
                    isAbsolute: false,
                });
                cursorY = boxY + imgH + marginBottom;
                continue;
            }

            // ---- text / block element --------------------------------------
            const placed = this.pourTextChild(child, i, availableWidth, margins, storyMap, cursorY);
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
    ): PlacedTextElement | null {
        // Shape gives us style, meta, and margin values.
        const flowBox = (this.processor as any).shapeElement(element, { path: [this.storyIndex, childIndex] });
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
        const opticalUnderhang = !!(this.processor as any).config?.layout?.storyWrapOpticalUnderhang;

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
            widths: [],
            offsets: [],
            yOffsets: [],
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
                opticalUnderhang ? { opticalUnderhang: true } : undefined,
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
                        yOffset,
                    });
                }
            }

            return {
                width: Math.max(0, resolvedIntervals[0].w - insetH),
                xOffset: resolvedIntervals[0].x,
                yOffset,
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
            lineLayoutOut,
        );

        if (!lines || lines.length === 0) return null;

        // Height of the content area (accounts for any Y-jumps from obstacle
        // skips via calculateLineBlockHeight's lineYOffsets branch).
        const linesH: number = (this.processor as any).calculateLineBlockHeight(lines, style, lineLayoutOut.yOffsets);
        const contentH = linesH + insetV;

        const box: Box = {
            type: element.type,
            x: margins.left,
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
            meta: { ...flowBox.meta, pageIndex: 0 },
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

    private splitResult(
        result: FullPourResult,
        splitH: number,
        availableWidth: number,
        margins: { left: number; right: number; top: number; bottom: number },
    ): [PackagerUnit | null, PackagerUnit | null] {
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
                        recordPartAHeight(bottom + 0 /* marginBottom tracked separately */);
                    } else if (elem.topY < splitH) {
                        // Straddles split: move to partB (no-clip).
                        partBStartChildIdx = Math.min(partBStartChildIdx, elem.childIndex);
                    }
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
                    const yOff = elem.lineYOffsets.length > j ? elem.lineYOffsets[j] : j * elem.uniformLH;
                    // The line's absolute bottom in story coords:
                    const lineAbsBottom = elem.topY + yOff + elem.uniformLH;
                    if (lineAbsBottom <= splitH) k = j;
                }

                if (k >= 0) {
                    // Emit a partial box with lines 0..k.
                    const partialYOff = elem.lineYOffsets.length > k ? elem.lineYOffsets[k] : k * elem.uniformLH;
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
                        },
                    });
                    recordPartAHeight(elem.topY + partialContentH);

                    // Build the continuation element for partB.
                    partBContinuationElement = this.sliceSourceElement(elem.sourceElement, elem.lines, k + 1);
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
            return [null, this];
        }

        // -- Carry-over obstacles -------------------------------------------
        const carryOvers: CarryOverObstacle[] = [];
        for (const obs of result.registeredObstacles) {
            const imageBottom = obs.y + obs.h;
            if (imageBottom > splitH && obs.y < splitH) {
                const remainingImageH = Math.max(0, imageBottom - splitH);
                carryOvers.push({
                    x: obs.x,
                    w: obs.w,
                    remainingH: remainingImageH,
                    wrap: obs.wrap,
                    gap: obs.gap,
                    gapTop: 0,
                    gapBottom: obs.gap,
                });
            }
        }

        // -- partA (frozen) -------------------------------------------------
        const partA = new FrozenStoryPackager(partABoxes, partAHeight);

        // -- partB children -------------------------------------------------
        const partBChildren: Element[] = [];
        if (partBContinuationElement) {
            partBChildren.push(partBContinuationElement);
        }
        for (let i = partBStartChildIdx; i < children.length; i++) {
            partBChildren.push(children[i]);
        }

        // Also re-include any story-absolute images that appear after splitH
        // in story coordinates (they were skipped in the current pour due to
        // storyYOffset, but will be re-encountered in the partB pour).
        // No extra work needed: partB inherits the original children starting
        // from partBStartChildIdx, which includes all future story-absolute
        // images by their original index order.

        if (partBChildren.length === 0 && carryOvers.length === 0) {
            // Nothing left for partB.
            return [partA, null];
        }

        const partBElement: Element = {
            ...this.storyElement,
            children: partBChildren,
        };

        const partB = new StoryPackager(
            partBElement,
            this.processor,
            this.storyIndex,
            carryOvers,
            this.storyYOffset + splitH,
        );

        return [partA, partB];
    }

    // -- Helpers -------------------------------------------------------------

    private resolveImage(element: Element): BoxImagePayload | null {
        return (this.processor as any).resolveEmbeddedImage(element) ?? null;
    }

    private measureImageBox(
        element: Element,
        imgData: BoxImagePayload,
        availableWidth: number,
    ): { w: number; h: number } {
        const style = (element.properties?.style || {}) as ElementStyle;
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

    private buildImageBox(
        element: Element,
        absX: number,
        storyY: number,
        w: number,
        h: number,
        imgData: BoxImagePayload,
        childIndex: number,
    ): Box {
        const flowBox = (this.processor as any).shapeElement(element, { path: [this.storyIndex, childIndex] });
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
            meta: { ...flowBox.meta, pageIndex: 0 },
        };
    }

    /**
     * Creates a source element containing only the text that comes after
     * the first `consumedLineCount` lines have been rendered.
     *
     * Uses the same character-slicing approach as splitFlowBoxWithCallbacks.
     */
    private sliceSourceElement(element: Element, lines: RichLine[], consumedLineCount: number): Element {
        const renderedText: string = (this.processor as any).getJoinedLineText(lines.slice(0, consumedLineCount));
        const sourceText: string = (this.processor as any).getElementText(element);
        const consumedChars: number = (this.processor as any).resolveConsumedSourceChars(sourceText, renderedText);
        const remaining = Math.max(0, sourceText.length - consumedChars);

        let continuation: Element;
        if (Array.isArray(element.children) && element.children.length > 0) {
            continuation = {
                ...element,
                content: '',
                children: (this.processor as any).sliceElements(
                    element.children,
                    consumedChars,
                    consumedChars + remaining,
                ),
            };
        } else {
            continuation = {
                ...element,
                content: sourceText.slice(consumedChars),
            };
        }

        return (this.processor as any).trimLeadingContinuationWhitespace(continuation) as Element;
    }
}

// ---------------------------------------------------------------------------
// Module-level helpers
// ---------------------------------------------------------------------------

function resolveFloatX(align: StoryFloatAlign, imgW: number, availableWidth: number): number {
    if (align === 'right') return Math.max(0, availableWidth - imgW);
    if (align === 'center') return Math.max(0, (availableWidth - imgW) / 2);
    return 0; // 'left'
}

function cloneBoxes(boxes: Box[]): Box[] {
    return boxes.map((b) => ({ ...b, properties: { ...(b.properties || {}) } }));
}
