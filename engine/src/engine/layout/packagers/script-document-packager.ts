import type { Element } from '../../types';
import type { LayoutProcessor } from '../layout-core';
import type { LayoutSession } from '../layout-session';
import { LayoutUtils } from '../layout-utils';
import { ScriptRuntimeHost, type ScriptGlobals, type ScriptLifecycleState } from '../script-runtime-host';
import type {
    LayoutBox,
    ObservationResult,
    PackagerContext,
    PackagerSplitResult,
    PackagerUnit
} from './packager-types';

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
        throw new Error('[ScriptDocumentPackager] No active layout session.');
    }
    return session;
}

function createScriptMessageTopic(sourceId: string): string {
    const normalizedSourceId = LayoutUtils.normalizeAuthorSourceId(sourceId) || String(sourceId || '').trim();
    return `script:message:${normalizedSourceId}`;
}

export class ScriptDocumentPackager implements PackagerUnit {
    readonly actorId = 'actor:system:script-document:script-document:0';
    readonly sourceId = 'system:script-document';
    readonly actorKind = 'script-document';
    readonly fragmentIndex = 0;
    private replayRequested = false;

    constructor(
        private readonly host: ScriptRuntimeHost,
        private readonly elements: Element[],
        private readonly lifecycleState: ScriptLifecycleState
    ) { }

    private createDocumentFrontier() {
        return {
            pageIndex: 0,
            actorIndex: 0,
            actorId: this.actorId,
            sourceId: this.sourceId
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

    private createElementRef(element: Element): Record<string, unknown> {
        return {
            name: typeof element.properties?.sourceId === 'string' ? element.properties.sourceId : null,
            type: String(element.type || ''),
            role: typeof element.properties?.semanticRole === 'string' ? element.properties.semanticRole : null,
            get content() {
                return String(element.content || '');
            }
        };
    }

    private createDocRef(session: LayoutSession, context?: PackagerContext): Record<string, unknown> {
        return {
            name: 'doc',
            type: 'document',
            findElementByName: (name: string) => {
                session.recordProfile('docQueryCalls', 1);
                const node = findBySourceId(this.elements, name);
                return node ? this.createElementRef(node) : null;
            },
            findElementsByRole: (role: string) => {
                session.recordProfile('docQueryCalls', 1);
                return findByRole(this.elements, role).map((node) => this.createElementRef(node));
            },
            findElementsByType: (type: string) => {
                session.recordProfile('docQueryCalls', 1);
                return findByType(this.elements, type).map((node) => this.createElementRef(node));
            },
            getPageCount: () => {
                session.recordProfile('docQueryCalls', 1);
                if (!context) return 0;
                const finalizedSignals = context.readActorSignals('pagination:finalized');
                const latest = finalizedSignals[finalizedSignals.length - 1];
                const total = latest?.payload?.totalPageCount;
                return Number.isFinite(total) ? Number(total) : 0;
            }
        };
    }

    private createGlobals(session: LayoutSession, context: PackagerContext): ScriptGlobals {
        const docRef = this.createDocRef(session, context);
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
            const result = replaceBySourceId(this.elements, sourceId, elements);
            if (!result.replaced) return false;
            this.elements.splice(0, this.elements.length, ...result.nextNodes);
            session.recordProfile('replaceCalls', 1);
            return true;
        };
        const insertElementsBefore = (target: unknown, elements: Element[]) => {
            const sourceId = this.resolveSourceId(target);
            if (!sourceId) return false;
            const result = insertBySourceId(this.elements, sourceId, elements, 'before');
            if (!result.replaced) return false;
            this.elements.splice(0, this.elements.length, ...result.nextNodes);
            session.recordProfile('insertCalls', 1);
            return true;
        };
        const insertElementsAfter = (target: unknown, elements: Element[]) => {
            const sourceId = this.resolveSourceId(target);
            if (!sourceId) return false;
            const result = insertBySourceId(this.elements, sourceId, elements, 'after');
            if (!result.replaced) return false;
            this.elements.splice(0, this.elements.length, ...result.nextNodes);
            session.recordProfile('insertCalls', 1);
            return true;
        };
        const deleteElement = (target: unknown) => {
            const sourceId = this.resolveSourceId(target);
            if (!sourceId) return false;
            const result = replaceBySourceId(this.elements, sourceId, []);
            if (!result.replaced) return false;
            this.elements.splice(0, this.elements.length, ...result.nextNodes);
            session.recordProfile('removeCalls', 1);
            return true;
        };
        return {
            doc: docRef,
            page: undefined,
            self: docRef,
            sendMessage: (recipient: unknown, msg: unknown) => {
                const targetSourceId = this.resolveSourceId(recipient);
                if (!targetSourceId || targetSourceId === 'doc') return false;
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
                    payload: {
                        ...message,
                        from: this.sourceId,
                        to: targetSourceId
                    }
                });
                return true;
            },
            findElementByName: (name: string) => {
                session.recordProfile('docQueryCalls', 1);
                const node = findBySourceId(this.elements, name);
                return node ? this.createElementRef(node) : null;
            },
            findElementsByRole: (role: string) => {
                session.recordProfile('docQueryCalls', 1);
                return findByRole(this.elements, role).map((node) => this.createElementRef(node));
            },
            findElementsByType: (type: string) => {
                session.recordProfile('docQueryCalls', 1);
                return findByType(this.elements, type).map((node) => this.createElementRef(node));
            },
            setContent,
            replaceElement,
            insertElementsBefore,
            insertElementsAfter,
            deleteElement
        };
    }

    prepare(): void { }

    emitBoxes(): LayoutBox[] {
        return [];
    }

    getCommittedSignalSubscriptions(): readonly string[] {
        return ['pagination:finalized'];
    }

    consumeReplayRequested(): boolean {
        const value = this.replayRequested;
        this.replayRequested = false;
        return value;
    }

    updateCommittedState(context: PackagerContext): ObservationResult {
        const onReadyHandlerName = !this.lifecycleState.didReady
            ? this.host.getDocumentHandlerName('onReady')
            : null;
        const onRefreshHandlerName = this.lifecycleState.didReady
            ? this.host.getDocumentHandlerName('onRefresh')
            : null;
        const onDocumentChangedHandlerName = this.lifecycleState.didReady
            ? this.host.getDocumentHandlerName('onDocumentChanged')
            : null;
        if (!onReadyHandlerName && !onRefreshHandlerName && !onDocumentChangedHandlerName) {
            return { changed: false, geometryChanged: false, updateKind: 'none' };
        }

        const finalizedSignals = context.readActorSignals('pagination:finalized');
        const latest = finalizedSignals[finalizedSignals.length - 1];
        if (!latest) {
            return { changed: false, geometryChanged: false, updateKind: 'none' };
        }

        const session = getCurrentLayoutSession(context);
        const globals = this.createGlobals(session, context);
        const beforeDigest = this.host.createDocumentDigest(this.elements);

        if (!this.lifecycleState.didReady) {
            if (onReadyHandlerName) {
                this.host.runHandler(onReadyHandlerName, 'onReady', globals, {}, session);
            }
            const afterDigest = this.host.createDocumentDigest(this.elements);
            const changed = beforeDigest !== afterDigest;
            this.lifecycleState.didReady = true;
            this.lifecycleState.lastSettledDigest = beforeDigest;
            return changed
                ? {
                    changed: true,
                    geometryChanged: true,
                    updateKind: 'geometry',
                    earliestAffectedFrontier: this.createDocumentFrontier()
                }
                : { changed: false, geometryChanged: false, updateKind: 'none' };
        }

        const documentChanged = this.lifecycleState.lastSettledDigest !== null && this.lifecycleState.lastSettledDigest !== beforeDigest;
        if (documentChanged && onDocumentChangedHandlerName) {
            this.host.runHandler(onDocumentChangedHandlerName, 'onDocumentChanged', globals, {}, session);
        }
        if (onRefreshHandlerName) {
            this.host.runHandler(onRefreshHandlerName, 'onRefresh', globals, {}, session);
        }
        const afterDigest = this.host.createDocumentDigest(this.elements);
        const changed = beforeDigest !== afterDigest;
        this.lifecycleState.lastSettledDigest = beforeDigest;
        return changed
            ? {
                changed: true,
                geometryChanged: true,
                updateKind: 'geometry',
                earliestAffectedFrontier: this.createDocumentFrontier()
            }
            : { changed: false, geometryChanged: false, updateKind: 'none' };
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
