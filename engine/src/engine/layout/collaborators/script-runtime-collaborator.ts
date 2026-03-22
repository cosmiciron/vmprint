import type { Element } from '../../types';
import type { Collaborator } from '../layout-session-types';
import type { LayoutSession } from '../layout-session';
import { ScriptRuntimeHost, type ScriptGlobals, type ScriptLifecycleState } from '../script-runtime-host';

type ScriptMessage = {
    subject: string;
    payload?: unknown;
    from: string | null;
    to: string | null;
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

function collectElements(elements: Element[]): Element[] {
    const collected: Element[] = [];
    visitElements(elements, (element) => {
        collected.push(element);
    });
    return collected;
}

function normalizeScriptElements(value: unknown): Element[] {
    if (Array.isArray(value)) return (value as Element[]).map((element) => normalizeRuntimeElement(element));
    if (value && typeof value === 'object') return [normalizeRuntimeElement(value as Element)];
    return [];
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

export class ScriptRuntimeCollaborator implements Collaborator {
    private replayRequested = false;

    constructor(
        readonly host: ScriptRuntimeHost,
        private readonly elements: Element[],
        private readonly lifecycleState: ScriptLifecycleState
    ) { }

    private recordReplayRequest(session: LayoutSession): void {
        this.replayRequested = true;
        session.recordProfile('replayRequests', 1);
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
        element: Element
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
                element.content = String(content);
                session.recordProfile('setContentCalls', 1);
                return true;
            },
            replace: (value: unknown) => {
                if (!sourceId) return false;
                const elements = normalizeScriptElements(value);
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
                const result = insertBySourceId(this.elements, sourceId, elements, 'before');
                if (!result.replaced) return false;
                this.elements.splice(0, this.elements.length, ...result.nextNodes);
                session.recordProfile('insertCalls', 1);
                return true;
            },
            replaceWith: (elements: Element[]) => {
                if (!sourceId) return false;
                const result = replaceBySourceId(this.elements, sourceId, elements);
                if (!result.replaced) return false;
                this.elements.splice(0, this.elements.length, ...result.nextNodes);
                session.recordProfile('replaceCalls', 1);
                return true;
            },
            sendMessage: (recipient: unknown, msg: unknown) => this.deliverMessage(recipient, msg, element, session)
        };
    }

    private createDocRef(session: LayoutSession): Record<string, unknown> {
        return {
            name: 'doc',
            type: 'document',
            vars: this.host.getScriptVars(),
            getPageCount: () => {
                session.recordProfile('docQueryCalls', 1);
                return 0;
            },
            findElementByName: (name: string) => {
                session.recordProfile('docQueryCalls', 1);
                const node = findBySourceId(this.elements, name);
                return node ? this.createElementRef(session, node) : null;
            },
            findElementsByType: (type: string) => {
                session.recordProfile('docQueryCalls', 1);
                return findByType(this.elements, type).map((node) => this.createElementRef(session, node));
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
            },
            replace: (value: unknown) => {
                const elements = normalizeScriptElements(value);
                this.elements.splice(0, this.elements.length, ...elements);
                session.recordProfile('replaceCalls', 1);
                return true;
            }
        };
    }

    private createGlobals(
        session: LayoutSession,
        options?: {
            self?: Element;
            message?: ScriptMessage;
        }
    ): ScriptGlobals {
        const self = options?.self;
        const docRef = this.createDocRef(session);
        const setContent = (target: unknown, content: string) => {
            const sourceId = this.resolveSourceId(target);
            if (!sourceId) return false;
            const node = findBySourceId(this.elements, sourceId);
            if (!node) return false;
            node.content = String(content);
            session.recordProfile('setContentCalls', 1);
            return true;
        };
        const replaceElement = (target: unknown, elements: Element[]) => {
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
            self: self ? this.createElementRef(session, self) : docRef,
            sendMessage: (recipient: unknown, msg: unknown) => this.deliverMessage(recipient, msg, self, session),
            element: (name: string) => {
                session.recordProfile('docQueryCalls', 1);
                const node = findBySourceId(this.elements, name);
                return node ? this.createElementRef(session, node) : null;
            },
            elementsByType: (type: string) => {
                session.recordProfile('docQueryCalls', 1);
                return findByType(this.elements, type).map((node) => this.createElementRef(session, node));
            },
            replace: (value: unknown) => {
                const elements = normalizeScriptElements(value);
                if (self) {
                    const sourceId = typeof self.properties?.sourceId === 'string' ? self.properties.sourceId : null;
                    if (!sourceId) return false;
                    const result = replaceBySourceId(this.elements, sourceId, elements);
                    if (!result.replaced) return false;
                    this.elements.splice(0, this.elements.length, ...result.nextNodes);
                } else {
                    this.elements.splice(0, this.elements.length, ...elements);
                }
                session.recordProfile('replaceCalls', 1);
                return true;
            },
            append: (value: unknown) => {
                const elements = normalizeScriptElements(value);
                if (elements.length === 0) return false;
                if (self) {
                    const sourceId = typeof self.properties?.sourceId === 'string' ? self.properties.sourceId : null;
                    if (!sourceId) return false;
                    const result = insertBySourceId(this.elements, sourceId, elements, 'after');
                    if (!result.replaced) return false;
                    this.elements.splice(0, this.elements.length, ...result.nextNodes);
                } else {
                    this.elements.push(...elements);
                }
                session.recordProfile('insertCalls', 1);
                return true;
            },
            prepend: (value: unknown) => {
                const elements = normalizeScriptElements(value);
                if (elements.length === 0) return false;
                if (self) {
                    const sourceId = typeof self.properties?.sourceId === 'string' ? self.properties.sourceId : null;
                    if (!sourceId) return false;
                    const result = insertBySourceId(this.elements, sourceId, elements, 'before');
                    if (!result.replaced) return false;
                    this.elements.splice(0, this.elements.length, ...result.nextNodes);
                } else {
                    this.elements.splice(0, 0, ...elements);
                }
                session.recordProfile('insertCalls', 1);
                return true;
            },
            setContent,
            replaceElement,
            insertBefore: insertElementsBefore,
            insertAfter: insertElementsAfter,
            deleteElement,
            findElementByName: (name: string) => {
                session.recordProfile('docQueryCalls', 1);
                const node = findBySourceId(this.elements, name);
                return node ? this.createElementRef(session, node) : null;
            },
            findElementsByType: (type: string) => {
                session.recordProfile('docQueryCalls', 1);
                return findByType(this.elements, type).map((node) => this.createElementRef(session, node));
            },
            insertElementsBefore,
            insertElementsAfter
        };
    }

    private deliverMessage(
        recipient: unknown,
        msg: unknown,
        sender: Element | undefined,
        session: LayoutSession
    ): boolean {
        const targetSourceId = this.resolveSourceId(recipient);
        if (!targetSourceId) return false;
        if (targetSourceId === 'doc') {
            const handlerName = this.host.getDocumentHandlerName('onMessage');
            if (!handlerName) return false;
            const message = typeof msg === 'string'
                ? { subject: msg }
                : (msg && typeof msg === 'object' ? { ...(msg as Record<string, unknown>) } : { subject: String(msg) });
            if (typeof (message as Record<string, unknown>).subject !== 'string' || !(message as Record<string, unknown>).subject) {
                const legacyName = (message as Record<string, unknown>).name;
                (message as Record<string, unknown>).subject =
                    typeof legacyName === 'string' && legacyName ? legacyName : 'message';
            }
            delete (message as Record<string, unknown>).name;
            const globals = this.createGlobals(session);
            const fromRef = sender ? this.createElementRef(session, sender) : { name: 'doc', type: 'document' };
            session.recordProfile('messageSendCalls', 1);
            this.host.runHandler(handlerName, 'onMessage', globals, { from: fromRef, msg: message }, session);
            return true;
        }
        const target = findBySourceId(this.elements, targetSourceId);
        if (!target) return false;
        const explicitHandlerName = typeof target.properties?.onMessage === 'string'
            ? target.properties.onMessage
            : null;
        const handlerName = this.host.getElementHandlerName(targetSourceId, 'onMessage', explicitHandlerName);
        if (!handlerName) return false;

        const senderSourceId = typeof sender?.properties?.sourceId === 'string'
            ? sender.properties.sourceId
            : null;
        const message = typeof msg === 'string'
            ? { subject: msg }
            : (msg && typeof msg === 'object' ? { ...(msg as Record<string, unknown>) } : { subject: String(msg) });
        if (typeof (message as Record<string, unknown>).subject !== 'string' || !(message as Record<string, unknown>).subject) {
            const legacyName = (message as Record<string, unknown>).name;
            (message as Record<string, unknown>).subject =
                typeof legacyName === 'string' && legacyName ? legacyName : 'message';
        }
        delete (message as Record<string, unknown>).name;
        const globals = this.createGlobals(session, {
            self: target,
        });
        const fromRef = sender ? this.createElementRef(session, sender) : { name: 'doc', type: 'document' };

        session.recordProfile('messageSendCalls', 1);
        this.host.runHandler(
            handlerName,
            'onMessage',
            globals,
            {
                from: fromRef,
                msg: message
            },
            session
        );
        return true;
    }

    onSimulationStart(session: LayoutSession): void {
        this.replayRequested = false;
        const documentHandlerName = !this.lifecycleState.didLoad
            ? this.host.getDocumentHandlerName('onLoad')
            : null;
        if (documentHandlerName) {
            this.host.runHandler(documentHandlerName, 'onLoad', this.createGlobals(session), {}, session);
            this.lifecycleState.didLoad = true;
        }

        for (const element of collectElements(this.elements)) {
            const sourceId = typeof element.properties?.sourceId === 'string' ? element.properties.sourceId : null;
            if (!sourceId || this.lifecycleState.createdElements.has(sourceId)) continue;
            const explicitHandlerName = typeof element.properties?.onResolve === 'string'
                ? element.properties.onResolve
                : null;
            const handlerName = this.host.getElementHandlerName(sourceId, 'onCreate', explicitHandlerName);
            if (handlerName) {
                this.host.runHandler(handlerName, 'onCreate', this.createGlobals(session, { self: element }), {}, session);
            }
            this.lifecycleState.createdElements.add(sourceId);
        }
    }

    consumeReplayRequested(): boolean {
        const value = this.replayRequested;
        this.replayRequested = false;
        return value;
    }
}
