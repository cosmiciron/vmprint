import { LayoutCollaborator, LayoutSession } from './layout-session';
import { simulationArtifactKeys } from './simulation-report';

export type TransformSummary = {
    sourceId: string;
    transformKind: 'clone' | 'split';
    count: number;
    pageIndices: number[];
    fragmentIndices: number[];
    clonedFromSourceIds?: string[];
};

export class TransformArtifactCollaborator implements LayoutCollaborator {
    onSimulationComplete(session: LayoutSession): void {
        const summaries = new Map<string, TransformSummary>();

        for (const page of session.getFinalizedPages()) {
            for (const box of page.boxes || []) {
                const sourceId = String(box.meta?.sourceId || '');
                const transformKind = box.meta?.transformKind || null;
                if (!transformKind) continue;

                const key = `${transformKind}:${sourceId}`;
                const summary = summaries.get(key) ?? {
                    sourceId,
                    transformKind,
                    count: 0,
                    pageIndices: [],
                    fragmentIndices: [],
                    clonedFromSourceIds: transformKind === 'clone' ? [] : undefined
                };

                summary.count += 1;
                if (!summary.pageIndices.includes(page.index)) {
                    summary.pageIndices.push(page.index);
                }
                const fragmentIndex = Number(box.meta?.fragmentIndex || 0);
                if (Number.isFinite(fragmentIndex) && !summary.fragmentIndices.includes(fragmentIndex)) {
                    summary.fragmentIndices.push(fragmentIndex);
                }
                if (transformKind === 'clone') {
                    const clonedFromSourceId = String(box.meta?.clonedFromSourceId || '');
                    if (
                        clonedFromSourceId
                        && Array.isArray(summary.clonedFromSourceIds)
                        && !summary.clonedFromSourceIds.includes(clonedFromSourceId)
                    ) {
                        summary.clonedFromSourceIds.push(clonedFromSourceId);
                    }
                }
                summaries.set(key, summary);
            }
        }

        for (const summary of summaries.values()) {
            summary.pageIndices.sort((a, b) => a - b);
            summary.fragmentIndices.sort((a, b) => a - b);
            if (Array.isArray(summary.clonedFromSourceIds)) {
                summary.clonedFromSourceIds.sort((a, b) => a.localeCompare(b));
            }
        }

        session.publishArtifact(
            simulationArtifactKeys.transformSummary,
            Array.from(summaries.values()).sort((a, b) => a.sourceId.localeCompare(b.sourceId))
        );
    }
}
