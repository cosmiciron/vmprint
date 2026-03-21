import { performance } from 'node:perf_hooks';
import type { Element, LayoutScriptingConfig } from '../types';
import type { LayoutSession } from './layout-session';

export type ScriptPhase = 'onLoad' | 'onCreate' | 'onReady' | 'onRefresh' | 'onDocumentChanged' | 'onMessage';

export type ScriptGlobals = {
    doc?: unknown;
    page?: unknown;
    self?: unknown;
    sendMessage?: unknown;
    findElementByName?: unknown;
    findElementsByRole?: unknown;
    findElementsByType?: unknown;
    setContent?: unknown;
    replaceElement?: unknown;
    insertElementsBefore?: unknown;
    insertElementsAfter?: unknown;
    deleteElement?: unknown;
};

type CompiledHandler = {
    name: string;
    declaredParams: string[];
    invoke: (...args: unknown[]) => void;
};

export type ScriptLifecycleState = {
    didLoad: boolean;
    didReady: boolean;
    createdElements: Set<string>;
    lastSettledDigest: string | null;
};

const GLOBAL_PARAM_ORDER = [
    'doc',
    'page',
    'self',
    'sendMessage',
    'findElementByName',
    'findElementsByRole',
    'findElementsByType',
    'setContent',
    'replaceElement',
    'insertElementsBefore',
    'insertElementsAfter',
    'deleteElement'
] as const;

function normalizeMethodSource(source: string | string[]): string {
    return Array.isArray(source) ? source.join('\n') : source;
}

function parseMethodDeclaration(rawDeclaration: string): { name: string; params: string[] } {
    const declaration = String(rawDeclaration || '').trim();
    const signatureMatch = declaration.match(/^([^(]+)\(([^)]*)\)$/);
    if (!signatureMatch) {
        return {
            name: declaration,
            params: []
        };
    }

    const [, rawName, rawParams] = signatureMatch;
    return {
        name: rawName.trim(),
        params: rawParams
            .split(',')
            .map((entry) => entry.trim())
            .filter(Boolean)
    };
}

function normalizeConventionTarget(value: string): string {
    const trimmed = String(value || '').trim();
    if (!trimmed) return '';
    const prefixMatch = trimmed.match(/^(author|auto|gen|system):(.*)$/);
    if (!prefixMatch) return trimmed;
    const [, prefix, remainder] = prefixMatch;
    if (prefix === 'system' && remainder === 'script-document') {
        return 'doc';
    }
    return remainder.trim();
}

export class ScriptRuntimeHost {
    private readonly handlers = new Map<string, CompiledHandler>();

    constructor(readonly scripting: LayoutScriptingConfig | undefined) {
        for (const [declaration, methodSource] of Object.entries(scripting?.methods || {})) {
            const parsed = parseMethodDeclaration(declaration);
            const source = normalizeMethodSource(methodSource);
            const paramNames = [...GLOBAL_PARAM_ORDER, ...parsed.params];
            this.handlers.set(parsed.name, {
                name: parsed.name,
                declaredParams: parsed.params,
                invoke: new Function(...paramNames, source) as (...args: unknown[]) => void
            });
        }
    }

    private buildConventionHandlerName(targetName: string, phase: ScriptPhase): string {
        return `${normalizeConventionTarget(targetName)}_${phase}`;
    }

    hasElementHandler(sourceId: string | null | undefined, phase: Exclude<ScriptPhase, 'onLoad' | 'onReady' | 'onRefresh' | 'onDocumentChanged'>): boolean {
        const normalized = normalizeConventionTarget(String(sourceId || ''));
        if (!normalized) return false;
        return this.handlers.has(this.buildConventionHandlerName(normalized, phase));
    }

    getElementHandlerName(
        sourceId: string | null | undefined,
        phase: Exclude<ScriptPhase, 'onLoad' | 'onReady' | 'onRefresh' | 'onDocumentChanged'>,
        explicitHandlerName?: string | null
    ): string | null {
        if (typeof explicitHandlerName === 'string' && explicitHandlerName.trim()) {
            return explicitHandlerName.trim();
        }
        const normalized = normalizeConventionTarget(String(sourceId || ''));
        if (!normalized) return null;
        const conventionName = this.buildConventionHandlerName(normalized, phase);
        return this.handlers.has(conventionName) ? conventionName : null;
    }

    getDocumentHandlerName(phase: Extract<ScriptPhase, 'onLoad' | 'onReady' | 'onRefresh' | 'onDocumentChanged'>): string | null {
        if (phase === 'onLoad' && typeof this.scripting?.onBeforeLayout === 'string' && this.scripting.onBeforeLayout.trim()) {
            return this.scripting.onBeforeLayout.trim();
        }
        if (phase === 'onReady' && typeof this.scripting?.onAfterSettle === 'string' && this.scripting.onAfterSettle.trim()) {
            return this.scripting.onAfterSettle.trim();
        }

        const conventionName = this.buildConventionHandlerName('doc', phase);
        return this.handlers.has(conventionName) ? conventionName : null;
    }

    hasDocumentAfterSettleHandler(): boolean {
        return this.getDocumentHandlerName('onReady') !== null
            || this.getDocumentHandlerName('onRefresh') !== null
            || this.getDocumentHandlerName('onDocumentChanged') !== null;
    }

    createLifecycleState(): ScriptLifecycleState {
        return {
            didLoad: false,
            didReady: false,
            createdElements: new Set<string>(),
            lastSettledDigest: null
        };
    }

    createDocumentDigest(elements: Element[]): string {
        return JSON.stringify(elements);
    }

    runHandler(
        handlerName: string,
        phase: ScriptPhase,
        globals: ScriptGlobals,
        eventParams: Record<string, unknown>,
        session: LayoutSession
    ): void {
        const handler = this.handlers.get(handlerName);
        if (!handler) {
            throw new Error(`[ScriptRuntimeHost] Missing method "${handlerName}" for ${phase}.`);
        }

        const startedAt = performance.now();
        session.recordProfile('handlerCalls', 1);
        switch (phase) {
            case 'onLoad':
                session.recordProfile('loadCalls', 1);
                break;
            case 'onCreate':
                session.recordProfile('createCalls', 1);
                break;
            case 'onReady':
                session.recordProfile('readyCalls', 1);
                break;
            case 'onRefresh':
                session.recordProfile('refreshCalls', 1);
                break;
            case 'onDocumentChanged':
                session.recordProfile('documentChangedCalls', 1);
                break;
            case 'onMessage':
                session.recordProfile('messageHandlerCalls', 1);
                break;
        }

        const args = [
            ...GLOBAL_PARAM_ORDER.map((name) => globals[name]),
            ...handler.declaredParams.map((name) => eventParams[name])
        ];
        handler.invoke(...args);

        const elapsed = performance.now() - startedAt;
        session.recordProfile('handlerMs', elapsed);
        switch (phase) {
            case 'onLoad':
                session.recordProfile('loadMs', elapsed);
                break;
            case 'onCreate':
                session.recordProfile('createMs', elapsed);
                break;
            case 'onReady':
                session.recordProfile('readyMs', elapsed);
                break;
            case 'onRefresh':
                session.recordProfile('refreshMs', elapsed);
                break;
            case 'onDocumentChanged':
                session.recordProfile('documentChangedMs', elapsed);
                break;
            case 'onMessage':
                break;
        }
    }
}
