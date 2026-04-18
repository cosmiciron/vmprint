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
import { translateSvgPath } from '../../geometry/svg-path';
import { LayoutProcessor } from '../layout-core';
import { buildExclusionFieldObstacles } from '../exclusion-field';
import { LayoutUtils } from '../layout-utils';
import { normalizeStoryElement, type NormalizedStoryChild } from '../normalized-story';
import { reflowTextElementAgainstSpatialField } from '../spatial-field-reflow';
import { buildPackagerForElement } from './create-packagers';
import { FlowBoxPackager } from './flow-box-packager';
import { createContinuationIdentity, createElementPackagerIdentity, PackagerIdentity } from './packager-identity';
import {
    bindPackagerSignalPublisher,
    LayoutBox,
    PackagerContext,
    PackagerPlacementPreference,
    PackagerReshapeResult,
    PackagerReshapeProfile,
    PackagerUnit,
    resolvePackagerChunkOriginWorldY,
    resolvePackagerWorldYAtCursor
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
    shape?: 'rect' | 'circle' | 'polygon';
    path?: string;
    /** Circle centre Y in the new page's story-local coordinates. */
    circleCy?: number;
    align?: StoryFloatAlign;
    zIndex?: number;
    traversalInteraction?: 'auto' | 'pass-through' | 'block';
};

type CarryOverVisual = {
    box: Box;
    topY: number;
    bottomY: number;
    isAbsolute: boolean;
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
    chunkOriginWorldY: number | null;
    viewportHeight: number | null;
};

type StoryActorEntry = NormalizedStoryChild & {
    actor: PackagerUnit;
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

    getReshapeProfile(): PackagerReshapeProfile {
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

    reshape(_ah: number, _ctx: PackagerContext): PackagerReshapeResult {
        return { currentFragment: null, continuationFragment: this };
    }

    getRequiredHeight(): number { return this.frozenHeight; }
    isUnbreakable(_ah: number): boolean { return true; }
    getLeadingSpacing(): number { return 0; }
    getTrailingSpacing(): number { return 0; }
}

// ---------------------------------------------------------------------------
// StoryPackager
// ---------------------------------------------------------------------------

export class StoryPackager implements PackagerUnit {
    private readonly storyElement: Element;
    private normalizedStory;
    private readonly processor: LayoutProcessor;
    private readonly storyIndex: number;
    private storyActorEntries: StoryActorEntry[];
    /** Obstacles carried over from the preceding page (already started there). */
    private readonly initialObstacles: CarryOverObstacle[];
    /** Visual fragments carried over from the preceding page. */
    private readonly initialCarryOverVisuals: CarryOverVisual[];
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
    private readonly imageMetricsCache = new Map<string, { img: BoxImagePayload; w: number; h: number } | null>();
    private imageMetricsCacheDirty: boolean = true;

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
        deferredLeadingPackager?: PackagerUnit | null,
        initialCarryOverVisuals?: CarryOverVisual[]
    ) {
        this.storyElement = storyElement;
        this.normalizedStory = normalizeStoryElement(storyElement);
        this.processor = processor;
        this.storyIndex = storyIndex;
        this.initialObstacles = initialObstacles ?? [];
        this.initialCarryOverVisuals = initialCarryOverVisuals ?? [];
        this.storyYOffset = storyYOffset ?? 0;
        this.deferredLeadingPackager = deferredLeadingPackager ?? null;
        const resolvedIdentity = identity ?? createElementPackagerIdentity(storyElement, [storyIndex]);
        this.actorId = resolvedIdentity.actorId;
        this.sourceId = resolvedIdentity.sourceId;
        this.actorKind = resolvedIdentity.actorKind;
        this.fragmentIndex = resolvedIdentity.fragmentIndex;
        this.continuationOf = resolvedIdentity.continuationOf;
        this.storyActorEntries = this.normalizedStory.children.map((child) => ({
            ...child,
            actor: buildPackagerForElement(child.element, child.childIndex, this.processor)
        }));
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
        const viewportSnapshot = resolveViewportSnapshot(context);
        if (
            this.lastAvailableWidth === availableWidth &&
            !Number.isFinite(this.lastAvailableHeight) &&
            sameViewportSnapshot(this.lastViewportSnapshot, viewportSnapshot) &&
            this.lastResult
        ) {
            return;
        }
        // Keep-with-next planning only needs collision/fit truth. Treat this as
        // a capped probe and stop as soon as the local frontier has exceeded the
        // remaining height instead of pouring the whole continuation story.
        this.lastResult = this.pourAll(availableWidth, context, {
            includeCarryOverVisuals: false,
            stopAtHeight: Number.isFinite(_availableHeight) ? Math.max(0, _availableHeight) : undefined
        });
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

    getReshapeProfile(): PackagerReshapeProfile {
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

    getLeadingSpacing(): number { return 0; }
    getTrailingSpacing(): number { return 0; }

    getHostedRuntimeActors(): readonly PackagerUnit[] {
        return this.storyActorEntries.map((entry) => entry.actor);
    }

    handlesHostedRuntimeActor(targetActor: PackagerUnit): boolean {
        return this.findHostedActorIndex(targetActor) >= 0;
    }

    insertHostedRuntimeActors(
        targetActor: PackagerUnit,
        insertions: readonly PackagerUnit[],
        position: 'before' | 'after',
        sourceElements?: readonly Element[]
    ): boolean {
        const targetIndex = this.findHostedActorIndex(targetActor);
        if (targetIndex < 0 || !sourceElements || sourceElements.length !== insertions.length) return false;
        const children = [...(this.storyElement.children ?? [])];
        const insertionIndex = position === 'before' ? targetIndex : targetIndex + 1;
        children.splice(insertionIndex, 0, ...sourceElements);
        this.storyElement.children = children;
        this.storyActorEntries.splice(
            insertionIndex,
            0,
            ...insertions.map((actor, index) => ({
                childIndex: -1,
                element: sourceElements[index] as Element,
                kind: 'flow' as const,
                actor
            }))
        );
        this.refreshStoryActorEntries();
        this.invalidateCachedStoryLayout();
        return true;
    }

    deleteHostedRuntimeActor(targetActor: PackagerUnit): boolean {
        const targetIndex = this.findHostedActorIndex(targetActor);
        if (targetIndex < 0) return false;
        const children = [...(this.storyElement.children ?? [])];
        children.splice(targetIndex, 1);
        this.storyElement.children = children;
        this.storyActorEntries.splice(targetIndex, 1);
        this.refreshStoryActorEntries();
        this.invalidateCachedStoryLayout();
        return true;
    }

    replaceHostedRuntimeActor(
        targetActor: PackagerUnit,
        replacements: readonly PackagerUnit[],
        sourceElements?: readonly Element[]
    ): boolean {
        const targetIndex = this.findHostedActorIndex(targetActor);
        if (targetIndex < 0 || !sourceElements || sourceElements.length !== replacements.length) return false;
        const children = [...(this.storyElement.children ?? [])];
        children.splice(targetIndex, 1, ...sourceElements);
        this.storyElement.children = children;
        this.storyActorEntries.splice(
            targetIndex,
            1,
            ...replacements.map((actor, index) => ({
                childIndex: -1,
                element: sourceElements[index] as Element,
                kind: 'flow' as const,
                actor
            }))
        );
        this.refreshStoryActorEntries();
        this.invalidateCachedStoryLayout();
        return true;
    }

    refreshHostedRuntimeActor(targetActor: PackagerUnit): boolean {
        if (this.findHostedActorIndex(targetActor) < 0) return false;
        this.invalidateCachedStoryLayout();
        return true;
    }

    reshape(availableHeight: number, context: PackagerContext): PackagerReshapeResult {
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
            return this.splitColumns(result as MultiColumnPourResult, availableWidth, availableHeight);
        }
        return this.splitResult(result as FullPourResult, availableHeight, availableWidth, context.margins);
    }

    // -- Core pour ------------------------------------------------------------

    private pourAll(
        availableWidth: number,
        context: PackagerContext,
        options?: {
            includeCarryOverVisuals?: boolean;
            stopAtHeight?: number;
        }
    ): FullPourResult {
        const margins = context.margins;
        const children = this.storyActorEntries;
        const storyMap = new SpatialMap();
        const registeredObstacles: OccupiedRect[] = [];
        const includeCarryOverVisuals = options?.includeCarryOverVisuals !== false;
        const stopAtHeight = Number.isFinite(options?.stopAtHeight)
            ? Math.max(0, Number(options?.stopAtHeight))
            : null;
        const probeTolerance = 0.1;

        const resolveImageMetrics = (child: Element, index: number): { img: BoxImagePayload; w: number; h: number } | null => {
            return this.resolveCachedImageMetrics(child, index, availableWidth);
        };

        const probeFrontierExceeded = (cursor: number): boolean => {
            if (stopAtHeight === null) return false;
            return Math.max(cursor, storyMap.maxObstacleBottom()) > stopAtHeight + probeTolerance;
        };

        const finishEarlyProbe = (): FullPourResult => ({
            placedElements,
            registeredObstacles,
            totalHeight: stopAtHeight === null ? Math.max(cursorY, storyMap.maxObstacleBottom()) : stopAtHeight + 1,
            allBoxes
        });

        // Pre-register carry-over obstacles at Y=0 (they bleed in from the
        // previous page and occupy the top of this continuation page).
        for (const co of this.initialObstacles) {
            const rect: OccupiedRect = {
                x: co.x, y: 0, w: co.w, h: co.remainingH, wrap: co.wrap, gap: co.gap,
                gapTop: co.gapTop, gapBottom: co.gapBottom,
                shape: co.shape, path: co.path, circleCy: co.circleCy, align: co.align, zIndex: co.zIndex,
                traversalInteraction: co.traversalInteraction
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
                gap: layout.gap,
                shape: layout.shape,
                path: layout.path
            };
            for (const obstacle of buildExclusionFieldObstacles({
                x: rect.x,
                y: rect.y,
                w: rect.w,
                h: rect.h,
                wrap: layout.wrap,
                gap: layout.gap,
                shape: layout.shape,
                path: layout.path,
                align: layout.align,
                exclusionAssembly: layout.exclusionAssembly
            })) {
                storyMap.register(obstacle);
                registeredObstacles.push(obstacle);
            }
        }

        // -------------------------------------------------------------------
        // Pass 2 – pour
        // -------------------------------------------------------------------
        const placedElements: PlacedElement[] = [];
        const allBoxes: Box[] = [];
        let cursorY = 0;

        if (includeCarryOverVisuals) {
            for (const visual of this.initialCarryOverVisuals) {
                const box = visual.box;
                placedElements.push({
                    kind: 'image',
                    childIndex: -1,
                    box,
                    topY: visual.topY,
                    bottomY: visual.bottomY,
                    isFloat: true,
                    isAbsolute: visual.isAbsolute
                });
                allBoxes.push(box);
            }
        }

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
                    const box = this.buildImageBox(child.element, margins.left + x, effectiveY, imgW, imgH, imgData, child.childIndex, child.actor);
                    allBoxes.push(box);
                    placedElements.push({
                        kind: 'image', childIndex: child.childIndex, box,
                        topY: effectiveY, bottomY: effectiveY + imgH, isFloat: false, isAbsolute: true
                    });
                    if (probeFrontierExceeded(cursorY)) {
                        return finishEarlyProbe();
                    }
                    continue;
                }

                const dims = this.measureFloatBox(child.element, availableWidth);
                if (!dims) continue;
                if (localY + dims.h < 0) continue; // wholly before this page's origin
                const pkg = child.actor;
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
                if (probeFrontierExceeded(cursorY)) {
                    return finishEarlyProbe();
                }
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

                if (layout.wrap !== 'none') {
                    for (const obstacle of buildExclusionFieldObstacles({
                        x: floatX,
                        y: cursorY,
                        w: imgW,
                        h: imgH,
                        wrap: layout.wrap,
                        gap: layout.gap,
                        shape: layout.shape,
                        path: layout.path,
                        align: layout.align,
                        exclusionAssembly: layout.exclusionAssembly
                    })) {
                        storyMap.register(obstacle);
                        registeredObstacles.push(obstacle);
                    }
                }

                const box = this.buildImageBox(
                    child.element, margins.left + floatX, cursorY, imgW, imgH, imgData, child.childIndex, child.actor
                );
                allBoxes.push(box);
                placedElements.push({
                    kind: 'image', childIndex: child.childIndex, box,
                    topY: cursorY, bottomY: cursorY + imgH, isFloat: true, isAbsolute: false
                });
                // Floats do NOT advance cursorY — text flows alongside them.
                if (probeFrontierExceeded(cursorY)) {
                    return finishEarlyProbe();
                }
                continue;
            }

            // ---- float block (non-image element with layout.mode === 'float') ---
            if (child.kind === 'float-block' && layout) {
                const dims = this.measureFloatBox(child.element, availableWidth);
                if (dims) {
                    cursorY = storyMap.topBottomClearY(cursorY);

                    const align: StoryFloatAlign = layout.align;
                    const floatX = resolveFloatX(align, dims.w, availableWidth);

                    if (layout.wrap !== 'none') {
                        for (const obstacle of buildExclusionFieldObstacles({
                            x: floatX,
                            y: cursorY,
                            w: dims.w,
                            h: dims.h,
                            wrap: layout.wrap,
                            gap: layout.gap,
                            shape: layout.shape,
                            path: layout.path,
                            align: layout.align,
                            exclusionAssembly: layout.exclusionAssembly
                        })) {
                            storyMap.register(obstacle);
                            registeredObstacles.push(obstacle);
                        }
                    }

                    const pkg = child.actor;
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
                    if (probeFrontierExceeded(cursorY)) {
                        return finishEarlyProbe();
                    }
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
                    child.element, margins.left, boxY, imgW, imgH, imgData, child.childIndex, child.actor
                );
                allBoxes.push(box);
                placedElements.push({
                    kind: 'image', childIndex: child.childIndex, box,
                    topY: boxY, bottomY: boxY + imgH, isFloat: false, isAbsolute: false
                });
                cursorY = boxY + imgH + marginBottom;
                if (probeFrontierExceeded(cursorY)) {
                    return finishEarlyProbe();
                }
                continue;
            }

            // ---- text / block element --------------------------------------
            const placed = this.pourTextChild(
                child.element, child.childIndex, availableWidth, margins, storyMap, cursorY, 0, child.actor
            );
            if (placed) {
                allBoxes.push(placed.box);
                placedElements.push(placed);
                cursorY = placed.cursorAfter;
                if (probeFrontierExceeded(cursorY)) {
                    return finishEarlyProbe();
                }
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
        xOffset: number = 0,
        actor?: PackagerUnit
    ): PlacedTextElement | null {
        const opticalUnderhang = !!((this.processor as any).config?.layout?.storyWrapOpticalUnderhang);
        const session = this.processor.getCurrentLayoutSession();
        const shaped = (this.processor as any).shapeElement(
            element, { path: [this.storyIndex, childIndex] }
        );
        const marginTop = Math.max(0, shaped.marginTop);
        const placed = reflowTextElementAgainstSpatialField({
            processor: this.processor,
            element,
            path: [this.storyIndex, childIndex],
            availableWidth,
            currentY: cursorY,
            layoutBefore: marginTop,
            spatialMap: storyMap,
            xOffset,
            leftMargin: margins.left,
            pageIndex: session ? session.getCurrentPageIndex() : 0,
            opticalUnderhang,
            clearTopBeforeStart: true
        });
        if (!placed) return null;
        const box = actor
            ? {
                ...placed.box,
                meta: placed.box.meta
                    ? { ...placed.box.meta, actorId: actor.actorId, sourceId: placed.box.meta.sourceId ?? actor.sourceId }
                    : {
                        actorId: actor.actorId,
                        sourceId: actor.sourceId,
                        engineKey: actor.actorId,
                        sourceType: actor.actorKind,
                        fragmentIndex: actor.fragmentIndex,
                        isContinuation: actor.fragmentIndex > 0 || !!actor.continuationOf
                    }
            }
            : placed.box;

        return {
            kind: 'text',
            childIndex,
            box,
            topY: placed.elementStartY,
            contentH: placed.contentHeight,
            insetV: placed.insetV,
            marginTop: placed.marginTop,
            marginBottom: placed.marginBottom,
            cursorAfter: placed.elementStartY + placed.contentHeight + placed.marginBottom,
            sourceElement: element,
            lines: placed.lines,
            lineYOffsets: placed.lineYOffsets,
            lineOffsets: placed.lineOffsets,
            lineWidths: placed.lineWidths,
            uniformLH: placed.uniformLineHeight,
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
            gapBottom: rect.gapBottom,
            shape: rect.shape,
            path: rect.shape === 'polygon' && typeof rect.path === 'string' && rect.path.trim()
                ? translateSvgPath(rect.path, rect.x - left, 0)
                : rect.path,
            circleCy: rect.circleCy,
            align: rect.align,
            zIndex: rect.zIndex,
            traversalInteraction: rect.traversalInteraction
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

        const children = this.storyActorEntries;
        const registeredObstacles: OccupiedRect[] = [];
        const allObstacles: OccupiedRect[] = [];
        const allBoxes: Box[] = [];
        const maxRegionWidth = Math.max(...regions.map((r) => r.w));

        const resolveImageMetrics = (child: NormalizedStoryChild): { img: BoxImagePayload; w: number; h: number } | null => {
            return this.resolveCachedImageMetrics(child.element, child.childIndex, maxRegionWidth);
        };

        for (const visual of this.initialCarryOverVisuals) {
            allBoxes.push(visual.box);
        }

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
                shape: co.shape,
                path: co.path,
                circleCy: co.circleCy,
                align: co.align,
                zIndex: co.zIndex,
                traversalInteraction: co.traversalInteraction
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
                gap: layout.gap,
                shape: layout.shape,
                path: layout.path
            };
            for (const obstacle of buildExclusionFieldObstacles({
                x: rect.x,
                y: rect.y,
                w: rect.w,
                h: rect.h,
                wrap: layout.wrap,
                gap: layout.gap,
                shape: layout.shape,
                path: layout.path,
                align: layout.align,
                exclusionAssembly: layout.exclusionAssembly
            })) {
                allObstacles.push(obstacle);
                registeredObstacles.push(obstacle);
            }
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

                const split = pkg.reshape(remainingHeight, colContext);
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
                        child.childIndex,
                        child.actor
                    );
                    allBoxes.push(box);
                    continue;
                }

                const dims = this.measureFloatBox(child.element, maxRegionWidth);
                if (!dims) continue;
                if (localY + dims.h < 0 || localY > resolveRegionStackHeight(regions)) continue;
                const region = regions[projected.regionIndex];
                const regionStartY = resolveRegionStartY(regions, region.index);
                const pkg = child.actor;
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
                const pkg = child.actor;
                pkg.prepare(availableWidth, availableHeight - spanTopY, spanContext);
                const spanH = pkg.getRequiredHeight();

                if (spanTopY + spanH > availableHeight + 0.1) {
                    // Span does not fit on this page → overflow.
                    hasOverflow = true;
                    nextChildIndex = i;
                    break outer;
                }

                // keepWithNext: if set on the spanning element and the span is not
                // already at the top of the page (to avoid infinite push loops),
                // ensure there is room for at least the minimum height of the next
                // flow child below the span before committing it to this page.
                const spanKeepWithNext = !!(
                    child.element.properties?.keepWithNext
                    ?? (child.element.properties?.style as ElementStyle | undefined)?.keepWithNext
                );
                if (spanKeepWithNext && spanTopY > 0.1) {
                    let nextFlowChild: StoryActorEntry | null = null;
                    for (let j = i + 1; j < children.length; j++) {
                        const c = children[j];
                        if (c.kind === 'story-absolute') continue;
                        if (c.kind === 'column-span') break; // another span handles its own constraint
                        nextFlowChild = c;
                        break;
                    }
                    if (nextFlowChild !== null) {
                        const resumeY = spanTopY + spanH;
                        const resumeRegion = regions[0];
                        const remainingAfterSpan = Math.max(0, availableHeight - resumeY);
                        const nextCtx: PackagerContext = {
                            ...this.createLocalFrameContext(
                                context,
                                resumeRegion.w,
                                {
                                    cursorY: resumeY,
                                    margins: { ...margins, left: margins.left + resumeRegion.x },
                                    pageHeight: availableHeight
                                },
                                resumeY,
                                remainingAfterSpan
                            )
                        };
                        const nextPkg = nextFlowChild.actor;
                        if (nextPkg.prepareLookahead) {
                            nextPkg.prepareLookahead(resumeRegion.w, remainingAfterSpan, nextCtx);
                        } else {
                            nextPkg.prepare(resumeRegion.w, remainingAfterSpan, nextCtx);
                        }
                        const nextMinH = nextPkg.getRequiredHeight();
                        if (resumeY + nextMinH > availableHeight + 0.1) {
                            // Next child won't fit after the span — push span to next page.
                            hasOverflow = true;
                            nextChildIndex = i;
                            break outer;
                        }
                    }
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
                    if (layout.wrap !== 'none') {
                        for (const obstacle of buildExclusionFieldObstacles({
                            x,
                            y: anchorY,
                            w: Math.min(imgW, region.w),
                            h: imgH,
                            wrap: layout.wrap,
                            gap: layout.gap,
                            shape: layout.shape,
                            path: layout.path,
                            align: layout.align,
                            exclusionAssembly: layout.exclusionAssembly
                        })) {
                            allObstacles.push(obstacle);
                            registeredObstacles.push(obstacle);
                        }
                    }

                    const box = this.buildImageBox(child.element, margins.left + x, anchorY, Math.min(imgW, region.w), imgH, imgData, child.childIndex, child.actor);
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

                        if (layout.wrap !== 'none') {
                            for (const obstacle of buildExclusionFieldObstacles({
                                x,
                                y: anchorY,
                                w: effectiveW,
                                h: dims.h,
                                wrap: layout.wrap,
                                gap: layout.gap,
                                shape: layout.shape,
                                path: layout.path,
                                align: layout.align,
                                exclusionAssembly: layout.exclusionAssembly
                            })) {
                                allObstacles.push(obstacle);
                                registeredObstacles.push(obstacle);
                            }
                        }

                        const pkg = child.actor;
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
                        const box = this.buildImageBox(child.element, margins.left + region.x, y, Math.min(imgW, region.w), imgH, imgData, child.childIndex, child.actor);
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
            const pkg = child.actor;

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
                    child.childIndex,
                    region.w,
                    { left: margins.left },
                    regionMap,
                    cursorY,
                    region.x,
                    child.actor
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

    private splitColumns(result: MultiColumnPourResult, availableWidth: number, availableHeight: number): PackagerReshapeResult {
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
        const splitH = Math.max(0, Number(availableHeight) || 0);
        const partABoxes: Box[] = [];
        const carryOverVisuals: CarryOverVisual[] = [];

        for (const box of result.allBoxes) {
            const boxTop = Number(box.y || 0);
            const boxBottom = boxTop + Number(box.h || 0);
            if (!box.image) {
                if (boxTop < splitH - 0.1) {
                    partABoxes.push(cloneBox(box));
                }
                continue;
            }

            if (boxTop >= splitH - 0.1) {
                continue;
            }

            if (boxBottom > splitH + 0.1) {
                const visibleHeight = Math.max(0, splitH - boxTop);
                if (visibleHeight > 0.5) {
                    const clippedBox = cloneBox(box);
                    clippedBox.h = visibleHeight;
                    clippedBox.properties = {
                        ...(clippedBox.properties || {}),
                        _carrySourceOffsetY: 0,
                        _carryOriginalBoxHeight: Number(clippedBox.properties?._carryOriginalBoxHeight ?? box.h),
                        _carryOriginalBoxWidth: Number(clippedBox.properties?._carryOriginalBoxWidth ?? box.w)
                    };
                    partABoxes.push(clippedBox);
                    carryOverVisuals.push(buildCarryOverImageVisualFromBox(box, boxTop, boxBottom, false, splitH));
                }
                continue;
            }

            partABoxes.push(cloneBox(box));
        }

        const partA = new FrozenStoryPackager(partABoxes, result.occupiedHeight, this, availableWidth);
        const partBChildren = buildStoryContinuationChildren(
            children,
            result.continuation.nextChildIndex,
            result.continuation.continuationElement
        );
        if (
            partBChildren.length === 0
            && result.continuation.carryOvers.length === 0
            && !result.continuation.continuationPackager
            && carryOverVisuals.length === 0
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
            result.continuation.continuationPackager,
            carryOverVisuals
        );
        return { currentFragment: partA, continuationFragment: partB };
    }

    private splitResult(
        result: FullPourResult,
        splitH: number,
        availableWidth: number,
        margins: { left: number; right: number; top: number; bottom: number }
    ): PackagerReshapeResult {
        const children = this.storyElement.children ?? [];

        const partABoxes: Box[] = [];
        let partAHeight = 0;
        let partBStartChildIdx = children.length; // default: all in partA
        let partBContinuationElement: Element | null = null;
        const carryOverVisuals: CarryOverVisual[] = [];

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
                        const visibleHeight = Math.max(0, Math.min(bottom, splitH) - elem.topY);
                        if (visibleHeight > 0.5) {
                            const clippedBox = cloneBox(elem.box);
                            if (bottom > splitH) {
                                clippedBox.h = visibleHeight;
                                clippedBox.properties = {
                                    ...(clippedBox.properties || {}),
                                    _carrySourceOffsetY: 0,
                                    _carryOriginalBoxHeight: Number(clippedBox.properties?._carryOriginalBoxHeight ?? elem.box.h),
                                    _carryOriginalBoxWidth: Number(clippedBox.properties?._carryOriginalBoxWidth ?? elem.box.w)
                                };
                                carryOverVisuals.push(buildCarryOverImageVisual(elem, splitH));
                            }
                            partABoxes.push(clippedBox);
                            recordPartAHeight(elem.topY + visibleHeight);
                        }
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

        if (partBChildren.length === 0 && carryOvers.length === 0 && carryOverVisuals.length === 0) {
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
            createContinuationIdentity(this),
            null,
            carryOverVisuals
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
        childIndex: number,
        actor?: PackagerUnit
    ): Box {
        const flowBox = (this.processor as any).shapeElement(
            element, { path: [this.storyIndex, childIndex] }
        );
        const session = this.processor.getCurrentLayoutSession();
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
                _clipShape: element.placement?.shape,
                ...(typeof element.placement?.path === 'string' && element.placement.path.trim()
                    ? { _clipPath: element.placement.path.trim() }
                    : {}),
                _clipAssembly: element.placement?.exclusionAssembly?.members
                    ? element.placement.exclusionAssembly.members.map((member) => ({
                        x: Number(member.x ?? 0),
                        y: Number(member.y ?? 0),
                        w: Math.max(0, Number(member.w ?? 0)),
                        h: Math.max(0, Number(member.h ?? 0)),
                        shape: member.shape ?? 'rect',
                        ...(typeof member.path === 'string' && member.path.trim()
                            ? { path: member.path.trim() }
                            : {})
                    }))
                    : undefined,
                _isFirstLine: true,
                _isLastLine: true,
                _isFirstFragmentInLine: true,
                _isLastFragmentInLine: true,
            },
            meta: {
                ...flowBox.meta,
                ...(actor ? { actorId: actor.actorId, sourceId: flowBox.meta?.sourceId ?? actor.sourceId } : {}),
                pageIndex: session ? session.getCurrentPageIndex() : 0
            }
        };
    }

    private findHostedActorIndex(targetActor: PackagerUnit): number {
        return this.storyActorEntries.findIndex((entry) => entry.actor.actorId === targetActor.actorId);
    }

    private refreshStoryActorEntries(): void {
        const previousActors = this.storyActorEntries.map((entry) => entry.actor);
        this.normalizedStory = normalizeStoryElement(this.storyElement);
        this.storyActorEntries = this.normalizedStory.children.map((child, index) => ({
            ...child,
            actor: previousActors[index] ?? buildPackagerForElement(child.element, child.childIndex, this.processor)
        }));
    }

    private invalidateCachedStoryLayout(): void {
        this.lastResult = null;
        this.lastAvailableWidth = -1;
        this.lastAvailableHeight = -1;
        this.lastViewportSnapshot = null;
        this.imageMetricsCacheDirty = true;
    }

    private resolveCachedImageMetrics(
        child: Element,
        childIndex: number,
        availableWidth: number
    ): { img: BoxImagePayload; w: number; h: number } | null {
        if (!child.image) return null;
        if (this.imageMetricsCacheDirty) {
            this.imageMetricsCache.clear();
            this.imageMetricsCacheDirty = false;
        }
        const key = `${childIndex}:${availableWidth}`;
        if (this.imageMetricsCache.has(key)) return this.imageMetricsCache.get(key)!;
        const imgData = this.resolveImage(child);
        if (!imgData) {
            this.imageMetricsCache.set(key, null);
            return null;
        }
        const { w, h } = this.measureImageBox(child, imgData, availableWidth);
        const cached = { img: imgData, w, h };
        this.imageMetricsCache.set(key, cached);
        return cached;
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
        const resolvedPageIndex = Number.isFinite(overrides.pageIndex)
            ? Number(overrides.pageIndex)
            : context.pageIndex;
        const resolvedCursorY = Number.isFinite(overrides.cursorY)
            ? Number(overrides.cursorY)
            : context.cursorY;
        return {
            ...context,
            ...overrides,
            processor: this.processor,
            publishActorSignal: bindPackagerSignalPublisher((signal) => {
                const session = this.processor.getCurrentLayoutSession();
                if (!session) {
                    return {
                        ...signal,
                        ...(Number.isFinite(signal.pageIndex) || Number.isFinite(resolvedPageIndex)
                            ? { pageIndex: Number.isFinite(signal.pageIndex) ? Number(signal.pageIndex) : Number(resolvedPageIndex) }
                            : {}),
                        ...(Number.isFinite(signal.cursorY) || Number.isFinite(resolvedCursorY)
                            ? { cursorY: Number.isFinite(signal.cursorY) ? Number(signal.cursorY) : Number(resolvedCursorY) }
                            : {}),
                        sequence: -1
                    } as any;
                }
                return session.publishActorSignal(signal);
            }, resolvedPageIndex, resolvedCursorY, resolvePackagerWorldYAtCursor({
                ...context,
                cursorY: resolvedCursorY
            })),
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
        const outerChunkOriginWorldY = Number.isFinite(resolvePackagerChunkOriginWorldY(context))
            ? Math.max(0, Number(resolvePackagerChunkOriginWorldY(context)))
            : null;
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
            ...(outerChunkOriginWorldY !== null
                ? { chunkOriginWorldY: outerChunkOriginWorldY + Math.max(0, Number(localWorldOffsetY) || 0) }
                : {}),
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

function cloneBox(box: Box, pageIndex?: number): Box {
    return {
        ...box,
        properties: { ...(box.properties || {}) },
        ...(box.meta
            ? {
                meta: {
                    ...box.meta,
                    ...(pageIndex !== undefined ? { pageIndex } : {})
                }
            }
            : {})
    };
}

function resolveViewportSnapshot(context: PackagerContext): StoryViewportSnapshot {
    return {
        pageIndex: Number.isFinite(context.pageIndex) ? Number(context.pageIndex) : 0,
        chunkOriginWorldY: Number.isFinite(resolvePackagerChunkOriginWorldY(context))
            ? Number(resolvePackagerChunkOriginWorldY(context))
            : null,
        viewportHeight: Number.isFinite(context.viewportHeight) ? Number(context.viewportHeight) : null
    };
}

function sameViewportSnapshot(
    left: StoryViewportSnapshot | null,
    right: StoryViewportSnapshot | null
): boolean {
    if (!left || !right) return left === right;
    return left.pageIndex === right.pageIndex
        && left.chunkOriginWorldY === right.chunkOriginWorldY
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
            const co: CarryOverObstacle = {
                x: obstacle.x,
                w: obstacle.w,
                remainingH: Math.max(0, obstacleBottom - splitY),
                wrap: obstacle.wrap,
                gap: obstacle.gap,
                gapTop: 0,
                gapBottom: obstacle.gap,
                shape: obstacle.shape,
                path: obstacle.path,
                zIndex: obstacle.zIndex,
                traversalInteraction: obstacle.traversalInteraction
            };
            if (obstacle.shape === 'circle') {
                // Translate the circle centre into the new page's coordinate space
                // (new page Y=0 corresponds to splitY in the old page).
                const originalCy = obstacle.circleCy ?? (obstacle.y + obstacle.h / 2);
                co.circleCy = originalCy - splitY;
            }
            if (obstacle.shape === 'polygon' && typeof obstacle.path === 'string' && obstacle.path.trim()) {
                co.path = translateSvgPath(obstacle.path, 0, obstacle.y - splitY);
            }
            co.align = obstacle.align;
            carryOvers.push(co);
        }
    }
    return carryOvers;
}

function buildCarryOverImageVisual(element: PlacedImageElement, splitY: number): CarryOverVisual {
    return buildCarryOverImageVisualFromBox(element.box, element.topY, element.bottomY, element.isAbsolute, splitY);
}

function buildCarryOverImageVisualFromBox(
    sourceBox: Box,
    topY: number,
    bottomY: number,
    isAbsolute: boolean,
    splitY: number
): CarryOverVisual {
    const cropTop = Math.max(0, splitY - topY);
    const originalCarryOffset = Number(sourceBox.properties?._carrySourceOffsetY ?? 0);
    const originalBoxHeight = Number(sourceBox.properties?._carryOriginalBoxHeight ?? sourceBox.h);
    const originalBoxWidth = Number(sourceBox.properties?._carryOriginalBoxWidth ?? sourceBox.w);
    const box: Box = {
        ...sourceBox,
        y: 0,
        h: Math.max(0, bottomY - splitY),
        properties: {
            ...(sourceBox.properties || {}),
            _carrySourceOffsetY: originalCarryOffset + cropTop,
            _carryOriginalBoxHeight: originalBoxHeight,
            _carryOriginalBoxWidth: originalBoxWidth
        },
        ...(sourceBox.meta ? { meta: { ...sourceBox.meta } } : {})
    };
    return {
        box,
        topY: 0,
        bottomY: Math.max(0, bottomY - splitY),
        isAbsolute
    };
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
