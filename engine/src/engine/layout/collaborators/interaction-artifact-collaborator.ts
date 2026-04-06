import type { CollaboratorHost } from '../layout-session-types';
import type { LayoutConfig } from '../../types';
import { buildInteractionPages, type VmprintInteractionPage } from '../../interaction-model';
import type { Collaborator } from '../layout-session-types';

import { simulationArtifactKeys } from '../simulation-report';

export type InteractionArtifactSummary = VmprintInteractionPage[];

export class InteractionArtifactCollaborator implements Collaborator {
    readonly mutationMode = 'observer' as const;

    constructor(
        private readonly layout: LayoutConfig['layout']
    ) { }

    onSimulationComplete(host: CollaboratorHost): void {
        host.publishArtifact(
            simulationArtifactKeys.interactionMap,
            buildInteractionPages(host.getFinalizedPages(), this.layout)
        );
    }
}
