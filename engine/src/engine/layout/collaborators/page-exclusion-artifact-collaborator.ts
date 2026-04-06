import type { CollaboratorHost } from '../layout-session-types';
import type { Collaborator } from '../layout-session-types';

import { simulationArtifactKeys } from '../simulation-report';

export type PageExclusionSummary = {
    pageIndex: number;
    exclusionCount: number;
    exclusionIds: string[];
    totalExcludedHeight: number;
};

export class PageExclusionArtifactCollaborator implements Collaborator {
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
