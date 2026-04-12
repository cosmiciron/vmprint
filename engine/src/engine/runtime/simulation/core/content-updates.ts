import type { PackagerUnit, LayoutBox, SpatialFrontier } from '../../../layout/packagers/packager-types';
import type { SimulationUpdateSource } from '../types';

export type ContentOnlyObservation = {
    geometryChanged: boolean;
    contentOnlyActors: readonly PackagerUnit[];
    earliestAffectedFrontier?: SpatialFrontier;
};

export type ApplyContentOnlyObservationOptions<TPage, TContextBase> = {
    source: SimulationUpdateSource;
    observation: ContentOnlyObservation;
    pages: TPage[];
    currentPageBoxes: LayoutBox[];
    chunkContextBase: TContextBase;
    recordUpdateSummary: (
        source: SimulationUpdateSource,
        kind: 'content-only' | 'geometry',
        actors: readonly PackagerUnit[],
        frontier?: SpatialFrontier,
        pageIndexes?: readonly number[]
    ) => void;
    applyContentOnlyActorUpdates: (
        pages: TPage[],
        currentPageBoxes: LayoutBox[],
        actors: readonly PackagerUnit[],
        chunkContextBase: TContextBase
    ) => void;
};

export function applyContentOnlyObservation<TPage, TContextBase>(
    options: ApplyContentOnlyObservationOptions<TPage, TContextBase>
): boolean {
    const {
        source,
        observation,
        pages,
        currentPageBoxes,
        chunkContextBase,
        recordUpdateSummary,
        applyContentOnlyActorUpdates
    } = options;

    if (observation.geometryChanged || observation.contentOnlyActors.length === 0) {
        return false;
    }

    recordUpdateSummary(source, 'content-only', observation.contentOnlyActors, observation.earliestAffectedFrontier);
    applyContentOnlyActorUpdates(pages, currentPageBoxes, observation.contentOnlyActors, chunkContextBase);
    return true;
}
