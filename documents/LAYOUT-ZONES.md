# Layout Zones

**Status: Shipped in V1, `continue` mode started, concept still evolving**

This document captures the architectural concept behind Layout Zones and
clarifies where the current implementation is still incomplete.

`zone-map` was never meant to be "a block that happens to contain columns."
It was meant to be the game-engine-native answer to page-local spatial
composition: rooms on a map, sectors in a field, dungeons inhabited by actors.

This matters because the current engine has correctly adopted the **spatial
partitioning** part of the idea, but it has not yet fully adopted the
**spatial lifecycle** part.

That unfinished step is now visible in real documents such as
[newsletter-layout-robust.json](c:\Users\cosmic\Projects\vmprint\documents\readme-assets\newsletter-layout-robust.json),
where the authored structure is honest but the page-level orchestration still
behaves too much like block flow.

---

## 1. The Problem in Game Terms

The most useful way to read VMPrint now is:

- a **page** is a local map
- **all pages together** are the world map
- **zones** are regions across that world map
- **content** is actors inhabiting those regions
- **headers, footers, margins, reservations, and exclusions** are non-playable
  terrain that shapes the current map but does not belong to any zone

Traditional typesetting asks:

> How do we make a container element hold multiple independent columns?

That framing leads to tree nesting:

- `grid > grid-cell > content`
- `page > block > block > block`

Each cell becomes a child of a container. Each content region becomes a
descendant in a document tree.

This is the wrong mental model for this engine.

In a game, when a dungeon has a tavern, a corridor, and a monster room:

- none of those spaces are children of each other
- they are all regions of the same map
- each region has bounds
- each region has local coordinates
- each region contains its own actors
- the world renderer composites those regions into the frame

That is the intended VMPrint model:

- the page is a local map
- the document is the world map formed by all pages
- zones are regions across that world map
- content items are actors inhabiting those regions
- pagination is advancing the simulation to the next loaded frame

When read this way, layout problems stop being "how do we nest blocks?" and
become:

- what is the world?
- what is the current frame?
- what terrain on this frame is traversable or non-traversable?
- what regions exist inside that frame?
- which actors persist across frames?

---

## 2. Core Principle

> Content flows are assigned to zones, not nested inside containers.

A Layout Zone is a bounded spatial context with:

- a local coordinate space
- a resolved width
- a resolved or settled height
- its own content stream or content session
- a compositing offset relative to the current page frame

Zones are **parallel**, not hierarchical.

The important consequence is that a zone should not be thought of as a child
block in the main flow. A zone is a region of the world map that becomes
visible inside the current page field. The document flow may instantiate or
advance that field, but the zone itself is a spatial entity, not a DOM node in
disguise.

Just as important: not every part of the page belongs to a zone. Margins,
headers, footers, page reservations, and exclusions are better understood as
terrain:

- out-of-bounds edges
- protected strips
- blocked tiles
- obstacles that shape where actors can move

This is why page composition should not be modelled as boxes nested inside
boxes. It should be modelled as actors navigating traversable space inside a
current frame.

---

## 3. What V1 Got Right

The shipped `zone-map` solved a real problem and remains a strong AST
construct.

V1 got these things right:

- zones are explicit authored region descriptors
- zone content lives in `elements[]`, not fake DOM `children[]`
- widths are solved spatially using track sizing
- each zone runs an independent layout sub-session
- the engine can author honest parallel regions such as main rail + sidebar

This was a real architectural breakthrough. It ended a whole class of hacks in
which independent editorial regions were being forced through containers that
pretended they were one shared flow.

---

## 4. Where V1 Stopped Halfway

V1 still treats the overall `zone-map` too much like a block in page flow.

The current behavior is effectively:

- resolve zone widths
- lay out each zone independently
- settle the height as the tallest zone
- treat the whole `zone-map` as a move-whole block

That is spatial internally, but not fully spatial at the page boundary.

This is the drift:

- **original concept**: a page-local field system with regions
- **shipped V1**: a block-level composition that happens to contain regions

The difference matters.

In a real game-like model, the page is a local frame or viewport. The zones are
persistent regional definitions. The frame may show only part of a larger
system. A region can continue into the next frame just as a tunnel can continue
into the next local map.

The current move-whole behavior is therefore not the final philosophy. It is a
first conservative slice.

The new `frameOverflow: "continue"` mode is the first concrete step beyond
that slice, but it is not a complete policy by itself. Continuation is now
keyed to authored world behavior:

- `move-whole` keeps the conservative V1 semantics
- `continue + fixed` remains conservative for now
- `continue + spanning` is the first live paged-field behavior
- `continue + expandable` remains declared but intentionally behaviorless

That means `zone-map` now begins to inhabit the current frame when the author
declares a spanning world region. It is still only a first step: nested actor
systems inside a paged zone field, especially `story`, still need stronger
occupancy rules so the simulation stops actors cleanly at the local frame
boundary instead of letting them overrun it.

---

## 5. The Robust Newsletter Finding

The robust specimen
[newsletter-layout-robust.json](c:\Users\cosmic\Projects\vmprint\documents\readme-assets\newsletter-layout-robust.json)
made this limitation very clear.

The authored structure there is more honest than the old demo:

- hero package at the top
- byline via `strip`
- body composed as a `zone-map`
- main editorial story in one zone
- sidebar as an independent parallel zone

The engine behaved correctly.

But the overlay render showed:

- page 1 remaining body frame: about `505 × 516.8 pt`
- zone-map footprint needed: about `507 × 702.9 pt`

So the zone-map was kicked entirely to page 2.

That is not a bug. It is evidence that the current semantics are:

- zone-map = move-whole spatial block

while the desired semantics for this kind of editorial page are closer to:

- zone-map = page-framed regional field system

In other words, the specimen did not expose a random rendering problem. It
exposed the exact place where the current implementation still thinks too much
like a typesetter and not enough like a game engine.

After `frameOverflow: "continue"` plus `worldBehavior: "spanning"` were
introduced, the specimen started to show the right lifecycle but also exposed
the next missing runtime rule:

- the field now begins in page 1 correctly
- but nested `story` actors can still over-occupy the room instead of being
  stopped and continued cleanly

That is not a failure of the world model. It is the next local-simulation bug
inside that model.

---

## 6. Game-Engine Interpretation

If we take the game analogy seriously, the correct model is not:

- "can this whole zone-map block fit?"

It is:

- "instantiate the current page frame"
- "place the zone regions inside that frame"
- "let each region accept as much content as fits"
- "advance the simulation to the next frame"
- "continue each region according to its overflow behavior"

That gives us the richer and more coherent spatial model:

- a zone may fit entirely inside one page frame
- a zone may continue across multiple pages
- different zones may continue independently
- pages are frames or viewports onto a larger spatial system

And importantly:

- some terrain does not belong to any zone at all
- headers, footers, margins, reservations, and exclusions are map constraints
- actors can only inhabit the navigable field that remains

This is much closer to the engine's actual identity:

- text items are actors
- floats are obstacles
- stories are linked lanes
- zones are rooms or sectors
- pages are frames

You do not see boxes of text. You see dwarfs, rogues, monsters, drunks, rooms,
lanes, tunnels, blocked mountain faces, and tavern floors with finite
occupancy.

---

## 7. Relationship to `story`

This way of thinking also explains why `story` and `zone-map` feel related.

They are not the same authored concept:

- `story` = one linked flow distributed across lanes
- `zone-map` = multiple distinct regional flows occupying the same field

But internally they are close because both are spatial systems with continuation
rules.

The likely long-term direction is:

- `story` continues across lanes and pages
- `zone-map` continues across regions and pages

The difference is not whether they are spatial. The difference is the
continuation semantics.

---

## 8. The Actual Endgame

The real endgame for Layout Zones is not merely auto-columns.

It is a true spatial field system with these capabilities:

1. **Page-framed zone instantiation**
   A page can instantiate a zone field in the available body frame rather than
   only place a pre-settled move-whole block.

2. **Cross-page zone persistence**
   A zone may continue across page boundaries, just as a corridor may continue
   across multiple map chunks.

3. **Independent zone overflow policies**
   Different zones may clip, continue, or link elsewhere according to authored
   intent.

4. **Explicit spatial zone geometry**
   Auto-columns are only the first authored convenience layer. The long-term
   model should allow zones with explicit `x`, `y`, `width`, and `height` so
   the page becomes a real spatial arena rather than a disguised block stack.

5. **Composable page-local fields**
   A page may contain a hero package above and a bounded zone field below. This
   should be authored as spatial composition, not faked through block movement.

6. **Procedurally extendable regions**
   Not every zone system has to be topologically fixed forever. In a true
   game-engine reading, some authored zone fields may eventually declare
   themselves as expandable, allowing the engine to generate further regional
   extensions across the world map according to authored rules. This is not a
   feature the engine needs to support immediately, but it is part of the
   intended worldview: the engine may generate more world only when the author
   has declared that such extension is allowed.

---

## 9. Authored Region / World Behaviors

The next critical distinction is not geometric. It is authored policy.

When a local map looks overcrowded, the engine must not silently decide what
that means. It has to know what kind of world the author declared.

The minimum useful categories are:

### 9.1 Fixed

A fixed region is bounded and non-expandable.

Meaning:

- the region exists where authored
- the current page only shows the local slice of it
- the engine must not invent more region topology
- if occupancy exceeds what the authored fixed region can support, that is a
  real authored/world problem, not an excuse for the engine to relocate actors

This is the strictest and most conservative world rule.

### 9.2 Spanning

A spanning region is one authored region that crosses multiple local maps.

Meaning:

- the region is larger than any single page slice
- page boundaries do not end the region
- dead terrain between visible slices does not break region identity
- actors may continue through the same world region across later maps

This is the clean model for cases like:

- a tavern floor that extends through multiple loaded map chunks
- a corridor crossing from one local map to another
- an editorial region that continues below a hero package and onward across
  later pages even though headers, footers, and margins interrupt what is
  visibly playable on each page

### 9.3 Expandable

An expandable region starts from authored topology but is allowed to grow.

Meaning:

- the author declares that the current world can procedurally generate further
  playable regional structure
- the engine may create more world, but only according to authored rules
- this is not improvisation; it is simulation of the declared world model

This is the game-native answer to:

- "the room can begin small"
- "if occupancy increases, the room may grow into the neighboring loaded map"
- "the world system itself allows extension"

Expandable is intentionally future-facing. The engine does not need to support
it immediately. But it must remain part of the worldview so later runtime
evolution does not collapse back into typesetter thinking.

### 9.4 Why This Distinction Matters

Without these authored categories, the engine cannot answer questions like:

- should overcrowding remain visible as unresolved occupancy?
- should actors continue through the same region across later pages?
- should the world procedurally generate more region?

Those are not generic overflow questions. They are world-rule questions.

So the engine must stop asking:

- "what should I do with overflow?"

and instead ask:

- "what kind of region/world did the author declare?"

---

## 10. Practical Near-Term Direction

The immediate conclusion is not "replace zone-map."

It is:

- keep `zone-map`
- preserve V1 move-whole behavior for backward compatibility
- preserve `continue` as the first shipped paged-field slice
- explicitly recognize that both are still incomplete relative to the original
  zone philosophy
- continue the design so zone fields behave as persistent world regions inside
  repeated page frames rather than disguised blocks

That longer direction should also leave conceptual room for a future
distinction between:

- fixed zone fields
- procedurally extendable zone fields

The engine should not invent topology arbitrarily, but it may eventually be
allowed to generate further world structure when the authored model explicitly
permits it.

That next slice should be described as completing the original zone-map idea,
not inventing an unrelated new feature.

---

## 10. Working Rule Going Forward

Future zone work should be judged by this test:

- Does it make the page feel more like a spatial field?
- Does it treat regions as peers on a map rather than descendants in a tree?
- Does it let continuation behave like persistent world state rather than block
  relocation?

If the answer is yes, it is moving in the right direction.

If the answer is no, it is probably drifting back toward old typesetter
thinking.

---

## 11. Current Slice: Paged Zone Fields

This section describes the next concrete runtime target.

The goal is deliberately narrow:

- preserve V1 authored `zone-map`
- preserve V1 move-whole behavior as the default compatibility mode
- add a new paged-field mode that completes the original spatial idea

This should be treated as the next real slice of Layout Zones, not as a
separate unrelated feature.

### 11.1 Problem Statement

Current `zone-map` orchestration assumes:

- resolve all zones
- run each zone independently to completion
- settle the tallest height
- place the whole thing as one block

That works for compact side-by-side compositions.

It fails for page-framed editorial layouts where the desired behavior is:

- instantiate a bounded body frame on page 1
- let each zone consume as much content as fits
- continue the remaining zone state on page 2

In game terms:

- current V1 treats the map itself as a move-whole object
- the next slice should treat the page as a frame and the map as persistent

### 11.2 Authored Concept

The authored concept should remain `zone-map`.

We should not invent a second public noun just because V1 shipped conservatively.

The likely authored distinction is instead an explicit overflow / lifecycle
mode on the `zone-map` itself, for example:

```json
{
  "type": "zone-map",
  "zoneLayout": {
    "columns": [
      { "mode": "flex", "fr": 2 },
      { "mode": "flex", "fr": 1 }
    ],
    "gap": 12,
    "frameOverflow": "move-whole"
  },
  "zones": [ ... ]
}
```

and later:

```json
{
  "type": "zone-map",
  "zoneLayout": {
    "columns": [
      { "mode": "flex", "fr": 2 },
      { "mode": "flex", "fr": 1 }
    ],
    "gap": 12,
    "frameOverflow": "continue"
  },
  "zones": [ ... ]
}
```

The important part is not the exact field name yet. The important part is that
the authored AST explicitly distinguishes:

- `move-whole`
- paged continuation across frames

That keeps the semantic change honest.

### 11.3 Runtime Model

The paged-field model should work like this:

1. **Frame instantiation**
   For the current page, determine the body frame available to the zone-map.

2. **Zone geometry resolution**
   Resolve the zones inside that frame:
   - widths
   - x offsets
   - frame-local heights

3. **Per-zone local march**
   Each zone runs its own bounded layout session against the current frame
   height, not against infinity.

4. **Per-zone continuation state**
   Each zone produces:
   - emitted boxes for the current frame
   - continuation state for the next page, if any

5. **Frame settlement**
   The page consumes the current frame slice. The next page instantiates the
   next zone frame and resumes each zone from its continuation state.

In game terms:

- a page is the current loaded map chunk
- the world map extends across all chunks/pages
- a zone is a region across that world
- the current page shows the slice of that region that falls inside the current
  frame
- content actors that did not finish remain alive for the next chunk

This model also leaves room for a future extension:

- some zone fields may be fixed
- some zone fields may be authored as expandable
- in the expandable case, later pages may instantiate procedurally generated
  regional extensions of the same world rather than only repeat a fixed field

### 11.4 Terrain And Occupancy

Paged zone fields only make sense if occupancy rules are enforced locally.

That means:

- actors may inhabit only the traversable field left after margins, headers,
  footers, reservations, and exclusions are applied
- zones do not own those terrain features; they merely live around them
- if a room gets crowded, actors should be stopped and continued according to
  authored persistence rules
- they should not overlap simply because the field lifecycle is now more honest

This is the exact runtime seam exposed by the continued newsletter specimen:
the world model is now right enough to reveal an occupancy bug.

### 11.5 Continuation Semantics

The continuation state must be tracked per zone, not only for the zone-map as a
single block.

That means a future paged zone-map must allow:

- zone A continues
- zone B ends
- zone C clips intentionally

The region system therefore wants independent zone overflow policies eventually.

The minimum next slice does **not** need all of those immediately. It only
needs:

- all zones continue together under one paged field mode

But the runtime shape should not block later per-zone policies.

### 11.6 Relationship to `story`

The closest existing runtime analogue is `StoryPackager`.

`StoryPackager` already knows how to:

- pour content into a bounded region
- split
- carry continuation state to the next page

The difference is:

- `story` continues one linked flow across multiple lanes
- paged `zone-map` would continue multiple independent flows across multiple
  frames

So the next slice should not duplicate the old V1 "non-paginating stripped
march" architecture forever. It should move toward a zone-field orchestration
layer that can manage bounded sub-sessions and continuation state.

### 11.7 Minimum Implementation Plan

The minimum useful path is:

1. keep current `ZonePackager` behavior as V1 compatibility mode
2. add a new paged mode behind an explicit authored switch
3. in paged mode, stop materializing zones to infinity
4. give each zone a bounded-height sub-session and capture continuation
5. compose the current page from those bounded results
6. continue unfinished zone states on the next page

This gives us the real missing behavior without forcing a broad rewrite first.

### 11.8 What This Is Not

This next slice is **not**:

- a generic free-form page designer
- arbitrary authored `(x, y)` everywhere
- a replacement for `story`
- a reason to remove move-whole zone-maps

It is specifically:

- finishing the page-framed lifecycle of zones

### 11.9 Future Direction Beyond The Next Slice

Once paged zone fields exist, the longer path becomes much clearer:

- per-zone overflow policies
- explicit zone geometry
- linked zone continuations
- overlapping region systems
- page-local macro maps whose regions persist across frames

That is the true game-engine endgame:

- not blocks flowing down a page
- but actors inhabiting a spatial world that the page reveals frame by frame

For the code-facing breakdown of this next slice, see
[LAYOUT-ZONES-RUNTIME-PLAN.md](c:\Users\cosmic\Projects\vmprint\documents\LAYOUT-ZONES-RUNTIME-PLAN.md).
