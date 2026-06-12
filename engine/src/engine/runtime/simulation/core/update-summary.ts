import type { PackagerUnit, SpatialFrontier } from '../../../layout/packagers/packager-types';
import type { SimulationReplayFrontier, SimulationUpdateSource, SimulationUpdateSummary } from '../types';

function normalizeReplayFrontier(frontier?: SpatialFrontier): SimulationReplayFrontier | null {
    if (!frontier || !Number.isFinite(frontier.pageIndex)) return null;
    return {
        pageIndex: Math.max(0, Math.floor(Number(frontier.pageIndex))),
        ...(Number.isFinite(frontier.cursorY) ? { cursorY: Number(frontier.cursorY) } : {}),
        ...(Number.isFinite(frontier.worldY) ? { worldY: Number(frontier.worldY) } : {}),
        ...(Number.isFinite(frontier.actorIndex) ? { actorIndex: Math.max(0, Math.floor(Number(frontier.actorIndex))) } : {}),
        ...(typeof frontier.actorId === 'string' && frontier.actorId ? { actorId: frontier.actorId } : {}),
        ...(typeof frontier.sourceId === 'string' && frontier.sourceId ? { sourceId: frontier.sourceId } : {})
    };
}

export function createEmptyUpdateSummary(): SimulationUpdateSummary {
    return {
        kind: 'none',
        source: 'none',
        actorIds: [],
        sourceIds: [],
        pageIndexes: [],
        addedPageIndexes: [],
        removedPageIndexes: [],
        replayFrontier: null
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
        return {
            kind,
            source,
            actorIds,
            sourceIds,
            pageIndexes: touchedPageIndexes,
            addedPageIndexes: [],
            removedPageIndexes: [],
            replayFrontier: normalizeReplayFrontier(frontier)
        };
    }

    if (current.kind !== kind || current.source !== source) {
        return current;
    }

    return {
        kind,
        source,
        actorIds: Array.from(new Set([...current.actorIds, ...actorIds])),
        sourceIds: Array.from(new Set([...current.sourceIds, ...sourceIds])),
        pageIndexes: Array.from(new Set([...current.pageIndexes, ...touchedPageIndexes])).sort((a, b) => a - b),
        addedPageIndexes: [...current.addedPageIndexes],
        removedPageIndexes: [...current.removedPageIndexes],
        replayFrontier: current.replayFrontier ?? normalizeReplayFrontier(frontier)
    };
}
