import type { Page, SimulationStopReason } from '../types';
import type { PageCaptureRecord } from './runtime/session/session-state-types';
import type {
    ExternalMessage,
    SimulationDiagnosticSnapshot,
    SimulationRunner,
    SimulationUpdateSummary
} from '../runtime/simulation/types';

export type SimulationLoopScheduler = {
    schedule(callback: (nowMs: number) => void): unknown;
    cancel(handle: unknown): void;
};

export type SimulationLoopSample = {
    tick: number;
    pageCount: number;
    progressionPolicy: ReturnType<SimulationRunner['getProgression']>['policy'];
    stopReason: SimulationStopReason;
    lastUpdate: SimulationUpdateSummary;
    diagnostic: SimulationDiagnosticSnapshot;
    currentPageCaptures: PageCaptureRecord[];
    previousPages: Page[];
    currentPages: Page[];
    interpolationAlpha: number;
    finished: boolean;
};

export type SimulationLoopState = {
    running: boolean;
    tick: number;
    pageCount: number;
    progressionPolicy: ReturnType<SimulationRunner['getProgression']>['policy'];
    stopReason: SimulationStopReason;
    lastUpdate: SimulationUpdateSummary;
    diagnostic: SimulationDiagnosticSnapshot;
    currentPageCaptures: PageCaptureRecord[];
    finished: boolean;
    tickRateHz: number;
    loop: boolean;
};

export type SimulationLoopOptions = {
    tickRateHz: number;
    loop?: boolean;
};

export class SimulationLoop {
    private readonly tickRateHz: number;
    private readonly loop: boolean;
    private readonly runnerDurationSeconds: number;
    private readonly listeners = new Set<(sample: SimulationLoopSample) => void>();
    private runner: SimulationRunner;
    private running = false;
    private handle: unknown = null;
    private lastAnimationAt: number | null = null;
    private kernelAccumulatorMs = 0;
    private timeOffsetSeconds = 0;
    private previousPages: Page[];
    private currentPages: Page[];

    constructor(
        private readonly createRunner: (options: { tickRateHz: number; timeOffsetSeconds?: number }) => SimulationRunner,
        private readonly scheduler: SimulationLoopScheduler,
        private readonly options: SimulationLoopOptions
    ) {
        this.tickRateHz = Math.max(1, Number(options.tickRateHz));
        this.loop = options.loop !== false;
        this.runner = this.createRunner({ tickRateHz: this.tickRateHz, timeOffsetSeconds: 0 });
        const progression = this.runner.getProgression();
        this.runnerDurationSeconds = progression.policy === 'fixed-tick-count'
            ? progression.maxTicks / progression.tickRateHz
            : 0;
        this.materializeInitialRunnerState();
        this.currentPages = this.runner.getCurrentPages();
        this.previousPages = this.currentPages;
    }

    start(): void {
        if (this.running) return;
        this.running = true;
        this.lastAnimationAt = null;
        this.kernelAccumulatorMs = 0;
        this.emitSample(0);
        this.requestNext();
    }

    stop(): void {
        this.running = false;
        if (this.handle !== null) {
            this.scheduler.cancel(this.handle);
            this.handle = null;
        }
    }

    subscribe(listener: (sample: SimulationLoopSample) => void): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    sendExternalMessage(targetSourceId: string, message: ExternalMessage): boolean {
        return this.runner.sendExternalMessage(targetSourceId, message);
    }

    hasExternalMessageAck(messageId: string): boolean {
        return this.runner.hasExternalMessageAck(messageId);
    }

    getState(): SimulationLoopState {
        const progression = this.runner.getProgression();
        return {
            running: this.running,
            tick: this.runner.getCurrentTick(),
            pageCount: this.runner.getCurrentPageCount(),
            progressionPolicy: progression.policy,
            stopReason: this.runner.getSimulationStopReason(),
            lastUpdate: this.runner.getCurrentUpdateSummary(),
            diagnostic: this.runner.getCurrentDiagnosticSnapshot(),
            currentPageCaptures: this.runner.getCurrentPageCaptures(),
            finished: this.runner.isFinished(),
            tickRateHz: this.tickRateHz,
            loop: this.loop
        };
    }

    getCurrentPages(): Page[] {
        return this.currentPages;
    }

    private requestNext(): void {
        this.handle = this.scheduler.schedule((nowMs) => this.step(nowMs));
    }

    private step(nowMs: number): void {
        if (!this.running) return;

        const deltaMs = this.lastAnimationAt === null ? 0 : Math.max(0, nowMs - this.lastAnimationAt);
        this.lastAnimationAt = nowMs;
        this.kernelAccumulatorMs += deltaMs;

        const tickDurationMs = 1000 / this.tickRateHz;
        let advancedAtLeastOnce = false;

        while (this.kernelAccumulatorMs >= tickDurationMs && this.running) {
            this.kernelAccumulatorMs -= tickDurationMs;
            this.previousPages = this.currentPages;
            const advanced = this.runner.advanceTick();
            const nextPages = this.runner.getCurrentPages();

            if (!advanced && this.runner.isFinished()) {
                if (!this.loop) {
                    this.currentPages = nextPages;
                    this.emitSample(1);
                    this.stop();
                    return;
                }
                this.restartRunner();
                this.runner.advanceTick();
                this.currentPages = this.runner.getCurrentPages();
                continue;
            }

            this.currentPages = nextPages;
            advancedAtLeastOnce = true;
        }

        if (advancedAtLeastOnce) {
            const alpha = tickDurationMs > 0
                ? Math.max(0, Math.min(1, this.kernelAccumulatorMs / tickDurationMs))
                : 1;
            this.emitSample(alpha);
        }

        if (!this.running) return;
        this.requestNext();
    }

    private restartRunner(): void {
        this.timeOffsetSeconds += this.runnerDurationSeconds;
        this.runner = this.createRunner({
            tickRateHz: this.tickRateHz,
            timeOffsetSeconds: this.timeOffsetSeconds
        });
        this.materializeInitialRunnerState();
        this.previousPages = this.currentPages;
    }

    private materializeInitialRunnerState(): void {
        if (this.runner.isFinished()) return;
        if (this.runner.getCurrentPages().length > 0) return;
        this.runner.advanceTick();
    }

    private emitSample(interpolationAlpha: number): void {
        const progression = this.runner.getProgression();
        const sample: SimulationLoopSample = {
            tick: this.runner.getCurrentTick(),
            pageCount: this.runner.getCurrentPageCount(),
            progressionPolicy: progression.policy,
            stopReason: this.runner.getSimulationStopReason(),
            lastUpdate: this.runner.getCurrentUpdateSummary(),
            diagnostic: this.runner.getCurrentDiagnosticSnapshot(),
            currentPageCaptures: this.runner.getCurrentPageCaptures(),
            previousPages: this.previousPages,
            currentPages: this.currentPages,
            interpolationAlpha: Math.max(0, Math.min(1, interpolationAlpha)),
            finished: this.runner.isFinished()
        };
        for (const listener of this.listeners) {
            listener(sample);
        }
    }
}
