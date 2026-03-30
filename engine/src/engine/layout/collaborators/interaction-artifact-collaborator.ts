import type { LayoutConfig } from '../../types';
import { buildInteractionPages, type VmprintInteractionPage } from '../../interaction-model';
import type { Collaborator } from '../layout-session-types';
import { LayoutSession } from '../layout-session';
import { simulationArtifactKeys } from '../simulation-report';

export type InteractionArtifactSummary = VmprintInteractionPage[];

export class InteractionArtifactCollaborator implements Collaborator {
    constructor(
        private readonly layout: LayoutConfig['layout']
    ) { }

    onSimulationComplete(session: LayoutSession): void {
        session.publishArtifact(
            simulationArtifactKeys.interactionMap,
            buildInteractionPages(session.getFinalizedPages(), this.layout)
        );
    }
}
