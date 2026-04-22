import { Element, ElementStyle, StoryExclusionAssembly } from '../../types';
import { translateSvgPath } from '../../geometry/svg-path';
import { buildExclusionFieldObstacles } from '../exclusion-field';
import { LayoutUtils } from '../layout-utils';
import { SpatialMap } from './spatial-map';

export type ContainedFieldFrame = {
    x: number;
    y: number;
    w: number;
    h: number;
    path?: string;
    exclusionAssembly?: StoryExclusionAssembly | (Record<string, unknown> & { layers?: unknown[] });
};

export function resolveContainedFieldFrame(element: Element): ContainedFieldFrame | null {
    const directive = (element.properties?.space ?? element.properties?.spatialField) as {
        kind?: string;
        x?: unknown;
        y?: unknown;
    } | undefined;
    if (!directive || directive.kind !== 'contain') return null;

    const style = (element.properties?.style || {}) as ElementStyle;
    const width = Number(style.width);
    const height = Number(style.height);
    if (!(Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0)) {
        return null;
    }

    const paddingLeft = LayoutUtils.validateUnit(style.paddingLeft ?? style.padding ?? 0);
    const paddingRight = LayoutUtils.validateUnit(style.paddingRight ?? style.padding ?? 0);
    const paddingTop = LayoutUtils.validateUnit(style.paddingTop ?? style.padding ?? 0);
    const paddingBottom = LayoutUtils.validateUnit(style.paddingBottom ?? style.padding ?? 0);
    const borderLeft = LayoutUtils.validateUnit(style.borderLeftWidth ?? style.borderWidth ?? 0);
    const borderRight = LayoutUtils.validateUnit(style.borderRightWidth ?? style.borderWidth ?? 0);
    const borderTop = LayoutUtils.validateUnit(style.borderTopWidth ?? style.borderWidth ?? 0);
    const borderBottom = LayoutUtils.validateUnit(style.borderBottomWidth ?? style.borderWidth ?? 0);

    const insetLeft = paddingLeft + borderLeft;
    const insetRight = paddingRight + borderRight;
    const insetTop = paddingTop + borderTop;
    const insetBottom = paddingBottom + borderBottom;

    const localX = Number.isFinite(Number(directive.x)) ? Number(directive.x) : 0;
    const localY = Number.isFinite(Number(directive.y)) ? Number(directive.y) : 0;
    const innerWidth = Math.max(0, width - insetLeft - insetRight);
    const innerHeight = Math.max(0, height - insetTop - insetBottom);
    if (!(innerWidth > 0 && innerHeight > 0)) {
        return null;
    }

    return {
        x: localX + insetLeft,
        y: localY + insetTop,
        w: innerWidth,
        h: innerHeight,
        ...(typeof (directive as { path?: unknown }).path === 'string' && String((directive as { path?: unknown }).path).trim()
            ? { path: translateSvgPath(String((directive as { path?: unknown }).path).trim(), -insetLeft, -insetTop) }
            : {}),
        ...((directive as { exclusionAssembly?: unknown }).exclusionAssembly
            ? { exclusionAssembly: rebaseContainedExclusionAssembly((directive as { exclusionAssembly?: unknown }).exclusionAssembly, insetLeft, insetTop) }
            : {})
    };
}

export function resolveContainedHostWidth(element: Element, fallbackWidth: number): number {
    const style = (element.properties?.style || {}) as { width?: unknown };
    const authoredWidth = Number(style.width);
    if (Number.isFinite(authoredWidth) && authoredWidth > 0) return authoredWidth;
    return fallbackWidth;
}

export function registerContainedField(spatialMap: SpatialMap, element: Element): ContainedFieldFrame | null {
    const directive = (element.properties?.space ?? element.properties?.spatialField) as any;
    if (!directive || directive.kind !== 'contain') return null;

    const frame = resolveContainedFieldFrame(element);
    if (!frame) return null;

    const obstacles = buildExclusionFieldObstacles({
        x: frame.x,
        y: frame.y,
        w: frame.w,
        h: frame.h,
        wrap: directive.wrap ?? 'around',
        gap: Number.isFinite(Number(directive.gap)) ? Math.max(0, Number(directive.gap)) : 0,
        shape: directive.shape,
        path: frame.path ?? directive.path,
        align: directive.align,
        exclusionAssembly: frame.exclusionAssembly ?? directive.exclusionAssembly,
        zIndex: Number.isFinite(Number(directive.zIndex)) ? Number(directive.zIndex) : 0,
        traversalInteraction: directive.traversalInteraction ?? 'auto'
    });
    for (const obstacle of obstacles) {
        spatialMap.register(obstacle);
    }

    return frame;
}

export function buildContainedSpatialMap(element: Element): SpatialMap {
    const map = new SpatialMap();
    registerContainedField(map, element);
    return map;
}

function rebaseContainedExclusionAssembly(
    assembly: unknown,
    insetLeft: number,
    insetTop: number
): StoryExclusionAssembly | (Record<string, unknown> & { layers?: unknown[] }) {
    if (!assembly || typeof assembly !== 'object') {
        return { layers: [] };
    }

    const typed = assembly as StoryExclusionAssembly & { layers?: unknown[] };
    if (Array.isArray(typed.members)) {
        return {
            ...typed,
            members: typed.members.map((member) => ({
                ...member,
                x: Number(member.x ?? 0) - insetLeft,
                y: Number(member.y ?? 0) - insetTop,
                ...(member.shape === 'polygon' && typeof member.path === 'string' && member.path.trim()
                    ? { path: translateSvgPath(member.path.trim(), -insetLeft, -insetTop) }
                    : {})
            }))
        };
    }

    if (Array.isArray(typed.layers)) {
        return {
            ...typed,
            layers: typed.layers.map((layer) => {
                if (!layer || typeof layer !== 'object') {
                    return layer;
                }
                const layerRecord = layer as Record<string, unknown>;
                const rects = Array.isArray(layerRecord.rects) ? layerRecord.rects : [];
                return {
                    ...layerRecord,
                    rects: rects.map((rect) => {
                        if (!Array.isArray(rect) || rect.length < 4) {
                            return rect;
                        }
                        const next = [...rect];
                        next[0] = Number(rect[0] ?? 0) - insetLeft;
                        next[1] = Number(rect[1] ?? 0) - insetTop;
                        return next;
                    })
                };
            })
        };
    }

    return typed;
}
