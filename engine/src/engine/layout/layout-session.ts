import type { Box, Page } from '../types';
import type { EngineRuntime } from '../runtime';
import type { ContinuationArtifacts, FlowBox } from './layout-core-types';
import type { PackagerUnit } from './packagers/packager-types';
import type { KeepWithNextPlan } from './keep-with-next-collaborator';
import type { PackagerContext } from './packagers/packager-types';
import type { PackagerSplitResult } from './packagers/packager-types';
import type { SimulationReport } from './simulation-report';

export type LayoutProfileMetrics = {
    keepWithNextPlanCalls: number;
    keepWithNextPlanMs: number;
    keepWithNextBranchCalls: number;
    keepWithNextBranchMs: number;
    keepWithNextPreparedActors: number;
    keepWithNextEarlyExitCalls: number;
    keepWithNextPrepareByKind: Record<string, { calls: number; ms: number }>;
};

export type RegionReservation = {
    id: string;
    height: number;
    source?: string;
};

export type SpatialExclusion = {
    id: string;
    x: number;
    y: number;
    w: number;
    h: number;
    source?: string;
};

export class ConstraintField {
    readonly reservations: RegionReservation[] = [];
    readonly exclusions: SpatialExclusion[] = [];

    constructor(
        public availableWidth: number,
        public availableHeight: number
    ) { }

    get effectiveAvailableHeight(): number {
        const reserved = this.reservations.reduce((sum, reservation) => {
            const height = Number.isFinite(reservation.height) ? Math.max(0, Number(reservation.height)) : 0;
            return sum + height;
        }, 0);
        return Math.max(0, this.availableHeight - reserved);
    }
}

export class PageSurface {
    constructor(
        public readonly pageIndex: number,
        public readonly width: number,
        public readonly height: number,
        public readonly boxes: Box[]
    ) { }

    finalize(): Page {
        return {
            index: this.pageIndex,
            width: this.width,
            height: this.height,
            boxes: this.boxes
        };
    }
}

export type SplitAttempt = {
    actor: PackagerUnit;
    availableWidth: number;
    availableHeight: number;
    context: PackagerContext;
};

export type FragmentTransition = {
    predecessorActorId: string;
    currentFragmentActorId: string | null;
    continuationActorId: string | null;
    sourceActorId: string;
    pageIndex: number;
    availableWidth: number;
    availableHeight: number;
    continuationEnqueued: boolean;
};

export interface LayoutCollaborator {
    onSimulationStart?(session: LayoutSession): void;
    onActorSpawn?(actor: PackagerUnit, session: LayoutSession): void;
    onPageStart?(pageIndex: number, surface: PageSurface, session: LayoutSession): void;
    onConstraintNegotiation?(actor: PackagerUnit, constraints: ConstraintField, session: LayoutSession): void;
    onActorPrepared?(actor: PackagerUnit, session: LayoutSession): void;
    onSplitAttempt?(attempt: SplitAttempt, session: LayoutSession): void;
    onSplitAccepted?(attempt: SplitAttempt, result: PackagerSplitResult, session: LayoutSession): void;
    onContinuationEnqueued?(predecessor: PackagerUnit, successor: PackagerUnit, session: LayoutSession): void;
    onActorCommitted?(actor: PackagerUnit, committed: Box[], surface: PageSurface, session: LayoutSession): void;
    onContinuationProduced?(predecessor: PackagerUnit, successor: PackagerUnit, session: LayoutSession): void;
    onPageFinalized?(surface: PageSurface, session: LayoutSession): void;
    onSimulationComplete?(pages: Page[], session: LayoutSession): boolean | void;
}

export type PaginationLoopState = {
    actorQueue: PackagerUnit[];
    actorIndex: number;
    availableWidth: number;
    availableHeight: number;
    lastSpacingAfter: number;
    isAtPageTop: boolean;
    context: PackagerContext;
};

type LayoutSessionOptions = {
    runtime: EngineRuntime;
    collaborators?: readonly LayoutCollaborator[];
};

export class LayoutSession {
    readonly runtime: EngineRuntime;
    readonly collaborators: readonly LayoutCollaborator[];
    readonly actorRegistry: PackagerUnit[] = [];
    readonly telemetry = new Map<string, unknown>();
    readonly profile: LayoutProfileMetrics = {
        keepWithNextPlanCalls: 0,
        keepWithNextPlanMs: 0,
        keepWithNextBranchCalls: 0,
        keepWithNextBranchMs: 0,
        keepWithNextPreparedActors: 0,
        keepWithNextEarlyExitCalls: 0,
        keepWithNextPrepareByKind: {}
    };
    private readonly continuationArtifacts = new Map<string, ContinuationArtifacts>();
    private readonly stagedContinuationActors = new Map<string, PackagerUnit[]>();
    private readonly stagedAfterSplitMarkers = new Map<string, FlowBox[]>();
    private readonly keepWithNextPlans = new Map<string, KeepWithNextPlan>();
    private readonly fragmentTransitions: FragmentTransition[] = [];
    private readonly fragmentTransitionsByActor = new Map<string, FragmentTransition>();
    private readonly fragmentTransitionsBySource = new Map<string, FragmentTransition[]>();
    private simulationReport?: SimulationReport;
    private paginationLoopState: PaginationLoopState | null = null;

    currentPageIndex = 0;
    currentY = 0;
    currentConstraintField: ConstraintField | null = null;
    currentSurface: PageSurface | null = null;

    constructor(options: LayoutSessionOptions) {
        this.runtime = options.runtime;
        this.collaborators = options.collaborators ?? [];
    }

    notifySimulationStart(): void {
        for (const collaborator of this.collaborators) {
            collaborator.onSimulationStart?.(this);
        }
    }

    notifyActorSpawn(actor: PackagerUnit): void {
        this.actorRegistry.push(actor);
        for (const collaborator of this.collaborators) {
            collaborator.onActorSpawn?.(actor, this);
        }
    }

    notifyPageStart(pageIndex: number, width: number, height: number, boxes: Box[]): void {
        this.currentPageIndex = pageIndex;
        this.currentSurface = new PageSurface(pageIndex, width, height, boxes);
        for (const collaborator of this.collaborators) {
            collaborator.onPageStart?.(pageIndex, this.currentSurface, this);
        }
    }

    notifyConstraintNegotiation(actor: PackagerUnit, constraints: ConstraintField): void {
        this.currentConstraintField = constraints;
        for (const collaborator of this.collaborators) {
            collaborator.onConstraintNegotiation?.(actor, constraints, this);
        }
    }

    notifyActorPrepared(actor: PackagerUnit): void {
        for (const collaborator of this.collaborators) {
            collaborator.onActorPrepared?.(actor, this);
        }
    }

    notifySplitAttempt(attempt: SplitAttempt): void {
        for (const collaborator of this.collaborators) {
            collaborator.onSplitAttempt?.(attempt, this);
        }
    }

    notifySplitAccepted(attempt: SplitAttempt, result: PackagerSplitResult): void {
        const transition: FragmentTransition = {
            predecessorActorId: attempt.actor.actorId,
            currentFragmentActorId: result.currentFragment?.actorId ?? null,
            continuationActorId: result.continuationFragment?.actorId ?? null,
            sourceActorId: attempt.actor.sourceId,
            pageIndex: attempt.context.pageIndex,
            availableWidth: attempt.availableWidth,
            availableHeight: attempt.availableHeight,
            continuationEnqueued: false
        };
        this.fragmentTransitions.push(transition);
        this.fragmentTransitionsByActor.set(attempt.actor.actorId, transition);
        const sourceTransitions = this.fragmentTransitionsBySource.get(transition.sourceActorId) ?? [];
        sourceTransitions.push(transition);
        this.fragmentTransitionsBySource.set(transition.sourceActorId, sourceTransitions);
        if (result.currentFragment) {
            this.fragmentTransitionsByActor.set(result.currentFragment.actorId, transition);
        }
        if (result.continuationFragment) {
            this.fragmentTransitionsByActor.set(result.continuationFragment.actorId, transition);
        }
        for (const collaborator of this.collaborators) {
            collaborator.onSplitAccepted?.(attempt, result, this);
        }
    }

    notifyActorCommitted(actor: PackagerUnit, committed: Box[]): void {
        if (!this.currentSurface) return;
        for (const collaborator of this.collaborators) {
            collaborator.onActorCommitted?.(actor, committed, this.currentSurface, this);
        }
    }

    notifyContinuationProduced(predecessor: PackagerUnit, successor: PackagerUnit): void {
        this.actorRegistry.push(successor);
        for (const collaborator of this.collaborators) {
            collaborator.onContinuationProduced?.(predecessor, successor, this);
        }
    }

    notifyContinuationEnqueued(predecessor: PackagerUnit, successor: PackagerUnit): void {
        this.actorRegistry.push(successor);
        const transition = this.fragmentTransitionsByActor.get(successor.actorId)
            ?? this.fragmentTransitionsByActor.get(predecessor.actorId);
        if (transition) {
            transition.continuationEnqueued = true;
        }
        for (const collaborator of this.collaborators) {
            collaborator.onContinuationEnqueued?.(predecessor, successor, this);
            collaborator.onContinuationProduced?.(predecessor, successor, this);
        }
    }

    finalizePages(pages: Page[]): Page[] {
        const finalizedPages = pages.map((page) => {
            const surface = new PageSurface(page.index, page.width, page.height, [...page.boxes]);
            for (const collaborator of this.collaborators) {
                collaborator.onPageFinalized?.(surface, this);
            }
            return surface.finalize();
        });

        for (const collaborator of this.collaborators) {
            collaborator.onSimulationComplete?.(finalizedPages, this);
        }

        return finalizedPages;
    }

    setTelemetry<T>(key: string, value: T): void {
        this.telemetry.set(key, value);
    }

    getTelemetry<T>(key: string): T | undefined {
        return this.telemetry.get(key) as T | undefined;
    }

    getTelemetrySnapshot(): Record<string, unknown> {
        return Object.fromEntries(this.telemetry.entries());
    }

    setSimulationReport(report: SimulationReport): void {
        this.simulationReport = report;
        this.telemetry.set('simulationReport', report);
    }

    getSimulationReport(): SimulationReport | undefined {
        return this.simulationReport;
    }

    setContinuationArtifacts(actorId: string, artifacts: ContinuationArtifacts): void {
        this.continuationArtifacts.set(actorId, artifacts);
    }

    getContinuationArtifacts(actorId: string): ContinuationArtifacts | undefined {
        return this.continuationArtifacts.get(actorId);
    }

    stageActorsBeforeContinuation(continuationActorId: string, actors: PackagerUnit[]): void {
        if (!actors.length) return;
        this.stagedContinuationActors.set(continuationActorId, actors);
        for (const actor of actors) {
            this.notifyActorSpawn(actor);
        }
    }

    consumeActorsBeforeContinuation(continuationActorId: string): PackagerUnit[] {
        const actors = this.stagedContinuationActors.get(continuationActorId) ?? [];
        this.stagedContinuationActors.delete(continuationActorId);
        return actors;
    }

    stageMarkersAfterSplit(fragmentActorId: string, markers: FlowBox[]): void {
        if (!markers.length) return;
        this.stagedAfterSplitMarkers.set(fragmentActorId, markers);
    }

    consumeMarkersAfterSplit(fragmentActorId: string): FlowBox[] {
        const markers = this.stagedAfterSplitMarkers.get(fragmentActorId) ?? [];
        this.stagedAfterSplitMarkers.delete(fragmentActorId);
        return markers;
    }

    setKeepWithNextPlan(actorId: string, plan: KeepWithNextPlan): void {
        this.keepWithNextPlans.set(actorId, plan);
    }

    getKeepWithNextPlan(actorId: string): KeepWithNextPlan | undefined {
        return this.keepWithNextPlans.get(actorId);
    }

    setPaginationLoopState(state: PaginationLoopState): void {
        this.paginationLoopState = state;
    }

    getPaginationLoopState(): PaginationLoopState | null {
        return this.paginationLoopState;
    }

    getFragmentTransitions(): readonly FragmentTransition[] {
        return this.fragmentTransitions;
    }

    getFragmentTransition(actorId: string): FragmentTransition | undefined {
        return this.fragmentTransitionsByActor.get(actorId);
    }

    getFragmentTransitionsBySource(sourceActorId: string): readonly FragmentTransition[] {
        return this.fragmentTransitionsBySource.get(sourceActorId) ?? [];
    }

    recordProfile(metric: keyof LayoutProfileMetrics, delta: number): void {
        const value = Number.isFinite(delta) ? Number(delta) : 0;
        if (typeof this.profile[metric] === 'number') {
            (this.profile[metric] as number) += value;
        }
    }

    recordKeepWithNextPrepare(actorKind: string, durationMs: number): void {
        const normalizedKind = actorKind || 'unknown';
        const entry = this.profile.keepWithNextPrepareByKind[normalizedKind] ?? { calls: 0, ms: 0 };
        entry.calls += 1;
        entry.ms += Number.isFinite(durationMs) ? Number(durationMs) : 0;
        this.profile.keepWithNextPrepareByKind[normalizedKind] = entry;
    }
}
