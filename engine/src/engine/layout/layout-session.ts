import type { Box, Page, PageReservationSelector } from '../types';
import type { EngineRuntime } from '../runtime';
import type { ContinuationArtifacts, FlowBox } from './layout-core-types';
import type { PackagerUnit } from './packagers/packager-types';
import type { KeepWithNextPlan } from './keep-with-next-collaborator';
import type { PackagerContext } from './packagers/packager-types';
import type { PackagerSplitResult } from './packagers/packager-types';
import { LAYOUT_DEFAULTS } from './defaults';
import type {
    SimulationArtifactKey,
    SimulationArtifactMap,
    SimulationArtifacts,
    SimulationReport,
    SimulationReportReader
} from './simulation-report';
import { createSimulationReportReader, simulationArtifactKeys } from './simulation-report';

export type LayoutProfileMetrics = {
    keepWithNextPlanCalls: number;
    keepWithNextPlanMs: number;
    keepWithNextBranchCalls: number;
    keepWithNextBranchMs: number;
    keepWithNextPreparedActors: number;
    keepWithNextEarlyExitCalls: number;
    keepWithNextPrepareByKind: Record<string, { calls: number; ms: number }>;
    reservationCommitProbeCalls: number;
    reservationCommitProbeMs: number;
    reservationConstraintNegotiationCalls: number;
    reservationConstraintNegotiationMs: number;
    reservationConstraintApplications: number;
    reservationWrites: number;
    reservationArtifactMs: number;
    exclusionBlockedCursorCalls: number;
    exclusionBlockedCursorMs: number;
    exclusionBandResolutionCalls: number;
    exclusionBandResolutionMs: number;
    exclusionLaneApplications: number;
};

export type RegionReservation = {
    id: string;
    height: number;
    source?: string;
};

export type PageReservationIntent = RegionReservation & {
    selector?: 'current' | PageReservationSelector;
};

export type SpatialExclusion = {
    id: string;
    x: number;
    y: number;
    w: number;
    h: number;
    source?: string;
};

export type PageExclusionIntent = SpatialExclusion & {
    selector?: 'current' | PageReservationSelector;
};

export type ContentBand = {
    xOffset: number;
    width: number;
};

export type ActiveExclusionBand = {
    exclusions: SpatialExclusion[];
    top: number;
    bottom: number;
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

    resolveBlockedCursorY(cursorY: number): number {
        let resolvedY = Number.isFinite(cursorY) ? Number(cursorY) : 0;
        let advanced = true;

        while (advanced) {
            advanced = false;
            for (const exclusion of this.exclusions) {
                const top = Number.isFinite(exclusion.y) ? Math.max(0, Number(exclusion.y)) : 0;
                const bottom = top + (Number.isFinite(exclusion.h) ? Math.max(0, Number(exclusion.h)) : 0);
                const spansWidth =
                    Number(exclusion.x) <= LAYOUT_DEFAULTS.wrapTolerance &&
                    (Number(exclusion.x) + Number(exclusion.w)) >= (this.availableWidth - LAYOUT_DEFAULTS.wrapTolerance);
                if (!spansWidth) continue;
                if (resolvedY + LAYOUT_DEFAULTS.wrapTolerance < top) continue;
                if (resolvedY >= bottom - LAYOUT_DEFAULTS.wrapTolerance) continue;
                resolvedY = bottom;
                advanced = true;
            }
        }

        return resolvedY;
    }

    resolveActiveContentBand(cursorY: number): ContentBand | null {
        const activeBand = this.resolveActiveExclusionBand(cursorY);
        if (!activeBand) return null;

        let leftInset = 0;
        let rightInset = 0;

        for (const exclusion of activeBand.exclusions) {
            const left = Number.isFinite(exclusion.x) ? Math.max(0, Number(exclusion.x)) : 0;
            const width = Number.isFinite(exclusion.w) ? Math.max(0, Number(exclusion.w)) : 0;
            const right = left + width;

            if (left <= LAYOUT_DEFAULTS.wrapTolerance) {
                leftInset = Math.max(leftInset, right);
            }

            if (right >= this.availableWidth - LAYOUT_DEFAULTS.wrapTolerance) {
                rightInset = Math.max(rightInset, Math.max(0, this.availableWidth - left));
            }
        }

        if (leftInset <= 0 && rightInset <= 0) return null;
        const laneWidth = Math.max(0, this.availableWidth - leftInset - rightInset);
        return {
            xOffset: leftInset,
            width: laneWidth
        };
    }

    resolveActiveExclusionBand(cursorY: number): ActiveExclusionBand | null {
        const resolvedY = Number.isFinite(cursorY) ? Number(cursorY) : 0;
        const activeExclusions: SpatialExclusion[] = [];
        let top = Number.POSITIVE_INFINITY;
        let bottom = 0;

        for (const exclusion of this.exclusions) {
            const exclusionTop = Number.isFinite(exclusion.y) ? Math.max(0, Number(exclusion.y)) : 0;
            const exclusionBottom = exclusionTop + (Number.isFinite(exclusion.h) ? Math.max(0, Number(exclusion.h)) : 0);
            if (resolvedY + LAYOUT_DEFAULTS.wrapTolerance < exclusionTop) continue;
            if (resolvedY >= exclusionBottom - LAYOUT_DEFAULTS.wrapTolerance) continue;

            activeExclusions.push(exclusion);
            top = Math.min(top, exclusionTop);
            bottom = Math.max(bottom, exclusionBottom);
        }

        if (!activeExclusions.length) return null;
        return { exclusions: activeExclusions, top, bottom };
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
    onSimulationComplete?(session: LayoutSession): boolean | void;
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
    readonly profile: LayoutProfileMetrics = {
        keepWithNextPlanCalls: 0,
        keepWithNextPlanMs: 0,
        keepWithNextBranchCalls: 0,
        keepWithNextBranchMs: 0,
        keepWithNextPreparedActors: 0,
        keepWithNextEarlyExitCalls: 0,
        keepWithNextPrepareByKind: {},
        reservationCommitProbeCalls: 0,
        reservationCommitProbeMs: 0,
        reservationConstraintNegotiationCalls: 0,
        reservationConstraintNegotiationMs: 0,
        reservationConstraintApplications: 0,
        reservationWrites: 0,
        reservationArtifactMs: 0,
        exclusionBlockedCursorCalls: 0,
        exclusionBlockedCursorMs: 0,
        exclusionBandResolutionCalls: 0,
        exclusionBandResolutionMs: 0,
        exclusionLaneApplications: 0
    };
    private readonly continuationArtifacts = new Map<string, ContinuationArtifacts>();
    private readonly stagedContinuationActors = new Map<string, PackagerUnit[]>();
    private readonly stagedAfterSplitMarkers = new Map<string, FlowBox[]>();
    private readonly keepWithNextPlans = new Map<string, KeepWithNextPlan>();
    private readonly fragmentTransitions: FragmentTransition[] = [];
    private readonly fragmentTransitionsByActor = new Map<string, FragmentTransition>();
    private readonly fragmentTransitionsBySource = new Map<string, FragmentTransition[]>();
    private readonly pageReservationsByPage = new Map<number, RegionReservation[]>();
    private readonly pageExclusionsByPage = new Map<number, SpatialExclusion[]>();
    private readonly artifacts = new Map<string, unknown>();
    private finalizedPages: Page[] = [];
    private simulationReport?: SimulationReport;
    private simulationReportReader: SimulationReportReader = createSimulationReportReader(undefined);
    private paginationLoopState: PaginationLoopState | null = null;
    private currentPageReservations: RegionReservation[] = [];
    private currentPageExclusions: SpatialExclusion[] = [];

    currentPageIndex = 0;
    currentY = 0;
    currentConstraintField: ConstraintField | null = null;
    currentSurface: PageSurface | null = null;

    constructor(options: LayoutSessionOptions) {
        this.runtime = options.runtime;
        this.collaborators = options.collaborators ?? [];
    }

    notifySimulationStart(): void {
        this.finalizedPages = [];
        this.pageReservationsByPage.clear();
        this.pageExclusionsByPage.clear();
        this.currentPageReservations = [];
        this.currentPageExclusions = [];
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
        this.currentPageReservations = [];
        this.currentPageExclusions = [];
        for (const collaborator of this.collaborators) {
            collaborator.onPageStart?.(pageIndex, this.currentSurface, this);
        }
    }

    notifyConstraintNegotiation(actor: PackagerUnit, constraints: ConstraintField): void {
        this.currentConstraintField = constraints;
        const startedAt = performance.now();
        this.recordProfile('reservationConstraintNegotiationCalls', 1);
        for (const reservation of this.currentPageReservations) {
            constraints.reservations.push({ ...reservation });
            this.recordProfile('reservationConstraintApplications', 1);
        }
        for (const exclusion of this.currentPageExclusions) {
            constraints.exclusions.push({ ...exclusion });
        }
        this.recordProfile('reservationConstraintNegotiationMs', performance.now() - startedAt);
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

        this.finalizedPages = finalizedPages;

        for (const collaborator of this.collaborators) {
            collaborator.onSimulationComplete?.(this);
        }

        this.setSimulationReport(this.buildSimulationReport());

        return finalizedPages;
    }

    // Collaborator-facing artifact publication. Downstream consumers should prefer
    // getSimulationReport() over reading individual artifacts directly.
    publishArtifact<K extends SimulationArtifactKey>(key: K, value: SimulationArtifactMap[K]): void;
    publishArtifact(key: string, value: unknown): void;
    publishArtifact(key: string, value: unknown): void {
        this.artifacts.set(key, value);
    }

    // Report assembly helper. The raw artifact registry remains internal;
    // downstream consumers should read the consolidated simulation report.
    buildSimulationArtifacts(): SimulationArtifacts {
        const artifacts: SimulationArtifacts = {
            fragmentationSummary: this.artifacts.get(simulationArtifactKeys.fragmentationSummary) as SimulationArtifactMap['fragmentationSummary'],
            pageNumberSummary: this.artifacts.get(simulationArtifactKeys.pageNumberSummary) as SimulationArtifactMap['pageNumberSummary'],
            pageOverrideSummary: this.artifacts.get(simulationArtifactKeys.pageOverrideSummary) as SimulationArtifactMap['pageOverrideSummary'],
            pageExclusionSummary: this.artifacts.get(simulationArtifactKeys.pageExclusionSummary) as SimulationArtifactMap['pageExclusionSummary'],
            pageReservationSummary: this.artifacts.get(simulationArtifactKeys.pageReservationSummary) as SimulationArtifactMap['pageReservationSummary'],
            pageSpatialConstraintSummary: this.artifacts.get(simulationArtifactKeys.pageSpatialConstraintSummary) as SimulationArtifactMap['pageSpatialConstraintSummary'],
            pageRegionSummary: this.artifacts.get(simulationArtifactKeys.pageRegionSummary) as SimulationArtifactMap['pageRegionSummary'],
            sourcePositionMap: this.artifacts.get(simulationArtifactKeys.sourcePositionMap) as SimulationArtifactMap['sourcePositionMap']
        };

        for (const [key, value] of this.artifacts.entries()) {
            if (key in artifacts && artifacts[key] !== undefined) continue;
            artifacts[key] = value;
        }

        return artifacts;
    }

    getFinalizedPages(): readonly Page[] {
        return this.finalizedPages;
    }

    reservePageSpace(reservation: PageReservationIntent, pageIndex: number = this.currentPageIndex): void {
        const selector = reservation.selector ?? 'current';
        if (selector !== 'current' && !this.matchesPageReservationSelector(pageIndex, selector)) {
            return;
        }

        const normalizedHeight = Number.isFinite(reservation.height) ? Math.max(0, Number(reservation.height)) : 0;
        if (!(normalizedHeight > 0)) return;

        const normalized: RegionReservation = {
            ...reservation,
            height: normalizedHeight
        };
        if (pageIndex === this.currentPageIndex) {
            this.currentPageReservations.push(normalized);
        }
        const pageReservations = this.pageReservationsByPage.get(pageIndex) ?? [];
        pageReservations.push(normalized);
        this.pageReservationsByPage.set(pageIndex, pageReservations);
        this.recordProfile('reservationWrites', 1);
    }

    reserveCurrentPageSpace(reservation: RegionReservation): void {
        this.reservePageSpace(reservation, this.currentPageIndex);
    }

    getCurrentPageReservations(): readonly RegionReservation[] {
        return this.currentPageReservations;
    }

    getPageReservations(pageIndex: number): readonly RegionReservation[] {
        return this.pageReservationsByPage.get(pageIndex) ?? [];
    }

    getReservationPageIndices(): readonly number[] {
        return Array.from(this.pageReservationsByPage.keys()).sort((a, b) => a - b);
    }

    excludePageSpace(exclusion: PageExclusionIntent, pageIndex: number = this.currentPageIndex): void {
        const selector = exclusion.selector ?? 'current';
        if (selector !== 'current' && !this.matchesPageSelector(pageIndex, selector)) {
            return;
        }

        const normalized: SpatialExclusion = {
            ...exclusion,
            x: Number.isFinite(exclusion.x) ? Number(exclusion.x) : 0,
            y: Number.isFinite(exclusion.y) ? Math.max(0, Number(exclusion.y)) : 0,
            w: Number.isFinite(exclusion.w) ? Math.max(0, Number(exclusion.w)) : 0,
            h: Number.isFinite(exclusion.h) ? Math.max(0, Number(exclusion.h)) : 0
        };
        if (!(normalized.w > 0) || !(normalized.h > 0)) return;

        if (pageIndex === this.currentPageIndex) {
            this.currentPageExclusions.push(normalized);
        }
        const pageExclusions = this.pageExclusionsByPage.get(pageIndex) ?? [];
        pageExclusions.push(normalized);
        this.pageExclusionsByPage.set(pageIndex, pageExclusions);
    }

    getPageExclusions(pageIndex: number): readonly SpatialExclusion[] {
        return this.pageExclusionsByPage.get(pageIndex) ?? [];
    }

    getExclusionPageIndices(): readonly number[] {
        return Array.from(this.pageExclusionsByPage.keys()).sort((a, b) => a - b);
    }

    getSpatialConstraintPageIndices(): readonly number[] {
        return Array.from(new Set([
            ...this.pageReservationsByPage.keys(),
            ...this.pageExclusionsByPage.keys()
        ])).sort((a, b) => a - b);
    }

    matchesPageSelector(pageIndex: number, selector: PageReservationSelector = 'first'): boolean {
        if (!Number.isFinite(pageIndex) || pageIndex < 0) return false;

        switch (selector) {
            case 'all':
                return true;
            case 'odd':
                return pageIndex % 2 === 0;
            case 'even':
                return pageIndex % 2 === 1;
            case 'first':
            default:
                return pageIndex === 0;
        }
    }

    matchesPageReservationSelector(pageIndex: number, selector: PageReservationSelector = 'first'): boolean {
        return this.matchesPageSelector(pageIndex, selector);
    }

    buildSimulationReport(): SimulationReport {
        const pages = this.finalizedPages;
        const generatedBoxCount = pages.reduce((sum, page) => {
            return sum + (page.boxes || []).reduce((pageSum, box) => {
                return pageSum + (box.meta?.generated === true ? 1 : 0);
            }, 0);
        }, 0);

        return {
            pageCount: pages.length,
            actorCount: this.actorRegistry.length,
            splitTransitionCount: this.getFragmentTransitions().length,
            generatedBoxCount,
            profile: {
                ...this.profile,
                keepWithNextPrepareByKind: { ...this.profile.keepWithNextPrepareByKind }
            },
            artifacts: this.buildSimulationArtifacts()
        };
    }

    setSimulationReport(report: SimulationReport): void {
        this.simulationReport = report;
        this.simulationReportReader = createSimulationReportReader(report);
    }

    getSimulationReport(): SimulationReport | undefined {
        return this.simulationReport;
    }

    getSimulationReportReader(): SimulationReportReader {
        return this.simulationReportReader;
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

    getFragmentTransitionSourceIds(): readonly string[] {
        return Array.from(this.fragmentTransitionsBySource.keys());
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
