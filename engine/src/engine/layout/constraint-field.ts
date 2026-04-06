import type { Box } from '../types';
import { LAYOUT_DEFAULTS } from './defaults';
import type {
    ActiveExclusionBand,
    ContentBand,
    PlacementFrameMargins,
    RegionReservation,
    SpatialExclusion,
    SpatialPlacementSurface
} from './runtime/session/session-spatial-types';

type HorizontalInterval = {
    start: number;
    end: number;
};

export type ResolvedPlacementFrame = SpatialPlacementSurface & {
    availableWidth: number;
    margins: PlacementFrameMargins;
};

export type SpatialPlacementDecision =
    | { action: 'commit' }
    | { action: 'defer'; nextCursorY: number };

export class ConstraintField {
    readonly reservations: RegionReservation[] = [];
    readonly exclusions: SpatialExclusion[] = [];

    constructor(
        public availableWidth: number,
        public availableHeight: number
    ) { }

    get effectiveAvailableHeight(): number {
        const reserved = this.reservations.reduce((sum, reservation) => {
            const height = Number.isFinite(reservation.height) ? Math.max(0, Number(reservation.height)) : 0;
            return sum + height;
        }, 0);
        return Math.max(0, this.availableHeight - reserved);
    }

    resolveBlockedCursorY(cursorY: number): number {
        let resolvedY = Number.isFinite(cursorY) ? Number(cursorY) : 0;
        let advanced = true;

        while (advanced) {
            advanced = false;
            for (const exclusion of this.exclusions) {
                const top = Number.isFinite(exclusion.y) ? Math.max(0, Number(exclusion.y)) : 0;
                const bottom = top + (Number.isFinite(exclusion.h) ? Math.max(0, Number(exclusion.h)) : 0);
                const spansWidth =
                    Number(exclusion.x) <= LAYOUT_DEFAULTS.wrapTolerance &&
                    (Number(exclusion.x) + Number(exclusion.w)) >= (this.availableWidth - LAYOUT_DEFAULTS.wrapTolerance);
                if (!spansWidth) continue;
                if (resolvedY + LAYOUT_DEFAULTS.wrapTolerance < top) continue;
                if (resolvedY >= bottom - LAYOUT_DEFAULTS.wrapTolerance) continue;
                resolvedY = bottom;
                advanced = true;
            }
        }

        return resolvedY;
    }

    resolveActiveContentBand(cursorY: number): ContentBand | null {
        const activeBand = this.resolveActiveExclusionBand(cursorY);
        if (!activeBand) return null;
        const mergedIntervals = this.resolveMergedHorizontalExclusionIntervals(activeBand.exclusions);
        const contentIntervals = this.resolveAvailableHorizontalIntervals(mergedIntervals);
        if (!contentIntervals.length) return null;

        const widestInterval = contentIntervals.reduce((best, candidate) => {
            const bestWidth = best.end - best.start;
            const candidateWidth = candidate.end - candidate.start;
            if (candidateWidth > bestWidth + LAYOUT_DEFAULTS.wrapTolerance) return candidate;
            if (Math.abs(candidateWidth - bestWidth) <= LAYOUT_DEFAULTS.wrapTolerance && candidate.start < best.start) {
                return candidate;
            }
            return best;
        });

        const width = Math.max(0, widestInterval.end - widestInterval.start);
        if (width >= this.availableWidth - LAYOUT_DEFAULTS.wrapTolerance) return null;
        return {
            xOffset: widestInterval.start,
            width
        };
    }

    resolveActiveExclusionBand(cursorY: number): ActiveExclusionBand | null {
        const resolvedY = Number.isFinite(cursorY) ? Number(cursorY) : 0;
        const activeExclusions: SpatialExclusion[] = [];
        let top = Number.POSITIVE_INFINITY;
        let bottom = 0;

        for (const exclusion of this.exclusions) {
            const exclusionTop = Number.isFinite(exclusion.y) ? Math.max(0, Number(exclusion.y)) : 0;
            const exclusionBottom = exclusionTop + (Number.isFinite(exclusion.h) ? Math.max(0, Number(exclusion.h)) : 0);
            if (resolvedY + LAYOUT_DEFAULTS.wrapTolerance < exclusionTop) continue;
            if (resolvedY >= exclusionBottom - LAYOUT_DEFAULTS.wrapTolerance) continue;

            activeExclusions.push(exclusion);
            top = Math.min(top, exclusionTop);
            bottom = Math.max(bottom, exclusionBottom);
        }

        if (!activeExclusions.length) return null;
        return { exclusions: activeExclusions, top, bottom };
    }

    resolvePlacementSurface(cursorY: number): SpatialPlacementSurface {
        const resolvedCursorY = this.resolveBlockedCursorY(cursorY);
        const activeBand = this.resolveActiveExclusionBand(resolvedCursorY);
        return {
            cursorY: resolvedCursorY,
            activeBand,
            contentBand: activeBand ? this.resolveActiveContentBand(resolvedCursorY) : null
        };
    }

    resolvePlacementFrame(cursorY: number, margins: PlacementFrameMargins): ResolvedPlacementFrame {
        const surface = this.resolvePlacementSurface(cursorY);
        const laneLeftOffset = surface.contentBand?.xOffset ?? 0;
        const laneRightOffset = Math.max(
            0,
            (this.availableWidth - laneLeftOffset) - (surface.contentBand?.width ?? this.availableWidth)
        );

        return {
            ...surface,
            availableWidth: surface.contentBand?.width ?? this.availableWidth,
            margins: surface.contentBand
                ? {
                    left: margins.left + laneLeftOffset,
                    right: margins.right + laneRightOffset
                }
                : margins
        };
    }

    evaluatePlacement(boxes: readonly Box[], cursorY: number): SpatialPlacementDecision {
        const activeBand = this.resolveActiveExclusionBand(cursorY);
        if (!activeBand) {
            return { action: 'commit' };
        }

        for (const box of boxes) {
            const boxLeft = Number.isFinite(box.x) ? Number(box.x) : 0;
            const boxTop = Number.isFinite(box.y) ? Math.max(0, Number(box.y)) : 0;
            const boxRight = boxLeft + (Number.isFinite(box.w) ? Math.max(0, Number(box.w)) : 0);
            const boxBottom = boxTop + (Number.isFinite(box.h) ? Math.max(0, Number(box.h)) : 0);

            for (const exclusion of activeBand.exclusions) {
                const exclusionLeft = Number.isFinite(exclusion.x) ? Number(exclusion.x) : 0;
                const exclusionTop = Number.isFinite(exclusion.y) ? Math.max(0, Number(exclusion.y)) : 0;
                const exclusionRight = exclusionLeft + (Number.isFinite(exclusion.w) ? Math.max(0, Number(exclusion.w)) : 0);
                const exclusionBottom = exclusionTop + (Number.isFinite(exclusion.h) ? Math.max(0, Number(exclusion.h)) : 0);

                const overlapsHorizontally =
                    boxLeft < exclusionRight - LAYOUT_DEFAULTS.wrapTolerance &&
                    boxRight > exclusionLeft + LAYOUT_DEFAULTS.wrapTolerance;
                const overlapsVertically =
                    boxTop < exclusionBottom - LAYOUT_DEFAULTS.wrapTolerance &&
                    boxBottom > exclusionTop + LAYOUT_DEFAULTS.wrapTolerance;
                if (overlapsHorizontally && overlapsVertically) {
                    return {
                        action: 'defer',
                        nextCursorY: activeBand.bottom
                    };
                }
            }
        }

        return { action: 'commit' };
    }

    private resolveMergedHorizontalExclusionIntervals(exclusions: readonly SpatialExclusion[]): HorizontalInterval[] {
        const intervals = exclusions
            .map((exclusion): HorizontalInterval | null => {
                const start = Number.isFinite(exclusion.x) ? Math.max(0, Math.min(this.availableWidth, Number(exclusion.x))) : 0;
                const width = Number.isFinite(exclusion.w) ? Math.max(0, Number(exclusion.w)) : 0;
                const end = Math.max(start, Math.min(this.availableWidth, start + width));
                if (end - start <= LAYOUT_DEFAULTS.wrapTolerance) return null;
                return { start, end };
            })
            .filter((interval): interval is HorizontalInterval => interval !== null)
            .sort((a, b) => a.start - b.start);

        if (!intervals.length) return [];

        const merged: HorizontalInterval[] = [intervals[0]];
        for (let index = 1; index < intervals.length; index += 1) {
            const current = intervals[index];
            const previous = merged[merged.length - 1];
            if (current.start <= previous.end + LAYOUT_DEFAULTS.wrapTolerance) {
                previous.end = Math.max(previous.end, current.end);
                continue;
            }
            merged.push({ ...current });
        }
        return merged;
    }

    private resolveAvailableHorizontalIntervals(occupied: readonly HorizontalInterval[]): HorizontalInterval[] {
        const intervals: HorizontalInterval[] = [];
        let cursor = 0;

        for (const interval of occupied) {
            if (interval.start > cursor + LAYOUT_DEFAULTS.wrapTolerance) {
                intervals.push({ start: cursor, end: interval.start });
            }
            cursor = Math.max(cursor, interval.end);
        }

        if (cursor < this.availableWidth - LAYOUT_DEFAULTS.wrapTolerance) {
            intervals.push({ start: cursor, end: this.availableWidth });
        }

        return intervals.filter((interval) => (interval.end - interval.start) > LAYOUT_DEFAULTS.wrapTolerance);
    }
}
