import type { PackagerUnit, SpatialFrontier } from '../../../layout/packagers/packager-types';
import type { SimulationUpdateSource, SimulationUpdateSummary } from '../types';

export function createEmptyUpdateSummary(): SimulationUpdateSummary {
    return {
        kind: 'none',
        source: 'none',
        actorIds: [],
        sourceIds: [],
        pageIndexes: []
    };
}

export function accumulateUpdateSummary(
    current: SimulationUpdateSummary,
    source: SimulationUpdateSource,
    kind: 'content-only' | 'geometry',
    actors: readonly PackagerUnit[],
    frontier?: SpatialFrontier,
    pageIndexes: readonly number[] = []
): SimulationUpdateSummary {
    const actorIds = Array.from(new Set([
        ...actors.map((actor) => actor.actorId).filter(Boolean),
        ...(frontier?.actorId ? [frontier.actorId] : [])
    ]));
    const sourceIds = Array.from(new Set([
        ...actors.map((actor) => actor.sourceId).filter(Boolean),
        ...(frontier?.sourceId ? [frontier.sourceId] : [])
    ]));
    const touchedPageIndexes = Array.from(new Set([
        ...pageIndexes
            .filter((pageIndex) => Number.isFinite(pageIndex))
            .map((pageIndex) => Math.max(0, Math.floor(Number(pageIndex)))),
        ...(frontier && Number.isFinite(frontier.pageIndex)
            ? [Math.max(0, Math.floor(Number(frontier.pageIndex)))]
            : [])
    ]));

    if (kind === 'geometry' || current.kind === 'none') {
        return { kind, source, actorIds, sourceIds, pageIndexes: touchedPageIndexes };
    }

    if (current.kind !== kind || current.source !== source) {
        return current;
    }

    return {
        kind,
        source,
        actorIds: Array.from(new Set([...current.actorIds, ...actorIds])),
        sourceIds: Array.from(new Set([...current.sourceIds, ...sourceIds])),
        pageIndexes: Array.from(new Set([...current.pageIndexes, ...touchedPageIndexes])).sort((a, b) => a - b)
    };
}
