import { LayoutUtils } from './layout-utils';

export type TrackSizingMode = 'fixed' | 'auto' | 'flex';

export interface TrackSizingDefinition {
    mode: TrackSizingMode;
    value?: number;
    fr?: number;
    min?: number;
    max?: number;
    basis?: number;
    minContent?: number;
    maxContent?: number;
    grow?: number;
    shrink?: number;
}

export interface SolveTrackSizingInput {
    containerWidth: number;
    tracks: TrackSizingDefinition[];
    gap?: number;
}

export interface ResolvedTrackSizing {
    mode: TrackSizingMode;
    min: number;
    max: number;
    basis: number;
    size: number;
    growWeight: number;
    shrinkWeight: number;
}

export interface SolveTrackSizingResult {
    sizes: number[];
    tracks: ResolvedTrackSizing[];
    gap: number;
    availableContentWidth: number;
    contentWidth: number;
    usedWidth: number;
    remainingContentSpace: number;
    overflowContent: number;
}

const EPSILON = 0.000001;

function toUnit(value: unknown, fallback: number): number {
    if (value === undefined || value === null || value === '') return fallback;
    return LayoutUtils.validateUnit(value);
}

function clamp(value: number, min: number, max: number): number {
    if (value < min) return min;
    if (value > max) return max;
    return value;
}

function normalizeTrack(definition: TrackSizingDefinition): ResolvedTrackSizing {
    const mode = definition.mode || 'auto';
    const authoredMin = Math.max(0, toUnit(definition.min, 0));
    const minContent = Math.max(0, toUnit(definition.minContent, 0));
    const maxContentRaw = toUnit(definition.maxContent, minContent);
    const maxContent = Math.max(minContent, maxContentRaw);

    if (mode === 'fixed') {
        const value = Math.max(0, toUnit(definition.value, 0));
        return {
            mode,
            min: value,
            max: value,
            basis: value,
            size: value,
            growWeight: 0,
            shrinkWeight: 0,
        };
    }

    const min = Math.max(authoredMin, minContent);
    const authoredMax =
        definition.max === undefined ? Number.POSITIVE_INFINITY : Math.max(0, toUnit(definition.max, min));
    const max =
        mode === 'auto' && definition.max === undefined ? Math.max(min, maxContent) : Math.max(min, authoredMax);

    const rawBasis =
        definition.basis !== undefined ? toUnit(definition.basis, min) : mode === 'auto' ? maxContent : min;
    const basis = clamp(Math.max(0, rawBasis), min, max);

    if (mode === 'flex') {
        const fr = Math.max(EPSILON, toUnit(definition.fr, 1));
        return {
            mode,
            min,
            max,
            basis,
            size: basis,
            growWeight: fr,
            shrinkWeight: Math.max(EPSILON, toUnit(definition.shrink, 1)),
        };
    }

    return {
        mode: 'auto',
        min,
        max,
        basis,
        size: basis,
        growWeight: Math.max(EPSILON, toUnit(definition.grow, 1)),
        shrinkWeight: Math.max(EPSILON, toUnit(definition.shrink, 1)),
    };
}

function distributeGrowth(
    sizes: number[],
    maxima: number[],
    weights: number[],
    indices: number[],
    amount: number,
): number {
    let remaining = Math.max(0, amount);
    let guard = 0;

    while (remaining > EPSILON && guard < 64) {
        guard += 1;
        const eligible = indices.filter((idx) => {
            const max = maxima[idx];
            if (!Number.isFinite(max)) return true;
            return sizes[idx] + EPSILON < max;
        });
        if (eligible.length === 0) break;

        const totalWeight = eligible.reduce((sum, idx) => sum + Math.max(EPSILON, weights[idx]), 0);
        if (totalWeight <= EPSILON) break;

        let consumed = 0;
        for (const idx of eligible) {
            const share = remaining * (Math.max(EPSILON, weights[idx]) / totalWeight);
            const max = maxima[idx];
            const room = Number.isFinite(max) ? Math.max(0, max - sizes[idx]) : share;
            const growth = Number.isFinite(max) ? Math.min(room, share) : share;
            if (growth <= EPSILON) continue;
            sizes[idx] += growth;
            consumed += growth;
        }
        if (consumed <= EPSILON) break;
        remaining = Math.max(0, remaining - consumed);
    }

    return remaining;
}

function distributeShrink(
    sizes: number[],
    minima: number[],
    weights: number[],
    indices: number[],
    amount: number,
): number {
    let remaining = Math.max(0, amount);
    let guard = 0;

    while (remaining > EPSILON && guard < 64) {
        guard += 1;
        const eligible = indices.filter((idx) => sizes[idx] - EPSILON > minima[idx]);
        if (eligible.length === 0) break;

        const totalCapacity = eligible.reduce((sum, idx) => {
            const capacity = Math.max(0, sizes[idx] - minima[idx]);
            return sum + capacity * Math.max(EPSILON, weights[idx]);
        }, 0);
        if (totalCapacity <= EPSILON) break;

        let consumed = 0;
        for (const idx of eligible) {
            const capacity = Math.max(0, sizes[idx] - minima[idx]);
            const weightedCapacity = capacity * Math.max(EPSILON, weights[idx]);
            if (weightedCapacity <= EPSILON) continue;
            const share = remaining * (weightedCapacity / totalCapacity);
            const shrink = Math.min(capacity, share);
            if (shrink <= EPSILON) continue;
            sizes[idx] -= shrink;
            consumed += shrink;
        }
        if (consumed <= EPSILON) break;
        remaining = Math.max(0, remaining - consumed);
    }

    return remaining;
}

export function solveTrackSizing(input: SolveTrackSizingInput): SolveTrackSizingResult {
    const gap = Math.max(0, toUnit(input.gap, 0));
    const definitions = Array.isArray(input.tracks) ? input.tracks : [];
    const tracks = definitions.map((definition) => normalizeTrack(definition));

    if (tracks.length === 0) {
        const containerWidth = Math.max(0, toUnit(input.containerWidth, 0));
        return {
            sizes: [],
            tracks: [],
            gap,
            availableContentWidth: containerWidth,
            contentWidth: 0,
            usedWidth: 0,
            remainingContentSpace: containerWidth,
            overflowContent: 0,
        };
    }

    const containerWidth = Math.max(0, toUnit(input.containerWidth, 0));
    const totalGap = gap * Math.max(0, tracks.length - 1);
    const availableContentWidth = Math.max(0, containerWidth - totalGap);
    const sizes = tracks.map((track) => track.basis);

    const currentWidth = (): number => sizes.reduce((sum, value) => sum + value, 0);

    const initial = currentWidth();
    if (initial > availableContentWidth + EPSILON) {
        const overflow = initial - availableContentWidth;
        const shrinkIndices = tracks
            .map((track, idx) => ({ idx, track }))
            .filter((entry) => entry.track.shrinkWeight > 0 && sizes[entry.idx] > entry.track.min + EPSILON)
            .map((entry) => entry.idx);
        distributeShrink(
            sizes,
            tracks.map((track) => track.min),
            tracks.map((track) => track.shrinkWeight),
            shrinkIndices,
            overflow,
        );
    } else if (initial < availableContentWidth - EPSILON) {
        let remaining = availableContentWidth - initial;

        const autoIndices = tracks
            .map((track, idx) => ({ idx, track }))
            .filter((entry) => entry.track.mode === 'auto' && entry.track.growWeight > 0)
            .map((entry) => entry.idx);
        remaining = distributeGrowth(
            sizes,
            tracks.map((track) => track.max),
            tracks.map((track) => track.growWeight),
            autoIndices,
            remaining,
        );

        if (remaining > EPSILON) {
            const flexIndices = tracks
                .map((track, idx) => ({ idx, track }))
                .filter((entry) => entry.track.mode === 'flex' && entry.track.growWeight > 0)
                .map((entry) => entry.idx);
            remaining = distributeGrowth(
                sizes,
                tracks.map((track) => track.max),
                tracks.map((track) => track.growWeight),
                flexIndices,
                remaining,
            );
        }
    }

    const contentWidth = currentWidth();
    const usedWidth = contentWidth + totalGap;
    const remainingContentSpace = Math.max(0, availableContentWidth - contentWidth);
    const overflowContent = Math.max(0, contentWidth - availableContentWidth);

    const resolvedTracks = tracks.map((track, idx) => ({
        ...track,
        size: sizes[idx],
    }));

    return {
        sizes,
        tracks: resolvedTracks,
        gap,
        availableContentWidth,
        contentWidth,
        usedWidth,
        remainingContentSpace,
        overflowContent,
    };
}
