import type { Collaborator, CollaboratorHost } from '../runtime/session/session-runtime-types';

import { simulationArtifactKeys } from '../simulation-report';

export type ViewportCaptureSummary = {
    pageIndex: number;
    physicalPageNumber: number;
    logicalPageNumber: number | null;
    worldSpace: {
        originX: number;
        originY: number;
        width: number;
        exploredBottom: number;
    };
    viewport: {
        worldX: number;
        worldY: number;
        width: number;
        height: number;
        contentRect: {
            x: number;
            y: number;
            w: number;
            h: number;
        };
    };
    terrain: {
        marginBlockCount: number;
        reservationBlockCount: number;
        exclusionBlockCount: number;
        worldTraversalExclusionCount: number;
        blockedRectCount: number;
    };
};

export class ViewportCaptureArtifactCollaborator implements Collaborator {
    readonly mutationMode = 'observer' as const;

    onSimulationComplete(host: CollaboratorHost): void {
        const summaries: ViewportCaptureSummary[] = host.getPageCaptures().map((record) => ({
            pageIndex: record.pageIndex,
            physicalPageNumber: record.physicalPageNumber,
            logicalPageNumber: record.logicalPageNumber,
            worldSpace: {
                originX: record.capture.worldSpace.originX,
                originY: record.capture.worldSpace.originY,
                width: record.capture.worldSpace.width,
                exploredBottom: record.capture.worldSpace.exploredBottom
            },
            viewport: {
                worldX: record.capture.viewport.worldX,
                worldY: record.capture.viewport.worldY,
                width: record.capture.viewport.width,
                height: record.capture.viewport.height,
                contentRect: {
                    x: record.capture.viewport.contentRect.x,
                    y: record.capture.viewport.contentRect.y,
                    w: record.capture.viewport.contentRect.w,
                    h: record.capture.viewport.contentRect.h
                }
            },
            terrain: {
                marginBlockCount: record.capture.viewport.terrain.marginBlocks.length,
                reservationBlockCount: record.capture.viewport.terrain.reservationBlocks.length,
                exclusionBlockCount: record.capture.viewport.terrain.exclusionBlocks.length,
                worldTraversalExclusionCount: record.capture.viewport.terrain.exclusionBlocks.filter(
                    (block) => block.surface === 'world-traversal'
                ).length,
                blockedRectCount: record.capture.viewport.terrain.blockedRects.length
            }
        }));

        host.publishArtifact(simulationArtifactKeys.viewportCaptureSummary, summaries);
    }
}
