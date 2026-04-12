import type { PackagerUnit, LayoutBox, SpatialFrontier } from '../../../layout/packagers/packager-types';
import type { LayoutProfileMetrics } from '../../../layout/runtime/session/session-profile-types';
import type { SimulationUpdateSource } from '../types';
import { buildReactiveResettlementSignature } from './reactivity';

type GeometryObservation = {
    geometryChanged: boolean;
    contentOnlyActors: readonly PackagerUnit[];
    earliestAffectedFrontier?: SpatialFrontier;
};

type ResolvedCheckpointBase = {
    id: string;
    kind: 'page' | 'actor';
    pageIndex: number;
    actorIndex: number;
    anchorActorId?: string;
    anchorSourceId?: string;
    frontier: {
        cursorY?: number;
        worldY?: number;
    };
};

export type SettleObserverGeometryOptions<TPage, TCheckpoint extends ResolvedCheckpointBase = ResolvedCheckpointBase> = {
    source: SimulationUpdateSource;
    observation: GeometryObservation;
    maxReactiveResettlementCycles: number;
    reactiveResettlementCycles: number;
    reactiveResettlementSignatures: Set<string>;
    actorSignalSequence: number;
    pages: TPage[];
    packagers: PackagerUnit[];
    pageWidth: number;
    pageHeight: number;
    recordUpdateSummary: (
        source: SimulationUpdateSource,
        kind: 'content-only' | 'geometry',
        actors: readonly PackagerUnit[],
        frontier?: SpatialFrontier,
        pageIndexes?: readonly number[]
    ) => void;
    recordProfile: (metric: keyof LayoutProfileMetrics, delta: number) => void;
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

export type SettleObserverGeometryResult = {
    settled: boolean;
    reactiveResettlementCycles: number;
};

export function settleObserverGeometryAtCheckpoint<TPage, TCheckpoint extends ResolvedCheckpointBase>(
    options: SettleObserverGeometryOptions<TPage, TCheckpoint>
): SettleObserverGeometryResult {
    const {
        source,
        observation,
        maxReactiveResettlementCycles,
        reactiveResettlementCycles,
        reactiveResettlementSignatures,
        actorSignalSequence,
        pages,
        packagers,
        recordUpdateSummary,
        recordProfile,
        resolveSafeCheckpoint,
        restoreSafeCheckpoint,
        reapplyCheckpointState
    } = options;

    if (!observation.geometryChanged || !observation.earliestAffectedFrontier) {
        return {
            settled: false,
            reactiveResettlementCycles
        };
    }

    console.log(
        '[DIAG:settle] geometry detected. frontier sourceId=%s actorIndex=%s cursorY=%s',
        observation.earliestAffectedFrontier.sourceId,
        observation.earliestAffectedFrontier.actorIndex,
        observation.earliestAffectedFrontier.cursorY
    );

    recordUpdateSummary(source, 'geometry', observation.contentOnlyActors, observation.earliestAffectedFrontier);

    const checkpoint = resolveSafeCheckpoint(observation.earliestAffectedFrontier);
    if (!checkpoint) {
        console.log(
            '[DIAG:settle] NO CHECKPOINT FOUND for frontier sourceId=%s actorIndex=%s',
            observation.earliestAffectedFrontier.sourceId,
            observation.earliestAffectedFrontier.actorIndex
        );
        return {
            settled: false,
            reactiveResettlementCycles
        };
    }

    console.log(
        '[DIAG:settle] checkpoint found id=%s actorIndex=%s cursorY=%s â†’ restoring',
        checkpoint.id,
        checkpoint.actorIndex,
        checkpoint.frontier.cursorY
    );

    const signature = buildReactiveResettlementSignature({
        kind: 'observer',
        checkpoint,
        frontier: observation.earliestAffectedFrontier,
        sequenceOrTick: actorSignalSequence
    });

    if (reactiveResettlementSignatures.has(signature)) {
        recordProfile('actorUpdateRepeatedStateDetections', 1);
        throw new Error(
            `[executeSimulationMarch] Reactive geometry oscillation detected at checkpoint "${checkpoint.id}" `
            + `(frontier page=${observation.earliestAffectedFrontier.pageIndex}, cursorY=${Number.isFinite(observation.earliestAffectedFrontier.cursorY) ? Number(observation.earliestAffectedFrontier.cursorY).toFixed(3) : 'na'}, actor=${observation.earliestAffectedFrontier.actorId ?? observation.earliestAffectedFrontier.sourceId ?? 'unknown'}, `
            + `signalSequence=${actorSignalSequence}).`
        );
    }

    if (reactiveResettlementCycles >= maxReactiveResettlementCycles) {
        recordProfile('actorUpdateResettlementCapHits', 1);
        throw new Error(
            `[executeSimulationMarch] Reactive geometry resettlement exceeded the cycle cap `
            + `(${maxReactiveResettlementCycles}) at checkpoint "${checkpoint.id}" `
            + `(frontier page=${observation.earliestAffectedFrontier.pageIndex}, cursorY=${Number.isFinite(observation.earliestAffectedFrontier.cursorY) ? Number(observation.earliestAffectedFrontier.cursorY).toFixed(3) : 'na'}, actor=${observation.earliestAffectedFrontier.actorId ?? observation.earliestAffectedFrontier.sourceId ?? 'unknown'}, `
            + `signalSequence=${actorSignalSequence}).`
        );
    }

    reactiveResettlementSignatures.add(signature);
    const nextReactiveResettlementCycles = reactiveResettlementCycles + 1;

    recordProfile('observerSettleCalls', 1);
    recordProfile('actorUpdateResettlementCycles', 1);
    if (checkpoint.kind === 'actor') {
        recordProfile('observerActorBoundarySettles', 1);
    } else {
        recordProfile('observerPageBoundarySettles', 1);
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

    return {
        settled: true,
        reactiveResettlementCycles: nextReactiveResettlementCycles
    };
}
