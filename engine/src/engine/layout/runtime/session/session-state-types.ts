import type { PageRegionContent } from '../../../types';
import type { PlacementFrameMargins, SpatialExclusion } from './session-spatial-types';

export type PageRegionResolution = {
    header: PageRegionContent | null;
    footer: PageRegionContent | null;
};

export type PageOverrideState = 'inherit' | 'replace' | 'suppress';

export type WorldSpace = {
    originX: number;
    originY: number;
    width: number;
    exploredBottom: number;
};

export type ViewportRect = {
    x: number;
    y: number;
    w: number;
    h: number;
};

export type ViewportTerrain = {
    margins: PlacementFrameMargins & {
        top: number;
        bottom: number;
    };
    marginBlocks: SpatialExclusion[];
    headerBlock: SpatialExclusion | null;
    footerBlock: SpatialExclusion | null;
    reservationBlocks: SpatialExclusion[];
    exclusionBlocks: SpatialExclusion[];
    blockedRects: SpatialExclusion[];
};

export type ViewportDescriptor = {
    pageIndex: number;
    worldX: number;
    worldY: number;
    width: number;
    height: number;
    contentRect: ViewportRect;
    terrain: ViewportTerrain;
};

export type PageCaptureState = {
    worldSpace: WorldSpace;
    viewport: ViewportDescriptor;
};

export type PageCaptureRecord = {
    pageIndex: number;
    physicalPageNumber: number;
    logicalPageNumber: number | null;
    usesLogicalNumbering: boolean;
    capture: PageCaptureState;
};

export type PageFinalizationState = {
    pageIndex: number;
    physicalPageNumber: number;
    logicalPageNumber: number | null;
    usesLogicalNumbering: boolean;
    resolvedRegions: PageRegionResolution;
    overrideSourceId: string | null;
    headerOverride: PageOverrideState;
    footerOverride: PageOverrideState;
    renderedHeader: boolean;
    renderedFooter: boolean;
    capture: PageCaptureState;
    worldSpace: WorldSpace;
    viewport: ViewportDescriptor;
};

export type FragmentTransition = {
    predecessorActorId: string;
    currentFragmentActorId: string | null;
    continuationActorId: string | null;
    sourceActorId: string;
    pageIndex: number;
    cursorY?: number;
    availableWidth: number;
    availableHeight: number;
    continuationEnqueued: boolean;
};
