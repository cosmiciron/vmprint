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
 * This is valid because the currently active `zone-map` runtime path still
 * uses V1 `move-whole` semantics: the entire zone-map moves to the next page
 * if it doesn't fit. AST/normalization may already carry a more explicit zone
 * field lifecycle mode, but this packager still implements the conservative
 * V1 branch only.
 *
 * Column widths are resolved via `solveTrackSizing` (same solver as tables),
 * so fixed / auto / flex (`fr`) column definitions all work out of the box.
 */

import { Box, DebugZoneRegion, Element, ElementStyle, RichLine, SpatialFieldDirective, StoryFloatAlign, TableColumnSizing, ZoneDefinition, ZoneLayoutOptions, ZoneWorldBehavior } from '../../types';
import { buildExclusionFieldObstacles } from '../exclusion-field';
import { LayoutProcessor } from '../layout-core';
import { LayoutUtils } from '../layout-utils';
import { reflowTextElementAgainstSpatialField } from '../spatial-field-reflow';
import { solveTrackSizing, TrackSizingDefinition } from '../track-sizing';
import type { ActorSignalDraft } from '../actor-event-bus';
import type { NormalizedIndependentZoneStrip } from '../normalized-zone-strip';
import { OccupiedRect, SpatialMap } from './spatial-map';
import {
    PackagerContext,
    PackagerPlacementPreference,
    PackagerSplitResult,
    PackagerTransformProfile,
    PackagerUnit
} from './packager-types';
import { buildPackagerForElement } from './create-packagers';
import { createContinuationIdentity, createElementPackagerIdentity, PackagerIdentity } from './packager-identity';
import { LAYOUT_DEFAULTS } from '../defaults';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function isZoneMapElement(element: Element | undefined): boolean {
    return String(element?.type || '').trim().toLowerCase() === 'zone-map';
}

type ZoneFieldState = {
    wrap: 'around' | 'top-bottom' | 'none';
    hidden: boolean;
    obstacles: OccupiedRect[];
};

type ZoneTextPlacement = {
    boxes: Box[];
    requiredHeight: number;
};

function readZoneFieldDirective(boxes: Box[]): SpatialFieldDirective | null {
    for (const box of boxes) {
        const directive =
            (box.properties?.spatialField as SpatialFieldDirective | undefined)
            ?? (box.properties?.zoneField as SpatialFieldDirective | undefined);
        if (directive && typeof directive === 'object') {
            return directive;
        }
    }
    return null;
}

function resolveZoneFieldAnchorX(align: StoryFloatAlign, zoneWidth: number, fieldWidth: number): number {
    if (align === 'right') return Math.max(0, zoneWidth - fieldWidth);
    if (align === 'center') return Math.max(0, (zoneWidth - fieldWidth) / 2);
    return 0;
}

function buildZoneFieldState(
    emitted: Box[],
    directive: SpatialFieldDirective,
    zoneWidth: number,
    baseY: number
): { boxes: Box[]; field: ZoneFieldState } {
    const anchorBox = emitted[0];
    const align = directive.align ?? 'left';
    const wrap = directive.wrap ?? 'around';
    const hidden = directive.hidden === true;
    const fieldWidth = Math.max(0, anchorBox?.w || 0);
    const fieldHeight = Math.max(0, anchorBox?.h || 0);
    const fieldX = Number.isFinite(directive.x) ? Math.max(0, Number(directive.x)) : resolveZoneFieldAnchorX(align, zoneWidth, fieldWidth);
    const fieldY = Number.isFinite(directive.y) ? Math.max(0, Number(directive.y)) : baseY;
    const translatedBoxes = emitted.map((box) => ({
        ...box,
        x: (box.x || 0) + fieldX,
        y: (box.y || 0) + fieldY,
        properties: {
            ...(box.properties || {}),
            ...(directive.exclusionAssembly?.members
                ? {
                    _clipAssembly: directive.exclusionAssembly.members.map((member) => ({
                        x: Number(member.x ?? 0),
                        y: Number(member.y ?? 0),
                        w: Math.max(0, Number(member.w ?? 0)),
                        h: Math.max(0, Number(member.h ?? 0)),
                        shape: (member.shape ?? 'rect') as 'rect' | 'circle'
                    }))
                }
                : directive.shape
                    ? { _clipShape: directive.shape }
                    : {}),
            ...(hidden ? { opacity: 0 } : {})
        }
    }));

    return {
        boxes: translatedBoxes,
        field: {
            wrap,
            hidden,
            obstacles: buildExclusionFieldObstacles({
                x: fieldX,
                y: fieldY,
                width: fieldWidth,
                height: fieldHeight,
                gap: directive.gap ?? 0,
                shape: directive.shape ?? 'rect',
                align,
                wrap,
                exclusionAssembly: directive.exclusionAssembly
            })
        }
    };
}

function intersectsVertically(obstacle: OccupiedRect, top: number, bottom: number): boolean {
    const obstacleTop = obstacle.y;
    const obstacleBottom = obstacle.y + obstacle.h;
    return obstacleBottom > top && obstacleTop < bottom;
}

function resolveZoneLane(
    zoneWidth: number,
    top: number,
    height: number,
    fields: ZoneFieldState[]
): { x: number; width: number } {
    const bottom = top + Math.max(0, height);
    const occupied: Array<{ start: number; end: number }> = [];

    for (const field of fields) {
        if (field.wrap !== 'around') continue;
        for (const obstacle of field.obstacles) {
            if (!intersectsVertically(obstacle, top, bottom)) continue;
            occupied.push({
                start: Math.max(0, obstacle.x),
                end: Math.min(zoneWidth, obstacle.x + obstacle.w)
            });
        }
    }

    if (occupied.length === 0) {
        return { x: 0, width: zoneWidth };
    }

    occupied.sort((a, b) => a.start - b.start || a.end - b.end);
    const merged: Array<{ start: number; end: number }> = [];
    for (const segment of occupied) {
        if (segment.end <= segment.start) continue;
        const previous = merged[merged.length - 1];
        if (!previous || segment.start > previous.end) {
            merged.push({ ...segment });
            continue;
        }
        previous.end = Math.max(previous.end, segment.end);
    }

    let bestX = 0;
    let bestWidth = 0;
    let cursor = 0;
    for (const segment of merged) {
        const gapWidth = Math.max(0, segment.start - cursor);
        if (gapWidth > bestWidth) {
            bestX = cursor;
            bestWidth = gapWidth;
        }
        cursor = Math.max(cursor, segment.end);
    }

    const trailingWidth = Math.max(0, zoneWidth - cursor);
    if (trailingWidth > bestWidth) {
        bestX = cursor;
        bestWidth = trailingWidth;
    }

    return {
        x: bestX,
        width: bestWidth
    };
}

function buildZoneSpatialMap(fields: ZoneFieldState[]): SpatialMap {
    const map = new SpatialMap();
    for (const field of fields) {
        for (const obstacle of field.obstacles) {
            map.register(obstacle);
        }
    }
    return map;
}

function tryPlaceZoneTextActor(
    actor: PackagerUnit,
    element: Element,
    processor: LayoutProcessor,
    availableWidth: number,
    currentY: number,
    layoutBefore: number,
    activeFields: ZoneFieldState[]
): ZoneTextPlacement | null {
    if (activeFields.length === 0) return null;
    if (String(element.type || '').toLowerCase() === 'image') return null;
    const storyMap = buildZoneSpatialMap(activeFields);
    const placed = reflowTextElementAgainstSpatialField({
        processor,
        element,
        path: [0],
        availableWidth,
        currentY,
        layoutBefore,
        spatialMap: storyMap,
        pageIndex: 0,
        clearTopBeforeStart: false
    });
    if (!placed) return null;

    const requiredHeight = Math.max(0, layoutBefore) + placed.contentHeight + placed.marginBottom;
    return {
        boxes: [placed.box],
        requiredHeight: Math.max(requiredHeight, LAYOUT_DEFAULTS.minEffectiveHeight)
    };
}

// ---------------------------------------------------------------------------
// Stripped march — non-paginating sequential placement
// ---------------------------------------------------------------------------

/**
 * Places a sequence of packagers top-to-bottom in a fixed-width column.
 * No pagination; no splitting. Returns boxes in column-local space (y=0 at top).
 */
function placePackagersInZone(
    packagers: ZoneActorEntry[],
    availableWidth: number,
    contextBase: Omit<PackagerContext, 'pageIndex' | 'cursorY'>
): { boxes: Box[]; height: number } {
    const placedBoxes: Box[] = [];
    const activeFields: ZoneFieldState[] = [];
    let currentY = 0;
    let lastSpacingAfter = 0;

    for (const entry of packagers) {
        const actor = entry.actor;
        const marginTop = actor.getMarginTop();
        const marginBottom = actor.getMarginBottom();
        const layoutBefore = lastSpacingAfter + marginTop;
        const layoutDelta = lastSpacingAfter; // = layoutBefore - marginTop
        const blockTop = currentY + layoutDelta;

        const textPlacement = tryPlaceZoneTextActor(
            actor,
            entry.element,
            contextBase.processor,
            availableWidth,
            currentY,
            layoutBefore,
            activeFields
        );
        if (textPlacement) {
            placedBoxes.push(...textPlacement.boxes);
            currentY += textPlacement.requiredHeight - marginBottom;
            lastSpacingAfter = marginBottom;
            continue;
        }

        const initialLane = resolveZoneLane(availableWidth, blockTop, LAYOUT_DEFAULTS.minEffectiveHeight, activeFields);

        const context: PackagerContext = {
            ...contextBase,
            pageIndex: 0,
            cursorY: currentY
        };
        const initialContext: PackagerContext = {
            ...context,
            contentWidthOverride: initialLane.width || availableWidth,
            pageWidth: initialLane.width || availableWidth
        };

        actor.prepare(initialLane.width || availableWidth, Infinity, initialContext);
        const provisionalHeight = Math.max(
            LAYOUT_DEFAULTS.minEffectiveHeight,
            actor.getRequiredHeight() - marginTop - marginBottom + layoutBefore + marginBottom
        );
        const lane = resolveZoneLane(availableWidth, blockTop, provisionalHeight, activeFields);
        const laneContext: PackagerContext = {
            ...context,
            contentWidthOverride: lane.width || availableWidth,
            pageWidth: lane.width || availableWidth
        };
        if (Math.abs(lane.width - initialLane.width) > 0.1) {
            actor.prepare(lane.width || availableWidth, Infinity, laneContext);
        }
        const emitted = actor.emitBoxes(lane.width || availableWidth, Infinity, laneContext) || [];
        const zoneField = readZoneFieldDirective(emitted);

        if (zoneField) {
            const fieldState = buildZoneFieldState(emitted, zoneField, availableWidth, blockTop);
            placedBoxes.push(...fieldState.boxes);
            activeFields.push(fieldState.field);
            continue;
        }

        for (const box of emitted) {
            placedBoxes.push({
                ...box,
                x: (box.x || 0) + lane.x,
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

type ZoneSessionResult = {
    boxes: Box[];
    height: number;
};

type ZoneSessionContinuation = {
    nextActorIndex: number;
    continuationFragment: PackagerUnit | null;
};

type ZoneActorEntry = {
    actor: PackagerUnit;
    element: Element;
};

type BoundedZoneSessionResult = ZoneSessionResult & {
    consumedHeight: number;
    hasOverflow: boolean;
    continuation: ZoneSessionContinuation | null;
};

type ZoneActorQueue = {
    id?: string;
    rect: {
        x: number;
        y: number;
        width: number;
        height?: number;
    };
    style?: ElementStyle;
    actors: ZoneActorEntry[];
};

type ZoneDebugBoxTag = {
    fieldActorId: string;
    fieldSourceId: string;
    zoneId?: string;
    zoneIndex: number;
    rect: {
        x: number;
        y: number;
        width: number;
        height?: number;
    };
};

function cloneZoneBoxes(boxes: Box[]): Box[] {
    return boxes.map((box) => ({
        ...box,
        properties: { ...(box.properties || {}) },
        meta: box.meta ? { ...box.meta } : box.meta
    }));
}

function attachZoneDebugTag(box: Box, tag: ZoneDebugBoxTag): Box {
    return {
        ...box,
        properties: {
            ...(box.properties || {}),
            __vmprintZoneDebug: {
                fieldActorId: tag.fieldActorId,
                fieldSourceId: tag.fieldSourceId,
                zoneId: tag.zoneId,
                zoneIndex: tag.zoneIndex,
                rect: { ...tag.rect }
            }
        }
    };
}

function readZoneDebugTag(box: Box): ZoneDebugBoxTag | null {
    const tag = box.properties?.__vmprintZoneDebug as ZoneDebugBoxTag | undefined;
    if (!tag || typeof tag !== 'object') return null;
    return tag;
}

function buildZoneContinuationQueue(
    zone: ZoneActorQueue,
    continuation: ZoneSessionContinuation | null
): ZoneActorQueue {
    if (!continuation) {
        return {
            ...zone,
            actors: []
        };
    }

    const nextActors: ZoneActorEntry[] = [];
    if (continuation.continuationFragment) {
        nextActors.push({
            actor: continuation.continuationFragment,
            element: zone.actors[continuation.nextActorIndex]?.element
        });
    }

    const untouchedStart = continuation.nextActorIndex + (continuation.continuationFragment ? 1 : 0);
    for (let actorIndex = untouchedStart; actorIndex < zone.actors.length; actorIndex++) {
        nextActors.push(zone.actors[actorIndex]);
    }

    return {
        ...zone,
        actors: nextActors
    };
}

function resolveZoneVisibleHeight(
    zone: ZoneActorQueue,
    fieldAvailableHeight: number
): number {
    const heightWithinViewport = Math.max(0, fieldAvailableHeight - zone.rect.y);
    if (zone.rect.height === undefined) {
        return heightWithinViewport;
    }
    return Math.min(heightWithinViewport, Math.max(0, Number(zone.rect.height)));
}

function resolveZoneFootprintHeight(
    zone: ZoneActorQueue | NormalizedIndependentZoneStrip['zones'][number],
    contentHeight: number
): number {
    const authoredHeight = zone.rect.height !== undefined ? Math.max(0, Number(zone.rect.height)) : 0;
    return Math.max(Math.max(0, contentHeight), authoredHeight);
}

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

export function normalizeZoneMapElement(element: Element, availableWidth: number): NormalizedIndependentZoneStrip {
    const style = (element.properties?.style ?? {}) as ElementStyle;
    const marginTop = Math.max(0, LayoutUtils.validateUnit(style.marginTop ?? 0));
    const marginBottom = Math.max(0, LayoutUtils.validateUnit(style.marginBottom ?? 0));

    const options = (element.zoneLayout ?? {}) as ZoneLayoutOptions;
    const gap = Math.max(0, LayoutUtils.validateUnit(options.gap ?? 0));
    const frameOverflow = options.frameOverflow === 'continue' ? 'continue' : 'move-whole';
    const worldBehavior = options.worldBehavior === 'spanning' || options.worldBehavior === 'expandable'
        ? options.worldBehavior
        : 'fixed';

    // Zones are region descriptors on the element — not DOM children.
    const zoneDefs: ZoneDefinition[] = Array.isArray(element.zones) ? element.zones : [];
    const columnCount = zoneDefs.length;

    if (columnCount === 0) {
        return {
            kind: 'zone-strip',
            overflow: 'independent',
            sourceKind: 'zone-map',
            frameOverflow,
            worldBehavior,
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
        frameOverflow,
        worldBehavior,
        marginTop,
        marginBottom,
        gap,
        blockStyle: Object.keys(style).length > 0 ? style : undefined,
        zones: zoneDefs.map((zone, index) => ({
            id: zone.id,
            rect: zone.region
                ? {
                    x: Math.max(0, LayoutUtils.validateUnit(zone.region.x ?? 0)),
                    y: Math.max(0, LayoutUtils.validateUnit(zone.region.y ?? 0)),
                    width: Math.max(0, LayoutUtils.validateUnit(zone.region.width ?? 0)),
                    ...(zone.region.height !== undefined
                        ? { height: Math.max(0, LayoutUtils.validateUnit(zone.region.height)) }
                        : {})
                }
                : {
                    x: xOffsets[index] ?? 0,
                    y: 0,
                    width: columnWidths[index] ?? 0
                },
            elements: zone.elements ?? [],
            style: zone.style as ElementStyle | undefined
        }))
    };
}

function createZoneSessionContextBase(
    availableWidth: number,
    processor: LayoutProcessor
): Omit<PackagerContext, 'pageIndex' | 'cursorY'> {
    // Zone sub-sessions currently run in the V1 infinite-height branch and do
    // not participate in the main session event bus yet.
    return {
        processor,
        margins: { top: 0, right: 0, bottom: 0, left: 0 },
        pageWidth: availableWidth,
        pageHeight: Infinity,
        publishActorSignal: (_signal: ActorSignalDraft) => ({
            topic: '',
            publisherActorId: '',
            publisherSourceId: '',
            publisherActorKind: '',
            tick: 0,
            fragmentIndex: 0,
            pageIndex: 0,
            sequence: 0
        }),
        readActorSignals: () => []
    };
}

function buildZonePackagers(
    zone: NormalizedIndependentZoneStrip['zones'][number],
    processor: LayoutProcessor
): ZoneActorEntry[] {
    return (zone.elements ?? []).map((element, j) => ({
        element,
        actor: buildPackagerForElement(element, j, processor)
    }));
}

function buildZoneActorQueues(
    strip: NormalizedIndependentZoneStrip,
    processor: LayoutProcessor
): ZoneActorQueue[] {
    return strip.zones.map((zone) => ({
        id: zone.id,
        rect: { ...zone.rect },
        style: zone.style,
        actors: buildZonePackagers(zone, processor)
    }));
}

function runZoneSession(
    zone: NormalizedIndependentZoneStrip['zones'][number],
    processor: LayoutProcessor,
    contextBase: Omit<PackagerContext, 'pageIndex' | 'cursorY'>
): ZoneSessionResult {
    const packagers = buildZonePackagers(zone, processor);
    const zoneWidth = zone.rect.width;
    const zoneContextBase = { ...contextBase, pageWidth: zoneWidth, contentWidthOverride: zoneWidth };
    const result = placePackagersInZone(packagers, zoneWidth, zoneContextBase);
    return { boxes: result.boxes, height: result.height };
}

function runZoneSessionBounded(
    zone: ZoneActorQueue,
    contextBase: Omit<PackagerContext, 'pageIndex' | 'cursorY'>,
    availableHeight: number
): BoundedZoneSessionResult {
    const zoneWidth = zone.rect.width;
    const zoneContextBase = { ...contextBase, pageWidth: zoneWidth, contentWidthOverride: zoneWidth };
    const placedBoxes: Box[] = [];
    const activeFields: ZoneFieldState[] = [];
    let currentY = 0;
    let lastSpacingAfter = 0;

    for (let actorIndex = 0; actorIndex < zone.actors.length; actorIndex++) {
        const entry = zone.actors[actorIndex];
        const actor = entry.actor;
        const marginTop = actor.getMarginTop();
        const marginBottom = actor.getMarginBottom();
        const layoutBefore = lastSpacingAfter + marginTop;
        const layoutDelta = lastSpacingAfter;
        const remainingHeight = Math.max(0, availableHeight - currentY - layoutDelta);
        const blockTop = currentY + layoutDelta;
        const initialLane = resolveZoneLane(zoneWidth, blockTop, LAYOUT_DEFAULTS.minEffectiveHeight, activeFields);
        const context: PackagerContext = {
            ...zoneContextBase,
            pageIndex: 0,
            cursorY: currentY
        };
        const initialContext: PackagerContext = {
            ...context,
            contentWidthOverride: initialLane.width || zoneWidth,
            pageWidth: initialLane.width || zoneWidth
        };

        const textPlacement = tryPlaceZoneTextActor(
            actor,
            entry.element,
            zoneContextBase.processor,
            zoneWidth,
            currentY,
            layoutBefore,
            activeFields
        );
        if (textPlacement) {
            if (currentY + textPlacement.requiredHeight > availableHeight + 0.01) {
                return {
                    boxes: placedBoxes,
                    height: currentY + lastSpacingAfter,
                    consumedHeight: Math.min(availableHeight, currentY + lastSpacingAfter),
                    hasOverflow: true,
                    continuation: {
                        nextActorIndex: actorIndex,
                        continuationFragment: actor
                    }
                };
            }
            placedBoxes.push(...textPlacement.boxes);
            currentY += textPlacement.requiredHeight - marginBottom;
            lastSpacingAfter = marginBottom;
            continue;
        }

        actor.prepare(initialLane.width || zoneWidth, remainingHeight, initialContext);
        const provisionalHeight = Math.max(
            LAYOUT_DEFAULTS.minEffectiveHeight,
            actor.getRequiredHeight() - marginTop - marginBottom + layoutBefore + marginBottom
        );
        const lane = resolveZoneLane(zoneWidth, blockTop, provisionalHeight, activeFields);
        const laneContext: PackagerContext = {
            ...context,
            contentWidthOverride: lane.width || zoneWidth,
            pageWidth: lane.width || zoneWidth
        };
        if (Math.abs(lane.width - initialLane.width) > 0.1) {
            actor.prepare(lane.width || zoneWidth, remainingHeight, laneContext);
        }

        if (actor.getRequiredHeight() <= remainingHeight + 0.1) {
            const emitted = actor.emitBoxes(lane.width || zoneWidth, remainingHeight, laneContext) || [];
            const zoneField = readZoneFieldDirective(emitted);
            if (zoneField) {
                const fieldState = buildZoneFieldState(emitted, zoneField, zoneWidth, blockTop);
                placedBoxes.push(...fieldState.boxes);
                activeFields.push(fieldState.field);
                continue;
            }

            for (const box of emitted) {
                placedBoxes.push({
                    ...box,
                    x: (box.x || 0) + lane.x,
                    y: (box.y || 0) + currentY + layoutDelta
                });
            }

            const contentHeight = Math.max(0, actor.getRequiredHeight() - marginTop - marginBottom);
            const requiredHeight = contentHeight + layoutBefore + marginBottom;
            const effectiveHeight = Math.max(requiredHeight, LAYOUT_DEFAULTS.minEffectiveHeight);
            currentY += effectiveHeight - marginBottom;
            lastSpacingAfter = marginBottom;
            continue;
        }

        if (remainingHeight <= 0 || actor.isUnbreakable(remainingHeight)) {
            return {
                boxes: placedBoxes,
                height: currentY + lastSpacingAfter,
                consumedHeight: Math.min(availableHeight, currentY + lastSpacingAfter),
                hasOverflow: true,
                continuation: {
                    nextActorIndex: actorIndex,
                    continuationFragment: actor
                }
            };
        }

        const split = actor.split(remainingHeight, context);
        if (split.currentFragment) {
            const emitted = split.currentFragment.emitBoxes(lane.width || zoneWidth, remainingHeight, laneContext) || [];
            for (const box of emitted) {
                placedBoxes.push({
                    ...box,
                    x: (box.x || 0) + lane.x,
                    y: (box.y || 0) + currentY + layoutDelta
                });
            }

            const splitMarginTop = split.currentFragment.getMarginTop();
            const splitMarginBottom = split.currentFragment.getMarginBottom();
            const splitContentHeight = Math.max(
                0,
                split.currentFragment.getRequiredHeight() - splitMarginTop - splitMarginBottom
            );
            const splitRequiredHeight = splitContentHeight + layoutBefore + splitMarginBottom;
            const splitEffectiveHeight = Math.max(splitRequiredHeight, LAYOUT_DEFAULTS.minEffectiveHeight);
            currentY += splitEffectiveHeight - splitMarginBottom;
            lastSpacingAfter = splitMarginBottom;
        }

        if (split.continuationFragment) {
            return {
                boxes: placedBoxes,
                height: currentY + lastSpacingAfter,
                consumedHeight: Math.min(availableHeight, currentY + lastSpacingAfter),
                hasOverflow: true,
                continuation: {
                    nextActorIndex: actorIndex,
                    continuationFragment: split.continuationFragment
                }
            };
        }
    }

    return {
        boxes: placedBoxes,
        height: currentY + lastSpacingAfter,
        consumedHeight: Math.min(availableHeight, currentY + lastSpacingAfter),
        hasOverflow: false,
        continuation: null
    };
}

function materializeZoneStrip(strip: NormalizedIndependentZoneStrip, availableWidth: number, processor: LayoutProcessor): ZoneMaterialized {
    // Stub PackagerContext base — zone sub-sessions do not publish signals
    const stubContextBase = createZoneSessionContextBase(availableWidth, processor);

    const allBoxes: Box[] = [];
    let totalHeight = 0;

    for (let i = 0; i < strip.zones.length; i++) {
        const zone = strip.zones[i];
        const result = runZoneSession(zone, processor, stubContextBase);
        const zoneTag: ZoneDebugBoxTag = {
            fieldActorId: '',
            fieldSourceId: '',
            zoneId: zone.id,
            zoneIndex: i,
            rect: { ...zone.rect }
        };

        // Offset each box into zone-map-local space (x += column x offset)
        for (const box of result.boxes) {
            allBoxes.push({
                ...attachZoneDebugTag(box, zoneTag),
                x: (box.x || 0) + zone.rect.x,
                y: (box.y || 0) + zone.rect.y
            });
        }

        totalHeight = Math.max(totalHeight, zone.rect.y + resolveZoneFootprintHeight(zone, result.height));
    }

    return { boxes: allBoxes, totalHeight, marginTop: strip.marginTop, marginBottom: strip.marginBottom };
}

class FrozenZonePackager implements PackagerUnit {
    private readonly frozenBoxes: Box[];
    private readonly frozenHeight: number;
    private readonly marginTopVal: number;
    private readonly marginBottomVal: number;

    readonly actorId: string;
    readonly sourceId: string;
    readonly actorKind: string;
    readonly fragmentIndex: number;
    readonly continuationOf?: string;

    constructor(
        boxes: Box[],
        height: number,
        marginTop: number,
        marginBottom: number,
        identity: PackagerIdentity
    ) {
        this.frozenBoxes = cloneZoneBoxes(boxes);
        this.frozenHeight = height;
        this.marginTopVal = marginTop;
        this.marginBottomVal = marginBottom;
        this.actorId = identity.actorId;
        this.sourceId = identity.sourceId;
        this.actorKind = identity.actorKind;
        this.fragmentIndex = identity.fragmentIndex;
        this.continuationOf = identity.continuationOf;
    }

    prepare(_availableWidth: number, _availableHeight: number, _context: PackagerContext): void {
        // Frozen slice; already materialized.
    }

    getPlacementPreference(fullAvailableWidth: number, _context: PackagerContext): PackagerPlacementPreference {
        return {
            minimumWidth: fullAvailableWidth,
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

    emitBoxes(_availableWidth: number, _availableHeight: number, context: PackagerContext): Box[] {
        const leftMargin = context.margins.left;
        const mt = this.marginTopVal;
        return this.frozenBoxes.map((box) => ({
            ...box,
            x: (box.x || 0) + leftMargin,
            y: (box.y || 0) + mt,
            properties: { ...(box.properties || {}) },
            meta: box.meta ? { ...box.meta } : box.meta
        }));
    }

    split(_availableHeight: number, _context: PackagerContext): PackagerSplitResult {
        return { currentFragment: null, continuationFragment: this };
    }

    getRequiredHeight(): number { return this.frozenHeight; }
    isUnbreakable(_availableHeight: number): boolean { return true; }
    getMarginTop(): number { return this.marginTopVal; }
    getMarginBottom(): number { return this.marginBottomVal; }
}

// ---------------------------------------------------------------------------
// ZonePackager
// ---------------------------------------------------------------------------

/**
 * Packager for `zone-map` elements. Wraps the zone materialization in the
 * standard `PackagerUnit` protocol so the main simulation march can place it
 * like any other actor.
 *
 * Reports unbreakable only for `move-whole` fields. Expandable continuation
 * mode can emit bounded current fragments and continuation packagers.
 */
export class ZonePackager implements PackagerUnit {
    private readonly element: Element;
    private readonly processor: LayoutProcessor;
    readonly frameOverflowMode: 'move-whole' | 'continue';
    readonly worldBehaviorMode: ZoneWorldBehavior;
    private readonly zoneQueues: ZoneActorQueue[] | null;
    private readonly fragmentMarginTop: number;
    private readonly fragmentMarginBottom: number;
    private lastAvailableWidth: number = -1;
    private lastAvailableHeight: number = -1;
    private materializedBoxes: Box[] | null = null;
    private marginTopVal: number = 0;
    private marginBottomVal: number = 0;
    private totalZoneHeight: number = 0;
    private boundedBoxes: Box[] | null = null;
    private boundedHeight: number = 0;
    private boundedOverflow: boolean = false;
    private boundedContinuationQueues: ZoneActorQueue[] | null = null;
    private lastEmittedLeftMargin: number = 0;

    readonly actorId: string;
    readonly sourceId: string;
    readonly actorKind: string;
    readonly fragmentIndex: number;
    readonly continuationOf?: string;

    private usesSpanningContinuation(): boolean {
        return this.frameOverflowMode === 'continue' && this.worldBehaviorMode === 'expandable';
    }

    get pageBreakBefore(): boolean | undefined {
        if (this.fragmentIndex > 0) return undefined;
        return (this.element.properties?.style as ElementStyle | undefined)?.pageBreakBefore ?? undefined;
    }

    get keepWithNext(): boolean | undefined {
        if (this.fragmentIndex > 0) return undefined;
        return (this.element.properties?.style as ElementStyle | undefined)?.keepWithNext ?? undefined;
    }

    constructor(
        element: Element,
        processor: LayoutProcessor,
        identity?: PackagerIdentity,
        zoneQueues?: ZoneActorQueue[] | null,
        fragmentMarginTop?: number,
        fragmentMarginBottom?: number
    ) {
        this.element = element;
        this.processor = processor;
        const resolved = identity ?? createElementPackagerIdentity(element, [0]);
        this.zoneQueues = zoneQueues ?? null;
        const normalizedForIdentity = normalizeZoneMapElement(element, 0);
        this.frameOverflowMode = normalizedForIdentity.frameOverflow;
        this.worldBehaviorMode = normalizedForIdentity.worldBehavior;
        this.fragmentMarginTop = fragmentMarginTop ?? (resolved.fragmentIndex > 0 ? 0 : normalizedForIdentity.marginTop);
        this.fragmentMarginBottom = fragmentMarginBottom ?? normalizedForIdentity.marginBottom;
        this.actorId = resolved.actorId;
        this.sourceId = resolved.sourceId;
        this.actorKind = resolved.actorKind;
        this.fragmentIndex = resolved.fragmentIndex;
        this.continuationOf = resolved.continuationOf;
        if (this.usesSpanningContinuation()) {
            this.marginTopVal = this.fragmentMarginTop;
            this.marginBottomVal = this.fragmentMarginBottom;
        }
    }

    private materializeMoveWhole(availableWidth: number): void {
        if (this.materializedBoxes !== null && this.lastAvailableWidth === availableWidth) return;
        const normalizedStrip = normalizeZoneMapElement(this.element, availableWidth);
        const result = materializeZoneStrip(normalizedStrip, availableWidth, this.processor);
        this.materializedBoxes = result.boxes.map((box) => {
            const tag = readZoneDebugTag(box);
            return tag
                ? attachZoneDebugTag(box, {
                    ...tag,
                    fieldActorId: this.actorId,
                    fieldSourceId: this.sourceId
                })
                : box;
        });
        this.marginTopVal = this.fragmentMarginTop;
        this.marginBottomVal = this.fragmentMarginBottom;
        this.totalZoneHeight = result.totalHeight;
        this.lastAvailableWidth = availableWidth;
        this.lastAvailableHeight = Infinity;
    }

    private materializeBounded(availableWidth: number, availableHeight: number): void {
        if (
            this.boundedBoxes !== null &&
            this.lastAvailableWidth === availableWidth &&
            this.lastAvailableHeight === availableHeight
        ) {
            return;
        }

        if (!Number.isFinite(availableHeight)) {
            this.materializeMoveWhole(availableWidth);
            this.boundedBoxes = this.materializedBoxes ? cloneZoneBoxes(this.materializedBoxes) : [];
            this.boundedHeight = this.totalZoneHeight;
            this.boundedOverflow = false;
            this.boundedContinuationQueues = null;
            return;
        }

        const normalizedStrip = normalizeZoneMapElement(this.element, availableWidth);
        const queues = this.zoneQueues ?? buildZoneActorQueues(normalizedStrip, this.processor);
        const contextBase = createZoneSessionContextBase(availableWidth, this.processor);
        const allBoxes: Box[] = [];
        let occupiedHeight = 0;
        let hasOverflow = false;
        const continuationQueues: ZoneActorQueue[] = [];

        for (let zoneIndex = 0; zoneIndex < queues.length; zoneIndex++) {
            const zone = queues[zoneIndex];
            const zoneVisibleHeight = resolveZoneVisibleHeight(zone, Math.max(0, availableHeight));
            if (zoneVisibleHeight <= 0) {
                occupiedHeight = Math.max(occupiedHeight, zone.rect.y + resolveZoneFootprintHeight(zone, 0));
                hasOverflow = hasOverflow || zone.actors.length > 0;
                continuationQueues.push(zone);
                continue;
            }

            const result = runZoneSessionBounded(zone, contextBase, zoneVisibleHeight);
            const zoneTag: ZoneDebugBoxTag = {
                fieldActorId: this.actorId,
                fieldSourceId: this.sourceId,
                zoneId: zone.id,
                zoneIndex,
                rect: { ...zone.rect }
            };
            for (const box of result.boxes) {
                allBoxes.push({
                    ...attachZoneDebugTag(box, zoneTag),
                    x: (box.x || 0) + zone.rect.x,
                    y: (box.y || 0) + zone.rect.y
                });
            }
            occupiedHeight = Math.max(occupiedHeight, zone.rect.y + resolveZoneFootprintHeight(zone, result.height));
            hasOverflow = hasOverflow || result.hasOverflow;
            continuationQueues.push(buildZoneContinuationQueue(zone, result.continuation));
        }

        this.marginTopVal = this.fragmentMarginTop;
        this.marginBottomVal = hasOverflow ? 0 : this.fragmentMarginBottom;
        this.boundedBoxes = allBoxes;
        this.boundedHeight = occupiedHeight;
        this.boundedOverflow = hasOverflow;
        this.boundedContinuationQueues = hasOverflow ? continuationQueues : null;
        this.totalZoneHeight = hasOverflow
            ? Math.max(occupiedHeight, Math.max(0, availableHeight) + 1)
            : occupiedHeight;
        this.lastAvailableWidth = availableWidth;
        this.lastAvailableHeight = availableHeight;
    }

    private materialize(availableWidth: number, availableHeight: number): void {
        if (this.usesSpanningContinuation()) {
            this.materializeBounded(availableWidth, availableHeight);
            return;
        }
        this.materializeMoveWhole(availableWidth);
    }

    private createFrozenCurrentFragment(): FrozenZonePackager {
        return new FrozenZonePackager(
            this.usesSpanningContinuation() ? (this.boundedBoxes || []) : (this.materializedBoxes || []),
            this.marginTopVal + (this.usesSpanningContinuation() ? this.boundedHeight : this.totalZoneHeight) + this.marginBottomVal,
            this.marginTopVal,
            this.marginBottomVal,
            {
                actorId: this.actorId,
                sourceId: this.sourceId,
                actorKind: this.actorKind,
                fragmentIndex: this.fragmentIndex,
                continuationOf: this.continuationOf
            }
        );
    }

    private createContinuationPackager(): ZonePackager | null {
        if (!this.boundedContinuationQueues || this.boundedContinuationQueues.every((zone) => zone.actors.length === 0)) {
            return null;
        }

        return new ZonePackager(
            this.element,
            this.processor,
            createContinuationIdentity(this),
            this.boundedContinuationQueues,
            0,
            this.fragmentMarginBottom
        );
    }

    prepare(availableWidth: number, availableHeight: number, _context: PackagerContext): void {
        this.materialize(availableWidth, availableHeight);
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
        this.materialize(availableWidth, _availableHeight);
        const mt = this.marginTopVal;
        const leftMargin = context.margins.left;
        this.lastEmittedLeftMargin = leftMargin;
        const boxes = this.usesSpanningContinuation() ? (this.boundedBoxes || []) : (this.materializedBoxes || []);
        return boxes.map((b) => {
            const pageX = (b.x || 0) + leftMargin;
            const pageY = (b.y || 0) + mt;
            const tag = readZoneDebugTag(b);
            return {
                ...b,
                x: pageX,
                y: pageY,
                properties: tag
                    ? {
                        ...(b.properties || {}),
                        __vmprintZoneDebugPage: {
                            fieldActorId: this.actorId,
                            fieldSourceId: this.sourceId,
                            zoneId: tag.zoneId,
                            zoneIndex: tag.zoneIndex,
                            x: leftMargin + tag.rect.x,
                            y: mt + tag.rect.y,
                            w: tag.rect.width,
                            explicitHeight: tag.rect.height,
                            frameOverflowMode: this.frameOverflowMode,
                            worldBehaviorMode: this.worldBehaviorMode
                        }
                    }
                    : b.properties
            };
        });
    }

    getDebugRegions(): DebugZoneRegion[] {
        const availableWidth = this.lastAvailableWidth > 0 ? this.lastAvailableWidth : 0;
        const normalizedStrip = normalizeZoneMapElement(this.element, availableWidth);
        const boxes = this.usesSpanningContinuation() ? (this.boundedBoxes || []) : (this.materializedBoxes || []);
        const bottomsByZone = new Map<number, number>();

        for (const box of boxes) {
            const tag = readZoneDebugTag(box);
            if (!tag) continue;
            const localBottom = (box.y || 0) + (box.h || 0);
            const currentBottom = bottomsByZone.get(tag.zoneIndex) ?? tag.rect.y;
            if (localBottom > currentBottom) {
                bottomsByZone.set(tag.zoneIndex, localBottom);
            }
        }

        return normalizedStrip.zones.map((zone, zoneIndex) => {
            const explicitHeight = zone.rect.height !== undefined ? Math.max(0, Number(zone.rect.height)) : 0;
            const contentHeight = Math.max(0, (bottomsByZone.get(zoneIndex) ?? zone.rect.y) - zone.rect.y);
            const visibleHeight = this.usesSpanningContinuation()
                ? resolveZoneVisibleHeight(
                    {
                        id: zone.id,
                        rect: { ...zone.rect },
                        style: zone.style,
                        actors: []
                    },
                    Math.max(0, this.lastAvailableHeight)
                )
                : contentHeight;
            const height = Math.max(explicitHeight, contentHeight, visibleHeight);

            return {
                fieldActorId: this.actorId,
                fieldSourceId: this.sourceId,
                zoneId: zone.id,
                zoneIndex,
                x: this.lastEmittedLeftMargin + zone.rect.x,
                y: this.marginTopVal + zone.rect.y,
                w: zone.rect.width,
                h: height,
                frameOverflowMode: this.frameOverflowMode,
                worldBehaviorMode: this.worldBehaviorMode
            };
        }).filter((zone) => zone.w > 0 && zone.h > 0);
    }

    getRequiredHeight(): number {
        const zoneHeight = this.usesSpanningContinuation() ? this.boundedHeight : this.totalZoneHeight;
        const reportedHeight = this.usesSpanningContinuation() && this.boundedOverflow
            ? Math.max(zoneHeight, this.lastAvailableHeight + 1)
            : zoneHeight;
        return this.marginTopVal + reportedHeight + this.marginBottomVal;
    }

    /** Zone fields are unbreakable only in `move-whole` mode. */
    isUnbreakable(_availableHeight: number): boolean {
        return !this.usesSpanningContinuation();
    }

    getMarginTop(): number { return this.marginTopVal; }
    getMarginBottom(): number { return this.marginBottomVal; }

    split(availableHeight: number, context: PackagerContext): PackagerSplitResult {
        if (!this.usesSpanningContinuation()) {
            return { currentFragment: null, continuationFragment: this };
        }

        const availableWidth = this.lastAvailableWidth > 0
            ? this.lastAvailableWidth
            : (context.pageWidth - context.margins.left - context.margins.right);
        this.materializeBounded(availableWidth, availableHeight);

        if ((this.boundedBoxes || []).length === 0) {
            return { currentFragment: null, continuationFragment: this };
        }

        const currentFragment = this.createFrozenCurrentFragment();
        if (!this.boundedOverflow) {
            return { currentFragment, continuationFragment: null };
        }

        return {
            currentFragment,
            continuationFragment: this.createContinuationPackager()
        };
    }
}
