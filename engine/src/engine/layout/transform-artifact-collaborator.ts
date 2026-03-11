import { LayoutCollaborator, LayoutSession } from './layout-session';
import { simulationArtifactKeys } from './simulation-report';

export type TransformSummary = {
    sourceId: string;
    transformKind: 'clone';
    count: number;
    pageIndices: number[];
    clonedFromSourceIds: string[];
};

export class TransformArtifactCollaborator implements LayoutCollaborator {
    onSimulationComplete(session: LayoutSession): void {
        const summaries = new Map<string, TransformSummary>();

        for (const page of session.getFinalizedPages()) {
            for (const box of page.boxes || []) {
                if (box.meta?.transformKind !== 'clone') continue;

                const sourceId = String(box.meta?.sourceId || '');
                const clonedFromSourceId = String(box.meta?.clonedFromSourceId || '');
                const key = `clone:${sourceId}`;
                const summary = summaries.get(key) ?? {
                    sourceId,
                    transformKind: 'clone' as const,
                    count: 0,
                    pageIndices: [],
                    clonedFromSourceIds: []
                };

                summary.count += 1;
                if (!summary.pageIndices.includes(page.index)) {
                    summary.pageIndices.push(page.index);
                }
                if (clonedFromSourceId && !summary.clonedFromSourceIds.includes(clonedFromSourceId)) {
                    summary.clonedFromSourceIds.push(clonedFromSourceId);
                }
                summaries.set(key, summary);
            }
        }

        for (const summary of summaries.values()) {
            summary.pageIndices.sort((a, b) => a - b);
            summary.clonedFromSourceIds.sort((a, b) => a.localeCompare(b));
        }

        session.publishArtifact(
            simulationArtifactKeys.transformSummary,
            Array.from(summaries.values()).sort((a, b) => a.sourceId.localeCompare(b.sourceId))
        );
    }
}
