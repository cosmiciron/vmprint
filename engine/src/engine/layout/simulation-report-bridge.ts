import type { Page } from '../types';
import type { SimulationProgressionPolicy, SimulationStopReason } from '../types';
import type {
    SimulationArtifactKey,
    SimulationArtifactMap,
    SimulationArtifacts,
    SimulationCapturePolicy,
    SimulationCaptureSummary,
    SimulationProgressionSummary,
    SimulationReport,
    SimulationReportReader
} from './simulation-report';
import { createSimulationReportReader, simulationArtifactKeys } from './simulation-report';
import type { LayoutProfileMetrics, PageFinalizationState } from './layout-session-types';

export type SimulationReportBridgeHost = {
    getFinalizedPages(): readonly Page[];
    getRegisteredActors(): readonly unknown[];
    getFragmentTransitions(): readonly unknown[];
    getPublishedArtifacts(): ReadonlyMap<string, unknown>;
    getProfileSnapshot(): LayoutProfileMetrics;
    getSimulationTick(): number;
    getSimulationProgressionPolicy(): SimulationProgressionPolicy;
    getSimulationStopReason(): SimulationStopReason;
    getSimulationCapturePolicy(): SimulationCapturePolicy;
    getSimulationCaptureMaxTicks(): number | null;
    isSimulationProgressionStopped(): boolean;
    onSimulationComplete(): void;
};

export class SimulationReportBridge {
    private simulationReport?: SimulationReport;
    private simulationReportReader: SimulationReportReader = createSimulationReportReader(undefined);

    constructor(
        private readonly host: SimulationReportBridgeHost
    ) { }

    finalizePages(pages: Page[]): Page[] {
        this.host.onSimulationComplete();
        this.setSimulationReport(this.buildSimulationReport());
        return pages;
    }

    buildSimulationArtifacts(): SimulationArtifacts {
        const publishedArtifacts = this.host.getPublishedArtifacts();
        const artifacts: SimulationArtifacts = {
            fragmentationSummary: publishedArtifacts.get(simulationArtifactKeys.fragmentationSummary) as SimulationArtifactMap['fragmentationSummary'],
            transformCapabilitySummary: publishedArtifacts.get(simulationArtifactKeys.transformCapabilitySummary) as SimulationArtifactMap['transformCapabilitySummary'],
            transformSummary: publishedArtifacts.get(simulationArtifactKeys.transformSummary) as SimulationArtifactMap['transformSummary'],
            pageNumberSummary: publishedArtifacts.get(simulationArtifactKeys.pageNumberSummary) as SimulationArtifactMap['pageNumberSummary'],
            pageOverrideSummary: publishedArtifacts.get(simulationArtifactKeys.pageOverrideSummary) as SimulationArtifactMap['pageOverrideSummary'],
            pageExclusionSummary: publishedArtifacts.get(simulationArtifactKeys.pageExclusionSummary) as SimulationArtifactMap['pageExclusionSummary'],
            pageReservationSummary: publishedArtifacts.get(simulationArtifactKeys.pageReservationSummary) as SimulationArtifactMap['pageReservationSummary'],
            pageSpatialConstraintSummary: publishedArtifacts.get(simulationArtifactKeys.pageSpatialConstraintSummary) as SimulationArtifactMap['pageSpatialConstraintSummary'],
            pageRegionSummary: publishedArtifacts.get(simulationArtifactKeys.pageRegionSummary) as SimulationArtifactMap['pageRegionSummary'],
            sourcePositionMap: publishedArtifacts.get(simulationArtifactKeys.sourcePositionMap) as SimulationArtifactMap['sourcePositionMap'],
            headingTelemetry: publishedArtifacts.get(simulationArtifactKeys.headingTelemetry) as SimulationArtifactMap['headingTelemetry'],
            asyncThoughtSummary: publishedArtifacts.get(simulationArtifactKeys.asyncThoughtSummary) as SimulationArtifactMap['asyncThoughtSummary'],
            temporalPresentationTimeline: publishedArtifacts.get(simulationArtifactKeys.temporalPresentationTimeline) as SimulationArtifactMap['temporalPresentationTimeline'],
            interactionMap: publishedArtifacts.get(simulationArtifactKeys.interactionMap) as SimulationArtifactMap['interactionMap'],
            viewportCaptureSummary: publishedArtifacts.get(simulationArtifactKeys.viewportCaptureSummary) as SimulationArtifactMap['viewportCaptureSummary']
        };

        for (const [key, value] of publishedArtifacts.entries()) {
            if (key in artifacts && artifacts[key] !== undefined) continue;
            artifacts[key] = value;
        }

        return artifacts;
    }

    buildSimulationReport(): SimulationReport {
        const pages = this.host.getFinalizedPages();
        const generatedBoxCount = pages.reduce((sum, page) => {
            return sum + (page.boxes || []).reduce((pageSum, box) => {
                return pageSum + (box.meta?.generated === true ? 1 : 0);
            }, 0);
        }, 0);
        const profile = this.host.getProfileSnapshot();
        const finalTick = this.host.getSimulationTick();
        const stopReason = this.host.getSimulationStopReason();
        const progression: SimulationProgressionSummary = {
            policy: this.host.getSimulationProgressionPolicy(),
            stopReason,
            captureKind: 'finalized-pages',
            finalTick,
            progressionStopped: this.host.isSimulationProgressionStopped()
        };
        const capture: SimulationCaptureSummary = {
            policy: this.host.getSimulationCapturePolicy(),
            requestedMaxTicks: this.host.getSimulationCaptureMaxTicks(),
            captureKind: 'finalized-pages',
            satisfiedBy: stopReason,
            capturedAtTick: finalTick
        };

        return {
            pageCount: pages.length,
            actorCount: this.host.getRegisteredActors().length,
            splitTransitionCount: this.host.getFragmentTransitions().length,
            generatedBoxCount,
            progression,
            capture,
            profile: {
                ...profile,
                keepWithNextPrepareByKind: { ...profile.keepWithNextPrepareByKind },
                speculativeBranchByReason: { ...profile.speculativeBranchByReason }
            },
            artifacts: this.buildSimulationArtifacts()
        };
    }

    setSimulationReport(report: SimulationReport): void {
        this.simulationReport = report;
        this.simulationReportReader = createSimulationReportReader(report);
    }

    getSimulationReport(): SimulationReport | undefined {
        return this.simulationReport;
    }

    getSimulationReportReader(): SimulationReportReader {
        return this.simulationReportReader;
    }
}
