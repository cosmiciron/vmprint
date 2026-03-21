import { performance } from 'node:perf_hooks';
import type { Element, LayoutScriptingConfig } from '../../types';
import type { Collaborator } from '../layout-session-types';
import type { LayoutSession } from '../layout-session';
import { simulationArtifactKeys } from '../simulation-report';
import type { HeadingOutlineEntry } from '../simulation-report';
import type { SourcePositionSummary } from './source-position-artifact-collaborator';

type ScriptHandler = (vm: ScriptVm) => void;

type ScriptVm = {
    readonly doc: {
        get(sourceId: string): Element | null;
        findByRole(role: string): Element[];
        findByType(type: string): Element[];
        setContent(sourceId: string, content: string): boolean;
        replace(sourceId: string, elements: Element[]): boolean;
    };
    readonly self?: {
        sourceId: string | null;
        type: string;
        role: string | null;
        setContent(content: string): boolean;
        replace(elements: Element[]): boolean;
    };
    readonly report?: {
        getHeadings(): HeadingOutlineEntry[];
        getSourcePositions(): SourcePositionSummary[];
    };
    requestReplay(): void;
};

type ReplaceResult =
    | { replaced: false }
    | { replaced: true; nextNodes: Element[] };

type ScriptPhase = 'beforeLayout' | 'resolve' | 'afterSettle';

function normalizeMethodSource(source: string | string[]): string {
    return Array.isArray(source) ? source.join('\n') : source;
}

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

function collectElements(elements: Element[]): Element[] {
    const collected: Element[] = [];
    visitElements(elements, (element) => {
        collected.push(element);
    });
    return collected;
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

export class ScriptRuntimeCollaborator implements Collaborator {
    private readonly handlers = new Map<string, ScriptHandler>();
    private replayRequested = false;

    constructor(
        private readonly scripting: LayoutScriptingConfig | undefined,
        private readonly elements: Element[]
    ) {
        for (const [methodName, methodSource] of Object.entries(scripting?.methods || {})) {
            const source = normalizeMethodSource(methodSource);
            this.handlers.set(methodName, new Function('vm', source) as ScriptHandler);
        }
    }

    private recordReplayRequest(session: LayoutSession): void {
        this.replayRequested = true;
        session.recordProfile('scriptReplayRequests', 1);
    }

    private runHandler(
        handlerName: string,
        phase: ScriptPhase,
        vm: ScriptVm,
        session: LayoutSession
    ): void {
        const handler = this.handlers.get(handlerName);
        if (!handler) {
            throw new Error(`[ScriptRuntimeCollaborator] Missing method "${handlerName}" for ${phase}.`);
        }

        const startedAt = performance.now();
        session.recordProfile('scriptHandlerCalls', 1);
        switch (phase) {
            case 'beforeLayout':
                session.recordProfile('scriptBeforeLayoutCalls', 1);
                break;
            case 'resolve':
                session.recordProfile('scriptResolveCalls', 1);
                break;
            case 'afterSettle':
                session.recordProfile('scriptAfterSettleCalls', 1);
                break;
        }

        handler(vm);

        const elapsed = performance.now() - startedAt;
        session.recordProfile('scriptHandlerMs', elapsed);
        switch (phase) {
            case 'beforeLayout':
                session.recordProfile('scriptBeforeLayoutMs', elapsed);
                break;
            case 'resolve':
                session.recordProfile('scriptResolveMs', elapsed);
                break;
            case 'afterSettle':
                session.recordProfile('scriptAfterSettleMs', elapsed);
                break;
        }
    }

    onSimulationStart(_session: LayoutSession): void {
        const session = _session;
        this.replayRequested = false;
        const createVm = (self?: Element): ScriptVm => ({
            doc: {
                get: (sourceId) => {
                    session.recordProfile('scriptDocQueryCalls', 1);
                    return findBySourceId(this.elements, sourceId);
                },
                findByRole: (role) => {
                    session.recordProfile('scriptDocQueryCalls', 1);
                    return findByRole(this.elements, role);
                },
                findByType: (type) => {
                    session.recordProfile('scriptDocQueryCalls', 1);
                    return findByType(this.elements, type);
                },
                setContent: (sourceId, content) => {
                    const node = findBySourceId(this.elements, sourceId);
                    if (!node) return false;
                    node.content = String(content);
                    session.recordProfile('scriptSetContentCalls', 1);
                    return true;
                },
                replace: (sourceId, elements) => {
                    const result = replaceBySourceId(this.elements, sourceId, elements);
                    if (!result.replaced) return false;
                    this.elements.splice(0, this.elements.length, ...result.nextNodes);
                    session.recordProfile('scriptReplaceCalls', 1);
                    return true;
                }
            },
            self: self ? {
                sourceId: typeof self.properties?.sourceId === 'string' ? self.properties.sourceId : null,
                type: String(self.type || ''),
                role: typeof self.properties?.semanticRole === 'string' ? self.properties.semanticRole : null,
                setContent: (content) => {
                    self.content = String(content);
                    session.recordProfile('scriptSetContentCalls', 1);
                    return true;
                },
                replace: (elements) => {
                    const sourceId = typeof self.properties?.sourceId === 'string' ? self.properties.sourceId : '';
                    if (!sourceId) return false;
                    const result = replaceBySourceId(this.elements, sourceId, elements);
                    if (!result.replaced) return false;
                    this.elements.splice(0, this.elements.length, ...result.nextNodes);
                    session.recordProfile('scriptReplaceCalls', 1);
                    return true;
                }
            } : undefined,
            requestReplay: () => {
                this.recordReplayRequest(session);
            }
        });

        const documentHandlerName = this.scripting?.onBeforeLayout;
        if (documentHandlerName) {
            this.runHandler(documentHandlerName, 'beforeLayout', createVm(), session);
        }

        for (const element of collectElements(this.elements)) {
            const handlerName = typeof element.properties?.onResolve === 'string'
                ? element.properties.onResolve
                : '';
            if (!handlerName) continue;
            this.runHandler(handlerName, 'resolve', createVm(element), session);
        }

        if (this.replayRequested) {
            // `onBeforeLayout` runs before any actors are formed, so a replay request
            // currently has no operational effect. Keep it as a supported no-op
            // signal to preserve the future-facing scripting contract.
        }
    }

    onSimulationComplete(session: LayoutSession): void {
        const handlerName = this.scripting?.onAfterSettle;
        if (!handlerName) return;

        const artifacts = session.buildSimulationArtifacts();
        const headings = (artifacts[simulationArtifactKeys.headingTelemetry] || []) as HeadingOutlineEntry[];
        const sourcePositions = (artifacts[simulationArtifactKeys.sourcePositionMap] || []) as SourcePositionSummary[];

        const vm: ScriptVm = {
            doc: {
                get: (sourceId) => {
                    session.recordProfile('scriptDocQueryCalls', 1);
                    return findBySourceId(this.elements, sourceId);
                },
                findByRole: (role) => {
                    session.recordProfile('scriptDocQueryCalls', 1);
                    return findByRole(this.elements, role);
                },
                findByType: (type) => {
                    session.recordProfile('scriptDocQueryCalls', 1);
                    return findByType(this.elements, type);
                },
                setContent: (sourceId, content) => {
                    const node = findBySourceId(this.elements, sourceId);
                    if (!node) return false;
                    node.content = String(content);
                    session.recordProfile('scriptSetContentCalls', 1);
                    return true;
                },
                replace: (sourceId, elements) => {
                    const result = replaceBySourceId(this.elements, sourceId, elements);
                    if (!result.replaced) return false;
                    this.elements.splice(0, this.elements.length, ...result.nextNodes);
                    session.recordProfile('scriptReplaceCalls', 1);
                    return true;
                }
            },
            report: {
                getHeadings: () => headings.map((entry) => ({ ...entry })),
                getSourcePositions: () => sourcePositions.map((entry) => ({
                    ...entry,
                    pageIndices: [...entry.pageIndices]
                }))
            },
            requestReplay: () => {
                this.recordReplayRequest(session);
            }
        };

        this.runHandler(handlerName, 'afterSettle', vm, session);
    }

    consumeReplayRequested(): boolean {
        const value = this.replayRequested;
        this.replayRequested = false;
        return value;
    }
}
