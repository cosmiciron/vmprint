import type { LayoutConfig, Page } from './types';
import type { PageCaptureRecord, ViewportDescriptor } from './layout/runtime/session/session-state-types';

export type ViewportKind = 'page' | 'world';

export type WorldViewportRequest = {
    worldX?: number;
    worldY: number;
    width: number;
    height: number;
};

export type ViewportSize = {
    width: number;
    height: number;
};

export type WorldViewportSegment = {
    pageIndex: number;
    page: Page;
    capture: PageCaptureRecord | null;
    descriptor: ViewportDescriptor | null;
    sourceRect: { x: number; y: number; w: number; h: number };
    destinationRect: { x: number; y: number; w: number; h: number };
};

export interface BaseViewportHandle {
    readonly id: string;
    readonly kind: ViewportKind;
    readonly pageCount: number;
    readonly pageSize: { width: number; height: number };
    readonly viewportSize: ViewportSize;
    readonly config: LayoutConfig;
    readonly sourceSignature: string;
}

export interface PageViewportHandleLike extends BaseViewportHandle {
    readonly kind: 'page';
    readonly pageIndex: number;
    readonly page: Page;
    readonly capture: PageCaptureRecord | null;
    readonly descriptor: ViewportDescriptor | null;
    readonly renderRevision: number | null;
}

export interface WorldViewportHandleLike extends BaseViewportHandle {
    readonly kind: 'world';
    readonly worldRect: { x: number; y: number; w: number; h: number };
    readonly segments: readonly WorldViewportSegment[];
}

export type ViewportHandle = PageViewportHandleLike | WorldViewportHandleLike;

type PageViewportHandleParams = {
    pageIndex: number;
    pageCount: number;
    pageSize: { width: number; height: number };
    config: LayoutConfig;
    page: Page;
    capture: PageCaptureRecord | null;
};

type WorldViewportHandleParams = {
    pageCount: number;
    pageSize: { width: number; height: number };
    config: LayoutConfig;
    worldRect: { x: number; y: number; w: number; h: number };
    segments: WorldViewportSegment[];
};

export type ViewportSnapshotSource = {
    pageCount: number;
    pageSize: { width: number; height: number };
    config: LayoutConfig;
    pages: readonly Page[];
    pageCaptures?: readonly PageCaptureRecord[];
};

const hashString = (value: string): number => {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
};

const collectBoxText = (page: Page['boxes'][number]): string => {
    if (typeof page.content === 'string' && page.content.length > 0) {
        return page.content;
    }
    if (Array.isArray(page.lines) && page.lines.length > 0) {
        return page.lines
            .map((line) => line.map((segment) => String(segment.text ?? '')).join(''))
            .join('\n');
    }
    return '';
};

const buildUncapturedPageSignature = (page: Page): string => {
    let hash = 2166136261;
    for (const box of page.boxes) {
        const sourceId = typeof box.meta?.sourceId === 'string'
            ? box.meta.sourceId
            : (typeof box.properties?.sourceId === 'string' ? box.properties.sourceId : '');
        const parts = [
            String(box.type ?? ''),
            String(Math.round(Number(box.x ?? 0))),
            String(Math.round(Number(box.y ?? 0))),
            String(Math.round(Number(box.w ?? 0))),
            String(Math.round(Number(box.h ?? 0))),
            sourceId,
            collectBoxText(box)
        ];
        hash ^= hashString(parts.join('|'));
        hash = Math.imul(hash, 16777619);
    }
    return `${page.boxes.length}:${hash >>> 0}`;
};

export class PageViewportHandle implements PageViewportHandleLike {
    readonly id: string;
    readonly kind: 'page' = 'page';
    readonly pageIndex: number;
    readonly pageCount: number;
    readonly pageSize: { width: number; height: number };
    readonly viewportSize: ViewportSize;
    readonly config: LayoutConfig;
    readonly page: Page;
    readonly capture: PageCaptureRecord | null;
    readonly renderRevision: number | null;
    readonly sourceSignature: string;

    constructor(params: PageViewportHandleParams) {
        this.pageIndex = params.pageIndex;
        this.pageCount = params.pageCount;
        this.pageSize = { ...params.pageSize };
        this.viewportSize = { ...params.pageSize };
        this.config = params.config;
        this.page = params.page;
        this.capture = params.capture;
        this.renderRevision = params.capture?.renderRevision ?? null;
        this.id = `page:${this.pageIndex}:${this.pageCount}`;
        const livePageToken = `live:${buildUncapturedPageSignature(this.page)}`;
        const pageRevisionToken = this.renderRevision !== null
            ? `capture:${this.renderRevision}`
            : 'capture:none';
        this.sourceSignature = [
            this.id,
            this.page.width,
            this.page.height,
            pageRevisionToken,
            livePageToken
        ].join(':');
    }

    get descriptor(): ViewportDescriptor | null {
        return this.capture?.capture.viewport ?? null;
    }
}

export class WorldViewportHandle implements WorldViewportHandleLike {
    readonly id: string;
    readonly kind: 'world' = 'world';
    readonly pageCount: number;
    readonly pageSize: { width: number; height: number };
    readonly viewportSize: ViewportSize;
    readonly config: LayoutConfig;
    readonly worldRect: { x: number; y: number; w: number; h: number };
    readonly segments: readonly WorldViewportSegment[];
    readonly sourceSignature: string;

    constructor(params: WorldViewportHandleParams) {
        this.pageCount = params.pageCount;
        this.pageSize = { ...params.pageSize };
        this.viewportSize = {
            width: params.worldRect.w,
            height: params.worldRect.h
        };
        this.config = params.config;
        this.worldRect = { ...params.worldRect };
        this.segments = params.segments.map((segment) => ({
            ...segment,
            sourceRect: { ...segment.sourceRect },
            destinationRect: { ...segment.destinationRect }
        }));
        this.id = `world:${this.worldRect.x}:${this.worldRect.y}:${this.worldRect.w}:${this.worldRect.h}:${this.pageCount}`;
        this.sourceSignature = [
            this.id,
            ...this.segments.map((segment) => (
                [
                    segment.pageIndex,
                    segment.capture?.renderRevision !== undefined && segment.capture?.renderRevision !== null
                        ? `capture:${segment.capture.renderRevision}`
                        : 'capture:none',
                    `live:${buildUncapturedPageSignature(segment.page)}`
                ].join(':')
            ))
        ].join(':');
    }
}

export function intersectViewportRects(
    a: { x: number; y: number; w: number; h: number },
    b: { x: number; y: number; w: number; h: number }
): { x: number; y: number; w: number; h: number } | null {
    const left = Math.max(a.x, b.x);
    const top = Math.max(a.y, b.y);
    const right = Math.min(a.x + a.w, b.x + b.w);
    const bottom = Math.min(a.y + a.h, b.y + b.h);
    if (right <= left || bottom <= top) return null;
    return {
        x: left,
        y: top,
        w: right - left,
        h: bottom - top
    };
}

export function buildPageViewportHandle(
    snapshot: ViewportSnapshotSource,
    pageIndex: number
): PageViewportHandle {
    const pageCount = snapshot.pages.length;
    if (pageCount === 0) {
        throw new Error('[viewport] Cannot build a page viewport from an empty snapshot.');
    }
    const normalizedPageIndex = Math.min(Math.max(0, Math.floor(Number(pageIndex))), pageCount - 1);
    const page = snapshot.pages[normalizedPageIndex];
    const capture = snapshot.pageCaptures
        ?.find((candidate) => candidate.pageIndex === normalizedPageIndex)
        ?? null;
    return new PageViewportHandle({
        pageIndex: normalizedPageIndex,
        pageCount,
        pageSize: snapshot.pageSize,
        config: snapshot.config,
        page,
        capture
    });
}

export function buildWorldViewportHandle(
    snapshot: ViewportSnapshotSource,
    request: WorldViewportRequest
): WorldViewportHandle {
    const pageCount = snapshot.pages.length;
    if (pageCount === 0) {
        throw new Error('[viewport] Cannot build a world viewport from an empty snapshot.');
    }

    const worldRect = {
        x: Number.isFinite(request.worldX) ? Math.max(0, Number(request.worldX)) : 0,
        y: Number.isFinite(request.worldY) ? Math.max(0, Number(request.worldY)) : 0,
        w: Math.max(1, Number(request.width)),
        h: Math.max(1, Number(request.height))
    };

    const segments = snapshot.pages.flatMap((page) => {
        const capture = snapshot.pageCaptures
            ?.find((candidate) => candidate.pageIndex === page.index)
            ?? null;
        const descriptor = capture?.capture.viewport ?? null;
        const pageWorldRect = {
            x: Number(descriptor?.worldX ?? 0),
            y: Number(descriptor?.worldY ?? (page.index * page.height)),
            w: Number(descriptor?.width ?? page.width),
            h: Number(descriptor?.height ?? page.height)
        };
        const intersection = intersectViewportRects(worldRect, pageWorldRect);
        if (!intersection) return [];
        return [{
            pageIndex: page.index,
            page,
            capture,
            descriptor,
            sourceRect: {
                x: intersection.x - pageWorldRect.x,
                y: intersection.y - pageWorldRect.y,
                w: intersection.w,
                h: intersection.h
            },
            destinationRect: {
                x: intersection.x - worldRect.x,
                y: intersection.y - worldRect.y,
                w: intersection.w,
                h: intersection.h
            }
        }];
    });

    return new WorldViewportHandle({
        pageCount,
        pageSize: snapshot.pageSize,
        config: snapshot.config,
        worldRect,
        segments
    });
}
