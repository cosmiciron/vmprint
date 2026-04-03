import type { Collaborator } from '../layout-session-types';
import { LayoutSession } from '../layout-session';
import { simulationArtifactKeys } from '../simulation-report';
import type { DebugRegion } from '../../types';

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
};

export type PageRegionSummary = {
    pageIndex: number;
    headerBoxes: number;
    footerBoxes: number;
    generatedBoxes: number;
    debugRegionCount: number;
    debugRegions: PageRegionDebugSummary[];
};

function toPageRegionDebugSummary(region: DebugRegion): PageRegionDebugSummary {
    return {
        stableKey: [
            region.sourceKind,
            region.fieldSourceId,
            region.regionId ?? region.zoneId ?? `#${region.regionIndex}`
        ].join(':'),
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
        h: region.h
    };
}

export class PageRegionArtifactCollaborator implements Collaborator {
    onSimulationComplete(session: LayoutSession): void {
        const pages = session.getFinalizedPages();
        const summaries: PageRegionSummary[] = pages.map((page) => {
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

            const debugRegions = (page.debugRegions || []).map(toPageRegionDebugSummary);

            return {
                pageIndex: page.index,
                headerBoxes,
                footerBoxes,
                generatedBoxes,
                debugRegionCount: debugRegions.length,
                debugRegions
            };
        });

        session.publishArtifact(simulationArtifactKeys.pageRegionSummary, summaries);
    }
}
