# AST 1.1 Properties Cleanup

This memo defines the intended cleanup of the AST surface for the next authored
format revision.

It exists for one reason:

- `properties` is still doing too much work

This is the best moment to fix that. The public AST is still young enough that
we can improve its structure before `properties` hardens into a permanent junk
drawer.

This memo does **not** propose a broad redesign of the AST. It proposes a
clearer boundary for what belongs in `properties` and what should become
first-class structure in a future `documentVersion`.

Related:

- [AST-SPATIAL-ALIGNMENT.md](c:\Users\cosmic\Projects\vmprint\documents\AST-SPATIAL-ALIGNMENT.md)
- [AST-REDESIGN-CANDIDATES.md](c:\Users\cosmic\Projects\vmprint\documents\AST-REDESIGN-CANDIDATES.md)
- [AST-REFERENCE.md](c:\Users\cosmic\Projects\vmprint\documents\AST-REFERENCE.md)
- [AST-1.1-PROPERTIES-EXAMPLES.md](c:\Users\cosmic\Projects\vmprint\documents\AST-1.1-PROPERTIES-EXAMPLES.md)

---

## 1. Rule

`properties` should keep only things that are primarily:

- override-like
- metadata-like
- cross-cutting and not structural

`properties` should stop being the default place for:

- content payloads
- layout model declarations
- authored structure
- stable geometry-participation fields

In short:

- if a field changes what the node *is*, it should not hide in `properties`
- if a field merely adjusts how the node behaves, looks, or is tracked, it may
  stay in `properties`

---

## 2. Classification

### 2.1 Promote Out Of `properties` In AST 1.1

These are the strongest cleanup candidates. They are structural enough that
they should become first-class fields on `Element`.

#### `image`

Current:

```ts
properties.image
```

Why promote:

- it is content payload, not an override
- it changes what the node materially contains
- it is too important to hide in a bag of secondary options

Target direction:

```ts
image?: EmbeddedImagePayload
```

on the element itself.

#### `table`

Current:

```ts
properties.table
```

Why promote:

- it defines the authored grid model of the node
- it is the core structural declaration of `type: "table"`
- it is no more "property-like" than `columns`/`gutter` on `story`

Target direction:

```ts
table?: TableLayoutOptions
```

#### `zones`

Current:

```ts
properties.zones
```

Why promote:

- it defines the track model of `zone-map`
- it is first-class authored structure, not a secondary override
- `zone-map` is already one of the healthiest spatial AST constructs; this
  would make it more honest still

Target direction:

```ts
zoneLayout?: ZoneLayoutOptions
```

The pressure-test examples suggest `zoneLayout` is the cleanest name, because
`zones` is already occupied by the region descriptors themselves.

#### `strip`

Current:

```ts
properties.strip
```

Why promote:

- same reasoning as `zones`
- it is the authored track model of the `strip`
- we just validated `strip`; now is the right time to keep its shape clean

Target direction:

```ts
stripLayout?: StripLayoutOptions
```

The pressure-test examples suggest `stripLayout` is clearer than simply
promoting a field named `strip`, because it distinguishes the authored track
model from the strip node itself.

#### `dropCap`

Current:

```ts
properties.dropCap
```

Why promote:

- it is a substantial authored content/layout feature
- it is specific enough and important enough to justify first-class status
- it already reads more like structure than metadata

Target direction:

```ts
dropCap?: DropCapSpec
```

#### `columnSpan`

Current:

```ts
properties.columnSpan
```

Why promote:

- it is a first-class story-flow participation directive
- it already has strong design legitimacy from the Spatial IR work
- it is not merely an override; it structurally changes how the node is laid
  out in a story

Target direction:

```ts
columnSpan?: 'all' | number
```

### 2.2 Keep In `properties`

These fields still make sense as `properties` members because they are
override-like, metadata-like, or intentionally secondary.

#### `style`

Keep.

Why:

- it is exactly what `properties` is best at: local overrides

#### `sourceId`

Keep.

Why:

- metadata
- cross-cutting
- not structural

#### `linkTarget`

Keep.

Why:

- lightweight cross-cutting behavior
- especially natural on inline nodes

#### `semanticRole`

Keep for now.

Why:

- slightly awkward, but still metadata-like
- table/header cleanup can revisit this later if needed

#### `reflowKey`

Keep.

Why:

- internal/cache-oriented hint
- not authored structure

#### `keepWithNext`

Keep.

Why:

- cross-cutting pagination behavior
- more like a behavioral directive than structural identity

#### `marginTop`, `marginBottom`

Keep for now.

Why:

- shorthands for local override behavior
- can be thought of as convenience escape hatches layered on top of `style`

#### `pageOverrides`

Keep for now.

Why:

- important, but still override-shaped
- acts on page-template behavior rather than changing what the node is

### 2.3 Defer

These are real candidates for future cleanup, but not yet safe to formalize in
the first `properties` pass.

#### `layout`

Current:

```ts
properties.layout
```

Why defer:

- it is too important to leave forever in `properties`
- but it needs its own design pass first
- story-local float / absolute placement is exactly the kind of area where we
  should not rush a shape change without examples and pressure-testing

Working decision:

- do not bless it as permanent
- do not move it in AST 1.1 without a dedicated design memo

#### `colSpan`, `rowSpan`

Why defer:

- they are structural inside tables
- but tables also benefit strongly from user familiarity
- moving them now may create churn for little real user benefit

Working decision:

- leave them where they are for AST 1.1
- revisit only if a table-specific cleanup becomes worthwhile later

#### `paginationContinuation`

Why defer:

- niche
- operationally important, but not a common authored concern
- could stay internal-ish even if publicly exposed

#### `pageReservationAfter`

Why defer:

- niche and experimental in feel
- not a good anchor for a public cleanup pass yet

---

## 3. Recommended AST 1.1 Scope

The first cleanup pass should stay small and high-confidence.

Recommended scope:

1. Promote:
   - `image`
   - `table`
   - `zones`
   - `strip`
   - `dropCap`
   - `columnSpan`

2. Keep:
   - `style`
   - `sourceId`
   - `linkTarget`
   - `semanticRole`
   - `reflowKey`
   - `keepWithNext`
   - `marginTop`
   - `marginBottom`
   - `pageOverrides`

3. Defer:
   - `layout`
   - `colSpan`
   - `rowSpan`
   - `paginationContinuation`
   - `pageReservationAfter`

This would produce a meaningfully cleaner AST without forcing a large semantic
rewrite.

---

## 4. Compatibility Strategy

AST 1.1 should be a cleanup, not a rupture.

Recommended compatibility model:

- `documentVersion: "1.0"` remains supported
- `documentVersion: "1.1"` adopts the cleaned-up surface
- the normalizer accepts both
- `1.0` lowers into the same normalized shape as `1.1`

That means:

- no urgent ecosystem break
- clear forward direction
- enough honesty to stop treating the old `properties` layout as ideal

---

## 5. Success Standard

This cleanup is successful if:

- authored documents become easier to read
- structural intent is more visible on the node surface
- `properties` becomes smaller and more coherent
- existing layouts remain identical after normalization
- we do not accidentally introduce a broad new layout language in the process

That is the goal:

- cleaner AST
- same output
- less future regret
