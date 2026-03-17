# AST / Spatial IR Alignment Memo

This memo captures the first AST design audit after the Spatial IR refactor.

It is intentionally scoped to the **newer spatial constructs first**:

- `zone-map`
- `story`
- story-local float / absolute placement directives
- `columnSpan`
- page regions (`header`, `footer`, `pageOverrides`)

The goal is not to make the AST mirror the Spatial IR exactly. The goal is to
keep the AST close enough to the engine's real spatial model that the Spatial
IR is clearly a **normalized form** of the AST, not a reinterpretation of it.

---

## 1. Design Rule

The desired relationship is:

- **AST**: canonical public source, author-facing, declarative
- **Spatial IR**: internal normalized spatial form, runtime-facing

The AST should stay somewhat higher-level than the IR, but for spatially honest
constructs the gap should be small and intentional.

Practical test:

- If a construct is already spatial in author intent, the AST should represent
  it using spatial vocabulary directly.
- If the normalizer has to "guess what the author really meant spatially",
  the AST shape is too indirect.

### Refined philosophy

The audit should not treat "DOM-like" as an automatic flaw.

Better rule:

- take advantage of user familiarity when it genuinely helps authoring
- resist DOM-like parent/children structure when it smuggles in the wrong
  spatial model
- be especially skeptical of deep recursive hierarchy when the real concept is
  a region, lane, grid, or placement directive

In short:

- **not anti-familiarity**
- **anti-false-hierarchy**

This is why a table-style authored shape may be acceptable, while a
container-child encoding of layout zones is not.

### Redesign policy

AST redesign should follow two different standards depending on the kind of
change.

**1. Streamlining existing AST surface**

This should be conservative and regression-safe:

- make the surface clearer
- reduce false hierarchy
- improve coherence
- do not remove capabilities
- preserve identical output for existing authored documents

**2. Adding new spatially honest constructs**

This should be additive and pragmatic:

- do not take old tools away
- do not force migration
- let authors keep using hacks if they want to
- introduce better constructs as optional new tools
- validate them through real authored use and visual success, not by forcing
  exact equivalence with every old workaround

This keeps the public AST stable while still allowing it to grow.

---

## 2. Alignment Categories

### 2.1 Keep As-Is

These newer constructs are already close to the Spatial IR and should be used
as the reference style for future AST design.

#### `zone-map`

`zone-map` is one of the healthiest AST shapes in the system.

Why it works:

- `zones[]` are explicit region descriptors, not fake DOM children
- per-zone content assignment is direct and easy to inspect
- width solving is declarative through `properties.zones.columns`
- the normalized result is naturally a `ZoneStrip { overflow: 'independent' }`

This is exactly the kind of authored shape we want more of:

- author-facing
- spatially explicit
- easy to normalize without reinterpretation

Decision:

- keep `zone-map` as a distinct AST construct
- do **not** collapse it with `story` in the public AST
- treat it as a model for future spatial AST features

Important clarification:

- the authored shape of `zone-map` is strong
- the currently shipped runtime behavior is still only the first slice of the
  underlying idea

In particular, the robust newsletter specimen and
[LAYOUT-ZONES.md](c:\Users\cosmic\Projects\vmprint\documents\LAYOUT-ZONES.md)
make clear that `zone-map` has become spatial in **partitioning**, but not yet
fully spatial in **lifecycle**. It still behaves too much like a move-whole
block at the page boundary.

That does **not** weaken the AST design. It means the runtime still needs to
finish the philosophy that inspired the construct.

#### `columnSpan`

`columnSpan` is also healthy as a public AST concept.

Why it works:

- it expresses real author intent
- the author does not need to think in terms of strip splitting
- the normalizer can consume it structurally and turn it into
  `[ZoneStrip, FlowBlock, ZoneStrip]`

Decision:

- keep `columnSpan` in the AST
- keep its meaning high-level and author-facing
- do not expose strip splitting as authored structure

---

### 2.2 Keep Distinct, But Move Closer

These constructs are conceptually aligned with the Spatial IR, but their AST
encoding still hides too much spatial meaning in generic `Element` structure or
in overloaded `properties`.

#### `story`

`story` should remain a distinct AST construct.

It must not be generalized into `zone-map` with a flag, because the author
intent is different:

- `story`: one linked flow distributed across lanes
- `zone-map`: independent content assigned to separate regions

However, `story` is still encoded too generically today. It is really a
first-class layout context, but in the AST it still looks too much like
"another element with special fields."

What is already good:

- `columns`
- `gutter`
- `balance`
- child-level `columnSpan`

What still feels too hidden:

- float / absolute behavior living inside `properties.layout`
- the fact that story children inhabit a linked strip flow context rather than
  ordinary container semantics

Decision:

- keep `story` distinct in the AST
- move its layout-specific child semantics closer to the surface
- make it feel more like a first-class layout primitive and less like a
  generic container with magic `properties`

#### Story-local placement directives

Today, story-local float / absolute placement is encoded in
`properties.layout`.

That is workable, but it hides spatial meaning inside a broad property bag.
These directives are not just style; they alter spatial participation.

What the IR taught us:

- block floats are spatial obstacles
- story-absolute placement is a placement directive, not visual styling
- these semantics belong closer to structure than to generic style overrides

Decision:

- keep the concept
- consider promoting story-local placement into a more explicit AST shape or a
  more narrowly scoped field than generic `properties.layout`
- do not let these semantics drift back toward CSS-like style vocabulary

---

### 2.3 Intentionally Higher-Level Than IR

These are places where the AST should remain more declarative than the Spatial
IR, even if the runtime becomes fully unified underneath.

#### `story` vs `zone-map`

Internally, both can normalize toward `ZoneStrip`.

Publicly, they should remain separate.

Reason:

- the AST is for expressing author intent
- the IR is for expressing runtime structure

Converging them in the runtime is good.
Converging them in the public AST would throw away useful meaning.

#### Page regions

The AST should continue to describe page regions as page-region concepts:

- `header`
- `footer`
- `pageOverrides`

It should not expose compiled page-region variants or other normalize-time
artifacts.

Decision:

- keep page-region constructs declarative in the AST
- let normalization compile them into explicit runtime region forms

---

## 3. Trouble Spots Identified Early

These are not yet the main redesign targets, but they are already visible from
the newer-construct audit.

### 3.1 Page regions are conceptually strong but composition is awkward

The page-region model itself is good.

What is already right:

- the AST uses explicit `header` / `footer` concepts rather than raw page-space
  coordinates
- geometry stays engine-owned through margins and inset fields
- selector logic (`firstPage`, `odd`, `even`, `default`) is author-facing and
  easy to understand
- `pageOverrides` correctly express page-local suppression or replacement

This is a strong authored model and should be preserved.

However, the **content composition inside page regions** is still awkward in
practice. The regression fixture
[17-header-footer-test.json](c:\Users\cosmic\Projects\vmprint\engine\tests\fixtures\regression\17-header-footer-test.json)
shows the current workaround clearly: region content often uses a one-row table
to achieve left / center / right alignment inside the header or footer.

That is a sign the AST is missing a better composition primitive for small
region-local layout.

The problem is not that tables are illegal there. The problem is that tables
are doing presentation work that is not really tabular:

- running-title left
- folio centered
- chapter title right

This is not data grid authoring. It is lightweight region composition.

Guideline:

- keep `header`, `footer`, and `pageOverrides` as authored concepts
- do not replace them with generic spatial rectangles in the AST
- later introduce a simpler region-composition primitive so authors do not need
  table-shaped hacks for common running-head / folio layouts

Possible future direction:

- a lightweight row / slots construct specifically for small fixed-height
  region composition
- or a narrowly scoped alignment primitive for left / center / right region
  content

The exact construct should be decided later; the immediate conclusion is simply
that the region model is sound while the region **internal composition model**
needs improvement.

### 3.2 `properties` remains too overloaded

Even in the newer spatial areas, too much meaning is carried by `properties`.

Right now it mixes:

- style overrides
- image payload
- table/grid configuration
- story placement directives
- spanning directives
- page-region overrides
- provenance / metadata
- pagination behavior

This is convenient internally but too opaque as a public design surface.

Guideline:

- stable structural concepts should gradually move out of `properties`
- `properties` should shrink toward true overrides and metadata

---

## 4. Immediate Decisions From This Audit

These decisions can already guide future AST work.

1. `zone-map` is a reference-quality AST construct and should be preserved.
2. `story` and `zone-map` stay distinct in the public AST.
3. The Spatial IR may unify them internally as `ZoneStrip`.
4. `columnSpan` stays as an author-facing AST concept.
5. Story-local placement semantics should move closer to explicit structure and
   farther away from generic property-bag encoding.
6. The AST should keep being the single canonical public source format.

---

## 5. Recommended Next Audit Order

Now that the newer spatial constructs have a first alignment pass, the next
AST audit steps should be:

1. Page regions and region composition
2. Tables / grid authoring model
3. Floats / obstacles as authored concepts outside story-only contexts
4. Older generic container / inline patterns that still inherit DOM gravity

That order preserves the newer spatial vocabulary as the design standard before
we revisit the older parts of the AST.

---

## 6. Tables / Grid Audit

This section records the next audit slice after page regions.

### 6.1 What the current table AST gets right

The current table model is not bad. It has several real strengths:

- it is familiar to authors
- row and cell order are easy to inspect
- `colSpan` and `rowSpan` are straightforward to write
- repeated-header intent is explicit through `headerRows` and `repeatHeader`
- column sizing is already spatially honest through `properties.table.columns`

The regression fixture
[09-tables-spans-pagination.json](c:\Users\cosmic\Projects\vmprint\engine\tests\fixtures\regression\09-tables-spans-pagination.json)
shows that the current shape is expressive enough for complicated pagination
behavior, including mixed `colSpan`, `rowSpan`, and repeated headers.

So the conclusion is not "tables are broken." The conclusion is that tables are
currently the strongest remaining pocket of inherited DOM gravity.

### 6.2 Where the current table AST still feels too DOM-like

The main issue is the structural shape:

- `table`
- `table-row`
- `table-cell`

That hierarchy comes with a strong HTML mental model. In VMPrint runtime terms,
however, the real object is much closer to a constrained spatial grid with:

- resolved columns
- cell spans
- row groups
- per-cell layout sub-sessions

The Spatial IR makes this explicit as `SpatialGrid`, while the AST still
describes the same thing through row/cell tree nesting plus scattered
properties.

The biggest signs of mismatch are:

- header-ness is split between `headerRows` and `table-row.properties.semanticRole`
- cell span semantics live on cells while column geometry lives elsewhere
- the true runtime identity of the construct is "grid with shared row heights,"
  not "DOM table tree"

### 6.3 What should stay

Not everything should be replaced.

These table concepts are good public AST concepts and should survive:

- `repeatHeader`
- `headerRows`
- per-column track sizing
- `colSpan`
- `rowSpan`

These all express genuine author intent and normalize cleanly into
`SpatialGrid`.

### 6.4 What should move closer to the Spatial IR

The public AST table model should become more explicitly grid-like over time.

That does **not** necessarily mean removing `table-row` / `table-cell`
immediately. But it does mean future changes should pull toward the grid truth
rather than deeper into DOM conventions.

The clearest opportunities are:

- make row-group semantics more explicit and less split across multiple fields
- make the connection between declared columns and spatial cell placement more
  visible
- reduce reliance on `semanticRole: "header"` as an overloaded generic flag

The likely long-term direction is:

- keep table authoring readable
- but let the AST speak more openly in terms of grid semantics rather than
  pretending the hierarchy itself is the main truth

### 6.5 Important boundary: tables are still not zones

The audit reinforces an earlier conclusion from
[LAYOUT-ZONES.md](c:\Users\cosmic\Projects\vmprint\documents\LAYOUT-ZONES.md):

- tables are data structures
- zones are layout structures

That distinction should remain firm.

Even if we improve the table AST to be more grid-honest, it should not be
collapsed into `zone-map`, nor should region-composition hacks push us toward
using tables as a general-purpose spatial layout primitive.

In fact, the page-region audit suggests the opposite: we should reduce the need
to misuse tables for header/footer composition.

### 6.6 Current conclusion on tables

Tables are the first older construct that should be redesigned in light of the
Spatial IR, but carefully.

Working rule:

- preserve the parts that express author intent cleanly
- reduce the parts that merely imitate HTML structure
- move the AST table model toward "authored grid" rather than "DOM table"

This should be a gradual redesign, not a sudden incompatible rewrite.

---

## 7. Floats / Obstacles / Placement Audit

This section records the next audit slice after page regions and tables.

### 7.1 What the current AST gets right

The current story-placement model is already capable and expressive.

The regression fixtures
[11-story-image-floats.json](c:\Users\cosmic\Projects\vmprint\engine\tests\fixtures\regression\11-story-image-floats.json)
and
[20-block-floats-and-column-span.json](c:\Users\cosmic\Projects\vmprint\engine\tests\fixtures\regression\20-block-floats-and-column-span.json)
show that authors can already express:

- image floats
- block floats
- story-absolute placement
- wrap modes (`around`, `top-bottom`, `none`)
- left / center / right anchoring
- interaction with `columnSpan`

So this is not a missing-feature problem. It is a surface-design problem.

### 7.2 The main weakness: spatial meaning is hidden inside `properties.layout`

Today, these semantics live in `properties.layout`, usually on children of a
`story`.

That works mechanically, but it hides a strongly spatial concept inside a
generic property bag:

- `mode: 'float'`
- `mode: 'story-absolute'`
- `align`
- `wrap`
- `gap`
- sometimes `x` / `y`

These are not visual tweaks. They change how the element participates in the
layout field.

The Spatial IR makes that truth explicit:

- block-level floats become `BlockObstacle`
- their spatial role is structural, not cosmetic
- `columnSpan` is consumed structurally rather than preserved as a passive
  property

That tells us the AST should move at least somewhat closer to the same honesty.

### 7.3 What should stay

The following concepts are good public AST concepts and should remain:

- float vs absolute placement as authored distinctions
- wrap policy
- left / center / right anchoring
- `columnSpan`

These are meaningful to authors and normalize cleanly.

### 7.4 What should change

The weak spot is not the concepts themselves. It is where they live and how
implicitly they are introduced.

Current smell:

- a generic content element becomes a fundamentally different spatial actor
  only because `properties.layout` happens to be present

That is too hidden.

Working direction:

- keep the authored concepts
- make placement semantics more explicit than generic `properties.layout`
- keep them author-friendly rather than exposing IR nodes like
  `BlockObstacle`

That could mean:

- a more narrowly scoped placement field instead of generic `layout`
- or a clearer authored sub-structure for obstacle behavior

The exact syntax can wait. The important design conclusion is already clear:

- placement semantics are too important to remain buried in a broad property
  bag forever

### 7.5 Important boundary: do not over-generalize too early

The audit should stay disciplined here.

It would be easy to overreact and invent a large new obstacle vocabulary for
the public AST. That would be premature.

Better rule:

- keep the author-facing concepts simple
- improve explicitness
- do not force IR terminology into the AST
- do not generalize beyond real author use cases yet

### 7.6 Current conclusion on placement semantics

This is now one of the best candidates for future AST cleanup.

Compared to tables:

- tables benefit strongly from user familiarity, so we can leave them mostly
  alone
- placement / obstacle semantics are less familiar and more engine-shaped, so
  they deserve a more deliberate public design pass

Working rule:

- preserve the current capabilities
- make spatial participation more explicit
- avoid exposing raw IR vocabulary

---

## 8. Next Design Input

The concrete redesign pressure points distilled from these audits and the
fixture review are summarized in
[AST-REDESIGN-CANDIDATES.md](c:\Users\cosmic\Projects\vmprint\documents\AST-REDESIGN-CANDIDATES.md).

The first concrete cleanup pass for the AST surface itself is captured in
[AST-1.1-PROPERTIES-CLEANUP.md](c:\Users\cosmic\Projects\vmprint\documents\AST-1.1-PROPERTIES-CLEANUP.md).
