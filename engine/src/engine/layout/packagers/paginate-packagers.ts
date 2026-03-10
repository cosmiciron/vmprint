import { performance } from 'node:perf_hooks';
import { Box, Element, Page } from '../../types';
import { LayoutProcessor } from '../layout-core';
import { LAYOUT_DEFAULTS } from '../defaults';
import { computeKeepWithNextPlan } from '../keep-with-next-collaborator';
import { ConstraintField, LayoutSession } from '../layout-session';
import { PackagerContext, PackagerUnit, LayoutBox, preparePackagerForPhase } from './packager-types';

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

    const pageLimit = contextBase.pageHeight - margins.bottom;
    const resolveLayoutBefore = (prevAfter: number, marginTop: number): number =>
        prevAfter + marginTop;
    const placeSplitMarkers = (markers: any[], availableWidth: number): void => {
        for (const marker of markers) {
            const markerLayoutBefore = resolveLayoutBefore(lastSpacingAfter, marker.marginTop || 0);
            const markerTotalHeight =
                Math.max(0, marker.measuredContentHeight || 0) +
                markerLayoutBefore +
                Math.max(0, marker.marginBottom || 0);
            if (currentY + markerTotalHeight > pageLimit + LAYOUT_DEFAULTS.wrapTolerance) {
                continue;
            }
            const positioned = (processor as any).positionFlowBox(
                marker,
                currentY,
                markerLayoutBefore,
                margins,
                availableWidth,
                currentPageIndex
            );
            const markerBoxes = Array.isArray(positioned) ? positioned : [positioned];
            for (const box of markerBoxes) {
                if (box.meta) box.meta = { ...box.meta, pageIndex: currentPageIndex };
                currentPageBoxes.push(box);
            }
            const markerEffectiveHeight = Math.max(markerTotalHeight, LAYOUT_DEFAULTS.minEffectiveHeight);
            currentY += markerEffectiveHeight - Math.max(0, marker.marginBottom || 0);
            lastSpacingAfter = Math.max(0, marker.marginBottom || 0);
        }
    };

    session?.notifyPageStart(currentPageIndex, contextBase.pageWidth, contextBase.pageHeight, currentPageBoxes);

    const pushNewPage = () => {
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
        session?.notifyPageStart(currentPageIndex, contextBase.pageWidth, contextBase.pageHeight, currentPageBoxes);
    };

    let i = 0;
    while (i < packagers.length) {
        const packager = packagers[i];

        let availableWidth = contextBase.pageWidth - margins.left - margins.right;
        let availableHeight = pageLimit - currentY;

        // Ensure minimum valid space for checking if we can fit at all
        if (availableHeight <= 0 && currentY > margins.top) {
            pushNewPage();
            continue;
        }

        const isAtPageTop = currentY === margins.top && currentPageBoxes.length === 0;

        if (packager.pageBreakBefore && !isAtPageTop) {
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
        const placementSurface = constraintField.resolvePlacementSurface(currentY + layoutBefore);
        session?.recordProfile('exclusionBlockedCursorCalls', 1);
        session?.recordProfile('exclusionBandResolutionCalls', 1);
        const placementSurfaceDuration = performance.now() - placementSurfaceStart;
        session?.recordProfile('exclusionBlockedCursorMs', placementSurfaceDuration);
        session?.recordProfile('exclusionBandResolutionMs', placementSurfaceDuration);
        if (placementSurface.cursorY > currentY + layoutBefore + LAYOUT_DEFAULTS.wrapTolerance) {
            currentY = placementSurface.cursorY - layoutBefore;
            availableHeight = pageLimit - currentY;
            if (availableHeight <= 0 && currentY > margins.top) {
                pushNewPage();
                continue;
            }
        }
        const contentBand = placementSurface.contentBand;
        if (contentBand) {
            session?.recordProfile('exclusionLaneApplications', 1);
        }
        const laneLeftOffset = contentBand?.xOffset ?? 0;
        const laneRightOffset = Math.max(0, (constraintField.availableWidth - laneLeftOffset) - (contentBand?.width ?? constraintField.availableWidth));
        const laneMargins = contentBand
            ? {
                ...margins,
                left: margins.left + laneLeftOffset,
                right: margins.right + laneRightOffset
            }
            : margins;
        availableWidth = contentBand?.width ?? availableWidth;
        const context: PackagerContext = {
            ...contextBase,
            pageIndex: currentPageIndex,
            cursorY: currentY,
            margins: laneMargins
        };
        session?.setPaginationLoopState({
            actorQueue: packagers,
            actorIndex: i,
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
                availableWidth,
                availableHeight: effectiveAvailableHeight,
                lastSpacingAfter,
                isAtPageTop,
                context
            }))
            : null;
        const sequence = keepPlan?.sequence ?? [packager];
        const sequenceHeight = keepPlan?.sequenceHeight ?? (effectiveHeight - marginBottom);
        const fitsOnCurrent = keepPlan?.fitsOnCurrent ?? (sequenceHeight <= effectiveAvailableHeight);

        if (!fitsOnCurrent) {
            // Avoid stranding early keepWithNext units by splitting the final splittable unit.
            if (sequence.length > 1 && packager.keepWithNext && !isAtPageTop) {
                const keepBranchStart = performance.now();
                const prefixHeight = keepPlan!.prefixHeight;
                const prefixFits = keepPlan!.prefixFits;
                const prefix = keepPlan!.prefix;
                const splitCandidate = keepPlan!.splitCandidate;

                if (prefixFits && splitCandidate && !splitCandidate.isUnbreakable(effectiveAvailableHeight - prefixHeight)) {
                    let continuation: any = null;
                    let markerReserve = 0;
                    continuation = session?.getContinuationArtifacts(splitCandidate.actorId);
                    if (!continuation) {
                        const splitFlowBox = (splitCandidate as any).flowBox;
                        const continuationSpec =
                            splitFlowBox?.properties?.paginationContinuation ??
                            splitFlowBox?._sourceElement?.properties?.paginationContinuation;
                        if (continuationSpec) {
                            if (splitFlowBox && splitFlowBox.properties && splitFlowBox.properties.paginationContinuation === undefined) {
                                splitFlowBox.properties.paginationContinuation = continuationSpec;
                            }
                            continuation = (processor as any).getContinuationArtifacts(splitFlowBox);
                        }
                    }
                    if (continuation?.markerAfterSplit) {
                        const marker = continuation.markerAfterSplit;
                        markerReserve =
                            Math.max(0, marker.measuredContentHeight || 0) +
                            Math.max(0, marker.marginTop || 0) +
                            Math.max(0, marker.marginBottom || 0);
                    }

                    const prefixStartIndex = currentPageBoxes.length;
                    const prefixStartY = currentY;
                    const prefixStartSpacing = lastSpacingAfter;

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

                    const candidateMarginTop = splitCandidate.getMarginTop();
                    const candidateMarginBottom = splitCandidate.getMarginBottom();
                    const candidateLayoutBefore = resolveLayoutBefore(lastSpacingAfter, candidateMarginTop);
                    const candidateLayoutDelta = candidateLayoutBefore - candidateMarginTop;
                    const candidateAvailable = (pageLimit - currentY) - candidateLayoutDelta - markerReserve;
                    const splitContext = {
                        ...contextBase,
                        pageIndex: currentPageIndex,
                        cursorY: currentY
                    };
                    const splitAttempt = {
                        actor: splitCandidate,
                        availableWidth,
                        availableHeight: candidateAvailable,
                        context: splitContext
                    };
                    session?.notifySplitAttempt(splitAttempt);
                    const { currentFragment: partA, continuationFragment: partB } = splitCandidate.split(candidateAvailable, splitContext);
                    if (partA && partB) {
                        session?.notifySplitAccepted(splitAttempt, {
                            currentFragment: partA,
                            continuationFragment: partB
                        });
                        const partAContext = {
                            ...contextBase,
                            pageIndex: currentPageIndex,
                            cursorY: currentY
                        };
                        const partABoxes = partA.emitBoxes(availableWidth, (pageLimit - currentY) - candidateLayoutDelta, partAContext) || [];
                        for (const box of partABoxes) {
                            box.y = (box.y || 0) + currentY + candidateLayoutDelta;
                            if (box.meta) box.meta = { ...box.meta, pageIndex: currentPageIndex };
                            currentPageBoxes.push(box);
                        }
                        const partAMarginTop = partA.getMarginTop();
                        const partAMarginBottom = partA.getMarginBottom();
                        const partALayoutBefore = resolveLayoutBefore(lastSpacingAfter, partAMarginTop);
                        const partAContentHeight = Math.max(0, partA.getRequiredHeight() - partAMarginTop - partAMarginBottom);
                        const partARequiredHeight = partAContentHeight + partALayoutBefore + partAMarginBottom;
                        const partAEffectiveHeight = Math.max(partARequiredHeight, LAYOUT_DEFAULTS.minEffectiveHeight);
                        currentY += partAEffectiveHeight - partAMarginBottom;
                        lastSpacingAfter = partAMarginBottom;
                        placeSplitMarkers(session?.consumeMarkersAfterSplit(partA.actorId) ?? [], availableWidth);

                        pushNewPage();
                        if (partB) {
                            session?.notifyContinuationEnqueued(splitCandidate, partB);
                        }
                        const stagedActors = partB ? (session?.consumeActorsBeforeContinuation(partB.actorId) ?? []) : [];
                        if (stagedActors.length > 0) {
                            packagers.splice(i, sequence.length, ...stagedActors, partB);
                        } else {
                            packagers.splice(i, sequence.length, partB);
                        }
                        session?.recordProfile('keepWithNextBranchCalls', 1);
                        session?.recordProfile('keepWithNextBranchMs', performance.now() - keepBranchStart);
                        continue;
                    } else {
                        // Split failed; rollback prefix placement to avoid duplicating keepWithNext units.
                        currentPageBoxes.splice(prefixStartIndex);
                        currentY = prefixStartY;
                        lastSpacingAfter = prefixStartSpacing;
                    }
                }
                session?.recordProfile('keepWithNextBranchCalls', 1);
                session?.recordProfile('keepWithNextBranchMs', performance.now() - keepBranchStart);
            }

            // If a keepWithNext sequence doesn't fit, we push the group to the next page.
            // For single units, we allow the packager to attempt a mid-page split.
            if (!isAtPageTop && sequence.length > 1) {
                pushNewPage();
                continue;
            }
        }

        if (requiredHeight <= effectiveAvailableHeight) {
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
            // It fits!
            for (const box of boxes) {
                // Adjust box Y to match page absolute Y
                box.y = (box.y || 0) + currentY + layoutDelta;
                if (box.meta) {
                    box.meta = { ...box.meta, pageIndex: currentPageIndex };
                }
                currentPageBoxes.push(box);
            }
            session?.notifyActorCommitted(packager, boxes);
            currentY += effectiveHeight - marginBottom;
            lastSpacingAfter = marginBottom;
            i++;
            continue;
        }

        // It doesn't fit
        if (isAtPageTop) {
            if (packager.isUnbreakable(effectiveAvailableHeight)) {
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
                    session?.notifyActorCommitted(packager, boxes);
                    currentY += effectiveHeight - marginBottom;
                    lastSpacingAfter = marginBottom;
                }
                pushNewPage();
                i++;
                continue;
            }
        } else {
            const previewBoxes = packager.emitBoxes(availableWidth, availableHeightAdjusted, context);
            if (packager.isUnbreakable(effectiveAvailableHeight) || !previewBoxes) {
                // Try on a new page
                pushNewPage();
                continue;
            }
        }

        // If it would overflow even an empty page, force a new page so the split happens at page top.
        if (!isAtPageTop) {
            const isTablePackager = !!(packager as any).flowBox?.properties?._tableModel;
            const isStoryPackager = !!(packager as any).storyElement;
            if (isTablePackager || isStoryPackager) {
                // Tables and stories are allowed to split mid-page.
                // Skip the page-top split forcing.
            } else {
            const emptyLayoutBefore = resolveLayoutBefore(0, marginTop);
            const emptyAvailable = pageLimit - margins.top;
            const requiredOnEmpty = contentHeight + emptyLayoutBefore + marginBottom;
            if (requiredOnEmpty > emptyAvailable + LAYOUT_DEFAULTS.wrapTolerance) {
                pushNewPage();
                continue;
            }
            }
        }

        // Let's try to split
        let continuation: any = null;
        let markerReserve = 0;
        continuation = session?.getContinuationArtifacts(packager.actorId);
        if (!continuation) {
            const flowBox = (packager as any).flowBox;
            const continuationSpec = flowBox?.properties?.paginationContinuation ?? flowBox?._sourceElement?.properties?.paginationContinuation;
            if (continuationSpec) {
                if (flowBox && flowBox.properties && flowBox.properties.paginationContinuation === undefined) {
                    flowBox.properties.paginationContinuation = continuationSpec;
                }
                continuation = (processor as any).getContinuationArtifacts(flowBox);
            }
        }
        if (continuation?.markerAfterSplit) {
            const marker = continuation.markerAfterSplit;
            markerReserve =
                Math.max(0, marker.measuredContentHeight || 0) +
                Math.max(0, marker.marginTop || 0) +
                Math.max(0, marker.marginBottom || 0);
        }

        const splitAvailableHeight = availableHeightAdjusted - markerReserve;
        const splitAttempt = {
            actor: packager,
            availableWidth,
            availableHeight: splitAvailableHeight,
            context
        };
        session?.notifySplitAttempt(splitAttempt);
        const { currentFragment: fitsCurrent, continuationFragment: pushedNext } = packager.split(splitAvailableHeight, context);

        if (!fitsCurrent) {
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
                session?.notifyActorCommitted(packager, boxes);
                pushNewPage();
                i++;
                continue;
            } else {
                pushNewPage();
                continue;
            }
        }

        // We have a successful split
        session?.notifySplitAccepted(splitAttempt, {
            currentFragment: fitsCurrent,
            continuationFragment: pushedNext
        });
        const splitContext: PackagerContext = {
            ...contextBase,
            pageIndex: currentPageIndex,
            cursorY: currentY
        };
        const fitsMarginTop = fitsCurrent.getMarginTop();
        const fitsMarginBottom = fitsCurrent.getMarginBottom();
        const fitsLayoutBefore = resolveLayoutBefore(lastSpacingAfter, fitsMarginTop);
        const fitsLayoutDelta = fitsLayoutBefore - fitsMarginTop;
        const fitsContentHeight = Math.max(0, fitsCurrent.getRequiredHeight() - fitsMarginTop - fitsMarginBottom);
        const fitsRequiredHeight = fitsContentHeight + fitsLayoutBefore + fitsMarginBottom;
        const fitsEffectiveHeight = Math.max(fitsRequiredHeight, LAYOUT_DEFAULTS.minEffectiveHeight);
        const fitsAvailableHeightAdjusted = availableHeight - fitsLayoutDelta;
        const currentBoxes = fitsCurrent.emitBoxes(availableWidth, fitsAvailableHeightAdjusted, splitContext) || [];
        for (const box of currentBoxes) {
            box.y = (box.y || 0) + currentY + fitsLayoutDelta;
            if (box.meta) {
                box.meta = { ...box.meta, pageIndex: currentPageIndex };
            }
            currentPageBoxes.push(box);
        }
        session?.notifyActorCommitted(fitsCurrent, currentBoxes);

        currentY += fitsEffectiveHeight - fitsMarginBottom;
        lastSpacingAfter = fitsMarginBottom;
        placeSplitMarkers(session?.consumeMarkersAfterSplit(fitsCurrent.actorId) ?? [], availableWidth);
        pushNewPage();

        // The remaining packager takes the place of the current packager but we don't advance i
        if (pushedNext) {
            session?.notifyContinuationEnqueued(packager, pushedNext);
            const stagedActors = session?.consumeActorsBeforeContinuation(pushedNext.actorId) ?? [];
            if (stagedActors.length > 0) {
                packagers.splice(i, 1, ...stagedActors, pushedNext);
            } else {
                packagers[i] = pushedNext;
            }
        } else {
            i++;
        }
    }

    if (currentPageBoxes.length > 0) {
        pages.push({
            index: currentPageIndex,
            boxes: currentPageBoxes,
            width: contextBase.pageWidth,
            height: contextBase.pageHeight
        });
    }

    return pages;
}
