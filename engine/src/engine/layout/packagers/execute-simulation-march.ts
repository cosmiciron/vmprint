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
    const positionFlowBox = (processor as FlowBoxPositioner).positionFlowBox.bind(processor);
    const pages: Page[] = [];
    let currentPageBoxes: LayoutBox[] = [];
    let currentPageIndex = 0;
    let i = 0;

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

    session.notifyPageStart(currentPageIndex, contextBase.pageWidth, contextBase.pageHeight, currentPageBoxes);
    session.recordSafeCheckpoint(packagers, i, pages, currentPageBoxes, currentPageIndex, currentY, lastSpacingAfter, 'page');

    const maybeSettleAtCheckpoint = (): boolean => {
        const observation = session.evaluateObserverRegistry(contextBase, currentPageIndex, currentY);
        if (!observation.geometryChanged || !observation.earliestAffectedFrontier) {
            return false;
        }

        const checkpoint = session.resolveSafeCheckpoint(observation.earliestAffectedFrontier);
        if (!checkpoint) {
            return false;
        }

        session.recordProfile('observerSettleCalls', 1);
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
        session.recordSafeCheckpoint(packagers, i, pages, currentPageBoxes, currentPageIndex, currentY, lastSpacingAfter, checkpoint.kind);
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
        session.recordSafeCheckpoint(packagers, i, pages, currentPageBoxes, currentPageIndex, currentY, lastSpacingAfter, checkpointKind);
        return maybeSettleAtCheckpoint();
    };

    while (true) {
        while (i < packagers.length) {
            const actorIndexBeforeAction = i;
            const packager = packagers[i];
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
            const marginTop = packager.getMarginTop();
            const marginBottom = packager.getMarginBottom();
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
            const measurement = session.measurePreparedActor(
                packager,
                availableWidth,
                availableHeightAdjusted,
                layoutBefore,
                context
            );
            const contentHeight = measurement.contentHeight;
            const requiredHeight = measurement.requiredHeight;
            const effectiveHeight = measurement.effectiveHeight;

            const keepWithNextOverflow = packager.keepWithNext
                ? session.resolveKeepWithNextOverflow({
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
                })
                : null;
            const wholeFormationOverflowHandling = keepWithNextOverflow?.handling ?? null;
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
                if (afterPotentialBoundary(previousPageIndex, actorIndexBeforeAction)) {
                    continue;
                }
                continue;
            }

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
            if (overflowResolution.action === 'handled') {
                const previousPageIndex = currentPageIndex;
                applySessionLoopAction(overflowResolution.loopAction);
                if (afterPotentialBoundary(previousPageIndex, actorIndexBeforeAction)) {
                    continue;
                }
                continue;
            }
            const previousPageIndex = currentPageIndex;
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
                    layoutBefore: resolveLayoutBefore(lastSpacingAfter, packager.getMarginTop())
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

        if (!maybeSettleAtCheckpoint()) {
            break;
        }
    }

    return pages;
}
