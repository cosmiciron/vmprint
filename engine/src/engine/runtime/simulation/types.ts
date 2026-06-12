import type { LayoutProcessor } from '../../layout/layout-core';
import type { LayoutProfileMetrics } from '../../layout/runtime/session/session-profile-types';
import type { PageCaptureRecord } from '../../layout/runtime/session/session-state-types';
import type { Page, SimulationStopReason } from '../../types';

export type ExternalMessage = {
    subject: string;
    payload?: unknown;
    sender?: string;
    meta?: {
        messageId?: string;
    };
};

export type SimulationUpdateSource = 'none' | 'stepped-actors' | 'observer-registry' | 'runtime-formatting' | 'runtime-formatting-restore';

export type SimulationReplayFrontier = {
    pageIndex: number;
    cursorY?: number;
    worldY?: number;
    actorIndex?: number;
    actorId?: string;
    sourceId?: string;
};

export type SimulationUpdateSummary = {
    kind: 'none' | 'content-only' | 'geometry';
    source: SimulationUpdateSource;
    actorIds: string[];
    sourceIds: string[];
    pageIndexes: number[];
    addedPageIndexes: number[];
    removedPageIndexes: number[];
    replayFrontier: SimulationReplayFrontier | null;
};

export type SimulationDiagnosticSourceSnapshot = {
    actorId: string;
    sourceId: string;
    actorKind: string;
    content: string;
};

export type SimulationDiagnosticProfileSnapshot = Pick<
    LayoutProfileMetrics,
    | 'simulationTickCount'
    | 'setContentCalls'
    | 'messageSendCalls'
    | 'messageHandlerCalls'
    | 'actorUpdateContentOnlyCalls'
    | 'actorUpdateGeometryCalls'
    | 'actorUpdateNoopCalls'
>;

export type SimulationDiagnosticSnapshot = {
    tick: number;
    pageCount: number;
    progressionPolicy: ReturnType<LayoutProcessor['getSimulationProgressionConfig']>['policy'];
    stopReason: SimulationStopReason;
    lastUpdate: SimulationUpdateSummary;
    renderRevisionPageIndexes: number[];
    namedSources: SimulationDiagnosticSourceSnapshot[];
    profile: SimulationDiagnosticProfileSnapshot;
};

export type SimulationContinueOptions = {
    untilPage?: number;
    untilY?: number;
    maxMilliseconds?: number;
};

export type SimulationContinueResult = {
    yielded: boolean;
    finished: boolean;
    pageCount: number;
    currentPageIndex: number;
    reason: 'until-page' | 'until-y' | 'time-budget' | 'finished' | 'already-finished';
    elapsedMs: number;
};

export interface SimulationRunner {
    getCurrentTick(): number;
    getCurrentPageIndex(): number;
    getCurrentPageCount(): number;
    getProgression(): ReturnType<LayoutProcessor['getSimulationProgressionConfig']>;
    getCurrentUpdateSummary(): SimulationUpdateSummary;
    getCurrentDiagnosticSnapshot(): SimulationDiagnosticSnapshot;
    getCurrentPageCaptures(): PageCaptureRecord[];
    getSimulationStopReason(): SimulationStopReason;
    isFinished(): boolean;
    getCurrentPages(): Page[];
    runToCompletion(): Page[];
    advanceTick(): boolean;
    continueUntil(options?: SimulationContinueOptions): SimulationContinueResult;
    continueUntilPage(pageIndex: number): SimulationContinueResult;
    continueUntilY(y: number): SimulationContinueResult;
    sendExternalMessage(targetSourceId: string, message: ExternalMessage): boolean;
    hasExternalMessageAck(messageId: string): boolean;
}
