import type { CollaboratorHost } from '../layout-session-types';
import type { Collaborator } from '../layout-session-types';

import { simulationArtifactKeys } from '../simulation-report';

export type PageNumberSummary = {
    pageIndex: number;
    physicalPageNumber: number;
    logicalPageNumber: number | null;
    usesLogicalNumbering: boolean;
    renderedHeader: boolean;
    renderedFooter: boolean;
};

export class PageNumberArtifactCollaborator implements Collaborator {
    onSimulationComplete(host: CollaboratorHost): void {
        const summaries: PageNumberSummary[] = host.getPageFinalizationStates().map((state) => ({
            pageIndex: state.pageIndex,
            physicalPageNumber: state.physicalPageNumber,
            logicalPageNumber: state.logicalPageNumber,
            usesLogicalNumbering: state.usesLogicalNumbering,
            renderedHeader: state.renderedHeader,
            renderedFooter: state.renderedFooter
        }));

        host.publishArtifact(simulationArtifactKeys.pageNumberSummary, summaries);
    }
}
