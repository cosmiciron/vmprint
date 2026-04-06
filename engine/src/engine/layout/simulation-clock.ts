import type { SimulationClockSnapshot, SimulationTick } from './runtime/session/session-progression-types';

export class SimulationClock {
    private currentTick: SimulationTick = 0;
    private stopped = false;

    get tick(): SimulationTick {
        return this.currentTick;
    }

    get isStopped(): boolean {
        return this.stopped;
    }

    advance(): SimulationTick {
        if (this.stopped) {
            return this.currentTick;
        }
        this.currentTick += 1;
        return this.currentTick;
    }

    stop(): void {
        this.stopped = true;
    }

    resume(): void {
        this.stopped = false;
    }

    captureSnapshot(): SimulationClockSnapshot {
        return {
            tick: this.currentTick
        };
    }

    restoreSnapshot(snapshot: SimulationClockSnapshot): void {
        this.currentTick = Number.isFinite(snapshot.tick) ? Math.max(0, Math.floor(snapshot.tick)) : 0;
    }
}
