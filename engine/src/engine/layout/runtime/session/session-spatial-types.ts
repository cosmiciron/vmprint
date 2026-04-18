import type { PageReservationSelector, StoryFloatAlign, StoryFloatShape, StoryWrapMode, TraversalInteractionPolicy } from '../../../types';

export type RegionReservation = {
    id: string;
    height: number;
    source?: string;
};

export type ExclusionSurface = 'page' | 'world-traversal';

export type PageReservationIntent = RegionReservation & {
    selector?: 'current' | PageReservationSelector;
};

export type SpatialExclusion = {
    id: string;
    x: number;
    y: number;
    w: number;
    h: number;
    source?: string;
    zIndex?: number;
    wrap?: StoryWrapMode;
    gap?: number;
    gapTop?: number;
    gapBottom?: number;
    shape?: StoryFloatShape;
    path?: string;
    align?: StoryFloatAlign;
    traversalInteraction?: TraversalInteractionPolicy;
    surface?: ExclusionSurface;
};

export type PageExclusionIntent = SpatialExclusion & {
    selector?: 'current' | PageReservationSelector;
};

export type ContentBand = {
    xOffset: number;
    width: number;
};

export type ActiveExclusionBand = {
    exclusions: SpatialExclusion[];
    top: number;
    bottom: number;
};

export type SpatialPlacementSurface = {
    cursorY: number;
    activeBand: ActiveExclusionBand | null;
    contentBand: ContentBand | null;
};

export type PlacementFrameMargins = {
    left: number;
    right: number;
};
