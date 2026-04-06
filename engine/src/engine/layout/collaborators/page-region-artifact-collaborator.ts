import type { Collaborator, CollaboratorHost } from '../runtime/session/session-runtime-types';

import { simulationArtifactKeys } from '../simulation-report';
export type {
    PageRegionDebugSummary,
    PageRegionParticipantSummary,
    PageRegionSummary
} from '../page-region-summary';

export class PageRegionArtifactCollaborator implements Collaborator {
    readonly mutationMode = 'observer' as const;

    onSimulationComplete(host: CollaboratorHost): void {
        host.publishArtifact(
            simulationArtifactKeys.pageRegionSummary,
            host.getPageRegionSummaries().map((summary) => ({
                ...summary,
                debugRegions: summary.debugRegions.map((region) => ({
                    ...region,
                    participants: region.participants.map((participant) => ({ ...participant }))
                }))
            }))
        );
    }
}
