import type { Box, DebugZoneRegion } from '../../types';
import type { Collaborator, PageSurface } from '../layout-session-types';
import type { LayoutSession } from '../layout-session';
import type { PackagerUnit } from '../packagers/packager-types';
import { ZonePackager } from '../packagers/zone-packager';

function zoneKey(zone: ReturnType<ZonePackager['getDebugRegions']>[number]): string {
    return [
        zone.fieldActorId,
        zone.zoneIndex,
        zone.x,
        zone.y,
        zone.w,
        zone.h
    ].join(':');
}

export class ZoneDebugOverlayCollaborator implements Collaborator {
    onActorCommitted(actor: PackagerUnit, _committed: Box[], surface: PageSurface, _session: LayoutSession): void {
        if (!(actor instanceof ZonePackager)) return;

        const existing = new Set(surface.debugZones.map(zoneKey));
        for (const zone of actor.getDebugRegions()) {
            const key = zoneKey(zone);
            if (existing.has(key)) continue;
            surface.debugZones.push({ ...zone });
            existing.add(key);
        }
    }

    onPageFinalized(surface: PageSurface, _session: LayoutSession): void {
        const existing = new Set(surface.debugZones.map(zoneKey));
        const aggregated = new Map<string, DebugZoneRegion>();

        for (const box of surface.boxes) {
            const tag = box.properties?.__vmprintZoneDebugPage as
                | {
                    fieldActorId: string;
                    fieldSourceId: string;
                    zoneId?: string;
                    zoneIndex: number;
                    x: number;
                    y: number;
                    w: number;
                    explicitHeight?: number;
                    frameOverflowMode: 'move-whole' | 'continue';
                    worldBehaviorMode: DebugZoneRegion['worldBehaviorMode'];
                }
                | undefined;
            if (!tag) continue;

            const key = [
                tag.fieldActorId,
                tag.zoneIndex,
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

        for (const zone of aggregated.values()) {
            const key = zoneKey(zone);
            if (existing.has(key)) continue;
            surface.debugZones.push(zone);
            existing.add(key);
        }
    }
}
