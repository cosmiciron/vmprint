import type { Box, Element } from '../../src/engine/types';
import type { LayoutProcessor } from '../../src/engine/layout/layout-core';
import type { FlowBox } from '../../src/engine/layout/layout-core-types';
import type { PackagerIdentity } from '../../src/engine/layout/packagers/packager-identity';
import { FlowBoxPackager } from '../../src/engine/layout/packagers/flow-box-packager';
import type {
    ObservationResult,
    PackagerContext,
    PackagerPlacementPreference,
    PackagerSplitResult,
    PackagerTransformProfile,
    PackagerUnit
} from '../../src/engine/layout/packagers/packager-types';

type SignalPublishSpec = {
    topic: string;
    signalKey?: string;
    payload?: Record<string, unknown>;
};

type SignalObserveSpec = {
    topic: string;
    title?: string;
    renderMode?: 'summary' | 'collector-list';
    publishTopic?: string;
    publishSignalKey?: string;
    backgroundColor?: string;
    borderColor?: string;
    color?: string;
    emptyLabel?: string;
    baseHeight?: number;
    growthPerSignal?: number;
    oscillateHeights?: number[];
};

type SignalFollowSpec = {
    topic: string;
    title?: string;
    backgroundColor?: string;
    borderColor?: string;
    color?: string;
    emptyLabel?: string;
    baseHeight?: number;
    indentPerSignal?: number;
};

type ReplayMarkerSpec = {
    title?: string;
    backgroundColor?: string;
    borderColor?: string;
    color?: string;
    height?: number;
};

type ClockCookingSpec = {
    title?: string;
    backgroundColor?: string;
    borderColor?: string;
    color?: string;
    emptyLabel?: string;
    baseHeight?: number;
    growthPerStage?: number;
    maxStages?: number;
    sceneMode?: 'ascii-diorama';
    sceneWidth?: number;
    sceneHeight?: number;
    fontFamily?: string;
    pathStages?: number;
};

type CookingStageVisual = {
    backgroundColor: string;
    borderColor: string;
    color: string;
    fontSize: number;
    borderWidth: number;
};

export class TestSignalPublisherPackager implements PackagerUnit {
    private readonly base: FlowBoxPackager;
    private readonly flowBox: FlowBox;
    readonly actorId: string;
    readonly sourceId: string;
    readonly actorKind: string;
    readonly fragmentIndex: number;
    readonly continuationOf?: string;

    get pageBreakBefore(): boolean | undefined { return this.base.pageBreakBefore; }
    get keepWithNext(): boolean | undefined { return this.base.keepWithNext; }

    constructor(
        private readonly processor: LayoutProcessor,
        flowBox: FlowBox,
        private readonly identity: PackagerIdentity
    ) {
        this.flowBox = flowBox;
        this.base = new FlowBoxPackager(processor, flowBox, identity);
        this.actorId = this.base.actorId;
        this.sourceId = this.base.sourceId;
        this.actorKind = this.base.actorKind;
        this.fragmentIndex = this.base.fragmentIndex;
        this.continuationOf = this.base.continuationOf;
    }

    prepare(availableWidth: number, availableHeight: number, context: PackagerContext): void {
        this.base.prepare(availableWidth, availableHeight, context);
    }

    getPlacementPreference(fullAvailableWidth: number, context: PackagerContext): PackagerPlacementPreference | null {
        return this.base.getPlacementPreference?.(fullAvailableWidth, context) ?? null;
    }

    getTransformProfile(): PackagerTransformProfile {
        return {
            capabilities: [
                {
                    kind: 'split',
                    preservesIdentity: true,
                    producesContinuation: true
                }
            ]
        };
    }

    emitBoxes(availableWidth: number, availableHeight: number, context: PackagerContext): Box[] {
        const spec = (this.flowBox.properties?._actorSignalPublish || {}) as SignalPublishSpec;
        if (spec.topic) {
            context.publishActorSignal({
                topic: spec.topic,
                signalKey: spec.signalKey || `publisher:${this.actorId}:${this.fragmentIndex}:${spec.topic}`,
                publisherActorId: this.actorId,
                publisherSourceId: this.sourceId,
                publisherActorKind: this.actorKind,
                fragmentIndex: this.fragmentIndex,
                pageIndex: context.pageIndex,
                payload: {
                    ...(spec.payload || {}),
                    fragmentIndex: this.fragmentIndex
                }
            });
        }
        return this.base.emitBoxes(availableWidth, availableHeight, context);
    }

    split(availableHeight: number, context: PackagerContext): PackagerSplitResult {
        return this.base.split(availableHeight, context);
    }

    getRequiredHeight(): number { return this.base.getRequiredHeight(); }
    isUnbreakable(availableHeight: number): boolean { return this.base.isUnbreakable(availableHeight); }
    getMarginTop(): number { return this.base.getMarginTop(); }
    getMarginBottom(): number { return this.base.getMarginBottom(); }
}

export class TestSignalObserverPackager implements PackagerUnit {
    private base: FlowBoxPackager | null = null;
    private renderedFlowBox: FlowBox | null = null;
    private observationSignature: string | null = null;
    private geometrySignature: string | null = null;
    private firstCommittedPageIndex: number | null = null;
    private firstCommittedActorIndex: number | null = null;
    private currentResolvedHeightOverride: number | null = null;
    private oscillationStep = 0;

    readonly actorId: string;
    readonly sourceId: string;
    readonly actorKind: string;
    readonly fragmentIndex: number;
    readonly continuationOf?: string;

    constructor(
        private readonly processor: LayoutProcessor,
        private readonly flowBox: FlowBox,
        private readonly identity: PackagerIdentity
    ) {
        this.actorId = identity.actorId;
        this.sourceId = identity.sourceId;
        this.actorKind = identity.actorKind;
        this.fragmentIndex = identity.fragmentIndex;
        this.continuationOf = identity.continuationOf;
    }

    get pageBreakBefore(): boolean | undefined { return this.renderedFlowBox?.pageBreakBefore ?? this.flowBox.pageBreakBefore; }
    get keepWithNext(): boolean | undefined { return this.renderedFlowBox?.keepWithNext ?? this.flowBox.keepWithNext; }

    prepare(availableWidth: number, availableHeight: number, context: PackagerContext): void {
        this.base = this.createDynamicPackager(context);
        this.base.prepare(availableWidth, availableHeight, context);
    }

    getPlacementPreference(fullAvailableWidth: number, context: PackagerContext): PackagerPlacementPreference | null {
        const packager = this.base ?? this.createDynamicPackager(context);
        return packager.getPlacementPreference?.(fullAvailableWidth, context) ?? null;
    }

    getTransformProfile(): PackagerTransformProfile {
        return {
            capabilities: [
                {
                    kind: 'split',
                    preservesIdentity: true,
                    producesContinuation: true
                }
            ]
        };
    }

    emitBoxes(availableWidth: number, availableHeight: number, context: PackagerContext): Box[] {
        const packager = this.base ?? this.createDynamicPackager(context);
        const observedSignals = this.readSignals(context);
        const observedCount = observedSignals.length;
        const observedHeight = this.renderedFlowBox?.properties?.style?.height;
        if (this.firstCommittedPageIndex === null) {
            this.firstCommittedPageIndex = context.pageIndex;
        }
        if (this.firstCommittedActorIndex === null) {
            this.firstCommittedActorIndex =
                typeof context.actorIndex === 'number'
                    ? context.actorIndex
                    : null;
        }
        this.publishSummarySignal(context, observedSignals);
        const boxes = packager.emitBoxes(availableWidth, availableHeight, context);
        return boxes.map((box) => ({
            ...box,
            properties: {
                ...(box.properties || {}),
                _observedSignalCount: observedCount,
                _observedSignalHeight: observedHeight
            }
        }));
    }

    split(availableHeight: number, context: PackagerContext): PackagerSplitResult {
        const packager = this.base ?? this.createDynamicPackager(context);
        return packager.split(availableHeight, context);
    }

    getRequiredHeight(): number { return this.base?.getRequiredHeight() ?? 0; }
    isUnbreakable(availableHeight: number): boolean { return this.base?.isUnbreakable(availableHeight) ?? false; }
    getMarginTop(): number { return this.base?.getMarginTop() ?? this.flowBox.marginTop; }
    getMarginBottom(): number { return this.base?.getMarginBottom() ?? this.flowBox.marginBottom; }

    getCommittedSignalSubscriptions(): readonly string[] {
        const spec = (this.flowBox.properties?._actorSignalObserve || {}) as SignalObserveSpec;
        return spec.topic ? [spec.topic] : [];
    }

    updateCommittedState(context: PackagerContext): ObservationResult {
        return this.observeCommittedSignals(context);
    }

    observeCommittedSignals(context: PackagerContext): ObservationResult {
        if (this.firstCommittedPageIndex === null) {
            return { changed: false, geometryChanged: false, updateKind: 'none' };
        }
        const spec = (this.flowBox.properties?._actorSignalObserve || {}) as SignalObserveSpec;
        const observed = this.readSignals(context);
        const labels = observed
            .map((signal) => signal.payload?.label)
            .filter((label): label is string => typeof label === 'string' && label.trim().length > 0);
        const uniquePages = Array.from(new Set(observed.map((signal) => signal.pageIndex))).sort((a, b) => a - b);
        const baseTitle = spec.title || 'Observed Signals';
        const title = this.fragmentIndex > 0 || this.continuationOf
            ? `${baseTitle} (continued)`
            : baseTitle;
        const baseHeight = Math.max(0, Number(spec.baseHeight) || 0);
        const growthPerSignal = Math.max(0, Number(spec.growthPerSignal) || 0);
        const resolvedHeight = this.resolveNextObservedHeight(spec, observed.length, baseHeight, growthPerSignal);
        const content = this.buildObservedContent(spec, title, observed.length, uniquePages, labels);
        const nextObservationSignature = JSON.stringify({
            topic: spec.topic || 'probe',
            content
        });
        const nextGeometrySignature = JSON.stringify({
            height: resolvedHeight
        });

        const geometryChanged = this.geometrySignature !== nextGeometrySignature;
        const changed = this.observationSignature !== nextObservationSignature || geometryChanged;

        this.observationSignature = nextObservationSignature;
        this.geometrySignature = nextGeometrySignature;
        this.currentResolvedHeightOverride = resolvedHeight;
        if (observed.length > 0 && Array.isArray(spec.oscillateHeights) && spec.oscillateHeights.length > 0) {
            this.oscillationStep += 1;
        }

        return {
            changed,
            geometryChanged,
            updateKind: geometryChanged ? 'geometry' : (changed ? 'content-only' : 'none'),
            earliestAffectedFrontier: geometryChanged
                ? {
                    pageIndex: this.firstCommittedPageIndex ?? 0,
                    actorIndex: this.firstCommittedActorIndex ?? undefined,
                    actorId: this.actorId,
                    sourceId: this.sourceId
                }
                : undefined
        };
    }

    private readSignals(context: PackagerContext) {
        const spec = (this.flowBox.properties?._actorSignalObserve || {}) as SignalObserveSpec;
        return context.readActorSignals(spec.topic || 'probe');
    }

    private createDynamicPackager(context: PackagerContext): FlowBoxPackager {
        const spec = (this.flowBox.properties?._actorSignalObserve || {}) as SignalObserveSpec;
        const observed = this.readSignals(context);
        const uniquePages = Array.from(new Set(observed.map((signal) => signal.pageIndex))).sort((a, b) => a - b);
        const labels = observed
            .map((signal) => signal.payload?.label)
            .filter((label): label is string => typeof label === 'string' && label.trim().length > 0);
        const baseTitle = spec.title || 'Observed Signals';
        const title = this.fragmentIndex > 0 || this.continuationOf
            ? `${baseTitle} (continued)`
            : baseTitle;
        const baseHeight = Math.max(0, Number(spec.baseHeight) || 0);
        const growthPerSignal = Math.max(0, Number(spec.growthPerSignal) || 0);
        const resolvedHeight = this.currentResolvedHeightOverride ?? (baseHeight + observed.length * growthPerSignal);
        const content = this.buildObservedContent(spec, title, observed.length, uniquePages, labels);
        this.observationSignature = JSON.stringify({
            topic: spec.topic || 'probe',
            content
        });
        this.geometrySignature = JSON.stringify({
            height: resolvedHeight
        });

        const sourceElement = (this.flowBox._sourceElement || this.flowBox._unresolvedElement || {
            type: this.flowBox.type,
            content: ''
        }) as Element;

        const syntheticElement: Element = {
            ...sourceElement,
            content,
            children: undefined,
            properties: {
                ...(sourceElement.properties || {}),
                sourceId: this.sourceId,
                style: {
                    ...((sourceElement.properties?.style as Record<string, unknown>) || {}),
                    backgroundColor: spec.backgroundColor || '#fde68a',
                    borderColor: spec.borderColor || '#b45309',
                    borderWidth: 2,
                    paddingTop: 12,
                    paddingRight: 12,
                    paddingBottom: 12,
                    paddingLeft: 12,
                    color: spec.color || '#111827',
                    fontSize: 12,
                    lineHeight: 1.25,
                    fontWeight: this.fragmentIndex > 0 || this.continuationOf ? 600 : undefined,
                    ...(resolvedHeight > 0 ? { height: resolvedHeight } : {})
                }
            }
        };

        this.renderedFlowBox = (this.processor as any).shapeElement(syntheticElement, {
            sourceId: this.sourceId,
            sourceType: syntheticElement.type,
            fragmentIndex: this.fragmentIndex,
            isContinuation: !!this.continuationOf
        });
        this.base = new FlowBoxPackager(this.processor, this.renderedFlowBox, this.identity);
        return this.base;
    }

    private buildObservedContent(
        spec: SignalObserveSpec,
        title: string,
        observedCount: number,
        uniquePages: number[],
        labels: string[]
    ): string {
        if (observedCount === 0) {
            return `${title}\n${spec.emptyLabel || 'No signals observed.'}`;
        }

        if (spec.renderMode === 'collector-list') {
            const entries = labels.map((label, index) => `${index + 1}. ${label}`);
            return `${title}\n${entries.join('\n')}`;
        }

        return `${title}\nCount: ${observedCount}\nPages: ${uniquePages.map((page) => page + 1).join(', ')}${labels.length > 0 ? `\nLabels: ${labels.join(' | ')}` : ''}`;
    }

    private resolveNextObservedHeight(
        spec: SignalObserveSpec,
        observedCount: number,
        baseHeight: number,
        growthPerSignal: number
    ): number {
        const oscillateHeights = Array.isArray(spec.oscillateHeights)
            ? spec.oscillateHeights
                .map((height) => Math.max(0, Number(height) || 0))
                .filter((height) => Number.isFinite(height))
            : [];
        if (observedCount > 0 && oscillateHeights.length > 0) {
            return oscillateHeights[this.oscillationStep % oscillateHeights.length];
        }

        return baseHeight + observedCount * growthPerSignal;
    }

    private publishSummarySignal(context: PackagerContext, observed: readonly ReturnType<PackagerContext['readActorSignals']>[number][]): void {
        const spec = (this.flowBox.properties?._actorSignalObserve || {}) as SignalObserveSpec;
        if (!spec.publishTopic) return;
        const labels = observed
            .map((signal) => signal.payload?.label)
            .filter((label): label is string => typeof label === 'string' && label.trim().length > 0);
        const pages = Array.from(new Set(observed.map((signal) => signal.pageIndex))).sort((a, b) => a - b);
        context.publishActorSignal({
            topic: spec.publishTopic,
            signalKey: spec.publishSignalKey || `observer-summary:${this.actorId}:${spec.publishTopic}`,
            publisherActorId: this.actorId,
            publisherSourceId: this.sourceId,
            publisherActorKind: this.actorKind,
            fragmentIndex: this.fragmentIndex,
            pageIndex: context.pageIndex,
            payload: {
                count: observed.length,
                labels,
                pages
            }
        });
    }
}

export class TestSignalFollowerPackager implements PackagerUnit {
    private base: FlowBoxPackager | null = null;
    private renderedFlowBox: FlowBox | null = null;

    readonly actorId: string;
    readonly sourceId: string;
    readonly actorKind: string;
    readonly fragmentIndex: number;
    readonly continuationOf?: string;

    constructor(
        private readonly processor: LayoutProcessor,
        private readonly flowBox: FlowBox,
        private readonly identity: PackagerIdentity
    ) {
        this.actorId = identity.actorId;
        this.sourceId = identity.sourceId;
        this.actorKind = identity.actorKind;
        this.fragmentIndex = identity.fragmentIndex;
        this.continuationOf = identity.continuationOf;
    }

    get pageBreakBefore(): boolean | undefined { return this.renderedFlowBox?.pageBreakBefore ?? this.flowBox.pageBreakBefore; }
    get keepWithNext(): boolean | undefined { return this.renderedFlowBox?.keepWithNext ?? this.flowBox.keepWithNext; }

    prepare(availableWidth: number, availableHeight: number, context: PackagerContext): void {
        this.base = this.createDynamicPackager(context);
        this.base.prepare(availableWidth, availableHeight, context);
    }

    getPlacementPreference(fullAvailableWidth: number, context: PackagerContext): PackagerPlacementPreference | null {
        const packager = this.base ?? this.createDynamicPackager(context);
        return packager.getPlacementPreference?.(fullAvailableWidth, context) ?? null;
    }

    getTransformProfile(): PackagerTransformProfile {
        return {
            capabilities: [
                {
                    kind: 'split',
                    preservesIdentity: true,
                    producesContinuation: true
                }
            ]
        };
    }

    emitBoxes(availableWidth: number, availableHeight: number, context: PackagerContext): Box[] {
        const packager = this.base ?? this.createDynamicPackager(context);
        return packager.emitBoxes(availableWidth, availableHeight, context);
    }

    split(availableHeight: number, context: PackagerContext): PackagerSplitResult {
        const packager = this.base ?? this.createDynamicPackager(context);
        return packager.split(availableHeight, context);
    }

    getRequiredHeight(): number { return this.base?.getRequiredHeight() ?? 0; }
    isUnbreakable(availableHeight: number): boolean { return this.base?.isUnbreakable(availableHeight) ?? false; }
    getMarginTop(): number { return this.base?.getMarginTop() ?? this.flowBox.marginTop; }
    getMarginBottom(): number { return this.base?.getMarginBottom() ?? this.flowBox.marginBottom; }

    private readSignals(context: PackagerContext) {
        const spec = (this.flowBox.properties?._actorSignalFollow || {}) as SignalFollowSpec;
        return context.readActorSignals(spec.topic || 'probe');
    }

    private createDynamicPackager(context: PackagerContext): FlowBoxPackager {
        const spec = (this.flowBox.properties?._actorSignalFollow || {}) as SignalFollowSpec;
        const observed = this.readSignals(context);
        const latest = observed[observed.length - 1];
        const count = Number(latest?.payload?.count || 0);
        const labels = Array.isArray(latest?.payload?.labels)
            ? latest.payload!.labels.filter((label): label is string => typeof label === 'string' && label.trim().length > 0)
            : [];
        const pages = Array.isArray(latest?.payload?.pages)
            ? latest.payload!.pages.filter((page): page is number => Number.isFinite(page)).map((page) => Number(page) + 1)
            : [];
        const title = spec.title || 'Observed Summary Follower';
        const indent = Math.max(0, Number(spec.indentPerSignal) || 0) * count;
        const content = latest
            ? `${title}\nObserver Count: ${count}\nObserver Pages: ${pages.join(', ')}${labels.length > 0 ? `\nLabels: ${labels.join(' | ')}` : ''}`
            : `${title}\n${spec.emptyLabel || 'No observer summary received.'}`;

        const sourceElement = (this.flowBox._sourceElement || this.flowBox._unresolvedElement || {
            type: this.flowBox.type,
            content: ''
        }) as Element;

        const syntheticElement: Element = {
            ...sourceElement,
            content,
            children: undefined,
            properties: {
                ...(sourceElement.properties || {}),
                sourceId: this.sourceId,
                style: {
                    ...((sourceElement.properties?.style as Record<string, unknown>) || {}),
                    backgroundColor: spec.backgroundColor || '#ede9fe',
                    borderColor: spec.borderColor || '#7c3aed',
                    borderWidth: 2,
                    paddingTop: 12,
                    paddingRight: 12,
                    paddingBottom: 12,
                    paddingLeft: 12,
                    color: spec.color || '#4c1d95',
                    fontSize: 12,
                    lineHeight: 1.25,
                    height: Math.max(0, Number(spec.baseHeight) || 0),
                    marginLeft: indent
                }
            }
        };

        this.renderedFlowBox = (this.processor as any).shapeElement(syntheticElement, {
            sourceId: this.sourceId,
            sourceType: syntheticElement.type,
            fragmentIndex: this.fragmentIndex,
            isContinuation: !!this.continuationOf
        });
        this.base = new FlowBoxPackager(this.processor, this.renderedFlowBox, this.identity);
        return this.base;
    }
}

export class TestClockCookingPackager implements PackagerUnit {
    private base: FlowBoxPackager | null = null;
    private renderedFlowBox: FlowBox | null = null;
    private stageHistory: Array<{ stage: number; tick: number; totalPageCount: number | null }> = [];
    private lastCommittedFinalizationTick = -1;
    private firstCommittedPageIndex: number | null = null;
    private firstCommittedActorIndex: number | null = null;

    readonly actorId: string;
    readonly sourceId: string;
    readonly actorKind: string;
    readonly fragmentIndex: number;
    readonly continuationOf?: string;

    constructor(
        private readonly processor: LayoutProcessor,
        private readonly flowBox: FlowBox,
        private readonly identity: PackagerIdentity
    ) {
        this.actorId = identity.actorId;
        this.sourceId = identity.sourceId;
        this.actorKind = identity.actorKind;
        this.fragmentIndex = identity.fragmentIndex;
        this.continuationOf = identity.continuationOf;
    }

    get pageBreakBefore(): boolean | undefined { return this.renderedFlowBox?.pageBreakBefore ?? this.flowBox.pageBreakBefore; }
    get keepWithNext(): boolean | undefined { return this.renderedFlowBox?.keepWithNext ?? this.flowBox.keepWithNext; }

    prepare(availableWidth: number, availableHeight: number, context: PackagerContext): void {
        this.base = this.createDynamicPackager(context);
        this.base.prepare(availableWidth, availableHeight, context);
    }

    getPlacementPreference(fullAvailableWidth: number, context: PackagerContext): PackagerPlacementPreference | null {
        const packager = this.base ?? this.createDynamicPackager(context);
        return packager.getPlacementPreference?.(fullAvailableWidth, context) ?? null;
    }

    getTransformProfile(): PackagerTransformProfile {
        return {
            capabilities: [
                {
                    kind: 'split',
                    preservesIdentity: true,
                    producesContinuation: true
                }
            ]
        };
    }

    emitBoxes(availableWidth: number, availableHeight: number, context: PackagerContext): Box[] {
        const packager = this.base ?? this.createDynamicPackager(context);
        if (this.firstCommittedPageIndex === null) {
            this.firstCommittedPageIndex = context.pageIndex;
        }
        if (this.firstCommittedActorIndex === null) {
            this.firstCommittedActorIndex =
                typeof context.actorIndex === 'number'
                    ? context.actorIndex
                    : null;
        }
        return packager.emitBoxes(availableWidth, availableHeight, context);
    }

    split(availableHeight: number, context: PackagerContext): PackagerSplitResult {
        const packager = this.base ?? this.createDynamicPackager(context);
        return packager.split(availableHeight, context);
    }

    getRequiredHeight(): number { return this.base?.getRequiredHeight() ?? 0; }
    isUnbreakable(availableHeight: number): boolean { return this.base?.isUnbreakable(availableHeight) ?? false; }
    getMarginTop(): number { return this.base?.getMarginTop() ?? this.flowBox.marginTop; }
    getMarginBottom(): number { return this.base?.getMarginBottom() ?? this.flowBox.marginBottom; }

    wantsSimulationTicks(context: PackagerContext): boolean {
        if (this.firstCommittedPageIndex === null) {
            return false;
        }
        const spec = (this.flowBox.properties?._clockCooking || {}) as ClockCookingSpec;
        const maxStages = Math.max(0, Number(spec.maxStages) || 0);
        return maxStages > 0 && this.stageHistory.length < maxStages;
    }

    stepSimulationTick(context: PackagerContext): ObservationResult {
        if (this.firstCommittedPageIndex === null) {
            return { changed: false, geometryChanged: false, updateKind: 'none' };
        }

        const spec = (this.flowBox.properties?._clockCooking || {}) as ClockCookingSpec;
        const maxStages = Math.max(0, Number(spec.maxStages) || 0);
        if (maxStages === 0) {
            return { changed: false, geometryChanged: false, updateKind: 'none' };
        }
        const tick = Math.max(0, Number(context.simulationTick || 0) - 1);
        if (tick === this.lastCommittedFinalizationTick) {
            return { changed: false, geometryChanged: false, updateKind: 'none' };
        }
        if (this.stageHistory.length >= maxStages) {
            return { changed: false, geometryChanged: false, updateKind: 'none' };
        }
        this.lastCommittedFinalizationTick = tick;
        const latest = context.readActorSignals('pagination:finalized').at(-1);

        this.stageHistory.push({
            stage: this.stageHistory.length + 1,
            tick,
            totalPageCount: Number.isFinite(latest?.payload?.totalPageCount)
                ? Math.max(0, Math.floor(Number(latest?.payload?.totalPageCount)))
                : null
        });

        return {
            changed: true,
            geometryChanged: true,
            updateKind: 'geometry',
            earliestAffectedFrontier: {
                pageIndex: this.firstCommittedPageIndex ?? 0,
                actorIndex: this.firstCommittedActorIndex ?? undefined,
                actorId: this.actorId,
                sourceId: this.sourceId
            }
        };
    }

    private createDynamicPackager(context: PackagerContext): FlowBoxPackager {
        const spec = (this.flowBox.properties?._clockCooking || {}) as ClockCookingSpec;
        const maxStages = Math.max(0, Number(spec.maxStages) || 0);
        const baseHeight = Math.max(0, Number(spec.baseHeight) || 0);
        const growthPerStage = Math.max(0, Number(spec.growthPerStage) || 0);
        const stageCount = this.stageHistory.length;
        const stageVisual = resolveCookingStageVisual(stageCount, maxStages, spec);
        const title = spec.title || 'Clock Cooking Actor';
        const status = stageCount >= maxStages && maxStages > 0
            ? 'settled'
            : (stageCount > 0 ? 'cooking' : 'dormant');
        const content = spec.sceneMode === 'ascii-diorama'
            ? buildCookingAsciiDiorama({
                title,
                status,
                stageCount,
                maxStages,
                stageHistory: this.stageHistory,
                lastCommittedFinalizationTick: this.lastCommittedFinalizationTick,
                pathStages: Math.max(maxStages, Math.floor(Number(spec.pathStages) || maxStages)),
                sceneWidth: Math.max(24, Math.floor(Number(spec.sceneWidth) || 44)),
                sceneHeight: Math.max(10, Math.floor(Number(spec.sceneHeight) || 14))
            })
            : (() => {
                const trail = stageCount > 0
                    ? this.stageHistory.map((entry) =>
                        `${entry.stage}. tick ${entry.tick}${entry.totalPageCount === null ? '' : ` | pages ${entry.totalPageCount}`} | ${buildCookingSweep(entry.stage)}`
                    ).join('\n')
                    : (spec.emptyLabel || 'No deliberate progression yet.');
                const heatBar = buildCookingHeatBar(stageCount, maxStages);
                const pulse = buildCookingPulse(stageCount);
                return [
                    title,
                    `State: ${status}`,
                    `Stages: ${stageCount} / ${maxStages}`,
                    `Heat: ${heatBar}`,
                    `Pulse: ${pulse}`,
                    `Trail:\n${trail}`
                ].join('\n');
            })();
        const resolvedHeight = baseHeight + stageCount * growthPerStage;

        const sourceElement = (this.flowBox._sourceElement || this.flowBox._unresolvedElement || {
            type: this.flowBox.type,
            content: ''
        }) as Element;

        const syntheticElement: Element = {
            ...sourceElement,
            content,
            children: undefined,
            properties: {
                ...(sourceElement.properties || {}),
                sourceId: this.sourceId,
                style: {
                    ...((sourceElement.properties?.style as Record<string, unknown>) || {}),
                    backgroundColor: stageVisual.backgroundColor,
                    borderColor: stageVisual.borderColor,
                    borderWidth: stageVisual.borderWidth,
                    paddingTop: 12,
                    paddingRight: 12,
                    paddingBottom: 12,
                    paddingLeft: 12,
                    color: stageVisual.color,
                    fontSize: stageVisual.fontSize,
                    lineHeight: 1.25,
                    ...(spec.fontFamily ? { fontFamily: spec.fontFamily } : {}),
                    ...(resolvedHeight > 0 ? { height: resolvedHeight } : {})
                }
            }
        };

        this.renderedFlowBox = (this.processor as any).shapeElement(syntheticElement, {
            sourceId: this.sourceId,
            sourceType: syntheticElement.type,
            fragmentIndex: this.fragmentIndex,
            isContinuation: !!this.continuationOf
        });
        this.base = new FlowBoxPackager(this.processor, this.renderedFlowBox, this.identity);
        return this.base;
    }
}

function resolveCookingStageVisual(
    stageCount: number,
    maxStages: number,
    spec: ClockCookingSpec
): CookingStageVisual {
    if (stageCount <= 0) {
        return {
            backgroundColor: spec.backgroundColor || '#f3f4f6',
            borderColor: spec.borderColor || '#6b7280',
            color: spec.color || '#374151',
            fontSize: 12,
            borderWidth: 2
        };
    }

    const settled = maxStages > 0 && stageCount >= maxStages;
    if (settled) {
        return {
            backgroundColor: spec.backgroundColor || '#fef3c7',
            borderColor: spec.borderColor || '#d97706',
            color: spec.color || '#9a3412',
            fontSize: 14,
            borderWidth: 3
        };
    }

    return {
        backgroundColor: spec.backgroundColor || '#ecfccb',
        borderColor: spec.borderColor || '#65a30d',
        color: spec.color || '#365314',
        fontSize: 13,
        borderWidth: 2
    };
}

function buildCookingHeatBar(stageCount: number, maxStages: number): string {
    const slots = Math.max(stageCount, maxStages, 2);
    const filled = Math.max(0, Math.min(stageCount, slots));
    return `[${'='.repeat(filled)}${'.'.repeat(Math.max(0, slots - filled))}]`;
}

function buildCookingPulse(stageCount: number): string {
    if (stageCount <= 0) return 'idle';
    return `>${'>'.repeat(stageCount)} ${'tick '.repeat(stageCount).trim()}`;
}

function buildCookingSweep(stage: number): string {
    return `${'-'.repeat(stage)}>${'>'.repeat(stage)}`;
}

function buildCookingAsciiDiorama(input: {
    title: string;
    status: string;
    stageCount: number;
    maxStages: number;
    pathStages: number;
    stageHistory: Array<{ stage: number; tick: number; totalPageCount: number | null }>;
    lastCommittedFinalizationTick: number;
    sceneWidth: number;
    sceneHeight: number;
}): string {
    const width = input.sceneWidth;
    const height = input.sceneHeight;
    const lines = Array.from({ length: height }, () => Array.from({ length: width }, () => ' '));
    const rulerY = 1;
    const playableTop = 4;
    const playableBottom = Math.max(playableTop + 4, height - 4);
    const playableLeft = 2;
    const playableRight = Math.max(playableLeft + 16, width - 12);
    const currentStage = Math.max(1, input.stageCount);
    const currentTick = input.stageHistory.at(-1)?.tick ?? 0;
    const markerXs = buildTimelineMarkerXs(playableLeft + 3, playableRight - 8, input.pathStages);

    scatterAsciiStars(lines, width, playableTop, playableBottom);
    placeAscii(lines, 0, rulerY - 1, [buildTimelineLabels(width, markerXs, input.pathStages)]);
    placeAscii(lines, 0, rulerY, [buildTimelineRuler(width, markerXs)]);

    const positions = Array.from({ length: currentStage }, (_, index) =>
        resolveUfoStagePosition(index + 1, input.pathStages, {
            minX: playableLeft,
            maxX: playableRight,
            minY: playableTop,
            maxY: playableBottom
        })
    );

    for (let index = 0; index < positions.length - 1; index++) {
        const from = positions[index];
        const to = positions[index + 1];
        drawArrowTrail(lines, from.x + 10, to.x - 2, Math.min(height - 1, from.y + 1));
    }

    for (let index = 0; index < positions.length; index++) {
        const position = positions[index];
        const isCurrent = index === positions.length - 1;
        placeAscii(lines, position.x, position.y, isCurrent ? buildBrightUfoArt() : buildGhostUfoArt(index));
    }

    const body = lines.map((row) => row.join('').replace(/\s+$/g, '')).join('\n');
    const eventLog = [
        `Kernel Tick: ${Math.max(0, input.lastCommittedFinalizationTick)} | Current Tick: ${currentTick}`,
        `Frame: ${currentStage.toString().padStart(2, '0')} / ${input.pathStages.toString().padStart(2, '0')}`,
        `UFO Pos: ${formatCookingPosition(positions.at(-1))}`,
        `Stage Log: ${buildCookingStageLog(input.stageHistory)}`,
        `Signals: pagination:finalized x ${input.stageHistory.length}`,
        `Mode: ${input.status.toUpperCase()} | Path: WAVY | Render: DOS/ASCII`,
        'Legend: ghost=past committed state | arrows=motion | bright=final capture'
    ].join('\n');
    return [
        `${input.title}  [DOS FLIPBOOK MODE]`,
        `State: ${input.status} | Ticks Cooked: ${input.stageCount} / ${input.maxStages}`,
        body,
        eventLog
    ].join('\n');
}

function placeAscii(lines: string[][], x: number, y: number, art: string[]): void {
    for (let row = 0; row < art.length; row++) {
        const targetY = y + row;
        if (targetY < 0 || targetY >= lines.length) continue;
        for (let column = 0; column < art[row].length; column++) {
            const targetX = x + column;
            if (targetX < 0 || targetX >= lines[targetY].length) continue;
            const char = art[row][column];
            if (char !== ' ') {
                lines[targetY][targetX] = char;
            }
        }
    }
}

function buildTimelineLabels(width: number, markerXs: number[], maxStages: number): string {
    const chars = Array.from({ length: width }, () => ' ');
    const labels = markerXs.map((_, index) => {
        const tick = Math.round((index / Math.max(1, markerXs.length - 1)) * maxStages);
        return `t${tick.toString().padStart(2, '0')}`;
    });
    for (let index = 0; index < labels.length; index++) {
        const label = labels[index];
        const start = Math.max(0, Math.min(width - label.length, markerXs[index]));
        for (let offset = 0; offset < label.length; offset++) {
            chars[start + offset] = label[offset];
        }
    }
    return chars.join('').replace(/\s+$/g, '');
}

function buildTimelineRuler(width: number, markerXs: number[]): string {
    const chars = Array.from({ length: width }, (_, index) => (index % 4 === 0 ? '+' : '-'));
    for (const markerX of markerXs) {
        if (markerX >= 0 && markerX < width) {
            chars[markerX] = '|';
        }
    }
    return chars.join('');
}

function buildCookingStageLog(stageHistory: Array<{ stage: number; tick: number; totalPageCount: number | null }>): string {
    if (stageHistory.length === 0) {
        return 'dormant';
    }
    return stageHistory.map((entry) =>
        `s${entry.stage}@tick${entry.tick}${entry.totalPageCount === null ? '' : `/p${entry.totalPageCount}`}`
    ).join(' -> ');
}

function drawArrowTrail(lines: string[][], xStart: number, xEnd: number, y: number): void {
    if (y < 0 || y >= lines.length) return;
    for (let x = xStart; x <= xEnd - 1; x += 2) {
        if (x >= 0 && x < lines[y].length && lines[y][x] === ' ') {
            lines[y][x] = '-';
        }
        if (x + 1 >= 0 && x + 1 < lines[y].length && lines[y][x + 1] === ' ') {
            lines[y][x + 1] = '>';
        }
    }
}

function buildTimelineMarkerXs(startX: number, endX: number, maxStages: number): number[] {
    const markerCount = Math.min(7, Math.max(3, maxStages + 1));
    return Array.from({ length: markerCount }, (_, index) =>
        Math.round(startX + ((endX - startX) * index) / Math.max(1, markerCount - 1))
    );
}

function resolveUfoStagePosition(
    stage: number,
    maxStages: number,
    bounds: { minX: number; maxX: number; minY: number; maxY: number; }
): { x: number; y: number } {
    const progress = maxStages <= 1 ? 0 : (stage - 1) / (maxStages - 1);
    const x = Math.round(bounds.minX + (bounds.maxX - bounds.minX) * progress);
    const waveAmplitude = Math.max(1, Math.floor((bounds.maxY - bounds.minY) / 4));
    const centerY = Math.round((bounds.minY + bounds.maxY) / 2);
    const y = Math.max(
        bounds.minY,
        Math.min(bounds.maxY, Math.round(centerY + Math.sin(progress * Math.PI * 2.2) * waveAmplitude))
    );
    return { x, y };
}

function scatterAsciiStars(lines: string[][], width: number, minY: number, maxY: number): void {
    const glyphs = ['*', '.', 'o', '+'];
    for (let y = minY; y <= maxY; y += 2) {
        for (let x = 1; x < width - 1; x += 7) {
            const selector = (x * 13 + y * 7) % 9;
            if (selector < 4 && lines[y][x] === ' ') {
                lines[y][x] = glyphs[selector];
            }
        }
    }
}

function buildBrightUfoArt(): string[] {
    return [
        "    _.---._   ",
        " .-'_o___o_`-.",
        "/__/_______\\__\\",
        "\\  \\_\\_/_/  /",
        " `-._____,-' "
    ];
}

function buildGhostUfoArt(index: number): string[] {
    const variants = [
        [
            "    .---.    ",
            " .-'-----'-. ",
            "(____---____)",
            " `-.---.-'  "
        ],
        [
            "    .-.-.    ",
            " .-'.....'-. ",
            "(____-.-____)",
            " `-.'.'.-'  "
        ]
    ];
    return variants[index % variants.length];
}

function formatCookingPosition(position: { x: number; y: number } | undefined): string {
    if (!position) return 'n/a';
    return `x=${position.x}, y=${position.y}`;
}

export class TestReplayMarkerPackager implements PackagerUnit {
    private base: FlowBoxPackager | null = null;
    private renderedFlowBox: FlowBox | null = null;
    private committedRenderCount = 0;
    private preparedRenderCount = 1;

    readonly actorId: string;
    readonly sourceId: string;
    readonly actorKind: string;
    readonly fragmentIndex: number;
    readonly continuationOf?: string;

    constructor(
        private readonly processor: LayoutProcessor,
        private readonly flowBox: FlowBox,
        private readonly identity: PackagerIdentity
    ) {
        this.actorId = identity.actorId;
        this.sourceId = identity.sourceId;
        this.actorKind = identity.actorKind;
        this.fragmentIndex = identity.fragmentIndex;
        this.continuationOf = identity.continuationOf;
    }

    get pageBreakBefore(): boolean | undefined { return this.renderedFlowBox?.pageBreakBefore ?? this.flowBox.pageBreakBefore; }
    get keepWithNext(): boolean | undefined { return this.renderedFlowBox?.keepWithNext ?? this.flowBox.keepWithNext; }

    prepare(availableWidth: number, availableHeight: number, context: PackagerContext): void {
        this.preparedRenderCount = this.committedRenderCount + 1;
        this.base = this.createDynamicPackager(this.preparedRenderCount);
        this.base.prepare(availableWidth, availableHeight, context);
    }

    getPlacementPreference(fullAvailableWidth: number, context: PackagerContext): PackagerPlacementPreference | null {
        const packager = this.base ?? this.createDynamicPackager(this.preparedRenderCount);
        return packager.getPlacementPreference?.(fullAvailableWidth, context) ?? null;
    }

    getTransformProfile(): PackagerTransformProfile {
        return {
            capabilities: [
                {
                    kind: 'split',
                    preservesIdentity: true,
                    producesContinuation: true
                }
            ]
        };
    }

    emitBoxes(availableWidth: number, availableHeight: number, context: PackagerContext): Box[] {
        const packager = this.base ?? this.createDynamicPackager(this.preparedRenderCount);
        this.committedRenderCount = this.preparedRenderCount;
        return packager.emitBoxes(availableWidth, availableHeight, context);
    }

    split(availableHeight: number, context: PackagerContext): PackagerSplitResult {
        const packager = this.base ?? this.createDynamicPackager(this.preparedRenderCount);
        return packager.split(availableHeight, context);
    }

    getRequiredHeight(): number { return this.base?.getRequiredHeight() ?? 0; }
    isUnbreakable(availableHeight: number): boolean { return this.base?.isUnbreakable(availableHeight) ?? false; }
    getMarginTop(): number { return this.base?.getMarginTop() ?? this.flowBox.marginTop; }
    getMarginBottom(): number { return this.base?.getMarginBottom() ?? this.flowBox.marginBottom; }

    private createDynamicPackager(renderCount: number): FlowBoxPackager {
        const spec = (this.flowBox.properties?._testReplayMarker || {}) as ReplayMarkerSpec;
        const title = spec.title || 'Replay Marker';
        const content = `${title}\nRender Count: ${renderCount}`;
        const sourceElement = (this.flowBox._sourceElement || this.flowBox._unresolvedElement || {
            type: this.flowBox.type,
            content: ''
        }) as Element;

        const syntheticElement: Element = {
            ...sourceElement,
            content,
            children: undefined,
            properties: {
                ...(sourceElement.properties || {}),
                sourceId: this.sourceId,
                style: {
                    ...((sourceElement.properties?.style as Record<string, unknown>) || {}),
                    backgroundColor: spec.backgroundColor || '#fee2e2',
                    borderColor: spec.borderColor || '#dc2626',
                    borderWidth: 2,
                    paddingTop: 10,
                    paddingRight: 10,
                    paddingBottom: 10,
                    paddingLeft: 10,
                    color: spec.color || '#7f1d1d',
                    fontSize: 12,
                    lineHeight: 1.2,
                    fontWeight: 700,
                    ...(spec.height ? { height: spec.height } : {})
                }
            }
        };

        this.renderedFlowBox = (this.processor as any).shapeElement(syntheticElement, {
            sourceId: this.sourceId,
            sourceType: syntheticElement.type,
            fragmentIndex: this.fragmentIndex,
            isContinuation: !!this.continuationOf
        });
        this.base = new FlowBoxPackager(this.processor, this.renderedFlowBox, this.identity);
        return this.base;
    }
}

