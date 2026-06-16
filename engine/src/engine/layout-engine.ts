import { Element, LayoutConfig, type Box, type LayoutScriptingConfig } from './types';
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
import {
    normalizeObservationResult,
    type PackagerHitTestResult,
    type PackagerUnit
} from './layout/packagers/packager-types';
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
import {
    buildPageSnapshotToken,
    computePageTokenChanges
} from './runtime/simulation/core/page-snapshots';
import type {
    SimulationContinueOptions,
    SimulationContinueResult,
    SimulationRunner
} from './runtime/simulation/types';
import { ScriptRuntimeHost } from './layout/script-runtime-host';
import type { RuntimeProfileMetric } from './layout/runtime/session/session-runtime-types';

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
    replayUntilPage?: unknown;
    replayUntilY?: unknown;
    replayUntil?: RuntimeReplayUntilOptions | null;
};

type RuntimeReplayUntilOptions = {
    page?: unknown;
    y?: unknown;
    untilPage?: unknown;
    untilY?: unknown;
    maxMilliseconds?: unknown;
};

type RuntimeReplayContinuation = {
    continueUntil(options?: RuntimeReplayUntilOptions | null): RuntimeIntentResult;
    continueUntilPage(pageIndex: number): RuntimeIntentResult;
    continueUntilY(y: number): RuntimeIntentResult;
    getCurrentPages(): unknown[];
    isFinished(): boolean;
};

type InitialLayoutContinuationOptions = SimulationContinueOptions;

type InitialLayoutResult = {
    changed: boolean;
    kind?: 'geometry';
    layoutKind?: 'initial';
    completion?: 'partial' | 'complete';
    pending?: boolean;
    reason?: string;
    progress?: SimulationContinueResult;
    update?: {
        kind: 'geometry';
        source: 'initial-layout' | 'initial-layout-continuation';
        pageIndexes: number[];
    };
    pageIndexes?: number[];
    pages?: unknown[];
};

export type EngineProtocolEvent = {
    name: string;
    payload: unknown;
    requestName?: string;
    timestamp: number;
};

export type EngineProtocolListener = (event: EngineProtocolEvent) => void;

const ENGINE_PROTOCOL_SCRIPT: LayoutScriptingConfig = {
    methods: {
        'onRequest(name, payload)': [
            'if (name === "layout.startReplayAroundViewport") {',
            '  var replayResult = startReplayAroundViewport(payload);',
            '  emit("layout.startReplayAroundViewport", replayResult);',
            '  emit("layout.replayProgress", replayResult);',
            '  return replayResult;',
            '}',
            'if (name === "layout.continueReplay") {',
            '  var replayContinueResult = continueReplay(payload);',
            '  emit("layout.continueReplay", replayContinueResult);',
            '  emit("layout.replayProgress", replayContinueResult);',
            '  return replayContinueResult;',
            '}',
            'if (name === "layout.applyRuntimeFormatting") {',
            '  var formattingResult = applyRuntimeFormatting(payload && payload.elements, payload && payload.intent);',
            '  emit("layout.runtimeFormattingApplied", formattingResult);',
            '  return formattingResult;',
            '}',
            'if (name === "layout.restoreRuntimeFormatting") {',
            '  var restoreResult = restoreRuntimeFormatting(payload && payload.elements, payload && payload.intent);',
            '  emit("layout.runtimeFormattingRestored", restoreResult);',
            '  return restoreResult;',
            '}',
            'if (name === "layout.applyRuntimeIntent") {',
            '  var intent = payload && payload.intent || {};',
            '  var kind = String(intent.kind || intent.type || "").trim();',
            '  var runtimeIntentResult;',
            '  if (kind === "formatting" || kind === "format" || kind === "apply-formatting") {',
            '    runtimeIntentResult = applyRuntimeFormatting(payload && payload.elements, intent);',
            '  } else if (kind === "formatting-restore" || kind === "restore-formatting") {',
            '    runtimeIntentResult = restoreRuntimeFormatting(payload && payload.elements, intent);',
            '  } else {',
            '    runtimeIntentResult = { changed: false, reason: "unsupported-runtime-intent" };',
            '  }',
            '  emit("layout.runtimeIntentApplied", runtimeIntentResult);',
            '  return runtimeIntentResult;',
            '}',
            'return { ok: false, reason: "unknown-request", name: name };'
        ]
    }
};

const ENGINE_PROTOCOL_PROFILE_HOST = {
    recordProfile(_metric: RuntimeProfileMetric, _delta: number): void {
        // Protocol probes reuse the script host but are outside a layout session.
    }
};

function cloneEngineProtocolPayload<T>(payload: T): T {
    return cloneRuntimeJsonValue(payload);
}

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
        addedPageIndexes?: number[];
        removedPageIndexes?: number[];
        replayFrontier?: {
            pageIndex: number;
            cursorY?: number;
            worldY?: number;
            actorIndex?: number;
            actorId?: string;
            sourceId?: string;
        } | null;
    };
    pageIndexes?: number[];
    pages?: unknown;
    history?: unknown;
    replay?: unknown;
    replaySession?: RuntimeReplayContinuation;
};

type RuntimeReplayState = {
    id: string;
    session: RuntimeReplayContinuation;
    source: string;
};

export type WorldSimulationHitTestRequest = {
    pageIndex?: number;
    x?: number;
    y?: number;
};

export type WorldSimulationHitTestResult = {
    kind: 'page-missing' | 'page' | 'box';
    pageIndex: number;
    point: { x: number; y: number };
    box: Box | null;
    actorId?: string;
    sourceId?: string;
    packagerHit?: PackagerHitTestResult | null;
    reason?: string;
};

class WorldSimulation {
    private pages: ReturnType<LayoutProcessor['simulate']> = [];
    private lastInitialLayoutResult: InitialLayoutResult | null = null;
    private lastRuntimeIntentResult: RuntimeIntentResult | null = null;

    constructor(
        private readonly engine: LayoutEngine,
        private readonly elements: Parameters<LayoutProcessor['simulate']>[0]
    ) {}

    run(options: LayoutSimulationOptions = {}): ReturnType<LayoutProcessor['simulate']> {
        this.pages = this.engine.simulate(this.elements, options);
        this.lastInitialLayoutResult = null;
        this.lastRuntimeIntentResult = null;
        return this.pages;
    }

    start(options: InitialLayoutContinuationOptions = {}): InitialLayoutResult {
        const result = this.engine.startInitialLayout(this.elements, options);
        this.lastInitialLayoutResult = result;
        this.pages = Array.isArray(result.pages)
            ? result.pages as ReturnType<LayoutProcessor['simulate']>
            : this.pages;
        return result;
    }

    continue(options: InitialLayoutContinuationOptions = {}): InitialLayoutResult {
        const result = this.engine.continueInitialLayout(options);
        this.lastInitialLayoutResult = result;
        this.pages = Array.isArray(result.pages)
            ? result.pages as ReturnType<LayoutProcessor['simulate']>
            : this.pages;
        return result;
    }

    getPages(): ReturnType<LayoutProcessor['simulate']> {
        return this.pages;
    }

    hitTestPoint(request: WorldSimulationHitTestRequest = {}): WorldSimulationHitTestResult {
        const pageIndex = Math.max(0, Math.floor(Number(request.pageIndex || 0)));
        const point = {
            x: Number.isFinite(Number(request.x)) ? Number(request.x) : 0,
            y: Number.isFinite(Number(request.y)) ? Number(request.y) : 0
        };
        const page = this.pages[pageIndex] as { boxes?: Box[] } | undefined;
        if (!page) {
            return { kind: 'page-missing', pageIndex, point, box: null };
        }

        const boxes = Array.isArray(page.boxes) ? page.boxes : [];
        for (let index = boxes.length - 1; index >= 0; index -= 1) {
            const box = boxes[index];
            const x = Number(box?.x || 0);
            const y = Number(box?.y || 0);
            const w = Math.max(0, Number(box?.w || 0));
            const h = Math.max(0, Number(box?.h || 0));
            if (w <= 0 || h <= 0) continue;
            if (point.x < x || point.x > x + w || point.y < y || point.y > y + h) continue;

            const actorId = String(box?.meta?.actorId || '');
            const sourceId = String(box?.meta?.sourceId || '');
            const hostActorId = String(box?.meta?.hostActorId || '');
            const directActor = this.findActorById(actorId);
            const hostActor = this.findActorById(hostActorId);
            const hitInput = {
                pageIndex,
                pagePoint: point,
                boxPoint: { x: point.x - x, y: point.y - y },
                box
            };
            const packagerHit = hostActor?.hitTestPoint?.(hitInput)
                ?? directActor?.hitTestPoint?.(hitInput)
                ?? null;
            return {
                kind: 'box',
                pageIndex,
                point,
                box,
                actorId: actorId || undefined,
                sourceId: sourceId || undefined,
                packagerHit,
                reason: (hostActor || directActor) && !packagerHit ? 'actor-did-not-answer' : undefined
            };
        }

        return { kind: 'page', pageIndex, point, box: null };
    }

    private findActorById(actorId: string): PackagerUnit | null {
        if (!actorId) return null;
        const session = this.engine.getCurrentLayoutSession?.();
        const actors = session?.getRegisteredActors?.() ?? [];
        return actors.find((actor) => actor.actorId === actorId) ?? null;
    }

    getPageCount(): number {
        return this.pages.length || this.engine.getPageCount();
    }

    getPageViewport(pageIndex: number): ViewportHandle {
        return this.engine.getPageViewport(pageIndex);
    }

    getDefaultViewport(): ViewportHandle {
        return this.engine.getDefaultViewport();
    }

    getWorldViewport(request: WorldViewportRequest): ViewportHandle {
        return this.engine.getWorldViewport(request);
    }

    getProfileSnapshot(): Record<string, unknown> {
        return this.engine.getProfileSnapshot();
    }

    getStatus(): Record<string, unknown> {
        return this.engine.getSimulationStatus();
    }

    applyIntent(intent: RuntimeIntent = {}): RuntimeIntentResult {
        const result = this.engine.applyRuntimeIntent(this.elements, intent);
        this.lastRuntimeIntentResult = result;
        this.pages = Array.isArray(result.pages)
            ? result.pages as ReturnType<LayoutProcessor['simulate']>
            : this.pages;
        return result;
    }

    applyFormatting(intent: RuntimeIntent = {}): RuntimeIntentResult {
        const result = this.engine.applyRuntimeFormattingIntent(this.elements, intent);
        this.lastRuntimeIntentResult = result;
        this.pages = Array.isArray(result.pages)
            ? result.pages as ReturnType<LayoutProcessor['simulate']>
            : this.pages;
        return result;
    }

    restoreFormatting(intent: RuntimeIntent = {}): RuntimeIntentResult {
        const result = this.engine.applyRuntimeFormattingRestoreIntent(this.elements, intent);
        this.lastRuntimeIntentResult = result;
        this.pages = Array.isArray(result.pages)
            ? result.pages as ReturnType<LayoutProcessor['simulate']>
            : this.pages;
        return result;
    }

    startReplayAroundViewport(request: Record<string, unknown> = {}): RuntimeIntentResult {
        const result = this.engine.startReplayAroundViewport({
            ...request,
            elements: this.elements
        });
        this.lastRuntimeIntentResult = result;
        this.pages = Array.isArray(result.pages)
            ? result.pages as ReturnType<LayoutProcessor['simulate']>
            : this.pages;
        return result;
    }

    continueReplay(request: Record<string, unknown> = {}): RuntimeIntentResult {
        const result = this.engine.continueReplay(request);
        this.lastRuntimeIntentResult = result;
        this.pages = Array.isArray(result.pages)
            ? result.pages as ReturnType<LayoutProcessor['simulate']>
            : this.pages;
        return result;
    }

    getLastInitialLayoutResult(): InitialLayoutResult | null {
        return this.lastInitialLayoutResult;
    }

    getLastRuntimeIntentResult(): RuntimeIntentResult | null {
        return this.lastRuntimeIntentResult;
    }
}

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

function normalizeRuntimeReplayFrontier(frontier: unknown): NonNullable<RuntimeIntentResult['update']>['replayFrontier'] {
    if (!frontier || typeof frontier !== 'object') return null;
    const raw = frontier as Record<string, unknown>;
    if (!Number.isFinite(raw.pageIndex)) return null;
    return {
        pageIndex: Math.max(0, Math.floor(Number(raw.pageIndex))),
        ...(Number.isFinite(raw.cursorY) ? { cursorY: Number(raw.cursorY) } : {}),
        ...(Number.isFinite(raw.worldY) ? { worldY: Number(raw.worldY) } : {}),
        ...(Number.isFinite(raw.actorIndex) ? { actorIndex: Math.max(0, Math.floor(Number(raw.actorIndex))) } : {}),
        ...(typeof raw.actorId === 'string' && raw.actorId ? { actorId: raw.actorId } : {}),
        ...(typeof raw.sourceId === 'string' && raw.sourceId ? { sourceId: raw.sourceId } : {})
    };
}

function normalizeRuntimeReplayUntilOptions(options: RuntimeReplayUntilOptions | null | undefined): {
    untilPage?: number;
    untilY?: number;
    maxMilliseconds?: number;
} | null {
    if (!options || typeof options !== 'object') return null;
    const result: { untilPage?: number; untilY?: number; maxMilliseconds?: number } = {};
    if (Number.isFinite(Number(options.page ?? options.untilPage))) {
        result.untilPage = Math.max(0, Math.floor(Number(options.page ?? options.untilPage)));
    }
    if (Number.isFinite(Number(options.y ?? options.untilY))) {
        result.untilY = Math.max(0, Number(options.y ?? options.untilY));
    }
    if (Number.isFinite(Number(options.maxMilliseconds))) {
        result.maxMilliseconds = Math.max(0, Number(options.maxMilliseconds));
    }
    return Number.isFinite(result.untilPage) || Number.isFinite(result.untilY) || Number.isFinite(result.maxMilliseconds)
        ? result
        : null;
}

function resolveRuntimeReplayUntilIntent(intent: RuntimeIntent): RuntimeReplayUntilOptions | null {
    if (Number.isFinite(Number(intent.replayUntilY))) {
        return { y: Number(intent.replayUntilY) };
    }
    if (Number.isFinite(Number(intent.replayUntilPage))) {
        return { page: Number(intent.replayUntilPage) };
    }
    return intent.replayUntil ?? null;
}

function normalizeRuntimeWorldRegion(payload: unknown): RuntimeReplayUntilOptions | null {
    if (!payload || typeof payload !== 'object') return null;
    const raw = payload as Record<string, unknown>;
    const viewport = (raw.viewport && typeof raw.viewport === 'object' ? raw.viewport : raw.region) as Record<string, unknown> | undefined;
    const source = viewport || raw;
    const y = Number(source?.y ?? source?.worldY ?? source?.top);
    const height = Number(source?.height ?? source?.viewportHeight);
    const bottom = Number(source?.bottom ?? source?.worldBottom);
    const overscanY = Number(source?.overscanY ?? raw.overscanY ?? 0);
    if (Number.isFinite(y) && Number.isFinite(height)) {
        return { y: Math.max(0, y + Math.max(0, height) + (Number.isFinite(overscanY) ? Math.max(0, overscanY) : 0)) };
    }
    if (Number.isFinite(bottom)) {
        return { y: Math.max(0, bottom + (Number.isFinite(overscanY) ? Math.max(0, overscanY) : 0)) };
    }
    const pageIndex = Number(source?.pageIndex ?? source?.page);
    const pageCount = Number(source?.pageCount ?? raw.pageCount ?? 1);
    const overscanPages = Number(source?.overscanPages ?? raw.overscanPages ?? 0);
    if (Number.isFinite(pageIndex)) {
        return { page: Math.max(0, Math.floor(pageIndex + Math.max(1, Number.isFinite(pageCount) ? pageCount : 1) - 1 + Math.max(0, Number.isFinite(overscanPages) ? overscanPages : 0))) };
    }
    return null;
}

function normalizeRuntimeReplayRequestOptions(payload: unknown): RuntimeReplayUntilOptions | null {
    if (!payload || typeof payload !== 'object') return null;
    const raw = payload as Record<string, unknown>;
    const explicit = normalizeRuntimeReplayUntilOptions((raw.options || raw.replayUntil) as RuntimeReplayUntilOptions | null | undefined);
    const region = normalizeRuntimeWorldRegion(raw);
    return {
        ...(region || {}),
        ...(explicit || {})
    };
}

function serializeRuntimeReplayResult(result: RuntimeIntentResult, replayId?: string | null): RuntimeIntentResult {
    const { replaySession: _replaySession, replay, ...rest } = result;
    return {
        ...rest,
        replay: {
            ...(replay && typeof replay === 'object' ? replay as Record<string, unknown> : {}),
            pending: Boolean(_replaySession && !result.replaySession?.isFinished?.()),
            ...(replayId ? { replayId } : {})
        }
    };
}

function buildRuntimePageTokenMap(pages: readonly any[]): Map<number, string> {
    return new Map((Array.isArray(pages) ? pages : []).map((page: any) => [Number(page.index), buildPageSnapshotToken(page)] as const));
}

function computeRuntimeReplayPageChanges(
    previousTokens: Map<number, string>,
    nextPages: readonly any[],
    options: { partial: boolean }
): { pageIndexes: number[]; addedPageIndexes: number[]; removedPageIndexes: number[] } {
    const nextTokens = buildRuntimePageTokenMap(nextPages);
    if (!options.partial) return computePageTokenChanges(previousTokens, nextTokens);

    const changed = new Set<number>();
    const added = new Set<number>();
    const removed = new Set<number>();
    const observedPageIndexes = new Set<number>();
    for (const page of nextPages || []) {
        const pageIndex = Number(page?.index);
        if (!Number.isFinite(pageIndex)) continue;
        observedPageIndexes.add(pageIndex);
        const nextToken = nextTokens.get(pageIndex);
        if (!previousTokens.has(pageIndex)) {
            added.add(pageIndex);
            changed.add(pageIndex);
        } else if (previousTokens.get(pageIndex) !== nextToken) {
            changed.add(pageIndex);
        }
    }
    for (const pageIndex of observedPageIndexes) {
        if (nextTokens.has(pageIndex)) continue;
        if (previousTokens.has(pageIndex)) {
            removed.add(pageIndex);
            changed.add(pageIndex);
        }
    }
    return {
        pageIndexes: Array.from(changed).sort((a, b) => a - b),
        addedPageIndexes: Array.from(added).sort((a, b) => a - b),
        removedPageIndexes: Array.from(removed).sort((a, b) => a - b)
    };
}

function isContentOnlyGeometryMismatch(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error || '');
    return /^\[LayoutSession\] content-only actor ".+" changed box (width|height)\.$/.test(message);
}

function findRuntimeElementPathBySourceId(elements: readonly Element[], sourceId: string): { element: Element; ancestors: Element[] } | null {
    const normalized = LayoutUtils.normalizeAuthorSourceId(sourceId) || sourceId;
    const visit = (element: Element | null | undefined, ancestors: Element[]): { element: Element; ancestors: Element[] } | null => {
        if (!element) return null;
        const elementSourceId = LayoutUtils.normalizeAuthorSourceId(element.properties?.sourceId) || String(element.properties?.sourceId || '');
        if (elementSourceId && (elementSourceId === sourceId || elementSourceId === normalized)) {
            return { element, ancestors };
        }
        for (const child of element.children || []) {
            const found = visit(child, [...ancestors, element]);
            if (found) return found;
        }
        return null;
    };
    for (const element of elements || []) {
        const found = visit(element, []);
        if (found) return found;
    }
    return null;
}

function clearRuntimeMaterializationState(element: Element): void {
    const mutable = element as Element & Record<string, unknown>;
    delete mutable._normalizedTable;
    delete mutable._tableModel;
    delete mutable._tableResolved;
    if (element.properties && typeof element.properties === 'object') {
        delete (element.properties as Record<string, unknown>)._normalizedTable;
        delete (element.properties as Record<string, unknown>)._tableModel;
        delete (element.properties as Record<string, unknown>)._tableResolved;
    }
}

function readRuntimeBoxSourceId(box: any): string {
    return String(box?.meta?.sourceId || box?.properties?.sourceId || box?.sourceId || '').trim();
}

function resolveRuntimeSourceFrontierFromPages(pages: readonly any[], sourceId: string): NonNullable<RuntimeIntentResult['update']>['replayFrontier'] {
    const normalized = LayoutUtils.normalizeAuthorSourceId(sourceId) || sourceId;
    for (const page of pages || []) {
        for (const box of page?.boxes || []) {
            const boxSourceId = readRuntimeBoxSourceId(box);
            if (boxSourceId !== sourceId && boxSourceId !== normalized) continue;
            const pageIndex = Number.isFinite(Number(page.index)) ? Math.max(0, Math.floor(Number(page.index))) : 0;
            const cursorY = Number.isFinite(Number(box.y)) ? Number(box.y) : 0;
            const pageHeight = Number.isFinite(Number(page.height)) ? Number(page.height) : 0;
            return {
                pageIndex,
                cursorY,
                worldY: pageIndex * pageHeight + cursorY,
                sourceId: normalized
            };
        }
    }
    return normalized ? { pageIndex: 0, cursorY: 0, worldY: 0, sourceId: normalized } : null;
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
    private runtimeReplaySequence = 0;
    private protocolScriptHost: ScriptRuntimeHost | null = null;
    private protocolListeners = new Map<string, Set<EngineProtocolListener>>();
    private activeInitialLayout: {
        runner: SimulationRunner;
        publishedPageCount: number;
    } | null = null;
    private activeRuntimeReplay: RuntimeReplayState | null = null;

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

    createWorldSimulation(elements: Parameters<LayoutProcessor['simulate']>[0]): WorldSimulation {
        return new WorldSimulation(this, elements);
    }

    getPageCount(): number {
        return this.readPageCount();
    }

    private sendProtocolRequest(name: string, payload?: unknown): unknown {
        const requestName = String(name || '').trim();
        if (!requestName) {
            return {
                ok: false,
                reason: 'empty-request-name'
            };
        }
        const host = this.getProtocolScriptHost();
        const result = host.runHandler(
            'onRequest',
            'onRequest',
            {
                emit: (eventName: unknown, eventPayload?: unknown) => {
                    this.publishProtocolEvent(String(eventName || ''), eventPayload, requestName);
                    return true;
                },
                startReplayAroundViewport: (request: unknown) => this.startReplayAroundViewportDirect(
                    request && typeof request === 'object' ? request as Record<string, unknown> : {}
                ),
                continueReplay: (request: unknown) => this.continueReplayDirect(
                    request && typeof request === 'object' ? request as Record<string, unknown> : {}
                ),
                applyRuntimeFormatting: (elements: unknown, intent: unknown) => this.applyRuntimeFormattingIntentInternal(
                    Array.isArray(elements) ? elements as Parameters<LayoutProcessor['simulate']>[0] : [],
                    (intent && typeof intent === 'object' ? intent : {}) as RuntimeIntent
                ),
                restoreRuntimeFormatting: (elements: unknown, intent: unknown) => this.applyRuntimeFormattingRestoreIntentInternal(
                    Array.isArray(elements) ? elements as Parameters<LayoutProcessor['simulate']>[0] : [],
                    (intent && typeof intent === 'object' ? intent : {}) as RuntimeIntent
                )
            },
            { name: requestName, payload },
            ENGINE_PROTOCOL_PROFILE_HOST
        );
        return cloneEngineProtocolPayload(result);
    }

    private listenProtocolEvent(name: string, listener: EngineProtocolListener): () => void {
        const eventName = String(name || '').trim();
        if (!eventName) {
            throw new Error('[LayoutEngine] listen() requires a non-empty event name.');
        }
        const listeners = this.protocolListeners.get(eventName) ?? new Set<EngineProtocolListener>();
        listeners.add(listener);
        this.protocolListeners.set(eventName, listeners);
        return () => {
            listeners.delete(listener);
            if (listeners.size === 0) {
                this.protocolListeners.delete(eventName);
            }
        };
    }

    private getProtocolScriptHost(): ScriptRuntimeHost {
        if (!this.protocolScriptHost) {
            this.protocolScriptHost = new ScriptRuntimeHost(ENGINE_PROTOCOL_SCRIPT);
        }
        return this.protocolScriptHost;
    }

    private publishProtocolEvent(name: string, payload: unknown, requestName?: string): void {
        const eventName = String(name || '').trim();
        if (!eventName) return;
        const exactListeners = this.protocolListeners.get(eventName);
        const wildcardListeners = this.protocolListeners.get('*');
        if (!exactListeners && !wildcardListeners) return;
        const snapshotPayload = cloneEngineProtocolPayload(payload);
        const event: EngineProtocolEvent = {
            name: eventName,
            payload: snapshotPayload,
            requestName,
            timestamp: Date.now()
        };
        if (exactListeners) {
            for (const listener of exactListeners) {
                listener(event);
            }
        }
        if (wildcardListeners) {
            for (const listener of wildcardListeners) {
                listener(event);
            }
        }
    }

    private readPageCount(): number {
        return this.getLastPrintPipelineSnapshot().pages.length;
    }

    private readProfileSnapshot(): Record<string, unknown> {
        const sessionProfile = this.getCurrentLayoutSession()?.getProfileSnapshot?.();
        if (sessionProfile && typeof sessionProfile === 'object') {
            return cloneRuntimeJsonValue(sessionProfile as Record<string, unknown>);
        }
        const reportProfile = this.getLastSimulationReport()?.profile;
        if (reportProfile && typeof reportProfile === 'object') {
            return cloneRuntimeJsonValue(reportProfile as Record<string, unknown>);
        }
        return {};
    }

    getProfileSnapshot(): Record<string, unknown> {
        return this.readProfileSnapshot();
    }

    private readSimulationStatus(): Record<string, unknown> {
        const snapshot = this.getLastPrintPipelineSnapshot();
        const report = this.getLastSimulationReport();
        const session = this.getCurrentLayoutSession();
        const stopReason = report?.progression?.stopReason
            ?? session?.getSimulationStopReason?.()
            ?? 'unknown';
        return {
            pageCount: snapshot.pages.length,
            stopReason,
            settled: stopReason === 'settled'
        };
    }

    getSimulationStatus(): Record<string, unknown> {
        return this.readSimulationStatus();
    }

    getPageViewport(pageIndex: number): ViewportHandle {
        return this.readPageViewport(pageIndex);
    }

    private readPageViewport(pageIndex: number): ViewportHandle {
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
        return this.readPageViewport(0);
    }

    getWorldViewport(request: WorldViewportRequest): ViewportHandle {
        return this.readWorldViewport(request);
    }

    private readWorldViewport(request: WorldViewportRequest): ViewportHandle {
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
        this.activeInitialLayout = null;
        this.activeRuntimeReplay = null;
        return super.simulate(elements, options);
    }

    startInitialLayout(
        elements: Parameters<LayoutProcessor['simulate']>[0],
        options: InitialLayoutContinuationOptions = {}
    ): InitialLayoutResult {
        return this.startInitialLayoutDirect(elements, options);
    }

    private startInitialLayoutDirect(
        elements: Parameters<LayoutProcessor['simulate']>[0],
        options: InitialLayoutContinuationOptions = {}
    ): InitialLayoutResult {
        const runner = super.createSimulationRunner(elements);
        this.activeInitialLayout = {
            runner,
            publishedPageCount: 0
        };
        return this.advanceInitialLayout('initial-layout', options);
    }

    continueInitialLayout(options: InitialLayoutContinuationOptions = {}): InitialLayoutResult {
        return this.continueInitialLayoutDirect(options);
    }

    private continueInitialLayoutDirect(options: InitialLayoutContinuationOptions = {}): InitialLayoutResult {
        if (!this.activeInitialLayout) {
            return {
                changed: false,
                reason: 'no-pending-initial-layout'
            };
        }
        return this.advanceInitialLayout('initial-layout-continuation', options);
    }

    private advanceInitialLayout(
        source: 'initial-layout' | 'initial-layout-continuation',
        options: InitialLayoutContinuationOptions
    ): InitialLayoutResult {
        const active = this.activeInitialLayout;
        if (!active) {
            return {
                changed: false,
                reason: 'no-pending-initial-layout'
            };
        }
        const previousPageCount = active.publishedPageCount;
        const progress = active.runner.continueUntil(options);
        const pages = active.runner.getCurrentPages();
        this.getCurrentLayoutSession()?.publishPartialLayoutPages(pages);
        const pageCount = pages.length;
        const pageIndexes = this.resolveInitialLayoutPageIndexes(previousPageCount, pageCount, active.runner.isFinished());
        active.publishedPageCount = pageCount;
        if (active.runner.isFinished()) {
            this.activeInitialLayout = null;
        }
        return {
            changed: pageIndexes.length > 0 || active.runner.isFinished(),
            kind: 'geometry',
            layoutKind: 'initial',
            completion: active.runner.isFinished() ? 'complete' : 'partial',
            pending: !active.runner.isFinished(),
            progress,
            update: {
                kind: 'geometry',
                source,
                pageIndexes
            },
            pageIndexes,
            pages
        };
    }

    private resolveInitialLayoutPageIndexes(
        previousPageCount: number,
        pageCount: number,
        finished: boolean
    ): number[] {
        const start = Math.max(0, Math.min(previousPageCount, pageCount));
        const end = Math.max(pageCount, finished ? previousPageCount : pageCount);
        return Array.from(
            { length: Math.max(0, end - start) },
            (_entry, index) => start + index
        );
    }

    private startReplayAroundViewportDirect(request: Record<string, unknown>): RuntimeIntentResult {
        const elements = Array.isArray(request.elements)
            ? request.elements as Parameters<LayoutProcessor['simulate']>[0]
            : [];
        const intent = request.intent && typeof request.intent === 'object'
            ? request.intent as RuntimeIntent
            : {};
        const replayUntil = normalizeRuntimeReplayRequestOptions(request);
        const result = this.applyRuntimeIntentDirect(elements, {
            ...intent,
            replayUntil
        });
        const replaySession = result.replaySession;
        if (!replaySession) {
            this.activeRuntimeReplay = null;
            return serializeRuntimeReplayResult(result, null);
        }
        const replayId = `runtime-replay:${++this.runtimeReplaySequence}`;
        this.activeRuntimeReplay = {
            id: replayId,
            session: replaySession,
            source: String(result.update?.source || result.kind || 'runtime-replay')
        };
        if (replaySession.isFinished()) {
            this.activeRuntimeReplay = null;
        }
        return serializeRuntimeReplayResult(result, replayId);
    }

    private continueReplayDirect(request: Record<string, unknown>): RuntimeIntentResult {
        const active = this.activeRuntimeReplay;
        if (!active) {
            return {
                changed: false,
                reason: 'no-pending-replay'
            };
        }
        const requestedId = String(request.replayId || request.id || '').trim();
        if (requestedId && requestedId !== active.id) {
            return {
                changed: false,
                reason: 'unknown-replay',
                replay: {
                    replayId: requestedId,
                    activeReplayId: active.id
                }
            };
        }
        const replayUntil = normalizeRuntimeReplayRequestOptions(request);
        const result = active.session.continueUntil(replayUntil);
        if (active.session.isFinished()) {
            this.activeRuntimeReplay = null;
        }
        return serializeRuntimeReplayResult(result, active.id);
    }

    startReplayAroundViewport(request: Record<string, unknown> = {}): RuntimeIntentResult {
        const response = this.sendProtocolRequest('layout.startReplayAroundViewport', request);
        if (response && typeof response === 'object' && typeof (response as RuntimeIntentResult).changed === 'boolean') {
            return response as RuntimeIntentResult;
        }
        return this.startReplayAroundViewportDirect(request);
    }

    continueReplay(request: Record<string, unknown> = {}): RuntimeIntentResult {
        const response = this.sendProtocolRequest('layout.continueReplay', request);
        if (response && typeof response === 'object' && typeof (response as RuntimeIntentResult).changed === 'boolean') {
            return response as RuntimeIntentResult;
        }
        return this.continueReplayDirect(request);
    }

    applyRuntimeIntent(
        elements: Parameters<LayoutProcessor['simulate']>[0],
        intent: RuntimeIntent = {}
    ): RuntimeIntentResult {
        const response = this.sendProtocolRequest('layout.applyRuntimeIntent', { elements, intent });
        if (response && typeof response === 'object' && typeof (response as RuntimeIntentResult).changed === 'boolean') {
            return response as RuntimeIntentResult;
        }
        return this.applyRuntimeIntentDirect(elements, intent);
    }

    private applyRuntimeIntentDirect(
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
        const response = this.sendProtocolRequest('layout.applyRuntimeFormatting', {
            elements,
            intent: {
                ...intent,
                kind: 'formatting'
            }
        });
        if (response && typeof response === 'object' && typeof (response as RuntimeIntentResult).changed === 'boolean') {
            return response as RuntimeIntentResult;
        }
        return this.applyRuntimeFormattingIntentInternal(elements, {
            ...intent,
            kind: 'formatting'
        });
    }

    applyRuntimeFormattingRestoreIntent(
        elements: Parameters<LayoutProcessor['simulate']>[0],
        intent: RuntimeIntent = {}
    ): RuntimeIntentResult {
        const response = this.sendProtocolRequest('layout.restoreRuntimeFormatting', {
            elements,
            intent: {
                ...intent,
                kind: 'formatting-restore'
            }
        });
        if (response && typeof response === 'object' && typeof (response as RuntimeIntentResult).changed === 'boolean') {
            return response as RuntimeIntentResult;
        }
        return this.applyRuntimeFormattingRestoreIntentInternal(elements, {
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
        source = 'runtime-formatting',
        replayUntil?: RuntimeReplayUntilOptions | null
    ): RuntimeIntentResult {
        const previousPages = this.getLastPrintPipelineSnapshot().pages as any[];
        const previousTokens = buildRuntimePageTokenMap(previousPages);
        const replayFrontier = normalizeRuntimeReplayFrontier(affectedFrontier);
        const untilOptions = normalizeRuntimeReplayUntilOptions(replayUntil);
        const buildResult = (
            pages: unknown[],
            completion: 'complete' | 'partial',
            extras: Partial<RuntimeIntentResult> = {}
        ): RuntimeIntentResult => {
            const { replay: extraReplay, ...extraRest } = extras;
            const pageChanges = computeRuntimeReplayPageChanges(previousTokens, pages as any[], {
                partial: completion === 'partial'
            });
            return {
                changed: true,
                kind: 'geometry',
                frontier: affectedFrontier,
                replay: {
                    replayKind: source,
                    completion,
                    ...(extraReplay && typeof extraReplay === 'object' ? extraReplay as object : {})
                },
                update: {
                    kind: 'geometry',
                    source,
                    actorIds: [],
                    sourceIds: [],
                    pageIndexes: pageChanges.pageIndexes,
                    addedPageIndexes: pageChanges.addedPageIndexes,
                    removedPageIndexes: pageChanges.removedPageIndexes,
                    replayFrontier
                },
                pageIndexes: pageChanges.pageIndexes,
                pages,
                ...extraRest
            };
        };

        if (untilOptions) {
            const runner = super.createSimulationRunner(elements);
            const firstContinue = runner.continueUntil(untilOptions);
            const pages = runner.getCurrentPages();
            const replaySession: RuntimeReplayContinuation = {
                continueUntil: (nextUntil?: RuntimeReplayUntilOptions | null) => {
                    const normalized = normalizeRuntimeReplayUntilOptions(nextUntil);
                    const advance = runner.continueUntil(normalized ?? undefined);
                    return buildResult(
                        runner.getCurrentPages(),
                        runner.isFinished() ? 'complete' : 'partial',
                        {
                            replay: {
                                continueUntil: {
                                    ...advance,
                                    requested: normalized ?? null
                                }
                            },
                            replaySession
                        }
                    );
                },
                continueUntilPage: (pageIndex: number) => replaySession.continueUntil({ page: pageIndex }),
                continueUntilY: (y: number) => replaySession.continueUntil({ y }),
                getCurrentPages: () => runner.getCurrentPages(),
                isFinished: () => runner.isFinished()
            };
            return buildResult(pages, runner.isFinished() ? 'complete' : 'partial', {
                replay: {
                    continueUntil: {
                        ...firstContinue,
                        requested: untilOptions
                    }
                },
                replaySession
            });
        }

        const pages = super.simulate(elements);
        return {
            ...buildResult(pages, 'complete')
        };
    }

    private applySourceBackedRuntimeFormattingIntent(
        _elements: Parameters<LayoutProcessor['simulate']>[0],
        intent: RuntimeIntent,
        target: ReturnType<LayoutEngine['resolveRuntimeFormattingTarget']>,
        formatting: Record<string, unknown>
    ): RuntimeIntentResult | null {
        if (!target.sourceId || isRuntimeRangeTarget(target)) return null;
        const sourcePath = findRuntimeElementPathBySourceId(_elements as Element[], target.sourceId);
        if (!sourcePath) return null;
        const sourceElement = sourcePath.element;
        const previousSnapshot = cloneRuntimeElementSourceSnapshot(sourceElement);
        const previousStyle = sourceElement.properties && typeof sourceElement.properties.style === 'object' && sourceElement.properties.style
            ? { ...sourceElement.properties.style }
            : {};
        const changed = Object.entries(formatting).some(([key, value]) => previousStyle[key] !== value);
        if (!changed) {
            return {
                changed: false,
                reason: 'already-current',
                sourceId: target.sourceId,
                actorId: target.actorId
            };
        }
        const normalizedSourceId = LayoutUtils.normalizeAuthorSourceId(target.sourceId) || target.sourceId;
        const previousPages = this.getLastPrintPipelineSnapshot().pages as any[];
        const affectedFrontier = resolveRuntimeSourceFrontierFromPages(previousPages, target.sourceId);
        sourceElement.properties = {
            ...(sourceElement.properties || {}),
            style: {
                ...previousStyle,
                ...formatting
            }
        };
        for (const element of [...sourcePath.ancestors, sourceElement]) {
            clearRuntimeMaterializationState(element);
        }
        const history = this.buildRuntimeFormattingHistoryEntry({
            target: {
                ...(intent.target || {}),
                sourceId: target.sourceId,
                actorId: target.actorId
            },
            patch: formatting,
            before: previousSnapshot,
            after: cloneRuntimeElementSourceSnapshot(sourceElement),
            frontier: affectedFrontier
        });
        try {
            const replay = this.applyRuntimeGeometryReplay(_elements, affectedFrontier, 'runtime-formatting', resolveRuntimeReplayUntilIntent(intent));
            return {
                ...replay,
                sourceId: normalizedSourceId,
                actorId: target.actorId,
                history,
                update: {
                    ...(replay.update || { kind: 'geometry', source: 'runtime-formatting', actorIds: [], sourceIds: [], pageIndexes: [] }),
                    actorIds: target.actorId ? [target.actorId] : [],
                    sourceIds: [normalizedSourceId]
                }
            };
        } catch (error) {
            restoreRuntimeElementSourceSnapshot(sourceElement, previousSnapshot);
            throw error;
        }
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
            const replay = this.applyRuntimeGeometryReplay(_elements, affectedFrontier, 'runtime-formatting-restore', resolveRuntimeReplayUntilIntent(intent));
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
            if (isContentOnlyGeometryMismatch(error)) {
                const replayActors = collectRuntimeFormattingActors(runtimeSession.getRegisteredActors?.() ?? []);
                refreshRuntimeActorHostChain(replayActors, actor);
                const replay = this.applyRuntimeGeometryReplay(_elements, affectedFrontier, 'runtime-formatting-restore', resolveRuntimeReplayUntilIntent(intent));
                return {
                    ...replay,
                    sourceId: actor.sourceId,
                    actorId: actor.actorId,
                    history,
                    update: {
                        ...(replay.update || { kind: 'geometry', source: 'runtime-formatting-restore', actorIds: [], sourceIds: [], pageIndexes: [] }),
                        actorIds: [actor.actorId].filter((id): id is string => !!id),
                        sourceIds: [actor.sourceId].filter((id): id is string => !!id)
                    }
                };
            }
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
            const sourceBackedResult = this.applySourceBackedRuntimeFormattingIntent(_elements, intent, target, formatting);
            if (sourceBackedResult) return sourceBackedResult;
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
            const replay = this.applyRuntimeGeometryReplay(_elements, affectedFrontier, 'runtime-formatting', resolveRuntimeReplayUntilIntent(intent));
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
            if (isContentOnlyGeometryMismatch(error)) {
                const replayActors = collectRuntimeFormattingActors(runtimeSession.getRegisteredActors?.() ?? []);
                refreshRuntimeActorHostChain(replayActors, actor);
                const replay = this.applyRuntimeGeometryReplay(_elements, affectedFrontier, 'runtime-formatting', resolveRuntimeReplayUntilIntent(intent));
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
