import type { Collaborator, CollaboratorHost } from '../runtime/session/session-runtime-types';

import { simulationArtifactKeys } from '../simulation-report';
import { AsyncThoughtHost, type AsyncThoughtHandle } from '../async-thought-host';

export type AsyncThoughtSummary = AsyncThoughtHandle[];

export class AsyncThoughtRuntimeCollaborator implements Collaborator {
    readonly mutationMode = 'observer' as const;

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
