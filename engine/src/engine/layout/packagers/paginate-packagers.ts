import { Box, Element, Page } from '../../types';
import { LayoutProcessor } from '../layout-core';
import { LayoutSession, PaginationState } from '../layout-session';
import { PackagerContext, PackagerUnit, LayoutBox } from './packager-types';

export function paginatePackagers(
    processor: LayoutProcessor,
    packagers: PackagerUnit[],
    contextBase: Omit<PackagerContext, 'pageIndex' | 'cursorY'>,
    session: LayoutSession
): Page[] {
    const pages: Page[] = [];
    let currentPageBoxes: LayoutBox[] = [];
    let currentPageIndex = 0;

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
    const applySessionLoopAction = (action: ReturnType<LayoutSession['toPaginationLoopAction']>) => {
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

    const pushNewPage = () => {
        const outcome = session.advancePage(
            pages,
            currentPageBoxes,
            currentPageIndex,
            contextBase.pageWidth,
            contextBase.pageHeight,
            margins.top
        );
        applySessionPaginationState({
            currentPageIndex: outcome.nextPageIndex,
            currentPageBoxes: outcome.nextPageBoxes,
            currentY: outcome.nextCurrentY,
            lastSpacingAfter: outcome.nextLastSpacingAfter
        });
    };

    let i = 0;
    while (i < packagers.length) {
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
            applySessionLoopAction(placementPreparation.loopAction);
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
        const context: PackagerContext = placementPreparation.context;
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
        const keepPlan = keepWithNextOverflow?.plan ?? null;
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
                (processor as any).positionFlowBox(
                    marker,
                    markerCurrentY,
                    markerLayoutBefore,
                    margins,
                    markerAvailableWidth,
                    markerPageIndex
                )
        });
        if (keepWithNextAction) {
            applySessionLoopAction(keepWithNextAction);
            continue;
        }

        if (requiredHeight <= effectiveAvailableHeight) {
            applySessionLoopAction(session.resolveActorPlacementAction({
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
            continue;
        }

        const overflowResolution = session.resolveActorOverflow({
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
            applySessionLoopAction(overflowResolution.loopAction);
            continue;
        }
        applySessionLoopAction(session.resolveGenericSplitAction({
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
                (processor as any).positionFlowBox(
                    marker,
                    markerCurrentY,
                    markerLayoutBefore,
                    margins,
                    markerAvailableWidth,
                    markerPageIndex
                )
        }));
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

    return pages;
}
