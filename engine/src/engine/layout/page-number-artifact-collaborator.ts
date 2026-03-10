import { LayoutCollaborator, LayoutSession } from './layout-session';
import { simulationArtifactKeys } from './simulation-report';

export type PageNumberSummary = {
    pageIndex: number;
    physicalPageNumber: number;
    logicalPageNumber: number | null;
    usesLogicalNumbering: boolean;
    renderedHeader: boolean;
    renderedFooter: boolean;
};

export class PageNumberArtifactCollaborator implements LayoutCollaborator {
    onSimulationComplete(session: LayoutSession): void {
        const summaries: PageNumberSummary[] = session.getPageFinalizationStates().map((state) => ({
            pageIndex: state.pageIndex,
            physicalPageNumber: state.physicalPageNumber,
            logicalPageNumber: state.logicalPageNumber,
            usesLogicalNumbering: state.usesLogicalNumbering,
            renderedHeader: state.renderedHeader,
            renderedFooter: state.renderedFooter
        }));

        session.publishArtifact(simulationArtifactKeys.pageNumberSummary, summaries);
    }
}
