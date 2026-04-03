import type { DebugRegion, Page } from '../types';
import type { PageRegionSummary } from './page-region-summary';
import { summarizePageRegions } from './page-region-summary';

export type ScriptRegionSlice = {
    pageIndex: number;
    x: number;
    y: number;
    w: number;
    h: number;
};

export type ScriptRegionParticipant = {
    sourceId: string;
    sourceType: string | null;
    pages: number[];
    pageCount: number;
    firstPageIndex: number | null;
};

export type ScriptRegionRef = {
    name: string;
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
    pages: number[];
    slices: ScriptRegionSlice[];
    pageCount: number;
    firstPageIndex: number | null;
    participants: ScriptRegionParticipant[];
    participantCount: number;
};

export function collectScriptRegions(pages: readonly Page[]): ScriptRegionRef[] {
    return collectScriptRegionsFromPageSummaries(pages.map((page) => summarizePageRegions(page)));
}

export function collectScriptRegionsFromPageSummaries(
    pageSummaries: readonly Pick<PageRegionSummary, 'pageIndex' | 'debugRegions'>[]
): ScriptRegionRef[] {
    const regions = new Map<string, ScriptRegionRef>();

    for (const page of pageSummaries) {
        for (const region of page.debugRegions || []) {
            const stableKey = region.stableKey;
            const current = regions.get(stableKey);
            const slice: ScriptRegionSlice = {
                pageIndex: page.pageIndex,
                x: region.x,
                y: region.y,
                w: region.w,
                h: region.h
            };

            if (!current) {
                regions.set(stableKey, {
                    name: region.regionId ?? region.zoneId ?? `region-${region.regionIndex + 1}`,
                    stableKey,
                    sourceKind: region.sourceKind,
                    regionId: region.regionId,
                    regionIndex: region.regionIndex,
                    zoneId: region.zoneId,
                    zoneIndex: region.zoneIndex,
                    fieldActorId: region.fieldActorId,
                    fieldSourceId: region.fieldSourceId,
                    frameOverflowMode: region.frameOverflowMode,
                    worldBehaviorMode: region.worldBehaviorMode,
                    pages: [page.pageIndex],
                    slices: [slice],
                    pageCount: 1,
                    firstPageIndex: page.pageIndex,
                    participants: [],
                    participantCount: 0
                });
                continue;
            }

            if (!current.pages.includes(page.pageIndex)) {
                current.pages.push(page.pageIndex);
                current.pages.sort((a, b) => a - b);
                current.pageCount = current.pages.length;
                current.firstPageIndex = current.pages[0] ?? null;
            }
            current.slices.push(slice);
            current.slices.sort((a, b) => a.pageIndex - b.pageIndex || a.y - b.y || a.x - b.x);
        }
    }

    for (const region of regions.values()) {
        const participants = new Map<string, ScriptRegionParticipant>();

        for (const page of pageSummaries) {
            if (!region.pages.includes(page.pageIndex)) continue;
            const pageSlices = page.debugRegions.filter((slice) => slice.stableKey === region.stableKey);
            if (pageSlices.length === 0) continue;
            for (const slice of pageSlices) {
                for (const participant of slice.participants || []) {
                    const sourceId = participant.sourceId;
                    if (!sourceId) continue;
                    const current = participants.get(sourceId);
                    if (!current) {
                        participants.set(sourceId, {
                            sourceId,
                            sourceType: participant.sourceType ?? null,
                            pages: [page.pageIndex],
                            pageCount: 1,
                            firstPageIndex: page.pageIndex
                        });
                        continue;
                    }
                    if (!current.pages.includes(page.pageIndex)) {
                        current.pages.push(page.pageIndex);
                        current.pages.sort((a, b) => a - b);
                        current.pageCount = current.pages.length;
                        current.firstPageIndex = current.pages[0] ?? null;
                    }
                }
            }
        }

        region.participants = Array.from(participants.values()).sort((a, b) =>
            a.sourceId.localeCompare(b.sourceId) || (a.firstPageIndex ?? 0) - (b.firstPageIndex ?? 0)
        );
        region.participantCount = region.participants.length;
    }

    return Array.from(regions.values()).sort((a, b) =>
        a.name.localeCompare(b.name) || a.firstPageIndex! - b.firstPageIndex!
    );
}

export function findScriptRegionByNameInRegions(
    regions: readonly ScriptRegionRef[],
    name: string
): ScriptRegionRef | null {
    const normalized = String(name || '').trim();
    if (!normalized) return null;
    return regions.find((region) =>
        region.name === normalized || region.regionId === normalized || region.zoneId === normalized
    ) ?? null;
}

export function findScriptRegionByName(
    pages: readonly Page[],
    name: string
): ScriptRegionRef | null {
    return findScriptRegionByNameInRegions(collectScriptRegions(pages), name);
}
