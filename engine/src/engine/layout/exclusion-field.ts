import type { StoryExclusionAssembly, StoryFloatAlign, StoryFloatShape, StoryWrapMode } from '../types';
import type { OccupiedRect } from './packagers/spatial-map';

export interface ExclusionFieldDescriptor {
    x: number;
    y: number;
    w: number;
    h: number;
    wrap: StoryWrapMode;
    gap: number;
    shape?: StoryFloatShape;
    align?: StoryFloatAlign;
    exclusionAssembly?: StoryExclusionAssembly;
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
    const normalizedShape = (descriptor.shape ?? 'rect') as 'rect' | 'circle';
    const assemblyMembers = Array.isArray(descriptor.exclusionAssembly?.members)
        ? descriptor.exclusionAssembly.members
        : [];

    if (assemblyMembers.length === 0) {
        return [{
            x: descriptor.x,
            y: descriptor.y,
            w: descriptor.w,
            h: descriptor.h,
            wrap: descriptor.wrap,
            gap,
            shape: normalizedShape,
            align: descriptor.align
        }];
    }

    return assemblyMembers.map((member) => ({
        x: descriptor.x + Number(member.x ?? 0),
        y: descriptor.y + Number(member.y ?? 0),
        w: Math.max(0, Number(member.w ?? 0)),
        h: Math.max(0, Number(member.h ?? 0)),
        wrap: descriptor.wrap,
        gap,
        shape: ((member.shape ?? 'rect') as 'rect' | 'circle')
        // Deliberately omit align here: assembled members should carve as local
        // lobes, not inherit the solitary edge-extension heuristic used for
        // single left/right circles.
    })).filter((member) => member.w > 0 && member.h > 0);
}
