# AST Composition Primitive

`strip` is now implemented as an additive AST construct.

It was introduced to replace a narrow class of table-shaped composition hacks
without changing the public AST's overall philosophy:

- keep familiar authored shapes where they help
- resist false hierarchy where it distorts the real layout problem
- add better spatial tools without removing old escape hatches

This document proposes a **single narrow AST addition**:

- a lightweight horizontal composition primitive for bands, bylines, and
  header/footer rows

It is intentionally limited. It is not meant to become a second page-layout
language.

It is also explicitly **additive**:

- existing table-based or other hacky authored solutions remain valid
- this primitive is offered as a better tool where it helps
- it is not a forced replacement or migration path

See also:

- [AST-COMPOSITION-EXAMPLES.md](c:\Users\cosmic\Projects\vmprint\documents\AST-COMPOSITION-EXAMPLES.md)

---

## 1. Problem

Two recurring authored patterns currently require table-shaped hacks:

1. small metadata bands in the main flow
2. left / center / right running content in headers and footers

Examples:

- [newsletter-layout.json](c:\Users\cosmic\Projects\vmprint\documents\readme-assets\newsletter-layout.json)
- [17-header-footer-test.json](c:\Users\cosmic\Projects\vmprint\engine\tests\fixtures\regression\17-header-footer-test.json)

These uses are not really tabular data. They are lightweight horizontal
composition.

---

## 2. Proposed Primitive: `strip`

### Intent

A `strip` is a one-row horizontal composition band with independently authored
slots.

Use it for:

- bylines
- folio lines
- masthead sub-rows
- small editorial metadata bands
- simple left / center / right running content

Do **not** use it for:

- tabular data
- repeating data grids
- multi-row shared-height structures
- independent parallel article regions

Tables stay tables.
`zone-map` stays the region/layout primitive.

---

## 3. Proposed AST Shape

```typescript
interface Element {
    type: string;
    content: string;
    children?: Element[];
    slots?: StripSlot[];
    columns?: number;
    gutter?: number;
    balance?: boolean;
    properties?: ElementProperties;
}

interface StripSlot {
    id?: string;
    elements: Element[];
    style?: ElementStyle;
}

interface StripLayoutOptions {
    tracks: TableColumnSizing[];
    gap?: number;
}

interface ElementProperties {
    // ... existing fields ...
    strip?: StripLayoutOptions;
}
```

Authored example:

```json
{
  "type": "strip",
  "properties": {
    "strip": {
      "tracks": [
        { "mode": "flex", "fr": 1 },
        { "mode": "fixed", "value": 32 },
        { "mode": "flex", "fr": 1 }
      ],
      "gap": 8
    }
  },
  "slots": [
    {
      "id": "left",
      "elements": [
        { "type": "folio-left", "content": "A Study in Page Regions" }
      ]
    },
    {
      "id": "center",
      "elements": [
        { "type": "folio-center", "content": "{pageNumber}" }
      ]
    },
    {
      "id": "right",
      "elements": [
        { "type": "folio-right", "content": "I · The Problem of Regions" }
      ]
    }
  ]
}
```

---

## 4. Why `strip` Instead Of A Table

Because the authored meaning is different.

A table says:

- rows
- cells
- tabular structure
- potentially repeated headers
- data grid semantics

A strip says:

- this is one horizontal composition band
- each slot is an independently authored region
- height is simply the height of the tallest slot

That matches the actual use case much better.

---

## 5. Why `strip` Instead Of `zone-map`

Because the scope is intentionally narrower.

`zone-map` is for independent layout regions as a real spatial structure.
It is the right answer for article body plus sidebar, or parallel editorial
blocks.

`strip` is for compact one-row composition.

Main differences:

- `strip` is one row only
- intended for compact content
- no implication of larger editorial region semantics
- tuned for common band-style composition

So this is not a replacement for `zone-map`; it is a narrower authored helper.

---

## 6. Normalization Model

Internally, `strip` can normalize very close to a constrained `zone-map` /
independent `ZoneStrip`.

Roughly:

- `properties.strip.tracks` -> solve widths
- `slots[]` -> independent regions
- strip height -> tallest slot
- overall overflow policy -> `move-whole`

That keeps the runtime model simple while preserving a better authored shape.

---

## 7. Good Initial Constraints

To avoid over-engineering, V1 should stay narrow:

- one row only
- no pagination inside the strip
- no linked overflow between slots
- no explicit authored `x` / `y`
- no spanning across tracks
- no nested strips as a design target, even if they happen to work

These constraints are a feature, not a limitation.
They keep the primitive honest.

---

## 8. Immediate Wins

If introduced, `strip` would immediately improve:

- the byline band in [newsletter-layout.json](c:\Users\cosmic\Projects\vmprint\documents\readme-assets\newsletter-layout.json)
- the footer bands in [17-header-footer-test.json](c:\Users\cosmic\Projects\vmprint\engine\tests\fixtures\regression\17-header-footer-test.json)
- similar future masthead / metadata / folio layouts

And it would do so without:

- redesigning tables
- weakening `zone-map`
- exposing Spatial IR vocabulary publicly

---

## 9. Validation Result

`strip` has now been validated in two ways:

- exact regression equivalence against an authored `zone-map` counterpart in
  [strip-layout.spec.ts](c:\Users\cosmic\Projects\vmprint\engine\tests\strip-layout.spec.ts)
- real authored replacement in
  [newsletter-layout.json](c:\Users\cosmic\Projects\vmprint\documents\readme-assets\newsletter-layout.json),
  producing visually identical output while reading much more honestly as AST

That makes `strip` a successful additive primitive rather than a speculative
proposal.

## 10. Validation Standard

Because this is an additive construct, it should not be held to the same
"identical snapshots" standard as a pure cleanup of existing AST surface.

Instead, the validation standard should be:

- easy to understand as authored AST
- easy to normalize and implement
- able to recreate real target designs cleanly
- visually successful in representative documents such as
  [newsletter-layout.json](c:\Users\cosmic\Projects\vmprint\documents\readme-assets\newsletter-layout.json)

If it achieves that without broadening into a generic layout language, it has
earned its place.
