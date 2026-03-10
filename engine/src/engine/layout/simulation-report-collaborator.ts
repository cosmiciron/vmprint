import type { Page } from '../types';
import { LayoutCollaborator, LayoutSession } from './layout-session';
import { SimulationReport } from './simulation-report';

export class SimulationReportCollaborator implements LayoutCollaborator {
    onSimulationComplete(pages: Page[], session: LayoutSession): void {
        const generatedBoxCount = pages.reduce((sum, page) => {
            return sum + (page.boxes || []).reduce((pageSum, box) => {
                return pageSum + (box.meta?.generated === true ? 1 : 0);
            }, 0);
        }, 0);
        const artifacts = session.buildSimulationArtifacts();

        const report: SimulationReport = {
            pageCount: pages.length,
            actorCount: session.actorRegistry.length,
            splitTransitionCount: session.getFragmentTransitions().length,
            generatedBoxCount,
            profile: {
                ...session.profile,
                keepWithNextPrepareByKind: { ...session.profile.keepWithNextPrepareByKind }
            },
            artifacts
        };

        session.setSimulationReport(report);
    }
}
