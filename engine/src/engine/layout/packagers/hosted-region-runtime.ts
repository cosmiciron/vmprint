import { Box } from '../../types';
import type { ActorSignalDraft } from '../actor-event-bus';
import type { LayoutProcessor } from '../layout-core';
import type { NormalizedIndependentZone } from '../normalized-zone-strip';
import type { HostedRegionActorQueue, HostedRegionDescriptor } from './region-actor-queues';
import type { PackagerContext, PackagerUnit } from './packager-types';

export type HostedRegionSessionResult = {
    boxes: Box[];
    height: number;
};

export type HostedRegionSessionContinuation = {
    nextActorIndex: number;
    continuationFragment: PackagerUnit | null;
};

export type BoundedHostedRegionSessionResult = HostedRegionSessionResult & {
    consumedHeight: number;
    hasOverflow: boolean;
    continuation: HostedRegionSessionContinuation | null;
};

export type HostedRegionDebugBoxTag = {
    fieldActorId: string;
    fieldSourceId: string;
    sourceKind: 'zone-map' | 'world-plain';
    zoneId?: string;
    zoneIndex: number;
    rect: {
        x: number;
        y: number;
        width: number;
        height?: number;
    };
};

export function cloneHostedRegionBoxes(boxes: Box[]): Box[] {
    return boxes.map((box) => ({
        ...box,
        properties: { ...(box.properties || {}) },
        meta: box.meta ? { ...box.meta } : box.meta
    }));
}

export function attachHostedRegionDebugTag(box: Box, tag: HostedRegionDebugBoxTag): Box {
    return {
        ...box,
        properties: {
            ...(box.properties || {}),
            __vmprintZoneDebug: {
                fieldActorId: tag.fieldActorId,
                fieldSourceId: tag.fieldSourceId,
                sourceKind: tag.sourceKind,
                zoneId: tag.zoneId,
                zoneIndex: tag.zoneIndex,
                rect: { ...tag.rect }
            }
        }
    };
}

export function readHostedRegionDebugTag(box: Box): HostedRegionDebugBoxTag | null {
    const tag = box.properties?.__vmprintZoneDebug as HostedRegionDebugBoxTag | undefined;
    if (!tag || typeof tag !== 'object') return null;
    return tag;
}

export function buildHostedRegionContinuationQueue(
    zone: HostedRegionActorQueue,
    continuation: HostedRegionSessionContinuation | null
): HostedRegionActorQueue {
    if (!continuation) {
        return {
            ...zone,
            actors: []
        };
    }

    const nextActors = [];
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

export function resolveHostedRegionVisibleHeight(
    zone: HostedRegionDescriptor,
    fieldAvailableHeight: number
): number {
    const heightWithinViewport = Math.max(0, fieldAvailableHeight - zone.rect.y);
    if (zone.rect.height === undefined) {
        return heightWithinViewport;
    }
    return Math.min(heightWithinViewport, Math.max(0, Number(zone.rect.height)));
}

export function resolveHostedRegionFootprintHeight(
    zone: HostedRegionDescriptor | NormalizedIndependentZone,
    contentHeight: number
): number {
    const authoredHeight = zone.rect.height !== undefined ? Math.max(0, Number(zone.rect.height)) : 0;
    return Math.max(Math.max(0, contentHeight), authoredHeight);
}

export function createHostedRegionSessionContextBase(
    availableWidth: number,
    processor: LayoutProcessor
): Omit<PackagerContext, 'pageIndex' | 'cursorY'> {
    const session = processor.getCurrentLayoutSession();
    return {
        processor,
        margins: { top: 0, right: 0, bottom: 0, left: 0 },
        pageWidth: availableWidth,
        pageHeight: Infinity,
        publishActorSignal: (signal: ActorSignalDraft) => {
            if (!session) {
                return {
                    ...signal,
                    pageIndex: signal.pageIndex ?? 0,
                    sequence: -1
                } as any;
            }
            return session.publishActorSignal(signal);
        },
        readActorSignals: (topic?: string) => session ? session.getActorSignals(topic) : [],
        requestAsyncThought: (request) => session?.requestAsyncThought(request),
        readAsyncThoughtResult: (key) => session?.readAsyncThoughtResult(key)
    };
}

export function materializeHostedRegionsMoveWhole(
    queues: readonly HostedRegionActorQueue[],
    sourceKind: HostedRegionDebugBoxTag['sourceKind'],
    fieldActorId: string,
    fieldSourceId: string,
    runRegionSession: (
        zone: HostedRegionActorQueue,
        contextBase: Omit<PackagerContext, 'pageIndex' | 'cursorY'>
    ) => HostedRegionSessionResult,
    contextBase: Omit<PackagerContext, 'pageIndex' | 'cursorY'>
): { boxes: Box[]; totalHeight: number } {
    const allBoxes: Box[] = [];
    let totalHeight = 0;

    for (let zoneIndex = 0; zoneIndex < queues.length; zoneIndex++) {
        const zone = queues[zoneIndex];
        const result = runRegionSession(zone, contextBase);
        const zoneTag: HostedRegionDebugBoxTag = {
            fieldActorId,
            fieldSourceId,
            sourceKind,
            zoneId: zone.id,
            zoneIndex,
            rect: { ...zone.rect }
        };
        for (const box of result.boxes) {
            allBoxes.push({
                ...attachHostedRegionDebugTag(box, zoneTag),
                x: (box.x || 0) + zone.rect.x,
                y: (box.y || 0) + zone.rect.y
            });
        }
        totalHeight = Math.max(totalHeight, zone.rect.y + resolveHostedRegionFootprintHeight(zone, result.height));
    }

    return { boxes: allBoxes, totalHeight };
}

export function materializeHostedRegionsBounded(
    queues: readonly HostedRegionActorQueue[],
    sourceKind: HostedRegionDebugBoxTag['sourceKind'],
    fieldActorId: string,
    fieldSourceId: string,
    availableHeight: number,
    runRegionSessionBounded: (
        zone: HostedRegionActorQueue,
        contextBase: Omit<PackagerContext, 'pageIndex' | 'cursorY'>,
        zoneVisibleHeight: number
    ) => BoundedHostedRegionSessionResult,
    contextBase: Omit<PackagerContext, 'pageIndex' | 'cursorY'>
): {
    boxes: Box[];
    occupiedHeight: number;
    hasOverflow: boolean;
    continuationQueues: HostedRegionActorQueue[];
    totalHeight: number;
} {
    const allBoxes: Box[] = [];
    let occupiedHeight = 0;
    let hasOverflow = false;
    const continuationQueues: HostedRegionActorQueue[] = [];

    for (let zoneIndex = 0; zoneIndex < queues.length; zoneIndex++) {
        const zone = queues[zoneIndex];
        const zoneVisibleHeight = resolveHostedRegionVisibleHeight(zone, Math.max(0, availableHeight));
        if (zoneVisibleHeight <= 0) {
            occupiedHeight = Math.max(occupiedHeight, zone.rect.y + resolveHostedRegionFootprintHeight(zone, 0));
            hasOverflow = hasOverflow || zone.actors.length > 0;
            continuationQueues.push(zone);
            continue;
        }

        const result = runRegionSessionBounded(zone, contextBase, zoneVisibleHeight);
        const zoneTag: HostedRegionDebugBoxTag = {
            fieldActorId,
            fieldSourceId,
            sourceKind,
            zoneId: zone.id,
            zoneIndex,
            rect: { ...zone.rect }
        };
        for (const box of result.boxes) {
            allBoxes.push({
                ...attachHostedRegionDebugTag(box, zoneTag),
                x: (box.x || 0) + zone.rect.x,
                y: (box.y || 0) + zone.rect.y
            });
        }
        occupiedHeight = Math.max(occupiedHeight, zone.rect.y + resolveHostedRegionFootprintHeight(zone, result.height));
        hasOverflow = hasOverflow || result.hasOverflow;
        continuationQueues.push(buildHostedRegionContinuationQueue(zone, result.continuation));
    }

    return {
        boxes: allBoxes,
        occupiedHeight,
        hasOverflow,
        continuationQueues,
        totalHeight: hasOverflow
            ? Math.max(occupiedHeight, Math.max(0, availableHeight) + 1)
            : occupiedHeight
    };
}
