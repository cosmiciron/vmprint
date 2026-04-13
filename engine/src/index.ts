// Public surface of @vmprint/engine.
// Everything exported here is part of the stable API.
// Internal implementation details are not exported.

// ---------------------------------------------------------------------------
// Primary API
// ---------------------------------------------------------------------------

export { VMPrintEngine, renderLayout } from './engine/vmprint-engine';
export type { EngineInfo, SimulateOptions, RenderOptions } from './engine/vmprint-engine';

export { loadDocument } from './engine/document';

// ---------------------------------------------------------------------------
// Document types — needed to construct VMPrintEngine
// ---------------------------------------------------------------------------

export type {
    DocumentInput,
    DocumentIR
} from './engine/types';

// ---------------------------------------------------------------------------
// Layout result types — needed when inspecting pages from layout()
// ---------------------------------------------------------------------------

export type {
    Page,
    Box,
    BoxMeta,
    Element,
    ElementStyle,
    RichLine,
    TextSegment,
    InlineObjectSegment,
    EmbeddedImagePayload,
    LayoutConfig,
    AnnotatedLayoutStream
} from './engine/types';

// ---------------------------------------------------------------------------
// Contract types — re-exported so consumers don't need @vmprint/contracts
// directly just to satisfy TypeScript when wiring in a FontManager or Context
// ---------------------------------------------------------------------------

export type { FontManager, Context, OverlayProvider } from '@vmprint/contracts';

// ---------------------------------------------------------------------------
// Advanced / escape-hatch exports
// ---------------------------------------------------------------------------

// SimulationLoop is for reactive and streaming document use cases.
export { SimulationLoop } from './engine/layout/simulation-loop';
export type {
    SimulationLoopOptions,
    SimulationLoopSample,
    SimulationLoopScheduler,
    SimulationLoopState
} from './engine/layout/simulation-loop';

// SpatialDocument API — for zone-based layout compositions.
export type { SpatialDocument } from './engine/spatial-document';
export {
    spatialDocumentToElements,
    spatialDocumentToElementsStrict
} from './engine/spatial-document';

// serializeDocumentIR — for tools that need to inspect or store the IR.
export { serializeDocumentIR } from './engine/document';

// ---------------------------------------------------------------------------
// Internal / engine-author surface
//
// These exports are for internal tests, the CLI's advanced features, and
// integrators who need low-level access. They are NOT part of the primary API
// and may change between minor versions. Prefer VMPrintEngine for all normal
// use cases.
// ---------------------------------------------------------------------------

export * from './core/index';
export * from './print/index';
export * from './engine/layout/text-delegate';
