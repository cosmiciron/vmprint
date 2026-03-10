import type { Page } from '../types';
import { LayoutCollaborator, LayoutSession } from './layout-session';
import { SimulationReport, SimulationTelemetrySections } from './simulation-report';

export class SimulationReportCollaborator implements LayoutCollaborator {
    onSimulationComplete(pages: Page[], session: LayoutSession): void {
        const generatedBoxCount = pages.reduce((sum, page) => {
            return sum + (page.boxes || []).reduce((pageSum, box) => {
                return pageSum + (box.meta?.generated === true ? 1 : 0);
            }, 0);
        }, 0);
        const telemetrySnapshot = session.getTelemetrySnapshot();
        const telemetry: SimulationTelemetrySections = {
            fragmentationSummary: session.getTelemetry('fragmentationSummary'),
            pageNumberSummary: session.getTelemetry('pageNumberSummary'),
            pageOverrideSummary: session.getTelemetry('pageOverrideSummary'),
            pageRegionSummary: session.getTelemetry('pageRegionSummary'),
            sourcePositionMap: session.getTelemetry('sourcePositionMap')
        };

        for (const [key, value] of Object.entries(telemetrySnapshot)) {
            if (key === 'simulationReport') continue;
            if (key in telemetry && telemetry[key] !== undefined) continue;
            telemetry[key] = value;
        }

        const report: SimulationReport = {
            pageCount: pages.length,
            actorCount: session.actorRegistry.length,
            splitTransitionCount: session.getFragmentTransitions().length,
            generatedBoxCount,
            profile: {
                ...session.profile,
                keepWithNextPrepareByKind: { ...session.profile.keepWithNextPrepareByKind }
            },
            telemetry
        };

        session.setSimulationReport(report);
    }
}
