import type {
    PageReservationSelector,
    SimulationProgressionConfig,
    SimulationProgressionPolicy,
    SimulationStopReason
} from '../types';
import type { PackagerUnit } from './packagers/packager-types';
import type {
    KernelBranchStateSnapshot,
    SimulationCapturePolicy,
    SimulationCaptureSummary,
    SimulationProgressionSummary,
    SimulationWorldSummary
} from './simulation-report';
import { Kernel } from './kernel';
import type {
    PageCaptureRecord,
    PageCaptureState,
    PageExclusionIntent,
    PageReservationIntent,
    ProgressionStateSnapshot,
    RegionReservation,
    SimulationClockSnapshot,
    SpatialExclusion,
    ViewportDescriptor,
    ViewportRect,
    ViewportTerrain,
    WorldSpace
} from './layout-session-types';

export type SessionWorldRuntimeHost = {
    getCurrentPageIndex(): number;
    getSimulationTickRaw(): number;
    isSimulationProgressionStoppedRaw(): boolean;
    advanceSimulationTickRaw(): number;
    resumeSimulationProgressionClockRaw(): boolean;
    stopSimulationProgressionClockRaw(): boolean;
    captureSimulationClockSnapshotRaw(): SimulationClockSnapshot;
    restoreSimulationClockSnapshotRaw(snapshot: SimulationClockSnapshot): void;
    recordReservationWrite(): void;
    recordProgressionStop(): void;
    recordProgressionResume(): void;
    recordProgressionSnapshot(): void;
};

export class SessionWorldRuntime {
    private readonly pageCaptures = new Map<number, PageCaptureRecord>();
    private simulationProgressionPolicy: SimulationProgressionPolicy = 'until-settled';
    private simulationCapturePolicy: SimulationCapturePolicy = 'settle-immediately';
    private simulationCaptureMaxTicks: number | null = null;
    private simulationStopReason: SimulationStopReason = 'settled';

    constructor(
        private readonly kernel: Kernel,
        private readonly host: SessionWorldRuntimeHost
    ) { }

    resetForSimulation(): void {
        this.pageCaptures.clear();
        this.simulationProgressionPolicy = 'until-settled';
        this.simulationCapturePolicy = 'settle-immediately';
        this.simulationCaptureMaxTicks = null;
        this.simulationStopReason = 'settled';
    }

    publishArtifact(key: string, value: unknown): void {
        this.kernel.publishArtifact(key, value);
    }

    reservePageSpace(reservation: PageReservationIntent, pageIndex: number = this.host.getCurrentPageIndex()): void {
        const selector = reservation.selector ?? 'current';
        if (selector !== 'current' && !this.matchesPageSelector(pageIndex, selector)) {
            return;
        }

        const normalizedHeight = Number.isFinite(reservation.height) ? Math.max(0, Number(reservation.height)) : 0;
        if (!(normalizedHeight > 0)) return;

        const normalized: RegionReservation = {
            ...reservation,
            height: normalizedHeight
        };
        this.kernel.storePageReservation(pageIndex, this.host.getCurrentPageIndex(), normalized);
        this.host.recordReservationWrite();
    }

    getCurrentPageReservations(): readonly RegionReservation[] {
        return this.kernel.getCurrentPageReservations();
    }

    getPageReservations(pageIndex: number): readonly RegionReservation[] {
        return this.kernel.getPageReservations(pageIndex);
    }

    getReservationPageIndices(): readonly number[] {
        return this.kernel.getReservationPageIndices();
    }

    excludePageSpace(exclusion: PageExclusionIntent, pageIndex: number = this.host.getCurrentPageIndex()): void {
        const selector = exclusion.selector ?? 'current';
        if (selector !== 'current' && !this.matchesPageSelector(pageIndex, selector)) {
            return;
        }

        const normalized: SpatialExclusion = {
            ...exclusion,
            x: Number.isFinite(exclusion.x) ? Number(exclusion.x) : 0,
            y: Number.isFinite(exclusion.y) ? Math.max(0, Number(exclusion.y)) : 0,
            w: Number.isFinite(exclusion.w) ? Math.max(0, Number(exclusion.w)) : 0,
            h: Number.isFinite(exclusion.h) ? Math.max(0, Number(exclusion.h)) : 0,
            surface: exclusion.surface === 'world-traversal' ? 'world-traversal' : 'page',
            ...(typeof exclusion.wrap === 'string' ? { wrap: exclusion.wrap } : {}),
            ...(Number.isFinite(exclusion.gap) ? { gap: Math.max(0, Number(exclusion.gap)) } : {}),
            ...(Number.isFinite(exclusion.gapTop) ? { gapTop: Math.max(0, Number(exclusion.gapTop)) } : {}),
            ...(Number.isFinite(exclusion.gapBottom) ? { gapBottom: Math.max(0, Number(exclusion.gapBottom)) } : {}),
            ...(typeof exclusion.shape === 'string' ? { shape: exclusion.shape } : {}),
            ...(typeof exclusion.align === 'string' ? { align: exclusion.align } : {}),
            ...(typeof exclusion.traversalInteraction === 'string' ? { traversalInteraction: exclusion.traversalInteraction } : {}),
            ...(Number.isFinite(exclusion.zIndex) ? { zIndex: Number(exclusion.zIndex) } : {})
        };
        if (!(normalized.w > 0) || !(normalized.h > 0)) return;

        this.kernel.storePageExclusion(pageIndex, this.host.getCurrentPageIndex(), normalized);
    }

    getPageExclusions(pageIndex: number): readonly SpatialExclusion[] {
        return this.kernel.getPageExclusions(pageIndex);
    }

    getWorldTraversalExclusions(pageIndex: number): readonly SpatialExclusion[] {
        return this.kernel.getPageExclusions(pageIndex)
            .filter((exclusion) => exclusion.surface === 'world-traversal');
    }

    getExclusionPageIndices(): readonly number[] {
        return this.kernel.getExclusionPageIndices();
    }

    getSpatialConstraintPageIndices(): readonly number[] {
        return this.kernel.getSpatialConstraintPageIndices();
    }

    recordPageCapture(record: PageCaptureRecord): void {
        this.pageCaptures.set(record.pageIndex, {
            ...record,
            capture: {
                worldSpace: { ...record.capture.worldSpace },
                viewport: {
                    ...record.capture.viewport,
                    contentRect: { ...record.capture.viewport.contentRect },
                    terrain: {
                        ...record.capture.viewport.terrain,
                        margins: { ...record.capture.viewport.terrain.margins },
                        marginBlocks: record.capture.viewport.terrain.marginBlocks.map((block) => ({ ...block })),
                        headerBlock: record.capture.viewport.terrain.headerBlock
                            ? { ...record.capture.viewport.terrain.headerBlock }
                            : null,
                        footerBlock: record.capture.viewport.terrain.footerBlock
                            ? { ...record.capture.viewport.terrain.footerBlock }
                            : null,
                        reservationBlocks: record.capture.viewport.terrain.reservationBlocks.map((block) => ({ ...block })),
                        exclusionBlocks: record.capture.viewport.terrain.exclusionBlocks.map((block) => ({ ...block })),
                        blockedRects: record.capture.viewport.terrain.blockedRects.map((block) => ({ ...block }))
                    }
                }
            }
        });
    }

    getPageCapture(pageIndex: number): PageCaptureRecord | undefined {
        return this.pageCaptures.get(pageIndex);
    }

    getPageCaptures(): readonly PageCaptureRecord[] {
        return Array.from(this.pageCaptures.values()).sort((a, b) => a.pageIndex - b.pageIndex);
    }

    configureSimulationRun(config: Required<SimulationProgressionConfig>): void {
        this.simulationProgressionPolicy = config.policy;
        this.simulationCapturePolicy = config.policy === 'fixed-tick-count'
            ? 'fixed-tick-count'
            : 'settle-immediately';
        this.simulationCaptureMaxTicks = config.policy === 'fixed-tick-count'
            ? Math.max(1, Math.floor(Number(config.maxTicks)))
            : null;
        this.simulationStopReason = 'settled';
    }

    beginSimulationRun(config: Required<SimulationProgressionConfig>): void {
        this.configureSimulationRun(config);
    }

    shouldContinueAfterPaginationFinalized(input: {
        currentTick: number;
        hasActiveSteppedActors: boolean;
    }): boolean {
        const currentTick = Number.isFinite(input.currentTick) ? Math.max(0, Math.floor(input.currentTick)) : 0;
        if (this.simulationProgressionPolicy === 'fixed-tick-count') {
            const maxTicks = Number.isFinite(this.simulationCaptureMaxTicks)
                ? Math.max(1, Math.floor(Number(this.simulationCaptureMaxTicks)))
                : 1;
            if (currentTick < maxTicks) {
                return true;
            }
        }

        return input.hasActiveSteppedActors;
    }

    resolveSimulationStopReason(currentTick: number): SimulationStopReason {
        if (
            this.simulationProgressionPolicy === 'fixed-tick-count'
            && currentTick >= (this.simulationCaptureMaxTicks ?? 0)
        ) {
            return 'fixed-tick-count';
        }
        return 'settled';
    }

    stopSimulationRun(reason: SimulationStopReason): void {
        this.simulationStopReason = reason;
    }

    setSimulationProgressionPolicy(policy: SimulationProgressionPolicy): void {
        this.simulationProgressionPolicy = policy;
    }

    getSimulationProgressionPolicy(): SimulationProgressionPolicy {
        return this.simulationProgressionPolicy;
    }

    setSimulationCapturePolicy(policy: SimulationCapturePolicy, maxTicks: number | null = null): void {
        this.simulationCapturePolicy = policy;
        this.simulationCaptureMaxTicks = Number.isFinite(maxTicks) ? Math.max(1, Math.floor(Number(maxTicks))) : null;
    }

    getSimulationCapturePolicy(): SimulationCapturePolicy {
        return this.simulationCapturePolicy;
    }

    getSimulationCaptureMaxTicks(): number | null {
        return this.simulationCaptureMaxTicks;
    }

    setSimulationStopReason(reason: SimulationStopReason): void {
        this.simulationStopReason = reason;
    }

    getSimulationStopReason(): SimulationStopReason {
        return this.simulationStopReason;
    }

    getCurrentTick(): number {
        return this.host.getSimulationTickRaw();
    }

    advanceSimulationTick(): number {
        return this.host.advanceSimulationTickRaw();
    }

    isSimulationProgressionActive(): boolean {
        return !this.host.isSimulationProgressionStoppedRaw();
    }

    resumeSimulationRun(): boolean {
        return this.host.resumeSimulationProgressionClockRaw();
    }

    stopSimulationRunClock(): boolean {
        return this.host.stopSimulationProgressionClockRaw();
    }

    stopSimulationProgression(reason: SimulationStopReason = 'settled'): boolean {
        if (!this.stopSimulationRunClock()) return false;
        this.stopSimulationRun(reason);
        this.host.recordProgressionStop();
        return true;
    }

    resumeSimulationProgression(): boolean {
        if (!this.resumeSimulationRun()) return false;
        this.setSimulationStopReason('settled');
        this.host.recordProgressionResume();
        return true;
    }

    captureSimulationClockSnapshot(): SimulationClockSnapshot {
        this.host.recordProgressionSnapshot();
        return this.host.captureSimulationClockSnapshotRaw();
    }

    restoreSimulationClockSnapshot(snapshot: SimulationClockSnapshot): void {
        this.host.restoreSimulationClockSnapshotRaw(snapshot);
    }

    captureProgressionStateSnapshot(): ProgressionStateSnapshot {
        return {
            simulationClockSnapshot: this.captureSimulationClockSnapshot()
        };
    }

    restoreProgressionStateSnapshot(snapshot: ProgressionStateSnapshot): void {
        this.restoreSimulationClockSnapshot(snapshot.simulationClockSnapshot);
    }

    preserveCurrentProgressionState<T>(run: () => T): T {
        const current = this.captureProgressionStateSnapshot();
        try {
            return run();
        } finally {
            this.restoreProgressionStateSnapshot(current);
        }
    }

    captureSessionBranchStateSnapshot(actorQueue: readonly PackagerUnit[]): SessionBranchStateSnapshot {
        return {
            ...this.kernel.captureLocalBranchStateSnapshot(actorQueue),
            ...this.captureProgressionStateSnapshot()
        };
    }

    restoreSessionBranchStateSnapshot(
        actorQueue: PackagerUnit[],
        snapshot: SessionBranchStateSnapshot
    ): void {
        this.kernel.restoreLocalBranchStateSnapshot(
            actorQueue,
            snapshot as KernelBranchStateSnapshot
        );
        this.restoreProgressionStateSnapshot(snapshot);
    }

    getSimulationWorldSummary(): SimulationWorldSummary {
        return {
            currentTick: this.getCurrentTick(),
            progressionPolicy: this.simulationProgressionPolicy,
            stopReason: this.simulationStopReason,
            progressionStopped: this.host.isSimulationProgressionStoppedRaw(),
            capturePolicy: this.simulationCapturePolicy,
            captureMaxTicks: this.simulationCaptureMaxTicks,
            pageCaptures: this.getPageCaptures()
        };
    }

    getSimulationProgressionSummary(): SimulationProgressionSummary {
        const world = this.getSimulationWorldSummary();
        return {
            policy: world.progressionPolicy,
            stopReason: world.stopReason,
            captureKind: 'finalized-pages',
            finalTick: world.currentTick,
            progressionStopped: world.progressionStopped
        };
    }

    getSimulationCaptureSummary(): SimulationCaptureSummary {
        const world = this.getSimulationWorldSummary();
        return {
            policy: world.capturePolicy,
            requestedMaxTicks: world.captureMaxTicks,
            captureKind: 'finalized-pages',
            satisfiedBy: world.stopReason,
            capturedAtTick: world.currentTick
        };
    }

    createPageCaptureState(input: {
        pageIndex: number;
        pageWidth: number;
        pageHeight: number;
        margins: { top: number; right: number; bottom: number; left: number };
        headerRect?: ViewportRect | null;
        footerRect?: ViewportRect | null;
    }): PageCaptureState {
        const viewport = this.createViewportDescriptor(input);
        const worldSpace = this.createWorldSpace(input.pageIndex, input.pageWidth, input.pageHeight);
        return {
            worldSpace,
            viewport
        };
    }

    createWorldSpace(pageIndex: number, pageWidth: number, pageHeight: number): WorldSpace {
        const normalizedPageIndex = Number.isFinite(pageIndex) ? Math.max(0, Math.floor(pageIndex)) : 0;
        const normalizedWidth = Number.isFinite(pageWidth) ? Math.max(0, Number(pageWidth)) : 0;
        const normalizedHeight = Number.isFinite(pageHeight) ? Math.max(0, Number(pageHeight)) : 0;
        const worldY = normalizedPageIndex * normalizedHeight;

        return {
            originX: 0,
            originY: 0,
            width: normalizedWidth,
            exploredBottom: worldY + normalizedHeight
        };
    }

    createViewportDescriptor(input: {
        pageIndex: number;
        pageWidth: number;
        pageHeight: number;
        margins: { top: number; right: number; bottom: number; left: number };
        headerRect?: ViewportRect | null;
        footerRect?: ViewportRect | null;
    }): ViewportDescriptor {
        const pageIndex = Number.isFinite(input.pageIndex) ? Math.max(0, Math.floor(input.pageIndex)) : 0;
        const pageWidth = Number.isFinite(input.pageWidth) ? Math.max(0, Number(input.pageWidth)) : 0;
        const pageHeight = Number.isFinite(input.pageHeight) ? Math.max(0, Number(input.pageHeight)) : 0;
        const margins = {
            top: Number.isFinite(input.margins.top) ? Math.max(0, Number(input.margins.top)) : 0,
            right: Number.isFinite(input.margins.right) ? Math.max(0, Number(input.margins.right)) : 0,
            bottom: Number.isFinite(input.margins.bottom) ? Math.max(0, Number(input.margins.bottom)) : 0,
            left: Number.isFinite(input.margins.left) ? Math.max(0, Number(input.margins.left)) : 0
        };
        const terrain = this.createViewportTerrain({
            pageIndex,
            pageWidth,
            pageHeight,
            margins,
            headerRect: input.headerRect ?? null,
            footerRect: input.footerRect ?? null
        });
        const contentRect: ViewportRect = {
            x: margins.left,
            y: margins.top,
            w: Math.max(0, pageWidth - margins.left - margins.right),
            h: Math.max(0, pageHeight - margins.top - margins.bottom)
        };

        return {
            pageIndex,
            worldX: 0,
            worldY: pageIndex * pageHeight,
            width: pageWidth,
            height: pageHeight,
            contentRect,
            terrain
        };
    }

    createViewportTerrain(input: {
        pageIndex: number;
        pageWidth: number;
        pageHeight: number;
        margins: { top: number; right: number; bottom: number; left: number };
        headerRect?: ViewportRect | null;
        footerRect?: ViewportRect | null;
    }): ViewportTerrain {
        const pageIndex = Number.isFinite(input.pageIndex) ? Math.max(0, Math.floor(input.pageIndex)) : 0;
        const pageWidth = Number.isFinite(input.pageWidth) ? Math.max(0, Number(input.pageWidth)) : 0;
        const pageHeight = Number.isFinite(input.pageHeight) ? Math.max(0, Number(input.pageHeight)) : 0;
        const margins = {
            top: Number.isFinite(input.margins.top) ? Math.max(0, Number(input.margins.top)) : 0,
            right: Number.isFinite(input.margins.right) ? Math.max(0, Number(input.margins.right)) : 0,
            bottom: Number.isFinite(input.margins.bottom) ? Math.max(0, Number(input.margins.bottom)) : 0,
            left: Number.isFinite(input.margins.left) ? Math.max(0, Number(input.margins.left)) : 0
        };
        const contentWidth = Math.max(0, pageWidth - margins.left - margins.right);
        const contentHeight = Math.max(0, pageHeight - margins.top - margins.bottom);
        const marginBlocks = this.createMarginBlocks(pageWidth, pageHeight, margins, pageIndex);
        const headerBlock = this.createRectBlock(
            `viewport:header:${pageIndex}`,
            input.headerRect ?? null,
            'viewport-header'
        );
        const footerBlock = this.createRectBlock(
            `viewport:footer:${pageIndex}`,
            input.footerRect ?? null,
            'viewport-footer'
        );
        const reservationBlocks = this.createReservationBlocks(pageIndex, contentWidth, contentHeight, margins);
        const exclusionBlocks = this.getPageExclusions(pageIndex).map((exclusion) => ({
            ...exclusion,
            x: margins.left + exclusion.x,
            y: margins.top + exclusion.y
        }));

        const blockedRects = [
            ...marginBlocks,
            ...(headerBlock ? [headerBlock] : []),
            ...(footerBlock ? [footerBlock] : []),
            ...reservationBlocks,
            ...exclusionBlocks
        ];

        return {
            margins,
            marginBlocks,
            headerBlock,
            footerBlock,
            reservationBlocks,
            exclusionBlocks,
            blockedRects
        };
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

    private createMarginBlocks(
        pageWidth: number,
        pageHeight: number,
        margins: { top: number; right: number; bottom: number; left: number },
        pageIndex: number
    ): SpatialExclusion[] {
        const blocks: SpatialExclusion[] = [];
        if (margins.top > 0) {
            blocks.push({
                id: `viewport:margin-top:${pageIndex}`,
                x: 0,
                y: 0,
                w: pageWidth,
                h: margins.top,
                source: 'viewport-margin'
            });
        }
        if (margins.bottom > 0) {
            blocks.push({
                id: `viewport:margin-bottom:${pageIndex}`,
                x: 0,
                y: Math.max(0, pageHeight - margins.bottom),
                w: pageWidth,
                h: margins.bottom,
                source: 'viewport-margin'
            });
        }
        if (margins.left > 0) {
            blocks.push({
                id: `viewport:margin-left:${pageIndex}`,
                x: 0,
                y: 0,
                w: margins.left,
                h: pageHeight,
                source: 'viewport-margin'
            });
        }
        if (margins.right > 0) {
            blocks.push({
                id: `viewport:margin-right:${pageIndex}`,
                x: Math.max(0, pageWidth - margins.right),
                y: 0,
                w: margins.right,
                h: pageHeight,
                source: 'viewport-margin'
            });
        }
        return blocks;
    }

    private createRectBlock(
        id: string,
        rect: ViewportRect | null | undefined,
        source: string
    ): SpatialExclusion | null {
        if (!rect) return null;
        const x = Number.isFinite(rect.x) ? Math.max(0, Number(rect.x)) : 0;
        const y = Number.isFinite(rect.y) ? Math.max(0, Number(rect.y)) : 0;
        const w = Number.isFinite(rect.w) ? Math.max(0, Number(rect.w)) : 0;
        const h = Number.isFinite(rect.h) ? Math.max(0, Number(rect.h)) : 0;
        if (!(w > 0) || !(h > 0)) return null;
        return { id, x, y, w, h, source };
    }

    private createReservationBlocks(
        pageIndex: number,
        contentWidth: number,
        contentHeight: number,
        margins: { top: number; right: number; bottom: number; left: number }
    ): SpatialExclusion[] {
        const blocks: SpatialExclusion[] = [];
        let occupiedBottom = margins.top + contentHeight;

        for (const reservation of this.getPageReservations(pageIndex)) {
            const height = Number.isFinite(reservation.height) ? Math.max(0, Number(reservation.height)) : 0;
            if (!(height > 0)) continue;
            occupiedBottom = Math.max(margins.top, occupiedBottom - height);
            blocks.push({
                id: `viewport:reservation:${reservation.id}`,
                x: margins.left,
                y: occupiedBottom,
                w: contentWidth,
                h: height,
                source: reservation.source ?? 'viewport-reservation'
            });
        }

        return blocks;
    }
}
