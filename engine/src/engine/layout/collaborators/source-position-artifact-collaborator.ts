import type { Collaborator } from '../layout-session-types';
import { LayoutSession } from '../layout-session';
import { simulationArtifactKeys } from '../simulation-report';

export type SourcePositionSummary = {
    sourceId: string;
    sourceType?: string;
    firstPageIndex: number;
    firstY: number;
    pageIndices: number[];
    fragmentCount: number;
};

export class SourcePositionArtifactCollaborator implements Collaborator {
    onSimulationComplete(session: LayoutSession): void {
        const pages = session.getFinalizedPages();
        const summaries = new Map<string, SourcePositionSummary>();

        for (const page of pages) {
            for (const box of page.boxes || []) {
                const sourceId = typeof box.meta?.sourceId === 'string' ? box.meta.sourceId : '';
                if (!sourceId) continue;
                if (box.meta?.generated === true) continue;

                const pageIndex = Number.isFinite(page.index) ? page.index : 0;
                const y = Number.isFinite(box.y) ? Number(box.y) : 0;
                const existing = summaries.get(sourceId);
                if (!existing) {
                    summaries.set(sourceId, {
                        sourceId,
                        sourceType: box.meta?.sourceType,
                        firstPageIndex: pageIndex,
                        firstY: y,
                        pageIndices: [pageIndex],
                        fragmentCount: 1
                    });
                    continue;
                }

                existing.fragmentCount += 1;
                if (!existing.pageIndices.includes(pageIndex)) {
                    existing.pageIndices.push(pageIndex);
                    existing.pageIndices.sort((a, b) => a - b);
                }
                if (
                    pageIndex < existing.firstPageIndex ||
                    (pageIndex === existing.firstPageIndex && y < existing.firstY)
                ) {
                    existing.firstPageIndex = pageIndex;
                    existing.firstY = y;
                }
                if (!existing.sourceType && box.meta?.sourceType) {
                    existing.sourceType = box.meta.sourceType;
                }
            }
        }

        session.publishArtifact(simulationArtifactKeys.sourcePositionMap, Array.from(summaries.values()));
    }
}
