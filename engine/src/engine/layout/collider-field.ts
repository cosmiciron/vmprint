import type { StoryWrapMode, TraversalInteractionPolicy } from '../types';
import { parseSvgPathSubpaths, type SvgPathPoint, type SvgPathSubpath } from '../geometry/svg-path';
import type { Interval, OccupiedRect } from './packagers/spatial-map';

const DEFAULT_BUCKET_SIZE = 64;

export type BandQuery = {
    top: number;
    bottom: number;
    queryZIndex: number;
    opticalUnderhang?: boolean;
};

export type BlockedInterval = {
    left: number;
    right: number;
};

export type ColliderFieldStatsSnapshot = {
    registeredColliders: number;
    bucketCount: number;
    queryCalls: number;
    bucketTouches: number;
    candidateColliderCount: number;
    narrowphaseCalls: number;
};

export interface CompiledCollider {
    readonly wrap: StoryWrapMode;
    readonly zIndex: number;
    readonly traversalInteraction: TraversalInteractionPolicy;
    readonly minY: number;
    readonly maxY: number;

    overlapsBand(query: BandQuery): boolean;
    queryBand(query: BandQuery): readonly BlockedInterval[];
    getBottomExtent(opticalUnderhang?: boolean): number;
}

class RectCollider implements CompiledCollider {
    readonly wrap: StoryWrapMode;
    readonly zIndex: number;
    readonly traversalInteraction: TraversalInteractionPolicy;
    readonly minY: number;
    readonly maxY: number;

    constructor(private readonly obstacle: OccupiedRect) {
        this.wrap = obstacle.wrap;
        this.zIndex = normalizeZIndex(obstacle.zIndex);
        this.traversalInteraction = obstacle.traversalInteraction ?? 'auto';
        const g = obstacle.gap;
        const gapTop = obstacle.gapTop ?? g;
        const gapBottom = obstacle.gapBottom ?? g;
        this.minY = obstacle.y - gapTop;
        this.maxY = obstacle.y + obstacle.h + gapBottom;
    }

    overlapsBand(query: BandQuery): boolean {
        const g = this.obstacle.gap;
        const gapTop = this.obstacle.gapTop ?? g;
        const gapBottom = this.obstacle.gapBottom ?? g;
        const obsTop = this.obstacle.y - gapTop;
        const obsBottom = this.obstacle.y + this.obstacle.h + gapBottom;
        const overlapBottom = query.opticalUnderhang && this.wrap === 'around'
            ? (this.obstacle.y + this.obstacle.h)
            : obsBottom;
        return query.bottom > obsTop && query.top < overlapBottom;
    }

    queryBand(query: BandQuery): readonly BlockedInterval[] {
        if (!this.overlapsBand(query)) return [];
        const g = this.obstacle.gap;
        return [{
            left: this.obstacle.x - g,
            right: this.obstacle.x + this.obstacle.w + g
        }];
    }

    getBottomExtent(_opticalUnderhang?: boolean): number {
        return this.obstacle.y + this.obstacle.h + (this.obstacle.gapBottom ?? this.obstacle.gap);
    }
}

class CircleCollider implements CompiledCollider {
    readonly wrap: StoryWrapMode;
    readonly zIndex: number;
    readonly traversalInteraction: TraversalInteractionPolicy;
    readonly minY: number;
    readonly maxY: number;

    constructor(private readonly obstacle: OccupiedRect) {
        this.wrap = obstacle.wrap;
        this.zIndex = normalizeZIndex(obstacle.zIndex);
        this.traversalInteraction = obstacle.traversalInteraction ?? 'auto';
        const cy = obstacle.circleCy ?? (obstacle.y + obstacle.h / 2);
        const r = obstacle.w / 2 + obstacle.gap;
        this.minY = cy - r;
        this.maxY = cy + r;
    }

    overlapsBand(query: BandQuery): boolean {
        const cy = this.obstacle.circleCy ?? (this.obstacle.y + this.obstacle.h / 2);
        const r = this.obstacle.w / 2 + this.obstacle.gap;
        const circleTop = cy - r;
        const circleBottom = query.opticalUnderhang && this.wrap === 'around'
            ? cy + this.obstacle.w / 2
            : cy + r;
        return query.bottom > circleTop && query.top < circleBottom;
    }

    queryBand(query: BandQuery): readonly BlockedInterval[] {
        if (!this.overlapsBand(query)) return [];

        const cx = this.obstacle.x + this.obstacle.w / 2;
        const cy = this.obstacle.circleCy ?? (this.obstacle.y + this.obstacle.h / 2);
        const r = this.obstacle.w / 2 + this.obstacle.gap;

        const yClosest = Math.max(query.top, Math.min(query.bottom, cy));
        const dy = yClosest - cy;
        const chordHalfW = Math.sqrt(Math.max(0, r * r - dy * dy));

        const align = this.obstacle.align ?? 'center';
        const carveLeft = align === 'right'
            ? cx - chordHalfW
            : align === 'center'
                ? cx - chordHalfW
                : this.obstacle.x - r - 1;
        const carveRight = align === 'left'
            ? cx + chordHalfW
            : align === 'center'
                ? cx + chordHalfW
                : this.obstacle.x + this.obstacle.w + r + 1;
        return [{ left: carveLeft, right: carveRight }];
    }

    getBottomExtent(_opticalUnderhang?: boolean): number {
        return this.obstacle.y + this.obstacle.h + (this.obstacle.gapBottom ?? this.obstacle.gap);
    }
}

class EllipseCollider implements CompiledCollider {
    readonly wrap: StoryWrapMode;
    readonly zIndex: number;
    readonly traversalInteraction: TraversalInteractionPolicy;
    readonly minY: number;
    readonly maxY: number;

    constructor(private readonly obstacle: OccupiedRect) {
        this.wrap = obstacle.wrap;
        this.zIndex = normalizeZIndex(obstacle.zIndex);
        this.traversalInteraction = obstacle.traversalInteraction ?? 'auto';
        const cy = obstacle.ellipseCy ?? (obstacle.y + obstacle.h / 2);
        const baseRy = obstacle.ellipseRy ?? (obstacle.h / 2);
        const ry = baseRy + obstacle.gap;
        this.minY = cy - ry;
        this.maxY = cy + ry;
    }

    overlapsBand(query: BandQuery): boolean {
        const cy = this.obstacle.ellipseCy ?? (this.obstacle.y + this.obstacle.h / 2);
        const baseRy = this.obstacle.ellipseRy ?? (this.obstacle.h / 2);
        const ry = baseRy + this.obstacle.gap;
        const ellipseTop = cy - ry;
        const ellipseBottom = query.opticalUnderhang && this.wrap === 'around'
            ? cy + baseRy
            : cy + ry;
        return query.bottom > ellipseTop && query.top < ellipseBottom;
    }

    queryBand(query: BandQuery): readonly BlockedInterval[] {
        if (!this.overlapsBand(query)) return [];

        const cx = this.obstacle.x + this.obstacle.w / 2;
        const cy = this.obstacle.ellipseCy ?? (this.obstacle.y + this.obstacle.h / 2);
        const rx = this.obstacle.w / 2 + this.obstacle.gap;
        const baseRy = this.obstacle.ellipseRy ?? (this.obstacle.h / 2);
        const ry = baseRy + this.obstacle.gap;
        if (rx <= 0 || ry <= 0) return [];

        const yClosest = Math.max(query.top, Math.min(query.bottom, cy));
        const dy = yClosest - cy;
        const normalizedY = Math.max(-1, Math.min(1, dy / ry));
        const chordHalfW = rx * Math.sqrt(Math.max(0, 1 - (normalizedY * normalizedY)));

        const align = this.obstacle.align ?? 'center';
        const carveLeft = align === 'right'
            ? cx - chordHalfW
            : align === 'center'
                ? cx - chordHalfW
                : this.obstacle.x - rx - 1;
        const carveRight = align === 'left'
            ? cx + chordHalfW
            : align === 'center'
                ? cx + chordHalfW
                : this.obstacle.x + this.obstacle.w + rx + 1;
        return [{ left: carveLeft, right: carveRight }];
    }

    getBottomExtent(_opticalUnderhang?: boolean): number {
        return this.obstacle.y + this.obstacle.h + (this.obstacle.gapBottom ?? this.obstacle.gap);
    }
}

class PolygonCollider implements CompiledCollider {
    readonly wrap: StoryWrapMode;
    readonly zIndex: number;
    readonly traversalInteraction: TraversalInteractionPolicy;
    readonly minY: number;
    readonly maxY: number;
    private readonly baseMinY: number;
    private readonly baseMaxY: number;
    private readonly subpaths: Array<{ points: SvgPathPoint[]; bounds: { minY: number; maxY: number } }>;
    private readonly sampleYBreaks: number[];

    constructor(
        private readonly obstacle: OccupiedRect,
        translatedSubpaths: SvgPathSubpath[]
    ) {
        this.wrap = obstacle.wrap;
        this.zIndex = normalizeZIndex(obstacle.zIndex);
        this.traversalInteraction = obstacle.traversalInteraction ?? 'auto';

        if (translatedSubpaths.length === 0) {
            throw new Error('[ColliderField] Polygon collider requires a non-empty path with at least three points.');
        }

        this.subpaths = translatedSubpaths.map((subpath) => ({
            points: subpath.points,
            bounds: getPathBounds(subpath.points)
        }));
        const bounds = this.subpaths.reduce((aggregate, subpath) => ({
            minY: Math.min(aggregate.minY, subpath.bounds.minY),
            maxY: Math.max(aggregate.maxY, subpath.bounds.maxY)
        }), {
            minY: Number.POSITIVE_INFINITY,
            maxY: Number.NEGATIVE_INFINITY
        });
        this.baseMinY = bounds.minY;
        this.baseMaxY = bounds.maxY;
        const g = obstacle.gap;
        const gapTop = obstacle.gapTop ?? g;
        const gapBottom = obstacle.gapBottom ?? g;
        this.minY = this.baseMinY - gapTop;
        this.maxY = this.baseMaxY + gapBottom;
        this.sampleYBreaks = Array.from(new Set(
            this.subpaths.flatMap((subpath) => subpath.points.map((point) => point.y))
        )).sort((left, right) => left - right);
    }

    overlapsBand(query: BandQuery): boolean {
        const overlapBottom = query.opticalUnderhang && this.wrap === 'around'
            ? this.baseMaxY
            : this.maxY;
        return query.bottom > this.minY && query.top < overlapBottom;
    }

    queryBand(query: BandQuery): readonly BlockedInterval[] {
        if (!this.overlapsBand(query)) return [];

        const sampleYs = resolvePolygonSampleYs(query.top, query.bottom, this.sampleYBreaks);
        const intervals: BlockedInterval[] = [];
        for (const sampleY of sampleYs) {
            for (const interval of this.queryScanlineIntervals(sampleY)) {
                intervals.push(interval);
            }
        }
        return mergeBlockedIntervals(intervals);
    }

    getBottomExtent(_opticalUnderhang?: boolean): number {
        return this.baseMaxY + (this.obstacle.gapBottom ?? this.obstacle.gap);
    }

    private queryScanlineIntervals(y: number): BlockedInterval[] {
        const intervals: BlockedInterval[] = [];
        for (const subpath of this.subpaths) {
            if (y < subpath.bounds.minY || y > subpath.bounds.maxY) continue;
            const intersections = resolvePolygonIntersections(subpath.points, y);
            for (let index = 0; index + 1 < intersections.length; index += 2) {
                const left = intersections[index]!;
                const right = intersections[index + 1]!;
                if (!(right > left)) continue;
                intervals.push({
                    left: left - this.obstacle.gap,
                    right: right + this.obstacle.gap
                });
            }
        }
        return mergeBlockedIntervals(intervals);
    }
}

export class ColliderField {
    private readonly colliders: CompiledCollider[] = [];
    private readonly bucketToColliderIndexes = new Map<number, number[]>();
    private queryCalls = 0;
    private bucketTouches = 0;
    private candidateColliderCount = 0;
    private narrowphaseCalls = 0;

    clear(): void {
        this.colliders.length = 0;
        this.bucketToColliderIndexes.clear();
        this.queryCalls = 0;
        this.bucketTouches = 0;
        this.candidateColliderCount = 0;
        this.narrowphaseCalls = 0;
    }

    registerObstacle(obstacle: OccupiedRect): void {
        const collider = compileCollider(obstacle);
        const colliderIndex = this.colliders.push(collider) - 1;
        this.registerColliderInBuckets(collider, colliderIndex);
    }

    getAvailableIntervals(
        y: number,
        lineH: number,
        totalWidth: number,
        options?: { opticalUnderhang?: boolean; queryZIndex?: number }
    ): Interval[] {
        let available: Interval[] = [{ x: 0, w: totalWidth }];
        const query: BandQuery = {
            top: y,
            bottom: y + lineH,
            queryZIndex: normalizeZIndex(options?.queryZIndex),
            opticalUnderhang: options?.opticalUnderhang === true
        };

        for (const collider of this.getCandidateColliders(query.top, query.bottom)) {
            this.narrowphaseCalls += 1;
            if (collider.wrap === 'none') continue;
            if (!intersectsDepth(collider, query.queryZIndex)) continue;
            if (!collider.overlapsBand(query)) continue;
            if (collider.wrap === 'top-bottom') return [];
            for (const interval of collider.queryBand(query)) {
                available = carveInterval(available, interval.left, interval.right);
            }
        }

        return available.filter((iv) => iv.w > 0.5);
    }

    hasTopBottomBlock(y: number, lineH: number, queryZIndex: number = 0): boolean {
        const query: BandQuery = {
            top: y,
            bottom: y + lineH,
            queryZIndex: normalizeZIndex(queryZIndex)
        };
        for (const collider of this.getCandidateColliders(query.top, query.bottom)) {
            this.narrowphaseCalls += 1;
            if (
                collider.wrap === 'top-bottom'
                && intersectsDepth(collider, query.queryZIndex)
                && collider.overlapsBand(query)
            ) {
                return true;
            }
        }
        return false;
    }

    topBottomClearY(y: number, queryZIndex: number = 0): number {
        let clearY = y;
        let changed = true;
        while (changed) {
            changed = false;
            for (const collider of this.getCandidateColliders(clearY, clearY)) {
                this.narrowphaseCalls += 1;
                if (collider.wrap !== 'top-bottom') continue;
                if (!intersectsDepth(collider, normalizeZIndex(queryZIndex))) continue;
                const bottom = collider.getBottomExtent();
                const query: BandQuery = {
                    top: clearY,
                    bottom: clearY,
                    queryZIndex: normalizeZIndex(queryZIndex)
                };
                if (!collider.overlapsBand(query) || clearY >= bottom) continue;
                clearY = bottom;
                changed = true;
            }
        }
        return clearY;
    }

    bandClearY(y: number, lineH: number, queryZIndex: number = 0, opticalUnderhang: boolean = false): number {
        const normalizedZIndex = normalizeZIndex(queryZIndex);
        let clearY = y;
        let changed = true;
        while (changed) {
            changed = false;
            const query: BandQuery = {
                top: clearY,
                bottom: clearY + lineH,
                queryZIndex: normalizedZIndex,
                opticalUnderhang
            };
            for (const collider of this.getCandidateColliders(query.top, query.bottom)) {
                this.narrowphaseCalls += 1;
                if (collider.wrap === 'none') continue;
                if (!intersectsDepth(collider, normalizedZIndex)) continue;
                if (!collider.overlapsBand(query)) continue;
                const bottom = collider.getBottomExtent();
                if (bottom <= clearY) continue;
                clearY = bottom;
                changed = true;
            }
        }
        return clearY;
    }

    maxObstacleBottom(): number {
        return this.colliders.reduce((max, collider) => Math.max(max, collider.getBottomExtent()), 0);
    }

    getStatsSnapshot(): ColliderFieldStatsSnapshot {
        return {
            registeredColliders: this.colliders.length,
            bucketCount: this.bucketToColliderIndexes.size,
            queryCalls: this.queryCalls,
            bucketTouches: this.bucketTouches,
            candidateColliderCount: this.candidateColliderCount,
            narrowphaseCalls: this.narrowphaseCalls
        };
    }

    private registerColliderInBuckets(collider: CompiledCollider, colliderIndex: number): void {
        const startBucket = resolveBucketIndex(collider.minY);
        const endBucket = resolveBucketIndex(collider.maxY);
        for (let bucket = startBucket; bucket <= endBucket; bucket++) {
            const indexes = this.bucketToColliderIndexes.get(bucket) ?? [];
            indexes.push(colliderIndex);
            this.bucketToColliderIndexes.set(bucket, indexes);
        }
    }

    private getCandidateColliders(top: number, bottom: number): CompiledCollider[] {
        this.queryCalls += 1;
        if (this.colliders.length <= 1) return this.colliders;

        const startBucket = resolveBucketIndex(top);
        const endBucket = resolveBucketIndex(bottom);
        const seen = new Set<number>();
        const candidates: CompiledCollider[] = [];

        for (let bucket = startBucket; bucket <= endBucket; bucket++) {
            this.bucketTouches += 1;
            const indexes = this.bucketToColliderIndexes.get(bucket);
            if (!indexes) continue;
            for (const index of indexes) {
                if (seen.has(index)) continue;
                seen.add(index);
                candidates.push(this.colliders[index]!);
            }
        }

        const resolved = candidates.length > 0 ? candidates : this.colliders;
        this.candidateColliderCount += resolved.length;
        return resolved;
    }
}

function compileCollider(obstacle: OccupiedRect): CompiledCollider {
    if (obstacle.shape === 'circle') {
        return new CircleCollider(obstacle);
    }
    if (obstacle.shape === 'ellipse') {
        return new EllipseCollider(obstacle);
    }
    if (obstacle.shape === 'polygon') {
        const translatedSubpaths = tryResolvePolygonSubpaths(obstacle);
        if (translatedSubpaths && translatedSubpaths.length > 0) {
            return new PolygonCollider(obstacle, translatedSubpaths);
        }
        return new RectCollider(obstacle);
    }
    return new RectCollider(obstacle);
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

function carveInterval(
    intervals: Interval[],
    removeLeft: number,
    removeRight: number
): Interval[] {
    const result: Interval[] = [];
    for (const iv of intervals) {
        const ivRight = iv.x + iv.w;
        if (removeRight <= iv.x || removeLeft >= ivRight) {
            result.push(iv);
            continue;
        }
        if (removeLeft > iv.x) {
            result.push({ x: iv.x, w: removeLeft - iv.x });
        }
        if (removeRight < ivRight) {
            result.push({ x: removeRight, w: ivRight - removeRight });
        }
    }
    return result;
}

function normalizeZIndex(value: unknown): number {
    return Number.isFinite(Number(value)) ? Number(value) : 0;
}

function intersectsDepth(collider: CompiledCollider, queryZIndex: number): boolean {
    const policy = collider.traversalInteraction ?? 'auto';
    if (policy === 'ignore' || policy === 'overpass') {
        return false;
    }
    if (policy === 'wrap') {
        return true;
    }
    return normalizeZIndex(collider.zIndex) === normalizeZIndex(queryZIndex);
}

function resolveBucketIndex(y: number): number {
    return Math.floor(Number(y) / DEFAULT_BUCKET_SIZE);
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

function resolvePolygonIntersections(points: readonly SvgPathPoint[], y: number): number[] {
    const intersections: number[] = [];
    for (let index = 0; index < points.length; index++) {
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

function mergeBlockedIntervals(intervals: readonly BlockedInterval[]): BlockedInterval[] {
    if (intervals.length <= 1) return [...intervals];
    const sorted = [...intervals].sort((left, right) => left.left - right.left || left.right - right.right);
    const merged: BlockedInterval[] = [];
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
