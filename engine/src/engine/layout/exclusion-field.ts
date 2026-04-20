import type {
    StoryExclusionAssembly,
    StoryExclusionBoundaryProfile,
    StoryFloatAlign,
    StoryFloatShape,
    StoryWrapMode,
    TraversalInteractionPolicy
} from '../types';
import type { OccupiedRect } from './packagers/spatial-map';

export interface ExclusionFieldDescriptor {
    x: number;
    y: number;
    w: number;
    h: number;
    wrap: StoryWrapMode;
    gap: number;
    shape?: StoryFloatShape;
    path?: string;
    align?: StoryFloatAlign;
    exclusionAssembly?: StoryExclusionAssembly;
    exclusionBoundaryProfile?: StoryExclusionBoundaryProfile;
    zIndex?: number;
    traversalInteraction?: TraversalInteractionPolicy;
}

/**
 * Expand one authored exclusion field into primitive wrap obstacles.
 *
 * This is intentionally lower-level than StoryPackager: it knows how to turn
 * a composed field into ordinary rect/circle obstacles, but it does not know
 * anything about text cursors, pagination, or columns. Hosts such as Story can
 * anchor and place the field however they want, then delegate primitive
 * expansion here.
 */
export function buildExclusionFieldObstacles(descriptor: ExclusionFieldDescriptor): OccupiedRect[] {
    const gap = Math.max(0, Number(descriptor.gap ?? 0));
    const normalizedShape = (descriptor.shape ?? 'rect') as 'rect' | 'circle' | 'ellipse' | 'polygon';
    const assemblyMembers = normalizeExclusionAssemblyMembers(descriptor.exclusionAssembly);

    if (assemblyMembers.length === 0) {
        return [{
            x: descriptor.x,
            y: descriptor.y,
            w: descriptor.w,
            h: descriptor.h,
            wrap: descriptor.wrap,
            gap,
            shape: normalizedShape,
            path: normalizedShape === 'polygon' ? String(descriptor.path || '') : undefined,
            exclusionBoundaryProfile: descriptor.exclusionBoundaryProfile,
            align: descriptor.align,
            zIndex: Number.isFinite(Number(descriptor.zIndex)) ? Number(descriptor.zIndex) : 0,
            traversalInteraction: descriptor.traversalInteraction ?? 'auto'
        }];
    }

    return assemblyMembers.map((member) => ({
        x: descriptor.x + Number(member.x ?? 0),
        y: descriptor.y + Number(member.y ?? 0),
        w: Math.max(0, Number(member.w ?? 0)),
        h: Math.max(0, Number(member.h ?? 0)),
        wrap: descriptor.wrap,
        gap,
        shape: ((member.shape ?? 'rect') as 'rect' | 'circle' | 'ellipse' | 'polygon'),
        path: member.shape === 'polygon' ? String(member.path || '') : undefined,
        zIndex: Number.isFinite(Number(member.zIndex))
            ? Number(member.zIndex)
            : (Number.isFinite(Number(descriptor.zIndex)) ? Number(descriptor.zIndex) : 0),
        traversalInteraction: member.traversalInteraction ?? descriptor.traversalInteraction ?? 'auto',
        ...(member.resistance !== undefined
            ? { resistance: Math.max(0, Math.min(1, Number(member.resistance))) }
            : {})
        // Deliberately omit align here: assembled members should carve as local
        // lobes, not inherit the solitary edge-extension heuristic used for
        // single left/right circles.
    })).filter((member) => member.w > 0 && member.h > 0);
}

type NormalizedExclusionAssemblyMember = StoryExclusionAssembly['members'][number] | {
    x: number;
    y: number;
    w: number;
    h: number;
    shape: 'rect';
    zIndex?: number;
    traversalInteraction?: TraversalInteractionPolicy;
    resistance?: number;
};

function normalizeExclusionAssemblyMembers(
    assembly: ExclusionFieldDescriptor['exclusionAssembly'] | (Record<string, unknown> & { layers?: unknown[] }) | undefined
): NormalizedExclusionAssemblyMember[] {
    if (!assembly || typeof assembly !== 'object') {
        return [];
    }

    if (Array.isArray((assembly as StoryExclusionAssembly).members) && (assembly as StoryExclusionAssembly).members.length > 0) {
        return (assembly as StoryExclusionAssembly).members;
    }

    const layers = Array.isArray((assembly as { layers?: unknown[] }).layers)
        ? ((assembly as { layers?: unknown[] }).layers as Array<Record<string, unknown>>)
        : [];
    if (layers.length === 0) {
        return [];
    }

    return layers.flatMap((layer) => {
        const rects = Array.isArray(layer?.rects) ? layer.rects : [];
        return rects.flatMap((rect) => {
            if (!Array.isArray(rect) || rect.length < 4) {
                return [];
            }
            const [x, y, w, h] = rect;
            const normalized = {
                x: Number(x ?? 0),
                y: Number(y ?? 0),
                w: Math.max(0, Number(w ?? 0)),
                h: Math.max(0, Number(h ?? 0)),
                shape: 'rect' as const
            };
            return normalized.w > 0 && normalized.h > 0 ? [normalized] : [];
        });
    });
}
