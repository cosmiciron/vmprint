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

Use `zone-map` when the page has genuinely independent regions.

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

### `worldBehavior`

`zone-map` now distinguishes three world rules:

- `fixed`
  One local map only. No automatic growth.
- `expandable`
  The region may automatically continue into later local maps.
- `spanning`
  Reserved for future explicit authored multi-map plans.

### Picking the right construct

- use `story` when the content is one flow
- use `zone-map` when the regions are independent
- use `strip` when the composition is a single aligned row

Next:

- [04-headers-footers-and-page-control.md](c:\Users\cosmic\Projects\vmprint\documents\authoring\04-headers-footers-and-page-control.md)
