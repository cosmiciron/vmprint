# Spatial IR Design

**Status: Active migration — validated by fixture conversion and internal runtime slices for flow blocks, zone strips, stories, and tables**

This document specifies the Spatial Intermediate Representation (Spatial IR): a new structural layer sitting inside Layer 3 (Document Semantics) of the VMPrint four-layer architecture. It defines the IR's node catalogue, its relationship to the existing pipeline, what work belongs at normalize time versus march time, and how it changes the packager contracts.

---

## 1. Motivation

### The impedance mismatch

The engine is a spatial simulation. Internally, everything is coordinates: `cursorY`, exclusion rectangles, `(x, y, w, h)` box placements, obstacle fields. Pages are bounded arenas. Elements are actors navigating constraint fields. This is correct and coherent.

The AST surface is a document tree. It uses DOM vocabulary: elements are nested inside containers (`children`), structural relationships are expressed as parent-child hierarchy, positions are *implied* by tree structure and layout rules rather than declared. This is inherited from the document-publishing tradition and still useful for authors.

The gap between these two representations — DOM vocabulary in, spatial simulation out — is the source of most layout bugs, most architectural complexity, and most of the "gotchas" in the LAYOUT-SKILL guide. Every time the engine has to infer spatial meaning from document structure, there is a potential mismatch:

- `contentWidthOverride` — invented to thread zone column width through a context that only knows about margins and page width
- Float ordering dependency — floats are children with cursor-position-dependent behavior, so their array position in `children` must encode spatial intent
- `story-absolute` restricted to images — because the AST has no concept of a first-class absolute spatial declaration, the feature was bolted onto the float mechanism
- `columnSpan: "all"` as a special property — because there was no way in the DOM model to say "this element lives in region-space, not column-local-space"

### The proposal

Introduce a **Spatial IR** as the normalized output of Layer 3's first pass. The Spatial IR is what the engine actually wants to work with — spatial declarations with pre-resolved geometry, not DOM nodes with implied positions.

The pipeline becomes:

```
DocumentInput (AST)
    ↓
[Normalization Pass]   ← new: Layer 3a
    ↓
Spatial IR             ← new: explicit spatial declarations
    ↓
[FlowBox Shaping]      ← existing: per-element text layout
    ↓
FlowBox                ← existing: shaped but unpositioned
    ↓
[March / Physics]      ← existing: spatial simulation
    ↓
Positioned Boxes
```

The normalization pass is the single point where DOM vocabulary is translated into spatial declarations. Nothing downstream ever sees a raw AST node again.

---

## 2. Design Principles

**1. Geometry that can be resolved at normalize time must be resolved at normalize time.**
Column widths, zone widths, obstacle x positions, grid cell x positions and widths — these depend only on declared constraints and the page geometry known before the march begins. They belong in the IR, not in the packager.

**2. Geometry that depends on cursor state belongs to the march.**
Obstacle anchor Y positions (floats anchor where the cursor is when they are encountered), row heights in grids (depend on cell content height), line break positions (depend on available width and font metrics), page assignments — these cannot be pre-resolved.

**3. The IR uses spatial vocabulary, not DOM vocabulary.**
Nodes are *regions*, *zones*, *strips*, *grids*, *obstacles*. There are no *children*, no *containers*, no *parents*. Content is *assigned* to zones, not *nested* inside containers. No AST concept survives the normalizer pass unless it is a pure spatial or content fact.

**4. Story and zone-map are the same primitive.**
Both are a strip of spatial zones with pre-resolved widths. The only difference is overflow behavior: linked (content chains from zone to zone) vs. independent (each zone runs in isolation). One IR node covers both.

**5. Block floats are extracted from flow at normalize time.**
Float elements at block level are separated from their siblings in the normalization pass and become `BlockObstacle` nodes with pre-resolved x positions and dimensions. Their `y` anchor remains a march-time decision (they anchor at cursor Y when encountered in flow order). This removes the ordering dependency from the AST but preserves the flow-order semantics.

**6. `contentWidthOverride` is eliminated.**
Every zone in the IR carries its resolved width explicitly. FlowBoxPackager reads `zone.width` directly. There is no context threading, no sentinel values, no fallback chain.

**7. The normalizer is the domain brain. Packagers are pure layout actors.**
All geometric intelligence — track sizing, zone width resolution, obstacle x computation, float extraction, columnSpan splitting — belongs in the normalizer. Packagers receive pre-resolved geometry and run layout only. They do not interpret AST properties. They do not make geometric decisions.

**8. `pageOverrides` cannot alter horizontal page geometry.**
Zone widths are pre-resolved against the page's declared horizontal geometry (left/right margins, contentWidth). `pageOverrides` on a `FlowBlock` may only change header/footer content and vertical geometry (top/bottom margins). Changing left/right margins via `pageOverrides` would invalidate pre-resolved zone widths and is explicitly forbidden. If a page requires different horizontal geometry, it must declare a new layout zone, which the normalizer can compile statically.

**9. Coordinate space must be explicit and uniform.**
`SpatialZone.x`, `ResolvedColumn.x`, and `GridCell.resolvedX` are always relative to their immediate parent frame. They are page-relative only when the parent frame is the page itself. Nested strips, grids, and cells therefore rebase naturally instead of leaking page-space coordinates downward.

**10. Every IR node carries source provenance.**
The IR is also a debugging and review surface, not just a runtime contract. Nodes therefore carry lightweight provenance describing the originating AST path and, when available, source identifiers such as `sourceId`, `semanticRole`, `reflowKey`, `language`, and source-range metadata. This data is diagnostic only; packagers must not derive geometry from it.

---

## 3. IR Node Catalogue

### 3.1 SpatialZone

The fundamental unit. A bounded rectangular region with a single content assignment. Carries no height — height is always a march-time outcome.

```typescript
interface SpatialZone {
    id?: string;
    x: number;          // resolved at normalize time: left edge in parent-local space
    width: number;      // resolved at normalize time: from track sizing or explicit value
    style?: Record<string, unknown>;
    content: ZoneContent;
}
```

`SpatialZone` is not a standalone IR node — it appears as a member of `ZoneStrip` and `SpatialGrid`.

---

### 3.2 ZoneStrip

Replaces both `story` and `zone-map`. A horizontal arrangement of `SpatialZone` nodes with a declared overflow behavior.

```typescript
interface ZoneStrip {
    kind: 'zone-strip';
    zones: SpatialZone[];
    overflow: 'linked' | 'independent';
    sourceKind: 'story' | 'zone-map';  // diagnostics only
    content?: ZoneContent;             // linked strips carry their flow stream here
    balance?: boolean;                 // story-only; preserved after normalization
    blockStyle?: ResolvedBlockStyle;   // style applied to the strip container itself
    source: SourceRef;
}
```

**`overflow: 'linked'`** (story semantics): the march treats all zones as a single flow lane. When zone `i` fills, content continues in zone `i+1`. A `ZoneStrip` with one zone and `overflow: linked` is the degenerate case of a single-column story. In this form, `zones[]` defines the lane geometry while `content.items[]` defines the ordered stream that pours through those lanes.

**`overflow: 'independent'`** (zone-map semantics): each zone runs its own layout sub-session. Content in zone A does not interact with zone B.

In this form, content remains attached to each `SpatialZone` directly. The strip owns the geometry and overflow semantics; each zone owns its own independent content session.

The strip's height in the document flow = height of the tallest zone in both cases.

**Normalization from `story`:**

```
element.columns → N equal-width zones, widths from equal division of contentWidth minus gutters
element.children → partitioned on columnSpan boundaries (see §3.2a below)
overflow: 'linked'
```

**Normalization from `zone-map`:**

```
element.properties.zones.columns → zone widths solved by solveTrackSizing
element.properties.zones.gap → spacing between zones
element.zones[i].elements → ZoneContent for zone i
overflow: 'independent'
```

**Why `balance` survives normalization:** fixture conversion proved that `balance` is not an implementation detail hidden inside `StoryPackager`; it is part of authored layout intent. Carrying it explicitly on `ZoneStrip` keeps that intent inspectable and lets strip splitting preserve the semantics segment-by-segment.

---

### 3.2a columnSpan Normalization: Strip Splitting

`columnSpan` elements in a multi-column story are **not** annotations on `FlowBlock` that the packager must detect and handle. The normalizer resolves them structurally.

When the normalizer encounters a `columnSpan: "all"` element inside a multi-column story, it **splits the story into a sequence of IR nodes**:

```
story [A, B, SPAN, C, D, SPAN2, E]
    ↓ normalize
[ZoneStrip([A, B]), FlowBlock(SPAN), ZoneStrip([C, D]), FlowBlock(SPAN2), ZoneStrip([E])]
```

Each `ZoneStrip` segment is an independent linked-overflow strip. The spanning `FlowBlock` is a regular block in the main document flow at full content width — there is nothing special about it structurally.

**Why this is correct:** A column-spanning element physically bisects the columns. It is not "inside" any zone strip. It sits between two strips in page space. Expressing this as a sequence of `[ZoneStrip, FlowBlock, ZoneStrip]` is spatially honest; it requires zero special behavior from the packager.

**`columnSpan` is removed from `FlowBlock`.** It is consumed entirely at normalize time and has no presence in the IR.

**Degenerate case:** A single-column story that contains a `columnSpan` element is normalized without splitting — the strip has only one zone, and spanning it is a no-op. The normalizer may elide the split entirely in this case.

**`balance` flag interaction:** `balance: true` applies independently to each `ZoneStrip` segment. This is correct — you cannot balance content across a spanning element. The split makes this obvious; no special handling is required.

---

### 3.3 SpatialGrid

Replaces `table`. A constrained region grid where rows share height.

```typescript
interface SpatialGrid {
    kind: 'spatial-grid';
    resolvedColumns: ResolvedColumn[];  // widths + x offsets, solved at normalize time
    columnGap: number;
    rowGap: number;
    headerRows: number;
    headerRowIndices: number[];
    hasRowSpan: boolean;
    headerHasRowSpan: boolean;
    repeatHeader: boolean;
    cells: GridCell[];
    blockStyle?: ResolvedBlockStyle;
    source: SourceRef;
}

interface ResolvedColumn {
    x: number;      // resolved at normalize time, parent-local
    width: number;  // resolved at normalize time
}

interface GridCell {
    row: number;
    col: number;
    rowSpan: number;        // default 1
    colSpan: number;        // default 1
    resolvedX: number;      // resolved at normalize time (accounts for colSpan)
    resolvedWidth: number;  // resolved at normalize time (accounts for colSpan)
    rowGroup?: 'header' | 'body' | 'footer';
    content: ZoneContent;
    style: ResolvedCellStyle;
    source: SourceRef;
}
```

Grid cells are already non-paginating sub-sessions in the current engine. In the IR this is made explicit: each `GridCell` carries its own `ZoneContent`, identical in form to a `SpatialZone`'s content. The `SpatialGridPackager` becomes a grid orchestrator: run independent layout passes per cell, then resolve shared row heights.

`headerRowIndices`, `hasRowSpan`, and `headerHasRowSpan` survive normalization because they directly affect split legality and repeated-header behavior. They are operational fields, not merely diagnostics.

**Normalization from `table`:**

```
element.properties.table.columns → resolvedColumns via solveTrackSizing
table-row children → rows; table-cell children → GridCell nodes
colSpan / rowSpan → resolved into resolvedX / resolvedWidth at normalize time
semanticRole / explicit headerRows → rowGroup + headerRowIndices
```

**Row groups are first-class in V1.** Header/body/footer provenance is already valuable in the generated fixtures and the internal normalized-table runtime slice. `headerRows` remains as a compatibility summary, but `rowGroup` is the more honest structural form.

---

### 3.4 ZoneContent

The content assigned to a zone or grid cell.

```typescript
interface ZoneContent {
    items: ZoneContentItem[];
}

type ZoneContentItem =
    | FlowBlock       // text/inline content participating in flow
    | BlockObstacle   // block-level float extracted from flow
    | ZoneStrip       // nested story or zone-map
    | SpatialGrid;    // nested table
```

`items` is an **ordered sequence**. The march processes items in order. For `BlockObstacle` nodes, flow order determines when the obstacle anchors its Y position relative to the surrounding flow. This ordering is set by the normalizer based on the original `children` array order, making the spatial intent explicit rather than implicit.

`ZoneStrip` and `SpatialGrid` appear directly as items — they are not wrapped in a `FlowBlock`. The `ZoneStripPackager` dispatches to the appropriate sub-packager when it encounters a structural node in the items sequence.

### 3.4a SourceRef

Every IR node may carry the same lightweight provenance payload:

```typescript
interface SourceRef {
    path: string;              // canonical AST path used during normalization
    sourceId?: string;
    semanticRole?: string;
    reflowKey?: string;
    language?: string;
    sourceSyntax?: string;
    sourceRange?: Record<string, unknown>;
}

interface EmbeddedImageDescriptor {
    mimeType: string;
    intrinsicWidth: number;
    intrinsicHeight: number;
    fit: 'contain' | 'fill';
}
```

This payload exists for diagnostics, debugging, snapshot readability, and future editor integration. It is not part of the placement algorithm.

---

### 3.5 FlowBlock

A single block-level text element participating in flow. Contains only content and presentation facts — no structural or geometric facts.

```typescript
interface FlowBlock {
    kind: 'flow-block';
    sourceType: string;                 // original element type string (diagnostics)
    content: string;                    // text content
    inlineChildren?: FlowInlineRun[];   // rich text runs, if any
    inlineObstacles?: InlineObstacle[]; // future: sub-block float anchoring (see §3.6b)
    style: ResolvedBlockStyle;          // merged: styles[type] + properties.style
    keepWithNext: boolean;
    pageBreakBefore: boolean;
    allowLineSplit: boolean;
    overflowPolicy: 'clip' | 'move-whole' | 'error';
    dropCap?: ResolvedDropCap;
    paginationContinuation?: PaginationContinuation;
    pageOverrides?: PageOverrides;      // march-time only; see Principle 8
    image?: EmbeddedImageDescriptor;    // when the block carries authored image payload
    source: SourceRef;
}
```

`FlowBlock` has no `nested` field and no `columnSpan` field. Neither survives the normalizer:
- Structural nesting (`ZoneStrip`, `SpatialGrid`) appears directly in `ZoneContentItem`, not wrapped.
- `columnSpan` is consumed at normalize time to produce strip splits (§3.2a).

---

### 3.6 BlockObstacle

A block-level float element extracted from flow at normalize time. X position and dimensions are pre-resolved; Y anchor is march-time.

```typescript
interface BlockObstacle {
    kind: 'block-obstacle';
    resolvedX: number;      // pre-resolved: alignment rule + zone width + gap
    width: number;          // from style.width
    height: number;         // from style.height (or intrinsic for images)
    wrap: 'around' | 'top-bottom' | 'none';
    gap: number;
    yAnchor: 'at-cursor';   // V1: anchors at cursor Y when encountered in items order
    align: 'left' | 'center' | 'right';
    mode: 'float' | 'story-absolute';
    content: FlowBlock;     // rendered inside the obstacle bounds
    source: SourceRef;
}
```

`resolvedX` at normalize time:
- `align: 'left'`  → `0`
- `align: 'center'` → `(zoneWidth - width) / 2`
- `align: 'right'` → `zoneWidth - width - gap`
- `mode: 'story-absolute'` → `layout.x`

**Extraction:** any `children` element with `layout.mode === 'float'` or `'story-absolute'` is converted to a `BlockObstacle` at its position in the `items` sequence. Its flow siblings become `FlowBlock` nodes at their respective positions.

`align` and `mode` survive in the IR even though `resolvedX` is already known. The generated regression fixtures made it clear that this intent remains useful for diagnostics and for future packager evolution.

---

### 3.6b InlineObstacle (Reserved — V2)

A future node type for sub-block float anchoring: a float that should anchor at a specific line within a paragraph, rather than at the paragraph boundary.

```typescript
// Reserved — not implemented in V1
interface InlineObstacle {
    kind: 'inline-obstacle';
    // ... to be designed
}
```

`FlowBlock.inlineObstacles` reserves the slot. When implemented, the `FlowBoxPackager` (not the `ZoneStripPackager`) handles `InlineObstacle` anchoring — it triggers when the text shaper reaches the specific inline position. This is fundamentally different from `BlockObstacle`, which the strip packager handles by placing the obstacle between blocks.

The distinction between `BlockObstacle` (strip packager concern) and `InlineObstacle` (flow-box packager concern) is a hard architectural boundary.

---

## 4. The Normalize-Time / March-Time Boundary

This boundary is the most important architectural constraint of the Spatial IR.

### Resolved at normalize time

| What | Why it can be pre-resolved |
|------|---------------------------|
| Zone / column widths | Depends only on track declarations + page contentWidth |
| Zone x positions | Derived from widths + gap |
| Grid cell x positions and widths | Derived from track sizing + colSpan |
| Obstacle x positions | Derived from alignment rule + zone width |
| Obstacle dimensions | Declared in `style.width` / `style.height` |
| Style merging | `styles[type]` + `properties.style` — no layout dependency |
| Source provenance capture | Structural: copied from authored nodes during normalization |
| Block float extraction | Structural: identifying which children are obstacles |
| columnSpan strip splitting | Structural: partitioning story children into strip segments |

### Resolved at march time

| What | Why it cannot be pre-resolved |
|------|-------------------------------|
| Obstacle y anchor | Depends on cursor Y when encountered during the march |
| Row heights in SpatialGrid | Depends on cell content height, which requires text shaping |
| Page assignments | Depends on cumulative element heights |
| Line break positions | Depends on available width + font metrics during FlowBox shaping |
| Column assignment in linked ZoneStrip | Depends on how content fills each zone during the march |
| Story height (tallest column) | Depends on march outcome |
| pageOverrides application | Depends on which page a FlowBlock lands on |

### The pageOverrides contract (Principle 8)

`pageOverrides` on a `FlowBlock` may change:
- Header/footer content (swapping in different `elements[]` for the landing page)
- Vertical margin adjustments (`marginTop`, `marginBottom`)

`pageOverrides` may **never** change:
- `marginLeft`, `marginRight`
- `contentWidth`
- Any property that affects horizontal geometry

**Reason:** Zone widths are pre-resolved at normalize time against the declared horizontal geometry. If `pageOverrides` could alter left/right margins, the pre-resolved IR widths would be geometrically wrong for those pages — a fatal paradox. This constraint must be validated at the normalizer boundary and rejected (with a descriptive error) if violated.

---

## 5. How `contentWidthOverride` Is Eliminated

This is the clearest concrete proof of the IR's value.

**Current situation:**
`FlowBoxPackager.prepare(availableWidth, context)` receives the zone's lane width as `availableWidth` (for physics placement) but needs the zone's content width for text wrapping. These are different values when the physics runtime has adjusted `context.margins` for exclusion lane placement. The mismatch required `PackagerContext.contentWidthOverride` — an optional field set only by zone sub-sessions so FlowBoxPackager knows which width to use for line wrapping.

**With the Spatial IR:**
`FlowBoxPackager` receives a `FlowBlock` whose parent zone has an explicit `width: number`. The packager wraps text at `zone.width`. There is no context field, no sentinel value, no fallback chain. The zone's width is a first-class property of the IR node the packager is consuming.

The `contentWidthOverride` field is removed from `PackagerContext`. The `createFlowMaterializationContext` guard for negative sentinel values is removed. The dual-parameter `materialize(availableWidth, contentWidth)` signature collapses back to `materialize(availableWidth)`.

---

## 6. Packager Contract Changes

### Current contract

Packagers receive a raw AST element and a `PackagerContext`. They must interpret AST properties, resolve styles, derive geometry, and run layout — all mixed together.

### New contract

Packagers receive an IR node and a `PackagerContext`. Geometry is pre-resolved. Style is pre-merged. The packager only runs layout. No IR node type interpretation, no style lookup, no geometric derivation.

**FlowBoxPackager** — receives `FlowBlock`. Wraps text at the enclosing zone's declared width. No `contentWidthOverride`. No style lookup.

**ZoneStripPackager** (replaces StoryPackager + ZonePackager) — receives `ZoneStrip`. Iterates `items[]`. Dispatches `FlowBlock` to `FlowBoxPackager`, `BlockObstacle` to `ObstaclePackager`, `ZoneStrip` and `SpatialGrid` recursively to their own packagers. For `overflow: linked`, chains content across zones. For `overflow: independent`, runs isolated sub-sessions per zone. Zone widths come from `zone.width`.

**SpatialGridPackager** (replaces TablePackager) — receives `SpatialGrid`. Iterates `cells[]` in row order. Runs a per-cell non-paginating layout pass using `cell.resolvedWidth`. Resolves shared row heights after all cells are laid out.

**ObstaclePackager** — receives `BlockObstacle`. Registers the obstacle rectangle in the zone's spatial map. Renders `obstacle.content` (a `FlowBlock`) inside the obstacle bounds.

---

## 7. The Normalizer

The normalizer is a pure function:

```typescript
function normalizeDocument(doc: DocumentInput, pageGeometry: PageGeometry): SpatialDocument
```

`SpatialDocument` is the top-level IR: an ordered sequence of `ZoneContentItem` nodes representing the main document flow.

The normalizer, in order:
1. Resolves `layout` config into `pageGeometry` (contentWidth, contentHeight, margins)
2. Validates that no horizontal geometry fields appear in any `pageOverrides` (error if violated)
3. Builds the merged styles table for lookups during normalization
4. Walks `elements[]`, normalizing each element:
   - `story` → scan children for `columnSpan` boundaries; produce `[ZoneStrip, FlowBlock, ZoneStrip, ...]` sequence; resolve column widths; preserve `balance`; attach strip-level `blockStyle`; extract block floats from each segment's children into `BlockObstacle` nodes
   - `zone-map` → run `solveTrackSizing` on `properties.zones.columns`; produce `ZoneStrip { overflow: independent }`; attach zone-local content to `SpatialZone.content`; preserve zone/strip container styles
   - `table` → run `solveTrackSizing` on `properties.table.columns`; flatten row/cell hierarchy into `SpatialGrid`; resolve `colSpan`/`rowSpan` into `resolvedX`/`resolvedWidth`; annotate row-group provenance
   - any element with `layout.mode: 'float'` or `'story-absolute'` → `BlockObstacle` with pre-resolved x and dimensions
   - all other elements → `FlowBlock` with merged style
   - every emitted node → attach `SourceRef` diagnostics
5. Recursively normalizes nested structures (story inside zone, table inside cell, etc.)

The normalizer has **no side effects**, **no access to the physics runtime**, and **no knowledge of the march**. It is a pure structural transform. It produces a complete, self-contained spatial representation that the engine can run without consulting the original AST.

---

## 8. What Does Not Change

- **FlowBox** — the per-element shaped content representation. FlowBox shaping still happens lazily on first `prepare()` during the march. The Spatial IR sits above FlowBox; it describes structure and geometry, not glyph-level content.
- **The march** — the simulation loop, physics runtime, actor signaling, snapshot/rollback — unchanged. The march consumes IR nodes instead of raw AST nodes but its simulation mechanics are identical.
- **The AST** (`DocumentInput`) — fully backward compatible. Existing documents and transmuters are unaffected. The normalizer is the only consumer of the raw AST within the engine.
- **The renderer** — Layer 4 is untouched. It consumes positioned boxes, which the march still produces.

---

## 9. Migration Path

Each slice is independently testable against the existing 22 regression fixtures. A slice is complete only when all fixtures pass.

**Slice 1 — FlowBlock and style normalization.**
Introduce `FlowBlock` with pre-merged styles. Thread it through `FlowBoxPackager` alongside the existing AST element. Packager uses `FlowBlock.style` instead of calling the styles resolver. Zero-risk; proves the pipeline boundary.

**Slice 2 — ZoneStrip (zone-map only).**
Normalize `zone-map` into `ZoneStrip { overflow: independent }`. Introduce `ZoneStripPackager` as a thin wrapper around the existing `ZonePackager`. Delete `ZonePackager`. Fixture 21 drives this slice.

**Slice 3 — ZoneStrip (story) + columnSpan splitting.**
Normalize `story` into `ZoneStrip { overflow: linked }`, with columnSpan boundaries splitting into `[ZoneStrip, FlowBlock, ZoneStrip]` sequences. Extend `ZoneStripPackager` for linked overflow. Delete `StoryPackager`. Fixtures 05, 07, 08, 11, 15, 20 drive this slice. The columnSpan split eliminates all special-case packager logic for spanning elements simultaneously.

**Slice 4 — BlockObstacle extraction + contentWidthOverride removal.**
Extract block floats into `BlockObstacle` nodes at normalize time. `ZoneStripPackager` reads obstacles from `items[]` directly. Remove `PackagerContext.contentWidthOverride`, remove the guard in `createFlowMaterializationContext`, collapse `materialize()` signature. This slice makes float ordering explicit and removes the context hack. Fixtures 11, 15, 20 drive this slice.

**Slice 5 — SpatialGrid normalization boundary.**
Normalize `table` into `SpatialGrid` / normalized-table form and thread that structure through shaping, materialization, split fragments, and the dedicated `SpatialGridPackager` runtime path. This slice is now effectively in place, though some compatibility aliases still exist in code for the older table-oriented naming. Fixtures 09, 15 drive this slice.

**Slice 6 — Nested structures.**
Normalize stories, zone-maps, and tables appearing inside zone content or table cells into nested IR nodes appearing directly in `items[]`. `ZoneStripPackager` dispatches by `kind`. No wrapper nodes.

---

## 10. Open Design Questions

**Q1 — Should `ZoneStrip` be one node or two?**
Current proposal: one node with `overflow: 'linked' | 'independent'`. Alternative: `LinkedZoneStrip` and `IndependentZoneStrip` as distinct types sharing a `SpatialZone` member. The unified form is simpler; the two-type form makes dispatch exhaustive in TypeScript. The packager dispatch differs only in the overflow chain logic — a single branch — which favors the unified form. Leaning toward unified; revisit if the packager diverges significantly.

**Q2 — Where does FlowBox shaping fit relative to the normalizer?**
Currently FlowBox shaping is lazy — elements are shaped on first `prepare()` during the march. With the Spatial IR, all zone widths are known before the march begins. Option A (conservative): keep shaping lazy; `FlowBlock` carries the AST element reference; FlowBox is created on first `prepare()`. Option B (aggressive): eagerly shape all `FlowBlock` nodes during normalization, since zone widths are now pre-resolved. Option B would make the march a pure spatial simulation with no text shaping work remaining — conceptually cleaner but a larger change. Requires investigation into whether lazy shaping is load-bearing for performance (shaping content that never renders due to truncation, for instance).

**Q3 — How do headers and footers become IR nodes? (Resolved)**
Headers and footers are **page template elements**, not flow elements. They are not processed by the main flow march at all.

The normalizer compiles each selector variant (`firstPage`, `odd`, `even`, `default`) into a pre-resolved page-region node at known page-coordinate positions (the header/footer margin box). The result is a `PageTemplate` — a lookup table of pre-compiled page regions keyed by selector:

```typescript
interface CompiledPageRegion {
    kind: 'page-region';
    role: 'header' | 'footer';
    selector: 'default' | 'firstPage' | 'odd' | 'even';
    x: number;
    y: number;
    width: number;
    height: number;
    style?: ResolvedBlockStyle;
    content: ZoneContent;
}

interface PageTemplate {
    header: { firstPage?: CompiledPageRegion | null; odd?: CompiledPageRegion; even?: CompiledPageRegion; default?: CompiledPageRegion };
    footer: { firstPage?: CompiledPageRegion | null; odd?: CompiledPageRegion; even?: CompiledPageRegion; default?: CompiledPageRegion };
}
```

The `LayoutSession` (Layer 2) owns the page template. Before the main flow march begins work on a new page, the `LayoutSession` selects the appropriate header/footer zone by page parity/number and stamps it onto the page. The main flow packager loop is entirely unaware of headers and footers.

`pageOverrides` on a `FlowBlock` signals the `LayoutSession` to override the template selection for the page that block lands on — replacing the stamped zone with a different pre-compiled variant (or null to suppress). The march communicates this via the existing actor signal bus when the block is placed. No re-layout occurs; the override selects among already-compiled zones.

This resolves the current architecture where header/footer layout runs per-page. The normalizer does the layout work once per variant; the `LayoutSession` stamps the result. The march is not involved.

**Q4 — Does `SpatialGrid` need row groups now or can they be deferred? (Resolved)**
Row groups are worth carrying in V1.

Fixture conversion and the internal normalized-table runtime slice showed that table semantics are clearer when header/body/footer provenance is preserved explicitly instead of being reconstructed later from `headerRows` alone. Repeated-header behavior still uses `headerRows` and `headerRowIndices` as operational summaries, but `rowGroup` is now a first-class structural field on grid cells.

So the V1 position is:
- keep `rowGroup?: 'header' | 'body' | 'footer'` on `GridCell`
- keep `headerRows` and `headerRowIndices` as pagination-friendly summaries
- keep `repeatHeader` as a normalized policy field

This is slightly more verbose than the earlier sketch, but it matches the engine's real needs and makes the emitted IR easier to inspect.

---

## 12. The Normalizer Contract (Inversion of Control)

The introduction of the Spatial IR reveals a deeper architectural truth: **the engine does not need to own its input language.**

Attempting to design a single universal AST that perfectly serves both semantic, flow-driven documents (novels, screenplays, reports) and purely spatial, coordinate-driven tasks (DTP, visual editors) leads to a schema that is simultaneously too rigid for one domain and too loose for the other. The eventual result is feature bloat, contradictory properties, and normalized workarounds — exactly the `contentWidthOverride` class of problem.

The correct move is to extract the normalization step into an interface contract.

### The Interface

```typescript
interface Normalizer<TInput> {
    normalize(input: TInput, pageGeometry: PageGeometry): SpatialDocument;
}
```

This establishes a symmetrical boundary around the engine. The engine already has two extension interfaces:
- `FontManager` — abstracts asset loading (what fonts are available and how to load them)
- `Context` — abstracts output generation (where the positioned boxes go)

`Normalizer` completes the triad, abstracting input semantics (what the engine's consumer wants to express and how). The full boundary picture:

```
[TInput] → Normalizer → SpatialDocument → Engine → PositionedBoxes → Context → [TOutput]
                                            ↑
                                       FontManager
```

The engine core is blind to domain-specific formats at both ends. It accepts `SpatialDocument` and produces positioned boxes. Nothing more.

### SpatialDocument Is the Versioned Engine API

`SpatialDocument` is not an implementation detail — it is the stable, versioned contract the engine publishes. Normalizers handle format evolution on the input side. The engine commits to backward compatibility at the IR level only.

This is the LLVM model: Clang, Rust, and Swift all compile to the same IR; the optimizer and backend are IR-in, IR-out. Adding a new frontend language requires no changes to the optimizer. Adding a new optimization requires no changes to any frontend. The IR version is the contract.

For VMPrint: adding a new input domain (visual editor, custom DTP format, programmatic builder) requires a new `Normalizer` implementation, not an engine change. Adding a new physics capability (linked frames, absolute zones) requires an IR extension, with all normalizers updated to emit the new nodes — no engine core rewrites.

### Normalizer Implementations

**SemanticNormalizer** — ingests the current `DocumentInput` AST. This is the normalizer for flow-driven, semantically structured documents: manuscripts, reports, newsletters. `DocumentInput` does not disappear; it becomes the `TInput` type for this specific normalizer. Existing documents and transmuters are unaffected.

**SpatialNormalizer** — ingests absolute bounding box declarations: explicit `(x, y, width, height)` per zone, pre-calculated flex grids, direct coordinate placement. This is the normalizer for visual drag-and-drop editors and DTP tools. The editor's output canvas IS the IR; normalization is a near-trivial coordinate mapping. The engine renders it without semantic interpretation.

Future normalizers could ingest other formats: a Markdown AST directly (bypassing `DocumentInput`), a binary packed format, a builder API's object graph. The engine is indifferent.

### Effect on draft2final

The current pipeline:

```
Markdown → DocumentInput → Engine (normalizes internally)
```

With the Normalizer contract:

```
Markdown → DocumentInput → Normalizer (chosen by format) → SpatialDocument → Engine
```

The normalizer is not a pipeline optimization — it is the **format strategy**. When `draft2final` compiles Markdown "as" a newspaper, it injects a `NewspaperNormalizer` that understands newspaper-domain layout: multi-column `ZoneStrip` arrangements, pull-quotes extracted as `BlockObstacle` nodes by convention, headline hierarchy mapped to strip-splitting spans. When it compiles the same Markdown "as" a manuscript, a `ManuscriptNormalizer` produces a single-column flow with different typographic decisions baked into the IR.

The Markdown source and the `DocumentInput` it produces are identical in both cases. The domain knowledge of what "newspaper" or "manuscript" means spatially lives entirely in the normalizer. `draft2final`'s format and theme system already selects behavior per output target — the normalizer becomes the spatial expression of that selection.

This means the normalizer is the natural home for layout conventions that are currently scattered across theme YAML files, format handlers, and hardcoded style defaults. A `NewspaperNormalizer` knows that body text in a newspaper flows in three columns; it does not need to be told this through a configuration file — it produces the corresponding `ZoneStrip` structure directly. The spatial intent is encoded in the normalizer, not approximated through style overrides on top of a generic flow.

### Domain-Optimized Expressions

The deepest consequence of this architecture is not internal — it is user-facing.

Today, a newspaper designer using `draft2final` must learn the generic `DocumentInput` vocabulary and approximate newspaper structure through style overrides and theme YAML. They work against abstractions that were not designed for their domain: `story`, `zone-map`, `table`. These concepts get the job done but do not speak the designer's language.

With a `NewspaperNormalizer`, a newspaper designer works in newspaper terms: masthead, lead article, byline, above-the-fold strip, pull quote. The normalizer knows exactly what those mean spatially — which `ZoneStrip` structures they produce, which `BlockObstacle` nodes they generate, how the column grid is resolved. The user never sees IR vocabulary. That is the runtime's concern.

The same principle applies across every publishing domain. A `ScreenplayNormalizer` speaks in scenes, sluglines, and action blocks. A `LegalBriefNormalizer` speaks in numbered sections, exhibit references, and margin annotations. An `AcademicJournalNormalizer` speaks in abstracts, figures, and citation blocks. Each normalizer translates domain intent into the same spatial physics. The physics engine is indifferent to the domain; the normalizer carries all domain knowledge.

Because `Normalizer<TInput>` is a minimal interface, normalizers are publishable by third parties without touching the engine or `draft2final`. A specialist publisher can ship a normalizer for their house format. The engine becomes an embeddable layout physics runtime; the normalizer ecosystem is the product surface above it.

### The Immediate Beneficiary: Transmuters

The most immediate practical beneficiary of the Normalizer contract is the transmuter layer.

Currently a transmuter does two jobs in one pass:
1. **Parse** the source format (Markdown, screenplay syntax, etc.) into a semantic structure
2. **Translate** that semantic structure into `DocumentInput` vocabulary — `story`, `table`, `zone-map`

Job 2 is where transmuters suffer. `DocumentInput` is a generic layout vocabulary, so domain-specific semantic intent gets compressed through it and loses specificity. A Markdown blockquote that a newspaper transmuter *knows* should be a pull-quote in the right column must be expressed as a generic `body` element with style overrides — because `DocumentInput` has no concept of "pull-quote." The domain knowledge is flattened out at the translation boundary.

The Normalizer contract lets transmuters shed job 2 entirely. A transmuter becomes a **pure parser**: it reads the source format and produces a rich domain-specific semantic representation — `LeadArticle`, `Byline`, `PullQuote`, `Masthead` — preserving all intent it currently has to discard. The normalizer then maps that richness directly to spatial IR.

The transmuter and its paired normalizer share a `TInput` type. They form a domain unit:

```
Markdown → [MkdNewspaperTransmuter] → NewspaperDocument → [NewspaperNormalizer] → SpatialDocument
Markdown → [MkdManuscriptTransmuter] → ManuscriptDocument → [ManuscriptNormalizer] → SpatialDocument
```

For domains where parsing and spatial compilation are naturally unified, they collapse into one:

```typescript
class MkdNewspaperPipeline implements Normalizer<MarkdownAST> {
    normalize(md: MarkdownAST, geometry: PageGeometry): SpatialDocument { ... }
}
```

In this form, `DocumentInput` is not required at all. It was always a compromise — generic enough for the engine to consume, specific enough to be authorable. The Normalizer contract removes the reason for that compromise to exist.

The `@vmprint/markdown-core` extraction already showed the right instinct: separate parsing from layout decisions. What it could not do at the time was complete the separation, because the output was still `DocumentInput`. The Normalizer contract finishes that thought: the transmuter parses; the normalizer compiles; each does exactly one job.

### Prevention of Scope Creep

The most operationally important internal consequence: new domain requirements route to new normalizers, not to engine changes. If a consumer needs a new way of expressing layout intent — absolute coordinates, constraint-based sizing, a grid system, a proprietary DTP format — they implement a `Normalizer`. The physics runtime is protected from feature accumulation that belongs to input semantics.

This is the concrete enforcement of the OVERHAUL-OBJECTIVE rule: *"new capabilities emerge honestly from the runtime model."* Domain-specific input semantics are not runtime capabilities. They are Normalizer concerns.

---

## 11. Relationship to the Four-Layer Architecture

The Spatial IR lives entirely within **Layer 3 — Document Semantics**. It is the output of Layer 3's normalization pass and the input to Layer 3's shaping pass (FlowBox). It does not touch Layer 1 (Kernel), Layer 2 (Runtime), or Layer 4 (Renderer).

The normalization pass is the concrete implementation of the OVERHAUL-OBJECTIVE principle: *"turn implicit behavior into a runtime primitive."* The implicit spatial geometry that currently lives scattered across packager internals becomes an explicit, inspectable, testable data structure.

The Spatial IR advances the objective of making *"the simulator a coordinator rather than the domain brain."* Today's packagers carry both geometric intelligence (where does this go?) and layout intelligence (how does content flow?). After the migration, geometric intelligence lives entirely in the normalizer. Packagers are pure layout actors: they receive spatial declarations and execute them.

This directly satisfies the OVERHAUL-OBJECTIVE success criterion: *"hard layout seams are absorbed by engine primitives, not hidden simulator logic."* The `contentWidthOverride` situation is the most recent example of a seam that should not exist. The Spatial IR eliminates the seam by making zone width a first-class IR property rather than a threaded context field — and ensures the next similar seam has nowhere to hide.
