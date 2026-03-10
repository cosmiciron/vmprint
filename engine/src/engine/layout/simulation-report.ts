import type { FragmentationSummary } from './fragment-transition-telemetry-collaborator';
import type { PageNumberSummary } from './page-number-telemetry-collaborator';
import type { PageOverrideSummary } from './page-override-telemetry-collaborator';
import type { PageRegionSummary } from './page-region-telemetry-collaborator';
import type { SourcePositionSummary } from './source-position-map-collaborator';
import type { LayoutProfileMetrics } from './layout-session';

export type SimulationTelemetrySections = {
    fragmentationSummary?: FragmentationSummary[];
    pageNumberSummary?: PageNumberSummary[];
    pageOverrideSummary?: PageOverrideSummary[];
    pageRegionSummary?: PageRegionSummary[];
    sourcePositionMap?: SourcePositionSummary[];
    [key: string]: unknown;
};

export type SimulationReport = {
    pageCount: number;
    actorCount: number;
    splitTransitionCount: number;
    generatedBoxCount: number;
    profile: LayoutProfileMetrics;
    telemetry: SimulationTelemetrySections;
};
