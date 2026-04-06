import { performance } from 'node:perf_hooks';
import { Box, Element, Page } from '../../types';
import { LayoutProcessor } from '../layout-core';
import type { FlowBox } from '../layout-core-types';
import { LayoutSession } from '../layout-session';
import type { PaginationLoopAction, PaginationState } from '../layout-session-types';
import { PackagerContext, PackagerUnit, LayoutBox } from './packager-types';

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

export function executeSimulationMarch(
    processor: LayoutProcessor,
    packagers: PackagerUnit[],
    contextBase: Omit<PackagerContext, 'pageIndex' | 'cursorY'>,
    session: LayoutSession
): Page[] {
    const progression = processor.getSimulationProgressionConfig();
    const maxReactiveResettlementCycles = resolveReactiveResettlementCycleCap();
    const snapshotsEnabled = process.env.VMPRINT_DISABLE_SAFE_CHECKPOINTS !== '1';
    const reactiveCheckpointsEnabled = () =>
        snapshotsEnabled && (session.hasCommittedSignalObservers() || session.hasSteppedActors());
    const steppedActorsEnabled = () => session.hasSteppedActors();
    const positionFlowBox = (processor as FlowBoxPositioner).positionFlowBox.bind(processor);
    const pages: Page[] = [];
    let currentPageBoxes: LayoutBox[] = [];
    let currentPageIndex = 0;
    let i = 0;
    let reactiveResettlementCycles = 0;
    const reactiveResettlementSignatures = new Set<string>();
    let initialPlacementPass = true;

    const margins = contextBase.margins;
    let currentY = margins.top;
    let lastSpacingAfter = 0;
    const paginationState: PaginationState = {
        currentPageIndex,
        currentPageBoxes,
        currentY,
        lastSpacingAfter
    };
    const applySessionPaginationState = (next: PaginationState) => {
        session.applyPaginationState(paginationState, next);
        currentPageIndex = paginationState.currentPageIndex;
        currentPageBoxes = paginationState.currentPageBoxes as LayoutBox[];
        currentY = paginationState.currentY;
        lastSpacingAfter = paginationState.lastSpacingAfter;
    };
    const applySessionLoopAction = (action: PaginationLoopAction) => {
        i = session.applyPaginationLoopAction(paginationState, action);
        currentPageIndex = paginationState.currentPageIndex;
        currentPageBoxes = paginationState.currentPageBoxes as LayoutBox[];
        currentY = paginationState.currentY;
        lastSpacingAfter = paginationState.lastSpacingAfter;
    };

    const pageLimit = contextBase.pageHeight - margins.bottom;
    const resolveLayoutBefore = (prevAfter: number, marginTop: number): number =>
        prevAfter + marginTop;
    const buildChunkContextBase = () => ({
        ...contextBase,
        chunkOriginWorldY: session.resolveChunkOriginWorldY(currentPageIndex, contextBase.pageHeight)
    });

    session.beginSimulationRun(progression);
    session.notifyPageStart(currentPageIndex, contextBase.pageWidth, contextBase.pageHeight, currentPageBoxes);
    if (reactiveCheckpointsEnabled()) {
        session.recordSafeCheckpoint(packagers, i, pages, currentPageBoxes, currentPageIndex, currentY, contextBase.pageHeight, lastSpacingAfter, 'page');
    }

    const maybeSettleAtCheckpoint = (): boolean => {
        if (!reactiveCheckpointsEnabled()) {
            return false;
        }
        const chunkContextBase = buildChunkContextBase();
        const observation = session.evaluateObserverRegistry(chunkContextBase, currentPageIndex, currentY);
        if (!observation.geometryChanged && observation.contentOnlyActors.length > 0) {
            session.applyContentOnlyActorUpdates(pages, currentPageBoxes, observation.contentOnlyActors, chunkContextBase);
            return false;
        }
        if (!observation.geometryChanged || !observation.earliestAffectedFrontier) {
            return false;
        }

        const checkpoint = session.resolveSafeCheckpoint(observation.earliestAffectedFrontier);
        if (!checkpoint) {
            return false;
        }

        const signature = buildReactiveResettlementSignature(
            'observer',
            checkpoint,
            observation.earliestAffectedFrontier,
            session.getActorSignalSequence()
        );

        if (reactiveResettlementSignatures.has(signature)) {
            session.recordProfile('actorUpdateRepeatedStateDetections', 1);
            throw new Error(
                `[executeSimulationMarch] Reactive geometry oscillation detected at checkpoint "${checkpoint.id}" `
                + `(frontier page=${observation.earliestAffectedFrontier.pageIndex}, cursorY=${Number.isFinite(observation.earliestAffectedFrontier.cursorY) ? Number(observation.earliestAffectedFrontier.cursorY).toFixed(3) : 'na'}, actor=${observation.earliestAffectedFrontier.actorId ?? observation.earliestAffectedFrontier.sourceId ?? 'unknown'}, `
                + `signalSequence=${session.getActorSignalSequence()}).`
            );
        }

        if (reactiveResettlementCycles >= maxReactiveResettlementCycles) {
            session.recordProfile('actorUpdateResettlementCapHits', 1);
            throw new Error(
                `[executeSimulationMarch] Reactive geometry resettlement exceeded the cycle cap `
                + `(${maxReactiveResettlementCycles}) at checkpoint "${checkpoint.id}" `
                + `(frontier page=${observation.earliestAffectedFrontier.pageIndex}, cursorY=${Number.isFinite(observation.earliestAffectedFrontier.cursorY) ? Number(observation.earliestAffectedFrontier.cursorY).toFixed(3) : 'na'}, actor=${observation.earliestAffectedFrontier.actorId ?? observation.earliestAffectedFrontier.sourceId ?? 'unknown'}, `
                + `signalSequence=${session.getActorSignalSequence()}).`
            );
        }

        reactiveResettlementSignatures.add(signature);
        reactiveResettlementCycles += 1;

        session.recordProfile('observerSettleCalls', 1);
        session.recordProfile('actorUpdateResettlementCycles', 1);
        if (checkpoint.kind === 'actor') {
            session.recordProfile('observerActorBoundarySettles', 1);
        } else {
            session.recordProfile('observerPageBoundarySettles', 1);
        }

        const restored = session.restoreSafeCheckpoint(pages, packagers, checkpoint);
        applySessionPaginationState({
            currentPageIndex: checkpoint.pageIndex,
            currentPageBoxes: restored.currentPageBoxes as LayoutBox[],
            currentY: restored.currentY,
            lastSpacingAfter: restored.lastSpacingAfter
        });
        i = checkpoint.actorIndex;
        session.notifyPageStart(currentPageIndex, contextBase.pageWidth, contextBase.pageHeight, currentPageBoxes);
        session.recordSafeCheckpoint(packagers, i, pages, currentPageBoxes, currentPageIndex, currentY, contextBase.pageHeight, lastSpacingAfter, checkpoint.kind);
        return true;
    };

    const maybeAdvanceSteppedActorsAtTick = (): boolean => {
        if (!steppedActorsEnabled()) {
            return false;
        }
        const chunkContextBase = buildChunkContextBase();
        const stepped = session.evaluateSteppedActors(
            {
                ...chunkContextBase,
                simulationTick: session.getSimulationTick()
            },
            currentPageIndex,
            currentY
        );
        if (!stepped.geometryChanged && stepped.contentOnlyActors.length > 0) {
            session.applyContentOnlyActorUpdates(
                pages,
                currentPageBoxes,
                stepped.contentOnlyActors,
                {
                    ...chunkContextBase,
                    simulationTick: session.getSimulationTick()
                }
            );
            return false;
        }
        if (!stepped.geometryChanged || !stepped.earliestAffectedFrontier) {
            return false;
        }

        const checkpoint = session.resolveSafeCheckpoint(stepped.earliestAffectedFrontier);
        if (!checkpoint) {
            return false;
        }

        const restored = session.restoreSafeCheckpoint(pages, packagers, checkpoint);
        applySessionPaginationState({
            currentPageIndex: checkpoint.pageIndex,
            currentPageBoxes: restored.currentPageBoxes as LayoutBox[],
            currentY: restored.currentY,
            lastSpacingAfter: restored.lastSpacingAfter
        });
        i = checkpoint.actorIndex;
        session.notifyPageStart(currentPageIndex, contextBase.pageWidth, contextBase.pageHeight, currentPageBoxes);
        session.recordSafeCheckpoint(packagers, i, pages, currentPageBoxes, currentPageIndex, currentY, contextBase.pageHeight, lastSpacingAfter, checkpoint.kind);
        return true;
    };

    const afterPotentialBoundary = (previousPageIndex: number, previousActorIndex: number): boolean => {
        let checkpointKind: 'page' | 'actor' | null = null;
        if (currentPageIndex !== previousPageIndex) {
            checkpointKind = 'page';
        } else if (i !== previousActorIndex) {
            checkpointKind = 'actor';
        }
        if (!checkpointKind) {
            return false;
        }
        if (!reactiveCheckpointsEnabled()) {
            return false;
        }
        const boundaryStart = performance.now();
        session.recordProfile('boundaryCheckpointCalls', 1);
        const checkpointRecordStart = performance.now();
        session.recordProfile('checkpointRecordCalls', 1);
        session.recordSafeCheckpoint(packagers, i, pages, currentPageBoxes, currentPageIndex, currentY, contextBase.pageHeight, lastSpacingAfter, checkpointKind);
        session.recordProfile('checkpointRecordMs', performance.now() - checkpointRecordStart);
        const observerBoundaryStart = performance.now();
        session.recordProfile('observerBoundaryCheckCalls', 1);
        const settled = maybeSettleAtCheckpoint();
        session.recordProfile('observerBoundaryCheckMs', performance.now() - observerBoundaryStart);
        session.recordProfile('boundaryCheckpointMs', performance.now() - boundaryStart);
        return settled;
    };

    while (true) {
        if (!initialPlacementPass) {
            session.advanceSimulationTick();
            maybeAdvanceSteppedActorsAtTick();
        }
        initialPlacementPass = false;
        while (i < packagers.length) {
            const actorIndexBeforeAction = i;
            const packager = packagers[i];
            const placementPrepStart = performance.now();
            session.recordProfile('paginationPlacementPrepCalls', 1);
            const placementPreparation = session.preparePaginationPlacement({
                actor: packager,
                currentActorIndex: i,
                pages,
                currentPageBoxes,
                currentPageIndex,
                currentY,
                lastSpacingAfter,
                pageWidth: contextBase.pageWidth,
                pageHeight: contextBase.pageHeight,
                pageLimit,
                margins,
                contextBase
            });
            session.recordProfile('paginationPlacementPrepMs', performance.now() - placementPrepStart);
            if (placementPreparation.action === 'continue-loop') {
                const previousPageIndex = currentPageIndex;
                applySessionLoopAction(placementPreparation.loopAction);
                if (afterPotentialBoundary(previousPageIndex, actorIndexBeforeAction)) {
                    continue;
                }
                continue;
            }
            currentY = placementPreparation.currentY;
            const availableWidth = placementPreparation.availableWidth;
            const availableHeight = placementPreparation.availableHeight;
            const isAtPageTop = placementPreparation.isAtPageTop;
            const layoutBefore = placementPreparation.layoutBefore;
            const layoutDelta = placementPreparation.layoutDelta;
            const constraintField = placementPreparation.constraintField;
            const placementFrame = placementPreparation.placementFrame;
            const context: PackagerContext = {
                ...placementPreparation.context,
                actorIndex: i
            };
            const availableHeightAdjusted = placementPreparation.availableHeightAdjusted;
            const effectiveAvailableHeight = placementPreparation.effectiveAvailableHeight;
            const resolveDeferredCursorY = placementPreparation.resolveDeferredCursorY;
            const marginTop = packager.getLeadingSpacing();
            const marginBottom = packager.getTrailingSpacing();
            session.setPaginationLoopState({
                actorQueue: packagers,
                actorIndex: i,
                paginationState: {
                    currentPageIndex,
                    currentPageBoxes,
                    currentY,
                    lastSpacingAfter
                },
                availableWidth,
                availableHeight,
                lastSpacingAfter,
                isAtPageTop,
                context
            });
            const measurementStart = performance.now();
            session.recordProfile('actorMeasurementCalls', 1);
            const measurement = session.measurePreparedActor(
                packager,
                availableWidth,
                availableHeightAdjusted,
                layoutBefore,
                context
            );
            session.recordProfile('actorMeasurementMs', performance.now() - measurementStart);
            const contentHeight = measurement.contentHeight;
            const requiredHeight = measurement.requiredHeight;
            const effectiveHeight = measurement.effectiveHeight;

            const keepWithNextOverflow = packager.keepWithNext
                ? (() => {
                    const keepResolutionStart = performance.now();
                    session.recordProfile('keepWithNextResolutionCalls', 1);
                    const resolution = session.resolveKeepWithNextOverflow({
                    actorId: packager.actorId,
                    isAtPageTop,
                    actorQueue: packagers,
                    actorIndex: i,
                    paginationState: {
                        currentPageIndex,
                        currentPageBoxes,
                        currentY,
                        lastSpacingAfter
                    },
                    availableWidth,
                    availableHeight: effectiveAvailableHeight,
                    lastSpacingAfter,
                    context
                    });
                    session.recordProfile('keepWithNextResolutionMs', performance.now() - keepResolutionStart);
                    return resolution;
                })()
                : null;
            const wholeFormationOverflowHandling = keepWithNextOverflow?.handling ?? null;
            const wholeFormationStart = performance.now();
            session.recordProfile('wholeFormationOverflowCalls', 1);
            const wholeFormationOverflowResolution = session.resolveWholeFormationOverflow({
                currentActorIndex: i,
                handling: wholeFormationOverflowHandling,
                pages,
                currentPageBoxes,
                currentPageIndex,
                pageWidth: contextBase.pageWidth,
                pageHeight: contextBase.pageHeight,
                nextPageTop: margins.top
            });
            session.recordProfile('wholeFormationOverflowMs', performance.now() - wholeFormationStart);
            const keepActionStart = performance.now();
            session.recordProfile('keepWithNextActionCalls', 1);
            const keepWithNextAction = session.resolveKeepWithNextOverflowAction({
                planning: keepWithNextOverflow,
                wholeFormationOverflow: wholeFormationOverflowResolution,
                effectiveHeight,
                marginBottom,
                effectiveAvailableHeight,
                isAtPageTop,
                pages,
                currentPageBoxes,
                currentPageIndex,
                pageWidth: contextBase.pageWidth,
                pageHeight: contextBase.pageHeight,
                nextPageTopY: margins.top,
                currentActorIndex: i,
                actorQueue: packagers,
                state: {
                    currentY,
                    lastSpacingAfter,
                    pageLimit,
                    availableWidth
                },
                contextBase,
                positionMarker: (marker, markerCurrentY, markerLayoutBefore, markerAvailableWidth, markerPageIndex) =>
                    positionFlowBox(
                        marker,
                        markerCurrentY,
                        markerLayoutBefore,
                        margins,
                        markerAvailableWidth,
                        markerPageIndex
                    )
            });
            session.recordProfile('keepWithNextActionMs', performance.now() - keepActionStart);
            if (keepWithNextAction) {
                const previousPageIndex = currentPageIndex;
                applySessionLoopAction(keepWithNextAction);
                if (afterPotentialBoundary(previousPageIndex, actorIndexBeforeAction)) {
                    continue;
                }
                continue;
            }

            if (requiredHeight <= effectiveAvailableHeight) {
                const previousPageIndex = currentPageIndex;
                const placementStart = performance.now();
                session.recordProfile('actorPlacementCalls', 1);
                applySessionLoopAction(session.placementSessionRuntime.resolveActorPlacementAction({
                    actor: packager,
                    placementFrame,
                    availableWidth,
                    availableHeight: availableHeightAdjusted,
                    context,
                    state: {
                        currentY,
                        layoutDelta,
                        effectiveHeight,
                        marginBottom,
                        pageIndex: currentPageIndex
                    },
                    constraintField,
                    layoutBefore,
                    pageLimit,
                    pageTop: margins.top,
                    pages,
                    currentPageBoxes,
                    currentPageIndex,
                    pageWidth: contextBase.pageWidth,
                    pageHeight: contextBase.pageHeight,
                    nextPageTopY: margins.top,
                    currentActorIndex: i,
                    currentY,
                    lastSpacingAfter
                }));
                session.recordProfile('actorPlacementMs', performance.now() - placementStart);
                if (afterPotentialBoundary(previousPageIndex, actorIndexBeforeAction)) {
                    continue;
                }
                continue;
            }

            const overflowStart = performance.now();
            session.recordProfile('actorOverflowCalls', 1);
            const overflowResolution = session.placementSessionRuntime.resolveActorOverflow({
                actor: packager,
                isAtPageTop,
                effectiveAvailableHeight,
                availableWidth,
                availableHeightAdjusted,
                context,
                contentHeight,
                marginTop,
                marginBottom,
                pageLimit,
                pageTop: margins.top,
                pages,
                currentPageBoxes,
                currentPageIndex,
                pageWidth: contextBase.pageWidth,
                pageHeight: contextBase.pageHeight,
                nextPageTopY: margins.top,
                currentActorIndex: i,
                currentY,
                lastSpacingAfter,
                state: {
                    currentY,
                    layoutDelta,
                    effectiveHeight,
                    marginBottom,
                    pageIndex: currentPageIndex
                }
            });
            session.recordProfile('actorOverflowMs', performance.now() - overflowStart);
            if (overflowResolution.action === 'handled') {
                const previousPageIndex = currentPageIndex;
                applySessionLoopAction(overflowResolution.loopAction);
                if (afterPotentialBoundary(previousPageIndex, actorIndexBeforeAction)) {
                    continue;
                }
                continue;
            }
            const previousPageIndex = currentPageIndex;
            const genericSplitStart = performance.now();
            session.recordProfile('genericSplitCalls', 1);
            applySessionLoopAction(session.placementSessionRuntime.resolveGenericSplitAction({
                pages,
                currentPageBoxes,
                currentPageIndex,
                pageWidth: contextBase.pageWidth,
                pageHeight: contextBase.pageHeight,
                nextPageTopY: margins.top,
                currentActorIndex: i,
                actorQueue: packagers,
                packager,
                splitExecution: overflowResolution.splitExecution,
                state: {
                    currentY,
                    lastSpacingAfter,
                    effectiveHeight,
                    marginBottom,
                    availableWidth,
                    availableHeightAdjusted,
                    pageLimit,
                    pageTop: margins.top,
                    layoutBefore: resolveLayoutBefore(lastSpacingAfter, packager.getLeadingSpacing())
                },
                contextBase,
                resolveDeferredCursorY,
                positionMarker: (marker, markerCurrentY, markerLayoutBefore, markerAvailableWidth, markerPageIndex) =>
                    positionFlowBox(
                        marker,
                        markerCurrentY,
                        markerLayoutBefore,
                        margins,
                        markerAvailableWidth,
                        markerPageIndex
                    )
            }));
            session.recordProfile('genericSplitMs', performance.now() - genericSplitStart);
            if (afterPotentialBoundary(previousPageIndex, actorIndexBeforeAction)) {
                continue;
            }
            continue;
        }

        if (currentPageBoxes.length > 0) {
            session.closePagination(
                pages,
                currentPageBoxes,
                currentPageIndex,
                contextBase.pageWidth,
                contextBase.pageHeight
            );
        }

        session.publishActorSignal({
            topic: 'pagination:finalized',
            publisherActorId: 'system:pagination-finalizer',
            publisherSourceId: 'system:pagination-finalizer',
            publisherActorKind: 'system',
            fragmentIndex: 0,
            pageIndex: currentPageIndex,
            cursorY: currentY,
            signalKey: 'pagination:finalized',
            payload: {
                totalPageCount: pages.length
            }
        });

        if (!maybeSettleAtCheckpoint()) {
            const currentTick = session.getSimulationTick();
            const hasActiveSteppedActors =
                steppedActorsEnabled()
                && session.hasActiveSteppedActors(
                    {
                        ...contextBase,
                        simulationTick: currentTick
                    },
                    currentPageIndex,
                    currentY
                );

            if (session.shouldContinueAfterPaginationFinalized({
                currentTick,
                hasActiveSteppedActors
            })) {
                continue;
            }
            session.stopSimulationProgression(session.resolveSimulationStopReason(currentTick));
            break;
        }
    }

    return pages;
}

function resolveReactiveResettlementCycleCap(): number {
    const raw = Number(process.env.VMPRINT_MAX_REACTIVE_RESETTLEMENT_CYCLES);
    if (Number.isFinite(raw) && raw >= 1) {
        return Math.floor(raw);
    }
    return 8;
}

function buildReactiveResettlementSignature(
    kind: 'observer',
    checkpoint: { kind: string; pageIndex: number; actorIndex: number; anchorActorId?: string; anchorSourceId?: string; frontier: { cursorY?: number; worldY?: number } },
    frontier: { pageIndex: number; cursorY?: number; worldY?: number; actorIndex?: number; actorId?: string; sourceId?: string },
    sequenceOrTick: number
): string {
    return [
        kind,
        checkpoint.kind,
        checkpoint.pageIndex,
        Number.isFinite(checkpoint.frontier.cursorY) ? Number(checkpoint.frontier.cursorY).toFixed(3) : 'na',
        Number.isFinite(checkpoint.frontier.worldY) ? Number(checkpoint.frontier.worldY).toFixed(3) : 'na',
        checkpoint.actorIndex,
        checkpoint.anchorActorId ?? 'na',
        checkpoint.anchorSourceId ?? 'na',
        frontier.pageIndex,
        Number.isFinite(frontier.cursorY) ? Number(frontier.cursorY).toFixed(3) : 'na',
        Number.isFinite(frontier.worldY) ? Number(frontier.worldY).toFixed(3) : 'na',
        frontier.actorIndex ?? 'na',
        frontier.actorId ?? 'na',
        frontier.sourceId ?? 'na',
        sequenceOrTick
    ].join('|');
}
