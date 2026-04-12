/**
 * Compatibility shim.
 *
 * The normalization logic now lives in `text-segmentation.ts` because it is
 * part of neutral layout behavior rather than browser bootstrap.
 */
export {
    isNumericRunSegment as isBrowserNumericRunSegment,
    normalizeTextSegments as normalizeBrowserTextSegments,
    segmentTextRun as segmentBrowserTextRun
} from './text-segmentation';
