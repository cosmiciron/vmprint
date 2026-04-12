import { runtimePerformance as performance } from '../../../performance';
import type { LayoutProfileMetrics } from '../../../layout/runtime/session/session-profile-types';

export type BoundaryCheckpointKind = 'page' | 'actor';

export type HandleBoundaryCheckpointOptions = {
    previousPageIndex: number;
    previousActorIndex: number;
    currentPageIndex: number;
    currentActorIndex: number;
    checkpointsEnabled: boolean;
    recordProfile: (metric: keyof LayoutProfileMetrics, delta: number) => void;
    recordSafeCheckpoint: (kind: BoundaryCheckpointKind) => void;
    maybeSettleAtCheckpoint: () => boolean;
};

export function handleBoundaryCheckpoint(options: HandleBoundaryCheckpointOptions): boolean {
    const {
        previousPageIndex,
        previousActorIndex,
        currentPageIndex,
        currentActorIndex,
        checkpointsEnabled,
        recordProfile,
        recordSafeCheckpoint,
        maybeSettleAtCheckpoint
    } = options;

    let checkpointKind: BoundaryCheckpointKind | null = null;
    if (currentPageIndex !== previousPageIndex) {
        checkpointKind = 'page';
    } else if (currentActorIndex !== previousActorIndex) {
        checkpointKind = 'actor';
    }

    if (!checkpointKind || !checkpointsEnabled) {
        return false;
    }

    const boundaryStart = performance.now();
    recordProfile('boundaryCheckpointCalls', 1);

    const checkpointRecordStart = performance.now();
    recordProfile('checkpointRecordCalls', 1);
    recordSafeCheckpoint(checkpointKind);
    recordProfile('checkpointRecordMs', performance.now() - checkpointRecordStart);

    const observerBoundaryStart = performance.now();
    recordProfile('observerBoundaryCheckCalls', 1);
    const settled = maybeSettleAtCheckpoint();
    recordProfile('observerBoundaryCheckMs', performance.now() - observerBoundaryStart);
    recordProfile('boundaryCheckpointMs', performance.now() - boundaryStart);
    return settled;
}
