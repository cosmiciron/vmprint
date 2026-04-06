import type { CollaboratorHost } from '../layout-session-types';
import type { Collaborator } from '../layout-session-types';

import { simulationArtifactKeys } from '../simulation-report';

export type FragmentationSummary = {
    sourceActorId: string;
    splitCount: number;
    continuationCount: number;
    pageIndices: number[];
    pageAnchors: Array<{
        pageIndex: number;
        cursorY?: number;
    }>;
};

export class FragmentTransitionArtifactCollaborator implements Collaborator {
    readonly mutationMode = 'observer' as const;

    onSimulationComplete(host: CollaboratorHost): void {
        const summaries: FragmentationSummary[] = host.getFragmentTransitionSourceIds().map((sourceActorId) => {
            const summary: FragmentationSummary = {
                sourceActorId,
                splitCount: 0,
                continuationCount: 0,
                pageIndices: [],
                pageAnchors: []
            };

            for (const transition of host.getFragmentTransitionsBySource(sourceActorId)) {
                summary.splitCount += 1;
                if (transition.continuationActorId) {
                    summary.continuationCount += 1;
                }
                if (!summary.pageIndices.includes(transition.pageIndex)) {
                    summary.pageIndices.push(transition.pageIndex);
                }
                const existingAnchor = summary.pageAnchors.find((entry) => entry.pageIndex === transition.pageIndex);
                const cursorY = Number.isFinite(transition.cursorY) ? Number(transition.cursorY) : undefined;
                if (!existingAnchor) {
                    summary.pageAnchors.push({
                        pageIndex: transition.pageIndex,
                        ...(cursorY !== undefined ? { cursorY } : {})
                    });
                    continue;
                }
                if (
                    cursorY !== undefined
                    && (!Number.isFinite(existingAnchor.cursorY) || cursorY < Number(existingAnchor.cursorY))
                ) {
                    existingAnchor.cursorY = cursorY;
                }
            }

            summary.pageIndices.sort((a, b) => a - b);
            summary.pageAnchors.sort((a, b) => {
                if (a.pageIndex !== b.pageIndex) return a.pageIndex - b.pageIndex;
                const aCursorY = Number.isFinite(a.cursorY) ? Number(a.cursorY) : Number.POSITIVE_INFINITY;
                const bCursorY = Number.isFinite(b.cursorY) ? Number(b.cursorY) : Number.POSITIVE_INFINITY;
                return aCursorY - bCursorY;
            });
            return summary;
        });

        host.publishArtifact(simulationArtifactKeys.fragmentationSummary, summaries);
    }
}
