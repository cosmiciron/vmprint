import { performance } from 'node:perf_hooks';
import { Box, Element, Page } from '../../types';
import { getActorOverflowHandling } from '../actor-overflow';
import {
    getTailSplitPostAttemptOutcome,
    getWholeFormationOverflowHandling
} from '../actor-formation';
import { LayoutProcessor } from '../layout-core';
import { LAYOUT_DEFAULTS } from '../defaults';
import { computeKeepWithNextPlan } from '../keep-with-next-collaborator';
import { ConstraintField, LayoutSession, PaginationState } from '../layout-session';
import { PackagerContext, PackagerUnit, LayoutBox, preparePackagerForPhase, rejectsPlacementFrame, resolvePackagerPlacementPreference } from './packager-types';

export function paginatePackagers(
    processor: LayoutProcessor,
    packagers: PackagerUnit[],
    contextBase: Omit<PackagerContext, 'pageIndex' | 'cursorY'>,
    session?: LayoutSession
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
        if (session) {
            session.applyPaginationState(paginationState, next);
        } else {
            paginationState.currentPageIndex = next.currentPageIndex;
            paginationState.currentPageBoxes = next.currentPageBoxes;
            paginationState.currentY = next.currentY;
            paginationState.lastSpacingAfter = next.lastSpacingAfter;
        }
        currentPageIndex = paginationState.currentPageIndex;
        currentPageBoxes = paginationState.currentPageBoxes as LayoutBox[];
        currentY = paginationState.currentY;
        lastSpacingAfter = paginationState.lastSpacingAfter;
    };
    const applySessionLoopAction = (action: ReturnType<LayoutSession['toPaginationLoopAction']>) => {
        if (!session) {
            throw new Error('Session loop action requires an active layout session.');
        }
        i = session.applyPaginationLoopAction(paginationState, action);
        currentPageIndex = paginationState.currentPageIndex;
        currentPageBoxes = paginationState.currentPageBoxes as LayoutBox[];
        currentY = paginationState.currentY;
        lastSpacingAfter = paginationState.lastSpacingAfter;
    };

    const pageLimit = contextBase.pageHeight - margins.bottom;
    const resolveLayoutBefore = (prevAfter: number, marginTop: number): number =>
        prevAfter + marginTop;

    session?.notifyPageStart(currentPageIndex, contextBase.pageWidth, contextBase.pageHeight, currentPageBoxes);

    const pushNewPage = () => {
        if (session) {
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
            return;
        }

        if (currentPageBoxes.length > 0) {
            pages.push({
                index: currentPageIndex,
                boxes: currentPageBoxes,
                width: contextBase.pageWidth,
                height: contextBase.pageHeight
            });
        }
        currentPageIndex++;
        currentPageBoxes = [];
        currentY = margins.top;
        lastSpacingAfter = 0;
    };

    let i = 0;
    while (i < packagers.length) {
        const packager = packagers[i];

        let availableWidth = contextBase.pageWidth - margins.left - margins.right;
        let availableHeight = pageLimit - currentY;

        // Ensure minimum valid space for checking if we can fit at all
        if (availableHeight <= 0 && currentY > margins.top) {
            if (session) {
                applySessionLoopAction(session.restartCurrentActorOnNextPage(
                    pages,
                    currentPageBoxes,
                    currentPageIndex,
                    contextBase.pageWidth,
                    contextBase.pageHeight,
                    margins.top,
                    i
                ));
                continue;
            }
            pushNewPage();
            continue;
        }

        const isAtPageTop = currentY === margins.top && currentPageBoxes.length === 0;

        if (packager.pageBreakBefore && !isAtPageTop) {
            if (session) {
                applySessionLoopAction(session.restartCurrentActorOnNextPage(
                    pages,
                    currentPageBoxes,
                    currentPageIndex,
                    contextBase.pageWidth,
                    contextBase.pageHeight,
                    margins.top,
                    i
                ));
                continue;
            }
            pushNewPage();
            continue;
        }

        const marginTop = packager.getMarginTop();
        const marginBottom = packager.getMarginBottom();
        const layoutBefore = resolveLayoutBefore(lastSpacingAfter, marginTop);
        const layoutDelta = layoutBefore - marginTop;
        const constraintField = new ConstraintField(availableWidth, availableHeight - layoutDelta);
        session?.notifyConstraintNegotiation(packager, constraintField);
        const placementSurfaceStart = performance.now();
        const placementFrame = constraintField.resolvePlacementFrame(currentY + layoutBefore, {
            left: margins.left,
            right: margins.right
        });
        session?.recordProfile('exclusionBlockedCursorCalls', 1);
        session?.recordProfile('exclusionBandResolutionCalls', 1);
        const placementSurfaceDuration = performance.now() - placementSurfaceStart;
        session?.recordProfile('exclusionBlockedCursorMs', placementSurfaceDuration);
        session?.recordProfile('exclusionBandResolutionMs', placementSurfaceDuration);
        if (placementFrame.cursorY > currentY + layoutBefore + LAYOUT_DEFAULTS.wrapTolerance) {
            currentY = placementFrame.cursorY - layoutBefore;
            availableHeight = pageLimit - currentY;
            if (availableHeight <= 0 && currentY > margins.top) {
                if (session) {
                    applySessionLoopAction(session.restartCurrentActorOnNextPage(
                        pages,
                        currentPageBoxes,
                        currentPageIndex,
                        contextBase.pageWidth,
                        contextBase.pageHeight,
                        margins.top,
                        i
                    ));
                    continue;
                }
                pushNewPage();
                continue;
            }
        }
        const contentBand = placementFrame.contentBand;
        if (contentBand) {
            session?.recordProfile('exclusionLaneApplications', 1);
        }
        const resolveDeferredCursorY = (candidate: PackagerUnit): number | null => {
            if (!contentBand) return null;

            const placementPreference = resolvePackagerPlacementPreference(candidate, constraintField.availableWidth, context);
            const minimumPlacementWidth = placementPreference?.minimumWidth;
            if (
                minimumPlacementWidth !== null &&
                minimumPlacementWidth !== undefined &&
                placementFrame.availableWidth + LAYOUT_DEFAULTS.wrapTolerance < minimumPlacementWidth
            ) {
                return placementFrame.activeBand?.bottom ?? placementFrame.cursorY;
            }

            if (rejectsPlacementFrame(candidate, placementFrame.availableWidth, constraintField.availableWidth, context)) {
                return placementFrame.activeBand?.bottom ?? placementFrame.cursorY;
            }

            return null;
        };
        availableWidth = placementFrame.availableWidth;
        const context: PackagerContext = {
            ...contextBase,
            pageIndex: currentPageIndex,
            cursorY: currentY,
            margins: {
                ...margins,
                left: placementFrame.margins.left,
                right: placementFrame.margins.right
            }
        };
        session?.setPaginationLoopState({
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
        const availableHeightAdjusted = constraintField.effectiveAvailableHeight;
        const effectiveAvailableHeight = layoutDelta + availableHeightAdjusted;

        preparePackagerForPhase(packager, 'commit', availableWidth, availableHeightAdjusted, context);
        session?.notifyActorPrepared(packager);
        const contentHeight = Math.max(0, packager.getRequiredHeight() - marginTop - marginBottom);
        let requiredHeight = contentHeight + layoutBefore + marginBottom;
        let effectiveHeight = Math.max(requiredHeight, LAYOUT_DEFAULTS.minEffectiveHeight);

        const keepPlan = packager.keepWithNext
            ? (session?.getKeepWithNextPlan(packager.actorId) ?? computeKeepWithNextPlan({
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
                isAtPageTop,
                context
            }))
            : null;
        const wholeFormationOverflowHandling = keepPlan
            ? getWholeFormationOverflowHandling(keepPlan, isAtPageTop)
            : null;
        const wholeFormationOverflowFallbackOutcome = wholeFormationOverflowHandling?.fallbackHandling ?? null;
        const wholeFormationOverflowEntry = session && wholeFormationOverflowHandling
            ? session.settleWholeFormationOverflowEntry(
                i,
                session.handleWholeFormationOverflowEntry(
                    wholeFormationOverflowHandling,
                    pages,
                    currentPageBoxes,
                    currentPageIndex,
                    contextBase.pageWidth,
                    contextBase.pageHeight,
                    margins.top
                )
            )
            : null;
        const wholeFormationOverflowAction = session && wholeFormationOverflowEntry
            ? session.toPaginationLoopAction(wholeFormationOverflowEntry)
            : null;
        const wholeFormationTailSplitExecution = wholeFormationOverflowAction?.action === 'continue-tail-split'
            ? wholeFormationOverflowAction.tailSplitExecution
            : (wholeFormationOverflowHandling?.tailSplitExecution ?? null);
        const overflowsCurrentPlacement = keepPlan
            ? wholeFormationOverflowHandling !== null
            : ((effectiveHeight - marginBottom) > effectiveAvailableHeight);

        if (overflowsCurrentPlacement) {
            // Avoid stranding early keepWithNext units by splitting the final splittable unit.
            if (keepPlan && wholeFormationTailSplitExecution) {
                const keepBranchStart = performance.now();
                {
                    const { prefix, splitCandidate, replaceCount, splitMarkerReserve: markerReserve } = wholeFormationTailSplitExecution;
                    const prefixPlacementCheckpoint: ReturnType<LayoutSession['captureLocalBranchSnapshot']> | {
                        boxStartIndex: number;
                        currentY: number;
                        lastSpacingAfter: number;
                    } = session
                        ? session.captureLocalBranchSnapshot(currentPageBoxes, packagers, currentY, lastSpacingAfter)
                        : {
                            boxStartIndex: currentPageBoxes.length,
                            currentY,
                            lastSpacingAfter
                        };

                    if (session) {
                        const placedPrefix = session.placeActorSequence(prefix, {
                            currentY,
                            lastSpacingAfter,
                            pageIndex: currentPageIndex,
                            pageLimit,
                            availableWidth
                        }, contextBase);
                        currentPageBoxes.push(...placedPrefix.boxes);
                        currentY = placedPrefix.currentY;
                        lastSpacingAfter = placedPrefix.lastSpacingAfter;
                    } else {
                        // Place prefix units now.
                        for (const p of prefix) {
                            const pMarginTop = p.getMarginTop();
                            const pMarginBottom = p.getMarginBottom();
                            const pLayoutBefore = resolveLayoutBefore(lastSpacingAfter, pMarginTop);
                            const pLayoutDelta = pLayoutBefore - pMarginTop;
                            const pAvailableHeight = (pageLimit - currentY) - pLayoutDelta;
                            const pContext = {
                                ...contextBase,
                                pageIndex: currentPageIndex,
                                cursorY: currentY
                            };
                            const pBoxes = p.emitBoxes(availableWidth, pAvailableHeight, pContext) || [];
                            for (const box of pBoxes) {
                                box.y = (box.y || 0) + currentY + pLayoutDelta;
                                if (box.meta) box.meta = { ...box.meta, pageIndex: currentPageIndex };
                                currentPageBoxes.push(box);
                            }
                            const pContentHeight = Math.max(0, p.getRequiredHeight() - pMarginTop - pMarginBottom);
                            const pRequiredHeight = pContentHeight + pLayoutBefore + pMarginBottom;
                            const pEffectiveHeight = Math.max(pRequiredHeight, LAYOUT_DEFAULTS.minEffectiveHeight);
                            currentY += pEffectiveHeight - pMarginBottom;
                            lastSpacingAfter = pMarginBottom;
                        }
                    }

                    const splitExecution = session
                        ? session.executePositionedSplitAttempt(
                            splitCandidate,
                            availableWidth,
                            currentY,
                            lastSpacingAfter,
                            pageLimit,
                            currentPageIndex,
                            markerReserve,
                            contextBase
                        )
                        : (() => {
                            const candidateMarginTop = splitCandidate.getMarginTop();
                            const candidateLayoutBefore = resolveLayoutBefore(lastSpacingAfter, candidateMarginTop);
                            const candidateLayoutDelta = candidateLayoutBefore - candidateMarginTop;
                            const emitAvailableHeight = (pageLimit - currentY) - candidateLayoutDelta;
                            const splitContext = {
                                ...contextBase,
                                pageIndex: currentPageIndex,
                                cursorY: currentY
                            };
                            return {
                                execution: {
                                    attempt: {
                                        actor: splitCandidate,
                                        availableWidth,
                                        availableHeight: emitAvailableHeight - markerReserve,
                                        context: splitContext
                                    },
                                    result: splitCandidate.split(emitAvailableHeight - markerReserve, splitContext)
                                },
                                layoutDelta: candidateLayoutDelta,
                                emitAvailableHeight
                            };
                        })();
                    const splitAttempt = splitExecution.execution.attempt;
                    const { currentFragment: partA, continuationFragment: partB } = splitExecution.execution.result;
                    if (partA && partB) {
                        const partAContext = {
                            ...contextBase,
                            pageIndex: currentPageIndex,
                            cursorY: currentY
                        };
                        const partABoxes = partA.emitBoxes(availableWidth, splitExecution.emitAvailableHeight, partAContext) || [];
                        if (session) {
                            const outcome = session.finalizeTailSplitFormation(
                                currentPageBoxes,
                                packagers,
                                i,
                                replaceCount,
                                splitCandidate,
                                partB,
                                splitAttempt,
                                {
                                    currentFragment: partA,
                                    continuationFragment: partB
                                },
                                partABoxes,
                                session.createSplitFragmentAftermathState(partA, {
                                    currentY,
                                    layoutDelta: splitExecution.layoutDelta,
                                    lastSpacingAfter,
                                    pageLimit,
                                    availableWidth,
                                    pageIndex: currentPageIndex
                                }),
                                (marker, markerCurrentY, markerLayoutBefore, markerAvailableWidth, markerPageIndex) =>
                                    (processor as any).positionFlowBox(
                                        marker,
                                        markerCurrentY,
                                        markerLayoutBefore,
                                        margins,
                                        markerAvailableWidth,
                                        markerPageIndex
                                    )
                            );
                            const settlement = session.settleTailSplitFormation(
                                pages,
                                currentPageBoxes,
                                currentPageIndex,
                                contextBase.pageWidth,
                                contextBase.pageHeight,
                                margins.top,
                                i,
                                outcome
                            );
                            applySessionLoopAction(session.toPaginationLoopAction(settlement));
                        } else {
                            const partAMarginTop = partA.getMarginTop();
                            const partAMarginBottom = partA.getMarginBottom();
                            const partALayoutBefore = resolveLayoutBefore(lastSpacingAfter, partAMarginTop);
                            const partAContentHeight = Math.max(0, partA.getRequiredHeight() - partAMarginTop - partAMarginBottom);
                            const partARequiredHeight = partAContentHeight + partALayoutBefore + partAMarginBottom;
                            const partAEffectiveHeight = Math.max(partARequiredHeight, LAYOUT_DEFAULTS.minEffectiveHeight);
                            for (const box of partABoxes) {
                                box.y = (box.y || 0) + currentY + splitExecution.layoutDelta;
                                if (box.meta) box.meta = { ...box.meta, pageIndex: currentPageIndex };
                                currentPageBoxes.push(box);
                            }
                            currentY += partAEffectiveHeight - partAMarginBottom;
                            lastSpacingAfter = partAMarginBottom;
                        }

                        if (getTailSplitPostAttemptOutcome(keepPlan, true, isAtPageTop) === 'page-turn-and-continue') {
                            if (!session) {
                                pushNewPage();
                                packagers.splice(i, replaceCount, partB);
                            }
                            session?.recordProfile('keepWithNextBranchCalls', 1);
                            session?.recordProfile('keepWithNextBranchMs', performance.now() - keepBranchStart);
                            continue;
                        }
                    } else {
                        // Split failed; rollback prefix placement to avoid duplicating keepWithNext units.
                        if (session) {
                            const settlement = session.settleTailSplitFailure(
                                pages,
                                currentPageBoxes,
                                currentPageIndex,
                                contextBase.pageWidth,
                                contextBase.pageHeight,
                                margins.top,
                                i,
                                packagers,
                                prefixPlacementCheckpoint as ReturnType<LayoutSession['captureLocalBranchSnapshot']>,
                                getTailSplitPostAttemptOutcome(keepPlan, false, isAtPageTop) === 'advance-page'
                            );
                            applySessionLoopAction(session.toPaginationLoopAction(settlement));
                        } else {
                            currentPageBoxes.splice(prefixPlacementCheckpoint.boxStartIndex);
                            currentY = prefixPlacementCheckpoint.currentY;
                            lastSpacingAfter = prefixPlacementCheckpoint.lastSpacingAfter;
                        }
                        if (!session && getTailSplitPostAttemptOutcome(keepPlan, false, isAtPageTop) === 'advance-page') {
                            pushNewPage();
                            continue;
                        }
                        if (session && getTailSplitPostAttemptOutcome(keepPlan, false, isAtPageTop) === 'advance-page') {
                            session.recordProfile('keepWithNextBranchCalls', 1);
                            session.recordProfile('keepWithNextBranchMs', performance.now() - keepBranchStart);
                            continue;
                        }
                    }
                session?.recordProfile('keepWithNextBranchCalls', 1);
                session?.recordProfile('keepWithNextBranchMs', performance.now() - keepBranchStart);
                }
            }

            // If a keepWithNext sequence doesn't fit, we push the group to the next page.
            // For single units, we allow the packager to attempt a mid-page split.
            if (wholeFormationOverflowAction?.action === 'continue-loop') {
                applySessionLoopAction(wholeFormationOverflowAction);
                continue;
            }

            if (wholeFormationOverflowFallbackOutcome === 'advance-page') {
                pushNewPage();
                continue;
            }

            if (wholeFormationOverflowFallbackOutcome === 'fallthrough-local-overflow') {
                // Fall through to local single-actor overflow handling.
            }
        }

        if (requiredHeight <= effectiveAvailableHeight) {
            if (session) {
                const outcome = session.attemptActorPlacement(
                    packager,
                    placementFrame,
                    availableWidth,
                    availableHeightAdjusted,
                    context,
                    {
                        currentY,
                        layoutDelta,
                        effectiveHeight,
                        marginBottom,
                        pageIndex: currentPageIndex
                    },
                    constraintField,
                    layoutBefore,
                    pageLimit,
                    margins.top
                );
                const handling = session.settleActorPlacementAttempt(
                    pages,
                    currentPageBoxes,
                    currentPageIndex,
                    contextBase.pageWidth,
                    contextBase.pageHeight,
                    margins.top,
                    i,
                    outcome,
                    currentY,
                    lastSpacingAfter
                );
                applySessionLoopAction(session.toPaginationLoopAction(handling));
                continue;
            }

            const deferredPlacement = (() => {
                    const deferredCursorY = resolveDeferredCursorY(packager);
                    if (deferredCursorY === null) return null;
                    const nextCursorY = deferredCursorY;
                    if (nextCursorY <= currentY + layoutBefore + LAYOUT_DEFAULTS.wrapTolerance) {
                        return {
                            shouldAdvancePage: true,
                            nextCurrentY: currentY
                        };
                    }
                    const nextCurrentY = Math.max(currentY, nextCursorY - layoutBefore);
                    return {
                        shouldAdvancePage: (pageLimit - nextCurrentY) <= 0 && nextCurrentY > margins.top,
                        nextCurrentY
                    };
                })();
            if (deferredPlacement) {
                currentY = deferredPlacement.nextCurrentY;
                if (deferredPlacement.shouldAdvancePage) {
                    pushNewPage();
                }
                continue;
            }
            const boxes = packager.emitBoxes(availableWidth, availableHeightAdjusted, context);
            if (!boxes) {
                pushNewPage();
                continue;
            }
            if (contentBand) {
                const absoluteBoxes = boxes.map((box) => ({
                    ...box,
                    y: (box.y || 0) + currentY + layoutDelta
                }));
                const placementDecision = constraintField.evaluatePlacement(absoluteBoxes, currentY + layoutBefore);
                if (placementDecision.action === 'defer') {
                    currentY = Math.max(currentY, placementDecision.nextCursorY - layoutBefore);
                    availableHeight = pageLimit - currentY;
                    if (availableHeight <= 0 && currentY > margins.top) {
                        pushNewPage();
                    }
                    continue;
                }
            }
            for (const box of boxes) {
                // Adjust box Y to match page absolute Y
                box.y = (box.y || 0) + currentY + layoutDelta;
                if (box.meta) {
                    box.meta = { ...box.meta, pageIndex: currentPageIndex };
                }
                currentPageBoxes.push(box);
            }
            currentY += effectiveHeight - marginBottom;
            lastSpacingAfter = marginBottom;
            i++;
            continue;
        }

        // It doesn't fit
        const overflowIsUnbreakable = packager.isUnbreakable(effectiveAvailableHeight);
        const overflowPreviewBoxes = isAtPageTop
            ? true
            : !!packager.emitBoxes(availableWidth, availableHeightAdjusted, context);
        const isTablePackager = !!(packager as any).flowBox?.properties?._tableModel;
        const isStoryPackager = !!(packager as any).storyElement;
        const allowsMidPageSplit = isTablePackager || isStoryPackager;
        const emptyLayoutBefore = resolveLayoutBefore(0, marginTop);
        const emptyAvailable = pageLimit - margins.top;
        const requiredOnEmpty = contentHeight + emptyLayoutBefore + marginBottom;
        const overflowHandling = getActorOverflowHandling({
            isAtPageTop,
            isUnbreakable: overflowIsUnbreakable,
            hasPreviewBoxes: overflowPreviewBoxes,
            allowsMidPageSplit,
            overflowsEmptyPage: requiredOnEmpty > emptyAvailable + LAYOUT_DEFAULTS.wrapTolerance
        });

        if (
            overflowHandling.preSplitOutcome === 'force-commit-at-top' ||
            overflowHandling.preSplitOutcome === 'advance-page-before-split'
        ) {
            if (session) {
                const markerReserve = session.getSplitMarkerReserve(packager);
                const splitAvailableHeight = availableHeightAdjusted - markerReserve;
                const preSplitBoxes = overflowHandling.preSplitOutcome === 'force-commit-at-top'
                    ? (packager.emitBoxes(availableWidth, availableHeightAdjusted, context) || [])
                    : null;
                const overflowEntry = session.handleActorOverflowEntry(
                    overflowHandling,
                    packager,
                    preSplitBoxes,
                    {
                        currentY,
                        layoutDelta,
                        effectiveHeight,
                        marginBottom,
                        pageIndex: currentPageIndex
                    },
                    availableWidth,
                    splitAvailableHeight,
                    context,
                    currentY,
                    lastSpacingAfter
                );
                if (overflowEntry.action !== 'handled') {
                    throw new Error('Expected handled overflow entry for pre-split outcomes.');
                }
                const settlement = session.settleActorOverflowEntry(
                    pages,
                    currentPageBoxes,
                    currentPageIndex,
                    contextBase.pageWidth,
                    contextBase.pageHeight,
                    margins.top,
                    i,
                    overflowEntry
                );
                if (settlement.action !== 'handled') {
                    throw new Error('Expected handled overflow settlement for pre-split outcomes.');
                }
                applySessionLoopAction(session.toPaginationLoopAction(settlement));
                continue;
            }

            if (overflowHandling.preSplitOutcome === 'force-commit-at-top') {
                // It's unbreakable and we're at the top, we must force it or it's an error.
                // As per design: packager decides the overflow behavior. We just place it.
                const boxes = packager.emitBoxes(availableWidth, availableHeightAdjusted, context);
                if (boxes) {
                    for (const box of boxes) {
                        box.y = (box.y || 0) + currentY + layoutDelta;
                        if (box.meta) {
                            box.meta = { ...box.meta, pageIndex: currentPageIndex };
                        }
                        currentPageBoxes.push(box);
                    }
                    currentY += effectiveHeight - marginBottom;
                    lastSpacingAfter = marginBottom;
                }
                pushNewPage();
                i++;
                continue;
            }

            pushNewPage();
            continue;
        }

        // Let's try to split
        const markerReserve = session?.getSplitMarkerReserve(packager) ?? 0;
        const splitAvailableHeight = availableHeightAdjusted - markerReserve;
        const overflowEntry = session
            ? session.handleActorOverflowEntry(
                overflowHandling,
                packager,
                null,
                {
                    currentY,
                    layoutDelta,
                    effectiveHeight,
                    marginBottom,
                    pageIndex: currentPageIndex
                },
                availableWidth,
                splitAvailableHeight,
                context,
                currentY,
                lastSpacingAfter
            )
            : null;
        if (session && overflowEntry?.action === 'handled') {
            const settlement = session.settleActorOverflowEntry(
                pages,
                currentPageBoxes,
                currentPageIndex,
                contextBase.pageWidth,
                contextBase.pageHeight,
                margins.top,
                i,
                overflowEntry
            );
            if (settlement.action !== 'handled') {
                throw new Error('Expected handled overflow settlement before split.');
            }
            applySessionLoopAction(session.toPaginationLoopAction(settlement));
            continue;
        }
        const splitExecution = overflowEntry?.action === 'continue-to-split'
            ? overflowEntry.splitExecution
            : {
                attempt: {
                    actor: packager,
                    availableWidth,
                    availableHeight: splitAvailableHeight,
                    context
                },
                result: packager.split(splitAvailableHeight, context)
            };
        const splitAttempt = splitExecution.attempt;
        const { currentFragment: fitsCurrent, continuationFragment: pushedNext } = splitExecution.result;

        if (!fitsCurrent) {
            if (session) {
                const boxes = isAtPageTop
                    ? (packager.emitBoxes(availableWidth, availableHeightAdjusted, context) || [])
                    : null;
                const outcome = session.resolveActorSplitFailure(
                    packager,
                    boxes,
                    {
                        currentY,
                        layoutDelta: 0,
                        effectiveHeight,
                        marginBottom,
                        pageIndex: currentPageIndex
                    },
                    isAtPageTop,
                    currentY,
                    lastSpacingAfter
                );
            const settlement = session.settleActorSplitFailure(
                    pages,
                    currentPageBoxes,
                    currentPageIndex,
                    contextBase.pageWidth,
                    contextBase.pageHeight,
                    margins.top,
                i,
                outcome
            );
            applySessionLoopAction(session.toPaginationLoopAction(settlement));
            continue;
            }

            if (isAtPageTop) {
                // Return to avoid infinite loop. It wouldn't split even at top of page.
                // Packager should be forcing if it can't split, but if it returned null,
                // we'll treat it as un-fittable and just force emit.
                const boxes = packager.emitBoxes(availableWidth, availableHeightAdjusted, context) || [];
                requiredHeight = packager.getRequiredHeight();
                for (const box of boxes) {
                    box.y = (box.y || 0) + currentY;
                    if (box.meta) {
                        box.meta = { ...box.meta, pageIndex: currentPageIndex };
                    }
                    currentPageBoxes.push(box);
                }
                pushNewPage();
                i++;
                continue;
            }

            pushNewPage();
            continue;
        }

        // We have a successful split
        const splitContext: PackagerContext = {
            ...contextBase,
            pageIndex: currentPageIndex,
            cursorY: currentY
        };
        const fitsMarginBottom = fitsCurrent.getMarginBottom();
        const fitsMarginTop = fitsCurrent.getMarginTop();
        const fitsLayoutBefore = resolveLayoutBefore(lastSpacingAfter, fitsMarginTop);
        const fitsLayoutDelta = fitsLayoutBefore - fitsMarginTop;
        const fitsEffectiveHeight = Math.max(
            Math.max(0, fitsCurrent.getRequiredHeight() - fitsMarginTop - fitsMarginBottom) +
            fitsLayoutBefore +
            fitsMarginBottom,
            LAYOUT_DEFAULTS.minEffectiveHeight
        );
        const deferredSplitCursorY = resolveDeferredCursorY(fitsCurrent);
            if (deferredSplitCursorY !== null) {
                if (session) {
                    const outcome = session.resolveDeferredSplitPlacement(
                        currentY,
                    deferredSplitCursorY,
                    fitsLayoutBefore,
                    pageLimit,
                    margins.top
                );
                const settlement = session.settleDeferredSplitPlacement(
                    pages,
                    currentPageBoxes,
                    currentPageIndex,
                    contextBase.pageWidth,
                    contextBase.pageHeight,
                    margins.top,
                    i,
                    lastSpacingAfter,
                    outcome
                );
                    applySessionLoopAction(session.toPaginationLoopAction(settlement));
                    continue;
                }
            const nextCursorY = deferredSplitCursorY;
            if (nextCursorY <= currentY + fitsLayoutBefore + LAYOUT_DEFAULTS.wrapTolerance) {
                pushNewPage();
                continue;
            }
            currentY = Math.max(currentY, nextCursorY - fitsLayoutBefore);
            availableHeight = pageLimit - currentY;
            if (availableHeight <= 0 && currentY > margins.top) {
                pushNewPage();
            }
            continue;
        }
        const fitsAvailableHeightAdjusted = availableHeight - fitsLayoutDelta;
        const currentBoxes = fitsCurrent.emitBoxes(availableWidth, fitsAvailableHeightAdjusted, splitContext) || [];
        if (session) {
            const handling = session.handleGenericSplitSuccess(
                currentPageBoxes,
                packagers,
                i,
                packager,
                pushedNext,
                splitAttempt,
                splitExecution.result,
                fitsCurrent,
                currentBoxes,
                session.createSplitFragmentAftermathState(fitsCurrent, {
                    currentY,
                    layoutDelta: fitsLayoutDelta,
                    lastSpacingAfter,
                    pageLimit,
                    availableWidth,
                    pageIndex: currentPageIndex
                }),
                deferredSplitCursorY,
                fitsLayoutBefore,
                pageLimit,
                margins.top,
                (marker, markerCurrentY, markerLayoutBefore, markerAvailableWidth, markerPageIndex) =>
                    (processor as any).positionFlowBox(
                        marker,
                        markerCurrentY,
                        markerLayoutBefore,
                        margins,
                        markerAvailableWidth,
                        markerPageIndex
                    )
            );
                const settlement = session.settleGenericSplitSuccess(
                pages,
                currentPageBoxes,
                currentPageIndex,
                contextBase.pageWidth,
                contextBase.pageHeight,
                margins.top,
                    i,
                    handling
                );
                applySessionLoopAction(session.toPaginationLoopAction(settlement));
                continue;
        } else {
            for (const box of currentBoxes) {
                box.y = (box.y || 0) + currentY + fitsLayoutDelta;
                if (box.meta) {
                    box.meta = { ...box.meta, pageIndex: currentPageIndex };
                }
                currentPageBoxes.push(box);
            }

            currentY += fitsEffectiveHeight - fitsMarginBottom;
            lastSpacingAfter = fitsMarginBottom;
        }
        pushNewPage();

        // The remaining packager takes the place of the current packager but we don't advance i
        if (pushedNext) {
            packagers[i] = pushedNext;
        } else {
            i++;
        }
    }

    if (currentPageBoxes.length > 0) {
        if (session) {
            session.closePagination(
                pages,
                currentPageBoxes,
                currentPageIndex,
                contextBase.pageWidth,
                contextBase.pageHeight
            );
        } else {
            pages.push({
                index: currentPageIndex,
                boxes: currentPageBoxes,
                width: contextBase.pageWidth,
                height: contextBase.pageHeight
            });
        }
    }

    return pages;
}
