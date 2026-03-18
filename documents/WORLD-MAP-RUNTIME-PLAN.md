# World Map Runtime Plan

This document turns the world-map proposal into a concrete implementation plan.

It is intentionally practical. The goal is not to redesign the whole engine in
one jump. The goal is to introduce explicit world-space semantics in the
smallest slices that:

- reduce conceptual drift
- preserve current documents
- create immediate value for `zone-map`
- establish a shared spatial substrate for later `story`, `table`, and linked
  region work

See also:

- [WORLD-MAP.md](c:\Users\cosmic\Projects\vmprint\documents\WORLD-MAP.md)
- [LAYOUT-ZONES.md](c:\Users\cosmic\Projects\vmprint\documents\LAYOUT-ZONES.md)
- [LAYOUT-ZONES-RUNTIME-PLAN.md](c:\Users\cosmic\Projects\vmprint\documents\LAYOUT-ZONES-RUNTIME-PLAN.md)
- [SPATIAL-IR.md](c:\Users\cosmic\Projects\vmprint\documents\SPATIAL-IR.md)

---

## 1. Practical Objective

The first goal is not "support every possible world-space layout."

The first goal is:

- make world space explicit in runtime vocabulary
- make pages explicit viewports over that world
- lower current `zone-map` strip geometry into world-space regions
- preserve current authored syntax and current document behavior by default

That gives us a stable base for later features without forcing an AST rewrite.

---

## 2. Current Runtime Shape

Today the engine already contains fragments of a world model, but they are not
yet unified.

### 2.1 What Already Exists

- stable actor identity in the kernel/runtime
- page-local constraint fields
- per-page reservations and exclusions
- spatial IR structures such as `SpatialZoneStrip` and `SpatialGrid`
- a session world runtime, though it still speaks mostly in page terms

Relevant files:

- [types.ts](c:\Users\cosmic\Projects\vmprint\engine\src\engine\types.ts)
- [spatial-document.ts](c:\Users\cosmic\Projects\vmprint\engine\src\engine\spatial-document.ts)
- [session-world-runtime.ts](c:\Users\cosmic\Projects\vmprint\engine\src\engine\layout\session-world-runtime.ts)
- [zone-packager.ts](c:\Users\cosmic\Projects\vmprint\engine\src\engine\layout\packagers\zone-packager.ts)
- [story-packager.ts](c:\Users\cosmic\Projects\vmprint\engine\src\engine\layout\packagers\story-packager.ts)
- [table-packager.ts](c:\Users\cosmic\Projects\vmprint\engine\src\engine\layout\packagers\table-packager.ts)

### 2.2 Where The Drift Appears

The drift is that the runtime still treats pages as the primary concrete space
for many decisions.

Examples:

- `zone-map` normalization resolves a strip of `x + width` regions, but not a
  general world-space region set
- `SessionWorldRuntime` records reservations and exclusions by page index
- page generation is a first-class progression mechanism, while viewport
  semantics are still implicit
- spatial structures are still often described as blocks that paginate, rather
  than world actors projected through viewports

This plan addresses that drift incrementally.

---

## 3. Target Runtime Vocabulary

The runtime should gradually converge on the following vocabulary.

### 3.1 World Space

World space is the primary authored spatial surface.

Minimum runtime fields:

- `worldOriginX`
- `worldOriginY`
- `worldWidth`
- `exploredWorldBottom`

Optional later fields:

- explicit authored world height
- named world regions
- authored world anchors

### 3.2 Viewport

A page becomes a viewport descriptor over world space.

Minimum runtime fields:

- `pageIndex`
- `worldX`
- `worldY`
- `width`
- `height`
- page terrain descriptors

### 3.3 Region

A region is a bounded authored world-space geometry.

Minimum region geometry for the first user-visible slice:

- `x`
- `y`
- `width`
- optional `height`

### 3.4 Terrain

Terrain is viewport-local spatial constraint data:

- margins
- header/footer occupancy
- reservations
- exclusions

This distinction matters:

- world regions express authored playable space
- terrain expresses viewport-local constraints on what part of that space is
  currently usable

---

## 3a. Hard Runtime Laws

The world-map work becomes much easier if we adopt a strict simulation reading:
the engine behaves like an open-world 2D RPG with continuous coordinates,
viewport-local collision terrain, and explicit relocation rules.

That reading yields three concrete implementation laws.

### 3a.1 Law 1: World Y Is Continuous

The runtime should treat world coordinates as continuous.

That means:

- page 1 viewport might cover `worldY = 0..800`
- page 2 viewport might cover `worldY = 800..1600`
- there is no non-existent "paper gap" between those ranges

The simulation should not perform inter-page gap math in world coordinates.
Pages are viewport slices, not disconnected worlds.

Practical consequence:

- `ViewportDescriptor.worldY` becomes primary
- page index becomes metadata about the viewport, not the geometry model

### 3a.2 Law 2: Terrain Must Collapse To Collision Geometry

At local runtime, packagers should not care whether an obstacle originated as:

- a top margin
- a footer reservation
- a header
- an exclusion

They should see only collision geometry.

Practical consequence:

- `SessionWorldRuntime` should derive viewport terrain as pure exclusion or
  blocked-space geometry
- packagers should consume traversable intervals and blocked regions, not page
  concepts

This is especially important for:

- `zone-map` regional occupancy
- story-local pathing around obstacles
- later shared world-region logic across stories and tables

### 3a.3 Law 3: `move-whole` Is Relocation

`move-whole` should be treated as a relocation rule.

If a grouped actor system cannot legally occupy the current viewport under a
stay-together policy, the runtime should relocate the group's placement origin
to the next viewport spawn point rather than half-place it.

Practical consequence:

- `move-whole` is not "block rejection"
- it is a viewport-to-viewport translation event

This framing should simplify the mental model in `zone-packager` and later
linked region work.

---

## 4. Phase Plan

This proposal is split into five phases.

### Phase 1: Internal World-Space Runtime

Status target:

- internal only
- no authored syntax changes
- no behavior regressions

Purpose:

- make world-space and viewport semantics explicit in code

Deliverables:

- introduce internal world-space structs
- introduce explicit viewport descriptors for pages
- make page-local terrain projection explicit
- keep all existing public AST shapes working unchanged

### Phase 2: Rebase `zone-map` Onto World Regions

Status target:

- behavior-preserving for current docs
- internal architecture cleanup

Purpose:

- stop treating strip geometry as the ontology of zones

Deliverables:

- current strip-form `zone-map` lowers into world-space rectangular regions
- existing continuation modes keep their current external semantics
- `zone-packager` consumes region descriptors rather than implicit strip-only
  assumptions where possible

### Phase 3: Authored World-Space Zone Geometry

Status target:

- first major user-visible capability gain

Purpose:

- let `zone-map` express explicit region placement in world space

Deliverables:

- additive AST support for rectangular world-space zone geometry
- current strip syntax remains valid and lowers to the same runtime form
- overlapping zones remain legal

### Phase 4: Story Lane Rebase

Status target:

- internal/runtime focused first

Purpose:

- treat `story` as a lane system occupying world regions

Deliverables:

- clearer continued-story semantics through viewport projection
- cleaner integration of `story` inside continued zone fields
- groundwork for non-contiguous linked region flows

### Phase 5: Grid/Table And Viewport Planning

Status target:

- deeper advanced-layout work

Purpose:

- give `table` and future linked frames the same world substrate

Deliverables:

- table/grid projection through viewports
- repeated header logic phrased as viewport projection
- optional explicit viewport planning for advanced layouts

---

## 5. Phase 1 In Detail: Internal World-Space Runtime

This is the best place to begin because it is low-risk and foundational.

### 5.1 New Internal Types

Add internal runtime-facing types for:

- `WorldSpace`
- `ViewportDescriptor`
- `WorldRegionRect`
- `ViewportTerrain`

Likely homes:

- [types.ts](c:\Users\cosmic\Projects\vmprint\engine\src\engine\types.ts) for
  public-facing shape additions only if needed
- a new internal module near
  [spatial-document.ts](c:\Users\cosmic\Projects\vmprint\engine\src\engine\spatial-document.ts)
  or under `layout/`

Suggested internal shape:

```ts
interface WorldSpace {
  originX: number;
  originY: number;
  width: number;
  exploredBottom: number;
}

interface ViewportDescriptor {
  pageIndex: number;
  worldX: number;
  worldY: number;
  width: number;
  height: number;
  terrain: ViewportTerrain;
}

interface ViewportTerrain {
  margins: { top: number; right: number; bottom: number; left: number };
  reservations: readonly RegionReservation[];
  exclusions: readonly SpatialExclusion[];
  headerHeight?: number;
  footerHeight?: number;
}

interface WorldRegionRect {
  id?: string;
  x: number;
  y: number;
  width: number;
  height?: number;
}
```

These types can remain internal until the authored model needs them.

### 5.2 Session World Runtime

[session-world-runtime.ts](c:\Users\cosmic\Projects\vmprint\engine\src\engine\layout\session-world-runtime.ts)
already provides a natural starting point.

First slice:

- preserve existing page-index APIs
- add internal methods that derive viewport descriptors from current page state
- make reservations/exclusions readable as viewport terrain

We do not need to delete page-based storage immediately. We only need a clean
translation boundary.

Important rule for this phase:

- `SessionWorldRuntime` should become the place where page concepts collapse
  into collision geometry for the current viewport

That means later packagers can reason about:

- blocked regions
- traversable intervals
- viewport origin

without needing to reason directly about margins and headers as typographic
concepts.

### 5.3 Page Finalization

The page loop should begin treating each page as:

- a materialized viewport descriptor

not just:

- a page index plus implicit margins and artifacts

Likely touch points:

- [layout-page-finalization.ts](c:\Users\cosmic\Projects\vmprint\engine\src\engine\layout\layout-page-finalization.ts)
- [pagination-loop-runtime.ts](c:\Users\cosmic\Projects\vmprint\engine\src\engine\layout\pagination-loop-runtime.ts)
- [layout-session.ts](c:\Users\cosmic\Projects\vmprint\engine\src\engine\layout\layout-session.ts)

### 5.4 Diagnostics

This phase should also improve diagnostics:

- expose viewport world origin in debug data
- expose explored-world frontier
- expose terrain projection separate from authored geometry

That makes later phases easier to reason about and test.

---

## 6. Phase 2 In Detail: Rebase `zone-map`

This is the first place where the world model becomes materially useful.

### 6.1 Normalize To World Regions

Current strip-based `zone-map` normalization in
[zone-packager.ts](c:\Users\cosmic\Projects\vmprint\engine\src\engine\layout\packagers\zone-packager.ts)
and
[normalized-zone-strip.ts](c:\Users\cosmic\Projects\vmprint\engine\src\engine\layout\normalized-zone-strip.ts)
should be reframed so that strip tracks produce world-space region rectangles.

Instead of thinking:

- strip -> columns -> packager-local x offsets

we should think:

- strip shorthand -> world regions in a field

The first slice can still keep all regions on the same `y` and with implicit
height behavior. The important change is ontological, not yet geometric power.

### 6.2 Normalized Shape Evolution

`NormalizedIndependentZoneStrip` likely needs a successor shape or an additive
extension.

Current shape:

- `x`
- `width`
- no explicit `y`
- no explicit region geometry object

Suggested direction:

```ts
interface NormalizedWorldZoneRegion {
  id?: string;
  rect: {
    x: number;
    y: number;
    width: number;
    height?: number;
  };
  elements: Element[];
  style?: ElementStyle;
}
```

The strip-origin case simply sets `y = 0` and derives `x/width` from track
sizing.

### 6.3 Packager Contract

The `ZonePackager` should gradually consume region descriptors rather than
strip-specialized offsets.

That means:

- zone sessions run inside a region rect
- emitted boxes are region-local first
- page projection adds viewport offsets later

This is closer to the actual architectural concept and will make Phase 3 much
easier.

For `move-whole`, the packager should increasingly think in relocation terms:

- attempt occupancy in current viewport
- if stay-together policy fails
- translate attempt to the next viewport origin

That is a better runtime law than treating the whole field as a mysterious
unbreakable block.

### 6.4 Tests

Existing tests should remain valid:

- [zone-map-continue.spec.ts](c:\Users\cosmic\Projects\vmprint\engine\tests\zone-map-continue.spec.ts)
- [strip-layout.spec.ts](c:\Users\cosmic\Projects\vmprint\engine\tests\strip-layout.spec.ts)

Add assertions for:

- normalized regions now contain explicit world-space geometry
- current strip-authored examples still render identically

---

## 7. Phase 3 In Detail: Authored World-Space Zone Geometry

This is the first major public capability change.

### 7.1 Public AST Direction

Add optional authored region geometry to `zone-map` zones.

Do this additively.

Possible direction:

```ts
interface ZoneDefinition {
  id?: string;
  elements: Element[];
  style?: Record<string, any>;
  region?: {
    x: number;
    y: number;
    width: number;
    height?: number;
  };
}
```

Keep existing strip layout options:

- `columns`
- `gap`
- `frameOverflow`
- `worldBehavior`

If `region` is absent:

- current strip behavior remains

If `region` is present:

- region geometry is explicit

### 7.2 Authoring Rules

First-slice authored rules should stay simple:

- rectangular regions only
- no shape booleans
- overlap allowed
- deterministic default paint order
- simple default clipping policy

That is enough to unlock strong value without overdesign.

### 7.3 Runtime Rules

The engine should not reject overlap by default.

Instead it should define:

- how region-local content is projected into page space
- whether clipping defaults to region bounds or no clipping
- how z-order is determined when projected boxes overlap

Those rules can start conservative and explicit.

### 7.4 Tests

Add new fixtures covering:

- two explicit world-space regions on the same page
- vertically offset regions
- overlapping regions with deterministic ordering
- continued explicit region fields with `worldBehavior: "expandable"`

---

## 8. Phase 4 In Detail: Story Lane Rebase

This phase should leverage the world model rather than reinvent story logic.

### 8.1 Story As Region Occupant

The `story` packager should increasingly read its columns as:

- linked lanes inside a world region

not:

- a page-contained multi-column block

This does not require a public AST change at first.

### 8.2 Runtime Payoff

This should simplify current hard cases:

- stories inside continued zone fields
- column-span behavior across viewport slices
- future linked continuation into non-contiguous regions

### 8.3 Likely Files

- [story-packager.ts](c:\Users\cosmic\Projects\vmprint\engine\src\engine\layout\packagers\story-packager.ts)
- [spatial-map.ts](c:\Users\cosmic\Projects\vmprint\engine\src\engine\layout\packagers\spatial-map.ts)
- [normalized-story.ts](c:\Users\cosmic\Projects\vmprint\engine\src\engine\layout\normalized-story.ts)

### 8.4 Tests

Focus on current pain points:

- column-span inside continued regional story
- story-local obstacles respecting viewport terrain
- story continuation across page slices with explicit world-space parent region

---

## 9. Phase 5 In Detail: Grid/Table And Viewport Planning

Once world-space regions and viewport projection are stable, tables and linked
frames can use the same substrate.

### 9.1 Table/Grid

Goals:

- express grid footprint in world-local terms
- treat repeated headers as viewport reprojection
- treat splits as visibility rules over a persistent grid structure

Likely files:

- [table-packager.ts](c:\Users\cosmic\Projects\vmprint\engine\src\engine\layout\packagers\table-packager.ts)
- [normalized-table.ts](c:\Users\cosmic\Projects\vmprint\engine\src\engine\layout\normalized-table.ts)

### 9.2 Explicit Viewport Planning

Only after the substrate proves itself should we add stronger authored controls
for:

- pinned future viewport slices
- non-contiguous region continuation
- planned landing regions

This should be treated as an advanced-layout feature, not an early dependency.

---

## 10. File-By-File Starting Map

This is the likely starting map for implementation.

### Phase 1

- [session-world-runtime.ts](c:\Users\cosmic\Projects\vmprint\engine\src\engine\layout\session-world-runtime.ts)
  Add explicit viewport/terrain helpers.
- [layout-session.ts](c:\Users\cosmic\Projects\vmprint\engine\src\engine\layout\layout-session.ts)
  Track world frontier and viewport descriptors.
- [pagination-loop-runtime.ts](c:\Users\cosmic\Projects\vmprint\engine\src\engine\layout\pagination-loop-runtime.ts)
  Materialize next-page viewport explicitly.
- [layout-page-finalization.ts](c:\Users\cosmic\Projects\vmprint\engine\src\engine\layout\layout-page-finalization.ts)
  Carry viewport debug/provenance data.

### Phase 2

- [normalized-zone-strip.ts](c:\Users\cosmic\Projects\vmprint\engine\src\engine\layout\normalized-zone-strip.ts)
  Evolve strip-only region shape into world-region shape.
- [zone-packager.ts](c:\Users\cosmic\Projects\vmprint\engine\src\engine\layout\packagers\zone-packager.ts)
  Consume region rects and project via viewport semantics.
- [spatial-document.ts](c:\Users\cosmic\Projects\vmprint\engine\src\engine\spatial-document.ts)
  Keep IR terminology aligned with world regions.

### Phase 3

- [types.ts](c:\Users\cosmic\Projects\vmprint\engine\src\engine\types.ts)
  Add optional authored region geometry to `ZoneDefinition`.
- [document.ts](c:\Users\cosmic\Projects\vmprint\engine\src\engine\document.ts)
  Normalize and validate new authored fields.
- [AST-REFERENCE.md](c:\Users\cosmic\Projects\vmprint\documents\AST-REFERENCE.md)
  Document the additive AST surface.
- [authoring/03-stories-strips-and-zones.md](c:\Users\cosmic\Projects\vmprint\documents\authoring\03-stories-strips-and-zones.md)
  Add examples and guidance.

---

## 11. Test Strategy

This work should be test-led because regressions will be easy to introduce
quietly.

### 11.1 Regression Rule

Each internal phase should preserve current authored behavior unless the phase
explicitly introduces a new public capability.

### 11.2 Required Test Types

- normalization snapshots
- layout snapshots
- page-origin / viewport-origin assertions
- continuation assertions
- overlap ordering assertions

### 11.3 Suggested New Fixtures

- `zone-map` strip lowered to world-region snapshot
- explicit world-region `zone-map` with two vertically offset regions
- overlapping explicit regions with deterministic box ordering
- continued explicit region field across two pages
- story inside explicit world-region zone
- table inside explicit world-region zone

---

## 12. Immediate Recommendation

Start with a narrow Phase 1 branch:

1. Add internal `WorldSpace` and `ViewportDescriptor` types.
2. Teach `SessionWorldRuntime` to expose viewport terrain explicitly.
3. Add debug/provenance output for viewport world origin.
4. Keep all current external behavior unchanged.

Then do a narrow Phase 2 branch:

1. Evolve normalized `zone-map` regions to carry explicit `y`.
2. Rebase strip lowering to region rects.
3. Prove fixture parity against current strip-authored documents.

That sequence should deliver real architectural progress without forcing an
immediate public AST expansion.

---

## 13. Bottom Line

The world-map proposal becomes real when three things happen:

- the runtime speaks explicitly in world space
- pages become explicit viewports
- `zone-map` stops treating strip geometry as its ontology

Those changes are achievable in phased slices.

They improve the engine even before advanced world-authored layouts exist.
And they create a practical substrate on which `story`, `table`, linked
regions, and future advanced layout work can grow coherently.
