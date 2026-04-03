import { performance } from 'node:perf_hooks';
import type { Box, Page } from '../types';
import { LAYOUT_DEFAULTS } from './defaults';
import {
    type ActorMeasurement,
    type ActorPlacementActionInput,
    type ActorPlacementAttemptOutcome,
    type ActorPlacementCommitOutcome,
    type ActorPlacementExecutionOutcome,
    type ActorPlacementHandlingOutcome,
    type ActorPlacementSettlementOutcome,
    ConstraintField,
    type DeferredSplitPlacementOutcome,
    type FragmentCommitState,
    type LayoutProfileMetrics,
    type PaginationLoopAction,
    type PaginationPlacementPreparation,
    type ResolvedPlacementFrame
} from './layout-session-types';
import {
    bindPackagerSignalPublisher,
    packagerOccupiesFlowSpace,
    rejectsPlacementFrame,
    resolvePackagerPlacementPreference
} from './packagers/packager-types';
import { preparePackagerForPhase, type PackagerContext, type PackagerUnit } from './packagers/packager-types';

export type PhysicsRuntimeHost = {
    notifyConstraintNegotiation(actor: PackagerUnit, constraints: ConstraintField): void;
    notifyActorPrepared(actor: PackagerUnit): void;
    recordActorMeasurementByKind(actorKind: string, durationMs: number): void;
    restartCurrentActorOnNextPage(
        pages: Page[],
        currentPageBoxes: Box[],
        currentPageIndex: number,
        pageWidth: number,
        pageHeight: number,
        nextPageTopY: number,
        actorIndex: number
    ): PaginationLoopAction;
    recordProfile(metric: keyof LayoutProfileMetrics, delta: number): void;
    resolveDeferredSplitPlacement(
        currentY: number,
        nextCursorY: number,
        layoutBefore: number,
        pageLimit: number,
        pageTop: number
    ): DeferredSplitPlacementOutcome;
    commitFragmentBoxes(
        actor: PackagerUnit,
        boxes: readonly Box[],
        state: FragmentCommitState
    ): { boxes: Box[]; currentY: number; lastSpacingAfter: number };
    advancePage(
        pages: Page[],
        currentPageBoxes: Box[],
        currentPageIndex: number,
        pageWidth: number,
        pageHeight: number,
        nextPageTopY: number
    ): {
        nextPageIndex: number;
        nextPageBoxes: Box[];
        nextCurrentY: number;
        nextLastSpacingAfter: number;
    };
    resolveNextActorIndex(currentIndex: number, shouldAdvanceIndex: boolean): number;
    toPaginationLoopAction(outcome: ActorPlacementSettlementOutcome): PaginationLoopAction;
};

export class PhysicsRuntime {
    constructor(
        private readonly host: PhysicsRuntimeHost
    ) { }

    preparePaginationPlacement(input: {
        actor: PackagerUnit;
        currentActorIndex: number;
        pages: Page[];
        currentPageBoxes: Box[];
        currentPageIndex: number;
        currentY: number;
        lastSpacingAfter: number;
        pageWidth: number;
        pageHeight: number;
        pageLimit: number;
        margins: { top: number; right: number; bottom: number; left: number };
        contextBase: Omit<PackagerContext, 'pageIndex' | 'cursorY'>;
    }): PaginationPlacementPreparation {
        const fullAvailableWidth = input.pageWidth - input.margins.left - input.margins.right;
        let availableWidth = fullAvailableWidth;
        let availableHeight = input.pageLimit - input.currentY;

        if (availableHeight <= 0 && input.currentY > input.margins.top) {
            return {
                action: 'continue-loop',
                loopAction: this.host.restartCurrentActorOnNextPage(
                    input.pages,
                    input.currentPageBoxes,
                    input.currentPageIndex,
                    input.pageWidth,
                    input.pageHeight,
                    input.margins.top,
                    input.currentActorIndex
                )
            };
        }

        const isAtPageTop = input.currentY === input.margins.top && input.currentPageBoxes.length === 0;
        if (input.actor.pageBreakBefore && !isAtPageTop) {
            return {
                action: 'continue-loop',
                loopAction: this.host.restartCurrentActorOnNextPage(
                    input.pages,
                    input.currentPageBoxes,
                    input.currentPageIndex,
                    input.pageWidth,
                    input.pageHeight,
                    input.margins.top,
                    input.currentActorIndex
                )
            };
        }

        const marginTop = input.actor.getMarginTop();
        const layoutBefore = input.lastSpacingAfter + marginTop;
        const layoutDelta = layoutBefore - marginTop;
        const constraintField = new ConstraintField(availableWidth, availableHeight - layoutDelta);
        this.host.notifyConstraintNegotiation(input.actor, constraintField);
        const placementSurfaceStart = performance.now();
        const placementFrame = constraintField.resolvePlacementFrame(input.currentY + layoutBefore, {
            left: input.margins.left,
            right: input.margins.right
        });
        this.host.recordProfile('exclusionBlockedCursorCalls', 1);
        this.host.recordProfile('exclusionBandResolutionCalls', 1);
        const placementSurfaceDuration = performance.now() - placementSurfaceStart;
        this.host.recordProfile('exclusionBlockedCursorMs', placementSurfaceDuration);
        this.host.recordProfile('exclusionBandResolutionMs', placementSurfaceDuration);

        let currentY = input.currentY;
        if (placementFrame.cursorY > input.currentY + layoutBefore + LAYOUT_DEFAULTS.wrapTolerance) {
            currentY = placementFrame.cursorY - layoutBefore;
            availableHeight = input.pageLimit - currentY;
            if (availableHeight <= 0 && currentY > input.margins.top) {
                return {
                    action: 'continue-loop',
                    loopAction: this.host.restartCurrentActorOnNextPage(
                        input.pages,
                        input.currentPageBoxes,
                        input.currentPageIndex,
                        input.pageWidth,
                        input.pageHeight,
                        input.margins.top,
                        input.currentActorIndex
                    )
                };
            }
        }

        if (placementFrame.contentBand) {
            this.host.recordProfile('exclusionLaneApplications', 1);
        }

        availableWidth = placementFrame.availableWidth;
        const context: PackagerContext = {
            ...input.contextBase,
            pageIndex: input.currentPageIndex,
            cursorY: currentY,
            layoutBefore,
            viewportWorldY: input.currentPageIndex * input.pageHeight,
            viewportHeight: input.pageHeight,
            margins: {
                ...input.margins,
                left: placementFrame.margins.left,
                right: placementFrame.margins.right
            },
            publishActorSignal: bindPackagerSignalPublisher(
                input.contextBase.publishActorSignal,
                input.currentPageIndex,
                currentY
            )
        };
        const availableHeightAdjusted = constraintField.effectiveAvailableHeight;
        const effectiveAvailableHeight = layoutDelta + availableHeightAdjusted;

        return {
            action: 'ready',
            currentY,
            availableWidth,
            availableHeight,
            isAtPageTop,
            layoutBefore,
            layoutDelta,
            constraintField,
            placementFrame,
            context,
            availableHeightAdjusted,
            effectiveAvailableHeight,
            resolveDeferredCursorY: (candidate: PackagerUnit): number | null => {
                if (!placementFrame.contentBand) return null;

                const placementPreference = resolvePackagerPlacementPreference(
                    candidate,
                    constraintField.availableWidth,
                    context
                );
                const minimumPlacementWidth = placementPreference?.minimumWidth;
                if (
                    minimumPlacementWidth !== null &&
                    minimumPlacementWidth !== undefined &&
                    placementFrame.availableWidth + LAYOUT_DEFAULTS.wrapTolerance < minimumPlacementWidth
                ) {
                    return placementFrame.activeBand?.bottom ?? placementFrame.cursorY;
                }

                if (
                    rejectsPlacementFrame(
                        candidate,
                        placementFrame.availableWidth,
                        constraintField.availableWidth,
                        context
                    )
                ) {
                    return placementFrame.activeBand?.bottom ?? placementFrame.cursorY;
                }

                return null;
            }
        };
    }

    resolveDeferredActorPlacement(
        actor: PackagerUnit,
        placementFrame: ResolvedPlacementFrame,
        constraintField: ConstraintField,
        currentY: number,
        layoutBefore: number,
        pageLimit: number,
        pageTop: number,
        context: PackagerContext
    ): DeferredSplitPlacementOutcome | null {
        if (!placementFrame.contentBand) {
            return null;
        }

        const placementPreference = resolvePackagerPlacementPreference(
            actor,
            constraintField.availableWidth,
            context
        );
        const minimumPlacementWidth = placementPreference?.minimumWidth;
        if (
            minimumPlacementWidth !== null &&
            minimumPlacementWidth !== undefined &&
            placementFrame.availableWidth + LAYOUT_DEFAULTS.wrapTolerance < minimumPlacementWidth
        ) {
            return this.host.resolveDeferredSplitPlacement(
                currentY,
                placementFrame.activeBand?.bottom ?? placementFrame.cursorY,
                layoutBefore,
                pageLimit,
                pageTop
            );
        }

        if (
            rejectsPlacementFrame(
                actor,
                placementFrame.availableWidth,
                constraintField.availableWidth,
                context
            )
        ) {
            return this.host.resolveDeferredSplitPlacement(
                currentY,
                placementFrame.activeBand?.bottom ?? placementFrame.cursorY,
                layoutBefore,
                pageLimit,
                pageTop
            );
        }

        return null;
    }

    finalizeActorPlacementCommit(
        actor: PackagerUnit,
        boxes: readonly Box[],
        state: FragmentCommitState,
        constraintField: ConstraintField,
        layoutBefore: number,
        pageLimit: number,
        pageTop: number
    ): ActorPlacementCommitOutcome {
        const hasLaneConstraint = !!constraintField.resolveActiveContentBand(state.currentY + layoutBefore);
        if (hasLaneConstraint) {
            const absoluteBoxes = boxes.map((box) => ({
                ...box,
                y: (box.y || 0) + state.currentY + state.layoutDelta
            }));
            const placementDecision = constraintField.evaluatePlacement(absoluteBoxes, state.currentY + layoutBefore);
            if (placementDecision.action === 'defer') {
                const nextCurrentY = Math.max(state.currentY, placementDecision.nextCursorY - layoutBefore);
                return {
                    action: 'defer',
                    nextCurrentY,
                    shouldAdvancePage: (pageLimit - nextCurrentY) <= 0 && nextCurrentY > pageTop
                };
            }
        }

        return {
            action: 'commit',
            committed: this.host.commitFragmentBoxes(actor, boxes, state)
        };
    }

    executeActorPlacement(
        actor: PackagerUnit,
        availableWidth: number,
        availableHeight: number,
        context: PackagerContext,
        state: FragmentCommitState,
        constraintField: ConstraintField,
        layoutBefore: number,
        pageLimit: number,
        pageTop: number
    ): ActorPlacementExecutionOutcome {
        const boxes = actor.emitBoxes(availableWidth, availableHeight, context);
        if (!boxes) {
            return { action: 'retry-next-page' };
        }

        return this.finalizeActorPlacementCommit(
            actor,
            boxes,
            state,
            constraintField,
            layoutBefore,
            pageLimit,
            pageTop
        );
    }

    attemptActorPlacement(
        actor: PackagerUnit,
        placementFrame: ResolvedPlacementFrame,
        availableWidth: number,
        availableHeight: number,
        context: PackagerContext,
        state: FragmentCommitState,
        constraintField: ConstraintField,
        layoutBefore: number,
        pageLimit: number,
        pageTop: number
    ): ActorPlacementAttemptOutcome {
        const deferred = this.resolveDeferredActorPlacement(
            actor,
            placementFrame,
            constraintField,
            state.currentY,
            layoutBefore,
            pageLimit,
            pageTop,
            context
        );
        if (deferred) {
            return {
                action: 'defer',
                nextCurrentY: deferred.nextCurrentY,
                shouldAdvancePage: deferred.shouldAdvancePage
            };
        }

        return this.executeActorPlacement(
            actor,
            availableWidth,
            availableHeight,
            context,
            state,
            constraintField,
            layoutBefore,
            pageLimit,
            pageTop
        );
    }

    handleActorPlacementAttempt(
        currentPageBoxes: Box[],
        outcome: ActorPlacementAttemptOutcome,
        currentY: number,
        lastSpacingAfter: number
    ): ActorPlacementHandlingOutcome {
        if (outcome.action === 'retry-next-page') {
            return {
                nextCurrentY: currentY,
                nextLastSpacingAfter: lastSpacingAfter,
                shouldAdvancePage: true,
                shouldAdvanceIndex: false
            };
        }

        if (outcome.action === 'defer') {
            return {
                nextCurrentY: outcome.nextCurrentY,
                nextLastSpacingAfter: lastSpacingAfter,
                shouldAdvancePage: outcome.shouldAdvancePage,
                shouldAdvanceIndex: false
            };
        }

        currentPageBoxes.push(...outcome.committed.boxes);
        return {
            nextCurrentY: outcome.committed.currentY,
            nextLastSpacingAfter: outcome.committed.lastSpacingAfter,
            shouldAdvancePage: false,
            shouldAdvanceIndex: true
        };
    }

    settleActorPlacementAttempt(
        pages: Page[],
        currentPageBoxes: Box[],
        currentPageIndex: number,
        pageWidth: number,
        pageHeight: number,
        nextPageTopY: number,
        currentActorIndex: number,
        outcome: ActorPlacementAttemptOutcome,
        currentY: number,
        lastSpacingAfter: number
    ): ActorPlacementSettlementOutcome {
        const handling = this.handleActorPlacementAttempt(
            currentPageBoxes,
            outcome,
            currentY,
            lastSpacingAfter
        );

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

    resolveActorPlacementAction(input: ActorPlacementActionInput): PaginationLoopAction {
        return this.host.toPaginationLoopAction(
            this.settleActorPlacementAttempt(
                input.pages,
                input.currentPageBoxes,
                input.currentPageIndex,
                input.pageWidth,
                input.pageHeight,
                input.nextPageTopY,
                input.currentActorIndex,
                this.attemptActorPlacement(
                    input.actor,
                    input.placementFrame,
                    input.availableWidth,
                    input.availableHeight,
                    input.context,
                    input.state,
                    input.constraintField,
                    input.layoutBefore,
                    input.pageLimit,
                    input.pageTop
                ),
                input.currentY,
                input.lastSpacingAfter
            )
        );
    }

    measurePreparedActor(
        actor: PackagerUnit,
        availableWidth: number,
        availableHeight: number,
        layoutBefore: number,
        context: PackagerContext
    ): ActorMeasurement {
        const startedAt = performance.now();
        preparePackagerForPhase(actor, 'commit', availableWidth, availableHeight, context);
        this.host.notifyActorPrepared(actor);

        const marginTop = actor.getMarginTop();
        const marginBottom = actor.getMarginBottom();
        const contentHeight = Math.max(0, actor.getRequiredHeight() - marginTop - marginBottom);
        const requiredHeight = contentHeight + layoutBefore + marginBottom;
        const occupiesFlowSpace = packagerOccupiesFlowSpace(actor);

        const measurement = {
            marginTop,
            marginBottom,
            contentHeight,
            requiredHeight: occupiesFlowSpace ? requiredHeight : 0,
            effectiveHeight: occupiesFlowSpace ? Math.max(requiredHeight, LAYOUT_DEFAULTS.minEffectiveHeight) : 0
        };
        this.host.recordActorMeasurementByKind(actor.actorKind, performance.now() - startedAt);
        return measurement;
    }
}
