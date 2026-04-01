import type { FragmentationSummary } from './collaborators/fragment-transition-artifact-collaborator';
import type { TransformCapabilitySummary } from './collaborators/transform-capability-artifact-collaborator';
import type { TransformSummary } from './collaborators/transform-artifact-collaborator';
import type { PageNumberSummary } from './collaborators/page-number-artifact-collaborator';
import type { PageOverrideSummary } from './collaborators/page-override-artifact-collaborator';
import type { PageReservationSummary } from './collaborators/page-reservation-artifact-collaborator';
import type { PageExclusionSummary } from './collaborators/page-exclusion-artifact-collaborator';
import type { PageSpatialConstraintSummary } from './collaborators/page-spatial-constraint-artifact-collaborator';
import type { PageRegionSummary } from './collaborators/page-region-artifact-collaborator';
import type { SourcePositionSummary } from './collaborators/source-position-artifact-collaborator';
import type { HeadingTelemetrySummary } from './collaborators/heading-telemetry-collaborator';
import type { AsyncThoughtSummary } from './collaborators/async-thought-runtime-collaborator';
import type { TemporalPresentationTimeline } from './collaborators/temporal-presentation-collaborator';
import type { InteractionArtifactSummary } from './collaborators/interaction-artifact-collaborator';
import type { ViewportCaptureSummary } from './collaborators/viewport-capture-artifact-collaborator';
import type { LayoutProfileMetrics } from './layout-session-types';
import type { Page } from '../types';
import type { SimulationProgressionPolicy, SimulationStopReason } from '../types';

export type SimulationArtifactMap = {
    fragmentationSummary?: FragmentationSummary[];
    transformCapabilitySummary?: TransformCapabilitySummary[];
    transformSummary?: TransformSummary[];
    pageNumberSummary?: PageNumberSummary[];
    pageOverrideSummary?: PageOverrideSummary[];
    pageReservationSummary?: PageReservationSummary[];
    pageExclusionSummary?: PageExclusionSummary[];
    pageSpatialConstraintSummary?: PageSpatialConstraintSummary[];
    pageRegionSummary?: PageRegionSummary[];
    sourcePositionMap?: SourcePositionSummary[];
    headingTelemetry?: HeadingTelemetrySummary[];
    asyncThoughtSummary?: AsyncThoughtSummary;
    temporalPresentationTimeline?: TemporalPresentationTimeline;
    interactionMap?: InteractionArtifactSummary;
    viewportCaptureSummary?: ViewportCaptureSummary[];
};

export type SimulationArtifactKey = keyof SimulationArtifactMap;
export type SimulationArtifacts = SimulationArtifactMap & Record<string, unknown>;

export const simulationArtifactKeys = {
    fragmentationSummary: 'fragmentationSummary',
    transformCapabilitySummary: 'transformCapabilitySummary',
    transformSummary: 'transformSummary',
    pageNumberSummary: 'pageNumberSummary',
    pageOverrideSummary: 'pageOverrideSummary',
    pageReservationSummary: 'pageReservationSummary',
    pageExclusionSummary: 'pageExclusionSummary',
    pageSpatialConstraintSummary: 'pageSpatialConstraintSummary',
    pageRegionSummary: 'pageRegionSummary',
    sourcePositionMap: 'sourcePositionMap',
    headingTelemetry: 'headingTelemetry',
    asyncThoughtSummary: 'asyncThoughtSummary',
    temporalPresentationTimeline: 'temporalPresentationTimeline',
    interactionMap: 'interactionMap',
    viewportCaptureSummary: 'viewportCaptureSummary'
} as const satisfies Record<SimulationArtifactKey, SimulationArtifactKey>;

export const knownSimulationArtifactKeys: readonly SimulationArtifactKey[] = [
    simulationArtifactKeys.fragmentationSummary,
    simulationArtifactKeys.transformCapabilitySummary,
    simulationArtifactKeys.transformSummary,
    simulationArtifactKeys.pageNumberSummary,
    simulationArtifactKeys.pageOverrideSummary,
    simulationArtifactKeys.pageReservationSummary,
    simulationArtifactKeys.pageExclusionSummary,
    simulationArtifactKeys.pageSpatialConstraintSummary,
    simulationArtifactKeys.pageRegionSummary,
    simulationArtifactKeys.sourcePositionMap,
    simulationArtifactKeys.headingTelemetry,
    simulationArtifactKeys.asyncThoughtSummary,
    simulationArtifactKeys.temporalPresentationTimeline,
    simulationArtifactKeys.interactionMap,
    simulationArtifactKeys.viewportCaptureSummary
] as const;

export type SimulationReport = {
    pageCount: number;
    actorCount: number;
    splitTransitionCount: number;
    generatedBoxCount: number;
    progression: SimulationProgressionSummary;
    capture: SimulationCaptureSummary;
    profile: LayoutProfileMetrics;
    artifacts: SimulationArtifacts;
};

export type SimulationCaptureKind = 'finalized-pages';
export type SimulationCapturePolicy = 'settle-immediately' | 'fixed-tick-count';

export type SimulationProgressionSummary = {
    policy: SimulationProgressionPolicy;
    stopReason: SimulationStopReason;
    captureKind: SimulationCaptureKind;
    finalTick: number;
    progressionStopped: boolean;
};

export type SimulationCaptureSummary = {
    policy: SimulationCapturePolicy;
    requestedMaxTicks: number | null;
    captureKind: SimulationCaptureKind;
    satisfiedBy: SimulationStopReason;
    capturedAtTick: number;
};

export type SimulationReportReader = {
    readonly report: SimulationReport | null | undefined;
    readonly pageCount: number;
    readonly actorCount: number;
    readonly splitTransitionCount: number;
    readonly generatedBoxCount: number;
    readonly progression: SimulationProgressionSummary | undefined;
    readonly capture: SimulationCaptureSummary | undefined;
    readonly profile: LayoutProfileMetrics | undefined;
    get<K extends SimulationArtifactKey>(key: K): SimulationArtifactMap[K] | undefined;
    has<K extends SimulationArtifactKey>(key: K): boolean;
    require<K extends SimulationArtifactKey>(key: K): NonNullable<SimulationArtifactMap[K]>;
};

export type PrintPipelineSnapshot = {
    readonly pages: readonly Page[];
    readonly report: SimulationReport | undefined;
    readonly reader: SimulationReportReader;
};

export type HeadingOutlineEntry = {
    sourceId: string;
    heading: string;
    pageIndex: number;
    y: number;
    actorKind?: string;
    sourceType?: string;
    semanticRole?: string;
    level?: number;
};

export function getTemporalPresentationTimeline(
    source: PrintPipelineSnapshot | SimulationReport | null | undefined
): TemporalPresentationTimeline {
    const reader = 'reader' in (source || {})
        ? (source as PrintPipelineSnapshot).reader
        : createSimulationReportReader(source as SimulationReport | null | undefined);
    return reader.get(simulationArtifactKeys.temporalPresentationTimeline) ?? [];
}

export function getSimulationArtifact<K extends SimulationArtifactKey>(
    report: SimulationReport | null | undefined,
    key: K
): SimulationArtifactMap[K] | undefined {
    return report?.artifacts?.[key] as SimulationArtifactMap[K] | undefined;
}

export function hasSimulationArtifact<K extends SimulationArtifactKey>(
    report: SimulationReport | null | undefined,
    key: K
): boolean {
    return getSimulationArtifact(report, key) !== undefined;
}

export function requireSimulationArtifact<K extends SimulationArtifactKey>(
    report: SimulationReport | null | undefined,
    key: K
): NonNullable<SimulationArtifactMap[K]> {
    const artifact = getSimulationArtifact(report, key);
    if (artifact === undefined) {
        throw new Error(`[SimulationReport] Missing required artifact "${key}".`);
    }
    return artifact as NonNullable<SimulationArtifactMap[K]>;
}

export function createSimulationReportReader(
    report: SimulationReport | null | undefined
): SimulationReportReader {
    return {
        report,
        pageCount: report?.pageCount ?? 0,
        actorCount: report?.actorCount ?? 0,
        splitTransitionCount: report?.splitTransitionCount ?? 0,
        generatedBoxCount: report?.generatedBoxCount ?? 0,
        progression: report?.progression,
        capture: report?.capture,
        profile: report?.profile,
        get: (key) => getSimulationArtifact(report, key),
        has: (key) => hasSimulationArtifact(report, key),
        require: (key) => requireSimulationArtifact(report, key)
    };
}

export function createPrintPipelineSnapshot(
    pages: readonly Page[],
    report: SimulationReport | null | undefined
): PrintPipelineSnapshot {
    return {
        pages,
        report: report ?? undefined,
        reader: createSimulationReportReader(report)
    };
}

export function getHeadingOutline(
    source: PrintPipelineSnapshot | SimulationReport | null | undefined
): HeadingOutlineEntry[] {
    const reader = 'reader' in (source || {})
        ? (source as PrintPipelineSnapshot).reader
        : createSimulationReportReader(source as SimulationReport | null | undefined);
    const headings = reader.get(simulationArtifactKeys.headingTelemetry) ?? [];

    return headings.map((heading) => ({
        sourceId: heading.sourceId,
        heading: heading.heading,
        pageIndex: heading.pageIndex,
        y: heading.y,
        actorKind: heading.actorKind,
        sourceType: heading.sourceType,
        semanticRole: heading.semanticRole,
        level: heading.level
    }));
}
