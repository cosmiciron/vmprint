import type {
    StoryExclusionBoundaryProfile,
    StoryExclusionBoundaryProfileObjectBand,
    StoryExclusionBoundaryProfileTupleBand,
    StoryFloatAlign,
    TraversalInteractionPolicy
} from '../types';
import { parseSvgPathSubpaths, type SvgPathPoint, type SvgPathSubpath } from '../geometry/svg-path';
import {
    createExclusionResistanceBand,
    createExclusionResistanceField,
    createExclusionResistanceSpan,
    type ExclusionResistanceBand,
    type ExclusionResistanceField
} from './exclusion-resistance-field';
import type { ColliderFieldStatsSnapshot } from './collider-field';
import type { Interval, OccupiedRect } from './packagers/spatial-map';

const DEFAULT_BUCKET_SIZE = 64;
const CIRCLE_BAND_STEP = 0.01;

export class ExclusionResistanceFieldMap {
    private readonly fields: ExclusionResistanceField[] = [];
    private readonly bucketToFieldIndexes = new Map<number, number[]>();
    private queryCalls = 0;
    private bucketTouches = 0;
    private candidateColliderCount = 0;
    private narrowphaseCalls = 0;

    clear(): void {
        this.fields.length = 0;
        this.bucketToFieldIndexes.clear();
        this.queryCalls = 0;
        this.bucketTouches = 0;
        this.candidateColliderCount = 0;
        this.narrowphaseCalls = 0;
    }

    get hasFields(): boolean {
        return this.fields.length > 0;
    }

    registerObstacle(obstacle: OccupiedRect): boolean {
        const field = compileObstacleToExclusionResistanceField(obstacle);
        if (!field) return false;
        const fieldIndex = this.fields.push(field) - 1;
        this.registerFieldInBuckets(field, fieldIndex);
        return true;
    }

    getAvailableIntervals(
        y: number,
        lineH: number,
        totalWidth: number,
        options?: { opticalUnderhang?: boolean; queryZIndex?: number }
    ): Interval[] {
        let available: Interval[] = [{ x: 0, w: totalWidth }];
        const queryTop = y;
        const queryBottom = y + lineH;
        const queryZIndex = normalizeZIndex(options?.queryZIndex);

        for (const field of this.getCandidateFields(queryTop, queryBottom)) {
            this.narrowphaseCalls += 1;
            if (field.wrap === 'none') continue;
            if (!intersectsDepth(field.traversalInteraction, field.zIndex, queryZIndex)) continue;
            const overlappingBands = resolveOverlappingBands(field, queryTop, queryBottom, options?.opticalUnderhang === true);
            if (overlappingBands.length === 0) continue;
            if (field.wrap === 'top-bottom') return [];
            for (const band of overlappingBands) {
                for (const span of band.spans) {
                    available = carveInterval(available, span.left, span.right);
                }
            }
        }

        return available.filter((interval) => interval.w > 0.5);
    }

    hasTopBottomBlock(y: number, lineH: number, queryZIndex: number = 0): boolean {
        const queryTop = y;
        const queryBottom = y + lineH;
        const normalizedZIndex = normalizeZIndex(queryZIndex);
        for (const field of this.getCandidateFields(queryTop, queryBottom)) {
            this.narrowphaseCalls += 1;
            if (field.wrap !== 'top-bottom') continue;
            if (!intersectsDepth(field.traversalInteraction, field.zIndex, normalizedZIndex)) continue;
            if (resolveOverlappingBands(field, queryTop, queryBottom).length > 0) {
                return true;
            }
        }
        return false;
    }

    topBottomClearY(y: number, queryZIndex: number = 0): number {
        let clearY = y;
        let changed = true;
        const normalizedZIndex = normalizeZIndex(queryZIndex);
        while (changed) {
            changed = false;
            for (const field of this.getCandidateFields(clearY, clearY)) {
                this.narrowphaseCalls += 1;
                if (field.wrap !== 'top-bottom') continue;
                if (!intersectsDepth(field.traversalInteraction, field.zIndex, normalizedZIndex)) continue;
                if (resolveOverlappingBands(field, clearY, clearY).length === 0) continue;
                if (field.maxY <= clearY) continue;
                clearY = field.maxY;
                changed = true;
            }
        }
        return clearY;
    }

    bandClearY(y: number, lineH: number, queryZIndex: number = 0, opticalUnderhang: boolean = false): number {
        let clearY = y;
        let changed = true;
        const normalizedZIndex = normalizeZIndex(queryZIndex);
        while (changed) {
            changed = false;
            const queryTop = clearY;
            const queryBottom = clearY + lineH;
            for (const field of this.getCandidateFields(queryTop, queryBottom)) {
                this.narrowphaseCalls += 1;
                if (field.wrap === 'none') continue;
                if (!intersectsDepth(field.traversalInteraction, field.zIndex, normalizedZIndex)) continue;
                if (resolveOverlappingBands(field, queryTop, queryBottom, opticalUnderhang).length === 0) continue;
                const bottom = resolveEffectiveFieldMaxY(field, opticalUnderhang);
                if (bottom <= clearY) continue;
                clearY = bottom;
                changed = true;
            }
        }
        return clearY;
    }

    maxObstacleBottom(): number {
        return this.fields.reduce((max, field) => Math.max(max, field.maxY), 0);
    }

    getStatsSnapshot(): ColliderFieldStatsSnapshot {
        return {
            registeredColliders: this.fields.length,
            bucketCount: this.bucketToFieldIndexes.size,
            queryCalls: this.queryCalls,
            bucketTouches: this.bucketTouches,
            candidateColliderCount: this.candidateColliderCount,
            narrowphaseCalls: this.narrowphaseCalls
        };
    }

    private registerFieldInBuckets(field: ExclusionResistanceField, fieldIndex: number): void {
        const startBucket = resolveBucketIndex(field.minY);
        const endBucket = resolveBucketIndex(field.maxY);
        for (let bucket = startBucket; bucket <= endBucket; bucket += 1) {
            const indexes = this.bucketToFieldIndexes.get(bucket) ?? [];
            indexes.push(fieldIndex);
            this.bucketToFieldIndexes.set(bucket, indexes);
        }
    }

    private getCandidateFields(top: number, bottom: number): ExclusionResistanceField[] {
        this.queryCalls += 1;
        if (this.fields.length <= 1) return this.fields;

        const startBucket = resolveBucketIndex(top);
        const endBucket = resolveBucketIndex(bottom);
        const seen = new Set<number>();
        const candidates: ExclusionResistanceField[] = [];

        for (let bucket = startBucket; bucket <= endBucket; bucket += 1) {
            this.bucketTouches += 1;
            const indexes = this.bucketToFieldIndexes.get(bucket);
            if (!indexes) continue;
            for (const index of indexes) {
                if (seen.has(index)) continue;
                seen.add(index);
                candidates.push(this.fields[index]!);
            }
        }

        const resolved = candidates.length > 0 ? candidates : this.fields;
        this.candidateColliderCount += resolved.length;
        return resolved;
    }
}

function compileObstacleToExclusionResistanceField(obstacle: OccupiedRect): ExclusionResistanceField | null {
    if (obstacle.exclusionBoundaryProfile) {
        return compileBoundaryProfileObstacle(obstacle);
    }
    if (obstacle.resistance !== undefined && obstacle.resistance < 1) {
        if (obstacle.shape === 'circle') return compileCircleObstacle(obstacle);
        if (obstacle.shape === 'ellipse') return compileEllipseObstacle(obstacle);
        if (obstacle.shape === 'polygon') return compilePolygonObstacle(obstacle);
        return compileRectObstacle(obstacle);
    }
    return null;
}

function compileBoundaryProfileObstacle(obstacle: OccupiedRect): ExclusionResistanceField | null {
    const profile = obstacle.exclusionBoundaryProfile;
    if (!profile || !Array.isArray(profile.bands) || profile.bands.length === 0) return null;

    const bands: ExclusionResistanceBand[] = [];
    for (const rawBand of profile.bands) {
        const parsed = normalizeProfileBand(rawBand);
        if (!parsed) continue;
        const band = createExclusionResistanceBand(
            obstacle.y + parsed.top,
            obstacle.y + parsed.bottom,
            compactSpans(
                parsed.spans
                    .map((span) => createExclusionResistanceSpan(
                        obstacle.x + span.left,
                        obstacle.x + span.right,
                        span.resistance
                    ))
                    .filter((span): span is NonNullable<typeof span> => !!span)
            )
        );
        if (band) bands.push(band);
    }

    if (bands.length === 0) return null;

    const rawHeight = Number(profile.height ?? 0);
    const rawGap = Number(profile.gap ?? obstacle.gap ?? 0);
    const opticalMaxY = Number.isFinite(rawHeight) && rawHeight > 0
        ? obstacle.y + Math.max(0, rawHeight - Math.max(0, rawGap))
        : undefined;

    return createExclusionResistanceField({
        mode: profile.mode === 'weighted' ? 'weighted' : 'hard',
        wrap: obstacle.wrap,
        zIndex: normalizeZIndex(obstacle.zIndex),
        traversalInteraction: obstacle.traversalInteraction ?? 'auto',
        opticalMaxY,
        bands
    });
}

function normalizeProfileBand(
    band: StoryExclusionBoundaryProfile['bands'][number]
): { top: number; bottom: number; spans: Array<{ left: number; right: number; resistance: number }> } | null {
    if (Array.isArray(band)) {
        const tupleBand = band as StoryExclusionBoundaryProfileTupleBand;
        const [top, bottom, tupleSpans] = tupleBand;
        if (!Array.isArray(tupleSpans)) return null;
        return {
            top: Number(top),
            bottom: Number(bottom),
            spans: tupleSpans
                .filter((span): span is StoryExclusionBoundaryProfileTupleBand[2][number] => Array.isArray(span) && span.length >= 3)
                .map(([left, right, resistance]) => ({
                    left: Number(left),
                    right: Number(right),
                    resistance: clampResistance(Number(resistance))
                }))
        };
    }

    const objectBand = band as StoryExclusionBoundaryProfileObjectBand;
    if (!objectBand || !Array.isArray(objectBand.spans)) return null;
    return {
        top: Number(objectBand.top),
        bottom: Number(objectBand.bottom),
        spans: objectBand.spans.map((span) => ({
            left: Number(span.left),
            right: Number(span.right),
            resistance: clampResistance(Number(span.resistance))
        }))
    };
}

function clampResistance(value: number): number {
    if (!Number.isFinite(value)) return 0;
    if (value <= 0) return 0;
    if (value >= 1) return 1;
    return value;
}

function compileRectObstacle(obstacle: OccupiedRect): ExclusionResistanceField | null {
    const g = Math.max(0, Number(obstacle.gap || 0));
    const gapTop = Number.isFinite(Number(obstacle.gapTop)) ? Math.max(0, Number(obstacle.gapTop)) : g;
    const gapBottom = Number.isFinite(Number(obstacle.gapBottom)) ? Math.max(0, Number(obstacle.gapBottom)) : g;
    const band = createExclusionResistanceBand(
        obstacle.y - gapTop,
        obstacle.y + obstacle.h + gapBottom,
        compactSpans([
            createExclusionResistanceSpan(obstacle.x - g, obstacle.x + obstacle.w + g, resolveObstacleResistance(obstacle))
        ])
    );
    if (!band) return null;
    return createExclusionResistanceField({
        mode: 'hard',
        wrap: obstacle.wrap,
        zIndex: normalizeZIndex(obstacle.zIndex),
        traversalInteraction: obstacle.traversalInteraction ?? 'auto',
        opticalMaxY: obstacle.y + obstacle.h,
        bands: [band]
    });
}

function compileCircleObstacle(obstacle: OccupiedRect): ExclusionResistanceField | null {
    const g = Math.max(0, Number(obstacle.gap || 0));
    const cy = Number.isFinite(Number(obstacle.circleCy))
        ? Number(obstacle.circleCy)
        : obstacle.y + (obstacle.h / 2);
    const cx = obstacle.x + (obstacle.w / 2);
    const r = (obstacle.w / 2) + g;
    if (!(r > 0)) return null;

    const top = cy - r;
    const bottom = cy + r;
    const bands: ExclusionResistanceBand[] = [];

    for (let bandTop = top; bandTop < bottom; bandTop += CIRCLE_BAND_STEP) {
        const bandBottom = Math.min(bottom, bandTop + CIRCLE_BAND_STEP);
        const sampleY = Math.max(bandTop, Math.min(bandBottom, cy));
        const dy = sampleY - cy;
        const chordHalfWidth = Math.sqrt(Math.max(0, (r * r) - (dy * dy)));
        const span = createExclusionResistanceSpan(
            resolveCircleCarveLeft(obstacle.align, obstacle.x, obstacle.w, cx, r, chordHalfWidth),
            resolveCircleCarveRight(obstacle.align, obstacle.x, obstacle.w, cx, r, chordHalfWidth),
            resolveObstacleResistance(obstacle)
        );
        const band = createExclusionResistanceBand(
            bandTop,
            bandBottom,
            compactSpans([span])
        );
        if (band) bands.push(band);
    }

    if (bands.length === 0) return null;
    return createExclusionResistanceField({
        mode: 'hard',
        wrap: obstacle.wrap,
        zIndex: normalizeZIndex(obstacle.zIndex),
        traversalInteraction: obstacle.traversalInteraction ?? 'auto',
        opticalMaxY: cy + (obstacle.w / 2),
        bands
    });
}

function compileEllipseObstacle(obstacle: OccupiedRect): ExclusionResistanceField | null {
    const g = Math.max(0, Number(obstacle.gap || 0));
    const cy = Number.isFinite(Number(obstacle.ellipseCy))
        ? Number(obstacle.ellipseCy)
        : obstacle.y + (obstacle.h / 2);
    const cx = obstacle.x + (obstacle.w / 2);
    const rx = (obstacle.w / 2) + g;
    const baseRy = Number.isFinite(Number(obstacle.ellipseRy))
        ? Number(obstacle.ellipseRy)
        : (obstacle.h / 2);
    const ry = baseRy + g;
    if (!(rx > 0) || !(ry > 0)) return null;

    const top = cy - ry;
    const bottom = cy + ry;
    const bands: ExclusionResistanceBand[] = [];

    for (let bandTop = top; bandTop < bottom; bandTop += CIRCLE_BAND_STEP) {
        const bandBottom = Math.min(bottom, bandTop + CIRCLE_BAND_STEP);
        const sampleY = Math.max(bandTop, Math.min(bandBottom, cy));
        const dy = sampleY - cy;
        const normalizedY = Math.max(-1, Math.min(1, dy / ry));
        const chordHalfWidth = rx * Math.sqrt(Math.max(0, 1 - (normalizedY * normalizedY)));
        const span = createExclusionResistanceSpan(
            resolveCircleCarveLeft(obstacle.align, obstacle.x, obstacle.w, cx, rx, chordHalfWidth),
            resolveCircleCarveRight(obstacle.align, obstacle.x, obstacle.w, cx, rx, chordHalfWidth),
            resolveObstacleResistance(obstacle)
        );
        const band = createExclusionResistanceBand(
            bandTop,
            bandBottom,
            compactSpans([span])
        );
        if (band) bands.push(band);
    }

    if (bands.length === 0) return null;
    return createExclusionResistanceField({
        mode: 'hard',
        wrap: obstacle.wrap,
        zIndex: normalizeZIndex(obstacle.zIndex),
        traversalInteraction: obstacle.traversalInteraction ?? 'auto',
        opticalMaxY: cy + baseRy,
        bands
    });
}

function resolveObstacleResistance(obstacle: OccupiedRect): number {
    const value = Number(obstacle.resistance ?? 1);
    return clampResistance(value);
}

function compilePolygonObstacle(obstacle: OccupiedRect): ExclusionResistanceField | null {
    const translatedSubpaths = tryResolvePolygonSubpaths(obstacle);
    if (!translatedSubpaths || translatedSubpaths.length === 0) {
        return compileRectObstacle(obstacle);
    }

    const subpaths = translatedSubpaths.map((subpath) => ({
        points: subpath.points,
        bounds: getPathBounds(subpath.points)
    }));
    const globalBounds = subpaths.reduce((aggregate, subpath) => ({
        minY: Math.min(aggregate.minY, subpath.bounds.minY),
        maxY: Math.max(aggregate.maxY, subpath.bounds.maxY)
    }), {
        minY: Number.POSITIVE_INFINITY,
        maxY: Number.NEGATIVE_INFINITY
    });
    const g = Math.max(0, Number(obstacle.gap || 0));
    const gapTop = Number.isFinite(Number(obstacle.gapTop)) ? Math.max(0, Number(obstacle.gapTop)) : g;
    const gapBottom = Number.isFinite(Number(obstacle.gapBottom)) ? Math.max(0, Number(obstacle.gapBottom)) : g;
    const sampleYBreaks = Array.from(new Set(
        subpaths.flatMap((subpath) => subpath.points.map((point) => point.y))
    )).sort((left, right) => left - right);

    const top = globalBounds.minY - gapTop;
    const bottom = globalBounds.maxY + gapBottom;
    const bands: ExclusionResistanceBand[] = [];

    for (let bandTop = top; bandTop < bottom; bandTop += CIRCLE_BAND_STEP) {
        const bandBottom = Math.min(bottom, bandTop + CIRCLE_BAND_STEP);
        const sampleYs = resolvePolygonSampleYs(bandTop, bandBottom, sampleYBreaks);
        const blocked = sampleYs.flatMap((sampleY) => queryPolygonScanlineIntervals(subpaths, sampleY, g));
        const merged = mergeBlockedIntervals(blocked);
        const band = createExclusionResistanceBand(
            bandTop,
            bandBottom,
            merged
                .map((interval) => createExclusionResistanceSpan(interval.left, interval.right, resolveObstacleResistance(obstacle)))
                .filter(nonNullable)
        );
        if (band) bands.push(band);
    }

    if (bands.length === 0) return null;
    return createExclusionResistanceField({
        mode: 'hard',
        wrap: obstacle.wrap,
        zIndex: normalizeZIndex(obstacle.zIndex),
        traversalInteraction: obstacle.traversalInteraction ?? 'auto',
        opticalMaxY: globalBounds.maxY,
        bands
    });
}

function resolveOverlappingBands(
    field: ExclusionResistanceField,
    top: number,
    bottom: number,
    opticalUnderhang: boolean = false
): readonly ExclusionResistanceBand[] {
    const effectiveMaxY = resolveEffectiveFieldMaxY(field, opticalUnderhang);
    if (!(bottom > field.minY && top < effectiveMaxY)) return [];
    return field.bands.filter((band) => band.bottom > top && band.top < bottom && band.top < effectiveMaxY);
}

function resolveCircleCarveLeft(
    align: StoryFloatAlign | undefined,
    x: number,
    w: number,
    cx: number,
    r: number,
    chordHalfWidth: number
): number {
    const normalizedAlign = align ?? 'center';
    if (normalizedAlign === 'right') return cx - chordHalfWidth;
    if (normalizedAlign === 'center') return cx - chordHalfWidth;
    return x - r - 1;
}

function resolveCircleCarveRight(
    align: StoryFloatAlign | undefined,
    x: number,
    w: number,
    cx: number,
    r: number,
    chordHalfWidth: number
): number {
    const normalizedAlign = align ?? 'center';
    if (normalizedAlign === 'left') return cx + chordHalfWidth;
    if (normalizedAlign === 'center') return cx + chordHalfWidth;
    return x + w + r + 1;
}

function compactSpans(spans: Array<ReturnType<typeof createExclusionResistanceSpan>>): ReturnType<typeof createExclusionResistanceSpan>[] {
    return spans.filter((span): span is NonNullable<typeof span> => span !== null);
}

function nonNullable<T>(value: T | null | undefined): value is T {
    return value !== null && value !== undefined;
}

function carveInterval(
    intervals: Interval[],
    removeLeft: number,
    removeRight: number
): Interval[] {
    const result: Interval[] = [];
    for (const interval of intervals) {
        const intervalRight = interval.x + interval.w;
        if (removeRight <= interval.x || removeLeft >= intervalRight) {
            result.push(interval);
            continue;
        }
        if (removeLeft > interval.x) {
            result.push({ x: interval.x, w: removeLeft - interval.x });
        }
        if (removeRight < intervalRight) {
            result.push({ x: removeRight, w: intervalRight - removeRight });
        }
    }
    return result;
}

function normalizeZIndex(value: unknown): number {
    return Number.isFinite(Number(value)) ? Number(value) : 0;
}

function intersectsDepth(
    traversalInteraction: TraversalInteractionPolicy | undefined,
    fieldZIndex: number,
    queryZIndex: number
): boolean {
    const policy = traversalInteraction ?? 'auto';
    if (policy === 'ignore' || policy === 'overpass') {
        return false;
    }
    if (policy === 'wrap') {
        return true;
    }
    return normalizeZIndex(fieldZIndex) === normalizeZIndex(queryZIndex);
}

function resolveBucketIndex(y: number): number {
    return Math.floor(Number(y) / DEFAULT_BUCKET_SIZE);
}

function resolveEffectiveFieldMaxY(field: ExclusionResistanceField, opticalUnderhang: boolean): number {
    if (opticalUnderhang && field.wrap === 'around' && Number.isFinite(field.opticalMaxY)) {
        return Number(field.opticalMaxY);
    }
    return field.maxY;
}

function tryResolvePolygonSubpaths(obstacle: OccupiedRect): SvgPathSubpath[] | null {
    try {
        const parsed = parseSvgPathSubpaths(String(obstacle.path || ''))
            .map((subpath) => translateSubpath(subpath, obstacle.x, obstacle.y))
            .filter((subpath) => subpath.points.length >= 3);
        return parsed.length > 0 ? parsed : null;
    } catch {
        return null;
    }
}

function translateSubpath(subpath: SvgPathSubpath, offsetX: number, offsetY: number): SvgPathSubpath {
    return {
        closed: subpath.closed,
        points: subpath.points.map((point) => ({
            x: point.x + offsetX,
            y: point.y + offsetY
        }))
    };
}

function getPathBounds(points: readonly SvgPathPoint[]): { minY: number; maxY: number } {
    return points.reduce((aggregate, point) => ({
        minY: Math.min(aggregate.minY, point.y),
        maxY: Math.max(aggregate.maxY, point.y)
    }), {
        minY: Number.POSITIVE_INFINITY,
        maxY: Number.NEGATIVE_INFINITY
    });
}

function resolvePolygonSampleYs(top: number, bottom: number, breakpoints: readonly number[]): number[] {
    const epsilon = 0.001;
    const normalizedBottom = Math.max(top, bottom);
    const midpoint = top + ((normalizedBottom - top) / 2);
    const samples = new Set<number>([
        top + epsilon,
        Math.max(top + epsilon, normalizedBottom - epsilon),
        midpoint
    ]);
    for (const value of breakpoints) {
        if (value > top && value < normalizedBottom) {
            samples.add(Math.min(normalizedBottom - epsilon, value + epsilon));
            samples.add(Math.max(top + epsilon, value - epsilon));
        }
    }
    return Array.from(samples)
        .filter((value) => value >= top && value <= normalizedBottom)
        .sort((left, right) => left - right);
}

function queryPolygonScanlineIntervals(
    subpaths: Array<{ points: SvgPathPoint[]; bounds: { minY: number; maxY: number } }>,
    y: number,
    gap: number
): Array<{ left: number; right: number }> {
    const intervals: Array<{ left: number; right: number }> = [];
    for (const subpath of subpaths) {
        if (y < subpath.bounds.minY || y > subpath.bounds.maxY) continue;
        const intersections = resolvePolygonIntersections(subpath.points, y);
        for (let index = 0; index + 1 < intersections.length; index += 2) {
            const left = intersections[index]!;
            const right = intersections[index + 1]!;
            if (!(right > left)) continue;
            intervals.push({
                left: left - gap,
                right: right + gap
            });
        }
    }
    return intervals;
}

function resolvePolygonIntersections(points: readonly SvgPathPoint[], y: number): number[] {
    const intersections: number[] = [];
    for (let index = 0; index < points.length; index += 1) {
        const start = points[index]!;
        const end = points[(index + 1) % points.length]!;
        if (approximatelyEqualNumber(start.y, end.y)) continue;
        const minY = Math.min(start.y, end.y);
        const maxY = Math.max(start.y, end.y);
        if (y < minY || y >= maxY) continue;
        const t = (y - start.y) / (end.y - start.y);
        intersections.push(start.x + ((end.x - start.x) * t));
    }
    return intersections.sort((left, right) => left - right);
}

function mergeBlockedIntervals(intervals: readonly Array<{ left: number; right: number }>): Array<{ left: number; right: number }> {
    if (intervals.length <= 1) return [...intervals];
    const sorted = [...intervals].sort((left, right) => left.left - right.left || left.right - right.right);
    const merged: Array<{ left: number; right: number }> = [];
    for (const interval of sorted) {
        const previous = merged[merged.length - 1];
        if (!previous || interval.left > previous.right) {
            merged.push({ ...interval });
            continue;
        }
        previous.right = Math.max(previous.right, interval.right);
    }
    return merged;
}

function approximatelyEqualNumber(left: number, right: number): boolean {
    return Math.abs(Number(left) - Number(right)) <= 0.0001;
}
