import type { Collaborator, CollaboratorHost } from '../runtime/session/session-runtime-types';

import { simulationArtifactKeys } from '../simulation-report';

export type PageExclusionSummary = {
    pageIndex: number;
    exclusionCount: number;
    exclusionIds: string[];
    totalExcludedHeight: number;
};

export class PageExclusionArtifactCollaborator implements Collaborator {
    readonly mutationMode = 'observer' as const;

    onSimulationComplete(host: CollaboratorHost): void {
        const summary = host.getExclusionPageIndices().map((pageIndex) => {
            const exclusions = host.getPageExclusions(pageIndex);
            return {
                pageIndex,
                exclusionCount: exclusions.length,
                exclusionIds: exclusions.map((exclusion) => exclusion.id),
                totalExcludedHeight: exclusions.reduce((sum, exclusion) => sum + exclusion.h, 0)
            };
        });

        host.publishArtifact(simulationArtifactKeys.pageExclusionSummary, summary);
    }
}
