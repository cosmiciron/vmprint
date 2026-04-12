import type { PackagerUnit, LayoutBox, SpatialFrontier } from '../../../layout/packagers/packager-types';
import type { SimulationUpdateSource } from '../types';

type GeometryObservation = {
    geometryChanged: boolean;
    contentOnlyActors: readonly PackagerUnit[];
    earliestAffectedFrontier?: SpatialFrontier;
};

type ResolvedCheckpointBase = {
    kind: 'page' | 'actor';
    pageIndex: number;
    actorIndex: number;
};

export type ApplySteppedGeometryOptions<TPage, TCheckpoint extends ResolvedCheckpointBase = ResolvedCheckpointBase> = {
    source: SimulationUpdateSource;
    stepped: GeometryObservation;
    pages: TPage[];
    packagers: PackagerUnit[];
    recordUpdateSummary: (
        source: SimulationUpdateSource,
        kind: 'content-only' | 'geometry',
        actors: readonly PackagerUnit[],
        frontier?: SpatialFrontier,
        pageIndexes?: readonly number[]
    ) => void;
    resolveSafeCheckpoint: (frontier: SpatialFrontier) => TCheckpoint | null;
    restoreSafeCheckpoint: (pages: TPage[], packagers: PackagerUnit[], checkpoint: TCheckpoint) => {
        currentPageBoxes: LayoutBox[];
        currentY: number;
        lastSpacingAfter: number;
    };
    reapplyCheckpointState: (options: {
        checkpoint: TCheckpoint;
        restored: {
            currentPageBoxes: LayoutBox[];
            currentY: number;
            lastSpacingAfter: number;
        };
    }) => void;
};

export function applySteppedGeometryUpdate<TPage, TCheckpoint extends ResolvedCheckpointBase>(
    options: ApplySteppedGeometryOptions<TPage, TCheckpoint>
): boolean {
    const {
        source,
        stepped,
        pages,
        packagers,
        recordUpdateSummary,
        resolveSafeCheckpoint,
        restoreSafeCheckpoint,
        reapplyCheckpointState
    } = options;

    if (!stepped.geometryChanged || !stepped.earliestAffectedFrontier) {
        return false;
    }

    recordUpdateSummary(source, 'geometry', stepped.contentOnlyActors, stepped.earliestAffectedFrontier);

    const checkpoint = resolveSafeCheckpoint(stepped.earliestAffectedFrontier);
    if (!checkpoint) {
        return false;
    }

    const restored = restoreSafeCheckpoint(pages, packagers, checkpoint);
    reapplyCheckpointState({
        checkpoint,
        restored: {
            currentPageBoxes: restored.currentPageBoxes,
            currentY: restored.currentY,
            lastSpacingAfter: restored.lastSpacingAfter
        }
    });

    return true;
}
