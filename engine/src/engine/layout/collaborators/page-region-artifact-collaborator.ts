import type { Collaborator } from '../layout-session-types';
import { LayoutSession } from '../layout-session';
import { simulationArtifactKeys } from '../simulation-report';
export type {
    PageRegionDebugSummary,
    PageRegionParticipantSummary,
    PageRegionSummary
} from '../page-region-summary';

export class PageRegionArtifactCollaborator implements Collaborator {
    onSimulationComplete(session: LayoutSession): void {
        session.publishArtifact(
            simulationArtifactKeys.pageRegionSummary,
            session.getPageRegionSummaries().map((summary) => ({
                ...summary,
                debugRegions: summary.debugRegions.map((region) => ({
                    ...region,
                    participants: region.participants.map((participant) => ({ ...participant }))
                }))
            }))
        );
    }
}
