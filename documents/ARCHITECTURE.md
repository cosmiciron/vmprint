# Architecture

This document is the system map. It covers package layout, how the pieces fit together, the four extension contracts, and the full data flow from source to rendered output.

For a deep dive into how the layout engine works — actors, packagers, boxes, speculative pathfinding, the simulation clock, oscillation detection — see [ENGINE-INTERNALS.md](ENGINE-INTERNALS.md).
For the exclusion and text-wrapping substrate — including `exclusionAssembly`, weighted members, and resistance/tolerance policy — see [EXCLUSION-ASSEMBLY.md](EXCLUSION-ASSEMBLY.md).

---

## Design Rationale

Most document rendering libraries start as a single class. It loads fonts, parses the source, measures text, paginates, renders, and writes output — all in one place. This is convenient at first. It becomes a problem the moment you want to change any one of those concerns. Need to run in a browser? The font loader reads the filesystem. Need SVG output instead of PDF? The renderer is fused to the PDF writer. Need to test pagination without generating a file? There is no seam to cut.

The usual fix is to add flags and overrides. A `browserMode` option that skips font loading. A `renderTarget` enum. An `onPage` callback for the output. Each accommodation is a patch, and the patches compound. Eventually the "single class" is a large object with a dozen configuration knobs and an implicit execution order that no one fully remembers.

VMPrint was designed from the start around four clean contracts. The engine knows how to simulate layout. The context knows how to draw. The font manager knows how to load fonts. The transmuter knows how to read source formats. None of these concerns knows about the others. You can swap any one without touching the rest. You can implement any one in isolation.

**Flat output is a commitment.** Most layout engines maintain a nested element tree all the way through rendering. The renderer recurses into children, handles special cases per type, resolves containment at paint time. This means layout decisions are still being made during rendering — which is why renderers accumulate bugs: wrong stacking order, off-by-one baseline, unexpected clipping. VMPrint's engine commits. By the time `Page[]` comes out of the engine, every positioning decision has been encoded as an absolute coordinate. The renderer is a scan-converter: it iterates a flat list of boxes in z-order and calls draw primitives. It makes no layout decisions of its own.

**The packager pattern is the open/closed principle applied to pagination.** The most common pathology in layout engines is what might be called "pagination rot": the pagination function grows a branch for every element type that was ever added. `if table … else if drop-cap … else if story …`. The loop becomes coupled to every layout type in the system. Extending it requires understanding all of it. In VMPrint, the simulation loop asks every packager the same small set of questions: how tall are you? do you fit? can you split? The loop is stable. It has not changed as the packager zoo has grown from two implementations to seven. Each packager is self-contained, independently testable, and knows nothing about the others.

**Transmuters keep source semantics isolated.** The difference between a manuscript and a screenplay is entirely in the rules that map source constructs to layout constructs — not in the layout engine, and not in the renderer. Manuscript rules belong in the manuscript transmuter. Screenplay rules belong in the screenplay transmuter. This means each transmuter can be tested entirely without fonts, pages, or PDF output — just "given this Markdown input, does the AST look right?" It also means adding a new source format does not touch the engine at all.

**The I/O contract is intentionally minimal.** `VmprintOutputStream` has three methods: `write(chunk)`, `end()`, and `waitForFinish()`. No Node.js `Writable`. No `stream` import. No `process`. Those three methods are implementable in a browser, in Lambda, in Deno, in a service worker, or in a plain in-memory buffer. The portability is total, and it is total by design, not by accident.

**Determinism is a constraint, not a promise.** Committing to determinism upfront forces specific choices: immutable inputs, keyed measurement caches, no implicit state, no time-dependent behavior. Those constraints feel like restrictions. What they actually buy is layout snapshot testing — the ability to re-run layout on any document and diff the output against a known-good baseline. A snapshot mismatch is always a real regression, never a false positive. Determinism makes the system auditable, reproducible, and straightforward to debug. It is worth the discipline it requires.

---

## Package Map

```
contracts/              @vmprint/contracts            Shared TypeScript interfaces
engine/                 @vmprint/engine               Deterministic layout engine
cli/                    @vmprint/cli                  vmprint CLI (JSON → PDF)
pressrun/               pressrun                      Minimal engine bootstrap example
guides/                 (docs)                        Focused authoring guides
references/             (docs)                        Compact reference material
(External)              @vmprint/context-*            PDF, SVG, Canvas contexts
(External)              @vmprint/font-managers        Local, standard, and web font managers
(External)              @vmprint/transmuters          Markdown → DocumentInput converters
(External)              draft2final                   Markdown-first authoring CLI
```

The dependency graph is intentionally shallow:

- `contracts` has no dependencies — it is pure interfaces
- `engine` depends on `contracts` only
- Contexts, font managers, and transmuters depend on `contracts` only
- The CLIs wire the pieces together

Nothing in the engine knows which context is being used. Nothing in any context knows how the engine works. The contracts are the only shared surface. This is the seam that makes everything else possible: new output format, new font source, new source language — none of them require touching the engine.

---

## The Four Contracts

`@vmprint/contracts` defines four interfaces. These are the only extension points in the system.

### `Context`

The drawing surface. The engine renders to a `Context`; the context writes to whatever output format it supports.

Key responsibilities:

- Document lifecycle: `addPage()`, `end()`
- Output: `pipe(stream)` — connects to a `VmprintOutputStream` (write / end / waitForFinish); implement as a no-op if the context manages its own output
- Font registration: `registerFont(id, buffer, options?)`
- Drawing state: `save()`, `restore()`, `translate()`, `rotate()`, `opacity()`, `fillColor()`, `strokeColor()`
- Shapes: `moveTo()`, `lineTo()`, `rect()`, `roundedRect()`, `fill()`, `stroke()`, `fillAndStroke()`
- Text: `text(str, x, y, options)` for ordinary text; `showShapedGlyphs(fontId, fontSize, color, x, y, ascent, glyphs)` for pre-shaped RTL/CTL glyphs
- Images: `image(source, x, y, options)`
- Coordinate query: `getSize()` — returns `{ width, height }` in points

The engine always works in top-left coordinates with points as the unit. Each context is responsible for mapping that into its own coordinate system.

One design note on `showShapedGlyphs`: the engine runs text shaping at layout time and stores shaped glyph IDs in each `TextSegment`. When a context renders these segments, it emits the pre-computed IDs directly, bypassing any re-shaping the backend might do. This is how Arabic, Hebrew, and other complex scripts render correctly without an external shaping library.

### `FontManager`

Font resolution and loading. The engine asks the font manager for fonts by family; the font manager finds and loads the buffers.

Key responsibilities:

- `getFontRegistrySnapshot()` — return the current registry state
- `resolveFamilyAlias(family)` — normalize family names
- `getFontsByFamily(family, registry)` — find matching entries
- `loadFontBuffer(src)` — load raw font data as `ArrayBuffer`
- `registerFont(config, registry)` — add a font to the registry

Implementations provided: `@vmprint/local-fonts` (Node.js filesystem), `@vmprint/standard-fonts` (built-in PDF fonts, no font files required), `@vmprint/web-fonts` (browser fetch).

### `Transmuter`

Source-to-AST conversion. A transmuter takes some input (typically a string) and returns a `DocumentInput` — the VMPrint AST.

```ts
interface Transmuter<Input = string, Output = unknown, Options extends TransmuterOptions = TransmuterOptions> {
    transmute(input: Input, options?: Options): Output;
    getBoilerplate?(): string;
}
```

Options accept `config` and `theme` paths, which transmuters use to control output formatting. `getBoilerplate()` optionally returns starter document text that the CLI can scaffold.

Transmuters have no dependency on the engine, the context, or the font manager. They are pure source transformers — testable standalone and portable across Node.js, browser, and edge environments. A transmuter test is just: "given this Markdown, does the resulting AST look right?" No fonts, no pages, no PDF output required. The semantic rules for each source format are fully auditable in isolation.

Available transmuters include `@vmprint/mkd-mkd` (general Markdown), `@vmprint/mkd-academic`, `@vmprint/mkd-literature`, `@vmprint/mkd-manuscript`, and `@vmprint/mkd-screenplay`. All are now hosted in the [standalone transmuters repository](https://github.com/cosmiciron/vmprint-transmuters).

### `OverlayProvider`

Debug and inspection hooks. An overlay provider can draw behind (`backdrop`) or on top of (`overlay`) each rendered page, receiving a read-only view of the page's box structure.

```ts
interface OverlayProvider {
    backdrop?(page: OverlayPage, context: OverlayContext): void;
    overlay?(page: OverlayPage, context: OverlayContext): void;
}
```

Overlays are not authored content. They are development and inspection tools — content frames, zone footprints, gutter annotations, actor occupancy maps. See [OVERLAY.md](OVERLAY.md) for authoring details.

---

## Data Flow

A document goes through three stages to become output.

### Stage 1 — Source → DocumentInput (Transmute)

A transmuter converts source text into a `DocumentInput` — the VMPrint AST. This stage is optional: if you are authoring JSON directly, you skip it.

```
Markdown / screenplay / etc.
        ↓  Transmuter.transmute()
   DocumentInput (VMPrint AST, version 1.1)
```

The `draft2final` CLI uses transmuters. The `vmprint` CLI takes AST JSON directly.

### Stage 2 — DocumentInput → Page[] (Layout)

The engine runs the AST through its spatial simulation and produces a flat list of pages, each containing a flat list of absolutely-positioned boxes.

```
   DocumentInput
        ↓  engine.layout(input, fontManager)
   Page[]  (flat, absolutely-positioned Box[] per page)
```

Box coordinates are in points, top-left origin. Every box carries semantic provenance: `sourceId`, `fragmentIndex`, `transformKind`, `isContinuation`. The output is completely flat — no hierarchy, no relative positioning, no layout logic remaining.

The page geometry in that output is resolved per page. Document defaults define
the base viewport, and `layout.pageTemplates` can override dimensions,
orientation, and margins for matching pages before the simulation measures that
page. A mixed-media document can therefore contain a letter page, a narrow
receipt, and a short insert in the same `Page[]` stream without renderer-side
guesswork.

If the document has scripts, they participate in the layout lifecycle from inside this stage. Scripts can set initial content, read settled facts (page count, discovered elements), mutate structure, and coordinate between elements via messages — all without triggering a full re-layout. See [SCRIPTING-API.md](SCRIPTING-API.md).

### Stage 3 — Page[] → Output (Render)

The engine walks each page, calls `context.addPage()`, and emits each box to the context via drawing primitives.

```
   Page[]
        ↓  walk boxes → context.addPage(), text(), image(), shapes...
   Output  (PDF bytes, canvas pixels, SVG nodes, etc.)
```

The overlay hooks fire per page at this stage — `backdrop` before page content, `overlay` after.

Renderers receive the resolved `page.width` and `page.height` for every page.
PDF contexts that support adding pages with explicit dimensions use those values
as real media boxes, including when rendering from a cached layout stream.

---

## The Document Model

`DocumentInput` is the VMPrint-native format. It is plain JSON:

```json
{
  "documentVersion": "1.1",
  "layout": {
    "pageSize": "LETTER",
    "margins": { "top": 72, "right": 72, "bottom": 72, "left": 72 },
    "pageTemplates": [
      { "pageIndex": 1, "pageSize": { "width": 280, "height": 420 } }
    ],
    "fontFamily": "Times New Roman",
    "fontSize": 12,
    "lineHeight": 1.45
  },
  "styles": {
    "h1": { "fontSize": 18, "fontWeight": "bold", "marginBottom": 10 }
  },
  "header": { "default": { "elements": [ ... ] } },
  "footer": { "default": { "elements": [ ... ] } },
  "elements": [ ... ]
}
```

The `type` field on each element is a plain string. The engine reserves a short list of structural types (`table`, `table-row`, `table-cell`, `story`, `strip`, `zone-map`), but everything else — `p`, `h1`, `blockquote`, `code`, whatever — is just a label used to look up a base style from the `styles` map.

The `type` field on each element is a plain string. The engine reserves a short list of structural types (`table`, `table-row`, `table-cell`, `story`, `strip`, `zone-map`), plus the visible spatial body actor `field-actor`. Everything else is just a label used to look up a base style from the `styles` map.

`layout.worldPlain` is the authored way to declare a document-stage world substrate. It is deliberately not authored as `type: "world-plain"`. The engine may synthesize an internal world-plain host at runtime, but that wrapper is an implementation detail rather than part of the public AST.

Spatial presence is exposed separately from visual skin. A rock, hazard, creature, or invisible pressure source should be modeled as a `field-actor` plus `properties.spatialField`, not as `image + spatialField`.

For the full element and property reference, see [AST-REFERENCE.md](AST-REFERENCE.md).

---

## The All-Flat Box Model

Every element in the document, regardless of nesting, is eventually reduced to a flat list of `Box` objects per page:

```ts
interface Box {
    type: string;           // from source element type
    x: number;              // absolute position from page top-left, in points
    y: number;
    w: number;
    h: number;
    lines?: RichLine[];     // pre-shaped text lines
    image?: BoxImagePayload;
    style: ElementStyle;
    meta?: BoxMeta;         // sourceId, fragmentIndex, transformKind, isContinuation
}
```

There are no nested box trees in the output. A table is a set of flat boxes. A drop-cap paragraph is two flat boxes side by side. A zone-map is a flat list of independently positioned region boxes. The renderer iterates `page.boxes` in z-index order and paints each one. It never recurses or resolves containment.

This is not just an optimization — it is a correctness boundary. The renderer cannot accidentally make a layout decision because there are no layout decisions left to make. Every bug class that involves "the renderer didn't account for nesting" or "stacking context interacted with clipping in an unexpected way" is structurally excluded. Overlays receive the same flat representation and require no understanding of the element model at all.

---

## The Packager Architecture

Every element is converted to a `PackagerUnit` before simulation begins. The unit encapsulates all element-specific layout behavior.

```
elements[] → createPackagers() → PackagerUnit[] → simulation → Page[]
```

The `PackagerUnit` interface is small:

```ts
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

Concrete implementations:

| Packager | Handles |
|---|---|
| `FlowBoxPackager` | Standard paragraphs, headings, standalone images |
| `DropCapPackager` | Drop-cap paragraphs (cap glyph box + wrapped body) |
| `StoryPackager` | Multi-column DTP stories with float/wrap image placement |
| `TablePackager` | Multi-column tables with header repeat and row pagination |
| `TocPackager` | Table-of-contents assembly |
| `ZonePackager` | `zone-map` independent region layout |
| `FieldActorPackager` | Visible actor bodies that publish generic spatial fields |
| `WorldPlainPackager` | Internal host synthesized from `layout.worldPlain` |
| `SpatialGridPackager` | Grid-based spatial layout |

The simulation loop is type-agnostic. It knows nothing about paragraphs vs. tables vs. stories. All layout-specific logic is inside the packager objects. Adding a new element type means adding a `PackagerUnit` implementation and a branch in `createPackagers()`. The simulation loop does not change. This is the open/closed principle in practice: the loop is closed to modification and open to extension through new packager implementations.

Each packager is self-splitting. When the simulation determines a packager needs to cross a page boundary, it calls `split(availableHeight)`. The packager returns a `[partA, partB]` pair — a current fragment and a continuation. Both are full `PackagerUnit` instances. The loop handles them identically to any other unit, which means split logic does not require special handling anywhere outside the packager itself. A paragraph splits at line boundaries. A table splits at row boundaries. A story freezes its first-page layout and carries the remainder forward. Each packager owns its own split semantics completely.

---

## Wiring It Together

The `vmprint` CLI is the reference for how the pieces connect:

```
CLI reads DocumentInput
  → instantiates FontManager (local-fonts or standard-fonts)
  → instantiates Context (context-pdf, piped to a file stream)
  → calls engine.layout(input, fontManager)  →  Page[]
  → walks Page[], calls context.addPage() + draw primitives per box
  → optionally calls overlayProvider.backdrop() / overlay() per page
  → calls context.end() + waitForFinish()
```

`draft2final` adds one step before this: it calls a transmuter to produce `DocumentInput`, then hands off to the same pipeline.

---

## Extension Points

### Write a new context

Implement `Context` from `@vmprint/contracts`. The engine calls your drawing methods with top-left, points-based coordinates. Map them to your output format. `showShapedGlyphs` can be a no-op if your target does not need RTL text. `pipe()` can be a no-op if the context manages its own output.

### Write a new font manager

Implement `FontManager` from `@vmprint/contracts`. The engine calls `getFontsByFamily` and `loadFontBuffer` when it needs to measure or embed fonts. A CDN-backed implementation, an in-memory bundle, or a browser `FontFace` bridge all fit the same interface.

### Write a new transmuter

Implement `Transmuter` from `@vmprint/contracts`. Return a valid `DocumentInput`. Your transmuter can read a config YAML and a theme YAML to control output behavior and style — or ignore them if your format does not need them. See the [standalone transmuters repository](https://github.com/cosmiciron/vmprint-transmuters) for working examples.

### Write a debug overlay

Implement `OverlayProvider` from `@vmprint/contracts`. The engine calls `backdrop` and `overlay` once per page, passing the page's box structure and a drawing context. You get full access to the same drawing primitives as the main renderer, in the same coordinate space.

---

## Key Design Properties

| Property | How it's achieved |
|---|---|
| Flat box output | All packagers reduce to `Box[]`; no nesting in the output |
| Type-agnostic simulation loop | Packager interface encapsulates element-specific logic |
| Deterministic layout | No randomness, immutable input, keyed measurement cache |
| Context independence | Renderer only calls `Context` interface primitives; layout is pre-computed |
| Extensible element types | New type = new `PackagerUnit` + one branch in `createPackagers()` |
| Extensible output formats | New context = new `Context` implementation |
| Extensible source formats | New transmuter = new `Transmuter` implementation |
| Source traceability | Every `Box` carries `BoxMeta` with `sourceId`, `fragmentIndex`, `transformKind` |
| Multilingual text | Pre-shaped glyphs in `TextSegment.glyphs`; `showShapedGlyphs` bypasses re-shaping |
| Debug/inspection | `OverlayProvider` receives same flat box representation as the renderer |

---

## See Also

- [ENGINE-INTERNALS.md](ENGINE-INTERNALS.md) — how the spatial simulation engine works: actors, packagers, boxes, settlement, speculative pathfinding, oscillation detection
- [AST-REFERENCE.md](AST-REFERENCE.md) — the DocumentInput contract: all element types, properties, and layout options
- [SCRIPTING-API.md](SCRIPTING-API.md) — the scripting surface: lifecycle events, element addressing, messaging, structural mutation
- [OVERLAY.md](OVERLAY.md) — overlay authoring and debug tools
- [Quickstart](../QUICKSTART.md) — build, run, and verification instructions
