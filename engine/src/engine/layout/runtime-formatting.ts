import { Element } from '../types';
import { LayoutUtils } from './layout-utils';
import {
    ObservationResult,
    PackagerContext,
    PackagerUnit,
    resolvePackagerWorldYAtCursor
} from './packagers/packager-types';

export const RUNTIME_INTENT_TOPIC = 'runtime:intent';

export type RuntimeFormattingPatch = {
    color?: unknown;
    backgroundColor?: unknown;
    borderColor?: unknown;
    textAlign?: unknown;
    fontFamily?: unknown;
    fontSize?: unknown;
    fontWeight?: unknown;
    fontStyle?: unknown;
    lineHeight?: unknown;
    marginLeft?: unknown;
    marginRight?: unknown;
    textIndent?: unknown;
    padding?: unknown;
    paddingTop?: unknown;
    paddingRight?: unknown;
    paddingBottom?: unknown;
    paddingLeft?: unknown;
};

export type RuntimeFormattingTarget = {
    sourceId?: unknown;
    containerKey?: unknown;
    boxTargetId?: unknown;
    actorId?: unknown;
    sourceStart?: unknown;
    sourceEnd?: unknown;
};

type RuntimeFormattingSignal = {
    sequence?: unknown;
    payload?: {
        kind?: unknown;
        target?: Record<string, unknown>;
        patch?: Record<string, unknown>;
        restoreSnapshot?: Record<string, unknown>;
    };
};

export function normalizeRuntimeIntentSourceId(sourceId: unknown): string {
    const raw = String(sourceId || '').trim();
    return LayoutUtils.normalizeAuthorSourceId(raw) || raw;
}

export function buildRuntimeIntentTopic(sourceId: unknown): string {
    const normalized = normalizeRuntimeIntentSourceId(sourceId);
    return normalized ? `${RUNTIME_INTENT_TOPIC}:${normalized}` : RUNTIME_INTENT_TOPIC;
}

export function isRuntimeRangeTarget(target: RuntimeFormattingTarget | Record<string, unknown> = {}): boolean {
    const start = Number(target.sourceStart);
    const end = Number(target.sourceEnd);
    return Number.isFinite(start) && Number.isFinite(end) && end > start;
}

export function normalizeRuntimeFormattingPatch(patch: RuntimeFormattingPatch = {}): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const key of ['color', 'backgroundColor', 'borderColor'] as const) {
        if (typeof patch[key] === 'string' && patch[key]!.trim()) {
            out[key] = patch[key]!.trim();
        }
    }
    if (['left', 'center', 'right', 'justify'].includes(String(patch.textAlign))) {
        out.textAlign = String(patch.textAlign);
        if (patch.textAlign === 'justify') {
            out.justifyEngine = 'advanced';
        }
    }
    if (typeof patch.fontFamily === 'string' && patch.fontFamily.trim()) {
        out.fontFamily = patch.fontFamily.trim();
    }
    for (const key of ['fontSize', 'fontWeight', 'lineHeight', 'marginLeft', 'marginRight', 'textIndent', 'padding', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft'] as const) {
        if (Number.isFinite(Number(patch[key]))) {
            out[key] = Number(patch[key]);
        }
    }
    if (typeof patch.fontStyle === 'string' && patch.fontStyle.trim()) {
        out.fontStyle = patch.fontStyle.trim();
    }
    return out;
}

export function cloneRuntimeJsonValue<T>(value: T): T {
    if (value === undefined) return value;
    return JSON.parse(JSON.stringify(value));
}

function cloneRuntimeElementPart(part: unknown): any {
    if (!part || typeof part !== 'object') return part;
    return cloneRuntimeJsonValue(part);
}

export function cloneRuntimeElementSourceSnapshot(element: Element): Record<string, unknown> {
    const snapshot: Record<string, unknown> = {};
    for (const key of ['type', 'content', 'children', 'properties'] as const) {
        if (Object.prototype.hasOwnProperty.call(element || {}, key)) {
            snapshot[key] = cloneRuntimeJsonValue((element as any)[key]);
        }
    }
    return snapshot;
}

export function restoreRuntimeElementSourceSnapshot(element: Element, snapshot: Record<string, unknown> = {}): boolean {
    if (!element || typeof element !== 'object') return false;
    for (const key of ['type', 'content', 'children', 'properties'] as const) {
        if (Object.prototype.hasOwnProperty.call(snapshot, key)) {
            (element as any)[key] = cloneRuntimeJsonValue(snapshot[key]);
        } else {
            delete (element as any)[key];
        }
    }
    return true;
}

export function runtimeElementSourceSnapshotsEqual(
    left: Record<string, unknown> = {},
    right: Record<string, unknown> = {}
): boolean {
    return JSON.stringify(left || {}) === JSON.stringify(right || {});
}

function runtimeInlinePartLength(part: any): number {
    if (typeof part?.content === 'string' && part.content.length > 0) return part.content.length;
    if (part?.image || part?.inlineObject || part?.type === 'image') return 1;
    if (Array.isArray(part?.children)) {
        return part.children.reduce((sum: number, child: any) => sum + runtimeInlinePartLength(child), 0);
    }
    return 0;
}

function stylesEqualForRuntimeMerge(left: Record<string, unknown> = {}, right: Record<string, unknown> = {}): boolean {
    const leftKeys = Object.keys(left || {});
    const rightKeys = Object.keys(right || {});
    if (leftKeys.length !== rightKeys.length) return false;
    return leftKeys.every((key) => left[key] === right[key]);
}

function mergeAdjacentRuntimeTextParts(parts: any[]): any[] {
    const out: any[] = [];
    for (const part of parts) {
        const previous = out[out.length - 1];
        const partStyle = part?.properties?.style || {};
        const previousStyle = previous?.properties?.style || {};
        if (
            previous
            && previous.type === 'text'
            && part?.type === 'text'
            && !previous.children
            && !part.children
            && stylesEqualForRuntimeMerge(previousStyle, partStyle)
        ) {
            previous.content = `${previous.content || ''}${part.content || ''}`;
            continue;
        }
        out.push(part);
    }
    return out;
}

function runtimePartStyleChanged(previousStyle: Record<string, unknown> = {}, patch: Record<string, unknown>): boolean {
    return Object.entries(patch).some(([key, value]) => previousStyle[key] !== value);
}

function cloneRuntimePartWithContent(part: any, content: string): any {
    const out = cloneRuntimeElementPart(part);
    out.content = content;
    if (Array.isArray(out.children)) {
        delete out.children;
    }
    return out;
}

function applyRuntimePatchToWholePart(part: any, patch: Record<string, unknown>): { part: any; changed: boolean } {
    const previousStyle = part.properties && typeof part.properties.style === 'object' && part.properties.style
        ? part.properties.style
        : {};
    return {
        part: {
            ...cloneRuntimeElementPart(part),
            properties: {
                ...part.properties,
                style: {
                    ...previousStyle,
                    ...patch
                }
            }
        },
        changed: runtimePartStyleChanged(previousStyle, patch)
    };
}

function formatRuntimePartRange(
    part: any,
    patch: Record<string, unknown>,
    start: number,
    end: number
): { parts: any[]; length: number; changed: boolean } {
    const length = runtimeInlinePartLength(part);
    if (!length || end <= 0 || start >= length) {
        return { parts: [cloneRuntimeElementPart(part)], length, changed: false };
    }

    if (Array.isArray(part?.children) && !(typeof part?.content === 'string' && part.content.length > 0)) {
        const nextChildren: any[] = [];
        let cursor = 0;
        let changed = false;
        for (const child of part.children) {
            const childLength = runtimeInlinePartLength(child);
            const result = formatRuntimePartRange(child, patch, start - cursor, end - cursor);
            nextChildren.push(...result.parts);
            changed = changed || result.changed;
            cursor += childLength;
        }
        const nextPart = {
            ...cloneRuntimeElementPart(part),
            content: typeof part?.content === 'string' ? part.content : '',
            children: mergeAdjacentRuntimeTextParts(nextChildren)
        };
        return { parts: [nextPart], length, changed };
    }

    if (typeof part?.content === 'string' && part.content.length > 0) {
        const localStart = Math.max(0, start);
        const localEnd = Math.min(part.content.length, end);
        const parts: any[] = [];
        let changed = false;
        if (localStart > 0) {
            parts.push(cloneRuntimePartWithContent(part, part.content.slice(0, localStart)));
        }

        const middle = cloneRuntimePartWithContent(part, part.content.slice(localStart, localEnd));
        const applied = applyRuntimePatchToWholePart(middle, patch);
        parts.push(applied.part);
        changed = changed || applied.changed;

        if (localEnd < part.content.length) {
            parts.push(cloneRuntimePartWithContent(part, part.content.slice(localEnd)));
        }
        return { parts, length, changed };
    }

    if (part?.image || part?.inlineObject || part?.type === 'image') {
        const applied = applyRuntimePatchToWholePart(part, patch);
        return { parts: [applied.part], length, changed: applied.changed };
    }

    return { parts: [cloneRuntimeElementPart(part)], length, changed: false };
}

export function applyRuntimeRangeFormattingPatch(
    sourceElement: Element,
    patch: Record<string, unknown>,
    target: RuntimeFormattingTarget | Record<string, unknown>
): boolean {
    const start = Math.max(0, Number(target.sourceStart));
    const end = Math.max(start, Number(target.sourceEnd));
    const sourceParts = Array.isArray(sourceElement.children) && sourceElement.children.length
        ? sourceElement.children
        : typeof sourceElement.content === 'string' && sourceElement.content.length
            ? [{ type: 'text', content: sourceElement.content }]
            : [];
    if (!sourceParts.length) return false;

    const nextChildren: any[] = [];
    let cursor = 0;
    let changed = false;
    for (const sourcePart of sourceParts) {
        const length = runtimeInlinePartLength(sourcePart);
        const partStart = cursor;
        const partEnd = cursor + length;
        cursor = partEnd;
        if (!length || partEnd <= start || partStart >= end) {
            nextChildren.push(cloneRuntimeElementPart(sourcePart));
            continue;
        }

        const result = formatRuntimePartRange(sourcePart, patch, start - partStart, end - partStart);
        nextChildren.push(...result.parts);
        changed = changed || result.changed;
    }

    if (!changed) return false;
    sourceElement.content = '';
    sourceElement.children = mergeAdjacentRuntimeTextParts(nextChildren) as Element[];
    return true;
}

export function isGeometryRuntimeFormattingPatch(
    patch: Record<string, unknown>,
    target: RuntimeFormattingTarget | Record<string, unknown> | null = null
): boolean {
    const geometryKeys = ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight', 'marginLeft', 'marginRight', 'textIndent', 'padding', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'blockType'];
    if (target && isRuntimeRangeTarget(target)) {
        return geometryKeys.some((key) => patch[key] !== undefined);
    }
    return geometryKeys.some((key) => patch[key] !== undefined);
}

export function readLatestRuntimeFormattingIntentSignal(
    context: PackagerContext,
    actor: Pick<PackagerUnit, 'actorId' | 'sourceId'>
): RuntimeFormattingSignal | null {
    const actorSourceId = normalizeRuntimeIntentSourceId(actor?.sourceId);
    const topic = buildRuntimeIntentTopic(actorSourceId);
    const signals = [
        ...(context.readActorSignals?.(topic) ?? []),
        ...(context.readActorSignals?.(RUNTIME_INTENT_TOPIC) ?? [])
    ] as RuntimeFormattingSignal[];
    return signals
        .filter((signal) => {
            const payload = signal?.payload;
            if (!payload || payload.kind !== 'formatting') return false;
            const target = payload.target || {};
            const targetActorId = String(target.actorId || '').trim();
            const targetSourceId = normalizeRuntimeIntentSourceId(target.sourceId || target.containerKey || target.boxTargetId);
            if (targetActorId && targetActorId !== actor?.actorId) return false;
            if (targetSourceId && targetSourceId !== actorSourceId) return false;
            return targetActorId || targetSourceId;
        })
        .sort((a, b) => Number(b.sequence || 0) - Number(a.sequence || 0))[0] ?? null;
}

function resolveRuntimeFormattingFrontier(
    context: PackagerContext,
    actor: Pick<PackagerUnit, 'actorId' | 'sourceId'>
) {
    const session = context.processor?.getCurrentLayoutSession?.();
    return session?.resolveActorRuntimeFrontier?.(actor as PackagerUnit, {
        actorId: actor.actorId,
        sourceId: actor.sourceId,
        preferVisibleActorRefs: true
    }) ?? {
        pageIndex: context.pageIndex,
        cursorY: context.cursorY,
        worldY: resolvePackagerWorldYAtCursor(context),
        actorId: actor.actorId,
        sourceId: actor.sourceId
    };
}

function classifyRuntimeFormattingGeometry(
    patch: Record<string, unknown>,
    target: Record<string, unknown>,
    forceRangeGeometry = false
): boolean {
    return (forceRangeGeometry && isRuntimeRangeTarget(target))
        || (Object.keys(patch).length ? isGeometryRuntimeFormattingPatch(patch, target) : true);
}

export function applyRuntimeFormattingIntentToSourceElement(options: {
    context: PackagerContext;
    actor: PackagerUnit;
    sourceElement: Element | null | undefined;
    rebuild: () => boolean;
    getGeometrySignature?: () => unknown;
    forceRangeGeometry?: boolean;
}): ObservationResult | null {
    const { context, actor, sourceElement, rebuild, getGeometrySignature, forceRangeGeometry = false } = options;
    const signal = readLatestRuntimeFormattingIntentSignal(context, actor);
    if (!signal || !sourceElement) return null;

    const patch = signal.payload?.patch && typeof signal.payload.patch === 'object'
        ? signal.payload.patch as Record<string, unknown>
        : {};
    const target = signal.payload?.target && typeof signal.payload.target === 'object'
        ? signal.payload.target as Record<string, unknown>
        : {};
    const restoreSnapshot = signal.payload?.restoreSnapshot && typeof signal.payload.restoreSnapshot === 'object'
        ? signal.payload.restoreSnapshot as Record<string, unknown>
        : null;
    const previousSnapshot = cloneRuntimeElementSourceSnapshot(sourceElement);
    const previousGeometrySignature = getGeometrySignature?.();

    if (restoreSnapshot) {
        if (runtimeElementSourceSnapshotsEqual(previousSnapshot, restoreSnapshot)) {
            return {
                changed: false,
                geometryChanged: false,
                updateKind: 'none'
            };
        }
        restoreRuntimeElementSourceSnapshot(sourceElement, restoreSnapshot);
        if (!rebuild()) {
            restoreRuntimeElementSourceSnapshot(sourceElement, previousSnapshot);
            return {
                changed: false,
                geometryChanged: false,
                updateKind: 'none'
            };
        }
        const classifiedGeometry = classifyRuntimeFormattingGeometry(patch, target, forceRangeGeometry);
        const nextGeometrySignature = getGeometrySignature?.();
        const geometryChanged = classifiedGeometry
            && (
                previousGeometrySignature === undefined
                || nextGeometrySignature === undefined
                || JSON.stringify(previousGeometrySignature) !== JSON.stringify(nextGeometrySignature)
            );
        return {
            changed: true,
            geometryChanged,
            updateKind: geometryChanged ? 'geometry' : 'content-only',
            earliestAffectedFrontier: resolveRuntimeFormattingFrontier(context, actor)
        };
    }

    const rangeTarget = isRuntimeRangeTarget(target);
    const previousStyle = sourceElement.properties && typeof sourceElement.properties.style === 'object' && sourceElement.properties.style
        ? { ...sourceElement.properties.style }
        : {};
    const changed = rangeTarget
        ? applyRuntimeRangeFormattingPatch(sourceElement, patch, target)
        : Object.entries(patch).some(([key, value]) => previousStyle[key] !== value);
    if (!changed) {
        return {
            changed: false,
            geometryChanged: false,
            updateKind: 'none'
        };
    }

    if (!rangeTarget) {
        sourceElement.properties = {
            ...sourceElement.properties,
            style: {
                ...previousStyle,
                ...patch
            }
        };
    }

    if (!rebuild()) {
        restoreRuntimeElementSourceSnapshot(sourceElement, previousSnapshot);
        return {
            changed: false,
            geometryChanged: false,
            updateKind: 'none'
        };
    }

    const classifiedGeometry = classifyRuntimeFormattingGeometry(patch, target, forceRangeGeometry);
    const nextGeometrySignature = getGeometrySignature?.();
    const geometryChanged = classifiedGeometry
        && (
            previousGeometrySignature === undefined
            || nextGeometrySignature === undefined
            || JSON.stringify(previousGeometrySignature) !== JSON.stringify(nextGeometrySignature)
        );
    return {
        changed: true,
        geometryChanged,
        updateKind: geometryChanged ? 'geometry' : 'content-only',
        earliestAffectedFrontier: resolveRuntimeFormattingFrontier(context, actor)
    };
}
