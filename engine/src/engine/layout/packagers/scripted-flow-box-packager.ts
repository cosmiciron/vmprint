import type { Element } from '../../types';
import type { ActorSignal } from '../actor-event-bus';
import { HEADING_SIGNAL_TOPIC } from '../collaborators/heading-signal-collaborator';
import type { FlowBox } from '../layout-core-types';
import type { LayoutProcessor } from '../layout-core';
import type { LayoutSession } from '../layout-session';
import { LayoutUtils } from '../layout-utils';
import type { HeadingOutlineEntry } from '../simulation-report';
import { ScriptRuntimeHost, type ScriptGlobals } from '../script-runtime-host';
import { FlowBoxPackager } from './flow-box-packager';
import type { PackagerIdentity } from './packager-identity';
import { createFlowBoxPackagerIdentity } from './packager-identity';
import type {
    LayoutBox,
    ObservationResult,
    PackagerContext,
    PackagerPlacementPreference,
    PackagerSplitResult,
    PackagerTransformProfile,
    PackagerUnit
} from './packager-types';

type ScriptMessage = {
    name: string;
    payload?: unknown;
    from: string | null;
    to: string | null;
};

type FlowBoxShaper = {
    normalizeFlowBlock(element: Element, options: { path: number[] }): any;
    shapeNormalizedFlowBlock(block: any): FlowBox;
};

type ReplaceResult =
    | { replaced: false }
    | { replaced: true; nextNodes: Element[] };

type InsertPosition = 'before' | 'after';

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

function findByRole(elements: Element[], role: string): Element[] {
    const matches: Element[] = [];
    visitElements(elements, (element) => {
        if (String(element.properties?.semanticRole || '') === role) {
            matches.push(element);
        }
    });
    return matches;
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

function replaceBySourceId(nodes: Element[], sourceId: string, replacement: Element[]): ReplaceResult {
    let mutated = false;
    const nextNodes: Element[] = [];

    for (const node of nodes) {
        if (String(node.properties?.sourceId || '') === sourceId) {
            nextNodes.push(...cloneElementTree(replacement));
            mutated = true;
            continue;
        }

        const nextNode: Element = { ...node };
        if (Array.isArray(node.children) && node.children.length > 0) {
            const childResult = replaceBySourceId(node.children, sourceId, replacement);
            if (childResult.replaced) {
                nextNode.children = childResult.nextNodes;
                mutated = true;
            }
        }
        if (Array.isArray(node.zones) && node.zones.length > 0) {
            let zoneMutated = false;
            nextNode.zones = node.zones.map((zone) => {
                if (!Array.isArray(zone.elements) || zone.elements.length === 0) return zone;
                const zoneResult = replaceBySourceId(zone.elements, sourceId, replacement);
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
                const slotResult = replaceBySourceId(slot.elements, sourceId, replacement);
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

function insertBySourceId(
    nodes: Element[],
    sourceId: string,
    insertion: Element[],
    position: InsertPosition
): ReplaceResult {
    let mutated = false;
    const nextNodes: Element[] = [];

    for (const node of nodes) {
        if (String(node.properties?.sourceId || '') === sourceId) {
            if (position === 'before') {
                nextNodes.push(...cloneElementTree(insertion), node);
            } else {
                nextNodes.push(node, ...cloneElementTree(insertion));
            }
            mutated = true;
            continue;
        }

        const nextNode: Element = { ...node };
        if (Array.isArray(node.children) && node.children.length > 0) {
            const childResult = insertBySourceId(node.children, sourceId, insertion, position);
            if (childResult.replaced) {
                nextNode.children = childResult.nextNodes;
                mutated = true;
            }
        }
        if (Array.isArray(node.zones) && node.zones.length > 0) {
            let zoneMutated = false;
            nextNode.zones = node.zones.map((zone) => {
                if (!Array.isArray(zone.elements) || zone.elements.length === 0) return zone;
                const zoneResult = insertBySourceId(zone.elements, sourceId, insertion, position);
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
                const slotResult = insertBySourceId(slot.elements, sourceId, insertion, position);
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

function toHeadingOutlineEntry(signal: ActorSignal): HeadingOutlineEntry | null {
    const payload = signal.payload || {};
    const heading = typeof payload.heading === 'string' ? payload.heading.trim() : '';
    if (!heading) return null;
    return {
        sourceId: signal.publisherSourceId,
        heading,
        pageIndex: Math.max(0, Number(signal.pageIndex || 0)),
        y: Number.isFinite(payload.y) ? Number(payload.y) : 0,
        actorKind: signal.publisherActorKind,
        sourceType: typeof payload.sourceType === 'string' ? payload.sourceType : undefined,
        semanticRole: typeof payload.semanticRole === 'string' ? payload.semanticRole : undefined,
        level: Number.isFinite(payload.level) ? Number(payload.level) : undefined
    };
}

function buildHeadingSnapshot(context: PackagerContext): HeadingOutlineEntry[] {
    return context.readActorSignals(HEADING_SIGNAL_TOPIC)
        .map(toHeadingOutlineEntry)
        .filter((entry): entry is HeadingOutlineEntry => !!entry)
        .sort((a, b) => a.pageIndex - b.pageIndex || a.y - b.y || a.sourceId.localeCompare(b.sourceId));
}

function parseScriptMessage(signal: ActorSignal, targetSourceId: string): ScriptMessage | null {
    const payload = signal.payload || {};
    const name = typeof payload.name === 'string' ? payload.name : '';
    if (!name) return null;
    return {
        name,
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

    private publishScriptMessage(
        context: PackagerContext,
        recipient: unknown,
        msg: unknown
    ): boolean {
        const targetSourceId = this.resolveSourceId(recipient);
        if (!targetSourceId || targetSourceId === 'doc') return false;
        const session = getCurrentLayoutSession(context);
        const message = typeof msg === 'string'
            ? { name: msg }
            : (msg && typeof msg === 'object' ? { ...(msg as Record<string, unknown>) } : { name: String(msg) });
        if (typeof (message as Record<string, unknown>).name !== 'string' || !(message as Record<string, unknown>).name) {
            (message as Record<string, unknown>).name = 'message';
        }
        session.recordProfile('messageSendCalls', 1);
        context.publishActorSignal({
            topic: createScriptMessageTopic(targetSourceId),
            publisherActorId: this.actorId,
            publisherSourceId: this.sourceId,
            publisherActorKind: this.actorKind,
            fragmentIndex: this.fragmentIndex,
            pageIndex: context.pageIndex,
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
            role: typeof element.properties?.semanticRole === 'string' ? element.properties.semanticRole : null,
            get content() {
                return String(element.content || '');
            },
            setContent: (content: string) => {
                const nextContent = String(content);
                if (String(element.content || '') === nextContent) return false;
                element.content = nextContent;
                session.recordProfile('setContentCalls', 1);
                if (element === this.sourceElement) {
                    this.rebuildInner();
                }
                return true;
            },
            sendMessage
        };
    }

    private createDocRef(session: LayoutSession): Record<string, unknown> {
        return {
            name: 'doc',
            type: 'document',
            findElementByName: (name: string) => {
                session.recordProfile('docQueryCalls', 1);
                const node = findBySourceId(this.elements, name);
                return node ? this.createElementRef(session, node, () => false) : null;
            },
            findElementsByRole: (role: string) => {
                session.recordProfile('docQueryCalls', 1);
                return findByRole(this.elements, role).map((node) => this.createElementRef(session, node, () => false));
            },
            findElementsByType: (type: string) => {
                session.recordProfile('docQueryCalls', 1);
                return findByType(this.elements, type).map((node) => this.createElementRef(session, node, () => false));
            }
        };
    }

    private createGlobals(session: LayoutSession, context: PackagerContext): ScriptGlobals {
        const docRef = this.createDocRef(session);
        const findElementByName = (name: string) => {
            session.recordProfile('docQueryCalls', 1);
            const node = findBySourceId(this.elements, name);
            return node ? this.createElementRef(session, node, () => false) : null;
        };
        const findElementsByRole = (role: string) => {
            session.recordProfile('docQueryCalls', 1);
            return findByRole(this.elements, role).map((node) => this.createElementRef(session, node, () => false));
        };
        const findElementsByType = (type: string) => {
            session.recordProfile('docQueryCalls', 1);
            return findByType(this.elements, type).map((node) => this.createElementRef(session, node, () => false));
        };
        return {
            doc: docRef,
            page: undefined,
            self: this.createElementRef(session, this.sourceElement, (recipient, msg) => this.publishScriptMessage(context, recipient, msg)),
            sendMessage: (recipient: unknown, msg: unknown) => this.publishScriptMessage(context, recipient, msg),
            findElementByName,
            findElementsByRole,
            findElementsByType,
            setContent: (target: unknown, content: string) => {
                const sourceId = this.resolveSourceId(target);
                if (!sourceId || sourceId === 'doc') return false;
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
                const result = replaceBySourceId(this.elements, sourceId, elements);
                if (!result.replaced) return false;
                this.elements.splice(0, this.elements.length, ...result.nextNodes);
                session.recordProfile('replaceCalls', 1);
                return true;
            },
            insertElementsBefore: (target: unknown, elements: Element[]) => {
                const sourceId = this.resolveSourceId(target);
                if (!sourceId || sourceId === 'doc') return false;
                const result = insertBySourceId(this.elements, sourceId, elements, 'before');
                if (!result.replaced) return false;
                this.elements.splice(0, this.elements.length, ...result.nextNodes);
                session.recordProfile('insertCalls', 1);
                return true;
            },
            insertElementsAfter: (target: unknown, elements: Element[]) => {
                const sourceId = this.resolveSourceId(target);
                if (!sourceId || sourceId === 'doc') return false;
                const result = insertBySourceId(this.elements, sourceId, elements, 'after');
                if (!result.replaced) return false;
                this.elements.splice(0, this.elements.length, ...result.nextNodes);
                session.recordProfile('insertCalls', 1);
                return true;
            },
            deleteElement: (target: unknown) => {
                const sourceId = this.resolveSourceId(target);
                if (!sourceId || sourceId === 'doc') return false;
                const result = replaceBySourceId(this.elements, sourceId, []);
                if (!result.replaced) return false;
                this.elements.splice(0, this.elements.length, ...result.nextNodes);
                session.recordProfile('removeCalls', 1);
                return true;
            }
        };
    }

    prepare(availableWidth: number, availableHeight: number, context: PackagerContext): void {
        this.lastObservedPageIndex = context.pageIndex;
        this.lastObservedActorIndex = Number.isFinite(context.actorIndex) ? Number(context.actorIndex) : this.lastObservedActorIndex;
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
                    from: message.from ? { name: message.from } : { name: 'doc', type: 'document' },
                    msg: message
                },
                session
            );
            changed = changed || JSON.stringify(this.elements) !== beforeSnapshot;
            highestSequence = Math.max(highestSequence, signal.sequence);
        }

        this.lastHandledMessageSequence = highestSequence;
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
