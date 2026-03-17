# AST Redesign Candidates

This memo distills the AST audits into a short list of redesign candidates.

It is intentionally pragmatic. The goal is not to redesign the entire AST.
The goal is to identify the few places where the current authored shape creates
real awkwardness, hackiness, or avoidable indirection.

This memo should be read together with:

- [AST-SPATIAL-ALIGNMENT.md](c:\Users\cosmic\Projects\vmprint\documents\AST-SPATIAL-ALIGNMENT.md)
- [AST-1.1-PROPERTIES-CLEANUP.md](c:\Users\cosmic\Projects\vmprint\documents\AST-1.1-PROPERTIES-CLEANUP.md)
- [newsletter-layout.json](c:\Users\cosmic\Projects\vmprint\documents\readme-assets\newsletter-layout.json)
- [specimen-blueprint.json](c:\Users\cosmic\Projects\vmprint\documents\readme-assets\specimen-blueprint.json)

---

## 0. Change Policy

The redesign work should follow this policy:

- streamline existing AST surface conservatively
- keep existing capabilities intact
- preserve identical output for legacy authored documents whenever the surface
  is merely being cleaned up
- add new spatially optimized constructs only as optional tools
- do not force authors away from older hacky but valid patterns

This means the candidates below are not all the same kind of work:

- some are cleanup directions for the existing AST
- some are proposals for additive new constructs

That distinction should remain explicit.

---

## 1. What To Leave Alone

These parts of the AST are working well enough that redesign pressure is low.

### `zone-map`

Keep as-is in principle.

Why:

- already spatially honest
- no false parent/child hierarchy
- normalizes cleanly to Spatial IR
- directly solves a real previously-hacky layout problem

### `story`

Keep as a distinct public concept.

Why:

- author intent is different from `zone-map`
- linked flow is a meaningful authored distinction
- `columns`, `gutter`, `balance`, and `columnSpan` are understandable

### `table`

Mostly leave alone.

Why:

- strong user familiarity
- current authoring model is readable
- normalizes cleanly enough internally

Possible later cleanup:

- header semantics
- minor reduction of `semanticRole` awkwardness

But this should not be a priority redesign.

---

## 2. Real Pressure Points

These are the places where redesign would likely improve authoring materially.

### 2.1 Lightweight Composition Primitive

This is the clearest gap.

Evidence:

- [newsletter-layout.json](c:\Users\cosmic\Projects\vmprint\documents\readme-assets\newsletter-layout.json)
- [17-header-footer-test.json](c:\Users\cosmic\Projects\vmprint\engine\tests\fixtures\regression\17-header-footer-test.json)

Current symptom:

- tables are being used for non-tabular alignment
- especially for left / center / right strips
- also for small metadata bands and footer/header rows

This is not a table problem. It is a missing composition primitive problem.

What a redesign should aim to provide:

- a simple way to place small authored items side-by-side
- suitable for headers, footers, masthead bands, bylines, and small editorial strips
- intentionally lightweight, not a full free-form layout system

What it should avoid:

- becoming a generic page-coordinate composition language
- duplicating `zone-map`
- encouraging deep nested container trees

Best first concrete proposal:

- [AST-COMPOSITION-PRIMITIVE.md](c:\Users\cosmic\Projects\vmprint\documents\AST-COMPOSITION-PRIMITIVE.md)
  proposes a narrow `strip` primitive for exactly this use case, as an
  additive tool rather than a replacement path.

### 2.2 More Explicit Placement Semantics

Evidence:

- [11-story-image-floats.json](c:\Users\cosmic\Projects\vmprint\engine\tests\fixtures\regression\11-story-image-floats.json)
- [20-block-floats-and-column-span.json](c:\Users\cosmic\Projects\vmprint\engine\tests\fixtures\regression\20-block-floats-and-column-span.json)
- [newsletter-layout.json](c:\Users\cosmic\Projects\vmprint\documents\readme-assets\newsletter-layout.json)

Current symptom:

- float / absolute participation is hidden in `properties.layout`
- an ordinary content element quietly becomes a spatial actor

What a redesign should aim to provide:

- keep float / absolute / wrap / align concepts
- make them feel more explicit and structural than a generic property bag
- remain author-friendly and not expose IR terms like `BlockObstacle`

What it should avoid:

- inventing a large public obstacle taxonomy too early
- pushing raw IR terminology into the authored AST

### 2.3 Shrinking `properties`

This is less a single feature than a design cleanup direction.

Current symptom:

- `properties` mixes styling, structure, geometry hints, metadata, and engine directives

What a redesign should aim to provide:

- move stable structural concepts out of `properties` when they earn first-class status
- leave `properties` for genuine overrides and metadata as much as possible

This should happen gradually, not through a sweeping rewrite.

The first concrete pass is captured in
[AST-1.1-PROPERTIES-CLEANUP.md](c:\Users\cosmic\Projects\vmprint\documents\AST-1.1-PROPERTIES-CLEANUP.md).

---

## 3. What The Newsletter Teaches Us

[newsletter-layout.json](c:\Users\cosmic\Projects\vmprint\documents\readme-assets\newsletter-layout.json) is especially valuable because it is both visually strong and architecturally revealing.

It shows:

- how far the current AST can be pushed
- where the AST is genuinely expressive
- where the author has to improvise with hacks

The most important lessons:

1. `zone-map` was necessary.
   The file makes clear that independent editorial regions were previously being
   forced through structures that did not match the layout intent.

2. Tables are often standing in for layout strips.
   This is not because tables are bad, but because the AST lacks a better
   primitive for small horizontal composition.

3. Placement semantics are powerful but still too hidden.
   Floats and obstacle participation work, but their authored expression still
   feels like an implementation trick in places.

4. Deep hierarchy is not the source of expressive power here.
   The best parts of the file come from strong styles, strong content, and a
   few well-chosen layout constructs, not from nested container machinery.

---

## 4. Recommended Redesign Order

If redesign work starts, this is the recommended priority:

1. Lightweight composition primitive
2. More explicit placement semantics
3. Gradual `properties` cleanup

What should wait:

- broad table redesign
- collapsing `story` and `zone-map`
- generalized page-coordinate authoring
- any large new public “layout language”

---

## 5. Guiding Rule

The redesign standard should remain:

- use familiarity where it genuinely helps
- resist false hierarchy
- add first-class constructs only where the current AST is clearly forcing hacks

In short:

- leave familiar, effective shapes alone
- redesign only the places that are making authors fight the model
