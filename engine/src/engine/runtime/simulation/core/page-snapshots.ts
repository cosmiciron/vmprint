import type { Page } from '../../../types';
import type { PageCaptureRecord } from '../../../layout/runtime/session/session-state-types';
import type { SimulationUpdateSummary } from '../types';

function hashString(value: string): number {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
}

export function buildPageSnapshotToken(page: Page): string {
    let hash = 2166136261;
    for (const box of page.boxes) {
        const sourceId = typeof box.meta?.sourceId === 'string'
            ? box.meta.sourceId
            : (typeof box.properties?.sourceId === 'string' ? box.properties.sourceId : '');
        const lineText = Array.isArray(box.lines)
            ? box.lines.map((line) => line.map((segment) => String(segment.text ?? '')).join('')).join('\n')
            : '';
        const parts = [
            String(box.type ?? ''),
            String(Math.round(Number(box.x ?? 0))),
            String(Math.round(Number(box.y ?? 0))),
            String(Math.round(Number(box.w ?? 0))),
            String(Math.round(Number(box.h ?? 0))),
            sourceId,
            String(box.style?.backgroundColor ?? ''),
            String(box.style?.borderColor ?? ''),
            String(box.style?.borderWidth ?? ''),
            String(box.style?.color ?? ''),
            String(box.style?.fontFamily ?? ''),
            String(box.style?.fontSize ?? ''),
            String(box.style?.fontWeight ?? ''),
            String(box.style?.fontStyle ?? ''),
            String(box.style?.lineHeight ?? ''),
            typeof box.content === 'string' ? box.content : lineText
        ];
        hash ^= hashString(parts.join('|'));
        hash = Math.imul(hash, 16777619);
    }
    return `${page.index}:${page.boxes.length}:${hash >>> 0}`;
}

export function capturePageTokens(pageCaptures: PageCaptureRecord[], pages: Page[]): Map<number, string> {
    const tokens = new Map<number, string>();
    for (const record of pageCaptures) {
        tokens.set(record.pageIndex, `capture:${record.renderRevision}`);
    }

    for (const page of pages) {
        if (tokens.has(page.index)) continue;
        tokens.set(page.index, `live:${buildPageSnapshotToken(page)}`);
    }

    return tokens;
}

export function capturePageCaptureRevisions(pageCaptures: PageCaptureRecord[]): Map<number, number> {
    return new Map(pageCaptures.map((record) => [record.pageIndex, record.renderRevision] as const));
}

export function computeChangedPageIndexes<T>(
    previousTokens: Map<number, T>,
    nextTokens: Map<number, T>
): number[] {
    return computePageTokenChanges(previousTokens, nextTokens).pageIndexes;
}

export function computePageTokenChanges<T>(
    previousTokens: Map<number, T>,
    nextTokens: Map<number, T>
): { pageIndexes: number[]; addedPageIndexes: number[]; removedPageIndexes: number[] } {
    const changed = new Set<number>();
    const added = new Set<number>();
    const removed = new Set<number>();
    for (const [pageIndex, nextToken] of nextTokens.entries()) {
        if (!previousTokens.has(pageIndex)) {
            added.add(pageIndex);
            changed.add(pageIndex);
        } else if (previousTokens.get(pageIndex) !== nextToken) {
            changed.add(pageIndex);
        }
    }
    for (const pageIndex of previousTokens.keys()) {
        if (!nextTokens.has(pageIndex)) {
            removed.add(pageIndex);
            changed.add(pageIndex);
        }
    }
    return {
        pageIndexes: Array.from(changed).sort((a, b) => a - b),
        addedPageIndexes: Array.from(added).sort((a, b) => a - b),
        removedPageIndexes: Array.from(removed).sort((a, b) => a - b)
    };
}

export function updateSummaryWithChangedPages(
    summary: SimulationUpdateSummary,
    previousTokens: Map<number, string>,
    nextTokens: Map<number, string>
): SimulationUpdateSummary {
    const changes = computePageTokenChanges(previousTokens, nextTokens);
    return {
        ...summary,
        pageIndexes: changes.pageIndexes.length > 0 ? changes.pageIndexes : summary.pageIndexes,
        addedPageIndexes: changes.addedPageIndexes,
        removedPageIndexes: changes.removedPageIndexes
    };
}

export function normalizeUpdateSummary(
    summary: SimulationUpdateSummary,
    renderRevisionPageIndexes: readonly number[]
): SimulationUpdateSummary {
    if (summary.kind === 'none') return summary;
    if (summary.pageIndexes.length > 0) return summary;
    if (renderRevisionPageIndexes.length > 0) return summary;
    return {
        kind: 'none',
        source: 'none',
        actorIds: [],
        sourceIds: [],
        pageIndexes: [],
        addedPageIndexes: [],
        removedPageIndexes: [],
        replayFrontier: null
    };
}
