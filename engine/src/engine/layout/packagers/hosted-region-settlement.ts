import { Box, Element, SpatialFieldDirective, StoryFloatAlign } from '../../types';
import { buildExclusionFieldObstacles } from '../exclusion-field';
import type { LayoutProcessor } from '../layout-core';
import { reflowTextElementAgainstSpatialField } from '../spatial-field-reflow';
import { LAYOUT_DEFAULTS } from '../defaults';
import { OccupiedRect, SpatialMap } from './spatial-map';
import type { HostedRegionActorEntry, HostedRegionActorQueue } from './region-actor-queues';
import type { BoundedHostedRegionSessionResult, HostedRegionSessionResult } from './hosted-region-runtime';
import type { PackagerContext, PackagerUnit } from './packager-types';

type HostedRegionFieldState = {
    wrap: 'around' | 'top-bottom' | 'none';
    hidden: boolean;
    obstacles: OccupiedRect[];
};

type HostedRegionTextPlacement = {
    boxes: Box[];
    requiredHeight: number;
};

function readHostedRegionFieldDirective(boxes: Box[]): SpatialFieldDirective | null {
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

function resolveHostedRegionFieldAnchorX(align: StoryFloatAlign, regionWidth: number, fieldWidth: number): number {
    if (align === 'right') return Math.max(0, regionWidth - fieldWidth);
    if (align === 'center') return Math.max(0, (regionWidth - fieldWidth) / 2);
    return 0;
}

function buildHostedRegionFieldState(
    emitted: Box[],
    directive: SpatialFieldDirective,
    regionWidth: number,
    baseY: number
): { boxes: Box[]; field: HostedRegionFieldState } {
    const anchorBox = emitted[0];
    const align = directive.align ?? 'left';
    const wrap = directive.wrap ?? 'around';
    const hidden = directive.hidden === true;
    const fieldWidth = Math.max(0, anchorBox?.w || 0);
    const fieldHeight = Math.max(0, anchorBox?.h || 0);
    const fieldX = Number.isFinite(directive.x)
        ? Math.max(0, Number(directive.x))
        : resolveHostedRegionFieldAnchorX(align, regionWidth, fieldWidth);
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

function annotateHostedActorBoxes(actor: PackagerUnit, boxes: Box[]): Box[] {
    return boxes.map((box) => ({
        ...box,
        meta: box.meta
            ? { ...box.meta, actorId: actor.actorId, sourceId: box.meta.sourceId ?? actor.sourceId }
            : { actorId: actor.actorId, sourceId: actor.sourceId }
    }));
}

function intersectsVertically(obstacle: OccupiedRect, top: number, bottom: number): boolean {
    const obstacleTop = obstacle.y;
    const obstacleBottom = obstacle.y + obstacle.h;
    return obstacleBottom > top && obstacleTop < bottom;
}

function resolveHostedRegionLane(
    regionWidth: number,
    top: number,
    height: number,
    fields: HostedRegionFieldState[]
): { x: number; width: number } {
    const bottom = top + Math.max(0, height);
    const occupied: Array<{ start: number; end: number }> = [];

    for (const field of fields) {
        if (field.wrap !== 'around') continue;
        for (const obstacle of field.obstacles) {
            if (!intersectsVertically(obstacle, top, bottom)) continue;
            occupied.push({
                start: Math.max(0, obstacle.x),
                end: Math.min(regionWidth, obstacle.x + obstacle.w)
            });
        }
    }

    if (occupied.length === 0) {
        return { x: 0, width: regionWidth };
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

    const trailingWidth = Math.max(0, regionWidth - cursor);
    if (trailingWidth > bestWidth) {
        bestX = cursor;
        bestWidth = trailingWidth;
    }

    return { x: bestX, width: bestWidth };
}

function buildHostedRegionSpatialMap(fields: HostedRegionFieldState[]): SpatialMap {
    const map = new SpatialMap();
    for (const field of fields) {
        for (const obstacle of field.obstacles) {
            map.register(obstacle);
        }
    }
    return map;
}

function tryPlaceHostedRegionTextActor(
    actor: PackagerUnit,
    element: Element,
    processor: LayoutProcessor,
    availableWidth: number,
    currentY: number,
    layoutBefore: number,
    activeFields: HostedRegionFieldState[]
): HostedRegionTextPlacement | null {
    if (activeFields.length === 0) return null;
    if (String(element.type || '').toLowerCase() === 'image') return null;
    const spatialMap = buildHostedRegionSpatialMap(activeFields);
    const placed = reflowTextElementAgainstSpatialField({
        processor,
        element,
        path: [0],
        availableWidth,
        currentY,
        layoutBefore,
        spatialMap,
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

function placePackagersInHostedRegion(
    packagers: HostedRegionActorEntry[],
    availableWidth: number,
    contextBase: Omit<PackagerContext, 'pageIndex' | 'cursorY'>
): { boxes: Box[]; height: number } {
    const placedBoxes: Box[] = [];
    const activeFields: HostedRegionFieldState[] = [];
    let currentY = 0;
    let lastSpacingAfter = 0;

    for (const entry of packagers) {
        const actor = entry.actor;
        const marginTop = actor.getMarginTop();
        const marginBottom = actor.getMarginBottom();
        const layoutBefore = lastSpacingAfter + marginTop;
        const layoutDelta = lastSpacingAfter;
        const blockTop = currentY + layoutDelta;

        const textPlacement = tryPlaceHostedRegionTextActor(
            actor,
            entry.element,
            contextBase.processor,
            availableWidth,
            currentY,
            layoutBefore,
            activeFields
        );
        if (textPlacement) {
            placedBoxes.push(...annotateHostedActorBoxes(actor, textPlacement.boxes));
            currentY += textPlacement.requiredHeight - marginBottom;
            lastSpacingAfter = marginBottom;
            continue;
        }

        const initialLane = resolveHostedRegionLane(availableWidth, blockTop, LAYOUT_DEFAULTS.minEffectiveHeight, activeFields);
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
        const lane = resolveHostedRegionLane(availableWidth, blockTop, provisionalHeight, activeFields);
        const laneContext: PackagerContext = {
            ...context,
            contentWidthOverride: lane.width || availableWidth,
            pageWidth: lane.width || availableWidth
        };
        if (Math.abs(lane.width - initialLane.width) > 0.1) {
            actor.prepare(lane.width || availableWidth, Infinity, laneContext);
        }
        const emitted = actor.emitBoxes(lane.width || availableWidth, Infinity, laneContext) || [];
        const fieldDirective = readHostedRegionFieldDirective(emitted);

        if (fieldDirective) {
            const fieldState = buildHostedRegionFieldState(emitted, fieldDirective, availableWidth, blockTop);
            placedBoxes.push(...annotateHostedActorBoxes(actor, fieldState.boxes));
            activeFields.push(fieldState.field);
            continue;
        }

        for (const box of annotateHostedActorBoxes(actor, emitted)) {
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

export function runHostedRegionSession(
    zone: HostedRegionActorQueue,
    contextBase: Omit<PackagerContext, 'pageIndex' | 'cursorY'>
): HostedRegionSessionResult {
    const zoneWidth = zone.rect.width;
    const zoneContextBase = { ...contextBase, pageWidth: zoneWidth, contentWidthOverride: zoneWidth };
    const result = placePackagersInHostedRegion(zone.actors, zoneWidth, zoneContextBase);
    return { boxes: result.boxes, height: result.height };
}

export function runHostedRegionSessionBounded(
    zone: HostedRegionActorQueue,
    contextBase: Omit<PackagerContext, 'pageIndex' | 'cursorY'>,
    availableHeight: number
): BoundedHostedRegionSessionResult {
    const zoneWidth = zone.rect.width;
    const zoneContextBase = { ...contextBase, pageWidth: zoneWidth, contentWidthOverride: zoneWidth };
    const placedBoxes: Box[] = [];
    const activeFields: HostedRegionFieldState[] = [];
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
        const initialLane = resolveHostedRegionLane(zoneWidth, blockTop, LAYOUT_DEFAULTS.minEffectiveHeight, activeFields);
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

        const textPlacement = tryPlaceHostedRegionTextActor(
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
            placedBoxes.push(...annotateHostedActorBoxes(actor, textPlacement.boxes));
            currentY += textPlacement.requiredHeight - marginBottom;
            lastSpacingAfter = marginBottom;
            continue;
        }

        actor.prepare(initialLane.width || zoneWidth, remainingHeight, initialContext);
        const provisionalHeight = Math.max(
            LAYOUT_DEFAULTS.minEffectiveHeight,
            actor.getRequiredHeight() - marginTop - marginBottom + layoutBefore + marginBottom
        );
        const lane = resolveHostedRegionLane(zoneWidth, blockTop, provisionalHeight, activeFields);
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
            const fieldDirective = readHostedRegionFieldDirective(emitted);
            if (fieldDirective) {
                const fieldState = buildHostedRegionFieldState(emitted, fieldDirective, zoneWidth, blockTop);
                placedBoxes.push(...annotateHostedActorBoxes(actor, fieldState.boxes));
                activeFields.push(fieldState.field);
                continue;
            }

            for (const box of annotateHostedActorBoxes(actor, emitted)) {
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
            for (const box of annotateHostedActorBoxes(split.currentFragment, emitted)) {
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
