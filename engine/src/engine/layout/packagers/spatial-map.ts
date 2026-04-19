import { StoryExclusionBoundaryProfile, StoryFloatAlign, StoryWrapMode, TraversalInteractionPolicy } from '../../types';
import { ColliderField, type ColliderFieldStatsSnapshot } from '../collider-field';
import { ExclusionResistanceFieldMap } from '../exclusion-resistance-field-map';

// ---------------------------------------------------------------------------
// Interval - a horizontal slice of available space
// ---------------------------------------------------------------------------

export interface Interval {
    /** Left edge in content-area coordinates (0 = column left). */
    x: number;
    /** Width of the available interval. */
    w: number;
}

// ---------------------------------------------------------------------------
// OccupiedRect - a registered obstacle in story-local coordinates
// ---------------------------------------------------------------------------

export interface OccupiedRect {
    /** Content-area X (0 = column left). */
    x: number;
    /** Story-local Y (0 = story origin). */
    y: number;
    w: number;
    h: number;
    wrap: StoryWrapMode;
    /** Extra clearance applied uniformly to all four sides. */
    gap: number;
    /** Optional asymmetric vertical gap overrides. */
    gapTop?: number;
    gapBottom?: number;
    /** Exclusion-zone shape (default 'rect'). */
    shape?: 'rect' | 'circle' | 'ellipse' | 'polygon';
    /** Local SVG path used when `shape` is `polygon`. */
    path?: string;
    /** Optional compiled boundary-profile substrate. */
    exclusionBoundaryProfile?: StoryExclusionBoundaryProfile;
    /** Optional wrap resistance. 1 = hard obstacle, lower values = softer exclusion. */
    resistance?: number;
    /**
     * For circle / ellipse obstacles only: story-local Y of the shape centre.
     * Defaults to rect.y + rect.h / 2 when absent.
     * Carry-over round obstacles must supply this explicitly because their
     * rect.y is reset to 0 while the original centre may be on the previous page.
     */
    circleCy?: number;
    ellipseCy?: number;
    ellipseRy?: number;
    /**
     * Float alignment, used by rounded obstacles to decide which side of the
     * arc text wraps around. 'left' and 'right' extend the carve to the
     * opposite column edge so text never leaks into the near-side corner
     * regions (which are empty on a true circular image but would overlap a
     * rectangular placeholder). 'center' keeps the symmetric dual-stream
     * carve. Unset is treated as 'center'.
     */
    align?: StoryFloatAlign;
    /** Optional depth used for wrap interaction. Unset is treated as 0. */
    zIndex?: number;
    /** Optional authored traversal interaction override. */
    traversalInteraction?: TraversalInteractionPolicy;
}

// ---------------------------------------------------------------------------
// SpatialMap
// ---------------------------------------------------------------------------

/**
 * Tracks obstacle rectangles in story-local coordinates and answers
 * "what horizontal intervals are available for text at Y-slice [y, y+lineH]?"
 *
 * This remains the compatibility surface used by current packagers.
 * Internally it now delegates band queries to a collider field so we can grow
 * into richer collider types without forcing immediate caller changes.
 */
export class SpatialMap {
    private readonly rects: OccupiedRect[] = [];
    private readonly resistanceFieldMap: ExclusionResistanceFieldMap = new ExclusionResistanceFieldMap();
    private readonly colliderField: ColliderField = new ColliderField();

    clear(): void {
        this.rects.length = 0;
        this.resistanceFieldMap.clear();
        this.colliderField.clear();
    }

    register(rect: OccupiedRect): void {
        this.rects.push(rect);
        if (!this.resistanceFieldMap.registerObstacle(rect)) {
            this.colliderField.registerObstacle(rect);
        }
    }

    /**
     * Returns available X-intervals for a text line at [y, y+lineH] within
     * the column [0, totalWidth].
     *
     * Returns an empty array when a 'top-bottom' obstacle blocks the entire
     * line and the caller must advance Y via `topBottomClearY` and retry.
     */
    getAvailableIntervals(
        y: number,
        lineH: number,
        totalWidth: number,
        options?: { opticalUnderhang?: boolean; queryZIndex?: number }
    ): Interval[] {
        if (!this.resistanceFieldMap.hasFields) {
            return this.colliderField.getAvailableIntervals(y, lineH, totalWidth, options);
        }
        const fieldIntervals = this.resistanceFieldMap.getAvailableIntervals(y, lineH, totalWidth, options);
        const colliderIntervals = this.colliderField.getAvailableIntervals(y, lineH, totalWidth, options);
        return intersectIntervals(fieldIntervals, colliderIntervals);
    }

    /** Returns true when any top-bottom obstacle overlaps [y, y+lineH]. */
    hasTopBottomBlock(y: number, lineH: number, queryZIndex: number = 0): boolean {
        if (!this.resistanceFieldMap.hasFields) {
            return this.colliderField.hasTopBottomBlock(y, lineH, queryZIndex);
        }
        return this.resistanceFieldMap.hasTopBottomBlock(y, lineH, queryZIndex)
            || this.colliderField.hasTopBottomBlock(y, lineH, queryZIndex);
    }

    /**
     * Returns the first Y at which no top-bottom obstacle blocks [y, ...).
     * Iterates to handle chained consecutive obstacles.
     */
    topBottomClearY(y: number, queryZIndex: number = 0): number {
        if (!this.resistanceFieldMap.hasFields) {
            return this.colliderField.topBottomClearY(y, queryZIndex);
        }
        let clearY = y;
        let changed = true;
        while (changed) {
            changed = false;
            const fieldClearY = this.resistanceFieldMap.topBottomClearY(clearY, queryZIndex);
            const colliderClearY = this.colliderField.topBottomClearY(clearY, queryZIndex);
            const nextClearY = Math.max(clearY, fieldClearY, colliderClearY);
            if (nextClearY > clearY) {
                clearY = nextClearY;
                changed = true;
            }
        }
        return clearY;
    }

    /**
     * Returns the first Y after any obstacle band intersecting [y, y+lineH].
     * Unlike topBottomClearY, this also considers ordinary around-wrapped
     * colliders so callers can skip mathematically valid but unusable sliver
     * lanes and resume once the obstacle shoulder clears.
     */
    bandClearY(y: number, lineH: number, queryZIndex: number = 0, opticalUnderhang: boolean = false): number {
        if (!this.resistanceFieldMap.hasFields) {
            return this.colliderField.bandClearY(y, lineH, queryZIndex, opticalUnderhang);
        }
        let clearY = y;
        let changed = true;
        while (changed) {
            changed = false;
            const fieldClearY = this.resistanceFieldMap.bandClearY(clearY, lineH, queryZIndex, opticalUnderhang);
            const colliderClearY = this.colliderField.bandClearY(clearY, lineH, queryZIndex, opticalUnderhang);
            const nextClearY = Math.max(clearY, fieldClearY, colliderClearY);
            if (nextClearY > clearY) {
                clearY = nextClearY;
                changed = true;
            }
        }
        return clearY;
    }

    /** The Y of the lowest point among all registered obstacles. */
    maxObstacleBottom(): number {
        if (!this.resistanceFieldMap.hasFields) {
            return this.colliderField.maxObstacleBottom();
        }
        return Math.max(
            this.resistanceFieldMap.maxObstacleBottom(),
            this.colliderField.maxObstacleBottom()
        );
    }

    /** Snapshot of internal collider-field work counters for profiling. */
    getStatsSnapshot(): ColliderFieldStatsSnapshot {
        if (!this.resistanceFieldMap.hasFields) {
            return this.colliderField.getStatsSnapshot();
        }
        const fieldStats = this.resistanceFieldMap.getStatsSnapshot();
        const colliderStats = this.colliderField.getStatsSnapshot();
        return {
            registeredColliders: fieldStats.registeredColliders + colliderStats.registeredColliders,
            bucketCount: fieldStats.bucketCount + colliderStats.bucketCount,
            queryCalls: fieldStats.queryCalls + colliderStats.queryCalls,
            bucketTouches: fieldStats.bucketTouches + colliderStats.bucketTouches,
            candidateColliderCount: fieldStats.candidateColliderCount + colliderStats.candidateColliderCount,
            narrowphaseCalls: fieldStats.narrowphaseCalls + colliderStats.narrowphaseCalls
        };
    }

    /** Read-only access to registered rects (used by split carry-over logic). */
    getRects(): ReadonlyArray<OccupiedRect> {
        return this.rects;
    }
}

function intersectIntervals(left: readonly Interval[], right: readonly Interval[]): Interval[] {
    if (left.length === 0 || right.length === 0) return [];
    const intersections: Interval[] = [];
    let leftIndex = 0;
    let rightIndex = 0;

    while (leftIndex < left.length && rightIndex < right.length) {
        const leftInterval = left[leftIndex]!;
        const rightInterval = right[rightIndex]!;
        const start = Math.max(leftInterval.x, rightInterval.x);
        const end = Math.min(leftInterval.x + leftInterval.w, rightInterval.x + rightInterval.w);
        if (end > start) {
            intersections.push({ x: start, w: end - start });
        }
        if ((leftInterval.x + leftInterval.w) <= (rightInterval.x + rightInterval.w)) {
            leftIndex += 1;
        } else {
            rightIndex += 1;
        }
    }

    return mergeIntervals(intersections.filter((interval) => interval.w > 0.5));
}

function mergeIntervals(intervals: readonly Interval[]): Interval[] {
    if (intervals.length <= 1) return [...intervals];
    const sorted = [...intervals].sort((left, right) => left.x - right.x || left.w - right.w);
    const merged: Interval[] = [];

    for (const interval of sorted) {
        const previous = merged[merged.length - 1];
        const intervalRight = interval.x + interval.w;
        if (!previous) {
            merged.push({ ...interval });
            continue;
        }

        const previousRight = previous.x + previous.w;
        if (interval.x <= previousRight + 0.5) {
            previous.w = Math.max(previousRight, intervalRight) - previous.x;
            continue;
        }

        merged.push({ ...interval });
    }

    return merged.filter((interval) => interval.w > 0.5);
}
