import type { FragmentationSummary } from './fragment-transition-artifact-collaborator';
import type { PageNumberSummary } from './page-number-artifact-collaborator';
import type { PageOverrideSummary } from './page-override-artifact-collaborator';
import type { PageRegionSummary } from './page-region-artifact-collaborator';
import type { SourcePositionSummary } from './source-position-artifact-collaborator';
import type { LayoutProfileMetrics } from './layout-session';

export type SimulationArtifactMap = {
    fragmentationSummary?: FragmentationSummary[];
    pageNumberSummary?: PageNumberSummary[];
    pageOverrideSummary?: PageOverrideSummary[];
    pageRegionSummary?: PageRegionSummary[];
    sourcePositionMap?: SourcePositionSummary[];
};

export type SimulationArtifactKey = keyof SimulationArtifactMap;
export type SimulationArtifacts = SimulationArtifactMap & Record<string, unknown>;

export const simulationArtifactKeys = {
    fragmentationSummary: 'fragmentationSummary',
    pageNumberSummary: 'pageNumberSummary',
    pageOverrideSummary: 'pageOverrideSummary',
    pageRegionSummary: 'pageRegionSummary',
    sourcePositionMap: 'sourcePositionMap'
} as const satisfies Record<SimulationArtifactKey, SimulationArtifactKey>;

export const knownSimulationArtifactKeys: readonly SimulationArtifactKey[] = [
    simulationArtifactKeys.fragmentationSummary,
    simulationArtifactKeys.pageNumberSummary,
    simulationArtifactKeys.pageOverrideSummary,
    simulationArtifactKeys.pageRegionSummary,
    simulationArtifactKeys.sourcePositionMap
] as const;

export type SimulationReport = {
    pageCount: number;
    actorCount: number;
    splitTransitionCount: number;
    generatedBoxCount: number;
    profile: LayoutProfileMetrics;
    artifacts: SimulationArtifacts;
};

export type SimulationReportReader = {
    readonly report: SimulationReport | null | undefined;
    readonly pageCount: number;
    readonly actorCount: number;
    readonly splitTransitionCount: number;
    readonly generatedBoxCount: number;
    readonly profile: LayoutProfileMetrics | undefined;
    get<K extends SimulationArtifactKey>(key: K): SimulationArtifactMap[K] | undefined;
    has<K extends SimulationArtifactKey>(key: K): boolean;
    require<K extends SimulationArtifactKey>(key: K): NonNullable<SimulationArtifactMap[K]>;
};

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
        profile: report?.profile,
        get: (key) => getSimulationArtifact(report, key),
        has: (key) => hasSimulationArtifact(report, key),
        require: (key) => requireSimulationArtifact(report, key)
    };
}
