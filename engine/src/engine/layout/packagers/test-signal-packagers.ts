import type { Box, Element } from '../../types';
import type { LayoutProcessor } from '../layout-core';
import type { FlowBox } from '../layout-core-types';
import type { PackagerIdentity } from './packager-identity';
import { FlowBoxPackager } from './flow-box-packager';
import type {
    ObservationResult,
    PackagerContext,
    PackagerPlacementPreference,
    PackagerSplitResult,
    PackagerTransformProfile,
    PackagerUnit
} from './packager-types';

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

    observeCommittedSignals(context: PackagerContext): ObservationResult {
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
        const resolvedHeight = baseHeight + observed.length * growthPerSignal;
        const content = this.buildObservedContent(spec, title, observed.length, uniquePages, labels);
        const nextObservationSignature = JSON.stringify({
            topic: spec.topic || 'probe',
            content
        });
        const nextGeometrySignature = JSON.stringify({
            height: resolvedHeight
        });

        const changed = this.observationSignature !== nextObservationSignature;
        const geometryChanged = this.geometrySignature !== nextGeometrySignature;

        this.observationSignature = nextObservationSignature;
        this.geometrySignature = nextGeometrySignature;

        return {
            changed,
            geometryChanged,
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
        const resolvedHeight = baseHeight + observed.length * growthPerSignal;
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
