import type { LayoutCollaborator } from './layout-session-types';
import { LayoutSession } from './layout-session';
import { simulationArtifactKeys } from './simulation-report';

export type PageOverrideSummary = {
    pageIndex: number;
    overrideSourceId: string | null;
    headerOverride: 'inherit' | 'replace' | 'suppress';
    footerOverride: 'inherit' | 'replace' | 'suppress';
};

export class PageOverrideArtifactCollaborator implements LayoutCollaborator {
    onSimulationComplete(session: LayoutSession): void {
        const summaries: PageOverrideSummary[] = session.getPageFinalizationStates().map((state) => ({
            pageIndex: state.pageIndex,
            overrideSourceId: state.overrideSourceId,
            headerOverride: state.headerOverride,
            footerOverride: state.footerOverride
        }));

        session.publishArtifact(simulationArtifactKeys.pageOverrideSummary, summaries);
    }
}
