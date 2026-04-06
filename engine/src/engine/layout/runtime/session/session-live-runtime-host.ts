import type { ActorSignal, ActorSignalDraft } from '../../actor-event-bus';
import type { PaginationLoopState } from './session-lifecycle-types';

export type SessionLiveRuntimeHostDeps = {
    publishResolvedSignal(signal: ActorSignalDraft): ActorSignal;
    getCurrentPageIndex(): number;
    getCurrentCursorY(): number;
    getCurrentSurfaceHeight(): number | null;
    getSimulationTick(): number;
    getPaginationLoopState(): PaginationLoopState | null;
};

export class SessionLiveRuntimeHost {
    constructor(private readonly deps: SessionLiveRuntimeHostDeps) { }

    publishActorSignal(signal: ActorSignalDraft): ActorSignal {
        const resolvedPageIndex = Number.isFinite(signal.pageIndex)
            ? Number(signal.pageIndex)
            : this.deps.getCurrentPageIndex();
        const currentPageIndex = this.deps.getCurrentPageIndex();
        const resolvedCursorY = Number.isFinite(signal.cursorY)
            ? Number(signal.cursorY)
            : (!Number.isFinite(signal.pageIndex) || resolvedPageIndex === currentPageIndex)
                ? this.deps.getCurrentCursorY()
                : undefined;
        const currentSurfaceHeight = this.deps.getCurrentSurfaceHeight();
        const resolvedWorldY = Number.isFinite(signal.worldY)
            ? Number(signal.worldY)
            : (Number.isFinite(resolvedCursorY) && Number.isFinite(currentSurfaceHeight) && resolvedPageIndex === currentPageIndex)
                ? Math.max(0, resolvedPageIndex * Number(currentSurfaceHeight) + Number(resolvedCursorY))
                : undefined;
        return this.deps.publishResolvedSignal({
            ...signal,
            pageIndex: resolvedPageIndex,
            ...(Number.isFinite(resolvedCursorY) ? { cursorY: Number(resolvedCursorY) } : {}),
            ...(Number.isFinite(resolvedWorldY) ? { worldY: Number(resolvedWorldY) } : {}),
            tick: this.deps.getSimulationTick()
        });
    }

    getPaginationLoopState(): PaginationLoopState | null {
        return this.deps.getPaginationLoopState();
    }
}
