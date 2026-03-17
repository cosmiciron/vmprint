/**
 * ZonePackager – Layout Zone sub-session engine.
 *
 * A `zone-map` element defines a row of independent layout regions (zones).
 * Each zone runs its own non-paginating layout pass — the "stripped march" —
 * and emits boxes in zone-local coordinates. The ZonePackager then composites
 * all zone boxes into page space.
 *
 * Architecture: Map + Regions
 * ---------------------------
 * The page is a map. Each zone is a region on that map with its own bounded
 * coordinate space (origin at the zone's top-left corner). Content assigned to
 * a zone flows independently — no zone knows about its neighbours.
 *
 * The stripped march
 * ------------------
 * Unlike the main simulation loop (which paginates, snapshots, and rolls back),
 * the per-zone pass is a pure vertical accumulation:
 *   for each child packager → prepare → emitBoxes → advance cursorY
 * No page-break decisions, no keepWithNext negotiation, no actor splitting.
 * This is valid because `zone-map` is always `move-whole` in V1: the entire
 * zone-map moves to the next page if it doesn't fit.
 *
 * Column widths are resolved via `solveTrackSizing` (same solver as tables),
 * so fixed / auto / flex (`fr`) column definitions all work out of the box.
 */

import { Box, Element, ElementStyle, TableColumnSizing, ZoneDefinition, ZoneLayoutOptions } from '../../types';
import { LayoutProcessor } from '../layout-core';
import { LayoutUtils } from '../layout-utils';
import { solveTrackSizing, TrackSizingDefinition } from '../track-sizing';
import type { ActorSignalDraft } from '../actor-event-bus';
import type { NormalizedIndependentZoneStrip } from '../normalized-zone-strip';
import {
    PackagerContext,
    PackagerPlacementPreference,
    PackagerSplitResult,
    PackagerTransformProfile,
    PackagerUnit
} from './packager-types';
import { buildPackagerForElement } from './create-packagers';
import { createElementPackagerIdentity, PackagerIdentity } from './packager-identity';
import { LAYOUT_DEFAULTS } from '../defaults';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function isZoneMapElement(element: Element | undefined): boolean {
    return String(element?.type || '').trim().toLowerCase() === 'zone-map';
}

// ---------------------------------------------------------------------------
// Stripped march — non-paginating sequential placement
// ---------------------------------------------------------------------------

/**
 * Places a sequence of packagers top-to-bottom in a fixed-width column.
 * No pagination; no splitting. Returns boxes in column-local space (y=0 at top).
 */
function placePackagersInZone(
    packagers: PackagerUnit[],
    availableWidth: number,
    contextBase: Omit<PackagerContext, 'pageIndex' | 'cursorY'>
): { boxes: Box[]; height: number } {
    const placedBoxes: Box[] = [];
    let currentY = 0;
    let lastSpacingAfter = 0;

    for (const actor of packagers) {
        const marginTop = actor.getMarginTop();
        const marginBottom = actor.getMarginBottom();
        const layoutBefore = lastSpacingAfter + marginTop;
        const layoutDelta = lastSpacingAfter; // = layoutBefore - marginTop

        const context: PackagerContext = {
            ...contextBase,
            pageIndex: 0,
            cursorY: currentY
        };

        actor.prepare(availableWidth, Infinity, context);
        const emitted = actor.emitBoxes(availableWidth, Infinity, context) || [];

        for (const box of emitted) {
            placedBoxes.push({
                ...box,
                y: (box.y || 0) + currentY + layoutDelta
            });
        }

        const contentHeight = Math.max(0, actor.getRequiredHeight() - marginTop - marginBottom);
        const requiredHeight = contentHeight + layoutBefore + marginBottom;
        const effectiveHeight = Math.max(requiredHeight, LAYOUT_DEFAULTS.minEffectiveHeight);
        currentY += effectiveHeight - marginBottom;
        lastSpacingAfter = marginBottom;
    }

    return { boxes: placedBoxes, height: currentY + lastSpacingAfter };
}

// ---------------------------------------------------------------------------
// Zone materialization
// ---------------------------------------------------------------------------

type ZoneMaterialized = {
    boxes: Box[];
    totalHeight: number;
    marginTop: number;
    marginBottom: number;
};

function resolveTrackWidths(columns: TableColumnSizing[] | undefined, columnCount: number, availableWidth: number, gap: number): number[] {
    if (columns && columns.length > 0) {
        const tracks: TrackSizingDefinition[] = columns.map((c) => ({
            mode: c.mode || 'auto',
            value: c.value,
            fr: c.fr,
            min: c.min,
            max: c.max,
            basis: c.basis,
            minContent: c.minContent,
            maxContent: c.maxContent,
            grow: c.grow,
            shrink: c.shrink
        }));
        return solveTrackSizing({ containerWidth: availableWidth, tracks, gap }).sizes;
    }
    // Equal columns by default
    const colWidth = (availableWidth - gap * Math.max(0, columnCount - 1)) / Math.max(1, columnCount);
    return Array(columnCount).fill(Math.max(0, colWidth));
}

function normalizeZoneMapElement(element: Element, availableWidth: number): NormalizedIndependentZoneStrip {
    const style = (element.properties?.style ?? {}) as ElementStyle;
    const marginTop = Math.max(0, LayoutUtils.validateUnit(style.marginTop ?? 0));
    const marginBottom = Math.max(0, LayoutUtils.validateUnit(style.marginBottom ?? 0));

    const options = (element.properties?.zones ?? {}) as ZoneLayoutOptions;
    const gap = Math.max(0, LayoutUtils.validateUnit(options.gap ?? 0));

    // Zones are region descriptors on the element — not DOM children.
    const zoneDefs: ZoneDefinition[] = Array.isArray(element.zones) ? element.zones : [];
    const columnCount = zoneDefs.length;

    if (columnCount === 0) {
        return {
            kind: 'zone-strip',
            overflow: 'independent',
            sourceKind: 'zone-map',
            marginTop,
            marginBottom,
            gap,
            blockStyle: Object.keys(style).length > 0 ? style : undefined,
            zones: []
        };
    }

    const columnWidths = resolveTrackWidths(options.columns, columnCount, availableWidth, gap);

    // Compute x offsets for each zone column
    const xOffsets: number[] = [];
    let xCursor = 0;
    for (let i = 0; i < columnCount; i++) {
        xOffsets.push(xCursor);
        xCursor += (columnWidths[i] ?? 0) + (i < columnCount - 1 ? gap : 0);
    }

    return {
        kind: 'zone-strip',
        overflow: 'independent',
        sourceKind: 'zone-map',
        marginTop,
        marginBottom,
        gap,
        blockStyle: Object.keys(style).length > 0 ? style : undefined,
        zones: zoneDefs.map((zone, index) => ({
            id: zone.id,
            x: xOffsets[index] ?? 0,
            width: columnWidths[index] ?? 0,
            elements: zone.elements ?? [],
            style: zone.style as ElementStyle | undefined
        }))
    };
}

function materializeZoneStrip(strip: NormalizedIndependentZoneStrip, availableWidth: number, processor: LayoutProcessor): ZoneMaterialized {
    // Stub PackagerContext base — zone sub-sessions do not publish signals
    const stubContextBase: Omit<PackagerContext, 'pageIndex' | 'cursorY'> = {
        processor,
        margins: { top: 0, right: 0, bottom: 0, left: 0 },
        pageWidth: availableWidth,
        pageHeight: Infinity,
        publishActorSignal: (_signal: ActorSignalDraft) => ({
            topic: '',
            publisherActorId: '',
            publisherSourceId: '',
            publisherActorKind: '',
            fragmentIndex: 0,
            pageIndex: 0,
            sequence: 0
        }),
        readActorSignals: () => []
    };

    const allBoxes: Box[] = [];
    let totalHeight = 0;

    for (let i = 0; i < strip.zones.length; i++) {
        const zone = strip.zones[i];
        // Each zone's elements are the actors inhabiting this region.
        const packagers = (zone.elements ?? []).map((actor, j) =>
            buildPackagerForElement(actor, j, processor)
        );

        // Override contextBase with this zone's width.
        // contentWidthOverride signals FlowBoxPackager to wrap text at zoneWidth
        // rather than the page content width from the surrounding main layout.
        const zoneContextBase = { ...stubContextBase, pageWidth: zone.width, contentWidthOverride: zone.width };
        const result = placePackagersInZone(packagers, zone.width, zoneContextBase);

        // Offset each box into zone-map-local space (x += column x offset)
        for (const box of result.boxes) {
            allBoxes.push({ ...box, x: (box.x || 0) + zone.x });
        }

        totalHeight = Math.max(totalHeight, result.height);
    }

    return { boxes: allBoxes, totalHeight, marginTop: strip.marginTop, marginBottom: strip.marginBottom };
}

// ---------------------------------------------------------------------------
// ZonePackager
// ---------------------------------------------------------------------------

/**
 * Packager for `zone-map` elements. Wraps the zone materialization in the
 * standard `PackagerUnit` protocol so the main simulation march can place it
 * like any other actor.
 *
 * Always reports `isUnbreakable = true` (move-whole semantics in V1).
 */
export class ZonePackager implements PackagerUnit {
    private element: Element;
    private processor: LayoutProcessor;
    private lastAvailableWidth: number = -1;
    private materializedBoxes: Box[] | null = null;
    private marginTopVal: number = 0;
    private marginBottomVal: number = 0;
    private totalZoneHeight: number = 0;

    readonly actorId: string;
    readonly sourceId: string;
    readonly actorKind: string;
    readonly fragmentIndex: number;
    readonly continuationOf?: string;

    get pageBreakBefore(): boolean | undefined {
        return (this.element.properties?.style as ElementStyle | undefined)?.pageBreakBefore ?? undefined;
    }

    get keepWithNext(): boolean | undefined {
        return (this.element.properties?.style as ElementStyle | undefined)?.keepWithNext ?? undefined;
    }

    constructor(element: Element, processor: LayoutProcessor, identity?: PackagerIdentity) {
        this.element = element;
        this.processor = processor;
        const resolved = identity ?? createElementPackagerIdentity(element, [0]);
        this.actorId = resolved.actorId;
        this.sourceId = resolved.sourceId;
        this.actorKind = resolved.actorKind;
        this.fragmentIndex = resolved.fragmentIndex;
        this.continuationOf = resolved.continuationOf;
    }

    private materialize(availableWidth: number): void {
        if (this.materializedBoxes !== null && this.lastAvailableWidth === availableWidth) return;
        const normalizedStrip = normalizeZoneMapElement(this.element, availableWidth);
        const result = materializeZoneStrip(normalizedStrip, availableWidth, this.processor);
        this.materializedBoxes = result.boxes;
        this.marginTopVal = result.marginTop;
        this.marginBottomVal = result.marginBottom;
        this.totalZoneHeight = result.totalHeight;
        this.lastAvailableWidth = availableWidth;
    }

    prepare(availableWidth: number, _availableHeight: number, _context: PackagerContext): void {
        this.materialize(availableWidth);
    }

    getPlacementPreference(fullAvailableWidth: number, _context: PackagerContext): PackagerPlacementPreference {
        return { minimumWidth: fullAvailableWidth, acceptsFrame: true };
    }

    getTransformProfile(): PackagerTransformProfile {
        return {
            capabilities: [
                { kind: 'morph', preservesIdentity: true, reflowsContent: true }
            ]
        };
    }

    /**
     * Emits zone-map boxes shifted into page space.
     *
     * y-shift: adds the zone-map's own marginTop so that `commitFragmentBoxes`
     * (which adds `currentY + layoutDelta`) produces the correct final page y.
     *
     * x-shift: adds `context.margins.left` because `positionFlowBox` was called
     * inside the zone sub-session with `margins.left = 0` (zone-local coordinates
     * start at x=0). The page left margin must be applied here so boxes land in
     * the content area, not at the page edge.
     */
    emitBoxes(availableWidth: number, _availableHeight: number, context: PackagerContext): Box[] {
        this.materialize(availableWidth);
        const mt = this.marginTopVal;
        const leftMargin = context.margins.left;
        return (this.materializedBoxes || []).map((b) => ({
            ...b,
            x: (b.x || 0) + leftMargin,
            y: (b.y || 0) + mt
        }));
    }

    getRequiredHeight(): number {
        return this.marginTopVal + this.totalZoneHeight + this.marginBottomVal;
    }

    /** V1: zone-maps are always unbreakable (move-whole). */
    isUnbreakable(_availableHeight: number): boolean {
        return true;
    }

    getMarginTop(): number { return this.marginTopVal; }
    getMarginBottom(): number { return this.marginBottomVal; }

    split(_availableHeight: number, _context: PackagerContext): PackagerSplitResult {
        return { currentFragment: null, continuationFragment: this };
    }
}
