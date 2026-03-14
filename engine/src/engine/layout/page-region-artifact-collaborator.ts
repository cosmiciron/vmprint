import type { LayoutCollaborator } from './layout-session-types';
import { LayoutSession } from './layout-session';
import { simulationArtifactKeys } from './simulation-report';

export type PageRegionSummary = {
    pageIndex: number;
    headerBoxes: number;
    footerBoxes: number;
    generatedBoxes: number;
};

export class PageRegionArtifactCollaborator implements LayoutCollaborator {
    onSimulationComplete(session: LayoutSession): void {
        const pages = session.getFinalizedPages();
        const summaries: PageRegionSummary[] = pages.map((page) => {
            let headerBoxes = 0;
            let footerBoxes = 0;
            let generatedBoxes = 0;

            for (const box of page.boxes || []) {
                if (box.meta?.generated === true) {
                    generatedBoxes += 1;
                }
                if (box.meta?.sourceType === 'header') {
                    headerBoxes += 1;
                } else if (box.meta?.sourceType === 'footer') {
                    footerBoxes += 1;
                }
            }

            return {
                pageIndex: page.index,
                headerBoxes,
                footerBoxes,
                generatedBoxes
            };
        });

        session.publishArtifact(simulationArtifactKeys.pageRegionSummary, summaries);
    }
}
