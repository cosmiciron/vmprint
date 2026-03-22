# 03. Stories, Strips, And Zones

This is where VMPrint becomes spatial.

The core distinction is:

- `story`: linked flow across columns
- `strip`: one-row aligned composition band
- `zone-map`: independent parallel regions

Quick rule of thumb:

- if the content should stay one reading stream, use `story`
- if the content should line up in one band, use `strip`
- if the content lives in separate rooms, use `zone-map`

## `story`

Use `story` when content should remain one logical flow while moving through multiple columns.

```json
{
  "type": "story",
  "columns": 2,
  "gutter": 14,
  "children": [
    { "type": "body", "content": "Main story copy..." },
    { "type": "body", "content": "More story copy..." }
  ]
}
```

Use `columnSpan` when a full-width interruption should cut across the story:

```json
{
  "type": "section-label",
  "content": "WHAT THIS PAGE IS TESTING",
  "columnSpan": "all"
}
```

## Story Placement

Direct children of a `story` can declare how they participate in the story's
spatial layout through a first-class `placement` field.

Without `placement`, a child is a flow element — it sits in the reading stream
and the text flows around it normally. With `placement`, it becomes a spatial
actor: a float anchored to the text cursor, or an element pinned at a fixed
position within the story area.

### Float

A float is anchored to the position where it appears in the child list. The
text stream flows around it.

```json
{
  "type": "image",
  "image": { "mimeType": "image/png", "data": "...", "fit": "contain" },
  "placement": {
    "mode": "float",
    "align": "right",
    "wrap": "around",
    "gap": 8
  },
  "properties": {
    "style": { "width": 120, "height": 90 }
  }
}
```

`align` controls which margin the float anchors to: `"left"`, `"right"`, or
`"center"`.

`wrap` controls how the text behaves:

| `wrap` | Effect |
|---|---|
| `"around"` | Text snakes around the obstacle on the available side(s) |
| `"top-bottom"` | Text clears the obstacle entirely — no side-by-side text |
| `"none"` | Element overlays the text with no reflow |

`gap` adds clearance around the obstacle bounding box (in points).

Floats are not limited to images. Any story child — a pull quote, a sidebar
note, a box — can be declared as a float. The engine treats it as a spatial
obstacle regardless of content type.

For non-image floats, give the element an explicit `width` and `height` in
`properties.style` so the obstacle geometry is known up front.

### Story-Absolute

A `story-absolute` element is pinned at a fixed offset from the story's own
origin, independent of the text cursor position.

```json
{
  "type": "image",
  "image": { "mimeType": "image/png", "data": "...", "fit": "contain" },
  "placement": {
    "mode": "story-absolute",
    "x": 240,
    "y": 0,
    "wrap": "around",
    "gap": 12
  },
  "properties": {
    "style": { "width": 100, "height": 140 }
  }
}
```

`x` and `y` are offsets from the story's content-area origin (top-left of the
story's first column). The text still respects `wrap` around the element's
bounding box.

Use `story-absolute` when you want an element at a specific visual position
regardless of where the surrounding text happens to be — a decorative image
pinned to the top-right of the story area, for example.

For non-image `story-absolute` elements, provide explicit `width` and `height`
in `properties.style`.

## `strip`

Use `strip` for masthead rows, bylines, folios, and other one-row bands.

```json
{
  "type": "strip",
  "stripLayout": {
    "tracks": [
      { "mode": "flex", "fr": 1 },
      { "mode": "flex", "fr": 1 }
    ],
    "gap": 12
  },
  "slots": [
    {
      "elements": [
        { "type": "byline-left", "content": "By Uzo Z.T." }
      ]
    },
    {
      "elements": [
        { "type": "byline-right", "content": "MARCH 2026 · ISSUE 12" }
      ]
    }
  ]
}
```

Use `strip` when the intent is “one aligned row,” not “tabular data.”

## `zone-map`

Use `zone-map` when the document has genuinely independent regions.

Publicly, `zone-map` is the region tool authors work with.
Internally, the engine lowers it onto a larger continuous world space.
You do not need to author a raw `world-map` directly.

The practical mental model is:

- the engine has a continuous world underneath
- a page is the current viewport onto that world
- `zone-map` places authored regions into that space

So `zone-map` is not just "some columns on a page."
It is an authored region topology that happens to be revealed through pages.

```json
{
  "type": "zone-map",
  "zoneLayout": {
    "columns": [
      { "mode": "flex", "fr": 2 },
      { "mode": "flex", "fr": 1 }
    ],
    "gap": 18,
    "frameOverflow": "move-whole",
    "worldBehavior": "fixed"
  },
  "zones": [
    {
      "id": "main",
      "elements": [
        {
          "type": "story",
          "columns": 2,
          "gutter": 12,
          "children": [
            { "type": "body", "content": "Main editorial flow..." }
          ]
        }
      ]
    },
    {
      "id": "sidebar",
      "elements": [
        { "type": "sidebar-label", "content": "ALSO IN THIS ISSUE" },
        { "type": "sidebar-body", "content": "Secondary content..." }
      ]
    }
  ]
}
```

You can also define explicit zone rectangles when the regions should not line up
as one strip:

```json
{
  "type": "zone-map",
  "zoneLayout": {
    "gap": 18,
    "frameOverflow": "move-whole",
    "worldBehavior": "expandable"
  },
  "zones": [
    {
      "id": "main",
      "region": { "x": 0, "y": 0, "width": 230 },
      "elements": [
        {
          "type": "story",
          "columns": 2,
          "gutter": 12,
          "children": [
            { "type": "body", "content": "Main editorial flow..." }
          ]
        }
      ]
    },
    {
      "id": "sidebar",
      "region": { "x": 248, "y": 56, "width": 124, "height": 180 },
      "elements": [
        { "type": "sidebar-label", "content": "FIELD NOTES" },
        { "type": "sidebar-body", "content": "Lifted or offset side matter..." }
      ]
    }
  ]
}
```

This is the current advanced `zone-map` surface we want authors to use:

- strip-style columns when the regions are aligned
- explicit rectangular `region` bounds when they are not

Here is the practical difference:

- strip-authored `zone-map`: "these regions are aligned as one band"
- explicit `region` rectangles: "these regions are separate rooms in the same field"

### A Good First Explicit-Region Pattern

This is a strong default when you want a main body plus a lifted note field:

```json
{
  "type": "zone-map",
  "zoneLayout": {
    "frameOverflow": "move-whole",
    "worldBehavior": "fixed"
  },
  "zones": [
    {
      "id": "main",
      "region": { "x": 0, "y": 0, "width": 250 },
      "elements": [
        {
          "type": "story",
          "columns": 2,
          "gutter": 12,
          "children": [
            { "type": "body", "content": "Main article flow..." }
          ]
        }
      ]
    },
    {
      "id": "note",
      "region": { "x": 268, "y": 36, "width": 112, "height": 150 },
      "elements": [
        { "type": "sidebar-label", "content": "NOTE" },
        { "type": "sidebar-body", "content": "Short independent side matter..." }
      ]
    }
  ]
}
```

That pattern works well because:

- the main region can remain open-ended
- the note region is clearly bounded
- the visual offset is authored directly instead of being faked with tables or spacing hacks

### `worldBehavior`

`zone-map` now distinguishes three world rules:

- `fixed`
  One local map only. No automatic growth.
- `expandable`
  The region may automatically continue into later local maps.
- `spanning`
  Reserved for future explicit authored multi-map plans.

### Region Notes

- zones do not need to be adjacent
- zones may be vertically offset from one another
- a zone with no `region` still uses the older strip-style solving
- a `region.height` is optional; omit it when the region should remain open-ended
- pages do not own zones; pages only reveal part of the authored region field

### Picking the right construct

- use `story` when the content is one flow
- use `zone-map` when the regions are independent
- use `strip` when the composition is a single aligned row

Common mistake:

- do not use `table` just to place a sidebar next to an article
- do not use `strip` if the regions need independent vertical behavior
- do not use separate unrelated blocks plus spacing hacks when the intent is clearly regional

Next:

- [04-headers-footers-and-page-control.md](04-headers-footers-and-page-control.md)
