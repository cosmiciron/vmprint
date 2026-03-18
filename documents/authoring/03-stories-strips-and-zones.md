# 03. Stories, Strips, And Zones

This is where VMPrint becomes spatial.

The core distinction is:

- `story`: linked flow across columns
- `strip`: one-row aligned composition band
- `zone-map`: independent parallel regions

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

For now, keep thinking in rectangles.
The engine can do more internally than we want to expose all at once.

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

Next:

- [04-headers-footers-and-page-control.md](c:\Users\cosmic\Projects\vmprint\documents\authoring\04-headers-footers-and-page-control.md)
