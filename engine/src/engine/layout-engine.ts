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
};

type RuntimeFormattingPatch = {
    textAlign?: unknown;
};

type RuntimeFormattingTarget = {
    sourceId?: unknown;
    containerKey?: unknown;
    boxTargetId?: unknown;
    actorId?: unknown;
};

type RuntimeActor = {
    actorId?: string;
    sourceId?: string;
    flowBox?: { _sourceElement?: Element };
    element?: Element;
    rebuildLiveFlowBox?(): boolean;
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

/**
 * LayoutEngine shapes elements into flow boxes, paginates them, and returns
 * positioned page boxes for rendering.
 */
export class LayoutEngine extends LayoutProcessor {
    private lastResolvedConfig: LayoutConfig;

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

    private normalizeRuntimeFormattingPatch(patch: RuntimeFormattingPatch = {}): Record<string, unknown> {
        const out: Record<string, unknown> = {};
        if (['left', 'center', 'right', 'justify'].includes(String(patch.textAlign))) {
            out.textAlign = String(patch.textAlign);
            if (patch.textAlign === 'justify') {
                out.justifyEngine = 'advanced';
            }
        }
        return out;
    }

    private resolveRuntimeFormattingTarget(target: RuntimeFormattingTarget = {}): { sourceId: string; actorId: string } {
        const sourceId = String(target.sourceId || target.containerKey || target.boxTargetId || '').trim();
        const actorId = String(target.actorId || '').trim();
        return { sourceId, actorId };
    }

    private resolveRuntimeFormattingActor(session: unknown, target: RuntimeFormattingTarget = {}): RuntimeActor | null {
        const candidate = session as { getRegisteredActors?(): readonly RuntimeActor[] } | null;
        if (typeof candidate?.getRegisteredActors !== 'function') return null;
        const { sourceId, actorId } = this.resolveRuntimeFormattingTarget(target);
        const normalized = LayoutUtils.normalizeAuthorSourceId(sourceId) || sourceId;
        const actors = candidate.getRegisteredActors();
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
            publishActorSignal: () => undefined,
            readActorSignals: () => []
        };
    }

    private applyRuntimeFormattingIntentInternal(
        _elements: Parameters<LayoutProcessor['simulate']>[0],
        intent: RuntimeIntent = {}
    ): RuntimeIntentResult {
        const session = this.getCurrentLayoutSession();
        const formatting = this.normalizeRuntimeFormattingPatch(intent.patch || {});
        if (!Object.keys(formatting).length) {
            return {
                changed: false,
                reason: 'unsupported-formatting'
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
        const previousStyle = element.properties && typeof element.properties.style === 'object' && element.properties.style
            ? { ...element.properties.style }
            : {};
        const changed = Object.entries(formatting).some(([key, value]) => previousStyle[key] !== value);
        if (!changed) {
            return {
                changed: false,
                reason: 'already-current',
                sourceId: target.sourceId || actor.sourceId,
                actorId: actor.actorId
            };
        }
        const nextStyle = { ...previousStyle, ...formatting };
        const previousProperties = element.properties;
        element.properties = { ...element.properties, style: nextStyle };
        if (typeof actor.rebuildLiveFlowBox !== 'function' || !actor.rebuildLiveFlowBox()) {
            element.properties = previousProperties;
            return {
                changed: false,
                reason: 'actor-cannot-rebuild',
                sourceId: actor.sourceId,
                actorId: actor.actorId
            };
        }
        const runtimeSession = session as {
            resolveActorRuntimeFrontier?(actor: RuntimeActor, options: { actorId?: string; sourceId?: string }): { pageIndex?: unknown } | null;
            invalidateSafeCheckpointsAfterFrontier?(frontier: unknown): void;
            getRegisteredActors?(): readonly RuntimeActor[];
            applyContentOnlyActorUpdates?(
                pages: readonly unknown[],
                currentPageBoxes: unknown[],
                actors: readonly RuntimeActor[],
                contextBase: Record<string, unknown>
            ): { patchedActors: number; pageIndexes: number[] };
        };
        const frontier = runtimeSession.resolveActorRuntimeFrontier?.(actor, {
            actorId: actor.actorId,
            sourceId: actor.sourceId
        }) ?? null;
        if (frontier) {
            runtimeSession.invalidateSafeCheckpointsAfterFrontier?.(frontier);
        }
        const frontierPageIndex = Number((frontier as { pageIndex?: unknown } | null)?.pageIndex);
        const pageIndex = Number.isFinite(frontierPageIndex)
            ? Math.max(0, Math.floor(frontierPageIndex))
            : 0;
        const pages = this.getLastPrintPipelineSnapshot().pages;
        const contextBase = this.buildRuntimeFormattingContext(session, pageIndex);
        const actors = runtimeSession.getRegisteredActors?.() ?? [];
        const redrawActor = (candidate: RuntimeActor): { patchedActors: number; pageIndexes: number[] } =>
            runtimeSession.applyContentOnlyActorUpdates?.(pages, [], [candidate], contextBase) ?? { patchedActors: 0, pageIndexes: [] };
        try {
            let visibleActor = actor;
            let redraw = redrawActor(visibleActor);
            if (Number(redraw?.patchedActors || 0) === 0) {
                const host = findRuntimeHostActor(actors, actor);
                if (host?.refreshHostedRuntimeActor?.(actor)) {
                    visibleActor = host;
                    redraw = redrawActor(visibleActor);
                }
            }
            if (Number(redraw?.patchedActors || 0) === 0) {
                element.properties = previousProperties;
                actor.rebuildLiveFlowBox();
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
                frontier,
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
            element.properties = previousProperties;
            actor.rebuildLiveFlowBox();
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
