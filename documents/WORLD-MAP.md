# World Map

This document proposes a practical next step for VMPrint's spatial model:
make the **world map** explicit.

The goal is not to chase a grand abstraction for its own sake. The goal is to
solve real layout problems more cleanly by aligning the runtime with what the
engine already is:

- a spatial simulation
- with stable actors
- moving through constrained space
- across multiple local frames

Today that worldview is already present in the architecture and in the more
recent zone documents, but it is still only partly explicit. Pages are treated
as local maps in theory, while much of the authored model still behaves as if
pages were the primary truth.

This document argues for the opposite:

- the **world** is primary
- a **page** is a viewport onto that world
- **zones** are world-authored regions
- **stories**, **tables**, and other structures are actor systems inhabiting
  regions of that world

This is not a speculative rewrite proposal. It is intended to be implementable
in slices and useful long before the full model is complete.

---

## 1. Why This Matters

The current engine already outperforms conventional layout architectures when
problems become dynamic, recursive, or reactive. But one class of friction
still appears repeatedly:

- page-local composition that wants to continue naturally
- regional layouts that behave honestly inside a page but awkwardly at page
  boundaries
- structures that are conceptually spatial fields but are authored as
  page-contained blocks

`zone-map` is the clearest example.

The current implementation is already spatial in partitioning:

- zones are explicit region descriptors
- zone content is assigned, not fake-nested
- each zone has local coordinates
- each zone runs an independent layout session

But it is still partly page-first in lifecycle:

- the authored shape is still mostly a horizontal strip
- continuation is phrased in terms of page overflow
- the runtime still often decides as if the zone field belongs to the page

That creates unnecessary conceptual drag. It also leaks into neighboring
features:

- `story` still behaves like a page-bound column system rather than a lane
  system on a larger field
- `table` is still treated mainly as a block that paginates, not as a grid
  actor with a world footprint
- linked-frame ideas still feel like exceptions instead of natural world-space
  routing

Making `world-map` explicit gives the engine a more coherent base model for all
of these.

---

## 2. Core Model

The intended model is:

- the **world map** is the authored spatial surface
- the **page** is a current viewport into that world
- **terrain** shapes the traversable area of the current viewport
- **zones** are authored world regions
- **actors** inhabit zones or traverse lanes inside those zones
- **pagination** advances the viewport plan through the world

In this model:

- a page does not own zones
- a page reveals part of zones
- a zone may extend beyond the current page
- a zone may overlap another zone if the author wants that
- a zone may continue through later viewports without pretending to be a split
  block

This is a practical shift, not only a philosophical one. It changes how we
should define geometry, continuation, and authored intent.

---

## 2a. A Strict RPG Reading

The cleanest way to remove ambiguity is to read the engine strictly as an
open-world 2D multi-party action RPG.

This is not decorative language. It gives the runtime a precise set of laws.

### 2a.1 Continuous World Coordinates

The world coordinate system is continuous.

There are no paper gaps in world space.

That means:

- `worldY` is one continuous tape
- page 1 is one viewport slice of that tape
- page 2 is the next viewport slice of that tape
- the simulation never performs "between pages there is no world" math

The page break is therefore not a rupture in existence. It is a viewport shift.

### 2a.2 Terrain As Pure Collision Geometry

Packagers should not need to understand typographic labels such as:

- margin
- header
- footer
- reserved page strip

Those are authoring and orchestration concepts, not local physics concepts.

At local simulation time they should become only:

- playable space
- blocked space

That means page-local terrain should be projected into pure collision geometry
before actor occupancy logic sees it.

### 2a.3 `move-whole` As Teleport Or Respawn

`move-whole` should be understood as a teleport rule, not as a block-layout
quirk.

If a grouped actor system must stay together and the current viewport cannot
admit the whole group, the runtime should not partially crush or spill the
group. It should relocate the group's placement attempt to the spawn point of
the next viewport.

In document terms:

- the field does not fit here under its current rule
- so the field's origin is translated to the next viewport origin

This is much clearer than thinking in terms of a block being rejected by a
page.

---

## 3. What Becomes Explicit

### 3.1 World Space

The engine should gain an explicit concept of world space.

At minimum, world space needs:

- a stable origin
- a width
- a traversed or explored height frontier
- a way to define authored regions against world coordinates
- a way to define or derive viewport slices

The world does not need to be infinitely predeclared. A fixed world height is
not required. In many documents, the useful model is:

- world width is known
- explored world height grows as simulation advances

This is already close to how the engine behaves in practice. The difference is
that the growth frontier becomes explicit instead of being hidden inside page
turning.

### 3.2 Viewports

Pages should be understood as viewport projections over world space.

A viewport needs:

- a world-space origin
- a width and height
- page-level terrain rules
- page rendering metadata

This lets us say:

- the viewport moved downward through the same world
- the viewport jumped to a different authored area
- the viewport was explicitly pinned by the author

That is much cleaner than overloading all of those as page-break behavior.

### 3.3 Terrain

Margins, headers, footers, reservations, exclusions, and page-specific
obstacles should be treated as terrain attached to a viewport, not as part of
zone definitions.

This preserves an important distinction:

- zones are authored playable regions
- terrain is what constrains the currently visible playable surface

That distinction already exists conceptually in the engine. The world-map model
makes it first-class.

---

## 4. Effects On `zone-map`

`zone-map` is the most immediate beneficiary of an explicit world-map model.

### 4.1 What Should Change

`zone-map` should stop being defined primarily as:

- a horizontal strip of page-local columns

and instead be defined as:

- a field of authored regions placed in world space

The current strip form should remain, but only as one authoring shorthand.

In other words:

- authored strip syntax remains valuable
- strip syntax lowers into world-space region declarations
- strip syntax no longer defines what a zone is

### 4.2 Region Geometry

Zones should eventually support authored world geometry directly, not only track
solved width inside a strip.

The minimum useful geometry model is rectangular:

- `x`
- `y`
- `width`
- optional `height`

Height should remain flexible in many cases. A zone may have:

- a declared visible extent
- an authored minimum extent
- or an open-ended extent governed by world behavior

That flexibility matters because the engine should not force the author to
choose between only:

- fixed-height boxes
- or implicit endless blocks

### 4.3 Overlap

The engine should not treat overlapping zones as inherently invalid.

If two zones overlap:

- that is authored topology
- not engine corruption

The runtime still needs deterministic composition rules, but those are normal
engine rules:

- draw order
- clipping rules
- hit order for diagnostics and overlays

Those should be explicit defaults, not hidden rejection heuristics.

### 4.4 Continuation

The key behavioral change is that continuation should no longer be thought of
as "this zone-map block overflows the page."

Instead:

- the current viewport reveals part of a zone field
- each zone accepts as much occupancy as the visible traversable area allows
- the next viewport reveals the next slice of the same field

That means `frameOverflow` and `worldBehavior` can evolve into cleaner concepts:

- viewport behavior
- world behavior

The current names may remain for compatibility, but their semantics become much
clearer once the world exists explicitly.

### 4.5 Suggested Direction

The next practical shape for `zone-map` is:

- preserve current strip authoring
- add explicit world-space region authoring
- normalize both into the same world-region runtime form

That gives users a simple path and a powerful path without forcing a flag soup.

---

## 5. Effects On `story`

`story` should be re-read through the world-map model as a **lane system**,
not as a page-owned multi-column block.

Current multi-column stories are already close to this idea:

- columns define linked lanes
- content traverses those lanes in order
- a page break is only one kind of boundary crossing

With an explicit world map:

- story lanes can be defined against a region in world space
- viewport slices reveal part of those lanes
- continuation is world progression, not merely page splitting

This has several practical benefits.

### 5.1 More Honest Continuation

A story continuing from one page to the next is no longer special. It is simply
the same lane system viewed through successive viewport slices.

### 5.2 Better Integration With Zones

A story inside a zone stops feeling like a nested exception. It becomes:

- a lane actor system occupying a world region

That should simplify the runtime around:

- continued zone fields containing stories
- column-span behavior inside continued regional stories
- later linked-region flows

### 5.3 Future Non-Contiguous Flows

Once pages are viewports over world space, "continued on page 4" stops being a
special linked-frame hack and becomes a viewport-planning question:

- where is the next viewport that reveals the next lane segment?

That does not make linked flows trivial, but it places them in the correct
layer.

---

## 6. Effects On `table`

Tables should remain a distinct semantic structure, but their spatial runtime
can benefit from the same world model.

Today a table is still largely understood as:

- a block that owns a grid and paginates downward

In world-map terms it becomes:

- a grid actor with a world footprint
- rows and cells occupy world-local geometry
- viewports reveal portions of that grid

This reframing helps with several practical issues.

### 6.1 Repeated Headers

Repeated headers become a viewport projection rule over a persistent grid
structure, not a special case of block resumption.

### 6.2 Split Legality

Row and row-span split logic becomes easier to describe as:

- what portion of the grid is visible in the current viewport?
- what must be reprojected into the next viewport?

### 6.3 Shared Runtime Vocabulary

The same world-region vocabulary can eventually support:

- zone fields
- story lane systems
- grids
- linked explicit frames

That does not collapse them into one AST type. It simply gives them a common
spatial substrate.

---

## 7. Effects On Pagination

The world-map model does not remove pagination. It demotes pagination from
being the primary ontology to being one projection strategy.

That is an improvement.

The engine still needs page generation, page numbering, and renderer-facing
page arrays. But those become downstream consequences of viewport planning.

### 7.1 Automatic Pagination

In the common case:

- the engine automatically advances the viewport frontier through explored world
  space

This preserves current behavior for ordinary documents.

### 7.2 Authored Pagination

In more advanced cases:

- the author may explicitly pin or shape later viewport positions

That opens the door to:

- non-contiguous continuations
- magazine layouts with planned later landing regions
- explicit world-space inserts and interruptions

### 7.3 Fog Of War

The uncovered-world idea is useful in practice.

It gives a natural way to speak about:

- not-yet-instantiated world height
- expandable world regions
- later viewport discovery

This is better than pretending the document already exists as a fully measured
stack of hidden pages before simulation has actually inhabited it.

---

## 8. Practical AST Direction

This document does not prescribe a final AST shape, but it does suggest a
practical direction.

### 8.1 Add World-Level Document Semantics

The document model should eventually gain an explicit world-level section or
equivalent normalized form.

That world-level definition should be able to express:

- world width
- authored regions
- viewport planning rules
- optional explicit viewport declarations

### 8.2 Preserve Friendly Authoring Shortcuts

Existing authoring helpers should not disappear:

- `story`
- `strip`
- current `zone-map` strip form
- `table`

These remain good authored constructs. The change is where they lower:

- not directly to page-local behavior
- but to world-space runtime declarations

### 8.3 Keep Semantics Distinct

`story`, `zone-map`, and `table` should remain distinct public concepts because
their authored meaning is different.

The world map should unify spatial substrate, not erase semantic differences.

---

## 9. Practical Runtime Direction

The runtime should evolve in slices.

### 9.1 First Slice: Make World Space Explicit Internally

Before changing public authoring much, the runtime can introduce an explicit
internal world-space model:

- world-space coordinates for region declarations
- viewport descriptors for pages
- clear distinction between world geometry and viewport terrain

This alone would simplify reasoning and diagnostics.

### 9.2 Second Slice: Rebase `zone-map`

Rebase `zone-map` normalization so that current strip-based zones lower into
world-space regions.

No author-visible breaking change is required for this slice.

### 9.3 Third Slice: Add Explicit Region Geometry

Once the runtime is stable, add authored world-region geometry for `zone-map`
alongside strip shorthand.

This is likely the first major user-visible capability gain.

### 9.4 Fourth Slice: Rebase `story` And `table`

Move continued stories and tables to world-aware viewport semantics where doing
so reduces complexity and improves correctness.

This should be incremental, not a flag day rewrite.

### 9.5 Fifth Slice: Explicit Viewport Planning

Only after the world substrate is proven should the engine grow stronger
authored viewport planning tools for non-contiguous flows and advanced page
design.

---

## 10. Immediate Benefits

The world-map model is worthwhile only if it improves the real engine.

The practical benefits are:

- cleaner mental model for continued zone fields
- a more honest foundation for advanced editorial layouts
- better alignment between runtime behavior and engine philosophy
- less pressure to fake spatial structures as page-contained blocks
- a more natural basis for future linked-frame and non-contiguous continuation
- shared vocabulary across zones, stories, tables, reservations, and overlays

Even if the first implementation slices are internal only, they should still
pay off by reducing conceptual mismatch in the runtime.

---

## 11. Risks And Non-Goals

This shift should remain practical.

### 11.1 Non-Goal: Rewrite Everything At Once

The engine does not need a full AST revolution before any benefit appears.

The right path is:

- internal world model first
- selective rebasing of existing structures
- new authoring power only where it clearly helps

### 11.2 Non-Goal: Erase Existing Primitives

The point is not to replace every concept with `world-map`.

It is to give existing concepts a more truthful spatial base.

### 11.3 Risk: Vocabulary Inflation

If we introduce world terms without changing runtime contracts, we gain only new
names and no clarity.

The model must cash out in concrete behavior:

- world coordinates
- viewport descriptors
- terrain rules
- actor occupancy rules

### 11.4 Risk: Premature Rich Geometry

Arbitrary shapes, procedural topology, and complex overlap interaction are all
possible future directions, but the first implementation should stay simple:

- rectangular world regions
- deterministic layering defaults
- viewport-based continuation

That is enough to unlock real value early.

---

## 12. Recommended Next Step

The most practical next step is:

1. Define an internal world-space runtime model.
2. Lower current `zone-map` strip normalization into world-space regions.
3. Make page generation explicitly consume viewport descriptors.
4. Add one authored capability that proves the model is real:
   world-space rectangular zones with explicit `x`, `y`, and `width`.

That would move the engine from:

- pages as primary layout truth

to:

- world space as primary layout truth

without destabilizing the current system.

---

## 13. Bottom Line

VMPrint already thinks more like a simulation engine than a typesetter.

The explicit world-map model is the next step that makes that truth usable
throughout the system.

It gives `zone-map` a more honest future.
It gives `story` a cleaner continuation model.
It gives `table` a clearer spatial footing.
And it gives advanced layout work a practical path that does not require
pretending every spatial problem is secretly a page-contained block problem.
