import type { Element } from '../../types';
import type { LayoutProcessor } from '../layout-core';
import type { LayoutSession } from '../layout-session';
import { LayoutUtils } from '../layout-utils';
import { ScriptRuntimeHost, type ScriptGlobals, type ScriptLifecycleState } from '../script-runtime-host';
import { createPackagers, type ExternalPackagerFactory } from './create-packagers';
import { FlowBoxPackager } from './flow-box-packager';
import { ScriptedFlowBoxPackager } from './scripted-flow-box-packager';
import type {
    LayoutBox,
    ObservationResult,
    PackagerContext,
    PackagerSplitResult,
    PackagerUnit,
    SpatialFrontier
} from './packager-types';

type ReplaceResult =
    | { replaced: false }
    | { replaced: true; nextNodes: Element[] };

type InsertPosition = 'before' | 'after';
type StructuralOperation =
    | { kind: 'delete' }
    | { kind: 'replace'; elements: Element[] }
    | { kind: 'insert'; elements: Element[]; position: InsertPosition };

type ScriptPackagerFactoryProvider = LayoutProcessor & {
    getPackagerFactory(): ExternalPackagerFactory | undefined;
};

type LiveContentActor = PackagerUnit & {
    getLiveContent(): string;
    setLiveContent(content: string): boolean;
};

function cloneElementTree<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
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

function chooseEarlierFrontier(current: SpatialFrontier | null, next: SpatialFrontier): SpatialFrontier {
    if (!current) {
        return next;
    }
    if (next.pageIndex !== current.pageIndex) {
        return next.pageIndex < current.pageIndex ? next : current;
    }
    const nextCursorY = Number.isFinite(next.cursorY) ? Number(next.cursorY) : Number.POSITIVE_INFINITY;
    const currentCursorY = Number.isFinite(current.cursorY) ? Number(current.cursorY) : Number.POSITIVE_INFINITY;
    if (Math.abs(nextCursorY - currentCursorY) > 0.01) {
        return nextCursorY < currentCursorY ? next : current;
    }
    const nextActorIndex = Number.isFinite(next.actorIndex) ? Number(next.actorIndex) : Number.POSITIVE_INFINITY;
    const currentActorIndex = Number.isFinite(current.actorIndex) ? Number(current.actorIndex) : Number.POSITIVE_INFINITY;
    return nextActorIndex < currentActorIndex ? next : current;
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
        throw new Error('[ScriptDocumentPackager] No active layout session.');
    }
    return session;
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

export class ScriptDocumentPackager implements PackagerUnit {
    readonly actorId = 'actor:system:script-document:script-document:0';
    readonly sourceId = 'system:script-document';
    readonly actorKind = 'script-document';
    readonly fragmentIndex = 0;
    private replayRequested = false;
    private pendingLiveStructuralChange = false;
    private pendingLiveFrontier: SpatialFrontier | null = null;
    private lastObservedPageIndex = 0;
    private lastObservedActorIndex = 0;
    private lastObservedCursorY = 0;

    constructor(
        private readonly host: ScriptRuntimeHost,
        private readonly elements: Element[],
        private readonly lifecycleState: ScriptLifecycleState
    ) { }

    private createDocumentFrontier() {
        return {
            pageIndex: this.lastObservedPageIndex,
            cursorY: this.lastObservedCursorY,
            actorIndex: this.lastObservedActorIndex,
            actorId: this.actorId,
            sourceId: this.sourceId
        };
    }

    private requestReplay(session: LayoutSession): void {
        this.replayRequested = true;
        session.recordProfile('replayRequests', 1);
        session.requestScriptReplay();
    }

    private recordRuntimeMutation(frontier?: SpatialFrontier): void {
        this.lifecycleState.runtimeMutationVersion += 1;
        this.pendingLiveStructuralChange = true;
        if (frontier) {
            this.pendingLiveFrontier = chooseEarlierFrontier(this.pendingLiveFrontier, frontier);
        }
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
            entry.actorId !== this.actorId
            && (entry.sourceId === sourceId || entry.sourceId === normalized)
        );
        return actor ?? null;
    }

    private createLivePackagers(context: PackagerContext, elements: Element[]): PackagerUnit[] {
        const processorWithFactory = context.processor as unknown as ScriptPackagerFactoryProvider;
        const packagerFactory = processorWithFactory.getPackagerFactory?.();
        return createPackagers(elements, context.processor, packagerFactory);
    }

    private replaceLiveActor(session: LayoutSession, context: PackagerContext, target: unknown, value: unknown): boolean {
        const actor = this.resolveLiveActor(session, target);
        if (!actor) return false;
        const elements = normalizeScriptElements(value);
        const replacements = this.createLivePackagers(context, elements);
        if (replacements.length === 0) return false;
        const replacedIndex = session.replaceActorInLiveQueue(actor, replacements, elements);
        if (replacedIndex === null) return false;
        this.recordRuntimeMutation({
            pageIndex: this.lastObservedPageIndex,
            cursorY: this.lastObservedCursorY,
            actorIndex: replacedIndex,
            actorId: replacements[0]?.actorId ?? actor.actorId,
            sourceId: replacements[0]?.sourceId ?? actor.sourceId
        });
        return true;
    }

    private insertLiveRelative(
        session: LayoutSession,
        context: PackagerContext,
        target: unknown,
        value: unknown,
        position: InsertPosition
    ): boolean {
        const actor = this.resolveLiveActor(session, target);
        if (!actor) return false;
        const elements = normalizeScriptElements(value);
        const insertions = this.createLivePackagers(context, elements);
        if (insertions.length === 0) return false;
        const insertedIndex = session.insertActorsInLiveQueue(actor, insertions, position, elements);
        if (insertedIndex === null) return false;
        this.recordRuntimeMutation({
            pageIndex: this.lastObservedPageIndex,
            cursorY: this.lastObservedCursorY,
            actorIndex: insertedIndex,
            actorId: insertions[0]?.actorId,
            sourceId: insertions[0]?.sourceId
        });
        return true;
    }

    private deleteLiveActor(session: LayoutSession, target: unknown): boolean {
        const actor = this.resolveLiveActor(session, target);
        if (!actor) return false;
        const deletedIndex = session.deleteActorInLiveQueue(actor);
        if (deletedIndex === null) return false;
        this.recordRuntimeMutation({
            pageIndex: this.lastObservedPageIndex,
            cursorY: this.lastObservedCursorY,
            actorIndex: deletedIndex,
            actorId: actor.actorId,
            sourceId: actor.sourceId
        });
        return true;
    }

    private setLiveActorContent(
        session: LayoutSession,
        target: unknown,
        content: string
    ): boolean {
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
        this.recordRuntimeMutation({
            pageIndex: this.lastObservedPageIndex,
            cursorY: this.lastObservedCursorY,
            actorIndex: hostActorIndex ?? undefined,
            actorId: hostActorIndex !== null ? undefined : actor.actorId,
            sourceId: hostActorIndex !== null ? undefined : actor.sourceId
        });
        return true;
    }

    private prependLiveDocument(
        session: LayoutSession,
        context: PackagerContext,
        value: unknown
    ): boolean {
        const elements = normalizeScriptElements(value);
        const insertions = this.createLivePackagers(context, elements);
        if (insertions.length === 0) return false;
        const insertedIndex = session.prependActorsInLiveQueue(insertions);
        if (insertedIndex === null) return false;
        this.recordRuntimeMutation({
            pageIndex: this.lastObservedPageIndex,
            cursorY: this.lastObservedCursorY,
            actorIndex: insertedIndex,
            actorId: insertions[0]?.actorId,
            sourceId: insertions[0]?.sourceId
        });
        return true;
    }

    private appendLiveDocument(
        session: LayoutSession,
        context: PackagerContext,
        value: unknown
    ): boolean {
        const elements = normalizeScriptElements(value);
        const insertions = this.createLivePackagers(context, elements);
        if (insertions.length === 0) return false;
        const insertedIndex = session.appendActorsInLiveQueue(insertions);
        if (insertedIndex === null) return false;
        this.recordRuntimeMutation({
            pageIndex: this.lastObservedPageIndex,
            cursorY: this.lastObservedCursorY,
            actorIndex: insertedIndex,
            actorId: insertions[0]?.actorId,
            sourceId: insertions[0]?.sourceId
        });
        return true;
    }

    private createLiveActorRef(
        session: LayoutSession,
        context: PackagerContext,
        actor: PackagerUnit
    ): Record<string, unknown> {
        return {
            name: toPublicScriptName(actor.sourceId),
            type: String(actor.actorKind || ''),
            get content() {
                if (this.isLiveContentActor(actor)) {
                    return actor.getLiveContent();
                }
                return '';
            },
            setContent: (content: string) => {
                const changed = this.setLiveActorContent(session, actor.sourceId, content);
                if (!changed) return false;
                session.recordProfile('setContentCalls', 1);
                return true;
            },
            replace: (value: unknown) => {
                const replaced = this.replaceLiveActor(session, context, actor.sourceId, value);
                if (!replaced) return false;
                session.recordProfile('replaceCalls', 1);
                return true;
            },
            append: (value: unknown) => {
                const inserted = this.insertLiveRelative(session, context, actor.sourceId, value, 'after');
                if (!inserted) return false;
                session.recordProfile('insertCalls', 1);
                return true;
            },
            prepend: (value: unknown) => {
                const inserted = this.insertLiveRelative(session, context, actor.sourceId, value, 'before');
                if (!inserted) return false;
                session.recordProfile('insertCalls', 1);
                return true;
            }
        };
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
        context?: PackagerContext
    ): Record<string, unknown> {
        const sourceId = typeof element.properties?.sourceId === 'string' ? element.properties.sourceId : null;
        return {
            name: sourceId,
            type: String(element.type || ''),
            get content() {
                return String(element.content || '');
            },
            setContent: (content: string) => {
                if (!sourceId) return false;
                const liveChanged = context
                    ? this.setLiveActorContent(session, sourceId, content)
                    : false;
                if (liveChanged) {
                    session.recordProfile('setContentCalls', 1);
                    return true;
                }
                const nextContent = String(content);
                if (String(element.content || '') === nextContent) return false;
                element.content = nextContent;
                session.recordProfile('setContentCalls', 1);
                return true;
            },
            replace: (value: unknown) => {
                if (!sourceId) return false;
                const liveReplaced = context
                    ? this.replaceLiveActor(session, context, sourceId, value)
                    : false;
                if (liveReplaced) {
                    session.recordProfile('replaceCalls', 1);
                    return true;
                }
                const elements = normalizeScriptElements(value);
                const result = replaceBySourceId(this.elements, sourceId, elements);
                if (!result.replaced) return false;
                this.elements.splice(0, this.elements.length, ...result.nextNodes);
                session.recordProfile('replaceCalls', 1);
                return true;
            },
            append: (value: unknown) => {
                if (!sourceId) return false;
                const liveInserted = context
                    ? this.insertLiveRelative(session, context, sourceId, value, 'after')
                    : false;
                if (liveInserted) {
                    session.recordProfile('insertCalls', 1);
                    return true;
                }
                const elements = normalizeScriptElements(value);
                if (elements.length === 0) return false;
                const result = insertBySourceId(this.elements, sourceId, elements, 'after');
                if (!result.replaced) return false;
                this.elements.splice(0, this.elements.length, ...result.nextNodes);
                session.recordProfile('insertCalls', 1);
                return true;
            },
            prepend: (value: unknown) => {
                if (!sourceId) return false;
                const liveInserted = context
                    ? this.insertLiveRelative(session, context, sourceId, value, 'before')
                    : false;
                if (liveInserted) {
                    session.recordProfile('insertCalls', 1);
                    return true;
                }
                const elements = normalizeScriptElements(value);
                if (elements.length === 0) return false;
                const result = insertBySourceId(this.elements, sourceId, elements, 'before');
                if (!result.replaced) return false;
                this.elements.splice(0, this.elements.length, ...result.nextNodes);
                session.recordProfile('insertCalls', 1);
                return true;
            }
        };
    }

    private createDocRef(session: LayoutSession, context?: PackagerContext): Record<string, unknown> {
        return {
            name: 'doc',
            type: 'document',
            vars: this.host.getScriptVars(),
            findElementByName: (name: string) => {
                session.recordProfile('docQueryCalls', 1);
                const node = findBySourceId(this.elements, name);
                if (node) return this.createElementRef(session, node, context);
                if (!context) return null;
                const liveActor = this.resolveLiveActor(session, name);
                return liveActor ? this.createLiveActorRef(session, context, liveActor) : null;
            },
            findElementsByType: (type: string) => {
                session.recordProfile('docQueryCalls', 1);
                return findByType(this.elements, type).map((node) => this.createElementRef(session, node, context));
            },
            getPageCount: () => {
                session.recordProfile('docQueryCalls', 1);
                if (!context) return 0;
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
            if (node) return this.createElementRef(session, node, context);
            const liveActor = this.resolveLiveActor(session, name);
            return liveActor ? this.createLiveActorRef(session, context, liveActor) : null;
        };
        const elementsByType = (type: string) => {
            session.recordProfile('docQueryCalls', 1);
            return findByType(this.elements, type).map((node) => this.createElementRef(session, node, context));
        };
        const append = (value: unknown) => {
            const elements = normalizeScriptElements(value);
            if (elements.length === 0) return false;
            this.elements.push(...elements);
            session.recordProfile('insertCalls', 1);
            return true;
        };
        const prepend = (value: unknown) => {
            const elements = normalizeScriptElements(value);
            if (elements.length === 0) return false;
            this.elements.splice(0, 0, ...elements);
            session.recordProfile('insertCalls', 1);
            return true;
        };
        const replace = (value: unknown) => {
            const elements = normalizeScriptElements(value);
            this.elements.splice(0, this.elements.length, ...elements);
            session.recordProfile('replaceCalls', 1);
            return true;
        };
        const setContent = (target: unknown, content: string) => {
            const liveChanged = this.setLiveActorContent(session, target, content);
            if (liveChanged) {
                session.recordProfile('setContentCalls', 1);
                return true;
            }
            const sourceId = this.resolveSourceId(target);
            if (!sourceId) return false;
            if (sourceId === 'doc') return false;
            const node = findBySourceId(this.elements, sourceId);
            if (!node) return false;
            const nextContent = String(content);
            if (String(node.content || '') === nextContent) return false;
            node.content = nextContent;
            session.recordProfile('setContentCalls', 1);
            return true;
        };
        const replaceElement = (target: unknown, elements: Element[]) => {
            const liveReplaced = this.replaceLiveActor(session, context, target, elements);
            if (liveReplaced) {
                session.recordProfile('replaceCalls', 1);
                return true;
            }
            const sourceId = this.resolveSourceId(target);
            if (!sourceId) return false;
            const normalizedElements = normalizeScriptElements(elements);
            const result = replaceBySourceId(this.elements, sourceId, normalizedElements);
            if (!result.replaced) return false;
            this.elements.splice(0, this.elements.length, ...result.nextNodes);
            session.recordProfile('replaceCalls', 1);
            return true;
        };
        const insertElementsBefore = (target: unknown, elements: Element[]) => {
            const liveInserted = this.insertLiveRelative(session, context, target, elements, 'before');
            if (liveInserted) {
                session.recordProfile('insertCalls', 1);
                return true;
            }
            const sourceId = this.resolveSourceId(target);
            if (!sourceId) return false;
            const normalizedElements = normalizeScriptElements(elements);
            const result = insertBySourceId(this.elements, sourceId, normalizedElements, 'before');
            if (!result.replaced) return false;
            this.elements.splice(0, this.elements.length, ...result.nextNodes);
            session.recordProfile('insertCalls', 1);
            return true;
        };
        const insertElementsAfter = (target: unknown, elements: Element[]) => {
            const liveInserted = this.insertLiveRelative(session, context, target, elements, 'after');
            if (liveInserted) {
                session.recordProfile('insertCalls', 1);
                return true;
            }
            const sourceId = this.resolveSourceId(target);
            if (!sourceId) return false;
            const normalizedElements = normalizeScriptElements(elements);
            const result = insertBySourceId(this.elements, sourceId, normalizedElements, 'after');
            if (!result.replaced) return false;
            this.elements.splice(0, this.elements.length, ...result.nextNodes);
            session.recordProfile('insertCalls', 1);
            return true;
        };
        const deleteElement = (target: unknown) => {
            const liveDeleted = this.deleteLiveActor(session, target);
            if (liveDeleted) {
                session.recordProfile('removeCalls', 1);
                return true;
            }
            const sourceId = this.resolveSourceId(target);
            if (!sourceId) return false;
            const result = deleteBySourceId(this.elements, sourceId);
            if (!result.replaced) return false;
            this.elements.splice(0, this.elements.length, ...result.nextNodes);
            session.recordProfile('removeCalls', 1);
            return true;
        };
        return {
            doc: docRef,
            self: docRef,
            sendMessage: (recipient: unknown, msg: unknown) => {
                const targetSourceId = this.resolveSourceId(recipient);
                if (!targetSourceId) return false;
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
            },
            element,
            elementsByType,
            replace,
            append,
            prepend,
            setContent,
            replaceElement,
            insertBefore: insertElementsBefore,
            insertAfter: insertElementsAfter,
            deleteElement,
            findElementByName: element,
            findElementsByType: elementsByType,
            insertElementsBefore,
            insertElementsAfter
        };
    }

    prepare(): void { }

    emitBoxes(): LayoutBox[] {
        return [];
    }

    getCommittedSignalSubscriptions(): readonly string[] {
        return ['pagination:finalized', createScriptMessageTopic(this.sourceId)];
    }

    consumeReplayRequested(): boolean {
        const value = this.replayRequested;
        this.replayRequested = false;
        return value;
    }

    updateCommittedState(context: PackagerContext): ObservationResult {
        const session = getCurrentLayoutSession(context);
        this.lastObservedPageIndex = Number.isFinite(context.pageIndex) ? Number(context.pageIndex) : this.lastObservedPageIndex;
        this.lastObservedActorIndex = Number.isFinite(context.actorIndex) ? Number(context.actorIndex) : this.lastObservedActorIndex;
        this.lastObservedCursorY = Number.isFinite(context.cursorY) ? Number(context.cursorY) : this.lastObservedCursorY;
        const globals = this.createGlobals(session, context);
        const beforeDigest = this.host.createDocumentDigest(this.elements);
        const beforeMutationVersion = this.lifecycleState.runtimeMutationVersion;
        const messageHandlerName = this.host.getDocumentHandlerName('onMessage');
        const messageSignals = messageHandlerName
            ? context.readActorSignals(createScriptMessageTopic(this.sourceId))
            : [];

        for (const signal of messageSignals) {
            const payload = signal.payload || {};
            const subject = typeof payload.subject === 'string'
                ? payload.subject
                : (typeof payload.name === 'string' ? payload.name : '');
            if (!subject || !messageHandlerName) continue;
            const from = typeof payload.from === 'string'
                ? { name: toPublicScriptName(payload.from) }
                : { name: 'doc', type: 'document' };
            this.host.runHandler(
                messageHandlerName,
                'onMessage',
                globals,
                {
                    from,
                    msg: {
                        subject,
                        payload: payload.payload
                    }
                },
                session
            );
        }

        const onReadyHandlerName = !this.lifecycleState.didReady
            ? this.host.getDocumentHandlerName('onReady')
            : null;
        const onRefreshHandlerName = this.lifecycleState.didReady
            ? this.host.getDocumentHandlerName('onRefresh')
            : null;
        const onDocumentChangedHandlerName = this.lifecycleState.didReady
            ? this.host.getDocumentHandlerName('onChanged')
            : null;
        if (!onReadyHandlerName && !onRefreshHandlerName && !onDocumentChangedHandlerName && !messageHandlerName) {
            return { changed: false, geometryChanged: false, updateKind: 'none' };
        }

        const finalizedSignals = context.readActorSignals('pagination:finalized');
        const latest = finalizedSignals[finalizedSignals.length - 1];
        if (!latest && !messageSignals.length) {
            return { changed: false, geometryChanged: false, updateKind: 'none' };
        }

        if (!this.lifecycleState.didReady) {
            if (onReadyHandlerName) {
                this.host.runHandler(onReadyHandlerName, 'onReady', globals, {}, session);
            }
            const afterDigest = this.host.createDocumentDigest(this.elements);
            const changed = beforeDigest !== afterDigest;
            this.lifecycleState.didReady = true;
            this.lifecycleState.lastSettledDigest = beforeDigest;
            this.lifecycleState.lastSettledRuntimeMutationVersion = beforeMutationVersion;
            if (this.pendingLiveStructuralChange) {
                this.pendingLiveStructuralChange = false;
                const frontier = this.pendingLiveFrontier || this.createDocumentFrontier();
                this.pendingLiveFrontier = null;
                return {
                    changed: true,
                    geometryChanged: true,
                    updateKind: 'geometry',
                    earliestAffectedFrontier: frontier
                };
            }
            if (changed) {
                this.requestReplay(session);
                return { changed: false, geometryChanged: false, updateKind: 'none' };
            }
            return { changed: false, geometryChanged: false, updateKind: 'none' };
        }

        const documentChanged =
            (this.lifecycleState.lastSettledDigest !== null && this.lifecycleState.lastSettledDigest !== beforeDigest)
            || this.lifecycleState.lastSettledRuntimeMutationVersion !== beforeMutationVersion;
        if (documentChanged && onDocumentChangedHandlerName) {
            this.host.runHandler(onDocumentChangedHandlerName, 'onChanged', globals, {}, session);
        }
        if (onRefreshHandlerName) {
            this.host.runHandler(onRefreshHandlerName, 'onRefresh', globals, {}, session);
        }
        const afterDigest = this.host.createDocumentDigest(this.elements);
        const changed = beforeDigest !== afterDigest;
        if (this.pendingLiveStructuralChange) {
            this.pendingLiveStructuralChange = false;
            const frontier = this.pendingLiveFrontier || this.createDocumentFrontier();
            this.pendingLiveFrontier = null;
            return {
                changed: true,
                geometryChanged: true,
                updateKind: 'geometry',
                earliestAffectedFrontier: frontier
            };
        }
        this.lifecycleState.lastSettledDigest = beforeDigest;
        this.lifecycleState.lastSettledRuntimeMutationVersion = beforeMutationVersion;
        if (changed) {
            this.requestReplay(session);
            return { changed: false, geometryChanged: false, updateKind: 'none' };
        }
        return { changed: false, geometryChanged: false, updateKind: 'none' };
    }

    split(): PackagerSplitResult {
        return { currentFragment: this, continuationFragment: null };
    }

    getRequiredHeight(): number {
        return 0;
    }

    isUnbreakable(): boolean {
        return true;
    }

    getMarginTop(): number {
        return 0;
    }

    getMarginBottom(): number {
        return 0;
    }
}
