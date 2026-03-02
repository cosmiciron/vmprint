import { StoryWrapMode } from '../../types';

// ---------------------------------------------------------------------------
// Interval – a horizontal slice of available space
// ---------------------------------------------------------------------------

export interface Interval {
    /** Left edge in content-area coordinates (0 = column left). */
    x: number;
    /** Width of the available interval. */
    w: number;
}

// ---------------------------------------------------------------------------
// OccupiedRect – a registered obstacle in story-local coordinates
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
}

// ---------------------------------------------------------------------------
// SpatialMap
// ---------------------------------------------------------------------------

/**
 * Tracks obstacle rectangles (images) in story-local coordinates and answers
 * "what horizontal intervals are available for text at Y-slice [y, y+lineH]?"
 *
 * All coordinates are story-local; the origin is the top of the story's
 * content area (after the parent margin/padding).
 *
 * Wrap semantics:
 *   'none'       – obstacle is purely visual; full width always available.
 *   'top-bottom' – line is fully blocked; caller must advance Y past obstacle.
 *   'around'     – intervals remaining after subtracting the obstacle X-range.
 */
export class SpatialMap {
    private readonly rects: OccupiedRect[] = [];

    register(rect: OccupiedRect): void {
        this.rects.push(rect);
    }

    /**
     * Returns available X-intervals for a text line at [y, y+lineH] within
     * the column [0, totalWidth].
     *
     * Returns an empty array when a 'top-bottom' obstacle blocks the entire
     * line — the caller must advance Y via `topBottomClearY` and retry.
     */
    getAvailableIntervals(
        y: number,
        lineH: number,
        totalWidth: number,
        options?: { opticalUnderhang?: boolean },
    ): Interval[] {
        let available: Interval[] = [{ x: 0, w: totalWidth }];
        const lineBottom = y + lineH;
        const lineTop = y;

        for (const rect of this.rects) {
            if (rect.wrap === 'none') continue;

            const g = rect.gap;
            const gapTop = rect.gapTop ?? g;
            const gapBottom = rect.gapBottom ?? g;
            const obsTop = rect.y - gapTop;
            const obsBottom = rect.y + rect.h + gapBottom;
            const useOpticalUnderhang = options?.opticalUnderhang && rect.wrap === 'around';
            const overlapBottom = useOpticalUnderhang ? rect.y + rect.h : obsBottom;

            if (lineBottom <= obsTop || lineTop >= overlapBottom) continue; // no Y overlap

            if (rect.wrap === 'top-bottom') return []; // entire line blocked

            // wrap === 'around': carve the obstacle's X-range from available intervals
            const obsLeft = rect.x - g;
            const obsRight = rect.x + rect.w + g;
            available = carveInterval(available, obsLeft, obsRight);
        }

        return available.filter((iv) => iv.w > 0.5);
    }

    /** Returns true when any top-bottom obstacle overlaps [y, y+lineH]. */
    hasTopBottomBlock(y: number, lineH: number): boolean {
        const lineBottom = y + lineH;
        return this.rects.some((r) => {
            if (r.wrap !== 'top-bottom') return false;
            const gapTop = r.gapTop ?? r.gap;
            const gapBottom = r.gapBottom ?? r.gap;
            const obsTop = r.y - gapTop;
            const obsBottom = r.y + r.h + gapBottom;
            return lineBottom > obsTop && y < obsBottom;
        });
    }

    /**
     * Returns the first Y at which no top-bottom obstacle blocks [y, …).
     * Iterates to handle chained consecutive obstacles.
     */
    topBottomClearY(y: number): number {
        let clearY = y;
        let changed = true;
        while (changed) {
            changed = false;
            for (const r of this.rects) {
                if (r.wrap !== 'top-bottom') continue;
                const gapTop = r.gapTop ?? r.gap;
                const gapBottom = r.gapBottom ?? r.gap;
                const obsTop = r.y - gapTop;
                const obsBottom = r.y + r.h + gapBottom;
                if (clearY < obsBottom && clearY >= obsTop) {
                    clearY = obsBottom;
                    changed = true;
                }
            }
        }
        return clearY;
    }

    /** The Y of the lowest point among all registered obstacles. */
    maxObstacleBottom(): number {
        return this.rects.reduce((max, r) => Math.max(max, r.y + r.h + (r.gapBottom ?? r.gap)), 0);
    }

    /** Read-only access to registered rects (used by split carry-over logic). */
    getRects(): ReadonlyArray<OccupiedRect> {
        return this.rects;
    }
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Subtracts [removeLeft, removeRight] from a set of disjoint intervals,
 * returning the remaining fragments.
 */
function carveInterval(intervals: Interval[], removeLeft: number, removeRight: number): Interval[] {
    const result: Interval[] = [];
    for (const iv of intervals) {
        const ivRight = iv.x + iv.w;
        if (removeRight <= iv.x || removeLeft >= ivRight) {
            // No overlap — keep as-is
            result.push(iv);
            continue;
        }
        // Left fragment
        if (removeLeft > iv.x) {
            result.push({ x: iv.x, w: removeLeft - iv.x });
        }
        // Right fragment
        if (removeRight < ivRight) {
            result.push({ x: removeRight, w: ivRight - removeRight });
        }
    }
    return result;
}
