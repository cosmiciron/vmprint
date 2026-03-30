import type { Collaborator } from '../layout-session-types';
import { LayoutSession } from '../layout-session';
import { simulationArtifactKeys } from '../simulation-report';
import { AsyncThoughtHost, type AsyncThoughtHandle } from '../async-thought-host';

export type AsyncThoughtSummary = AsyncThoughtHandle[];

export class AsyncThoughtRuntimeCollaborator implements Collaborator {
    constructor(
        private readonly host: AsyncThoughtHost
    ) { }

    onSimulationComplete(session: LayoutSession): void {
        session.publishArtifact(
            simulationArtifactKeys.asyncThoughtSummary,
            this.host.getSummary()
        );
    }
}
