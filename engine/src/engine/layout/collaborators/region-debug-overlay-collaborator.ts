import type { Box, DebugRegion } from '../../types';
import type { Collaborator, PageSurface } from '../layout-session-types';
import type { LayoutSession } from '../layout-session';
import type { PackagerUnit } from '../packagers/packager-types';

type DebugRegionActor = PackagerUnit & {
    getDebugRegions?(): DebugRegion[];
};

function regionKey(region: DebugRegion): string {
    return [
        region.fieldActorId,
        region.sourceKind,
        region.regionIndex,
        region.x,
        region.y,
        region.w,
        region.h
    ].join(':');
}

export class RegionDebugOverlayCollaborator implements Collaborator {
    onActorCommitted(actor: PackagerUnit, _committed: Box[], surface: PageSurface, _session: LayoutSession): void {
        const debugActor = actor as DebugRegionActor;
        const regions = debugActor.getDebugRegions?.();
        if (!regions || regions.length === 0) return;

        const existing = new Set(surface.debugRegions.map(regionKey));
        for (const region of regions) {
            const key = regionKey(region);
            if (existing.has(key)) continue;
            surface.debugRegions.push({ ...region });
            existing.add(key);
        }
    }

    onPageFinalized(surface: PageSurface, _session: LayoutSession): void {
        const existing = new Set(surface.debugRegions.map(regionKey));
        const aggregated = new Map<string, DebugRegion>();

        for (const box of surface.boxes) {
            const tag = box.properties?.__vmprintRegionDebugPage as
                | {
                    fieldActorId: string;
                    fieldSourceId: string;
                    sourceKind: DebugRegion['sourceKind'];
                    regionId?: string;
                    regionIndex: number;
                    zoneId?: string;
                    zoneIndex: number;
                    x: number;
                    y: number;
                    w: number;
                    explicitHeight?: number;
                    frameOverflowMode: 'move-whole' | 'continue';
                    worldBehaviorMode: DebugRegion['worldBehaviorMode'];
                }
                | undefined;
            if (!tag) continue;

            const key = [
                tag.fieldActorId,
                tag.sourceKind,
                tag.regionIndex,
                tag.x,
                tag.y,
                tag.w
            ].join(':');
            const bottom = Number(box.y || 0) + Number(box.h || 0);
            const current = aggregated.get(key);
            if (!current) {
                aggregated.set(key, {
                    fieldActorId: tag.fieldActorId,
                    fieldSourceId: tag.fieldSourceId,
                    sourceKind: tag.sourceKind,
                    regionId: tag.regionId ?? tag.zoneId,
                    regionIndex: tag.regionIndex,
                    zoneId: tag.zoneId,
                    zoneIndex: tag.zoneIndex,
                    x: tag.x,
                    y: tag.y,
                    w: tag.w,
                    h: Math.max(
                        Number(tag.explicitHeight || 0),
                        Math.max(0, bottom - tag.y)
                    ),
                    frameOverflowMode: tag.frameOverflowMode,
                    worldBehaviorMode: tag.worldBehaviorMode
                });
                continue;
            }

            current.h = Math.max(
                current.h,
                Math.max(0, bottom - current.y),
                Number(tag.explicitHeight || 0)
            );
        }

        for (const region of aggregated.values()) {
            const key = regionKey(region);
            if (existing.has(key)) continue;
            surface.debugRegions.push(region);
            existing.add(key);
        }
    }
}
