import { performance } from 'node:perf_hooks';
import type { Element, LayoutScriptingConfig } from '../types';
import type { LayoutSession } from './layout-session';

export type ScriptPhase = 'onLoad' | 'onCreate' | 'onReady' | 'onRefresh' | 'onChanged' | 'onMessage';

export type ScriptGlobals = {
    doc?: unknown;
    self?: unknown;
    element?: unknown;
    elementsByType?: unknown;
    sendMessage?: unknown;
    setContent?: unknown;
    append?: unknown;
    prepend?: unknown;
    replaceElement?: unknown;
    insertBefore?: unknown;
    insertAfter?: unknown;
    deleteElement?: unknown;
    findElementByName?: unknown;
    findElementsByType?: unknown;
    insertElementsBefore?: unknown;
    insertElementsAfter?: unknown;
};

type CompiledHandler = {
    name: string;
    declaredParams: string[];
    injectedVarNames: string[];
    invoke: (...args: unknown[]) => void;
};

export type ScriptLifecycleState = {
    didLoad: boolean;
    didReady: boolean;
    createdElements: Set<string>;
    lastSettledDigest: string | null;
};

const RESERVED_GLOBAL_NAMES = [
    'doc',
    'self',
    'element',
    'elementsByType',
    'sendMessage',
    'setContent',
    'append',
    'prepend',
    'replaceElement',
    'insertBefore',
    'insertAfter',
    'deleteElement',
    'findElementByName',
    'findElementsByType',
    'insertElementsBefore',
    'insertElementsAfter'
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

function isValidIdentifier(name: string): boolean {
    return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name);
}

function dedupeNames(names: string[]): string[] {
    const seen = new Set<string>();
    const ordered: string[] = [];
    for (const name of names) {
        if (!name || seen.has(name)) continue;
        seen.add(name);
        ordered.push(name);
    }
    return ordered;
}

export class ScriptRuntimeHost {
    private readonly handlers = new Map<string, CompiledHandler>();
    private readonly scriptVars: Record<string, unknown>;
    private readonly injectedVarNames: string[];

    constructor(readonly scripting: LayoutScriptingConfig | undefined) {
        this.scriptVars = { ...(scripting?.vars || {}) };
        this.injectedVarNames = Object.keys(this.scriptVars).filter((name) => {
            if (!isValidIdentifier(name)) return false;
            return !RESERVED_GLOBAL_NAMES.includes(name as any);
        });

        for (const [declaration, methodSource] of Object.entries(scripting?.methods || {})) {
            const parsed = parseMethodDeclaration(declaration);
            const source = normalizeMethodSource(methodSource);
            const orderedParams = dedupeNames([
                ...RESERVED_GLOBAL_NAMES,
                ...this.injectedVarNames,
                ...parsed.params
            ]);
            this.handlers.set(parsed.name, {
                name: parsed.name,
                declaredParams: parsed.params,
                injectedVarNames: this.injectedVarNames,
                invoke: new Function(...orderedParams, `"use strict";\n${source}`) as (...args: unknown[]) => void
            });
        }
    }

    getScriptVars(): Record<string, unknown> {
        return this.scriptVars;
    }

    private buildConventionHandlerName(targetName: string, phase: Exclude<ScriptPhase, 'onLoad' | 'onReady' | 'onRefresh'>): string {
        return `${normalizeConventionTarget(targetName)}_${phase}`;
    }

    hasElementHandler(sourceId: string | null | undefined, phase: Exclude<ScriptPhase, 'onLoad' | 'onReady' | 'onRefresh'>): boolean {
        const normalized = normalizeConventionTarget(String(sourceId || ''));
        if (!normalized) return false;
        return this.handlers.has(this.buildConventionHandlerName(normalized, phase));
    }

    getElementHandlerName(
        sourceId: string | null | undefined,
        phase: Exclude<ScriptPhase, 'onLoad' | 'onReady' | 'onRefresh'>,
        explicitHandlerName?: string | null
    ): string | null {
        if (typeof explicitHandlerName === 'string' && explicitHandlerName.trim()) {
            return explicitHandlerName.trim();
        }
        const normalized = normalizeConventionTarget(String(sourceId || ''));
        if (!normalized) return null;
        const conventionName = `${normalized}_${phase}`;
        if (this.handlers.has(conventionName)) return conventionName;
        if (phase === 'onChanged') {
            const legacyName = `${normalized}_onDocumentChanged`;
            return this.handlers.has(legacyName) ? legacyName : null;
        }
        return null;
    }

    getDocumentHandlerName(phase: Extract<ScriptPhase, 'onLoad' | 'onReady' | 'onRefresh' | 'onChanged' | 'onMessage'>): string | null {
        if (phase === 'onLoad' && typeof this.scripting?.onBeforeLayout === 'string' && this.scripting.onBeforeLayout.trim()) {
            return this.scripting.onBeforeLayout.trim();
        }
        if (phase === 'onReady' && typeof this.scripting?.onAfterSettle === 'string' && this.scripting.onAfterSettle.trim()) {
            return this.scripting.onAfterSettle.trim();
        }

        const primaryName = phase;
        if (this.handlers.has(primaryName)) return primaryName;

        const legacyName = phase === 'onChanged'
            ? 'doc_onDocumentChanged'
            : `doc_${phase}`;
        return this.handlers.has(legacyName) ? legacyName : null;
    }

    hasDocumentAfterSettleHandler(): boolean {
        return this.getDocumentHandlerName('onReady') !== null
            || this.getDocumentHandlerName('onRefresh') !== null
            || this.getDocumentHandlerName('onChanged') !== null
            || this.getDocumentHandlerName('onMessage') !== null;
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
            case 'onChanged':
                session.recordProfile('documentChangedCalls', 1);
                break;
            case 'onMessage':
                session.recordProfile('messageHandlerCalls', 1);
                break;
        }

        const orderedArgs = dedupeNames([
            ...RESERVED_GLOBAL_NAMES,
            ...handler.injectedVarNames,
            ...handler.declaredParams
        ]).map((name) => {
            if ((RESERVED_GLOBAL_NAMES as readonly string[]).includes(name)) {
                return globals[name as keyof ScriptGlobals];
            }
            if (handler.injectedVarNames.includes(name)) {
                return this.scriptVars[name];
            }
            return eventParams[name];
        });

        handler.invoke(...orderedArgs);

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
            case 'onChanged':
                session.recordProfile('documentChangedMs', elapsed);
                break;
            case 'onMessage':
                break;
        }
    }
}
