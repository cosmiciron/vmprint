import type { LayoutCollaborator } from './layout-session-types';
import { LayoutSession } from './layout-session';
import { simulationArtifactKeys } from './simulation-report';

export type PageExclusionSummary = {
    pageIndex: number;
    exclusionCount: number;
    exclusionIds: string[];
    totalExcludedHeight: number;
};

export class PageExclusionArtifactCollaborator implements LayoutCollaborator {
    onSimulationComplete(session: LayoutSession): void {
        const summary = session.getExclusionPageIndices().map((pageIndex) => {
            const exclusions = session.getPageExclusions(pageIndex);
            return {
                pageIndex,
                exclusionCount: exclusions.length,
                exclusionIds: exclusions.map((exclusion) => exclusion.id),
                totalExcludedHeight: exclusions.reduce((sum, exclusion) => sum + exclusion.h, 0)
            };
        });

        session.publishArtifact(simulationArtifactKeys.pageExclusionSummary, summary);
    }
}
