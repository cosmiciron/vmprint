import type { Box, Page, PageReservationSelector } from '../../../types';
import type { PageRegionSummary } from '../../page-region-summary';
import type { ScriptRegionRef } from '../../script-region-query';
import type { EventDispatcher } from '../../event-dispatcher';
import type {
    LayoutProfileMetrics,
} from '../../layout-session-types';
import type { PageSurface } from './session-lifecycle-types';
import type { CollaboratorHost, PageCaptureStateParams } from './session-runtime-types';
import type { PageCaptureRecord, PageCaptureState, PageFinalizationState } from './session-state-types';
import type { PageExclusionIntent, PageReservationIntent, RegionReservation, SpatialExclusion } from './session-spatial-types';
import type {
    SimulationArtifactKey,
    SimulationArtifactMap,
    SimulationArtifacts,
    SimulationReport,
    SimulationReportReader
} from '../../simulation-report';
import type { SimulationReportBridge } from '../../simulation-report-bridge';
import type { LifecycleRuntime } from '../../lifecycle-runtime';
import type { SessionWorldRuntime } from '../../session-world-runtime';

export type SessionCollaborationRuntimeHost = {
    getCollaboratorHost(): CollaboratorHost;
    getCurrentPageIndex(): number;
    getProfileSnapshot(): LayoutProfileMetrics;
};

export class SessionCollaborationRuntime {
    constructor(
        private readonly eventDispatcher: EventDispatcher,
        private readonly lifecycleRuntime: LifecycleRuntime,
        private readonly sessionWorldRuntime: SessionWorldRuntime,
        private readonly simulationReportBridge: SimulationReportBridge,
        private readonly host: SessionCollaborationRuntimeHost
    ) { }

    finalizeCommittedPage(pageIndex: number, width: number, height: number, boxes: readonly Box[]): Page {
        const surface: PageSurface = {
            pageIndex,
            width,
            height,
            boxes: [...boxes],
            debugRegions: [],
            finalize(): Page {
                return {
                    index: this.pageIndex,
                    width: this.width,
                    height: this.height,
                    boxes: this.boxes,
                    ...(this.debugRegions.length > 0 ? { debugRegions: this.debugRegions.map((region) => ({ ...region })) } : {})
                };
            }
        };
        this.eventDispatcher.onPageFinalized(surface, this.host.getCollaboratorHost());
        const page = surface.finalize();
        this.lifecycleRuntime.recordFinalizedPage(page);
        return page;
    }

    closePagination(
        pages: Page[],
        currentPageBoxes: readonly Box[],
        currentPageIndex: number,
        pageWidth: number,
        pageHeight: number
    ): void {
        this.lifecycleRuntime.closePagination(
            pages,
            currentPageBoxes,
            currentPageIndex,
            pageWidth,
            pageHeight
        );
    }

    finalizePages(pages: Page[]): Page[] {
        this.lifecycleRuntime.setFinalizedPages(pages);
        return this.simulationReportBridge.finalizePages(pages);
    }

    onSimulationComplete(): void {
        this.eventDispatcher.onSimulationComplete(this.host.getCollaboratorHost());
    }

    publishArtifact<K extends SimulationArtifactKey>(key: K, value: SimulationArtifactMap[K]): void;
    publishArtifact(key: string, value: unknown): void;
    publishArtifact(key: string, value: unknown): void {
        this.sessionWorldRuntime.publishArtifact(key, value);
    }

    buildSimulationArtifacts(): SimulationArtifacts {
        return this.simulationReportBridge.buildSimulationArtifacts();
    }

    getFinalizedPages(): readonly Page[] {
        return this.lifecycleRuntime.getFinalizedPages();
    }

    getPageRegionSummaries(): readonly PageRegionSummary[] {
        return this.lifecycleRuntime.getPageRegionSummaries();
    }

    getScriptRegions(): readonly ScriptRegionRef[] {
        return this.lifecycleRuntime.getScriptRegions();
    }

    findScriptRegionByName(name: string): ScriptRegionRef | null {
        return this.lifecycleRuntime.findScriptRegionByName(name);
    }

    recordPageCapture(record: PageCaptureRecord): void {
        this.sessionWorldRuntime.recordPageCapture(record);
    }

    createPageCaptureState(params: PageCaptureStateParams): PageCaptureState {
        return this.sessionWorldRuntime.createPageCaptureState(params);
    }

    getPageCapture(pageIndex: number): PageCaptureRecord | undefined {
        return this.sessionWorldRuntime.getPageCapture(pageIndex);
    }

    getPageCaptures(): readonly PageCaptureRecord[] {
        return this.sessionWorldRuntime.getPageCaptures();
    }

    recordPageFinalization(state: PageFinalizationState): void {
        this.lifecycleRuntime.recordPageFinalization(state);
    }

    resetLogicalPageNumbering(startAt: number): void {
        this.lifecycleRuntime.resetLogicalPageNumbering(startAt);
    }

    allocateLogicalPageNumber(usesLogicalNumbering: boolean): number | null {
        return this.lifecycleRuntime.allocateLogicalPageNumber(usesLogicalNumbering);
    }

    getPageFinalizationState(pageIndex: number): PageFinalizationState | undefined {
        return this.lifecycleRuntime.getPageFinalizationState(pageIndex);
    }

    getPageFinalizationStates(): readonly PageFinalizationState[] {
        return this.lifecycleRuntime.getPageFinalizationStates();
    }

    reservePageSpace(reservation: PageReservationIntent, pageIndex: number = this.host.getCurrentPageIndex()): void {
        this.sessionWorldRuntime.reservePageSpace(reservation, pageIndex);
    }

    reserveCurrentPageSpace(reservation: RegionReservation): void {
        this.sessionWorldRuntime.reservePageSpace(reservation, this.host.getCurrentPageIndex());
    }

    getCurrentPageReservations(): readonly RegionReservation[] {
        return this.sessionWorldRuntime.getCurrentPageReservations();
    }

    getPageReservations(pageIndex: number): readonly RegionReservation[] {
        return this.sessionWorldRuntime.getPageReservations(pageIndex);
    }

    getReservationPageIndices(): readonly number[] {
        return this.sessionWorldRuntime.getReservationPageIndices();
    }

    excludePageSpace(exclusion: PageExclusionIntent, pageIndex: number = this.host.getCurrentPageIndex()): void {
        this.sessionWorldRuntime.excludePageSpace(exclusion, pageIndex);
    }

    getPageExclusions(pageIndex: number): readonly SpatialExclusion[] {
        return this.sessionWorldRuntime.getPageExclusions(pageIndex);
    }

    getWorldTraversalExclusions(pageIndex: number): readonly SpatialExclusion[] {
        return this.sessionWorldRuntime.getWorldTraversalExclusions(pageIndex);
    }

    getExclusionPageIndices(): readonly number[] {
        return this.sessionWorldRuntime.getExclusionPageIndices();
    }

    getSpatialConstraintPageIndices(): readonly number[] {
        return this.sessionWorldRuntime.getSpatialConstraintPageIndices();
    }

    matchesPageSelector(pageIndex: number, selector: PageReservationSelector = 'first'): boolean {
        return this.sessionWorldRuntime.matchesPageSelector(pageIndex, selector);
    }

    matchesPageReservationSelector(pageIndex: number, selector: PageReservationSelector = 'first'): boolean {
        return this.matchesPageSelector(pageIndex, selector);
    }

    buildSimulationReport(): SimulationReport {
        return this.simulationReportBridge.buildSimulationReport();
    }

    setSimulationReport(report: SimulationReport): void {
        this.simulationReportBridge.setSimulationReport(report);
    }

    getSimulationReport(): SimulationReport | undefined {
        return this.simulationReportBridge.getSimulationReport();
    }

    getSimulationReportReader(): SimulationReportReader {
        return this.simulationReportBridge.getSimulationReportReader();
    }

    getProfileSnapshot(): LayoutProfileMetrics {
        return this.host.getProfileSnapshot();
    }
}
