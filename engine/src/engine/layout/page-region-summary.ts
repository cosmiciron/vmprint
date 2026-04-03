import type { DebugRegion, Page } from '../types';

export type PageRegionParticipantSummary = {
    sourceId: string;
    sourceType: string | null;
};

export type PageRegionDebugSummary = {
    stableKey: string;
    sourceKind: DebugRegion['sourceKind'];
    regionId?: string;
    regionIndex: number;
    zoneId?: string;
    zoneIndex: number;
    fieldActorId: string;
    fieldSourceId: string;
    frameOverflowMode: DebugRegion['frameOverflowMode'];
    worldBehaviorMode: DebugRegion['worldBehaviorMode'];
    x: number;
    y: number;
    w: number;
    h: number;
    participants: PageRegionParticipantSummary[];
    participantCount: number;
};

export type PageRegionSummary = {
    pageIndex: number;
    headerBoxes: number;
    footerBoxes: number;
    generatedBoxes: number;
    debugRegionCount: number;
    debugRegions: PageRegionDebugSummary[];
};

function intersectsRegion(
    region: { x: number; y: number; w: number; h: number },
    box: { x?: number; y?: number; w?: number; h?: number }
): boolean {
    const left = Number(box.x || 0);
    const top = Number(box.y || 0);
    const width = Math.max(0, Number(box.w || 0));
    const height = Math.max(0, Number(box.h || 0));
    const right = left + width;
    const bottom = top + height;
    const regionRight = region.x + region.w;
    const regionBottom = region.y + region.h;

    return right > region.x
        && left < regionRight
        && bottom > region.y
        && top < regionBottom;
}

export function buildPageRegionStableKey(region: DebugRegion): string {
    return [
        region.sourceKind,
        region.fieldSourceId,
        region.regionId ?? region.zoneId ?? `#${region.regionIndex}`
    ].join(':');
}

export function toPageRegionDebugSummary(page: Page, region: DebugRegion): PageRegionDebugSummary {
    const participants = new Map<string, PageRegionParticipantSummary>();
    for (const box of page.boxes || []) {
        const sourceId = typeof box.meta?.sourceId === 'string' ? box.meta.sourceId : '';
        if (!sourceId) continue;
        if (box.meta?.generated === true) continue;
        if (!intersectsRegion(region, box)) continue;
        if (!participants.has(sourceId)) {
            participants.set(sourceId, {
                sourceId,
                sourceType: typeof box.meta?.sourceType === 'string' ? box.meta.sourceType : null
            });
        }
    }

    const sortedParticipants = Array.from(participants.values()).sort((a, b) =>
        a.sourceId.localeCompare(b.sourceId)
    );

    return {
        stableKey: buildPageRegionStableKey(region),
        sourceKind: region.sourceKind,
        regionId: region.regionId,
        regionIndex: region.regionIndex,
        zoneId: region.zoneId,
        zoneIndex: region.zoneIndex,
        fieldActorId: region.fieldActorId,
        fieldSourceId: region.fieldSourceId,
        frameOverflowMode: region.frameOverflowMode,
        worldBehaviorMode: region.worldBehaviorMode,
        x: region.x,
        y: region.y,
        w: region.w,
        h: region.h,
        participants: sortedParticipants,
        participantCount: sortedParticipants.length
    };
}

export function summarizePageRegions(page: Page): PageRegionSummary {
    let headerBoxes = 0;
    let footerBoxes = 0;
    let generatedBoxes = 0;

    for (const box of page.boxes || []) {
        if (box.meta?.generated === true) {
            generatedBoxes += 1;
        }
        if (box.meta?.sourceType === 'header') {
            headerBoxes += 1;
        } else if (box.meta?.sourceType === 'footer') {
            footerBoxes += 1;
        }
    }

    const debugRegions = (page.debugRegions || []).map((region) => toPageRegionDebugSummary(page, region));

    return {
        pageIndex: page.index,
        headerBoxes,
        footerBoxes,
        generatedBoxes,
        debugRegionCount: debugRegions.length,
        debugRegions
    };
}
