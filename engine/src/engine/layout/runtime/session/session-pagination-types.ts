import type { Box, Page } from '../../../types';
import type { KeepWithNextFormationPlan, WholeFormationOverflowHandling } from '../../actor-formation';
import { getTailSplitPostAttemptOutcome } from '../../actor-formation';
import type { ConstraintField, ResolvedPlacementFrame } from '../../constraint-field';
import type { FlowBox } from '../../layout-core-types';
import type { ObservationResult, PackagerContext, SpatialFrontier } from '../../packagers/packager-types';
import type { PackagerUnit } from '../../packagers/packager-types';
import type { PaginationState } from './session-lifecycle-types';
import type { ContinuationQueueOutcome, SplitExecution } from './session-progression-types';

export type PaginationLoopAction =
    | {
        action: 'continue-loop';
        paginationState: PaginationState;
        nextActorIndex: number;
    }
    | {
        action: 'continue-tail-split';
        tailSplitExecution: {
            prefix: PackagerUnit[];
            splitCandidate: PackagerUnit;
            replaceCount: number;
            splitMarkerReserve: number;
        };
    }
    | {
        action: 'continue-to-split';
        splitExecution: SplitExecution;
    }
    | {
        action: 'fallthrough-local-overflow';
    };

export type SplitMarkerPlacementState = {
    currentY: number;
    lastSpacingAfter: number;
    pageLimit: number;
    pageIndex: number;
    availableWidth: number;
};

export type FragmentCommitState = {
    currentY: number;
    layoutDelta: number;
    effectiveHeight: number;
    marginBottom: number;
    pageIndex: number;
};

export type SequencePlacementState = {
    currentY: number;
    lastSpacingAfter: number;
    pageIndex: number;
    pageLimit: number;
    availableWidth: number;
};

export type SplitFragmentAftermathState = FragmentCommitState & {
    actorId: string;
    lastSpacingAfter: number;
    pageLimit: number;
    availableWidth: number;
};

export type SplitFragmentAftermathInput = {
    currentY: number;
    layoutDelta: number;
    lastSpacingAfter: number;
    pageLimit: number;
    availableWidth: number;
    pageIndex: number;
};

export type TailSplitFormationOutcome = {
    committed: { boxes: Box[]; currentY: number; lastSpacingAfter: number };
    queuePreview: ContinuationQueueOutcome;
    queueHandling: AcceptedSplitQueueHandling;
};

export type TailSplitFormationSettlementOutcome = {
    nextPageIndex: number;
    nextPageBoxes: Box[];
    nextCurrentY: number;
    nextLastSpacingAfter: number;
    nextActorIndex: number;
};

export type TailSplitFailureSettlementOutcome = {
    nextPageIndex: number;
    nextPageBoxes: Box[];
    nextCurrentY: number;
    nextLastSpacingAfter: number;
    nextActorIndex: number;
};

export type WholeFormationOverflowEntryOutcome =
    | {
        action: 'advance-page';
        nextPageIndex: number;
        nextPageBoxes: Box[];
        nextCurrentY: number;
        nextLastSpacingAfter: number;
    }
    | {
        action: 'continue-tail-split';
        tailSplitExecution: {
            prefix: PackagerUnit[];
            splitCandidate: PackagerUnit;
            replaceCount: number;
            splitMarkerReserve: number;
        };
    }
    | {
        action: 'fallthrough-local-overflow';
    };

export type WholeFormationOverflowEntrySettlementOutcome =
    | {
        action: 'advance-page';
        nextPageIndex: number;
        nextPageBoxes: Box[];
        nextCurrentY: number;
        nextLastSpacingAfter: number;
        nextActorIndex: number;
    }
    | {
        action: 'continue-tail-split';
        tailSplitExecution: {
            prefix: PackagerUnit[];
            splitCandidate: PackagerUnit;
            replaceCount: number;
            splitMarkerReserve: number;
        };
    }
    | {
        action: 'fallthrough-local-overflow';
    };

export type WholeFormationOverflowResolution = {
    handling: WholeFormationOverflowHandling | null;
    fallbackOutcome: WholeFormationOverflowHandling['fallbackHandling'];
    action: PaginationLoopAction | null;
    tailSplitExecution: WholeFormationOverflowHandling['tailSplitExecution'];
};

export type KeepWithNextPlanningResolution = {
    plan: KeepWithNextFormationPlan | null;
    handling: WholeFormationOverflowHandling | null;
    tailSplitSuccessOutcome: ReturnType<typeof getTailSplitPostAttemptOutcome> | null;
    tailSplitFailureOutcome: ReturnType<typeof getTailSplitPostAttemptOutcome> | null;
};

export type GenericSplitOutcome = {
    committed: { boxes: Box[]; currentY: number; lastSpacingAfter: number };
    queuePreview: ContinuationQueueOutcome;
    queueHandling: AcceptedSplitQueueHandling;
};

export type AcceptedSplitQueueHandling = {
    shouldAdvanceIndex: boolean;
};

export type ForcedOverflowCommitOutcome = {
    committed: { boxes: Box[]; currentY: number; lastSpacingAfter: number };
    shouldAdvancePage: boolean;
};

export type ActorOverflowPreSplitHandlingOutcome = {
    committed: { boxes: Box[]; currentY: number; lastSpacingAfter: number } | null;
    shouldAdvancePage: boolean;
    shouldAdvanceIndex: boolean;
};

export type ActorOverflowSplitEntryHandlingOutcome = {
    splitExecution: SplitExecution | null;
    shouldAdvancePage: boolean;
};

export type ActorOverflowEntryHandlingOutcome =
    | {
        action: 'handled';
        nextCurrentY: number;
        nextLastSpacingAfter: number;
        shouldAdvancePage: boolean;
        shouldAdvanceIndex: boolean;
        committedBoxes: Box[];
    }
    | {
        action: 'continue-to-split';
        splitExecution: SplitExecution;
    };

export type ActorOverflowEntrySettlementOutcome =
    | {
        action: 'handled';
        nextPageIndex: number;
        nextPageBoxes: Box[];
        nextCurrentY: number;
        nextLastSpacingAfter: number;
        nextActorIndex: number;
    }
    | {
        action: 'continue-to-split';
        splitExecution: SplitExecution;
    };

export type ActorOverflowResolution =
    | {
        action: 'handled';
        loopAction: PaginationLoopAction;
    }
    | {
        action: 'continue-to-split';
        splitExecution: SplitExecution;
    };

export type KeepWithNextOverflowActionInput = {
    planning: KeepWithNextPlanningResolution | null;
    wholeFormationOverflow: WholeFormationOverflowResolution;
    effectiveHeight: number;
    marginBottom: number;
    effectiveAvailableHeight: number;
    isAtPageTop: boolean;
    pages: Page[];
    currentPageBoxes: Box[];
    currentPageIndex: number;
    pageWidth: number;
    pageHeight: number;
    nextPageTopY: number;
    currentActorIndex: number;
    actorQueue: PackagerUnit[];
    state: {
        currentY: number;
        lastSpacingAfter: number;
        pageLimit: number;
        availableWidth: number;
    };
    contextBase: Omit<PackagerContext, 'pageIndex' | 'cursorY'>;
    positionMarker: (marker: FlowBox, currentY: number, layoutBefore: number, availableWidth: number, pageIndex: number) => Box | Box[];
};

export type ActorPlacementActionInput = {
    actor: PackagerUnit;
    placementFrame: ResolvedPlacementFrame;
    availableWidth: number;
    availableHeight: number;
    context: PackagerContext;
    state: FragmentCommitState;
    constraintField: ConstraintField;
    layoutBefore: number;
    pageLimit: number;
    pageTop: number;
    pages: Page[];
    currentPageBoxes: Box[];
    currentPageIndex: number;
    pageWidth: number;
    pageHeight: number;
    nextPageTopY: number;
    currentActorIndex: number;
    currentY: number;
    lastSpacingAfter: number;
};

export type GenericSplitActionInput = {
    pages: Page[];
    currentPageBoxes: Box[];
    currentPageIndex: number;
    pageWidth: number;
    pageHeight: number;
    nextPageTopY: number;
    currentActorIndex: number;
    actorQueue: PackagerUnit[];
    packager: PackagerUnit;
    splitExecution: SplitExecution;
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
    };
    contextBase: Omit<PackagerContext, 'pageIndex' | 'cursorY'>;
    resolveDeferredCursorY: (candidate: PackagerUnit) => number | null;
    positionMarker: (marker: FlowBox, currentY: number, layoutBefore: number, availableWidth: number, pageIndex: number) => Box | Box[];
};

export type ActorMeasurement = {
    marginTop: number;
    marginBottom: number;
    contentHeight: number;
    requiredHeight: number;
    effectiveHeight: number;
};

export type ActorSplitFailureHandlingOutcome = {
    committed: { boxes: Box[]; currentY: number; lastSpacingAfter: number } | null;
    shouldAdvancePage: boolean;
    shouldAdvanceIndex: boolean;
};

export type ActorSplitFailureResolution = {
    nextCurrentY: number;
    nextLastSpacingAfter: number;
    shouldAdvancePage: boolean;
    shouldAdvanceIndex: boolean;
    committedBoxes: Box[];
};

export type ActorSplitFailureSettlementOutcome = {
    nextPageIndex: number;
    nextPageBoxes: Box[];
    nextCurrentY: number;
    nextLastSpacingAfter: number;
    nextActorIndex: number;
};

export type DeferredSplitPlacementOutcome = {
    shouldAdvancePage: boolean;
    nextCurrentY: number;
};

export type DeferredSplitPlacementSettlementOutcome = {
    nextPageIndex: number;
    nextPageBoxes: Box[];
    nextCurrentY: number;
    nextLastSpacingAfter: number;
    nextActorIndex: number;
};

export type GenericSplitSuccessHandlingOutcome = {
    nextCurrentY: number;
    nextLastSpacingAfter: number;
    shouldAdvancePage: boolean;
    shouldAdvanceIndex: boolean;
    committedBoxes: Box[];
};

export type GenericSplitSuccessSettlementOutcome = {
    nextPageIndex: number;
    nextPageBoxes: Box[];
    nextCurrentY: number;
    nextLastSpacingAfter: number;
    nextActorIndex: number;
};

export type PageAdvanceOutcome = {
    nextPageIndex: number;
    nextPageBoxes: Box[];
    nextCurrentY: number;
    nextLastSpacingAfter: number;
};

export type ActorPlacementCommitOutcome =
    | {
        action: 'defer';
        nextCurrentY: number;
        shouldAdvancePage: boolean;
    }
    | {
        action: 'commit';
        committed: { boxes: Box[]; currentY: number; lastSpacingAfter: number };
    };

export type ActorPlacementExecutionOutcome =
    | {
        action: 'retry-next-page';
    }
    | ActorPlacementCommitOutcome;

export type ActorPlacementAttemptOutcome =
    | {
        action: 'retry-next-page';
    }
    | {
        action: 'defer';
        nextCurrentY: number;
        shouldAdvancePage: boolean;
    }
    | {
        action: 'commit';
        committed: { boxes: Box[]; currentY: number; lastSpacingAfter: number };
    };

export type ActorPlacementHandlingOutcome = {
    nextCurrentY: number;
    nextLastSpacingAfter: number;
    shouldAdvancePage: boolean;
    shouldAdvanceIndex: boolean;
};

export type ActorPlacementSettlementOutcome = {
    nextPageIndex: number;
    nextPageBoxes: Box[];
    nextCurrentY: number;
    nextLastSpacingAfter: number;
    nextActorIndex: number;
};

export type PaginationPlacementPreparation =
    | {
        action: 'continue-loop';
        loopAction: PaginationLoopAction;
    }
    | {
        action: 'ready';
        currentY: number;
        availableWidth: number;
        availableHeight: number;
        isAtPageTop: boolean;
        layoutBefore: number;
        layoutDelta: number;
        constraintField: ConstraintField;
        placementFrame: ResolvedPlacementFrame;
        context: PackagerContext;
        availableHeightAdjusted: number;
        effectiveAvailableHeight: number;
        resolveDeferredCursorY: (candidate: PackagerUnit) => number | null;
    };

export type ObservedActorBoundaryResult = {
    currentY: number;
    currentPageIndex: number;
    actorQueue: PackagerUnit[];
    settled: boolean;
};

export type ObserverCheckBoundaryInput = {
    currentY: number;
    currentPageIndex: number;
    actorQueue: PackagerUnit[];
    state: {
        availableWidth: number;
        availableHeight: number;
        isAtPageTop: boolean;
        context: PackagerContext;
    };
    frontier: SpatialFrontier | null;
    observe: () => ObservationResult;
};
