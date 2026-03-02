import { Box, Element, Page } from '../../types';
import { LayoutProcessor } from '../layout-core';
import { LAYOUT_DEFAULTS } from '../defaults';
import { PackagerContext, PackagerUnit, LayoutBox } from './packager-types';
import { FlowBoxPackager } from './flow-box-packager';

export function paginatePackagers(
    processor: LayoutProcessor,
    packagers: PackagerUnit[],
    contextBase: Omit<PackagerContext, 'pageIndex' | 'cursorY'>,
): Page[] {
    const pages: Page[] = [];
    let currentPageBoxes: LayoutBox[] = [];
    let currentPageIndex = 0;

    const margins = contextBase.margins;
    let currentY = margins.top;
    let lastSpacingAfter = 0;

    const pageLimit = contextBase.pageHeight - margins.bottom;
    const resolveLayoutBefore = (prevAfter: number, marginTop: number): number => Math.max(prevAfter, marginTop);

    const pushNewPage = () => {
        if (currentPageBoxes.length > 0) {
            pages.push({
                index: currentPageIndex,
                boxes: currentPageBoxes,
                width: contextBase.pageWidth,
                height: contextBase.pageHeight,
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

        const context: PackagerContext = {
            ...contextBase,
            pageIndex: currentPageIndex,
            cursorY: currentY,
        };

        const availableWidth = contextBase.pageWidth - margins.left - margins.right;
        const availableHeight = pageLimit - currentY;

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
        const availableHeightAdjusted = availableHeight - layoutDelta;

        let boxes = packager.emitBoxes(availableWidth, availableHeightAdjusted, context);
        const contentHeight = Math.max(0, packager.getRequiredHeight() - marginTop - marginBottom);
        let requiredHeight = contentHeight + layoutBefore + marginBottom;
        const effectiveHeight = Math.max(requiredHeight, LAYOUT_DEFAULTS.minEffectiveHeight);

        // V1 Parity: Gather the sequence
        const sequence: PackagerUnit[] = [packager];
        let sequenceHeight = 0;
        let tempLastSpacing = lastSpacingAfter;
        let j = i;
        while (j < packagers.length && packagers[j].keepWithNext && j + 1 < packagers.length) {
            const nextPackager = packagers[j + 1];
            nextPackager.emitBoxes(availableWidth, 999999, context);
            sequence.push(nextPackager);
            j++;
        }

        for (const unit of sequence) {
            const unitMarginTop = unit.getMarginTop();
            const unitMarginBottom = unit.getMarginBottom();
            const unitLayoutBefore = resolveLayoutBefore(tempLastSpacing, unitMarginTop);
            const unitContentHeight = Math.max(0, unit.getRequiredHeight() - unitMarginTop - unitMarginBottom);
            const unitRequiredHeight = unitContentHeight + unitLayoutBefore + unitMarginBottom;
            const unitEffectiveHeight = Math.max(unitRequiredHeight, LAYOUT_DEFAULTS.minEffectiveHeight);
            sequenceHeight += unitEffectiveHeight - unitMarginBottom;
            tempLastSpacing = unitMarginBottom;
        }

        const fitsOnCurrent = sequenceHeight <= availableHeight;

        if (!fitsOnCurrent) {
            // Avoid stranding early keepWithNext units by splitting the final splittable unit.
            if (sequence.length > 1 && packager.keepWithNext && !isAtPageTop) {
                let prefixHeight = 0;
                let prefixFits = true;
                const prefix = sequence.slice(0, -1);
                const splitCandidate = sequence[sequence.length - 1];

                let prefixLastSpacing = lastSpacingAfter;
                for (const p of prefix) {
                    const pMarginTop = p.getMarginTop();
                    const pMarginBottom = p.getMarginBottom();
                    const pLayoutBefore = resolveLayoutBefore(prefixLastSpacing, pMarginTop);
                    const pContentHeight = Math.max(0, p.getRequiredHeight() - pMarginTop - pMarginBottom);
                    const pRequiredHeight = pContentHeight + pLayoutBefore + pMarginBottom;
                    const pEffectiveHeight = Math.max(pRequiredHeight, LAYOUT_DEFAULTS.minEffectiveHeight);
                    prefixHeight += pEffectiveHeight - pMarginBottom;
                    prefixLastSpacing = pMarginBottom;
                    if (prefixHeight > availableHeight) {
                        prefixFits = false;
                        break;
                    }
                }

                if (prefixFits && !splitCandidate.isUnbreakable(availableHeight - prefixHeight)) {
                    const splitFlowBox = (splitCandidate as any).flowBox;
                    let continuation: any = null;
                    let markerReserve = 0;
                    const continuationSpec =
                        splitFlowBox?.properties?.paginationContinuation ??
                        splitFlowBox?._sourceElement?.properties?.paginationContinuation;
                    if (continuationSpec) {
                        if (
                            splitFlowBox &&
                            splitFlowBox.properties &&
                            splitFlowBox.properties.paginationContinuation === undefined
                        ) {
                            splitFlowBox.properties.paginationContinuation = continuationSpec;
                        }
                        continuation = (processor as any).getContinuationArtifacts(splitFlowBox);
                        if (continuation?.markerAfterSplit) {
                            const marker = continuation.markerAfterSplit;
                            markerReserve =
                                Math.max(0, marker.measuredContentHeight || 0) +
                                Math.max(0, marker.marginTop || 0) +
                                Math.max(0, marker.marginBottom || 0);
                        }
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
                        const pAvailableHeight = pageLimit - currentY - pLayoutDelta;
                        const pContext = {
                            ...contextBase,
                            pageIndex: currentPageIndex,
                            cursorY: currentY,
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
                    const candidateAvailable = pageLimit - currentY - candidateLayoutDelta - markerReserve;
                    const splitContext = {
                        ...contextBase,
                        pageIndex: currentPageIndex,
                        cursorY: currentY,
                    };
                    const [partA, partB] = splitCandidate.split(candidateAvailable, splitContext);
                    if (partA && partB) {
                        const partAContext = {
                            ...contextBase,
                            pageIndex: currentPageIndex,
                            cursorY: currentY,
                        };
                        const partABoxes =
                            partA.emitBoxes(
                                availableWidth,
                                pageLimit - currentY - candidateLayoutDelta,
                                partAContext,
                            ) || [];
                        for (const box of partABoxes) {
                            box.y = (box.y || 0) + currentY + candidateLayoutDelta;
                            if (box.meta) box.meta = { ...box.meta, pageIndex: currentPageIndex };
                            currentPageBoxes.push(box);
                        }
                        const partAMarginTop = partA.getMarginTop();
                        const partAMarginBottom = partA.getMarginBottom();
                        const partALayoutBefore = resolveLayoutBefore(lastSpacingAfter, partAMarginTop);
                        const partAContentHeight = Math.max(
                            0,
                            partA.getRequiredHeight() - partAMarginTop - partAMarginBottom,
                        );
                        const partARequiredHeight = partAContentHeight + partALayoutBefore + partAMarginBottom;
                        const partAEffectiveHeight = Math.max(partARequiredHeight, LAYOUT_DEFAULTS.minEffectiveHeight);
                        currentY += partAEffectiveHeight - partAMarginBottom;
                        lastSpacingAfter = partAMarginBottom;

                        if (continuation?.markerAfterSplit) {
                            const marker = continuation.markerAfterSplit;
                            const markerLayoutBefore = resolveLayoutBefore(lastSpacingAfter, marker.marginTop || 0);
                            const markerTotalHeight =
                                Math.max(0, marker.measuredContentHeight || 0) +
                                markerLayoutBefore +
                                Math.max(0, marker.marginBottom || 0);
                            if (currentY + markerTotalHeight <= pageLimit + LAYOUT_DEFAULTS.wrapTolerance) {
                                const positioned = (processor as any).positionFlowBox(
                                    marker,
                                    currentY,
                                    markerLayoutBefore,
                                    margins,
                                    availableWidth,
                                    currentPageIndex,
                                );
                                const markerBoxes = Array.isArray(positioned) ? positioned : [positioned];
                                for (const box of markerBoxes) {
                                    if (box.meta) box.meta = { ...box.meta, pageIndex: currentPageIndex };
                                    currentPageBoxes.push(box);
                                }
                                const markerEffectiveHeight = Math.max(
                                    markerTotalHeight,
                                    LAYOUT_DEFAULTS.minEffectiveHeight,
                                );
                                currentY += markerEffectiveHeight - Math.max(0, marker.marginBottom || 0);
                                lastSpacingAfter = Math.max(0, marker.marginBottom || 0);
                            }
                        }

                        pushNewPage();
                        if (continuation?.markersBeforeContinuation?.length > 0) {
                            const markerPackagers = continuation.markersBeforeContinuation.map(
                                (marker: any) => new FlowBoxPackager(processor, marker),
                            );
                            packagers.splice(i, sequence.length, ...markerPackagers, partB);
                        } else {
                            packagers.splice(i, sequence.length, partB);
                        }
                        continue;
                    } else {
                        // Split failed; rollback prefix placement to avoid duplicating keepWithNext units.
                        currentPageBoxes.splice(prefixStartIndex);
                        currentY = prefixStartY;
                        lastSpacingAfter = prefixStartSpacing;
                    }
                }
            }

            // If a keepWithNext sequence doesn't fit, we push the group to the next page.
            // For single units, we allow the packager to attempt a mid-page split.
            if (!isAtPageTop && sequence.length > 1) {
                pushNewPage();
                continue;
            }
        }

        if (boxes && requiredHeight <= availableHeight) {
            // It fits!
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
        if (isAtPageTop) {
            if (packager.isUnbreakable(availableHeight)) {
                // It's unbreakable and we're at the top, we must force it or it's an error.
                // As per design: packager decides the overflow behavior. We just place it.
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
        } else {
            if (packager.isUnbreakable(availableHeight) || !boxes) {
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
        const flowBox = (packager as any).flowBox;
        let continuation: any = null;
        let markerReserve = 0;
        const continuationSpec =
            flowBox?.properties?.paginationContinuation ?? flowBox?._sourceElement?.properties?.paginationContinuation;
        if (continuationSpec) {
            if (flowBox && flowBox.properties && flowBox.properties.paginationContinuation === undefined) {
                flowBox.properties.paginationContinuation = continuationSpec;
            }
            continuation = (processor as any).getContinuationArtifacts(flowBox);
            if (continuation?.markerAfterSplit) {
                const marker = continuation.markerAfterSplit;
                markerReserve =
                    Math.max(0, marker.measuredContentHeight || 0) +
                    Math.max(0, marker.marginTop || 0) +
                    Math.max(0, marker.marginBottom || 0);
            }
        }

        const splitAvailableHeight = availableHeightAdjusted - markerReserve;
        const [fitsCurrent, pushedNext] = packager.split(splitAvailableHeight, context);

        if (!fitsCurrent) {
            if (isAtPageTop) {
                // Return to avoid infinite loop. It wouldn't split even at top of page.
                // Packager should be forcing if it can't split, but if it returned null,
                // we'll treat it as un-fittable and just force emit.
                boxes = packager.emitBoxes(availableWidth, availableHeight, context) || [];
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
            } else {
                pushNewPage();
                continue;
            }
        }

        // We have a successful split
        const splitContext: PackagerContext = {
            ...contextBase,
            pageIndex: currentPageIndex,
            cursorY: currentY,
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

        currentY += fitsEffectiveHeight - fitsMarginBottom;
        lastSpacingAfter = fitsMarginBottom;

        if (continuation?.markerAfterSplit) {
            const marker = continuation.markerAfterSplit;
            const markerLayoutBefore = resolveLayoutBefore(lastSpacingAfter, marker.marginTop || 0);
            const markerTotalHeight =
                Math.max(0, marker.measuredContentHeight || 0) +
                markerLayoutBefore +
                Math.max(0, marker.marginBottom || 0);

            if (currentY + markerTotalHeight <= pageLimit + LAYOUT_DEFAULTS.wrapTolerance) {
                const positioned = (processor as any).positionFlowBox(
                    marker,
                    currentY,
                    markerLayoutBefore,
                    margins,
                    availableWidth,
                    currentPageIndex,
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
        }
        pushNewPage();

        // The remaining packager takes the place of the current packager but we don't advance i
        if (pushedNext) {
            if (continuation?.markersBeforeContinuation?.length > 0) {
                const markerPackagers = continuation.markersBeforeContinuation.map(
                    (marker: any) => new FlowBoxPackager(processor, marker),
                );
                packagers.splice(i, 1, ...markerPackagers, pushedNext);
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
            height: contextBase.pageHeight,
        });
    }

    return pages;
}
