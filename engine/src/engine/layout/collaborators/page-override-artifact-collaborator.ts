import type { Collaborator, CollaboratorHost } from '../runtime/session/session-runtime-types';

import { simulationArtifactKeys } from '../simulation-report';

export type PageOverrideSummary = {
    pageIndex: number;
    overrideSourceId: string | null;
    headerOverride: 'inherit' | 'replace' | 'suppress';
    footerOverride: 'inherit' | 'replace' | 'suppress';
};

export class PageOverrideArtifactCollaborator implements Collaborator {
    readonly mutationMode = 'observer' as const;

    onSimulationComplete(host: CollaboratorHost): void {
        const summaries: PageOverrideSummary[] = host.getPageFinalizationStates().map((state) => ({
            pageIndex: state.pageIndex,
            overrideSourceId: state.overrideSourceId,
            headerOverride: state.headerOverride,
            footerOverride: state.footerOverride
        }));

        host.publishArtifact(simulationArtifactKeys.pageOverrideSummary, summaries);
    }
}
