import type { Box, Page } from '../types';
import type { ContinuationArtifacts, FlowBox } from './layout-core-types';
import { LAYOUT_DEFAULTS } from './defaults';
import type { PackagerContext } from './packagers/packager-types';
import type { PackagerSplitResult, PackagerUnit } from './packagers/packager-types';
import type {
    AcceptedSplitQueueHandling,
    ActorSplitFailureResolution,
    ActorSplitFailureSettlementOutcome,
    ContinuationQueueOutcome,
    DeferredSplitPlacementOutcome,
    DeferredSplitPlacementSettlementOutcome,
    ExecuteSpeculativeBranchInput,
    GenericSplitOutcome,
    GenericSplitSuccessHandlingOutcome,
    GenericSplitSuccessSettlementOutcome,
    LocalBranchSnapshot,
    PageAdvanceOutcome,
    SpeculativeBranchReason,
    SplitExecution,
    SplitAttempt,
    SplitFragmentAftermathState,
    TailSplitFailureSettlementOutcome,
    TailSplitFormationOutcome
    ,
    TailSplitFormationSettlementOutcome
} from './layout-session-types';

type SplitMarkerPositioner = (
    marker: FlowBox,
    currentY: number,
    layoutBefore: number,
    availableWidth: number,
    pageIndex: number
) => Box | Box[];

type ContinuationArtifactProvider = {
    getContinuationArtifacts?(box: FlowBox): ContinuationArtifacts | undefined;
};

type PackagerWithFlowBox = PackagerUnit & {
    flowBox?: FlowBox;
};

type PackagerWithProcessor = PackagerUnit & {
    processor?: ContinuationArtifactProvider;
};

export type TransitionsRuntimeHost = {
    getContinuationArtifacts(actorId: string): ContinuationArtifacts | undefined;
    setContinuationArtifacts(actorId: string, artifacts: ContinuationArtifacts): void;
    executeSpeculativeBranch<T>(input: ExecuteSpeculativeBranchInput<T>): {
        accepted: boolean;
        value?: T;
        currentY: number;
        lastSpacingAfter: number;
    };
    captureLocalBranchSnapshot(
        pageBoxes: readonly Box[],
        actorQueue: readonly PackagerUnit[],
        currentY: number,
        lastSpacingAfter: number
    ): LocalBranchSnapshot;
    acceptAndCommitSplitFragment(
        attempt: SplitAttempt,
        result: PackagerSplitResult,
        boxes: readonly Box[],
        state: SplitFragmentAftermathState,
        positionMarker: SplitMarkerPositioner
    ): { boxes: Box[]; currentY: number; lastSpacingAfter: number };
    settleContinuationQueue(
        actorQueue: PackagerUnit[],
        startIndex: number,
        replaceCount: number,
        predecessor: PackagerUnit,
        continuation: PackagerUnit | null | undefined,
        options?: { notify?: boolean }
    ): ContinuationQueueOutcome;
    rollbackAcceptedSplitBranch(
        pageBoxes: Box[],
        actorQueue: PackagerUnit[],
        snapshot: LocalBranchSnapshot
    ): { currentY: number; lastSpacingAfter: number };
    restoreLocalBranchSnapshot(
        pageBoxes: Box[],
        actorQueue: PackagerUnit[],
        snapshot: LocalBranchSnapshot
    ): { currentY: number; lastSpacingAfter: number };
    placeActorSequence(
        actors: readonly PackagerUnit[],
        state: {
            currentY: number;
            lastSpacingAfter: number;
            pageIndex: number;
            pageLimit: number;
            availableWidth: number;
        },
        contextBase: Omit<PackagerContext, 'pageIndex' | 'cursorY'>
    ): { boxes: Box[]; currentY: number; lastSpacingAfter: number };
    executePositionedSplitAttempt(
        actor: PackagerUnit,
        availableWidth: number,
        currentY: number,
        lastSpacingAfter: number,
        pageLimit: number,
        pageIndex: number,
        markerReserve: number,
        contextBase: Omit<PackagerContext, 'pageIndex' | 'cursorY'>
    ): {
        execution: {
            attempt: SplitAttempt;
            result: PackagerSplitResult;
        };
        layoutDelta: number;
        emitAvailableHeight: number;
    };
    createSplitFragmentAftermathState(
        actor: PackagerUnit,
        input: {
            currentY: number;
            layoutDelta: number;
            lastSpacingAfter: number;
            pageLimit: number;
            availableWidth: number;
            pageIndex: number;
        }
    ): SplitFragmentAftermathState;
    advancePage(
        pages: Page[],
        currentPageBoxes: Box[],
        currentPageIndex: number,
        pageWidth: number,
        pageHeight: number,
        nextPageTopY: number
    ): PageAdvanceOutcome;
    resolveNextActorIndex(currentIndex: number, shouldAdvanceIndex: boolean): number;
    resolveActorSplitFailure(
        actor: PackagerUnit,
        boxes: readonly Box[] | null,
        state: {
            currentY: number;
            layoutDelta: number;
            effectiveHeight: number;
            marginBottom: number;
            pageIndex: number;
        },
        forceCommitAtPageTop: boolean,
        currentY: number,
        lastSpacingAfter: number
    ): ActorSplitFailureResolution;
};

export class TransitionsRuntime {
    constructor(
        private readonly host: TransitionsRuntimeHost
    ) { }

    getAcceptedSplitQueueHandling(preview: ContinuationQueueOutcome): AcceptedSplitQueueHandling {
        return {
            shouldAdvanceIndex: !preview.continuationInstalled
        };
    }

    ensureContinuationArtifacts(actor: PackagerUnit): ContinuationArtifacts | undefined {
        const cached = this.host.getContinuationArtifacts(actor.actorId);
        if (cached) return cached;

        const resolved = this.resolveContinuationArtifacts(actor);
        if (resolved) {
            this.host.setContinuationArtifacts(actor.actorId, resolved);
        }
        return resolved;
    }

    getSplitMarkerReserve(actor: PackagerUnit): number {
        const artifacts = this.ensureContinuationArtifacts(actor);
        const marker = artifacts?.markerAfterSplit;
        if (!marker) return 0;

        return (
            Math.max(0, marker.measuredContentHeight || 0) +
            Math.max(0, marker.marginTop || 0) +
            Math.max(0, marker.marginBottom || 0)
        );
    }

    previewAcceptedSplitSettlement(
        pageBoxes: readonly Box[],
        actorQueue: PackagerUnit[],
        startIndex: number,
        replaceCount: number,
        predecessor: PackagerUnit,
        continuation: PackagerUnit | null | undefined,
        attempt: SplitAttempt,
        result: PackagerSplitResult,
        boxes: readonly Box[],
        state: SplitFragmentAftermathState,
        positionMarker: SplitMarkerPositioner
    ): { queuePreview: ContinuationQueueOutcome; queueHandling: AcceptedSplitQueueHandling } {
        const transaction = this.host.executeSpeculativeBranch({
            reason: 'continuation-queue-preview',
            pageBoxes: pageBoxes as Box[],
            actorQueue,
            currentY: state.currentY,
            lastSpacingAfter: state.lastSpacingAfter,
            currentPageIndex: state.pageIndex,
            run: () => {
                this.host.acceptAndCommitSplitFragment(
                    attempt,
                    result,
                    boxes,
                    state,
                    positionMarker
                );
                const queuePreview = this.host.settleContinuationQueue(
                    actorQueue,
                    startIndex,
                    replaceCount,
                    predecessor,
                    continuation,
                    { notify: false }
                );
                return {
                    accept: false,
                    value: {
                        queuePreview,
                        queueHandling: this.getAcceptedSplitQueueHandling(queuePreview)
                    }
                };
            }
        });

        return transaction.value!;
    }

    finalizeTailSplitFormation(
        pageBoxes: readonly Box[],
        actorQueue: PackagerUnit[],
        startIndex: number,
        replaceCount: number,
        predecessor: PackagerUnit,
        continuation: PackagerUnit | null | undefined,
        attempt: SplitAttempt,
        result: PackagerSplitResult,
        boxes: readonly Box[],
        state: SplitFragmentAftermathState,
        positionMarker: SplitMarkerPositioner
    ): TailSplitFormationOutcome {
        const committed = this.host.acceptAndCommitSplitFragment(
            attempt,
            result,
            boxes,
            state,
            positionMarker
        );
        const preview = this.previewAcceptedSplitSettlement(
            pageBoxes,
            actorQueue,
            startIndex,
            replaceCount,
            predecessor,
            continuation,
            attempt,
            result,
            boxes,
            state,
            positionMarker
        );
        this.host.settleContinuationQueue(
            actorQueue,
            startIndex,
            replaceCount,
            predecessor,
            continuation
        );

        return {
            committed,
            queuePreview: preview.queuePreview,
            queueHandling: preview.queueHandling
        };
    }

    finalizeGenericAcceptedSplit(
        pageBoxes: readonly Box[],
        actorQueue: PackagerUnit[],
        startIndex: number,
        predecessor: PackagerUnit,
        continuation: PackagerUnit | null | undefined,
        attempt: SplitAttempt,
        result: PackagerSplitResult,
        boxes: readonly Box[],
        state: SplitFragmentAftermathState,
        positionMarker: SplitMarkerPositioner
    ): GenericSplitOutcome {
        const committed = this.host.acceptAndCommitSplitFragment(
            attempt,
            result,
            boxes,
            state,
            positionMarker
        );

        const preview = this.previewAcceptedSplitSettlement(
            pageBoxes,
            actorQueue,
            startIndex,
            1,
            predecessor,
            continuation,
            attempt,
            result,
            boxes,
            state,
            positionMarker
        );
        this.host.settleContinuationQueue(
            actorQueue,
            startIndex,
            1,
            predecessor,
            continuation
        );

        return {
            committed,
            queuePreview: preview.queuePreview,
            queueHandling: preview.queueHandling
        };
    }

    settleTailSplitFormation(
        pages: Page[],
        currentPageBoxes: Box[],
        currentPageIndex: number,
        pageWidth: number,
        pageHeight: number,
        nextPageTopY: number,
        currentActorIndex: number,
        outcome: TailSplitFormationOutcome
    ): TailSplitFormationSettlementOutcome {
        currentPageBoxes.push(...outcome.committed.boxes);
        const advanced = this.host.advancePage(
            pages,
            currentPageBoxes,
            currentPageIndex,
            pageWidth,
            pageHeight,
            nextPageTopY
        );
        return {
            nextPageIndex: advanced.nextPageIndex,
            nextPageBoxes: advanced.nextPageBoxes,
            nextCurrentY: advanced.nextCurrentY,
            nextLastSpacingAfter: advanced.nextLastSpacingAfter,
            nextActorIndex: this.host.resolveNextActorIndex(currentActorIndex, outcome.queueHandling.shouldAdvanceIndex)
        };
    }

    settleTailSplitFailure(
        pages: Page[],
        currentPageBoxes: Box[],
        currentPageIndex: number,
        pageWidth: number,
        pageHeight: number,
        nextPageTop: number,
        currentActorIndex: number,
        restored: { currentY: number; lastSpacingAfter: number },
        shouldAdvancePage: boolean
    ): TailSplitFailureSettlementOutcome {
        if (!shouldAdvancePage) {
            return {
                nextPageIndex: currentPageIndex,
                nextPageBoxes: currentPageBoxes,
                nextCurrentY: restored.currentY,
                nextLastSpacingAfter: restored.lastSpacingAfter,
                nextActorIndex: currentActorIndex
            };
        }

        const advanced = this.host.advancePage(
            pages,
            currentPageBoxes,
            currentPageIndex,
            pageWidth,
            pageHeight,
            nextPageTop
        );
        return {
            nextPageIndex: advanced.nextPageIndex,
            nextPageBoxes: advanced.nextPageBoxes,
            nextCurrentY: advanced.nextCurrentY,
            nextLastSpacingAfter: advanced.nextLastSpacingAfter,
            nextActorIndex: currentActorIndex
        };
    }

    executeTailSplitFormationBranch(
        pages: Page[],
        currentPageBoxes: Box[],
        currentPageIndex: number,
        pageWidth: number,
        pageHeight: number,
        nextPageTopY: number,
        currentActorIndex: number,
        actorQueue: PackagerUnit[],
        tailSplitExecution: {
            prefix: PackagerUnit[];
            splitCandidate: PackagerUnit;
            replaceCount: number;
            splitMarkerReserve: number;
        },
        state: {
            currentY: number;
            lastSpacingAfter: number;
            pageLimit: number;
            availableWidth: number;
        },
        speculativeReason: SpeculativeBranchReason,
        contextBase: Omit<PackagerContext, 'pageIndex' | 'cursorY'>,
        shouldAdvancePageOnFailure: boolean,
        positionMarker: SplitMarkerPositioner
    ): TailSplitFormationSettlementOutcome | TailSplitFailureSettlementOutcome {
        const { prefix, splitCandidate, replaceCount, splitMarkerReserve } = tailSplitExecution;
        const transaction = this.host.executeSpeculativeBranch({
            reason: speculativeReason,
            pageBoxes: currentPageBoxes,
            actorQueue,
            currentY: state.currentY,
            lastSpacingAfter: state.lastSpacingAfter,
            currentPageIndex,
            run: () => {
                const placedPrefix = this.host.placeActorSequence(prefix, {
                    currentY: state.currentY,
                    lastSpacingAfter: state.lastSpacingAfter,
                    pageIndex: currentPageIndex,
                    pageLimit: state.pageLimit,
                    availableWidth: state.availableWidth
                }, contextBase);
                currentPageBoxes.push(...placedPrefix.boxes);

                const splitExecution = this.host.executePositionedSplitAttempt(
                    splitCandidate,
                    state.availableWidth,
                    placedPrefix.currentY,
                    placedPrefix.lastSpacingAfter,
                    state.pageLimit,
                    currentPageIndex,
                    splitMarkerReserve,
                    contextBase
                );
                const splitAttempt = splitExecution.execution.attempt;
                const { currentFragment: partA, continuationFragment: partB } = splitExecution.execution.result;

                if (!(partA && partB)) {
                    return { accept: false };
                }

                const partAContext = {
                    ...contextBase,
                    pageIndex: currentPageIndex,
                    cursorY: placedPrefix.currentY
                };
                const partABoxes = partA.emitBoxes(
                    state.availableWidth,
                    splitExecution.emitAvailableHeight,
                    partAContext
                ) || [];
                const outcome = this.finalizeTailSplitFormation(
                    currentPageBoxes,
                    actorQueue,
                    currentActorIndex,
                    replaceCount,
                    splitCandidate,
                    partB,
                    splitAttempt,
                    {
                        currentFragment: partA,
                        continuationFragment: partB
                    },
                    partABoxes,
                    this.host.createSplitFragmentAftermathState(partA, {
                        currentY: placedPrefix.currentY,
                        layoutDelta: splitExecution.layoutDelta,
                        lastSpacingAfter: placedPrefix.lastSpacingAfter,
                        pageLimit: state.pageLimit,
                        availableWidth: state.availableWidth,
                        pageIndex: currentPageIndex
                    }),
                    positionMarker
                );
                return {
                    accept: true,
                    value: outcome
                };
            }
        });

        if (transaction.accepted && transaction.value) {
            return this.settleTailSplitFormation(
                pages,
                currentPageBoxes,
                currentPageIndex,
                pageWidth,
                pageHeight,
                nextPageTopY,
                currentActorIndex,
                transaction.value
            );
        }

        return this.settleTailSplitFailure(
            pages,
            currentPageBoxes,
            currentPageIndex,
            pageWidth,
            pageHeight,
            nextPageTopY,
            currentActorIndex,
            {
                currentY: transaction.currentY,
                lastSpacingAfter: transaction.lastSpacingAfter
            },
            shouldAdvancePageOnFailure
        );
    }

    settleActorSplitFailure(
        pages: Page[],
        currentPageBoxes: Box[],
        currentPageIndex: number,
        pageWidth: number,
        pageHeight: number,
        nextPageTopY: number,
        currentActorIndex: number,
        resolution: ActorSplitFailureResolution
    ): ActorSplitFailureSettlementOutcome {
        currentPageBoxes.push(...resolution.committedBoxes);

        if (!resolution.shouldAdvancePage) {
            return {
                nextPageIndex: currentPageIndex,
                nextPageBoxes: currentPageBoxes,
                nextCurrentY: resolution.nextCurrentY,
                nextLastSpacingAfter: resolution.nextLastSpacingAfter,
                nextActorIndex: this.host.resolveNextActorIndex(currentActorIndex, resolution.shouldAdvanceIndex)
            };
        }

        const advanced = this.host.advancePage(
            pages,
            currentPageBoxes,
            currentPageIndex,
            pageWidth,
            pageHeight,
            nextPageTopY
        );
        return {
            nextPageIndex: advanced.nextPageIndex,
            nextPageBoxes: advanced.nextPageBoxes,
            nextCurrentY: advanced.nextCurrentY,
            nextLastSpacingAfter: advanced.nextLastSpacingAfter,
            nextActorIndex: this.host.resolveNextActorIndex(currentActorIndex, resolution.shouldAdvanceIndex)
        };
    }

    resolveDeferredSplitPlacement(
        currentY: number,
        nextCursorY: number,
        layoutBefore: number,
        pageLimit: number,
        pageTop: number
    ): DeferredSplitPlacementOutcome {
        if (nextCursorY <= currentY + layoutBefore + LAYOUT_DEFAULTS.wrapTolerance) {
            return {
                shouldAdvancePage: true,
                nextCurrentY: currentY
            };
        }

        const nextCurrentY = Math.max(currentY, nextCursorY - layoutBefore);
        const remainingHeight = pageLimit - nextCurrentY;
        return {
            shouldAdvancePage: remainingHeight <= 0 && nextCurrentY > pageTop,
            nextCurrentY
        };
    }

    settleDeferredSplitPlacement(
        pages: Page[],
        currentPageBoxes: Box[],
        currentPageIndex: number,
        pageWidth: number,
        pageHeight: number,
        nextPageTopY: number,
        currentActorIndex: number,
        lastSpacingAfter: number,
        outcome: DeferredSplitPlacementOutcome
    ): DeferredSplitPlacementSettlementOutcome {
        if (!outcome.shouldAdvancePage) {
            return {
                nextPageIndex: currentPageIndex,
                nextPageBoxes: currentPageBoxes,
                nextCurrentY: outcome.nextCurrentY,
                nextLastSpacingAfter: lastSpacingAfter,
                nextActorIndex: currentActorIndex
            };
        }

        const advanced = this.host.advancePage(
            pages,
            currentPageBoxes,
            currentPageIndex,
            pageWidth,
            pageHeight,
            nextPageTopY
        );
        return {
            nextPageIndex: advanced.nextPageIndex,
            nextPageBoxes: advanced.nextPageBoxes,
            nextCurrentY: advanced.nextCurrentY,
            nextLastSpacingAfter: advanced.nextLastSpacingAfter,
            nextActorIndex: currentActorIndex
        };
    }

    handleGenericSplitSuccess(
        currentPageBoxes: readonly Box[],
        actorQueue: PackagerUnit[],
        startIndex: number,
        predecessor: PackagerUnit,
        continuation: PackagerUnit | null | undefined,
        attempt: SplitAttempt,
        result: PackagerSplitResult,
        currentFragment: PackagerUnit,
        currentBoxes: readonly Box[],
        state: SplitFragmentAftermathState,
        deferredSplitCursorY: number | null,
        layoutBefore: number,
        pageLimit: number,
        pageTop: number,
        positionMarker: SplitMarkerPositioner
    ): GenericSplitSuccessHandlingOutcome {
        if (deferredSplitCursorY !== null) {
            const deferred = this.resolveDeferredSplitPlacement(
                state.currentY,
                deferredSplitCursorY,
                layoutBefore,
                pageLimit,
                pageTop
            );
            return {
                nextCurrentY: deferred.nextCurrentY,
                nextLastSpacingAfter: state.lastSpacingAfter,
                shouldAdvancePage: deferred.shouldAdvancePage,
                shouldAdvanceIndex: false,
                committedBoxes: []
            };
        }

        const outcome = this.finalizeGenericAcceptedSplit(
            currentPageBoxes,
            actorQueue,
            startIndex,
            predecessor,
            continuation,
            attempt,
            result,
            currentBoxes,
            state,
            positionMarker
        );

        return {
            nextCurrentY: outcome.committed.currentY,
            nextLastSpacingAfter: outcome.committed.lastSpacingAfter,
            shouldAdvancePage: true,
            shouldAdvanceIndex: outcome.queueHandling.shouldAdvanceIndex,
            committedBoxes: outcome.committed.boxes
        };
    }

    settleGenericSplitSuccess(
        pages: Page[],
        currentPageBoxes: Box[],
        currentPageIndex: number,
        pageWidth: number,
        pageHeight: number,
        nextPageTopY: number,
        currentActorIndex: number,
        handling: GenericSplitSuccessHandlingOutcome
    ): GenericSplitSuccessSettlementOutcome {
        currentPageBoxes.push(...handling.committedBoxes);

        if (!handling.shouldAdvancePage) {
            return {
                nextPageIndex: currentPageIndex,
                nextPageBoxes: currentPageBoxes,
                nextCurrentY: handling.nextCurrentY,
                nextLastSpacingAfter: handling.nextLastSpacingAfter,
                nextActorIndex: this.host.resolveNextActorIndex(currentActorIndex, handling.shouldAdvanceIndex)
            };
        }

        const advanced = this.host.advancePage(
            pages,
            currentPageBoxes,
            currentPageIndex,
            pageWidth,
            pageHeight,
            nextPageTopY
        );
        return {
            nextPageIndex: advanced.nextPageIndex,
            nextPageBoxes: advanced.nextPageBoxes,
            nextCurrentY: advanced.nextCurrentY,
            nextLastSpacingAfter: advanced.nextLastSpacingAfter,
            nextActorIndex: this.host.resolveNextActorIndex(currentActorIndex, handling.shouldAdvanceIndex)
        };
    }

    executeGenericSplitBranch(
        pages: Page[],
        currentPageBoxes: Box[],
        currentPageIndex: number,
        pageWidth: number,
        pageHeight: number,
        nextPageTopY: number,
        currentActorIndex: number,
        actorQueue: PackagerUnit[],
        packager: PackagerUnit,
        splitExecution: SplitExecution,
        state: {
            currentY: number;
            lastSpacingAfter: number;
            effectiveHeight: number;
            marginBottom: number;
            availableWidth: number;
            availableHeightAdjusted: number;
            pageLimit: number;
            pageTop: number;
            layoutBefore: number;
        },
        contextBase: Omit<PackagerContext, 'pageIndex' | 'cursorY'>,
        resolveDeferredCursorY: (candidate: PackagerUnit) => number | null,
        positionMarker: SplitMarkerPositioner
    ): ActorSplitFailureSettlementOutcome | DeferredSplitPlacementSettlementOutcome | GenericSplitSuccessSettlementOutcome {
        const { currentFragment: fitsCurrent, continuationFragment: pushedNext } = splitExecution.result;

        if (!fitsCurrent) {
            const boxes = state.currentY === state.pageTop
                ? (packager.emitBoxes(state.availableWidth, state.availableHeightAdjusted, {
                    ...contextBase,
                    pageIndex: currentPageIndex,
                    cursorY: state.currentY
                }) || [])
                : null;
            const outcome = this.host.resolveActorSplitFailure(
                packager,
                boxes,
                {
                    currentY: state.currentY,
                    layoutDelta: 0,
                    effectiveHeight: state.effectiveHeight,
                    marginBottom: state.marginBottom,
                    pageIndex: currentPageIndex
                },
                state.currentY === state.pageTop,
                state.currentY,
                state.lastSpacingAfter
            );
            return this.settleActorSplitFailure(
                pages,
                currentPageBoxes,
                currentPageIndex,
                pageWidth,
                pageHeight,
                nextPageTopY,
                currentActorIndex,
                outcome
            );
        }

        const splitContext: PackagerContext = {
            ...contextBase,
            pageIndex: currentPageIndex,
            cursorY: state.currentY
        };
        const fitsMarginBottom = fitsCurrent.getMarginBottom();
        const fitsMarginTop = fitsCurrent.getMarginTop();
        const fitsLayoutBefore = state.lastSpacingAfter + fitsMarginTop;
        const fitsLayoutDelta = fitsLayoutBefore - fitsMarginTop;
        const deferredSplitCursorY = resolveDeferredCursorY(fitsCurrent);
        if (deferredSplitCursorY !== null) {
            const outcome = this.resolveDeferredSplitPlacement(
                state.currentY,
                deferredSplitCursorY,
                fitsLayoutBefore,
                state.pageLimit,
                state.pageTop
            );
            return this.settleDeferredSplitPlacement(
                pages,
                currentPageBoxes,
                currentPageIndex,
                pageWidth,
                pageHeight,
                nextPageTopY,
                currentActorIndex,
                state.lastSpacingAfter,
                outcome
            );
        }

        const fitsAvailableHeightAdjusted = (state.pageLimit - state.currentY) - fitsLayoutDelta;
        const currentBoxes = fitsCurrent.emitBoxes(state.availableWidth, fitsAvailableHeightAdjusted, splitContext) || [];
        const handling = this.handleGenericSplitSuccess(
            currentPageBoxes,
            actorQueue,
            currentActorIndex,
            packager,
            pushedNext,
            splitExecution.attempt,
            splitExecution.result,
            fitsCurrent,
            currentBoxes,
            this.host.createSplitFragmentAftermathState(fitsCurrent, {
                currentY: state.currentY,
                layoutDelta: fitsLayoutDelta,
                lastSpacingAfter: state.lastSpacingAfter,
                pageLimit: state.pageLimit,
                availableWidth: state.availableWidth,
                pageIndex: currentPageIndex
            }),
            deferredSplitCursorY,
            fitsLayoutBefore,
            state.pageLimit,
            state.pageTop,
            positionMarker
        );
        return this.settleGenericSplitSuccess(
            pages,
            currentPageBoxes,
            currentPageIndex,
            pageWidth,
            pageHeight,
            nextPageTopY,
            currentActorIndex,
            handling
        );
    }

    private resolveContinuationArtifacts(actor: PackagerUnit): ContinuationArtifacts | undefined {
        const flowBox = this.getActorFlowBox(actor);
        if (!flowBox) return undefined;

        const continuationSpec =
            flowBox.properties?.paginationContinuation ??
            flowBox._sourceElement?.properties?.paginationContinuation;
        if (!continuationSpec) return undefined;

        if (flowBox.properties && flowBox.properties.paginationContinuation === undefined) {
            flowBox.properties.paginationContinuation = continuationSpec;
        }

        return this.getContinuationArtifactProvider(actor)?.getContinuationArtifacts?.(flowBox);
    }

    private getActorFlowBox(actor: PackagerUnit): FlowBox | undefined {
        return (actor as PackagerWithFlowBox).flowBox;
    }

    private getContinuationArtifactProvider(actor: PackagerUnit): ContinuationArtifactProvider | undefined {
        return (actor as PackagerWithProcessor).processor;
    }
}
