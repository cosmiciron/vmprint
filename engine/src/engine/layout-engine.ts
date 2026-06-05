import { Element, LayoutConfig } from './types';
import { LayoutProcessor, type LayoutSimulationOptions } from './layout/layout-core';
import { LayoutUtils } from './layout/layout-utils';
import {
    buildPageViewportHandle,
    buildWorldViewportHandle,
    type ViewportHandle,
    type WorldViewportRequest
} from './viewport';
export type {
    ExternalMessage,
    SimulationDiagnosticProfileSnapshot,
    SimulationDiagnosticSnapshot,
    SimulationDiagnosticSourceSnapshot,
    SimulationRunner,
    SimulationUpdateSource,
    SimulationUpdateSummary
} from './runtime/simulation/types';
export type {
    PageCaptureRecord,
    PageCaptureState,
    ViewportDescriptor,
    ViewportRect,
    ViewportTerrain,
    WorldSpace
} from './layout/runtime/session/session-state-types';
export { SimulationLoop } from './layout/simulation-loop';
export type {
    ViewportHandle,
    ViewportSnapshotSource,
    WorldViewportRequest,
    WorldViewportSegment
} from './viewport';
export type {
    SimulationLoopOptions,
    SimulationLoopSample,
    SimulationLoopScheduler,
    SimulationLoopState
} from './layout/simulation-loop';
import {
    applySpatialDocumentPageTemplate,
    applySpatialDocumentPageTemplateStrict,
    SpatialDocument,
    spatialDocumentToElements,
    spatialDocumentToElementsStrict
} from './spatial-document';
import {
    PrintPipelineSnapshot
} from './layout/simulation-report';
import { EngineRuntime } from './runtime';
import { normalizeObservationResult } from './layout/packagers/packager-types';
import {
    buildRuntimeIntentTopic,
    cloneRuntimeElementSourceSnapshot,
    cloneRuntimeJsonValue,
    isRuntimeRangeTarget,
    normalizeRuntimeFormattingPatch,
    restoreRuntimeElementSourceSnapshot,
    runtimeElementSourceSnapshotsEqual,
    type RuntimeFormattingPatch,
    type RuntimeFormattingTarget
} from './layout/runtime-formatting';

const DEFAULT_ENGINE_LAYOUT_CONFIG: LayoutConfig = {
    layout: {
        pageSize: 'LETTER',
        margins: { top: 72, right: 72, bottom: 72, left: 72 },
        fontFamily: 'Helvetica',
        fontSize: 12,
        lineHeight: 1.2
    },
    fonts: {
        regular: 'Helvetica'
    },
    styles: {},
    preloadFontFamilies: [],
    debug: false
};

type RuntimeIntent = {
    kind?: unknown;
    type?: unknown;
    target?: RuntimeFormattingTarget | null;
    patch?: RuntimeFormattingPatch | null;
    restoreSnapshot?: unknown;
};

type RuntimeActor = {
    actorId?: string;
    sourceId?: string;
    flowBox?: { _sourceElement?: Element };
    element?: Element;
    rebuildLiveFlowBox?(): boolean;
    updateCommittedState?(context: Record<string, unknown>): unknown;
    observeCommittedSignals?(context: Record<string, unknown>): unknown;
    getHostedRuntimeActors?(): readonly RuntimeActor[];
    handlesHostedRuntimeActor?(targetActor: RuntimeActor): boolean;
    refreshHostedRuntimeActor?(targetActor: RuntimeActor): boolean;
};

type RuntimeIntentResult = {
    changed: boolean;
    reason?: string;
    kind?: string;
    sourceId?: string;
    actorId?: string;
    visibleActorId?: string;
    frontier?: unknown;
    redraw?: { patchedActors: number; pageIndexes: number[] };
    update?: {
        kind: string;
        source: string;
        actorIds: string[];
        sourceIds: string[];
        pageIndexes: number[];
    };
    pageIndexes?: number[];
    pages?: unknown;
    history?: unknown;
    replay?: unknown;
};

function findRuntimeHostActor(
    actors: readonly RuntimeActor[],
    targetActor: RuntimeActor
): RuntimeActor | null {
    for (const actor of actors) {
        if (actor.actorId === targetActor.actorId) continue;
        if (actor.handlesHostedRuntimeActor?.(targetActor)) {
            return actor;
        }
    }
    return null;
}

function collectRuntimeFormattingActors(actors: readonly RuntimeActor[]): RuntimeActor[] {
    const collected: RuntimeActor[] = [];
    const seen = new Set<string>();
    const visit = (actor: RuntimeActor | null | undefined): void => {
        if (!actor) return;
        const actorKey = String(actor.actorId || actor.sourceId || '').trim();
        if (actorKey && seen.has(actorKey)) return;
        if (actorKey) seen.add(actorKey);
        collected.push(actor);
        for (const hostedActor of actor.getHostedRuntimeActors?.() ?? []) {
            visit(hostedActor);
        }
    };
    for (const actor of actors) {
        visit(actor);
    }
    return collected;
}

function redrawRuntimeActorThroughHosts(
    actors: readonly RuntimeActor[],
    actor: RuntimeActor,
    redrawActor: (candidate: RuntimeActor) => { patchedActors: number; pageIndexes: number[] }
): { visibleActor: RuntimeActor; redraw: { patchedActors: number; pageIndexes: number[] } } {
    let visibleActor = actor;
    let redraw = redrawActor(visibleActor);
    const initialActorId = String(actor.actorId || actor.sourceId || '');
    const visitedActorIds = new Set<string>(initialActorId ? [initialActorId] : []);
    while (Number(redraw?.patchedActors || 0) === 0) {
        const host = findRuntimeHostActor(actors, visibleActor);
        const hostActorId = String(host?.actorId || host?.sourceId || '');
        if (!host || (hostActorId && visitedActorIds.has(hostActorId))) break;
        if (hostActorId) visitedActorIds.add(hostActorId);
        if (!host.refreshHostedRuntimeActor?.(visibleActor)) break;
        visibleActor = host;
        redraw = redrawActor(visibleActor);
    }
    return { visibleActor, redraw };
}

function refreshRuntimeActorHostChain(actors: readonly RuntimeActor[], actor: RuntimeActor): RuntimeActor {
    let current = actor;
    const initialActorId = String(actor.actorId || actor.sourceId || '');
    const visitedActorIds = new Set<string>(initialActorId ? [initialActorId] : []);
    while (true) {
        const host = findRuntimeHostActor(actors, current);
        const hostActorId = String(host?.actorId || host?.sourceId || '');
        if (!host || (hostActorId && visitedActorIds.has(hostActorId))) break;
        if (hostActorId) visitedActorIds.add(hostActorId);
        if (!host.refreshHostedRuntimeActor?.(current)) break;
        current = host;
    }
    return current;
}

/**
 * LayoutEngine shapes elements into flow boxes, paginates them, and returns
 * positioned page boxes for rendering.
 */
export class LayoutEngine extends LayoutProcessor {
    private lastResolvedConfig: LayoutConfig;
    private runtimeIntentSequence = 0;

    constructor(
        config: LayoutConfig = DEFAULT_ENGINE_LAYOUT_CONFIG,
        runtime?: EngineRuntime
    ) {
        super(config, runtime);
        this.lastResolvedConfig = config;
    }

    getLastResolvedConfig(): LayoutConfig {
        return this.lastResolvedConfig;
    }

    getPageCount(): number {
        return this.getLastPrintPipelineSnapshot().pages.length;
    }

    getPageViewport(pageIndex: number): ViewportHandle {
        const snapshot = this.getLastPrintPipelineSnapshot();
        return buildPageViewportHandle({
            pageCount: snapshot.pages.length,
            pageSize: LayoutUtils.getPageDimensions(this.lastResolvedConfig),
            config: this.lastResolvedConfig,
            pages: snapshot.pages,
            pageCaptures: snapshot.reader.world?.pageCaptures ?? []
        }, pageIndex);
    }

    getDefaultViewport(): ViewportHandle {
        return this.getPageViewport(0);
    }

    getWorldViewport(request: WorldViewportRequest): ViewportHandle {
        const snapshot = this.getLastPrintPipelineSnapshot();
        return buildWorldViewportHandle({
            pageCount: snapshot.pages.length,
            pageSize: LayoutUtils.getPageDimensions(this.lastResolvedConfig),
            config: this.lastResolvedConfig,
            pages: snapshot.pages,
            pageCaptures: snapshot.reader.world?.pageCaptures ?? []
        }, request);
    }

    simulate(elements: Parameters<LayoutProcessor['simulate']>[0], options: LayoutSimulationOptions = {}): ReturnType<LayoutProcessor['simulate']> {
        return super.simulate(elements, options);
    }

    applyRuntimeIntent(
        elements: Parameters<LayoutProcessor['simulate']>[0],
        intent: RuntimeIntent = {}
    ): RuntimeIntentResult {
        const kind = String(intent.kind || intent.type || '').trim();
        if (kind === 'formatting' || kind === 'format' || kind === 'apply-formatting') {
            return this.applyRuntimeFormattingIntentInternal(elements, intent);
        }
        if (kind === 'formatting-restore' || kind === 'restore-formatting') {
            return this.applyRuntimeFormattingRestoreIntentInternal(elements, intent);
        }
        return {
            changed: false,
            reason: 'unsupported-runtime-intent'
        };
    }

    applyRuntimeFormattingIntent(
        elements: Parameters<LayoutProcessor['simulate']>[0],
        intent: RuntimeIntent = {}
    ): RuntimeIntentResult {
        return this.applyRuntimeIntent(elements, {
            ...intent,
            kind: 'formatting'
        });
    }

    applyRuntimeFormattingRestoreIntent(
        elements: Parameters<LayoutProcessor['simulate']>[0],
        intent: RuntimeIntent = {}
    ): RuntimeIntentResult {
        return this.applyRuntimeIntent(elements, {
            ...intent,
            kind: 'formatting-restore'
        });
    }

    private resolveRuntimeFormattingTarget(target: RuntimeFormattingTarget = {}): {
        sourceId: string;
        actorId: string;
        sourceStart?: number;
        sourceEnd?: number;
    } {
        const sourceId = String(target.sourceId || target.containerKey || target.boxTargetId || '').trim();
        const actorId = String(target.actorId || '').trim();
        return {
            sourceId,
            actorId,
            ...(Number.isFinite(Number(target.sourceStart)) ? { sourceStart: Number(target.sourceStart) } : {}),
            ...(Number.isFinite(Number(target.sourceEnd)) ? { sourceEnd: Number(target.sourceEnd) } : {})
        };
    }

    private resolveRuntimeFormattingActor(session: unknown, target: RuntimeFormattingTarget = {}): RuntimeActor | null {
        const candidate = session as { getRegisteredActors?(): readonly RuntimeActor[] } | null;
        if (typeof candidate?.getRegisteredActors !== 'function') return null;
        const { sourceId, actorId } = this.resolveRuntimeFormattingTarget(target);
        const normalized = LayoutUtils.normalizeAuthorSourceId(sourceId) || sourceId;
        const actors = collectRuntimeFormattingActors(candidate.getRegisteredActors());
        if (actorId) {
            const exact = actors.find((actor) => actor?.actorId === actorId);
            if (exact && (!sourceId || exact.sourceId === sourceId || exact.sourceId === normalized)) return exact;
        }
        return actors.find((actor) => sourceId && (actor?.sourceId === sourceId || actor?.sourceId === normalized)) ?? null;
    }

    private getRuntimeFormattingElement(actor: RuntimeActor | null): Element | null {
        return actor?.flowBox?._sourceElement || actor?.element || null;
    }

    private buildRuntimeFormattingContext(session: unknown, pageIndex = 0): Record<string, unknown> {
        const runtimeSession = session as {
            getSimulationTick?(): number;
            resolveChunkOriginWorldY?(pageIndex: number, pageHeight: number): number;
            getPageExclusions?(pageIndex: number): unknown[];
            getWorldTraversalExclusions?(pageIndex: number): unknown[];
            publishActorSignal?(signal: unknown): unknown;
            getActorSignals?(topic: string): unknown[];
        } | null;
        const geometry = LayoutUtils.resolvePageGeometry(this.config, pageIndex);
        return {
            processor: this,
            pageWidth: geometry.width,
            pageHeight: geometry.height,
            margins: geometry.margins,
            resolvePageGeometry: (index: number) => LayoutUtils.resolvePageGeometry(this.config, index),
            simulationTick: typeof runtimeSession?.getSimulationTick === 'function' ? runtimeSession.getSimulationTick() : 0,
            chunkOriginWorldY: typeof runtimeSession?.resolveChunkOriginWorldY === 'function'
                ? runtimeSession.resolveChunkOriginWorldY(pageIndex, geometry.height)
                : pageIndex * geometry.height,
            getPageExclusions: (index: number) => runtimeSession?.getPageExclusions?.(index) || [],
            getWorldTraversalExclusions: (index: number) => runtimeSession?.getWorldTraversalExclusions?.(index) || [],
            publishActorSignal: (signal: unknown) => runtimeSession?.publishActorSignal?.(signal),
            readActorSignals: (topic: string) => runtimeSession?.getActorSignals?.(topic) || []
        };
    }

    private buildRuntimeFormattingHistoryEntry({
        actor,
        target = {},
        patch = {},
        before = null,
        after = null,
        frontier = null
    }: {
        actor?: RuntimeActor | null;
        target?: Record<string, unknown>;
        patch?: Record<string, unknown>;
        before?: unknown;
        after?: unknown;
        frontier?: unknown;
    } = {}): unknown {
        const sourceId = String(target.sourceId || actor?.sourceId || '').trim();
        if (!sourceId || !before || !after) return null;
        return {
            kind: 'formatting',
            target: {
                ...(Number.isFinite(Number(target.sourceStart)) ? { sourceStart: Number(target.sourceStart) } : {}),
                ...(Number.isFinite(Number(target.sourceEnd)) ? { sourceEnd: Number(target.sourceEnd) } : {}),
                sourceId,
                actorId: String(target.actorId || actor?.actorId || '').trim()
            },
            patch: cloneRuntimeJsonValue(patch || {}),
            before: cloneRuntimeJsonValue(before),
            after: cloneRuntimeJsonValue(after),
            frontier: cloneRuntimeJsonValue(frontier || null)
        };
    }

    private nextRuntimeIntentSignalKey(kind: string, actor: RuntimeActor | null): string {
        const actorKey = String(actor?.actorId || actor?.sourceId || 'unknown').trim() || 'unknown';
        return `runtime-intent:${kind}:${actorKey}:${++this.runtimeIntentSequence}`;
    }

    private applyRuntimeGeometryReplay(
        elements: Parameters<LayoutProcessor['simulate']>[0],
        affectedFrontier: unknown,
        source = 'runtime-formatting'
    ): RuntimeIntentResult {
        const pages = super.simulate(elements);
        const pageIndexes = Array.from({ length: Array.isArray(pages) ? pages.length : 0 }, (_entry, index) => index);
        return {
            changed: true,
            kind: 'geometry',
            frontier: affectedFrontier,
            replay: {
                replayKind: source,
                completion: 'complete'
            },
            update: {
                kind: 'geometry',
                source,
                actorIds: [],
                sourceIds: [],
                pageIndexes
            },
            pageIndexes,
            pages
        };
    }

    private applyRuntimeFormattingRestoreIntentInternal(
        _elements: Parameters<LayoutProcessor['simulate']>[0],
        intent: RuntimeIntent = {}
    ): RuntimeIntentResult {
        const session = this.getCurrentLayoutSession();
        const restoreSnapshot = intent.restoreSnapshot && typeof intent.restoreSnapshot === 'object'
            ? intent.restoreSnapshot as Record<string, unknown>
            : null;
        if (!restoreSnapshot || !Object.keys(restoreSnapshot).length) {
            return {
                changed: false,
                reason: 'unsupported-formatting-snapshot'
            };
        }
        const actor = this.resolveRuntimeFormattingActor(session, intent.target || {});
        const element = this.getRuntimeFormattingElement(actor);
        const target = this.resolveRuntimeFormattingTarget(intent.target || {});
        if (!session || !actor || !element) {
            return {
                changed: false,
                reason: 'target-not-live',
                sourceId: target.sourceId,
                actorId: target.actorId
            };
        }
        const runtimeSession = session as {
            resolveActorRuntimeFrontier?(actor: RuntimeActor, options: { actorId?: string; sourceId?: string; preferVisibleActorRefs?: boolean }): {
                pageIndex?: unknown;
                cursorY?: unknown;
                worldY?: unknown;
            } | null;
            invalidateSafeCheckpointsAfterFrontier?(frontier: unknown): void;
            getRegisteredActors?(): readonly RuntimeActor[];
            publishActorSignal?(signal: unknown): unknown;
            applyContentOnlyActorUpdates?(
                pages: readonly unknown[],
                currentPageBoxes: unknown[],
                actors: readonly RuntimeActor[],
                contextBase: Record<string, unknown>
            ): { patchedActors: number; pageIndexes: number[] };
        };
        const previousSnapshot = cloneRuntimeElementSourceSnapshot(element);
        if (runtimeElementSourceSnapshotsEqual(previousSnapshot, restoreSnapshot)) {
            return {
                changed: false,
                reason: 'already-current',
                sourceId: target.sourceId || actor.sourceId,
                actorId: actor.actorId
            };
        }
        const frontier = runtimeSession.resolveActorRuntimeFrontier?.(actor, {
            actorId: actor.actorId,
            sourceId: actor.sourceId,
            preferVisibleActorRefs: true
        }) ?? null;
        const pageIndex = Number.isFinite(Number(frontier?.pageIndex))
            ? Math.max(0, Math.floor(Number(frontier?.pageIndex)))
            : 0;
        const contextBase = this.buildRuntimeFormattingContext(session, pageIndex);
        const resolvedTarget = {
            ...(intent.target || {}),
            ...target,
            sourceId: target.sourceId || actor.sourceId,
            actorId: actor.actorId
        };
        runtimeSession.publishActorSignal?.({
            topic: buildRuntimeIntentTopic(actor.sourceId || target.sourceId),
            publisherActorId: 'app:runtime-intent',
            publisherSourceId: 'app:runtime-intent',
            publisherActorKind: 'runtime-intent',
            pageIndex,
            cursorY: Number.isFinite(Number(frontier?.cursorY)) ? Number(frontier?.cursorY) : 0,
            ...(Number.isFinite(Number(frontier?.worldY)) ? { worldY: Number(frontier?.worldY) } : {}),
            signalKey: this.nextRuntimeIntentSignalKey('formatting-restore', actor),
            payload: {
                kind: 'formatting',
                target: resolvedTarget,
                patch: cloneRuntimeJsonValue(intent.patch || {}),
                restoreSnapshot: cloneRuntimeJsonValue(restoreSnapshot)
            }
        });
        const observationResult = actor.updateCommittedState?.({
            ...contextBase,
            pageIndex,
            cursorY: Number.isFinite(Number(frontier?.cursorY)) ? Number(frontier?.cursorY) : 0
        }) ?? actor.observeCommittedSignals?.({
            ...contextBase,
            pageIndex,
            cursorY: Number.isFinite(Number(frontier?.cursorY)) ? Number(frontier?.cursorY) : 0
        });
        const observation = normalizeObservationResult(observationResult as any);
        if (!observation?.changed) {
            restoreRuntimeElementSourceSnapshot(element, previousSnapshot);
            return {
                changed: false,
                reason: 'actor-did-not-accept-intent',
                sourceId: actor.sourceId,
                actorId: actor.actorId
            };
        }
        const affectedFrontier = frontier ?? observation.earliestAffectedFrontier ?? null;
        if (affectedFrontier) {
            runtimeSession.invalidateSafeCheckpointsAfterFrontier?.(affectedFrontier);
        }
        if (observation.geometryChanged) {
            const actors = collectRuntimeFormattingActors(runtimeSession.getRegisteredActors?.() ?? []);
            refreshRuntimeActorHostChain(actors, actor);
            const replay = this.applyRuntimeGeometryReplay(_elements, affectedFrontier, 'runtime-formatting-restore');
            return {
                ...replay,
                sourceId: actor.sourceId,
                actorId: actor.actorId,
                update: {
                    ...(replay.update || { kind: 'geometry', source: 'runtime-formatting-restore', actorIds: [], sourceIds: [], pageIndexes: [] }),
                    actorIds: [actor.actorId].filter((id): id is string => !!id),
                    sourceIds: [actor.sourceId].filter((id): id is string => !!id)
                }
            };
        }
        const pages = this.getLastPrintPipelineSnapshot().pages;
        const actors = collectRuntimeFormattingActors(runtimeSession.getRegisteredActors?.() ?? []);
        const visibleCandidate = refreshRuntimeActorHostChain(actors, actor);
        const redrawActor = (candidate: RuntimeActor): { patchedActors: number; pageIndexes: number[] } =>
            runtimeSession.applyContentOnlyActorUpdates?.(pages, [], [candidate], contextBase) ?? { patchedActors: 0, pageIndexes: [] };
        try {
            const { visibleActor, redraw } = redrawRuntimeActorThroughHosts(actors, visibleCandidate, redrawActor);
            if (Number(redraw?.patchedActors || 0) === 0) {
                restoreRuntimeElementSourceSnapshot(element, previousSnapshot);
                actor.rebuildLiveFlowBox?.();
                return {
                    changed: false,
                    reason: 'no-visible-boxes',
                    sourceId: actor.sourceId,
                    actorId: actor.actorId,
                    pages
                };
            }
            return {
                changed: true,
                kind: 'content-only',
                sourceId: actor.sourceId,
                actorId: actor.actorId,
                visibleActorId: visibleActor.actorId,
                frontier: affectedFrontier,
                redraw,
                update: {
                    kind: 'content-only',
                    source: 'runtime-formatting-restore',
                    actorIds: [actor.actorId].filter((id): id is string => !!id),
                    sourceIds: [actor.sourceId].filter((id): id is string => !!id),
                    pageIndexes: redraw.pageIndexes || []
                },
                pageIndexes: redraw.pageIndexes || [],
                pages
            };
        } catch (error) {
            restoreRuntimeElementSourceSnapshot(element, previousSnapshot);
            actor.rebuildLiveFlowBox?.();
            throw error;
        }
    }

    private applyRuntimeFormattingIntentInternal(
        _elements: Parameters<LayoutProcessor['simulate']>[0],
        intent: RuntimeIntent = {}
    ): RuntimeIntentResult {
        const session = this.getCurrentLayoutSession();
        const formatting = normalizeRuntimeFormattingPatch(intent.patch || {});
        if (!Object.keys(formatting).length) {
            return {
                changed: false,
                reason: 'unsupported-formatting'
            };
        }
        const actor = this.resolveRuntimeFormattingActor(session, intent.target || {});
        const element = this.getRuntimeFormattingElement(actor);
        const target = this.resolveRuntimeFormattingTarget(intent.target || {});
        const rangeTarget = isRuntimeRangeTarget(intent.target || {});
        if (!session || !actor || !element) {
            return {
                changed: false,
                reason: 'target-not-live',
                sourceId: target.sourceId,
                actorId: target.actorId
            };
        }
        const runtimeSession = session as {
            resolveActorRuntimeFrontier?(actor: RuntimeActor, options: { actorId?: string; sourceId?: string; preferVisibleActorRefs?: boolean }): {
                pageIndex?: unknown;
                cursorY?: unknown;
                worldY?: unknown;
            } | null;
            invalidateSafeCheckpointsAfterFrontier?(frontier: unknown): void;
            getRegisteredActors?(): readonly RuntimeActor[];
            publishActorSignal?(signal: unknown): unknown;
            applyContentOnlyActorUpdates?(
                pages: readonly unknown[],
                currentPageBoxes: unknown[],
                actors: readonly RuntimeActor[],
                contextBase: Record<string, unknown>
            ): { patchedActors: number; pageIndexes: number[] };
        };
        const previousSnapshot = cloneRuntimeElementSourceSnapshot(element);
        const previousStyle = element.properties && typeof element.properties.style === 'object' && element.properties.style
            ? { ...element.properties.style }
            : {};
        const changed = rangeTarget || Object.entries(formatting).some(([key, value]) => previousStyle[key] !== value);
        if (!changed) {
            return {
                changed: false,
                reason: 'already-current',
                sourceId: target.sourceId || actor.sourceId,
                actorId: actor.actorId
            };
        }
        const frontier = runtimeSession.resolveActorRuntimeFrontier?.(actor, {
            actorId: actor.actorId,
            sourceId: actor.sourceId,
            preferVisibleActorRefs: true
        }) ?? null;
        const pageIndex = Number.isFinite(Number(frontier?.pageIndex))
            ? Math.max(0, Math.floor(Number(frontier?.pageIndex)))
            : 0;
        const contextBase = this.buildRuntimeFormattingContext(session, pageIndex);
        const resolvedTarget = {
            ...(intent.target || {}),
            ...target,
            sourceId: target.sourceId || actor.sourceId,
            actorId: actor.actorId
        };
        runtimeSession.publishActorSignal?.({
            topic: buildRuntimeIntentTopic(actor.sourceId || target.sourceId),
            publisherActorId: 'app:runtime-intent',
            publisherSourceId: 'app:runtime-intent',
            publisherActorKind: 'runtime-intent',
            pageIndex,
            cursorY: Number.isFinite(Number(frontier?.cursorY)) ? Number(frontier?.cursorY) : 0,
            ...(Number.isFinite(Number(frontier?.worldY)) ? { worldY: Number(frontier?.worldY) } : {}),
            signalKey: this.nextRuntimeIntentSignalKey('formatting', actor),
            payload: {
                kind: 'formatting',
                target: resolvedTarget,
                patch: formatting
            }
        });
        const observationResult = actor.updateCommittedState?.({
            ...contextBase,
            pageIndex,
            cursorY: Number.isFinite(Number(frontier?.cursorY)) ? Number(frontier?.cursorY) : 0
        }) ?? actor.observeCommittedSignals?.({
            ...contextBase,
            pageIndex,
            cursorY: Number.isFinite(Number(frontier?.cursorY)) ? Number(frontier?.cursorY) : 0
        });
        const observation = normalizeObservationResult(observationResult as any);
        if (!observation?.changed) {
            restoreRuntimeElementSourceSnapshot(element, previousSnapshot);
            return {
                changed: false,
                reason: 'actor-did-not-accept-intent',
                sourceId: actor.sourceId,
                actorId: actor.actorId
            };
        }
        const affectedFrontier = frontier ?? observation.earliestAffectedFrontier ?? null;
        if (affectedFrontier) {
            runtimeSession.invalidateSafeCheckpointsAfterFrontier?.(affectedFrontier);
        }
        const history = this.buildRuntimeFormattingHistoryEntry({
            actor,
            target: resolvedTarget,
            patch: formatting,
            before: previousSnapshot,
            after: cloneRuntimeElementSourceSnapshot(element),
            frontier: affectedFrontier
        });
        if (observation.geometryChanged) {
            const actors = collectRuntimeFormattingActors(runtimeSession.getRegisteredActors?.() ?? []);
            refreshRuntimeActorHostChain(actors, actor);
            const replay = this.applyRuntimeGeometryReplay(_elements, affectedFrontier);
            return {
                ...replay,
                sourceId: actor.sourceId,
                actorId: actor.actorId,
                history,
                update: {
                    ...(replay.update || { kind: 'geometry', source: 'runtime-formatting', actorIds: [], sourceIds: [], pageIndexes: [] }),
                    actorIds: [actor.actorId].filter((id): id is string => !!id),
                    sourceIds: [actor.sourceId].filter((id): id is string => !!id)
                }
            };
        }
        const pages = this.getLastPrintPipelineSnapshot().pages;
        const actors = collectRuntimeFormattingActors(runtimeSession.getRegisteredActors?.() ?? []);
        const visibleCandidate = refreshRuntimeActorHostChain(actors, actor);
        const redrawActor = (candidate: RuntimeActor): { patchedActors: number; pageIndexes: number[] } =>
            runtimeSession.applyContentOnlyActorUpdates?.(pages, [], [candidate], contextBase) ?? { patchedActors: 0, pageIndexes: [] };
        try {
            const { visibleActor, redraw } = redrawRuntimeActorThroughHosts(actors, visibleCandidate, redrawActor);
            if (Number(redraw?.patchedActors || 0) === 0) {
                restoreRuntimeElementSourceSnapshot(element, previousSnapshot);
                actor.rebuildLiveFlowBox?.();
                return {
                    changed: false,
                    reason: 'no-visible-boxes',
                    sourceId: actor.sourceId,
                    actorId: actor.actorId,
                    pages
                };
            }
            return {
                changed: true,
                kind: 'content-only',
                sourceId: actor.sourceId,
                actorId: actor.actorId,
                visibleActorId: visibleActor.actorId,
                frontier: affectedFrontier,
                history,
                redraw,
                update: {
                    kind: 'content-only',
                    source: 'runtime-formatting',
                    actorIds: [actor.actorId].filter((id): id is string => !!id),
                    sourceIds: [actor.sourceId].filter((id): id is string => !!id),
                    pageIndexes: redraw.pageIndexes || []
                },
                pageIndexes: redraw.pageIndexes || [],
                pages
            };
        } catch (error) {
            restoreRuntimeElementSourceSnapshot(element, previousSnapshot);
            actor.rebuildLiveFlowBox?.();
            throw error;
        }
    }

    simulateSpatialDocument(document: SpatialDocument): ReturnType<LayoutProcessor['simulate']> {
        const elements = spatialDocumentToElements(document);
        const hasPageTemplateOverrides = !!(document.pageTemplate?.header || document.pageTemplate?.footer);
        if (!hasPageTemplateOverrides) {
            return this.simulate(elements);
        }
        const pageTemplate = applySpatialDocumentPageTemplate(document, {
            header: this.config.header,
            footer: this.config.footer
        });
        const derivedConfig: LayoutConfig = {
            ...this.config,
            header: pageTemplate.header,
            footer: pageTemplate.footer
        };
        const engine = new LayoutEngine(derivedConfig, this.runtime);
        return engine.simulate(elements);
    }

    simulateSpatialDocumentStrict(document: SpatialDocument): ReturnType<LayoutProcessor['simulate']> {
        const elements = spatialDocumentToElementsStrict(document);
        const hasPageTemplateOverrides = !!(document.pageTemplate?.header || document.pageTemplate?.footer);
        if (!hasPageTemplateOverrides) {
            return this.simulate(elements);
        }
        const pageTemplate = applySpatialDocumentPageTemplateStrict(document, {
            header: this.config.header,
            footer: this.config.footer
        });
        const derivedConfig: LayoutConfig = {
            ...this.config,
            header: pageTemplate.header,
            footer: pageTemplate.footer
        };
        const engine = new LayoutEngine(derivedConfig, this.runtime);
        return engine.simulate(elements);
    }

}
