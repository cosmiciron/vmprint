import type { CollaboratorHost } from '../layout-session-types';
import type { Collaborator } from '../layout-session-types';

import { simulationArtifactKeys } from '../simulation-report';
import { AsyncThoughtHost, type AsyncThoughtHandle } from '../async-thought-host';

export type AsyncThoughtSummary = AsyncThoughtHandle[];

export class AsyncThoughtRuntimeCollaborator implements Collaborator {
    constructor(
        private readonly host: AsyncThoughtHost
    ) { }

    onSimulationComplete(host: CollaboratorHost): void {
        host.publishArtifact(
            simulationArtifactKeys.asyncThoughtSummary,
            this.host.getSummary()
        );
    }
}
