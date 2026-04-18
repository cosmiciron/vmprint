import { StoryFloatAlign, StoryWrapMode, TraversalInteractionPolicy } from '../../types';
import { ColliderField, type ColliderFieldStatsSnapshot } from '../collider-field';

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
    shape?: 'rect' | 'circle' | 'polygon';
    /** Local SVG path used when `shape` is `polygon`. */
    path?: string;
    /**
     * For circle obstacles only: story-local Y of the circle centre.
     * Defaults to rect.y + rect.h / 2 when absent.
     * Carry-over circles must supply this explicitly because their rect.y is
     * reset to 0 while the original centre may be on the previous page.
     */
    circleCy?: number;
    /**
     * Float alignment, used by circle obstacles to decide which side of the
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
    private readonly colliderField: ColliderField = new ColliderField();

    clear(): void {
        this.rects.length = 0;
        this.colliderField.clear();
    }

    register(rect: OccupiedRect): void {
        this.rects.push(rect);
        this.colliderField.registerObstacle(rect);
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
        return this.colliderField.getAvailableIntervals(y, lineH, totalWidth, options);
    }

    /** Returns true when any top-bottom obstacle overlaps [y, y+lineH]. */
    hasTopBottomBlock(y: number, lineH: number, queryZIndex: number = 0): boolean {
        return this.colliderField.hasTopBottomBlock(y, lineH, queryZIndex);
    }

    /**
     * Returns the first Y at which no top-bottom obstacle blocks [y, ...).
     * Iterates to handle chained consecutive obstacles.
     */
    topBottomClearY(y: number, queryZIndex: number = 0): number {
        return this.colliderField.topBottomClearY(y, queryZIndex);
    }

    /**
     * Returns the first Y after any obstacle band intersecting [y, y+lineH].
     * Unlike topBottomClearY, this also considers ordinary around-wrapped
     * colliders so callers can skip mathematically valid but unusable sliver
     * lanes and resume once the obstacle shoulder clears.
     */
    bandClearY(y: number, lineH: number, queryZIndex: number = 0, opticalUnderhang: boolean = false): number {
        return this.colliderField.bandClearY(y, lineH, queryZIndex, opticalUnderhang);
    }

    /** The Y of the lowest point among all registered obstacles. */
    maxObstacleBottom(): number {
        return this.colliderField.maxObstacleBottom();
    }

    /** Snapshot of internal collider-field work counters for profiling. */
    getStatsSnapshot(): ColliderFieldStatsSnapshot {
        return this.colliderField.getStatsSnapshot();
    }

    /** Read-only access to registered rects (used by split carry-over logic). */
    getRects(): ReadonlyArray<OccupiedRect> {
        return this.rects;
    }
}
