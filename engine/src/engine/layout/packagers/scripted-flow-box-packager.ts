import type { Element } from '../../types';
import type { ActorSignal } from '../actor-event-bus';
import type { FlowBox } from '../layout-core-types';
import type { LayoutProcessor } from '../layout-core';
import type { LayoutSession } from '../layout-session';
import { LayoutUtils } from '../layout-utils';
import { ScriptRuntimeHost, type ScriptGlobals } from '../script-runtime-host';
import { FlowBoxPackager } from './flow-box-packager';
import { createPackagers, type ExternalPackagerFactory } from './create-packagers';
import type { PackagerIdentity } from './packager-identity';
import { createFlowBoxPackagerIdentity } from './packager-identity';
import type {
    LayoutBox,
    ObservationResult,
    PackagerContext,
    PackagerPlacementPreference,
    PackagerSplitResult,
    PackagerTransformProfile,
    PackagerUnit,
    SpatialFrontier
} from './packager-types';

type ScriptMessage = {
    subject: string;
    payload?: unknown;
    from: string | null;
    to: string | null;
};

type FlowBoxShaper = {
    normalizeFlowBlock(element: Element, options: { path: number[] }): any;
    shapeNormalizedFlowBlock(block: any): FlowBox;
};

type ScriptPackagerFactoryProvider = LayoutProcessor & {
    getPackagerFactory(): ExternalPackagerFactory | undefined;
};

type LiveContentActor = PackagerUnit & {
    getLiveContent(): string;
    setLiveContent(content: string): boolean;
};

type ReplaceResult =
    | { replaced: false }
    | { replaced: true; nextNodes: Element[] };

type InsertPosition = 'before' | 'after';
type StructuralOperation =
    | { kind: 'delete' }
    | { kind: 'replace'; elements: Element[] }
    | { kind: 'insert'; elements: Element[]; position: InsertPosition };

function cloneElementTree<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
}

function visitElements(elements: Element[], visitor: (element: Element) => void): void {
    for (const element of elements) {
        visitor(element);
        if (Array.isArray(element.children) && element.children.length > 0) {
            visitElements(element.children, visitor);
        }
        if (Array.isArray(element.zones)) {
            for (const zone of element.zones) {
                if (Array.isArray(zone.elements) && zone.elements.length > 0) {
                    visitElements(zone.elements, visitor);
                }
            }
        }
        if (Array.isArray(element.slots)) {
            for (const slot of element.slots) {
                if (Array.isArray(slot.elements) && slot.elements.length > 0) {
                    visitElements(slot.elements, visitor);
                }
            }
        }
    }
}

function findBySourceId(elements: Element[], sourceId: string): Element | null {
    let found: Element | null = null;
    visitElements(elements, (element) => {
        if (found) return;
        if (String(element.properties?.sourceId || '') === sourceId) {
            found = element;
        }
    });
    return found;
}

function findByType(elements: Element[], type: string): Element[] {
    const matches: Element[] = [];
    visitElements(elements, (element) => {
        if (String(element.type || '') === type) {
            matches.push(element);
        }
    });
    return matches;
}

function normalizeScriptElements(value: unknown): Element[] {
    if (Array.isArray(value)) return (value as Element[]).map((element) => normalizeRuntimeElement(element));
    if (value && typeof value === 'object') return [normalizeRuntimeElement(value as Element)];
    return [];
}

function normalizeRuntimeElement(element: Element): Element {
    const cloned = cloneElementTree(element);
    const normalizedName = typeof cloned.name === 'string' && cloned.name.trim() ? cloned.name.trim() : '';
    if (normalizedName) {
        cloned.name = normalizedName;
        cloned.properties = {
            ...(cloned.properties || {}),
            sourceId: cloned.properties?.sourceId || normalizedName
        };
    }
    if (Array.isArray(cloned.children)) {
        cloned.children = cloned.children.map((child) => normalizeRuntimeElement(child));
    }
    if (Array.isArray(cloned.zones)) {
        cloned.zones = cloned.zones.map((zone) => ({
            ...zone,
            elements: Array.isArray(zone.elements) ? zone.elements.map((child) => normalizeRuntimeElement(child)) : []
        }));
    }
    if (Array.isArray(cloned.slots)) {
        cloned.slots = cloned.slots.map((slot) => ({
            ...slot,
            elements: Array.isArray(slot.elements) ? slot.elements.map((child) => normalizeRuntimeElement(child)) : []
        }));
    }
    return cloned;
}

function applyStructuralOperationBySourceId(
    nodes: Element[],
    sourceId: string,
    operation: StructuralOperation
): ReplaceResult {
    let mutated = false;
    const nextNodes: Element[] = [];

    for (const node of nodes) {
        if (String(node.properties?.sourceId || '') === sourceId) {
            if (operation.kind === 'insert') {
                if (operation.position === 'before') {
                    nextNodes.push(...cloneElementTree(operation.elements), node);
                } else {
                    nextNodes.push(node, ...cloneElementTree(operation.elements));
                }
            } else if (operation.kind === 'replace') {
                nextNodes.push(...cloneElementTree(operation.elements));
            }
            mutated = true;
            continue;
        }

        const nextNode: Element = { ...node };
        if (Array.isArray(node.children) && node.children.length > 0) {
            const childResult = applyStructuralOperationBySourceId(node.children, sourceId, operation);
            if (childResult.replaced) {
                nextNode.children = childResult.nextNodes;
                mutated = true;
            }
        }
        if (Array.isArray(node.zones) && node.zones.length > 0) {
            let zoneMutated = false;
            nextNode.zones = node.zones.map((zone) => {
                if (!Array.isArray(zone.elements) || zone.elements.length === 0) return zone;
                const zoneResult = applyStructuralOperationBySourceId(zone.elements, sourceId, operation);
                if (!zoneResult.replaced) return zone;
                zoneMutated = true;
                return {
                    ...zone,
                    elements: zoneResult.nextNodes
                };
            });
            if (zoneMutated) mutated = true;
        }
        if (Array.isArray(node.slots) && node.slots.length > 0) {
            let slotMutated = false;
            nextNode.slots = node.slots.map((slot) => {
                if (!Array.isArray(slot.elements) || slot.elements.length === 0) return slot;
                const slotResult = applyStructuralOperationBySourceId(slot.elements, sourceId, operation);
                if (!slotResult.replaced) return slot;
                slotMutated = true;
                return {
                    ...slot,
                    elements: slotResult.nextNodes
                };
            });
            if (slotMutated) mutated = true;
        }

        nextNodes.push(nextNode);
    }

    return mutated
        ? { replaced: true, nextNodes }
        : { replaced: false };
}

function replaceBySourceId(nodes: Element[], sourceId: string, replacement: Element[]): ReplaceResult {
    return applyStructuralOperationBySourceId(nodes, sourceId, {
        kind: 'replace',
        elements: replacement
    });
}

function insertBySourceId(
    nodes: Element[],
    sourceId: string,
    insertion: Element[],
    position: InsertPosition
): ReplaceResult {
    return applyStructuralOperationBySourceId(nodes, sourceId, {
        kind: 'insert',
        elements: insertion,
        position
    });
}

function deleteBySourceId(nodes: Element[], sourceId: string): ReplaceResult {
    return applyStructuralOperationBySourceId(nodes, sourceId, {
        kind: 'delete'
    });
}

function getCurrentLayoutSession(context: PackagerContext): LayoutSession {
    const processor = context.processor as LayoutProcessor & {
        getCurrentLayoutSession(): LayoutSession | null;
    };
    const session = processor.getCurrentLayoutSession();
    if (!session) {
        throw new Error('[ScriptedFlowBoxPackager] No active layout session.');
    }
    return session;
}

function deriveAvailableWidth(context: PackagerContext): number {
    if (Number.isFinite(context.contentWidthOverride)) {
        return Math.max(0, Number(context.contentWidthOverride));
    }
    return Math.max(0, context.pageWidth - context.margins.left - context.margins.right);
}

function deriveAvailableHeight(context: PackagerContext): number {
    return Math.max(0, context.pageHeight - context.cursorY - context.margins.bottom);
}

function createScriptMessageTopic(sourceId: string): string {
    const normalizedSourceId = LayoutUtils.normalizeAuthorSourceId(sourceId) || String(sourceId || '').trim();
    return `script:message:${normalizedSourceId}`;
}

function toPublicScriptName(sourceId: string | null | undefined): string {
    const trimmed = String(sourceId || '').trim();
    if (!trimmed) return 'doc';
    if (trimmed === 'system:script-document') return 'doc';
    const prefixMatch = trimmed.match(/^(author|auto|gen|system):(.*)$/);
    if (!prefixMatch) return trimmed;
    const [, prefix, remainder] = prefixMatch;
    if (prefix === 'system' && remainder === 'script-document') return 'doc';
    return remainder.trim() || trimmed;
}

function parseScriptMessage(signal: ActorSignal, targetSourceId: string): ScriptMessage | null {
    const payload = signal.payload || {};
    const subject = typeof payload.subject === 'string'
        ? payload.subject
        : (typeof payload.name === 'string' ? payload.name : '');
    if (!subject) return null;
    return {
        subject,
        payload: payload.payload,
        from: typeof payload.from === 'string' ? payload.from : null,
        to: targetSourceId
    };
}

export class ScriptedFlowBoxPackager implements PackagerUnit {
    private inner: FlowBoxPackager;
    private lastHandledMessageSequence = 0;
    private readonly messageTopic: string;
    private lastObservedPageIndex = 0;
    private lastObservedActorIndex = 0;
    private lastObservedCursorY = 0;
    private pendingLiveStructuralChange = false;
    private pendingLiveFrontier: SpatialFrontier | null = null;

    readonly actorId: string;
    readonly sourceId: string;
    readonly actorKind: string;
    readonly fragmentIndex: number;
    readonly continuationOf?: string;

    get pageBreakBefore(): boolean | undefined { return this.inner.pageBreakBefore; }
    get keepWithNext(): boolean | undefined { return this.inner.keepWithNext; }

    constructor(
        private readonly processor: LayoutProcessor,
        flowBox: FlowBox,
        private readonly host: ScriptRuntimeHost,
        private readonly sourceElement: Element,
        private readonly identity: PackagerIdentity,
        private readonly rootPath: number[],
        private readonly elements: Element[]
    ) {
        this.inner = new FlowBoxPackager(processor, flowBox, identity);
        const resolvedIdentity = createFlowBoxPackagerIdentity(flowBox, identity);
        this.actorId = resolvedIdentity.actorId;
        this.sourceId = resolvedIdentity.sourceId;
        this.actorKind = resolvedIdentity.actorKind;
        this.fragmentIndex = resolvedIdentity.fragmentIndex;
        this.continuationOf = resolvedIdentity.continuationOf;
        this.messageTopic = createScriptMessageTopic(this.sourceId);
    }

    private rebuildInner(): void {
        const shaper = this.processor as unknown as FlowBoxShaper;
        const normalized = shaper.normalizeFlowBlock(this.sourceElement, { path: this.rootPath });
        const nextFlowBox = shaper.shapeNormalizedFlowBlock(normalized);
        this.inner = new FlowBoxPackager(this.processor, nextFlowBox, this.identity);
    }

    getLiveContent(): string {
        return String(this.sourceElement.content || '');
    }

    setLiveContent(content: string): boolean {
        const nextContent = String(content);
        if (this.getLiveContent() === nextContent) return false;
        this.sourceElement.content = nextContent;
        this.rebuildInner();
        return true;
    }

    private replaceLiveSelf(session: LayoutSession, elements: Element[]): boolean {
        const processorWithFactory = this.processor as unknown as ScriptPackagerFactoryProvider;
        const packagerFactory = processorWithFactory.getPackagerFactory?.();
        const replacements = createPackagers(elements, this.processor, packagerFactory);
        if (replacements.length === 0) return false;
        const replacedIndex = session.replaceActorInLiveQueue(this, replacements, elements);
        if (replacedIndex === null) return false;
        this.pendingLiveStructuralChange = true;
        this.pendingLiveFrontier = {
            pageIndex: this.lastObservedPageIndex,
            cursorY: this.lastObservedCursorY,
            actorIndex: replacedIndex,
            actorId: replacements[0]?.actorId ?? this.actorId,
            sourceId: replacements[0]?.sourceId ?? this.sourceId
        };
        return true;
    }

    private insertLiveRelativeToSelf(
        session: LayoutSession,
        elements: Element[],
        position: InsertPosition
    ): boolean {
        const processorWithFactory = this.processor as unknown as ScriptPackagerFactoryProvider;
        const packagerFactory = processorWithFactory.getPackagerFactory?.();
        const insertions = createPackagers(elements, this.processor, packagerFactory);
        if (insertions.length === 0) return false;
        const insertedIndex = session.insertActorsInLiveQueue(this, insertions, position, elements);
        if (insertedIndex === null) return false;
        this.pendingLiveStructuralChange = true;
        this.pendingLiveFrontier = {
            pageIndex: this.lastObservedPageIndex,
            cursorY: this.lastObservedCursorY,
            actorIndex: insertedIndex,
            actorId: insertions[0]?.actorId,
            sourceId: insertions[0]?.sourceId
        };
        return true;
    }

    private isLiveContentActor(actor: PackagerUnit | null): actor is LiveContentActor {
        return !!actor
            && (
                actor instanceof FlowBoxPackager
                || actor instanceof ScriptedFlowBoxPackager
            )
            && typeof (actor as { getLiveContent?: unknown }).getLiveContent === 'function'
            && typeof (actor as { setLiveContent?: unknown }).setLiveContent === 'function';
    }

    private resolveLiveActor(session: LayoutSession, target: unknown): PackagerUnit | null {
        const sourceId = this.resolveSourceId(target);
        if (!sourceId || sourceId === 'doc') return null;
        const normalized = LayoutUtils.normalizeAuthorSourceId(sourceId) || sourceId;
        const actor = session.getRegisteredActors().find((entry) =>
            (entry.sourceId === sourceId || entry.sourceId === normalized)
        );
        return actor ?? null;
    }

    private replaceLiveActor(session: LayoutSession, target: unknown, elements: Element[]): boolean {
        const actor = this.resolveLiveActor(session, target);
        if (!actor) return false;
        if (actor.actorId === this.actorId) {
            return this.replaceLiveSelf(session, elements);
        }
        const processorWithFactory = this.processor as unknown as ScriptPackagerFactoryProvider;
        const packagerFactory = processorWithFactory.getPackagerFactory?.();
        const replacements = createPackagers(elements, this.processor, packagerFactory);
        if (replacements.length === 0) return false;
        const replacedIndex = session.replaceActorInLiveQueue(actor, replacements, elements);
        if (replacedIndex === null) return false;
        this.pendingLiveStructuralChange = true;
        this.pendingLiveFrontier = {
            pageIndex: this.lastObservedPageIndex,
            cursorY: this.lastObservedCursorY,
            actorIndex: replacedIndex,
            actorId: replacements[0]?.actorId ?? actor.actorId,
            sourceId: replacements[0]?.sourceId ?? actor.sourceId
        };
        return true;
    }

    private setLiveActorContent(session: LayoutSession, target: unknown, content: string): boolean {
        const actor = this.resolveLiveActor(session, target);
        if (!this.isLiveContentActor(actor)) return false;
        const nextContent = String(content);
        const changed = actor.setLiveContent(nextContent);
        if (!changed) return false;
        const shadowNode = actor.sourceId ? findBySourceId(this.elements, actor.sourceId) : null;
        if (shadowNode) {
            shadowNode.content = nextContent;
        }
        const hostActorIndex = session.noteHostedRuntimeActorContentMutation(actor);
        this.pendingLiveStructuralChange = true;
        this.pendingLiveFrontier = {
            pageIndex: this.lastObservedPageIndex,
            cursorY: this.lastObservedCursorY,
            actorIndex: hostActorIndex ?? this.lastObservedActorIndex,
            actorId: hostActorIndex !== null ? undefined : actor.actorId,
            sourceId: hostActorIndex !== null ? undefined : actor.sourceId
        };
        return true;
    }

    private insertLiveRelative(
        session: LayoutSession,
        target: unknown,
        elements: Element[],
        position: InsertPosition
    ): boolean {
        const actor = this.resolveLiveActor(session, target);
        if (!actor) return false;
        if (actor.actorId === this.actorId) {
            return this.insertLiveRelativeToSelf(session, elements, position);
        }
        const processorWithFactory = this.processor as unknown as ScriptPackagerFactoryProvider;
        const packagerFactory = processorWithFactory.getPackagerFactory?.();
        const insertions = createPackagers(elements, this.processor, packagerFactory);
        if (insertions.length === 0) return false;
        const insertedIndex = session.insertActorsInLiveQueue(actor, insertions, position, elements);
        if (insertedIndex === null) return false;
        this.pendingLiveStructuralChange = true;
        this.pendingLiveFrontier = {
            pageIndex: this.lastObservedPageIndex,
            cursorY: this.lastObservedCursorY,
            actorIndex: insertedIndex,
            actorId: insertions[0]?.actorId,
            sourceId: insertions[0]?.sourceId
        };
        return true;
    }

    private deleteLiveActor(session: LayoutSession, target: unknown): boolean {
        const actor = this.resolveLiveActor(session, target);
        if (!actor) return false;
        const deletedIndex = session.deleteActorInLiveQueue(actor);
        if (deletedIndex === null) return false;
        this.pendingLiveStructuralChange = true;
        this.pendingLiveFrontier = {
            pageIndex: this.lastObservedPageIndex,
            cursorY: this.lastObservedCursorY,
            actorIndex: deletedIndex,
            actorId: actor.actorId,
            sourceId: actor.sourceId
        };
        return true;
    }

    private publishScriptMessage(
        context: PackagerContext,
        recipient: unknown,
        msg: unknown
    ): boolean {
        const targetSourceId = this.resolveSourceId(recipient);
        if (!targetSourceId || targetSourceId === 'doc') return false;
        const session = getCurrentLayoutSession(context);
        const message = typeof msg === 'string'
            ? { subject: msg }
            : (msg && typeof msg === 'object' ? { ...(msg as Record<string, unknown>) } : { subject: String(msg) });
        if (typeof (message as Record<string, unknown>).subject !== 'string' || !(message as Record<string, unknown>).subject) {
            const legacyName = (message as Record<string, unknown>).name;
            (message as Record<string, unknown>).subject =
                typeof legacyName === 'string' && legacyName ? legacyName : 'message';
        }
        delete (message as Record<string, unknown>).name;
        session.recordProfile('messageSendCalls', 1);
        context.publishActorSignal({
            topic: createScriptMessageTopic(targetSourceId),
            publisherActorId: this.actorId,
            publisherSourceId: this.sourceId,
            publisherActorKind: this.actorKind,
            fragmentIndex: this.fragmentIndex,
            pageIndex: context.pageIndex,
            cursorY: context.cursorY,
            payload: {
                ...message,
                from: this.sourceId,
                to: targetSourceId
            }
        });
        return true;
    }

    private resolveSourceId(target: unknown): string | null {
        if (target && typeof target === 'object' && (target as Record<string, unknown>).type === 'document') {
            return 'doc';
        }
        if (typeof target === 'string' && target.trim()) return target.trim();
        if (target && typeof target === 'object') {
            const maybeName = (target as Record<string, unknown>).name;
            if (typeof maybeName === 'string' && maybeName.trim()) return maybeName.trim();
            const maybeSourceId = (target as Record<string, unknown>).sourceId;
            if (typeof maybeSourceId === 'string' && maybeSourceId.trim()) return maybeSourceId.trim();
            const maybeProperties = (target as Record<string, unknown>).properties;
            if (maybeProperties && typeof maybeProperties === 'object') {
                const nestedSourceId = (maybeProperties as Record<string, unknown>).sourceId;
                if (typeof nestedSourceId === 'string' && nestedSourceId.trim()) return nestedSourceId.trim();
            }
        }
        return null;
    }

    private createElementRef(
        session: LayoutSession,
        element: Element,
        sendMessage: (recipient: unknown, msg: unknown) => boolean
    ): Record<string, unknown> {
        const sourceId = typeof element.properties?.sourceId === 'string' ? element.properties.sourceId : null;
        return {
            name: sourceId,
            type: String(element.type || ''),
            get content() {
                return String(element.content || '');
            },
            setContent: (content: string) => {
                if (sourceId) {
                    const liveChanged = this.setLiveActorContent(session, sourceId, content);
                    if (liveChanged) {
                        session.recordProfile('setContentCalls', 1);
                        return true;
                    }
                }
                const nextContent = String(content);
                if (String(element.content || '') === nextContent) return false;
                element.content = nextContent;
                session.recordProfile('setContentCalls', 1);
                if (element === this.sourceElement) {
                    this.rebuildInner();
                }
                return true;
            },
            replace: (value: unknown) => {
                if (!sourceId) return false;
                const elements = normalizeScriptElements(value);
                const liveReplaced = this.replaceLiveActor(session, sourceId, elements);
                if (liveReplaced) {
                    session.recordProfile('replaceCalls', 1);
                    return true;
                }
                if (element === this.sourceElement) {
                    const replaced = this.replaceLiveSelf(session, elements);
                    if (!replaced) return false;
                    session.recordProfile('replaceCalls', 1);
                    return true;
                }
                const result = replaceBySourceId(this.elements, sourceId, elements);
                if (!result.replaced) return false;
                this.elements.splice(0, this.elements.length, ...result.nextNodes);
                session.recordProfile('replaceCalls', 1);
                return true;
            },
            append: (value: unknown) => {
                if (!sourceId) return false;
                const elements = normalizeScriptElements(value);
                if (elements.length === 0) return false;
                const liveInserted = this.insertLiveRelative(session, sourceId, elements, 'after');
                if (liveInserted) {
                    session.recordProfile('insertCalls', 1);
                    return true;
                }
                if (element === this.sourceElement) {
                    const inserted = this.insertLiveRelativeToSelf(session, elements, 'after');
                    if (!inserted) return false;
                    session.recordProfile('insertCalls', 1);
                    return true;
                }
                const result = insertBySourceId(this.elements, sourceId, elements, 'after');
                if (!result.replaced) return false;
                this.elements.splice(0, this.elements.length, ...result.nextNodes);
                session.recordProfile('insertCalls', 1);
                return true;
            },
            prepend: (value: unknown) => {
                if (!sourceId) return false;
                const elements = normalizeScriptElements(value);
                if (elements.length === 0) return false;
                const liveInserted = this.insertLiveRelative(session, sourceId, elements, 'before');
                if (liveInserted) {
                    session.recordProfile('insertCalls', 1);
                    return true;
                }
                if (element === this.sourceElement) {
                    const inserted = this.insertLiveRelativeToSelf(session, elements, 'before');
                    if (!inserted) return false;
                    session.recordProfile('insertCalls', 1);
                    return true;
                }
                const result = insertBySourceId(this.elements, sourceId, elements, 'before');
                if (!result.replaced) return false;
                this.elements.splice(0, this.elements.length, ...result.nextNodes);
                session.recordProfile('insertCalls', 1);
                return true;
            },
            sendMessage
        };
    }

    private createDocRef(session: LayoutSession, context: PackagerContext): Record<string, unknown> {
        return {
            name: 'doc',
            type: 'document',
            vars: this.host.getScriptVars(),
            findElementByName: (name: string) => {
                session.recordProfile('docQueryCalls', 1);
                const node = findBySourceId(this.elements, name);
                return node ? this.createElementRef(session, node, () => false) : null;
            },
            findElementsByType: (type: string) => {
                session.recordProfile('docQueryCalls', 1);
                return findByType(this.elements, type).map((node) => this.createElementRef(session, node, () => false));
            },
            getPageCount: () => {
                session.recordProfile('docQueryCalls', 1);
                const finalizedSignals = context.readActorSignals('pagination:finalized');
                const latest = finalizedSignals[finalizedSignals.length - 1];
                const total = latest?.payload?.totalPageCount;
                return Number.isFinite(total) ? Number(total) : 0;
            },
            append: (value: unknown) => {
                const elements = normalizeScriptElements(value);
                if (elements.length === 0) return false;
                this.elements.push(...elements);
                session.recordProfile('insertCalls', 1);
                return true;
            },
            prepend: (value: unknown) => {
                const elements = normalizeScriptElements(value);
                if (elements.length === 0) return false;
                this.elements.splice(0, 0, ...elements);
                session.recordProfile('insertCalls', 1);
                return true;
            }
        };
    }

    private createGlobals(session: LayoutSession, context: PackagerContext): ScriptGlobals {
        const docRef = this.createDocRef(session, context);
        const element = (name: string) => {
            session.recordProfile('docQueryCalls', 1);
            const node = findBySourceId(this.elements, name);
            return node ? this.createElementRef(session, node, () => false) : null;
        };
        const elementsByType = (type: string) => {
            session.recordProfile('docQueryCalls', 1);
            return findByType(this.elements, type).map((node) => this.createElementRef(session, node, () => false));
        };
        const selfRef = this.createElementRef(session, this.sourceElement, (recipient, msg) => this.publishScriptMessage(context, recipient, msg));
        const append = (value: unknown) => {
            const handler = selfRef as Record<string, unknown>;
            const appendFn = handler.append as ((value: unknown) => boolean) | undefined;
            return appendFn ? appendFn(value) : false;
        };
        const replace = (value: unknown) => {
            const handler = selfRef as Record<string, unknown>;
            const replaceFn = handler.replace as ((value: unknown) => boolean) | undefined;
            return replaceFn ? replaceFn(value) : false;
        };
        const prepend = (value: unknown) => {
            const handler = selfRef as Record<string, unknown>;
            const prependFn = handler.prepend as ((value: unknown) => boolean) | undefined;
            return prependFn ? prependFn(value) : false;
        };
        return {
            doc: docRef,
            self: selfRef,
            sendMessage: (recipient: unknown, msg: unknown) => this.publishScriptMessage(context, recipient, msg),
            element,
            elementsByType,
            replace,
            append,
            prepend,
            setContent: (target: unknown, content: string) => {
                const sourceId = this.resolveSourceId(target);
                if (!sourceId || sourceId === 'doc') return false;
                const liveChanged = this.setLiveActorContent(session, sourceId, content);
                if (liveChanged) {
                    session.recordProfile('setContentCalls', 1);
                    return true;
                }
                const node = findBySourceId(this.elements, sourceId);
                if (!node) return false;
                const nextContent = String(content);
                if (String(node.content || '') === nextContent) return false;
                node.content = nextContent;
                session.recordProfile('setContentCalls', 1);
                if (node === this.sourceElement) {
                    this.rebuildInner();
                }
                return true;
            },
            replaceElement: (target: unknown, elements: Element[]) => {
                const sourceId = this.resolveSourceId(target);
                if (!sourceId || sourceId === 'doc') return false;
                const normalizedElements = normalizeScriptElements(elements);
                const liveReplaced = this.replaceLiveActor(session, sourceId, normalizedElements);
                if (liveReplaced) {
                    session.recordProfile('replaceCalls', 1);
                    return true;
                }
                const result = replaceBySourceId(this.elements, sourceId, normalizedElements);
                if (!result.replaced) return false;
                this.elements.splice(0, this.elements.length, ...result.nextNodes);
                session.recordProfile('replaceCalls', 1);
                return true;
            },
            insertBefore: (target: unknown, elements: Element[]) => {
                const sourceId = this.resolveSourceId(target);
                if (!sourceId || sourceId === 'doc') return false;
                const normalizedElements = normalizeScriptElements(elements);
                const liveInserted = this.insertLiveRelative(session, sourceId, normalizedElements, 'before');
                if (liveInserted) {
                    session.recordProfile('insertCalls', 1);
                    return true;
                }
                const result = insertBySourceId(this.elements, sourceId, normalizedElements, 'before');
                if (!result.replaced) return false;
                this.elements.splice(0, this.elements.length, ...result.nextNodes);
                session.recordProfile('insertCalls', 1);
                return true;
            },
            insertAfter: (target: unknown, elements: Element[]) => {
                const sourceId = this.resolveSourceId(target);
                if (!sourceId || sourceId === 'doc') return false;
                const normalizedElements = normalizeScriptElements(elements);
                const liveInserted = this.insertLiveRelative(session, sourceId, normalizedElements, 'after');
                if (liveInserted) {
                    session.recordProfile('insertCalls', 1);
                    return true;
                }
                const result = insertBySourceId(this.elements, sourceId, normalizedElements, 'after');
                if (!result.replaced) return false;
                this.elements.splice(0, this.elements.length, ...result.nextNodes);
                session.recordProfile('insertCalls', 1);
                return true;
            },
            deleteElement: (target: unknown) => {
                const sourceId = this.resolveSourceId(target);
                if (!sourceId || sourceId === 'doc') return false;
                const liveDeleted = this.deleteLiveActor(session, sourceId);
                if (liveDeleted) {
                    session.recordProfile('removeCalls', 1);
                    return true;
                }
                const result = deleteBySourceId(this.elements, sourceId);
                if (!result.replaced) return false;
                this.elements.splice(0, this.elements.length, ...result.nextNodes);
                session.recordProfile('removeCalls', 1);
                return true;
            },
            findElementByName: element,
            findElementsByType: elementsByType,
            insertElementsBefore: (target: unknown, elements: Element[]) => {
                const sourceId = this.resolveSourceId(target);
                if (!sourceId || sourceId === 'doc') return false;
                const normalizedElements = normalizeScriptElements(elements);
                const liveInserted = this.insertLiveRelative(session, sourceId, normalizedElements, 'before');
                if (liveInserted) {
                    session.recordProfile('insertCalls', 1);
                    return true;
                }
                const result = insertBySourceId(this.elements, sourceId, normalizedElements, 'before');
                if (!result.replaced) return false;
                this.elements.splice(0, this.elements.length, ...result.nextNodes);
                session.recordProfile('insertCalls', 1);
                return true;
            },
            insertElementsAfter: (target: unknown, elements: Element[]) => {
                const sourceId = this.resolveSourceId(target);
                if (!sourceId || sourceId === 'doc') return false;
                const normalizedElements = normalizeScriptElements(elements);
                const liveInserted = this.insertLiveRelative(session, sourceId, normalizedElements, 'after');
                if (liveInserted) {
                    session.recordProfile('insertCalls', 1);
                    return true;
                }
                const result = insertBySourceId(this.elements, sourceId, normalizedElements, 'after');
                if (!result.replaced) return false;
                this.elements.splice(0, this.elements.length, ...result.nextNodes);
                session.recordProfile('insertCalls', 1);
                return true;
            }
        };
    }

    prepare(availableWidth: number, availableHeight: number, context: PackagerContext): void {
        this.lastObservedPageIndex = context.pageIndex;
        this.lastObservedActorIndex = Number.isFinite(context.actorIndex) ? Number(context.actorIndex) : this.lastObservedActorIndex;
        this.lastObservedCursorY = Number.isFinite(context.cursorY) ? Number(context.cursorY) : this.lastObservedCursorY;
        this.inner.prepare(availableWidth, availableHeight, context);
    }

    getPlacementPreference(fullAvailableWidth: number, context: PackagerContext): PackagerPlacementPreference | null {
        return this.inner.getPlacementPreference?.(fullAvailableWidth, context) ?? null;
    }

    getTransformProfile(): PackagerTransformProfile | null | undefined {
        return this.inner.getTransformProfile?.();
    }

    emitBoxes(availableWidth: number, availableHeight: number, context: PackagerContext): LayoutBox[] | null {
        return this.inner.emitBoxes(availableWidth, availableHeight, context);
    }

    getCommittedSignalSubscriptions(): readonly string[] {
        return [this.messageTopic];
    }

    updateCommittedState(context: PackagerContext): ObservationResult {
        const explicitHandlerName = typeof this.sourceElement.properties?.onMessage === 'string'
            ? this.sourceElement.properties.onMessage
            : null;
        const handlerName = this.host.getElementHandlerName(this.sourceId, 'onMessage', explicitHandlerName) || '';
        if (!handlerName) {
            return { changed: false, geometryChanged: false, updateKind: 'none' };
        }

        const signals = context.readActorSignals(this.messageTopic)
            .filter((signal) => signal.sequence > this.lastHandledMessageSequence);
        if (signals.length === 0) {
            return { changed: false, geometryChanged: false, updateKind: 'none' };
        }

        const session = getCurrentLayoutSession(context);
        const availableWidth = deriveAvailableWidth(context);
        const availableHeight = deriveAvailableHeight(context);
        this.prepare(availableWidth, availableHeight, context);
        const previousRequiredHeight = this.getRequiredHeight();

        let changed = false;
        let highestSequence = this.lastHandledMessageSequence;

        for (const signal of signals) {
            const message = parseScriptMessage(signal, this.sourceId);
            if (!message) continue;

            const beforeSnapshot = JSON.stringify(this.elements);
            this.host.runHandler(
                handlerName,
                'onMessage',
                this.createGlobals(session, context),
                {
                    from: message.from
                        ? { name: toPublicScriptName(message.from) }
                        : { name: 'doc', type: 'document' },
                    msg: message
                },
                session
            );
            changed = changed || JSON.stringify(this.elements) !== beforeSnapshot;
            highestSequence = Math.max(highestSequence, signal.sequence);
        }

        this.lastHandledMessageSequence = highestSequence;
        if (this.pendingLiveStructuralChange) {
            this.pendingLiveStructuralChange = false;
            const frontier = this.pendingLiveFrontier || {
                pageIndex: this.lastObservedPageIndex,
                cursorY: this.lastObservedCursorY,
                actorIndex: this.lastObservedActorIndex,
                actorId: this.actorId,
                sourceId: this.sourceId
            };
            this.pendingLiveFrontier = null;
            return {
                changed: true,
                geometryChanged: true,
                updateKind: 'geometry',
                earliestAffectedFrontier: frontier
            };
        }
        if (!changed) {
            return { changed: false, geometryChanged: false, updateKind: 'none' };
        }

        this.prepare(availableWidth, availableHeight, context);
        const nextRequiredHeight = this.getRequiredHeight();
        const updateKind = Math.abs(nextRequiredHeight - previousRequiredHeight) > 0.01
            ? 'geometry'
            : 'content-only';

        return {
            changed: true,
            geometryChanged: updateKind === 'geometry',
            updateKind,
            earliestAffectedFrontier: {
                pageIndex: this.lastObservedPageIndex,
                cursorY: this.lastObservedCursorY,
                actorIndex: this.lastObservedActorIndex,
                actorId: this.actorId,
                sourceId: this.sourceId
            }
        };
    }

    split(availableHeight: number, context: PackagerContext): PackagerSplitResult {
        return this.inner.split(availableHeight, context);
    }

    getRequiredHeight(): number {
        return this.inner.getRequiredHeight();
    }

    getZIndex(): number {
        return this.inner.getZIndex?.() ?? 0;
    }

    occupiesFlowSpace(): boolean {
        return this.inner.occupiesFlowSpace?.() ?? true;
    }

    isUnbreakable(availableHeight: number): boolean {
        return this.inner.isUnbreakable(availableHeight);
    }

    getMarginTop(): number {
        return this.inner.getMarginTop();
    }

    getMarginBottom(): number {
        return this.inner.getMarginBottom();
    }
}
