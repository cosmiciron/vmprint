import type { Box } from '../../../types';
import type { LocalActorSignalSnapshot, SafeCheckpoint } from '../../actor-communication-runtime';
import type { FlowBox } from '../../layout-core-types';
import type { PackagerReshapeResult, PackagerUnit, SpatialFrontier } from '../../packagers/packager-types';
import type { FragmentTransition } from './session-state-types';
import type { RegionReservation, SpatialExclusion } from './session-spatial-types';
import type { SplitAttempt } from './session-lifecycle-types';

export type SimulationTick = number;

export type SimulationClockSnapshot = {
    tick: SimulationTick;
};

export type SplitExecution = {
    attempt: SplitAttempt;
    result: PackagerReshapeResult;
};

export type PositionedSplitExecution = {
    execution: SplitExecution;
    layoutDelta: number;
    emitAvailableHeight: number;
};

export type LocalTransitionSnapshot = {
    boxStartIndex: number;
    currentY: number;
    lastSpacingAfter: number;
};

export type SequencePlacementCheckpoint = {
    boxStartIndex: number;
    currentY: number;
    lastSpacingAfter: number;
};

export type LocalQueueSnapshot = {
    actorQueue: PackagerUnit[];
    stagedContinuationActors: Map<string, PackagerUnit[]>;
    stagedAfterSplitMarkers: Map<string, FlowBox[]>;
};

export type LocalSplitStateSnapshot = {
    currentPageReservations: RegionReservation[];
    currentPageExclusions: SpatialExclusion[];
    fragmentTransitions: FragmentTransition[];
    fragmentTransitionsByActor: Map<string, FragmentTransition>;
    fragmentTransitionsBySource: Map<string, FragmentTransition[]>;
};

export type ProgressionStateSnapshot = {
    simulationClockSnapshot: SimulationClockSnapshot;
};

export type KernelBranchStateSnapshot = LocalQueueSnapshot & LocalSplitStateSnapshot;

export type SessionBranchStateSnapshot = KernelBranchStateSnapshot & ProgressionStateSnapshot;

export type LocalBranchStateSnapshot = SessionBranchStateSnapshot & LocalActorSignalSnapshot;

export type LocalBranchSnapshot = LocalTransitionSnapshot & SessionBranchStateSnapshot & LocalActorSignalSnapshot;

export type SafeCheckpointSnapshot = LocalTransitionSnapshot & SessionBranchStateSnapshot;

export type SessionSafeCheckpoint = SafeCheckpoint<LocalTransitionSnapshot, SessionBranchStateSnapshot>;

export type ContinuationQueueOutcome = {
    continuationInstalled: boolean;
    snapshot: LocalQueueSnapshot;
};

export type SpeculativeBranchReason =
    | 'accepted-split'
    | 'keep-with-next'
    | 'observer-resettle'
    | 'tail-split-formation'
    | 'other';

export type SpeculativeBranchContext = {
    readonly reason: SpeculativeBranchReason;
    readonly branchId: string;
    readonly frontier?: SpatialFrontier;
    getCurrentY(): number;
    getLastSpacingAfter(): number;
    getCurrentPageIndex(): number;
    captureNote(label: string, payload?: Record<string, unknown>): void;
};

export type SpeculativeBranchResolution<T> =
    | { accept: true; value: T }
    | { accept: false; value?: T };

export type ExecuteSpeculativeBranchInput<T> = {
    reason: SpeculativeBranchReason;
    frontier?: SpatialFrontier;
    pageBoxes: Box[];
    actorQueue: PackagerUnit[];
    currentY: number;
    lastSpacingAfter: number;
    currentPageIndex: number;
    run: (branch: SpeculativeBranchContext) => SpeculativeBranchResolution<T>;
};

export type ExecuteSpeculativeBranchResult<T> = {
    accepted: boolean;
    value?: T;
    currentY: number;
    lastSpacingAfter: number;
};
