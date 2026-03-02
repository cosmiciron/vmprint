# VMPrint Architecture Overview

This document is aimed at developers who want to contribute to, extend, or embed VMPrint. It covers how the system is structured, why key decisions were made, and what distinguishes it from more conventional layout approaches.

---

## 1. What VMPrint Is

VMPrint is a deterministic document layout engine. You feed it a JSON document description and a rendering context, and it produces a paginated collection of positioned boxes. Those boxes are then painted—by a renderer—into whatever output format the context supports (currently PDF via PDFKit).

It is not a headless browser. It does not parse HTML or CSS. It is not a port of a web engine. The design is closer to a print composition VM: inputs are immutable, the layout process is a pure function from document to pages, and the output is identical on every run.

---

## 2. Repository Layout

```
VMPrintStack/
├── contracts/          Interface definitions only. No implementation.
│   └── src/
│       ├── context.ts          Rendering context interface (addPage, font, rect, text, …)
│       ├── font-manager.ts     Font resolution interface
│       └── overlay.ts          Overlay hook interfaces (backdrop / overlay per page)
│
├── engine/             Core layout and rendering logic.
│   └── src/engine/
│       ├── types.ts            All shared types: Element, Box, Page, ElementStyle, …
│       ├── document.ts         Input validation and normalization
│       ├── layout-engine.ts    Public entry point (LayoutEngine extends LayoutProcessor)
│       ├── renderer.ts         Renderer: consumes flat pages, paints boxes
│       ├── runtime.ts          EngineRuntime factory (font cache, measurement cache)
│       └── layout/
│           ├── layout-core.ts          LayoutProcessor: element shaping, materialization
│           ├── layout-core-types.ts    FlowBox, FlowMaterializationContext, etc.
│           ├── layout-flow-splitting.ts  Paragraph splitting at page breaks
│           ├── layout-page-finalization.ts  Page number injection
│           ├── text-processor.ts       Line breaking, hyphenation, justification
│           ├── font-processor.ts       Font loading tree
│           └── packagers/
│               ├── packager-types.ts   PackagerUnit interface
│               ├── create-packagers.ts Factory: element → PackagerUnit
│               ├── paginate-packagers.ts  Pagination loop over PackagerUnits
│               ├── flow-box-packager.ts   Standard paragraph/image unit
│               ├── dropcap-packager.ts    Drop-cap composed unit
│               ├── story-packager.ts      Float/wrap DTP text flow unit
│               ├── table-packager.ts      Table layout unit
│               └── spatial-map.ts        Obstacle registry for text-wrap
│
├── packages/context-pdf/   PDF rendering context (wraps PDFKit)
├── packages/local-fonts/   Font discovery from the local filesystem
├── packages/draft2final/   Markdown → VMPrint IR → PDF pipeline
│   └── src/
│       ├── markdown.ts       Markdown → mdast (remark)
│       ├── semantic.ts       mdast → SemanticDocument (typed AST)
│       ├── formats/          SemanticDocument → DocumentInput per format
│       └── build.ts          Top-level compile+render orchestration
└── packages/cli/           CLI wrapper over draft2final
```

---

## 3. The Three-Stage Pipeline

```
   [Source]          [IR]               [Layout Stream]     [Output]
Markdown / JSON  →  DocumentInput  →   Page[] of Box[]  →  PDF / other
      │                  │                    │
  draft2final        engine/document.ts    LayoutEngine
  (optional)         (validation)           +Renderer
```

### Stage 1 — Source to IR

`draft2final` is an optional front-end that accepts Markdown and turns it into VMPrint's own IR (`DocumentInput`). It runs in two sub-steps:

1. **Markdown → SemanticDocument** via remark. This is a one-to-one structural mapping: headings, paragraphs, lists, tables, images. No formatting decisions happen here.

2. **SemanticDocument → DocumentInput** via a format module (e.g. `markdown`, `screenplay`). Format modules own the style decisions—font choices, heading sizes, margins, list indentation. They emit `Element` trees with typed `properties` and can inject continuation markers, page-break hints, etc.

You do not have to use this layer at all. VMPrint accepts `DocumentInput` JSON directly, which is how the CLI and the engine regression tests work.

### Stage 2 — Layout (the engine core)

This is where the interesting work happens. See sections 4–8.

### Stage 3 — Rendering

The `Renderer` takes `Page[]` (each page being a flat array of `Box` objects with absolute coordinates) and paints them into a `Context`. It does not do layout. It does not reflow anything. It resolves z-index ordering, then calls the context's drawing primitives for each box: background, borders, image bytes, and pre-measured rich text lines. Font registration happens once, before the first page is drawn.

---

## 4. The Document IR (DocumentInput)

`DocumentInput` is the vmprint-native document format. It is a plain JSON object:

```typescript
interface DocumentInput {
    documentVersion: '1.0';
    layout: { pageSize, margins, fontFamily, fontSize, lineHeight, … };
    fonts: { regular, bold, italic, bolditalic, [key]: path };
    styles: { [elementType]: ElementStyle };
    elements: Element[];
}
```

An `Element` looks like:

```typescript
interface Element {
    type: string;           // 'paragraph', 'heading', 'image', 'table', 'story', …
    content: string;        // Flat text content (leaf nodes)
    children?: Element[];   // For rich-text inline nodes and container elements
    properties?: {
        style?: ElementStyle;     // Per-element style overrides
        image?: { data, mimeType, fit };
        dropCap?: { enabled, lines, characters, gap };
        layout?: StoryLayoutDirective;  // For children of 'story' elements
        keepWithNext?: boolean;
        paginationContinuation?: { markerAfterSplit, markerBeforeContinuation };
        …
    };
}
```

The `type` field is a plain string. The engine reserves a short list of structural types (`table`, `tableRow`, `tableCell`, `story`), but everything else—`paragraph`, `h1`, `blockquote`, `code`, whatever—is just a label used to look up a base style from the `styles` map. There is no separate AST node class hierarchy; elements are data.

---

## 5. The All-Flat Box Model

Every element in the document, regardless of nesting, is eventually reduced to a flat list of `Box` objects per page. A `Box` is:

```typescript
interface Box {
    type: string; // inherited from source element type
    x: number; // absolute position in points from page top-left
    y: number;
    w: number;
    h: number;
    image?: BoxImagePayload;
    lines?: RichLine[]; // pre-shaped text lines (glyphs measured)
    style: ElementStyle;
    meta?: BoxMeta; // source tracking: sourceId, engineKey, fragmentIndex
}

interface Page {
    index: number;
    boxes: Box[];
    width: number;
    height: number;
}
```

There are no nested box trees, no parent-child relationships in the output, no wrapping containers. A table is a set of flat boxes. A drop-cap paragraph is two flat boxes side by side (cap glyph box + wrapped text box). A story with floats is a flat list of text boxes and image boxes with absolute coordinates.

The renderer iterates `page.boxes`, sorts by `zIndex`, and paints each one. It never needs to recurse or resolve containment.

This makes the renderer trivially correct. It also makes the overlay system (see section 9) trivially simple: overlays receive the same flat `OverlayBox[]` representation and don't need to understand the element tree.

---

## 6. FlowBox: The Internal Intermediate Representation

Between the `Element` input tree and the flat `Box` output, the engine uses `FlowBox` as its working IR:

```typescript
type FlowBox = {
    type: string;
    style: ElementStyle;           // fully resolved + normalized style
    lines?: RichLine[];            // shaped text lines (after text-processor)
    image?: BoxImagePayload;
    measuredContentHeight: number; // height of content area, set after materialization
    marginTop: number;
    marginBottom: number;
    keepWithNext: boolean;
    pageBreakBefore: boolean;
    allowLineSplit: boolean;
    overflowPolicy: OverflowPolicy;
    orphans: number;
    widows: number;
    _materializationMode: 'reflowable' | 'frozen';
    _sourceElement?: Element;      // reference back to original input
    …
};
```

A `FlowBox` is the shaped but not yet positioned form of an element. It carries:

- Resolved text lines (words measured, wrapped, hyphenated, justified)
- Height computed from those lines
- Pagination hints (margins, keepWithNext, orphans/widows)

FlowBoxes are created by `shapeElement()` in `LayoutProcessor`. They are not yet placed on a page. Placement is deferred to the packager layer.

---

## 7. The Packager Architecture

This is the heart of the pagination design. Rather than a single monolithic pagination loop that walks the element tree and dispatches to type-specific handlers mid-loop, VMPrint uses an object-oriented **Packager** model.

Every element (or small cluster of elements) is converted to a `PackagerUnit` before pagination begins:

```
elements[] → createPackagers() → PackagerUnit[] → paginatePackagers() → Page[]
```

The `PackagerUnit` interface is small:

```typescript
interface PackagerUnit {
    emitBoxes(availableWidth, availableHeight, context): LayoutBox[] | null;
    split(availableHeight, context): [PackagerUnit | null, PackagerUnit | null];
    getRequiredHeight(): number;
    isUnbreakable(availableHeight): boolean;
    getMarginTop(): number;
    getMarginBottom(): number;
    readonly pageBreakBefore?: boolean;
    readonly keepWithNext?: boolean;
}
```

The four concrete implementations are:

| Packager          | Handles                                                   |
| ----------------- | --------------------------------------------------------- |
| `FlowBoxPackager` | Standard paragraphs, headings, standalone images          |
| `DropCapPackager` | Drop-cap paragraphs (cap glyph box + wrapped body)        |
| `StoryPackager`   | DTP "story" zones with float/wrap image placement         |
| `TablePackager`   | Multi-column tables with header repeat and row pagination |

`paginatePackagers()` is then a compact loop that:

1. Asks each packager for its required height
2. If it fits on the current page, calls `emitBoxes()` and stamps absolute Y coordinates
3. If it doesn't fit, tries `split()` to get a first part that does
4. Advances the cursor and opens new pages as needed

```
Page 1:                     Page 2:
┌──────────────────────┐    ┌──────────────────────┐
│  [cursor: top margin]│    │  [cursor: top margin]│
│                      │    │                      │
│  packager[0].emit()  │    │  packager[2].emit()  │
│  packager[1].emit()  │    │  packager[3]         │
│  packager[2].split() │    │    (continuation)    │
│    → partA.emit()    │    │  …                   │
│  ─ ─ ─ page end ─ ─ │    │                      │
└──────────────────────┘    └──────────────────────┘
```

The key property: **the pagination loop itself is type-agnostic**. It knows nothing about paragraphs vs. tables vs. stories vs. drop caps. All layout-specific logic is encapsulated inside the packager objects. Adding a new element type that needs custom layout behavior means adding a new `PackagerUnit` implementation and a branch in `createPackagers()`. The pagination loop does not change.

Each packager is also **self-splitting**. When `paginatePackagers` determines a packager needs to cross a page boundary, it calls `split(availableHeight)`. The packager returns a `[partA, partB]` pair. Both parts implement `PackagerUnit`; the loop handles them identically to any other unit. A paragraph splits at line boundaries (respecting orphan/widow rules). A story freezes its first-page boxes into a `FrozenStoryPackager` and carries the remainder forward. A table splits at row boundaries.

### Mutable Internal State and "Morphable" Boxes

One nuance: packagers cache their last measured height. `FlowBoxPackager.materialize()` is only re-run when `availableWidth` changes. This allows the paginator to query `getRequiredHeight()` cheaply without re-running text shaping. The packager effectively pre-materializes itself for the available column width, then later emits positioned boxes when placement is confirmed. This is what makes the system fast for reflow: font measurement is expensive; if the column width doesn't change, you pay it once.

The `StoryPackager` goes further. It runs a two-pass pour: first it registers any `story-absolute` image obstacles into a `SpatialMap`, then it pours children top-to-bottom, querying the spatial map per text line to get the available horizontal interval(s) at that Y slice. The resulting boxes carry per-line offset and width arrays (`_lineOffsets`, `_lineWidths`, `_lineYOffsets`) that the renderer already knows how to use—no special renderer path required.

---

## 8. Determinism as a Design Constraint

The ROADMAP states it explicitly: _"deterministic pagination and layout on repeated runs."_ This is not just a feature; it shapes a number of implementation choices.

**No randomness or time-dependent state.** The engine takes a `DocumentInput`, a font registry snapshot, and an optional measurement cache. Given the same inputs, it always produces the same `Page[]` output.

**Input immutability.** The engine does not mutate the source document tree. FlowBoxes are shaping results that reference back to source elements (`_sourceElement`), but they don't modify them. The same `DocumentInput` can be safely passed to multiple engine instances.

**Measurement caching is keyed, not assumed.** The `EngineRuntime` carries a `measurementCache` (a `Map`) and a `fontCache`. The cache key for a materialized box includes page index, cursor Y, element type, and content width (`"0:72.000:paragraph:468.000"`). This means the cache is content-addressed; cache hits are safe to reuse without re-checking context.

**No stateful pagination side effects.** The packager states exist only during the `paginate()` call. Nothing is written back to the `DocumentInput`. The `AnnotatedLayoutStream` type (`{ config, pages }`) represents the complete, frozen output—it can be serialized, compared, and diffed.

### Regression Testing

The engine has a fixtures-based regression suite. Each fixture is a `DocumentInput` JSON file with a corresponding `snapshot.layout.json` that is the expected `AnnotatedLayoutStream` output (or just a PDF comparison). Tests re-run layout and diff the output. Because layout is deterministic, a snapshot mismatch is always a real regression.

---

## 9. The Context Abstraction

The `Context` interface (from `@vmprint/contracts`) is what the renderer talks to:

```typescript
interface Context {
    addPage(): void;
    end(): void;
    font(family, size?): this;
    text(str, x, y, options?): this;
    image(source, x, y, options?): this;
    rect(x, y, w, h): this;
    fill(): this;
    stroke(): this;
    opacity(v): this;
    save(): void;
    restore(): void;
    // … etc.
}
```

This is a strict, narrow vector-drawing interface. It intentionally covers the minimal surface needed to paint boxes and text. There is exactly one implementation today (`PdfContext` in `packages/context-pdf`, which wraps PDFKit), but the contract and the engine are fully decoupled. A canvas context, an SVG context, a server-side image renderer, or a test-spy all implement the same interface.

The goal stated in the roadmap is **identical output on all contexts**. Meaning: the `Page[]` produced by the layout engine is context-independent. The PDF context and any hypothetical SVG context receive the same absolute-coordinate boxes. Any rendering differences are bugs in the context implementation, not in layout.

### Overlay API

The overlay system is an optional hook that lets callers inject drawing before or after the engine paints each page:

```typescript
interface OverlayProvider {
    backdrop?(page: OverlayPage, context: OverlayContext): void;
    overlay?(page: OverlayPage, context: OverlayContext): void;
}
```

`OverlayPage` gives the overlay a read-only view of the flat `OverlayBox[]` for that page. This is how debug grids, cut marks, watermarks, and highlight passes are implemented (see `examples/overlay-samples/`). The overlay receives the same coordinate space as the renderer; no transformation is needed.

---

## 10. Font Management

Font loading is extracted into a `FontManager` interface (`@vmprint/contracts`) with a concrete `LocalFontManager` implementation (`packages/local-fonts`). The engine only interacts with fonts through the runtime's `fontRegistry` and `fontCache`—it never touches the filesystem directly.

```
EngineRuntime {
    fontManager: FontManager       // resolves name → buffer
    fontRegistry: FontRegistry     // snapshot of registered families
    fontCache: {}                  // loaded fontkit objects
    measurementCache: Map          // text measurement results
    bufferCache: {}                // raw font buffers
}
```

Font measurement (text width, ascent, descent, glyph metrics) is done via fontkit. Results are cached in `measurementCache`. The cache is part of the runtime and survives across multiple `paginate()` calls on the same engine instance—important for interactive use where the same document may be re-laid-out after a config change.

The `TextProcessor` layer handles the full complexity of multilingual text: grapheme cluster segmentation via `Intl.Segmenter`, per-script optical scaling, Arabic/Hebrew right-to-left detection, soft hyphenation dictionary lookup, greedy line wrapping with overflow fallback, and two justification engines (legacy space-padding and advanced inter-character).

---

## 11. Rich Text Lines

The internal representation of a shaped line is `RichLine`, which is `TextSegment[]`:

```typescript
type TextSegment = {
    text: string;
    fontFamily?: string;
    style?: Record<string, any>; // per-run style overrides
    width?: number; // measured width in points
    ascent?: number;
    descent?: number;
    justifyAfter?: number; // inter-word space to add for justification
    forcedBreakAfter?: boolean;
    inlineObject?: InlineObjectSegment; // inline image or box
    inlineMetrics?: InlineObjectMetrics;
    glyphs?: { char; x; y }[]; // optional glyph-level positioning
};
```

A single paragraph may span many `RichLine[]` entries. Each line is a run of segments that may have different fonts and styles but share a common baseline. The renderer draws each segment independently, advancing x by `segment.width`. Baseline alignment is handled by the renderer using the per-line ascent.

This structure is emitted by `TextProcessor` during the shaping phase and is embedded directly in the `FlowBox`. By the time pagination happens, all text has been measured and wrapped. There is no re-wrapping during pagination.

---

## 12. Continuation Markers

When a paginator splits a flow box across a page break, the document can declare optional continuation markers: a "continued…" note appended to the first fragment, or a "(continued from previous page)" note prepended to the second. This is declared in the element's `properties.paginationContinuation`:

```json
{
    "paginationContinuation": {
        "markerAfterSplit": { "type": "paragraph", "content": "(continued)", "style": { "textAlign": "right" } },
        "markerBeforeContinuation": { "type": "paragraph", "content": "(continued from previous page)" }
    }
}
```

The `layout-flow-splitting.ts` module generates these as synthetic `FlowBox` objects injected by the split logic. The markers are fully shaped (text-processed) and treated as ordinary boxes by the paginator. No special rendering path is needed.

---

## 13. draft2final: The Markdown Compiler

`draft2final` is the highest-level layer and is entirely optional. Its responsibility is:

```
Markdown string
    ↓  markdown.ts (remark)
mdast (remark AST)
    ↓  semantic.ts
SemanticDocument (typed, source-annotated AST)
    ↓  formats/<name>/index.ts
DocumentInput (vmprint IR)
    ↓  build.ts
PDF file
```

Each step is a pure function. The format modules (`markdown`, `academic`, `literature`, and `screenplay`) are the only place that knows about document conventions—what font to use for a `h1`, how wide a blockquote indent should be, whether a scene heading gets `keepWithNext: true`. Derived formats such as `academic` and `literature` extend the same `MarkdownFormat` base handler and are registered as independent named `FormatModule` instances.

Each format has a `config.defaults.yaml` for behavioral options. Themes supply style and layout values via `themes/<name>.yaml`. Per-theme behavioral overrides can be placed in a `themes/<name>.config.yaml` sidecar, which is merged after format defaults but before document frontmatter. This allows a theme to enable features (e.g. the `opensource` theme enabling the `::` title subheading) without requiring frontmatter in every source file.

The `SemanticDocument` type is a mid-level AST that normalizes away remark idiosyncrasies (e.g. it resolves link references before handing them to format modules). Format modules never see raw remark nodes.

---

## 14. Summary of Key Design Properties

| Property                      | How it's achieved                                                             |
| ----------------------------- | ----------------------------------------------------------------------------- |
| Flat box output               | All packagers reduce to `Box[]` before pagination; no nesting in the output   |
| No monolithic pagination loop | Packager interface encapsulates element-specific logic; loop is type-agnostic |
| Deterministic layout          | No side effects, immutable input, keyed measurement cache                     |
| Context independence          | Renderer only calls `Context` interface primitives; layout is pre-computed    |
| Extensible element types      | New type = new `PackagerUnit` class + one branch in `createPackagers()`       |
| DTP float/wrap layout         | `StoryPackager` + `SpatialMap`; no special renderer path needed               |
| Source traceability           | Every `Box` carries `BoxMeta` with `sourceId`, `engineKey`, `fragmentIndex`   |
| Inline richness               | `RichLine[]` / `TextSegment[]` carry per-run font, style, and glyph data      |
| Overlay/debug extensibility   | `OverlayProvider` hook; overlays get same flat box representation as renderer |
