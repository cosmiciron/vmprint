# Exclusion Assembly

This document defines VMPrint's exclusion substrate: how authored shapes become text-wrapping obstacles, why `exclusionAssembly` is the preferred long-term surface, and how weighted members let the same model serve both fast motion-heavy layouts and high-fidelity editorial wrapping.

For the broader system map, see [ARCHITECTURE.md](ARCHITECTURE.md). For engine execution details, see [ENGINE-INTERNALS.md](ENGINE-INTERNALS.md).

---

## Why This Exists

Text wrapping around obstacles is easy when the obstacle is a rectangle. It gets much harder when the obstacle is irregular: a pull-quote cluster, an illustration, a diagram, a moving creature, a rough silhouette imported from art, or a shape that only approximately resembles a circle.

The usual answer is to multiply substrates:

- one lane for primitive circles and rectangles
- another for SVG or bezier paths
- another for polygon colliders
- another for composed exclusion objects
- another for runtime-optimized collision geometry

That path creates architectural drag. Each lane wants slightly different rules, different tooling, different validation, different rendering assumptions, and different performance work. Over time the engine stops having one exclusion model and starts carrying several overlapping ones.

VMPrint's direction is simpler:

- keep one authored exclusion substrate
- make it expressive enough to represent both crude and refined shapes
- let optimization happen internally without changing the authored document model

That substrate is `exclusionAssembly`.

---

## The Core Claim

An exclusion field does not need a special-purpose geometry language to be useful. It only needs to publish enough spatial resistance that the story packager can decide where text may begin on each line band.

`exclusionAssembly` is therefore treated as the general exclusion language:

- A simple float can use one primitive member.
- A circle can use the built-in `circle` shape.
- A rough approximation can use a handful of rectangles.
- A refined silhouette can use many rectangles.
- A softened or anti-aliased edge can use additional lower-resistance members around the harder core.

These are not different systems. They are different authoring choices within the same system.

That unification matters because it preserves backward compatibility and keeps the AST stable while still leaving room for later internal compilation, caching, merging, or scanline acceleration.

---

## Spatial Field Polarity

The same authored field can now be consumed in two different spatial modes.

### `exclude`: outside pressure

This is the traditional behavior. The assembly publishes forbidden space and the packager settles text around it.

Conceptually:

- available space = host measure minus authored field intervals
- the field behaves like an obstacle
- optional clipping can make the visible host submit to the same silhouette

This is the familiar float and wrap-around case.

### `contain`: interior room

This is the inverted behavior. The assembly no longer means "stay out." It means "these are the only valid writing lanes."

Conceptually:

- available space = authored field intervals
- the field behaves like an interior room
- the same line carver can be reused by flipping the polarity of the query

This matters because it proves the authored field is not just an exclusion gimmick. It is a general spatial substrate.

If a circle, polygon, or weighted assembly can act as a room, then the engine is no longer limited to wrapping around shapes. It can also settle text inside them.

### Clipping and containment are separate concerns

Containment should not be confused with visual clipping.

- `contain` answers where text is allowed to settle
- `clip` answers whether the host should visibly submit to the authored boundary

That separation is important. Sometimes a shape is only a settlement guide. Sometimes it is both a guide and a visible mask. The document should be able to choose either behavior without changing the authored field itself.

---

## The Authoring Model

An authored exclusion assembly is a list of members. Each member is a local primitive relative to the hosting float or spatial field.

Today a member can already express:

- `x`, `y`, `w`, `h`
- `shape`
- `path` when the shape is `polygon`
- `zIndex`
- `traversalInteraction`
- `resistance`

The important point is that all exclusion complexity is expressed through ordinary members in the AST. There should be no hidden runtime-only injection of extra wrap geometry for authored content. If the document visually shows twenty-seven AA helper boxes, the assembly should contain those same twenty-seven members.

That makes the AST the single source of truth.

### Hard members

A hard member is a normal obstacle. Conceptually, it is a full-strength exclusion contributor.

Typical use:

- ordinary left/right floats
- rectangular art blocks
- circle or ellipse colliders
- coarse composed silhouettes where a crisp edge is acceptable

### Weighted members

A weighted member carries a `resistance` value lower than the fully solid case. This makes it useful as a soft outer band rather than a binary wall.

Typical use:

- anti-aliased helper bands around a jagged box approximation
- low-strength filler blocks that smooth the perceived silhouette
- imported alpha-derived edge bands from raster artwork
- subtle shaping around concave or stepped boundaries

This is the decisive extension that makes the assembly substrate credible across both fast and precise use cases.

---

## Resistance And Tolerance

These two ideas should remain separate.

### Resistance belongs to the authored shape

`resistance` is authored per member. It describes how strongly that member pushes back on wrapping.

Practical interpretation:

- `1` means fully solid exclusion
- values below `1` represent progressively softer exclusion

The exact numeric palette is up to the authoring tool or fixture. A hand-authored assembly may use just `1`, `0.6`, and `0.3`. A raster-import tool may use many more levels. The substrate does not need to hard-code special meaning for every number.

### Tolerance belongs to layout policy

The fitter should be able to decide, globally, how much soft resistance it is willing to absorb. That policy is better expressed as a tolerance than as hard-coded semantic tiers.

Conceptually:

- `resistance` is the authored field strength
- `tolerance` is the current layout pass's willingness to intrude into weak resistance

This separation gives VMPrint room to support different operating modes without changing the document:

- a stricter editorial mode
- a looser motion or animation mode
- experiments that tune one global tolerance instead of redefining all member values

The important architectural point is not the exact tolerance formula. It is that authored member strength and runtime fitting policy are different concerns.

---

## Why Weighted Boxes Matter

Without weighted members, a box approximation is only binary. Every jag is treated as a real cliff. That is often good enough for coarse layout, but it can create obvious stepping in the wrap lane when the intended silhouette is curved.

Weighted members change that.

Instead of asking the text wrapper to obey every micro-jag equally, the author can publish:

- a hard interior
- one or more softer edge bands
- optional filler pieces where a visual silhouette needs help

This behaves much more like anti-aliasing for collision and exclusion. The engine is no longer seeing only black-or-white occupancy. It is seeing a graded field.

That is what allows a small set of primitive authored members to approximate:

- a circle closely enough for editorial wrap
- a traced cat silhouette
- in principle, a detailed dragon alpha channel from illustrated artwork

The result is not that the engine suddenly becomes a full vector boolean geometry solver. The result is better: the expensive interpretive work can happen at authoring time, while the runtime still consumes the same stable exclusion substrate.

---

## Why This Beats Multiple Substrates

Keeping `exclusionAssembly` as the main substrate has several advantages.

### Backward compatibility stays intact

Existing assembly-based documents remain valid. Primitive circles and rectangles can stay exactly where they are: as convenient assembly members, not as rival systems.

### Authoring and runtime stay conceptually aligned

Authors think in terms of "what blocks the text here?" not "which internal collider family should this document target?" The assembly model matches the author's mental model.

### Optimization remains an implementation detail

If the engine later compacts members, merges spans, caches scanlines, or compiles assemblies into a faster internal structure, none of that requires a document format migration.

### The same model serves both speed and fidelity

One document may use seven hard members for a fast animated dragon. Another may use hundreds of weighted members for a high-fidelity illustrated-book dragon. The substrate does not change. Only the authored density changes.

---

## Recommended Use

### Use primitives when the shape is already simple

If a float really is a circle, ellipse, or rectangle, author it that way. There is no need to approximate a simple primitive with many smaller members unless you are intentionally testing or demonstrating the approximation path.

### Use hard rectangular members for coarse or fast approximations

If the obstacle only needs to be believable at a broad level, a small assembly of hard rectangles is often enough.

Good cases:

- motion graphics
- live or frequently-updated layouts
- rough illustration hulls
- proof-of-concept wrap shapes

### Add weighted members only where they improve the wrap lane

Weighted helper members should usually live near the active boundary. They are most useful when they smooth the entry and recovery of text around a hard core. They are least useful when they merely duplicate broad interior coverage.

Good cases:

- smoothing a stepped circular approximation
- softening the outer edge of a traced silhouette
- preventing a line from dipping awkwardly into a low-value gap

### Use the same assembly for both outside-wrap and inside-settlement when it fits the authored intent

The exact same `exclusionAssembly` may be used in either polarity:

- outside as an obstacle that pushes neighboring content away
- inside as a room that invites one text host to inhabit the authored silhouette

That reuse is a major architectural win. It means a cat, dragon, logo, or traced alpha silhouette does not need one representation for wrapping and another for inhabitation. One authored field can serve both jobs.

### Treat visible debug rectangles as diagnostics

Colored member rendering is extremely useful for debugging. It lets us verify that:

- the authored assembly is what we think it is
- the visible approximation matches the stored AST
- hard and weighted bands are where we expect them to be

But that visualization is a debug aid. The real artifact is the authored assembly in the document.

---

## What This Means For Primitive Shapes

Primitive exclusion shapes are still useful. They are just no longer the beginning of a separate exclusion architecture.

The recommended interpretation is:

- keep currently implemented primitives such as `rect`, `circle`, `ellipse`, and `polygon`
- treat them as member types within the assembly model
- avoid building new rival exclusion systems around them
- add new member primitives later only when they fit naturally into the same assembly contract

This keeps the public model simple. There is one exclusion language. Some members happen to be simple primitives.

Primitive spatial fields also make useful containment proofs because they let us validate the polarity inversion on simple authored rooms before applying the same logic to dense assemblies.

---

## Performance Interpretation

The experiments that led to this document showed two important things.

First, hard assemblies are already competitive with native simple colliders for simple shapes.

Second, weighted assemblies do cost more, but their runtime growth is much softer than raw member-count growth. Even much denser and more irregular shapes remained in a manageable low-millisecond range during wrapping tests.

That does not mean member count is free. It means the architecture is viable before serious optimization.

This is the right order of operations:

1. prove that one authored substrate can represent the use cases honestly
2. prove that the unoptimized runtime remains practical
3. optimize internal compilation and query cost later

The current results satisfy the first two conditions strongly enough to make `exclusionAssembly` the right foundation.

---

## Compact Assembly Format

High-density assemblies — particularly anti-aliased silhouettes with hundreds of weighted members — can become verbose in the JSON document. The engine supports a compact `layers` encoding as an alternative to the flat `members` array.

### The layers format

Instead of a flat list of member objects, an assembly can be expressed as resistance-grouped layers of coordinate tuples:

```json
"exclusionAssembly": {
  "layers": [
    {"r": 1,   "rects": [[29,0,13,6],[28,6,16,6],[28,12,16,6]]},
    {"r": 0.6, "rects": [[24,0,56,12],[16,12,72,10]]},
    {"r": 0.3, "rects": [[20,0,64,10],[12,10,80,10]]}
  ]
}
```

Each layer carries a single `r` (resistance) value that applies to all its rects. Omitting `r` is equivalent to a fully hard member. Each rect is a `[x, y, w, h]` tuple. Hard layers should come first.

This encoding is accepted anywhere `exclusionAssembly` is valid. The engine normalizes it to the standard `members` representation during document parsing, so no other part of the system is affected.

### Compacting an existing document

The engine ships a tool that converts all `members`-style assemblies in a document to `layers` in a single pass. It modifies the file in-place, writing the rest of the document in pretty-printed form while keeping each assembly as a single dense line.

```
npm run tool:compact-assembly -- path/to/document.json
```

The original file is backed up as `document.json.bak` before any changes are written. If no assemblies are found the backup is removed and the file is left unchanged.

Typical size reduction on a document containing large anti-aliased assemblies is around 4–5× on the assembly content itself.

---

## Non-Goals

This direction explicitly does not require:

- introducing a new public exclusion substrate
- forcing authors to publish boundary-code-only documents
- replacing the AST with runtime-specific compiled geometry
- extending the primitive set endlessly just to chase every possible silhouette

If a shape can be expressed well enough with hard and weighted assembly members, the engine already has what it needs.

---

## Implementation Guidance

If you are extending this part of the engine, preserve these rules.

### Keep the AST as the single source of truth

Do not hide authored wrap members in test scripts or runtime patch-up code. If the wrap field matters, it should be present in the document.

### Keep `exclusionAssembly` as the public substrate

Any internal compaction, banding, caching, or compilation should happen behind the same authored surface.

### Keep resistance authored, not inferred

If a member is soft, the AST should say so. Do not rely on hidden heuristics to reinterpret ordinary hard members as weighted ones.

### Keep policy separate from authored geometry

Tolerance, fitting strategy, and future wrap heuristics should live in layout policy, not in ad hoc reinterpretations of member values.

### Keep debugging visible

The engine should retain a way to inspect or render authored exclusion members so regressions can be understood spatially rather than only numerically.

---

## Bottom Line

VMPrint does not need separate exclusion systems for primitives, polygons, SVG-like contours, anti-aliased approximations, and complex illustrated silhouettes.

It needs one authored exclusion language that scales.

`exclusionAssembly` is that language.

Weighted members are the piece that makes the claim credible. They let the same AST contract serve both a fast, crude, animation-friendly obstacle and a refined, editorial-grade wrap silhouette without requiring a new substrate every time the fidelity target changes.
