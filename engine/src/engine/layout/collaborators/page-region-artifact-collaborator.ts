import type { Collaborator, CollaboratorHost } from '../runtime/session/session-runtime-types';

import { summarizePageRegions } from '../page-region-summary';
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
            host.getFinalizedPages().map((page) => summarizePageRegions(page)).map((summary) => ({
                ...summary,
                debugRegions: summary.debugRegions.map((region) => ({
                    ...region,
                    participants: region.participants.map((participant) => ({ ...participant }))
                }))
            }))
        );
    }
}
