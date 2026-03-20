import type { Collaborator } from './layout-session-types';
import { LayoutSession } from './layout-session';
import { simulationArtifactKeys } from './simulation-report';

export type FragmentationSummary = {
    sourceActorId: string;
    splitCount: number;
    continuationCount: number;
    pageIndices: number[];
};

export class FragmentTransitionArtifactCollaborator implements Collaborator {
    onSimulationComplete(session: LayoutSession): void {
        const summaries: FragmentationSummary[] = session.getFragmentTransitionSourceIds().map((sourceActorId) => {
            const summary: FragmentationSummary = {
                sourceActorId,
                splitCount: 0,
                continuationCount: 0,
                pageIndices: []
            };

            for (const transition of session.getFragmentTransitionsBySource(sourceActorId)) {
                summary.splitCount += 1;
                if (transition.continuationActorId) {
                    summary.continuationCount += 1;
                }
                if (!summary.pageIndices.includes(transition.pageIndex)) {
                    summary.pageIndices.push(transition.pageIndex);
                }
            }

            summary.pageIndices.sort((a, b) => a - b);
            return summary;
        });

        session.publishArtifact(simulationArtifactKeys.fragmentationSummary, summaries);
    }
}
