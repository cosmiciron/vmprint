import type { StoryWrapMode, TraversalInteractionPolicy } from '../types';

/**
 * Runtime resistance carried by one blocked span within a vertical query band.
 *
 * `resistance=1` is a hard wall. Values between `0` and `1` represent softer
 * shoulder bands compiled from authored geometry before the layout hot path.
 */
export interface ExclusionResistanceSpan {
    left: number;
    right: number;
    resistance: number;
}

/**
 * One vertical query band in the compiled exclusion substrate.
 *
 * Multiple spans per band are normal and represent concavities, gaps, or
 * disconnected silhouettes without requiring any polygon logic at query time.
 */
export interface ExclusionResistanceBand {
    top: number;
    bottom: number;
    spans: readonly ExclusionResistanceSpan[];
}

/**
 * A compiled exclusion lane that has already converted authored geometry into
 * band-oriented blocked spans.
 *
 * This is the intended runtime substrate for wrapping and collision queries.
 * Shapes, paths, and assemblies belong on the authoring side and should be
 * compiled into this field before the text carver begins querying.
 */
export interface ExclusionResistanceField {
    kind: 'exclusion-resistance-field';
    mode: 'hard' | 'weighted';
    wrap: StoryWrapMode;
    zIndex: number;
    traversalInteraction: TraversalInteractionPolicy;
    minY: number;
    maxY: number;
    opticalMaxY?: number;
    bands: readonly ExclusionResistanceBand[];
}

export function clampExclusionResistance(value: number): number {
    if (!Number.isFinite(value)) return 0;
    if (value <= 0) return 0;
    if (value >= 1) return 1;
    return value;
}

export function createExclusionResistanceSpan(
    left: number,
    right: number,
    resistance: number
): ExclusionResistanceSpan | null {
    if (!Number.isFinite(left) || !Number.isFinite(right)) return null;
    const normalizedLeft = Math.min(left, right);
    const normalizedRight = Math.max(left, right);
    if (!(normalizedRight > normalizedLeft)) return null;
    return {
        left: normalizedLeft,
        right: normalizedRight,
        resistance: clampExclusionResistance(resistance)
    };
}

export function createExclusionResistanceBand(
    top: number,
    bottom: number,
    spans: readonly ExclusionResistanceSpan[]
): ExclusionResistanceBand | null {
    if (!Number.isFinite(top) || !Number.isFinite(bottom)) return null;
    const normalizedTop = Math.min(top, bottom);
    const normalizedBottom = Math.max(top, bottom);
    if (!(normalizedBottom > normalizedTop)) return null;
    return {
        top: normalizedTop,
        bottom: normalizedBottom,
        spans: spans
            .filter((span) => span.right > span.left && span.resistance > 0)
            .map((span) => ({
                left: span.left,
                right: span.right,
                resistance: clampExclusionResistance(span.resistance)
            }))
    };
}

export function createExclusionResistanceField(input: {
    mode?: 'hard' | 'weighted';
    wrap?: StoryWrapMode;
    zIndex?: number;
    traversalInteraction?: TraversalInteractionPolicy;
    opticalMaxY?: number;
    bands: readonly ExclusionResistanceBand[];
}): ExclusionResistanceField {
    const bands = input.bands
        .filter((band) => band.bottom > band.top)
        .map((band) => ({
            top: band.top,
            bottom: band.bottom,
            spans: band.spans
                .filter((span) => span.right > span.left && span.resistance > 0)
                .map((span) => ({
                    left: span.left,
                    right: span.right,
                    resistance: clampExclusionResistance(span.resistance)
                }))
        }))
        .filter((band) => band.spans.length > 0)
        .sort((left, right) => left.top - right.top || left.bottom - right.bottom);

    const minY = bands.length > 0 ? bands[0]!.top : 0;
    const maxY = bands.length > 0 ? bands[bands.length - 1]!.bottom : 0;

    return {
        kind: 'exclusion-resistance-field',
        mode: input.mode ?? 'hard',
        wrap: input.wrap ?? 'around',
        zIndex: Number.isFinite(Number(input.zIndex)) ? Number(input.zIndex) : 0,
        traversalInteraction: input.traversalInteraction ?? 'auto',
        minY,
        maxY,
        opticalMaxY: Number.isFinite(Number(input.opticalMaxY)) ? Number(input.opticalMaxY) : undefined,
        bands
    };
}
