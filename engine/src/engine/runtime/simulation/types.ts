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

export type SimulationUpdateSource = 'none' | 'stepped-actors' | 'observer-registry';

export type SimulationUpdateSummary = {
    kind: 'none' | 'content-only' | 'geometry';
    source: SimulationUpdateSource;
    actorIds: string[];
    sourceIds: string[];
    pageIndexes: number[];
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
    sendExternalMessage(targetSourceId: string, message: ExternalMessage): boolean;
    hasExternalMessageAck(messageId: string): boolean;
}
