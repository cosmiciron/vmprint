import { runtimePerformance as performance } from '../../../performance';
import { areSafeCheckpointsEnabled, getReactiveResettlementCycleCap } from '../../../runtime-flags';
import { Box, Page, type SimulationStopReason } from '../../../types';
import { LayoutProcessor } from '../../../layout/layout-core';
import type { FlowBox } from '../../../layout/layout-core-types';
import { LayoutSession } from '../../../layout/layout-session';
import { PageSurface, type PaginationState } from '../../../layout/runtime/session/session-lifecycle-types';
import type { PageCaptureRecord } from '../../../layout/runtime/session/session-state-types';
import type { PaginationLoopAction } from '../../../layout/runtime/session/session-pagination-types';
import { ChunkAdvanceStopped } from '../../../layout/chunk-policy';
import { PackagerContext, type PackagerUnit, type LayoutBox, type SpatialFrontier } from '../../../layout/packagers/packager-types';
import { createScriptMessageAckTopic, createScriptMessageTopic, LayoutUtils } from '../../../layout/layout-utils';
import { handleBoundaryCheckpoint } from '../core/boundary-checkpoints';
import { reapplyCheckpointState } from '../core/checkpoints';
import { applyContentOnlyObservation } from '../core/content-updates';
import { settleObserverGeometryAtCheckpoint } from '../core/observer-settlement';
import {
    capturePageCaptureRevisions,
    capturePageTokens,
    computeChangedPageIndexes,
    computePageTokenChanges,
    normalizeUpdateSummary,
    updateSummaryWithChangedPages
} from '../core/page-snapshots';
import { applySteppedGeometryUpdate } from '../core/stepped-actor-updates';
import { accumulateUpdateSummary, createEmptyUpdateSummary } from '../core/update-summary';
import { collectDiagnosticSources } from '../tooling/diagnostics';
import { clonePage } from '../tooling/pages';
import type {
    ExternalMessage,
    SimulationContinueOptions,
    SimulationContinueResult,
    SimulationDiagnosticSnapshot,
    SimulationRunner,
    SimulationUpdateSource,
    SimulationUpdateSummary
} from '../types';

type ContinueTickOptions = SimulationContinueOptions & {
    cooperativeContinue?: boolean;
    startedAt?: number;
};

type FlowBoxPositioner = LayoutProcessor & {
    positionFlowBox(
        flowBox: FlowBox,
        currentY: number,
        layoutBefore: number,
        margins: PackagerContext['margins'],
        availableWidth: number,
        pageIndex: number
    ): Box | Box[];
};

const CONTINUOUS_PUBLICATION_PAGE_HEIGHT = 10_000_000;

export class SimulationMarchRunner implements SimulationRunner {
    private readonly progression: ReturnType<LayoutProcessor['getSimulationProgressionConfig']>;
    private readonly maxReactiveResettlementCycles: number;
    private readonly snapshotsEnabled: boolean;
    private readonly positionFlowBox: FlowBoxPositioner['positionFlowBox'];
    private readonly pages: Page[] = [];
    private currentPageBoxes: LayoutBox[] = [];
    private currentPageIndex = 0;
    private actorIndex = 0;
    private reactiveResettlementCycles = 0;
    private readonly reactiveResettlementSignatures = new Set<string>();
    private initialPlacementPass = true;
    private finalizedPageInCurrentIteration = false;
    private initialPaginationComplete = false;
    private margins: PackagerContext['margins'];
    private pageWidth: number;
    private pageHeight: number;
    private currentY: number;
    private lastSpacingAfter = 0;
    private readonly paginationState: PaginationState;
    private pageLimit: number;
    private finished = false;
    private lastRenderRevisionPageIndexes: number[] = [];
    private lastUpdateSummary: SimulationUpdateSummary = createEmptyUpdateSummary();
    private pendingGeometryUpdateSummary: SimulationUpdateSummary | null = null;

    private get isContinuousPublication(): boolean {
        return this.contextBase.publicationMode === 'continuous';
    }

    constructor(
        private readonly processor: LayoutProcessor,
        private readonly packagers: PackagerUnit[],
        private readonly contextBase: Omit<PackagerContext, 'pageIndex' | 'cursorY'>,
        private readonly session: LayoutSession,
        progressionOverride?: ReturnType<LayoutProcessor['getSimulationProgressionConfig']>
    ) {
        this.progression = progressionOverride ?? this.processor.getSimulationProgressionConfig();
        this.maxReactiveResettlementCycles = getReactiveResettlementCycleCap();
        this.snapshotsEnabled = areSafeCheckpointsEnabled();
        this.positionFlowBox = (this.processor as FlowBoxPositioner).positionFlowBox.bind(this.processor);
        const initialGeometry = this.resolvePageGeometry(0);
        this.pageWidth = initialGeometry.width;
        this.pageHeight = initialGeometry.height;
        this.margins = initialGeometry.margins;
        this.currentY = this.margins.top;
        this.paginationState = {
            currentPageIndex: this.currentPageIndex,
            currentPageBoxes: this.currentPageBoxes,
            currentY: this.currentY,
            lastSpacingAfter: this.lastSpacingAfter
        };
        this.pageLimit = this.pageHeight - this.margins.bottom;
        this.session.beginSimulationRun(this.progression);
        this.session.notifyPageStart(this.currentPageIndex, this.pageWidth, this.pageHeight, this.currentPageBoxes);
        if (this.reactiveCheckpointsEnabled()) {
            this.session.recordSafeCheckpoint(
                this.packagers,
                this.actorIndex,
                this.pages,
                this.currentPageBoxes,
                this.currentPageIndex,
                this.currentY,
                this.pageHeight,
                this.lastSpacingAfter,
                'page'
            );
        }
    }

    getCurrentTick(): number {
        return this.session.getSimulationTick();
    }

    getCurrentPageIndex(): number {
        return this.currentPageIndex;
    }

    getCurrentPageCount(): number {
        return this.pages.length + ((this.finished || this.currentPageBoxes.length === 0) ? 0 : 1);
    }

    getProgression(): ReturnType<LayoutProcessor['getSimulationProgressionConfig']> {
        return { ...this.progression };
    }

    getCurrentUpdateSummary(): SimulationUpdateSummary {
        return {
            kind: this.lastUpdateSummary.kind,
            source: this.lastUpdateSummary.source,
            actorIds: [...this.lastUpdateSummary.actorIds],
            sourceIds: [...this.lastUpdateSummary.sourceIds],
            pageIndexes: [...this.lastUpdateSummary.pageIndexes],
            addedPageIndexes: [...this.lastUpdateSummary.addedPageIndexes],
            removedPageIndexes: [...this.lastUpdateSummary.removedPageIndexes],
            replayFrontier: this.lastUpdateSummary.replayFrontier
                ? { ...this.lastUpdateSummary.replayFrontier }
                : null
        };
    }

    getCurrentDiagnosticSnapshot(): SimulationDiagnosticSnapshot {
        const profile = this.session.getProfileSnapshot();
        return {
            tick: this.getCurrentTick(),
            pageCount: this.getCurrentPageCount(),
            progressionPolicy: this.progression.policy,
            stopReason: this.getSimulationStopReason(),
            lastUpdate: this.getCurrentUpdateSummary(),
            renderRevisionPageIndexes: [...this.lastRenderRevisionPageIndexes],
            namedSources: collectDiagnosticSources(this.session.getRegisteredActors()),
            profile: {
                simulationTickCount: profile.simulationTickCount,
                setContentCalls: profile.setContentCalls,
                messageSendCalls: profile.messageSendCalls,
                messageHandlerCalls: profile.messageHandlerCalls,
                actorUpdateContentOnlyCalls: profile.actorUpdateContentOnlyCalls,
                actorUpdateGeometryCalls: profile.actorUpdateGeometryCalls,
                actorUpdateNoopCalls: profile.actorUpdateNoopCalls
            }
        };
    }

    getCurrentPageCaptures(): PageCaptureRecord[] {
        return this.session.getPageCaptures().map((record) => ({
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
        }));
    }

    getSimulationStopReason(): SimulationStopReason {
        return this.session.getSimulationStopReason();
    }

    isFinished(): boolean {
        return this.finished;
    }

    getCurrentPages(): Page[] {
        if (!this.initialPaginationComplete) {
            const livePages = [...this.pages];
            if (!this.finished && this.currentPageBoxes.length > 0) {
                livePages.push(new PageSurface(
                    this.currentPageIndex,
                    this.pageWidth,
                    this.resolveCurrentPublicationPageHeight(),
                    this.currentPageBoxes
                ).finalize());
            }
            return livePages;
        }

        const snapshot = this.pages.map((page) => clonePage(page));
        if (this.finished || this.currentPageBoxes.length === 0) {
            return snapshot;
        }
        snapshot.push(new PageSurface(
            this.currentPageIndex,
            this.pageWidth,
            this.resolveCurrentPublicationPageHeight(),
            this.currentPageBoxes.map((box) => ({
                ...box,
                properties: box.properties ? { ...box.properties } : box.properties,
                meta: box.meta ? { ...box.meta } : box.meta
            }))
        ).finalize());
        return snapshot;
    }

    runToCompletion(): Page[] {
        while (!this.isFinished()) {
            try {
                this.advanceTick();
            } catch (error) {
                if (!(error instanceof ChunkAdvanceStopped)) {
                    throw error;
                }
                this.session.stopSimulationProgression('page-limit');
                this.currentPageBoxes = [];
                this.paginationState.currentPageBoxes = this.currentPageBoxes;
                this.finished = true;
            }
        }
        return this.pages;
    }

    sendExternalMessage(targetSourceId: string, message: ExternalMessage): boolean {
        const normalizedId = LayoutUtils.normalizeAuthorSourceId(targetSourceId) ?? targetSourceId;
        const actors = this.session.getRegisteredActors();
        const found = actors.some((actor) => actor.sourceId === normalizedId);
        if (!found) return false;
        this.session.publishActorSignal({
            topic: createScriptMessageTopic(targetSourceId),
            publisherActorId: 'host:external',
            publisherSourceId: 'host:external',
            publisherActorKind: 'host',
            fragmentIndex: 0,
            payload: {
                subject: message.subject,
                payload: message.payload,
                from: message.sender ?? 'host',
                to: targetSourceId,
                __vmcanvasMessageId: typeof message.meta?.messageId === 'string'
                    ? message.meta.messageId
                    : undefined
            }
        });
        return true;
    }

    hasExternalMessageAck(messageId: string): boolean {
        const normalizedId = String(messageId || '').trim();
        if (!normalizedId) return false;
        return this.session.getActorSignals(createScriptMessageAckTopic(normalizedId)).length > 0;
    }

    advanceTick(): boolean {
        return this.advanceTickInternal().hasMore;
    }

    continueUntil(options: SimulationContinueOptions = {}): SimulationContinueResult {
        const startedAt = performance.now();
        if (this.finished) {
            return {
                yielded: false,
                finished: true,
                pageCount: this.getCurrentPageCount(),
                currentPageIndex: this.currentPageIndex,
                reason: 'already-finished',
                elapsedMs: 0
            };
        }
        const result = this.advanceTickInternal({
            ...options,
            cooperativeContinue: true,
            startedAt
        });
        return {
            yielded: result.yielded,
            finished: this.finished,
            pageCount: this.getCurrentPageCount(),
            currentPageIndex: this.currentPageIndex,
            reason: result.reason,
            elapsedMs: Math.max(0, performance.now() - startedAt)
        };
    }

    continueUntilPage(pageIndex: number): SimulationContinueResult {
        return this.continueUntil({ untilPage: pageIndex });
    }

    continueUntilY(y: number): SimulationContinueResult {
        return this.continueUntil({ untilY: y });
    }

    private advanceTickInternal(options: ContinueTickOptions = {}): {
        hasMore: boolean;
        yielded: boolean;
        reason: SimulationContinueResult['reason'];
    } {
        if (this.finished) {
            return {
                hasMore: false,
                yielded: false,
                reason: 'already-finished'
            };
        }
        const shouldTrackPageChanges = this.initialPaginationComplete;
        const pageTokensBeforeTick = shouldTrackPageChanges
            ? this.captureCurrentPageTokens()
            : new Map<number, string>();
        const pageCaptureRevisionsBeforeTick = shouldTrackPageChanges
            ? this.captureCurrentPageCaptureRevisions()
            : new Map<number, number>();
        this.lastUpdateSummary = createEmptyUpdateSummary();
        this.lastRenderRevisionPageIndexes = [];
        this.reactiveResettlementCycles = 0;
        this.reactiveResettlementSignatures.clear();

        if (!this.initialPlacementPass && this.initialPaginationComplete) {
            this.session.advanceSimulationTick();
            this.maybeAdvanceSteppedActorsAtTick();
        }
        this.initialPlacementPass = false;
        this.finalizedPageInCurrentIteration = false;

        while (this.actorIndex < this.packagers.length) {
            const actorIndexBeforeAction = this.actorIndex;
            const packager = this.packagers[this.actorIndex];
            const chunkContextBase = this.buildChunkContextBase();
            const placementPrepStart = performance.now();
            this.session.recordProfile('paginationPlacementPrepCalls', 1);
            const placementPreparation = this.session.preparePaginationPlacement({
                actor: packager,
                currentActorIndex: this.actorIndex,
                pages: this.pages,
                currentPageBoxes: this.currentPageBoxes,
                currentPageIndex: this.currentPageIndex,
                currentY: this.currentY,
                lastSpacingAfter: this.lastSpacingAfter,
                pageWidth: this.pageWidth,
                pageHeight: this.pageHeight,
                pageLimit: this.pageLimit,
                margins: this.margins,
                contextBase: chunkContextBase
            });
            this.session.recordProfile('paginationPlacementPrepMs', performance.now() - placementPrepStart);
            if (placementPreparation.action === 'continue-loop') {
                const previousPageIndex = this.currentPageIndex;
                this.applySessionLoopAction(placementPreparation.loopAction);
                const boundary = this.afterPotentialBoundary(previousPageIndex, actorIndexBeforeAction, options);
                if (boundary.action === 'yield') {
                    return this.finishCooperativeYield(
                        pageTokensBeforeTick,
                        pageCaptureRevisionsBeforeTick,
                        boundary.reason,
                        shouldTrackPageChanges
                    );
                }
                if (boundary.action === 'continue') {
                    continue;
                }
                continue;
            }

            this.currentY = placementPreparation.currentY;
            const availableWidth = placementPreparation.availableWidth;
            const availableHeight = placementPreparation.availableHeight;
            const isAtPageTop = placementPreparation.isAtPageTop;
            const layoutBefore = placementPreparation.layoutBefore;
            const layoutDelta = placementPreparation.layoutDelta;
            const constraintField = placementPreparation.constraintField;
            const placementFrame = placementPreparation.placementFrame;
            const context: PackagerContext = {
                ...placementPreparation.context,
                actorIndex: this.actorIndex,
                simulationTick: this.session.getSimulationTick()
            };
            const availableHeightAdjusted = placementPreparation.availableHeightAdjusted;
            const effectiveAvailableHeight = placementPreparation.effectiveAvailableHeight;
            const resolveDeferredCursorY = placementPreparation.resolveDeferredCursorY;
            const marginBottom = packager.getTrailingSpacing();

            this.session.setPaginationLoopState({
                actorQueue: this.packagers,
                actorIndex: this.actorIndex,
                paginationState: {
                    currentPageIndex: this.currentPageIndex,
                    currentPageBoxes: this.currentPageBoxes,
                    currentY: this.currentY,
                    lastSpacingAfter: this.lastSpacingAfter
                },
                availableWidth,
                availableHeight,
                lastSpacingAfter: this.lastSpacingAfter,
                isAtPageTop,
                context
            });

            const measurementStart = performance.now();
            this.session.recordProfile('actorMeasurementCalls', 1);
            const measurement = this.session.measurePreparedActor(
                packager,
                availableWidth,
                availableHeightAdjusted,
                layoutBefore,
                context
            );
            this.session.recordProfile('actorMeasurementMs', performance.now() - measurementStart);
            const contentHeight = measurement.contentHeight;
            const requiredHeight = measurement.requiredHeight;
            const effectiveHeight = measurement.effectiveHeight;

            const keepWithNextOverflow = packager.keepWithNext
                ? (() => {
                    const keepResolutionStart = performance.now();
                    this.session.recordProfile('keepWithNextResolutionCalls', 1);
                    const resolution = this.session.resolveKeepWithNextOverflow({
                        actorId: packager.actorId,
                        isAtPageTop,
                        actorQueue: this.packagers,
                        actorIndex: this.actorIndex,
                        paginationState: {
                            currentPageIndex: this.currentPageIndex,
                            currentPageBoxes: this.currentPageBoxes,
                            currentY: this.currentY,
                            lastSpacingAfter: this.lastSpacingAfter
                        },
                        availableWidth,
                        availableHeight: effectiveAvailableHeight,
                        lastSpacingAfter: this.lastSpacingAfter,
                        context
                    });
                    this.session.recordProfile('keepWithNextResolutionMs', performance.now() - keepResolutionStart);
                    return resolution;
                })()
                : null;

            const wholeFormationOverflowHandling = keepWithNextOverflow?.handling ?? null;
            const wholeFormationStart = performance.now();
            this.session.recordProfile('wholeFormationOverflowCalls', 1);
            const wholeFormationOverflowResolution = this.session.resolveWholeFormationOverflow({
                currentActorIndex: this.actorIndex,
                handling: wholeFormationOverflowHandling,
                pages: this.pages,
                currentPageBoxes: this.currentPageBoxes,
                currentPageIndex: this.currentPageIndex,
                pageWidth: this.pageWidth,
                pageHeight: this.pageHeight,
                nextPageTop: this.margins.top
            });
            this.session.recordProfile('wholeFormationOverflowMs', performance.now() - wholeFormationStart);

            const keepActionStart = performance.now();
            this.session.recordProfile('keepWithNextActionCalls', 1);
            const keepWithNextAction = this.session.resolveKeepWithNextOverflowAction({
                planning: keepWithNextOverflow,
                wholeFormationOverflow: wholeFormationOverflowResolution,
                effectiveHeight,
                marginBottom,
                effectiveAvailableHeight,
                isAtPageTop,
                pages: this.pages,
                currentPageBoxes: this.currentPageBoxes,
                currentPageIndex: this.currentPageIndex,
                pageWidth: this.pageWidth,
                pageHeight: this.pageHeight,
                nextPageTopY: this.margins.top,
                currentActorIndex: this.actorIndex,
                actorQueue: this.packagers,
                state: {
                    currentY: this.currentY,
                    lastSpacingAfter: this.lastSpacingAfter,
                    pageLimit: this.pageLimit,
                    availableWidth
                },
                contextBase: chunkContextBase,
                positionMarker: (marker, markerCurrentY, markerLayoutBefore, markerAvailableWidth, markerPageIndex) =>
                    this.positionFlowBox(
                        marker,
                        markerCurrentY,
                        markerLayoutBefore,
                        this.margins,
                        markerAvailableWidth,
                        markerPageIndex
                    )
            });
            this.session.recordProfile('keepWithNextActionMs', performance.now() - keepActionStart);
            if (keepWithNextAction) {
                const previousPageIndex = this.currentPageIndex;
                this.applySessionLoopAction(keepWithNextAction);
                const boundary = this.afterPotentialBoundary(previousPageIndex, actorIndexBeforeAction, options);
                if (boundary.action === 'yield') {
                    return this.finishCooperativeYield(
                        pageTokensBeforeTick,
                        pageCaptureRevisionsBeforeTick,
                        boundary.reason,
                        shouldTrackPageChanges
                    );
                }
                if (boundary.action === 'continue') {
                    continue;
                }
                continue;
            }

            if (requiredHeight <= effectiveAvailableHeight) {
                const previousPageIndex = this.currentPageIndex;
                const placementStart = performance.now();
                this.session.recordProfile('actorPlacementCalls', 1);
                this.applySessionLoopAction(this.session.placementSessionRuntime.resolveActorPlacementAction({
                    actor: packager,
                    placementFrame,
                    availableWidth,
                    availableHeight: availableHeightAdjusted,
                    context,
                    state: {
                        currentY: this.currentY,
                        layoutDelta,
                        effectiveHeight,
                        marginBottom,
                        pageIndex: this.currentPageIndex
                    },
                    constraintField,
                    layoutBefore,
                    pageLimit: this.pageLimit,
                    pageTop: this.margins.top,
                    pages: this.pages,
                    currentPageBoxes: this.currentPageBoxes,
                    currentPageIndex: this.currentPageIndex,
                    pageWidth: this.pageWidth,
                    pageHeight: this.pageHeight,
                    nextPageTopY: this.margins.top,
                    currentActorIndex: this.actorIndex,
                    currentY: this.currentY,
                    lastSpacingAfter: this.lastSpacingAfter
                }));
                this.session.recordProfile('actorPlacementMs', performance.now() - placementStart);
                const boundary = this.afterPotentialBoundary(previousPageIndex, actorIndexBeforeAction, options);
                if (boundary.action === 'yield') {
                    return this.finishCooperativeYield(
                        pageTokensBeforeTick,
                        pageCaptureRevisionsBeforeTick,
                        boundary.reason,
                        shouldTrackPageChanges
                    );
                }
                if (boundary.action === 'continue') {
                    continue;
                }
                continue;
            }

            const overflowStart = performance.now();
            this.session.recordProfile('actorOverflowCalls', 1);
            const overflowResolution = this.session.placementSessionRuntime.resolveActorOverflow({
                actor: packager,
                isAtPageTop,
                effectiveAvailableHeight,
                availableWidth,
                availableHeightAdjusted,
                context,
                contentHeight,
                marginTop: packager.getLeadingSpacing(),
                marginBottom,
                pageLimit: this.pageLimit,
                pageTop: this.margins.top,
                pages: this.pages,
                currentPageBoxes: this.currentPageBoxes,
                currentPageIndex: this.currentPageIndex,
                pageWidth: this.pageWidth,
                pageHeight: this.pageHeight,
                nextPageTopY: this.margins.top,
                currentActorIndex: this.actorIndex,
                currentY: this.currentY,
                lastSpacingAfter: this.lastSpacingAfter,
                state: {
                    currentY: this.currentY,
                    layoutDelta,
                    effectiveHeight,
                    marginBottom,
                    pageIndex: this.currentPageIndex
                }
            });
            this.session.recordProfile('actorOverflowMs', performance.now() - overflowStart);
            if (overflowResolution.action === 'handled') {
                const previousPageIndex = this.currentPageIndex;
                this.applySessionLoopAction(overflowResolution.loopAction);
                const boundary = this.afterPotentialBoundary(previousPageIndex, actorIndexBeforeAction, options);
                if (boundary.action === 'yield') {
                    return this.finishCooperativeYield(
                        pageTokensBeforeTick,
                        pageCaptureRevisionsBeforeTick,
                        boundary.reason,
                        shouldTrackPageChanges
                    );
                }
                if (boundary.action === 'continue') {
                    continue;
                }
                continue;
            }

            const previousPageIndex = this.currentPageIndex;
            const genericSplitStart = performance.now();
            this.session.recordProfile('genericSplitCalls', 1);
            this.applySessionLoopAction(this.session.placementSessionRuntime.resolveGenericSplitAction({
                pages: this.pages,
                currentPageBoxes: this.currentPageBoxes,
                currentPageIndex: this.currentPageIndex,
                pageWidth: this.pageWidth,
                pageHeight: this.pageHeight,
                nextPageTopY: this.margins.top,
                currentActorIndex: this.actorIndex,
                actorQueue: this.packagers,
                packager,
                splitExecution: overflowResolution.splitExecution,
                state: {
                    currentY: this.currentY,
                    lastSpacingAfter: this.lastSpacingAfter,
                    effectiveHeight,
                    marginBottom,
                    availableWidth,
                    availableHeightAdjusted,
                    pageLimit: this.pageLimit,
                    pageTop: this.margins.top,
                    layoutBefore: this.resolveLayoutBefore(this.lastSpacingAfter, packager.getLeadingSpacing())
                },
                contextBase: chunkContextBase,
                resolveDeferredCursorY,
                positionMarker: (marker, markerCurrentY, markerLayoutBefore, markerAvailableWidth, markerPageIndex) =>
                    this.positionFlowBox(
                        marker,
                        markerCurrentY,
                        markerLayoutBefore,
                        this.margins,
                        markerAvailableWidth,
                        markerPageIndex
                    )
            }));
            this.session.recordProfile('genericSplitMs', performance.now() - genericSplitStart);
            const boundary = this.afterPotentialBoundary(previousPageIndex, actorIndexBeforeAction, options);
            if (boundary.action === 'yield') {
                return this.finishCooperativeYield(
                    pageTokensBeforeTick,
                    pageCaptureRevisionsBeforeTick,
                    boundary.reason,
                    shouldTrackPageChanges
                );
            }
            if (boundary.action === 'continue') {
                continue;
            }
        }

        if (this.currentPageBoxes.length > 0) {
            this.session.closePagination(
                this.pages,
                this.currentPageBoxes,
                this.currentPageIndex,
                this.pageWidth,
                this.resolveCurrentPublicationPageHeight()
            );
            this.currentPageBoxes = [];
            this.paginationState.currentPageBoxes = this.currentPageBoxes;
            this.finalizedPageInCurrentIteration = true;
        }
        this.initialPaginationComplete = true;

        if (this.finalizedPageInCurrentIteration) {
            this.session.publishActorSignal({
                topic: 'pagination:finalized',
                publisherActorId: 'system:pagination-finalizer',
                publisherSourceId: 'system:pagination-finalizer',
                publisherActorKind: 'system',
                fragmentIndex: 0,
                pageIndex: this.currentPageIndex,
                cursorY: this.currentY,
                signalKey: 'pagination:finalized',
                payload: {
                    totalPageCount: this.pages.length
                }
            });
        }

        if (this.stopIfPageLimitReached()) {
            this.refreshUpdateSummaryPageIndexes(pageTokensBeforeTick);
            this.refreshRenderRevisionPageIndexes(pageCaptureRevisionsBeforeTick);
            this.normalizeReportedUpdateSummary();
            return {
                hasMore: false,
                yielded: false,
                reason: 'finished'
            };
        }

        if (!this.maybeSettleAtCheckpoint()) {
            const currentTick = this.session.getSimulationTick();
            const hasActiveSteppedActors =
                this.steppedActorsEnabled()
                && this.session.hasActiveSteppedActors(
                    this.buildChunkContextBase(),
                    this.currentPageIndex,
                    this.currentY
                );

            if (!this.session.shouldContinueAfterPaginationFinalized({
                currentTick,
                hasActiveSteppedActors
            })) {
                this.session.stopSimulationProgression(this.session.resolveSimulationStopReason(currentTick));
                this.finished = true;
            }
        }

        this.refreshUpdateSummaryPageIndexes(pageTokensBeforeTick);
        this.refreshRenderRevisionPageIndexes(pageCaptureRevisionsBeforeTick);
        this.attachPendingGeometryUpdateSummary(pageTokensBeforeTick);
        this.normalizeReportedUpdateSummary();
        this.refreshPendingGeometryUpdateSummary();
        return {
            hasMore: !this.finished,
            yielded: false,
            reason: this.finished ? 'finished' : 'until-page'
        };
    }

    private captureCurrentPageTokens(): Map<number, string> {
        return capturePageTokens(this.getCurrentPageCaptures(), this.getCurrentPages());
    }

    private captureCurrentPageCaptureRevisions(): Map<number, number> {
        return capturePageCaptureRevisions(this.getCurrentPageCaptures());
    }

    private refreshUpdateSummaryPageIndexes(previousTokens: Map<number, string>): void {
        if (this.lastUpdateSummary.kind === 'none') return;
        const nextTokens = this.captureCurrentPageTokens();
        this.lastUpdateSummary = updateSummaryWithChangedPages(this.lastUpdateSummary, previousTokens, nextTokens);
    }

    private refreshRenderRevisionPageIndexes(previousRevisions: Map<number, number>): void {
        const nextRevisions = this.captureCurrentPageCaptureRevisions();
        this.lastRenderRevisionPageIndexes = computeChangedPageIndexes(previousRevisions, nextRevisions);
    }

    private attachPendingGeometryUpdateSummary(previousTokens: Map<number, string>): void {
        if (this.lastUpdateSummary.kind !== 'none' || !this.pendingGeometryUpdateSummary) return;

        const nextTokens = this.captureCurrentPageTokens();
        const changes = computePageTokenChanges(previousTokens, nextTokens);
        if (changes.pageIndexes.length === 0 && this.lastRenderRevisionPageIndexes.length === 0) return;

        this.lastUpdateSummary = {
            ...this.pendingGeometryUpdateSummary,
            pageIndexes: changes.pageIndexes.length > 0
                ? changes.pageIndexes
                : [...this.lastRenderRevisionPageIndexes],
            addedPageIndexes: changes.addedPageIndexes,
            removedPageIndexes: changes.removedPageIndexes,
            replayFrontier: this.pendingGeometryUpdateSummary.replayFrontier
                ? { ...this.pendingGeometryUpdateSummary.replayFrontier }
                : null
        };
    }

    private normalizeReportedUpdateSummary(): void {
        this.lastUpdateSummary = normalizeUpdateSummary(this.lastUpdateSummary, this.lastRenderRevisionPageIndexes);
    }

    private refreshPendingGeometryUpdateSummary(): void {
        this.pendingGeometryUpdateSummary = this.lastUpdateSummary.kind === 'geometry'
            ? {
                kind: this.lastUpdateSummary.kind,
                source: this.lastUpdateSummary.source,
                actorIds: [...this.lastUpdateSummary.actorIds],
                sourceIds: [...this.lastUpdateSummary.sourceIds],
                pageIndexes: [...this.lastUpdateSummary.pageIndexes],
                addedPageIndexes: [...this.lastUpdateSummary.addedPageIndexes],
                removedPageIndexes: [...this.lastUpdateSummary.removedPageIndexes],
                replayFrontier: this.lastUpdateSummary.replayFrontier
                    ? { ...this.lastUpdateSummary.replayFrontier }
                    : null
            }
            : null;
    }

    private reactiveCheckpointsEnabled(): boolean {
        return this.snapshotsEnabled && (
            this.session.hasCommittedSignalObservers()
            || this.session.hasSteppedActors()
        );
    }

    private steppedActorsEnabled(): boolean {
        return this.session.hasSteppedActors();
    }

    private resolveLayoutBefore(prevAfter: number, marginTop: number): number {
        return prevAfter + marginTop;
    }

    private resolvePageGeometry(pageIndex: number): {
        width: number;
        height: number;
        margins: PackagerContext['margins'];
    } {
        const resolved = this.contextBase.resolvePageGeometry?.(pageIndex);
        const resolvedHeight = Number.isFinite(resolved?.height) ? Number(resolved!.height) : this.contextBase.pageHeight;
        return {
            width: Number.isFinite(resolved?.width) ? Number(resolved!.width) : this.contextBase.pageWidth,
            height: this.isContinuousPublication
                ? Math.max(resolvedHeight, CONTINUOUS_PUBLICATION_PAGE_HEIGHT)
                : resolvedHeight,
            margins: resolved?.margins ?? this.contextBase.margins
        };
    }

    private resolveCurrentPublicationPageHeight(): number {
        if (!this.isContinuousPublication) return this.pageHeight;
        const bottom = Number(this.margins?.bottom || 0);
        return Math.max(1, Math.ceil(this.currentY + bottom));
    }

    private syncCurrentPageGeometry(): void {
        const geometry = this.resolvePageGeometry(this.currentPageIndex);
        this.pageWidth = geometry.width;
        this.pageHeight = geometry.height;
        this.margins = geometry.margins;
        this.pageLimit = this.pageHeight - this.margins.bottom;
    }

    private buildChunkContextBase() {
        return {
            ...this.contextBase,
            pageWidth: this.pageWidth,
            pageHeight: this.pageHeight,
            margins: this.margins,
            simulationTick: this.session.getSimulationTick(),
            chunkOriginWorldY: this.session.resolveChunkOriginWorldY(this.currentPageIndex, this.pageHeight)
        };
    }

    private applySessionPaginationState(next: PaginationState): void {
        this.session.applyPaginationState(this.paginationState, next);
        this.currentPageIndex = this.paginationState.currentPageIndex;
        this.currentPageBoxes = this.paginationState.currentPageBoxes as LayoutBox[];
        this.currentY = this.paginationState.currentY;
        this.lastSpacingAfter = this.paginationState.lastSpacingAfter;
        this.syncCurrentPageGeometry();
        this.finalizedPageInCurrentIteration = false;
    }

    private applySessionLoopAction(action: PaginationLoopAction): void {
        this.actorIndex = this.session.applyPaginationLoopAction(this.paginationState, action);
        this.currentPageIndex = this.paginationState.currentPageIndex;
        this.currentPageBoxes = this.paginationState.currentPageBoxes as LayoutBox[];
        this.currentY = this.paginationState.currentY;
        this.lastSpacingAfter = this.paginationState.lastSpacingAfter;
        this.syncCurrentPageGeometry();
        this.finalizedPageInCurrentIteration = false;
    }

    private stopIfPageLimitReached(): boolean {
        const rawStopAtPage = Number(this.contextBase.stopAtPage);
        const stopAtPage = Number.isFinite(rawStopAtPage)
            ? Math.max(0, Math.floor(rawStopAtPage))
            : null;
        const rawStopAtWorldY = Number(this.contextBase.stopAtWorldY);
        const stopAtWorldY = Number.isFinite(rawStopAtWorldY)
            ? Math.max(0, rawStopAtWorldY)
            : null;
        if (stopAtPage === null && stopAtWorldY === null) return false;
        const hasReachedLimit = this.pages.some((page) =>
            (stopAtPage !== null && page.index >= stopAtPage)
            || (stopAtWorldY !== null && this.resolvePageBottomWorldY(page.index) >= stopAtWorldY)
        );
        if (!hasReachedLimit) return false;
        this.session.stopSimulationProgression('page-limit');
        this.finished = true;
        return true;
    }

    private resolvePageBottomWorldY(pageIndex: number): number {
        const normalizedPageIndex = Number.isFinite(Number(pageIndex))
            ? Math.max(0, Math.floor(Number(pageIndex)))
            : 0;
        let bottom = 0;
        for (let index = 0; index <= normalizedPageIndex; index += 1) {
            const geometry = this.resolvePageGeometry(index);
            bottom += Math.max(1, Number(geometry.height || 0));
        }
        return bottom;
    }

    private reapplyResolvedCheckpoint(
        checkpoint: Parameters<typeof reapplyCheckpointState>[0]['checkpoint'],
        restored: {
            currentPageBoxes: LayoutBox[];
            currentY: number;
            lastSpacingAfter: number;
        }
    ): void {
        this.actorIndex = reapplyCheckpointState({
            checkpoint,
            restored,
            packagers: this.packagers,
            pages: this.pages,
            pageWidth: this.pageWidth,
            pageHeight: this.pageHeight,
            applyState: (state) => this.applySessionPaginationState(state),
            notifyPageStart: (pageIndex, pageWidth, pageHeight, currentPageBoxes) =>
                this.session.notifyPageStart(pageIndex, pageWidth, pageHeight, currentPageBoxes),
            recordSafeCheckpoint: (...args) => this.session.recordSafeCheckpoint(...args)
        });
    }

    private maybeSettleAtCheckpoint(): boolean {
        if (!this.reactiveCheckpointsEnabled()) {
            return false;
        }
        const chunkContextBase = this.buildChunkContextBase();
        const observation = this.session.evaluateObserverRegistry(chunkContextBase, this.currentPageIndex, this.currentY);
        if (applyContentOnlyObservation({
            source: 'observer-registry',
            observation,
            pages: this.pages,
            currentPageBoxes: this.currentPageBoxes,
            chunkContextBase,
            recordUpdateSummary: (source, kind, actors, frontier, pageIndexes) =>
                this.recordUpdateSummary(source, kind, actors, frontier, pageIndexes),
            applyContentOnlyActorUpdates: (pages, currentPageBoxes, actors, contextBase) =>
                this.session.applyContentOnlyActorUpdates(pages, currentPageBoxes, actors, contextBase)
        })) {
            return false;
        }
        const observerSettlement = settleObserverGeometryAtCheckpoint({
            source: 'observer-registry',
            observation,
            maxReactiveResettlementCycles: this.maxReactiveResettlementCycles,
            reactiveResettlementCycles: this.reactiveResettlementCycles,
            reactiveResettlementSignatures: this.reactiveResettlementSignatures,
            actorSignalSequence: this.session.getActorSignalSequence(),
            pages: this.pages,
            packagers: this.packagers,
            pageWidth: this.pageWidth,
            pageHeight: this.pageHeight,
            recordUpdateSummary: (source, kind, actors, frontier, pageIndexes) =>
                this.recordUpdateSummary(source, kind, actors, frontier, pageIndexes),
            recordProfile: (metric, delta) => this.session.recordProfile(metric, delta),
            resolveSafeCheckpoint: (frontier) => this.session.resolveSafeCheckpoint(frontier),
            restoreSafeCheckpoint: (pages, packagers, checkpoint) =>
                this.session.restoreSafeCheckpoint(pages, packagers, checkpoint),
            reapplyCheckpointState: ({ checkpoint, restored }) =>
                this.reapplyResolvedCheckpoint(checkpoint, restored)
        });
        this.reactiveResettlementCycles = observerSettlement.reactiveResettlementCycles;
        return observerSettlement.settled;
    }

    private maybeAdvanceSteppedActorsAtTick(): boolean {
        if (!this.steppedActorsEnabled()) {
            return false;
        }
        const chunkContextBase = this.buildChunkContextBase();
        const stepped = this.session.evaluateSteppedActors(
            chunkContextBase,
            this.currentPageIndex,
            this.currentY
        );
        if (applyContentOnlyObservation({
            source: 'stepped-actors',
            observation: stepped,
            pages: this.pages,
            currentPageBoxes: this.currentPageBoxes,
            chunkContextBase,
            recordUpdateSummary: (source, kind, actors, frontier, pageIndexes) =>
                this.recordUpdateSummary(source, kind, actors, frontier, pageIndexes),
            applyContentOnlyActorUpdates: (pages, currentPageBoxes, actors, contextBase) =>
                this.session.applyContentOnlyActorUpdates(pages, currentPageBoxes, actors, contextBase)
        })) {
            return false;
        }
        return applySteppedGeometryUpdate({
            source: 'stepped-actors',
            stepped,
            pages: this.pages,
            packagers: this.packagers,
            recordUpdateSummary: (source, kind, actors, frontier, pageIndexes) =>
                this.recordUpdateSummary(source, kind, actors, frontier, pageIndexes),
            resolveSafeCheckpoint: (frontier) => this.session.resolveSafeCheckpoint(frontier),
            restoreSafeCheckpoint: (pages, packagers, checkpoint) =>
                this.session.restoreSafeCheckpoint(pages, packagers, checkpoint),
            reapplyCheckpointState: ({ checkpoint, restored }) =>
                this.reapplyResolvedCheckpoint(checkpoint, restored)
        });
    }

    private afterPotentialBoundary(
        previousPageIndex: number,
        previousActorIndex: number,
        options: ContinueTickOptions = {}
    ): {
        action: 'continue' | 'yield';
        reason: SimulationContinueResult['reason'];
    } {
        const cooperativeReason = this.resolveCooperativeContinueReason(options);
        if (cooperativeReason) {
            return {
                action: 'yield',
                reason: cooperativeReason
            };
        }
        if (this.stopIfPageLimitReached()) {
            return {
                action: 'continue',
                reason: 'finished'
            };
        }
        const budgetReason = this.resolveCooperativeBudgetReason(options);
        if (budgetReason) {
            return {
                action: 'yield',
                reason: budgetReason
            };
        }
        const shouldContinue = handleBoundaryCheckpoint({
            previousPageIndex,
            previousActorIndex,
            currentPageIndex: this.currentPageIndex,
            currentActorIndex: this.actorIndex,
            checkpointsEnabled: this.reactiveCheckpointsEnabled(),
            recordProfile: (metric, delta) => this.session.recordProfile(metric, delta),
            recordSafeCheckpoint: (kind) => {
                this.session.recordSafeCheckpoint(
                    this.packagers,
                    this.actorIndex,
                    this.pages,
                    this.currentPageBoxes,
                    this.currentPageIndex,
                    this.currentY,
                    this.pageHeight,
                    this.lastSpacingAfter,
                    kind
                );
            },
            maybeSettleAtCheckpoint: () => this.maybeSettleAtCheckpoint()
        });
        return {
            action: shouldContinue ? 'continue' : 'continue',
            reason: 'until-page'
        };
    }

    private resolveCooperativeContinueReason(
        options: ContinueTickOptions
    ): SimulationContinueResult['reason'] | null {
        if (!options.cooperativeContinue) return null;
        const rawStopAtPage = Number(options.untilPage);
        const stopAtPage = Number.isFinite(rawStopAtPage)
            ? Math.max(0, Math.floor(rawStopAtPage))
            : null;
        const rawStopAtWorldY = Number(options.untilY);
        const stopAtWorldY = Number.isFinite(rawStopAtWorldY)
            ? Math.max(0, rawStopAtWorldY)
            : null;
        if (stopAtPage === null && stopAtWorldY === null) return null;
        const matchedPage = this.pages.find((page) =>
            (stopAtPage !== null && page.index >= stopAtPage)
            || (stopAtWorldY !== null && this.resolvePageBottomWorldY(page.index) >= stopAtWorldY)
        );
        if (!matchedPage) return null;
        if (stopAtWorldY !== null && this.resolvePageBottomWorldY(matchedPage.index) >= stopAtWorldY) {
            return 'until-y';
        }
        return 'until-page';
    }

    private resolveCooperativeBudgetReason(
        options: ContinueTickOptions
    ): SimulationContinueResult['reason'] | null {
        if (!options.cooperativeContinue) return null;
        const maxMilliseconds = Number(options.maxMilliseconds);
        if (!Number.isFinite(maxMilliseconds) || maxMilliseconds <= 0) return null;
        const startedAt = Number(options.startedAt);
        if (!Number.isFinite(startedAt)) return null;
        return performance.now() - startedAt >= maxMilliseconds ? 'time-budget' : null;
    }

    private finishCooperativeYield(
        pageTokensBeforeTick: Map<number, string>,
        pageCaptureRevisionsBeforeTick: Map<number, number>,
        reason: SimulationContinueResult['reason'],
        shouldTrackPageChanges: boolean
    ): {
        hasMore: boolean;
        yielded: boolean;
        reason: SimulationContinueResult['reason'];
    } {
        if (shouldTrackPageChanges) {
            this.refreshUpdateSummaryPageIndexes(pageTokensBeforeTick);
            this.refreshRenderRevisionPageIndexes(pageCaptureRevisionsBeforeTick);
            this.attachPendingGeometryUpdateSummary(pageTokensBeforeTick);
            this.normalizeReportedUpdateSummary();
            this.refreshPendingGeometryUpdateSummary();
        }
        return {
            hasMore: true,
            yielded: true,
            reason
        };
    }

    private recordUpdateSummary(
        source: SimulationUpdateSource,
        kind: 'content-only' | 'geometry',
        actors: readonly PackagerUnit[],
        frontier?: SpatialFrontier,
        pageIndexes: readonly number[] = []
    ): void {
        this.lastUpdateSummary = accumulateUpdateSummary(
            this.lastUpdateSummary,
            source,
            kind,
            actors,
            frontier,
            pageIndexes
        );
    }
}

export function createSimulationMarchRunner(
    processor: LayoutProcessor,
    packagers: PackagerUnit[],
    contextBase: Omit<PackagerContext, 'pageIndex' | 'cursorY'>,
    session: LayoutSession,
    progressionOverride?: ReturnType<LayoutProcessor['getSimulationProgressionConfig']>
): SimulationMarchRunner {
    return new SimulationMarchRunner(processor, packagers, contextBase, session, progressionOverride);
}

export function executeSimulationMarch(
    processor: LayoutProcessor,
    packagers: PackagerUnit[],
    contextBase: Omit<PackagerContext, 'pageIndex' | 'cursorY'>,
    session: LayoutSession
): Page[] {
    return createSimulationMarchRunner(processor, packagers, contextBase, session).runToCompletion();
}
