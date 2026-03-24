---
name: vmprint-ast-layout
description: >
  Practitioner's guide for constructing documents with the VMPrint JSON AST 1.1.
  Use when creating or editing vmprint JSON documents. Covers page geometry,
  element types (story, table, zone-map, strip, image), floats, drop caps,
  column spans, headers/footers with strip layouts, multilingual text,
  pagination control, and the document scripting system.
user-invocable: false
---

# VMPrint AST Layout Skill

A practitioner's guide to constructing sophisticated layouts with the VMPrint JSON AST **version 1.1**. Use this alongside the regression fixtures in `engine/tests/fixtures/regression/` and `engine/tests/fixtures/scripting/` (working examples for every feature).

> **AST 1.1 breaking changes from 1.0**: `placement` replaces `properties.layout`; `image`, `dropCap`, `columnSpan`, `table` are now top-level element keys instead of nested inside `properties`.

---

## 1. Root Structure

Every document is a single JSON object:

```json
{
  "documentVersion": "1.1",
  "layout": { ... },
  "fonts":  { ... },
  "styles": { "myType": { ... } },
  "elements": [ ... ],
  "header": { ... },
  "footer": { ... }
}
```

- `documentVersion` — always `"1.1"`
- `layout` — page geometry and typographic defaults
- `fonts` — optional; only needed for custom font files
- `styles` — maps element `type` strings to base styles; anything not here defaults to layout values
- `elements` — the content tree
- `header` / `footer` — optional running regions

Optional scripting keys at root level: `methods`, `scriptVars`, `onBeforeLayout`, `onAfterSettle`.

---

## 2. Page Geometry

```json
"layout": {
  "pageSize": { "width": 720, "height": 405 },
  "orientation": "landscape",
  "margins": { "top": 34, "right": 50, "bottom": 34, "left": 50 },
  "fontFamily": "Arimo",
  "fontSize": 10,
  "lineHeight": 1.35,
  "pageBackground": "#fdf6e3"
}
```

`pageSize` accepts `"A4"`, `"LETTER"`, or `{ "width": N, "height": N }` in points. Standard sizes:

| Name | Points |
|------|--------|
| A4 portrait | 595 × 842 |
| LETTER portrait | 612 × 792 |
| 16:9 landscape | 720 × 405 |

**Content area math** (critical for fitting content on page):

```
contentWidth  = pageWidth  - marginLeft - marginRight
contentHeight = pageHeight - marginTop  - marginBottom
```

For a 720 × 405 page with margins `{top:34, right:50, bottom:34, left:50}`:
- `contentWidth  = 720 - 50 - 50 = 620 pt`
- `contentHeight = 405 - 34 - 34 = 337 pt`

In a 3-column story with gutter 12:
- `columnWidth = (620 - 12 × 2) / 3 = 198.67 pt`

Line height in points = `fontSize × lineHeight`. For 10pt / 1.35: `13.5 pt per line`.

Lines per column = `floor(contentHeight / lineHeightPt)`.

---

## 3. Fonts

Built-in font families available without registration:
`Arimo`, `Tinos`, `Cousine`, `Caladea`, `Carlito`, `Noto Sans JP` (CJK), `Noto Sans Arabic`, `Noto Sans Thai`, `Noto Sans Devanagari`.

Reference a built-in family by name in `fontFamily`; no `fonts` block needed:

```json
"fonts": { "regular": "Arimo" }
```

For custom font files, register by role:

```json
"fonts": {
  "regular":    "path/to/font.ttf",
  "bold":       "path/to/font-bold.ttf",
  "italic":     "path/to/font-italic.ttf",
  "bolditalic": "path/to/font-bolditalic.ttf"
}
```

The engine maps `fontWeight`/`fontStyle` to these slots at render time. For named non-system fonts in inline spans use `fontFamily` on `properties.style` of a `"text"` child.

Standard PDF 1.4 built-in fonts (zero-embed, Latin-only docs via `StandardFontManager`):
`Helvetica`, `Times New Roman`, `Courier` — common aliases like `Arial → Helvetica` resolve automatically.

---

## 4. Styles Table

Every `type` string is a key into `styles`. Style resolution: `styles[element.type]` (base) merged with `properties.style` (override).

```json
"styles": {
  "heading": {
    "fontSize": 22, "fontWeight": "bold",
    "marginBottom": 14, "keepWithNext": true,
    "hyphenation": "off"
  },
  "body": {
    "fontSize": 10, "marginBottom": 10,
    "allowLineSplit": true, "orphans": 2, "widows": 2,
    "textAlign": "justify"
  },
  "kicker": {
    "fontSize": 6.5, "letterSpacing": 1.2, "fontFamily": "Cousine",
    "textAlign": "center", "marginBottom": 9, "keepWithNext": true
  },
  "table-cell": {
    "fontFamily": "Cousine", "fontSize": 7,
    "paddingTop": 3, "paddingBottom": 3, "paddingLeft": 4, "paddingRight": 4
  }
}
```

Any element type you invent is valid — just add it to `styles`.

---

## 5. Block Element Types

```json
{ "type": "heading", "content": "My Title" }
{ "type": "body", "content": "Plain paragraph." }
{ "type": "body", "content": "", "children": [ ... ] }
```

Special structural types handled by the engine:

| `type` | Role |
|--------|------|
| `"story"` | Multi-column DTP zone; carries `columns`, `gutter`, `balance` as top-level keys |
| `"table"` | Table container; optional `table` top-level key for config |
| `"table-row"` | Row inside a table |
| `"table-cell"` | Cell inside a row; supports `colSpan`, `rowSpan` in `properties` |
| `"zone-map"` | Independent-region layout; `zoneLayout` + `zones[]` at top level |
| `"strip"` | Horizontal slot layout; `stripLayout` + `slots[]` at top level |
| `"image"` | Block or inline image; `image` data at top level |

All other type strings are user-defined and look up styles only.

Use `"content": ""` (empty string) on container elements (table, story, zone-map, strip). Container elements and image elements do not require `content` but it's harmless to include it.

---

## 6. Top-Level Element Keys (AST 1.1)

In AST 1.1, several configuration objects moved out of `properties` and became **top-level keys** on the element. This is the most important change from 1.0.

| Key | Element type(s) | Purpose |
|-----|-----------------|---------|
| `content` | all | Text content string |
| `children` | all block | Inline runs or child block elements |
| `name` | any | Scripting target name |
| `type` | all | Element type string |
| `image` | `"image"` | Image data (`data`, `mimeType`, `fit`) |
| `table` | `"table"` | Table config (`headerRows`, `repeatHeader`, `columns`, etc.) |
| `dropCap` | any block | Drop cap config |
| `columnSpan` | story children | `"all"` or number |
| `placement` | story children | Float/absolute placement directive |
| `columns` | `"story"` | Column count |
| `gutter` | `"story"` | Inter-column gap |
| `balance` | `"story"` | Equal-height column balancing |
| `zones` | `"zone-map"` | Array of zone definitions |
| `zoneLayout` | `"zone-map"` | Column sizing + gap config |
| `slots` | `"strip"` | Array of slot definitions |
| `stripLayout` | `"strip"` | Track sizing + gap config |
| `properties` | all | `style`, `sourceId`, `colSpan`, `rowSpan`, `semanticRole`, etc. |

`colSpan` and `rowSpan` remain inside `properties` (not top-level).

---

## 7. Inline Runs (Rich Text)

When a paragraph has mixed styling, use `children` instead of `content`. Set `"content": ""` at the paragraph level.

```json
{
  "type": "body",
  "content": "",
  "children": [
    { "type": "text", "content": "Normal text, then " },
    { "type": "text", "content": "bold", "properties": { "style": { "fontWeight": 700 } } },
    { "type": "text", "content": " and " },
    { "type": "text", "content": "italic", "properties": { "style": { "fontStyle": "italic" } } },
    { "type": "text", "content": " and a " },
    {
      "type": "text",
      "content": "code span",
      "properties": { "style": {
        "fontFamily": "Cousine", "fontSize": 8.2,
        "backgroundColor": "#ecdfc8", "color": "#4a2c0a",
        "paddingLeft": 2, "paddingRight": 2
      }}
    },
    { "type": "text", "content": " and done." }
  ]
}
```

### Inline styles quick-reference

| Effect | Style property |
|--------|---------------|
| Bold | `"fontWeight": 700` or `"bold"` |
| Italic | `"fontStyle": "italic"` |
| Color | `"color": "#rrggbb"` |
| Highlight | `"backgroundColor": "#rrggbb"` |
| Monospace | `"fontFamily": "Cousine"` |
| Larger/smaller | `"fontSize": N` |
| Letter spacing | `"letterSpacing": N` |
| Padding (code span) | `"paddingLeft": N, "paddingRight": N` |

### Inline box (pill / badge)

```json
{
  "type": "inline-box",
  "content": "LATIN",
  "properties": { "style": {
    "fontSize": 6, "fontFamily": "Cousine",
    "backgroundColor": "#e0e8f0", "color": "#2a4a6a",
    "padding": 2,
    "borderWidth": 0.5, "borderColor": "#9ab",
    "borderRadius": 2,
    "verticalAlign": "baseline", "baselineShift": 0,
    "inlineMarginLeft": 2, "inlineMarginRight": 2
  }}
}
```

### Inline image

`image` is a **top-level key** in AST 1.1. Size and alignment go in `properties.style`.

```json
{
  "type": "image",
  "content": "",
  "image": {
    "data": "<base64>",
    "mimeType": "image/png",
    "fit": "contain"
  },
  "properties": {
    "style": {
      "width": 16, "height": 16,
      "verticalAlign": "baseline", "baselineShift": 0,
      "inlineMarginLeft": 1, "inlineMarginRight": 3
    }
  }
}
```

`verticalAlign` options: `"baseline"`, `"text-top"`, `"middle"`, `"text-bottom"`, `"bottom"`.

> **GOTCHA**: Do NOT use `\u202f` (narrow no-break space U+202F) in content strings — it is not in most font glyph sets and renders as □. Use a regular space ` ` or omit it.

---

## 8. Story: Multi-Column DTP Layout

```json
{
  "type": "story",
  "content": "",
  "columns": 3,
  "gutter": 12,
  "balance": false,
  "children": [
    { "type": "body", "content": "Column text flows here..." },
    ...
  ]
}
```

- `columns` — number of columns (default `1`)
- `gutter` — gap between columns in points
- `balance` — if `true`, distributes content evenly across columns (avoid with float obstacles)

**Column flow**: depth-first. Col 1 fills completely before col 2 begins.

**Story height** = height of the tallest column. Adding more text to fill empty columns is safe — it flows into subsequent columns without increasing story height, as long as col 1 is already at max.

**Estimating content fill**:
- Lines per column ≈ `columnHeight / (fontSize × lineHeight)`
- Words per line ≈ `columnWidth / (fontSize × 0.55)` (rough estimate for proportional fonts)
- Use the layout snapshot (`--emit-layout`) to measure actual column heights

---

## 9. Floats and Obstacles

Any block element inside a `story` can be floated using the top-level `placement` key.

**Block floats** — both `properties.style.width` **and** `properties.style.height` are required; if either is missing the element renders as a normal block instead.

```json
{
  "type": "pull-quote",
  "content": "Any block can float — not just images.",
  "placement": {
    "mode": "float",
    "align": "left",
    "wrap": "around",
    "gap": 8
  },
  "properties": {
    "style": { "width": 120, "height": 60 }
  }
}
```

**Image floats** — image elements may omit `width`/`height` and the engine derives them from intrinsic dimensions.

```json
{
  "type": "obstacleImg",
  "content": "",
  "image": {
    "data": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR42mP48OQMAAVoAqEPT7KoAAAAAElFTkSuQmCC",
    "mimeType": "image/png",
    "fit": "fill"
  },
  "placement": {
    "mode": "float",
    "align": "left",
    "wrap": "around",
    "gap": 10
  },
  "properties": {
    "sourceId": "my-float",
    "style": { "width": 78, "height": 50 }
  }
}
```

The float element goes in `story.children`. Exclusion field = `style.width + gap`.

`wrap` options: `"around"` (text wraps both sides), `"top-bottom"` (no side wrap), `"none"`.
`align` options: `"left"`, `"right"`, `"center"`.

> **CRITICAL ORDERING RULE**: If you combine a drop cap paragraph with a float obstacle, the drop cap paragraph MUST be the FIRST child of the story, and the float obstacle MUST come AFTER it. Reversing this causes both to anchor at the same y coordinate (visual overlap).

```json
"children": [
  {
    "type": "body",
    "content": "Drop cap paragraph...",
    "dropCap": { "enabled": true, "lines": 3, "gap": 5,
      "characterStyle": { "fontFamily": "Tinos", "fontWeight": 700, "color": "#7a3a52" }
    }
  },
  {
    "type": "pull-quote",
    "content": "...",
    "placement": { "mode": "float", "align": "left", "wrap": "around", "gap": 8 },
    "properties": { "style": { "width": 120, "height": 60 } }
  },
  { "type": "body", "content": "Second paragraph wraps around obstacle..." }
]
```

**Story-absolute positioning** (pins image element at exact coordinates within the story):

```json
{
  "type": "image",
  "image": { ... },
  "placement": { "mode": "story-absolute", "x": 120, "y": 45, "wrap": "none" }
}
```

**Fixture**: `20-block-floats-and-column-span.json` — block floats alongside column spans in a 3-column story.

---

## 9a. Column Spans

A child of a multi-column `story` can break the column flow and span the full story width using the top-level `columnSpan` key:

```json
{
  "type": "section-heading",
  "content": "Part Two",
  "columnSpan": "all"
}
```

**What happens:**
1. All content above the span element is laid out normally in columns.
2. The spanning element is placed at full story width at the current cursor position.
3. Column flow resets to column 1 at the bottom edge of the span. Subsequent children resume as a fresh N-column arrangement.

`columnSpan` accepts:
- `"all"` — spans every column (recommended).
- A number ≥ 2 — treated as full-width in the current implementation.

> **NOTE**: `columnSpan` interacts with `balance: true`. Use `balance: false` (the default) in stories that contain spanning elements.

**Fixture**: `20-block-floats-and-column-span.json`

---

## 10. Drop Caps

`dropCap` is a **top-level element key** in AST 1.1.

```json
{
  "type": "body",
  "content": "Every element arrived through collision...",
  "dropCap": {
    "enabled": true,
    "lines": 3,
    "gap": 5,
    "characterStyle": {
      "fontFamily": "Tinos",
      "fontWeight": 700,
      "color": "#7a3a52"
    }
  }
}
```

- `lines` — how many body lines tall the drop cap spans (default 3)
- `characters` — number of leading characters to enlarge (default 1)
- `gap` — horizontal gap in points between cap and body text
- `characterStyle` — overrides only the enlarged character(s)

---

## 11. Tables

`table` config is a **top-level element key** in AST 1.1. A `table` element without it uses defaults.

```json
{
  "type": "table",
  "content": "",
  "table": {
    "headerRows": 1,
    "repeatHeader": true,
    "columnGap": 6,
    "rowGap": 0,
    "columns": [
      { "mode": "fixed", "value": 80 },
      { "mode": "flex", "fr": 2, "min": 60 },
      { "mode": "flex", "fr": 1 }
    ],
    "cellStyle": { "fontFamily": "Cousine", "fontSize": 7, "paddingLeft": 4 },
    "headerCellStyle": { "fontWeight": 700, "fontSize": 7, "color": "#fff", "backgroundColor": "#444" }
  },
  "children": [
    {
      "type": "table-row",
      "content": "",
      "properties": { "semanticRole": "header" },
      "children": [
        { "type": "table-cell", "content": "Name" },
        { "type": "table-cell", "content": "Description" },
        { "type": "table-cell", "content": "Value" }
      ]
    },
    {
      "type": "table-row",
      "content": "",
      "children": [
        { "type": "table-cell", "content": "Alice", "properties": { "rowSpan": 2 } },
        { "type": "table-cell", "content": "Section header", "properties": { "colSpan": 2 } }
      ]
    },
    {
      "type": "table-row",
      "content": "",
      "children": [
        { "type": "table-cell", "content": "Detail" },
        { "type": "table-cell", "content": "42" }
      ]
    }
  ]
}
```

Key details:
- `semanticRole: "header"` on the row — required to mark the header row (in `properties`)
- `repeatHeader: true` — repeats header rows on continuation pages
- `colSpan` and `rowSpan` are in `properties` (not top-level, not `properties.style`)
- Column `mode`: `"fixed"` (exact `value` pt), `"flex"` (fractional share via `fr`), `"auto"` (size to content)
- Table cells can have `children` (inline runs) instead of `content`, same as paragraphs

**Section rows** (full-width label row spanning all columns):

```json
{
  "type": "table-row",
  "content": "",
  "children": [
    {
      "type": "table-cell",
      "content": "SECTION HEADER",
      "properties": {
        "colSpan": 5,
        "style": { "backgroundColor": "#3a2a2a", "color": "#fff", "fontWeight": 700 }
      }
    }
  ]
}
```

---

## 12. Zone Map: Independent Layout Regions

A `zone-map` divides a horizontal strip of the page into independent layout columns. Each zone runs its own non-paginating layout pass — content in zone A has no knowledge of zone B. The `zone-map` always moves to the next page as a unit if it does not fit.

`zones` and `zoneLayout` are **top-level element keys**.

### Two-column sidebar

```json
{
  "type": "zone-map",
  "properties": {
    "style": { "marginTop": 12, "marginBottom": 12 }
  },
  "zones": [
    {
      "id": "main",
      "elements": [
        { "type": "h2", "content": "Main Content" },
        { "type": "p",  "content": "Body text." }
      ]
    },
    {
      "id": "sidebar",
      "elements": [
        { "type": "sidebar-label", "content": "KEY FACT" },
        { "type": "sidebar-body",  "content": "Sidebar note." }
      ]
    }
  ],
  "zoneLayout": {
    "columns": [
      { "mode": "flex", "fr": 2 },
      { "mode": "flex", "fr": 1 }
    ],
    "gap": 16
  }
}
```

- `zones[]` — region descriptors. Each carries `id` (optional) and `elements[]`.
- `zoneLayout.columns` — track sizing array (same `mode`/`fr`/`value` as tables). Omit for equal-width columns.
- `zoneLayout.gap` — gap between columns in points (default `0`).
- Zone height: the tallest zone determines the `zone-map`'s height in the document flow.

### Equal three-column strip

```json
{
  "type": "zone-map",
  "zones": [
    { "id": "a", "elements": [ { "type": "p", "content": "Col 1" } ] },
    { "id": "b", "elements": [ { "type": "p", "content": "Col 2" } ] },
    { "id": "c", "elements": [ { "type": "p", "content": "Col 3" } ] }
  ],
  "zoneLayout": { "gap": 12 }
}
```

When `columns` is omitted, all zones receive equal width.

**Zone-map vs story**: Use `story` when the same content flow snakes across columns. Use `zone-map` when each column has independent content (e.g. a sidebar, a three-fact strip).

**Fixture**: `21-zone-map-sidebar.json`

---

## 13. Strip: Horizontal Slot Layout

A `strip` divides a row into horizontally-sized slots with independent layout contexts. Ideal for header/footer composition (logo + title, three-part folio). `slots` and `stripLayout` are **top-level element keys**.

```json
{
  "type": "strip",
  "stripLayout": {
    "tracks": [
      { "mode": "fixed", "value": 16 },
      { "mode": "flex", "fr": 1 }
    ],
    "gap": 8
  },
  "slots": [
    {
      "id": "logo",
      "elements": [
        {
          "type": "image",
          "image": { "mimeType": "image/png", "fit": "contain", "data": "<base64>" },
          "properties": { "style": { "width": 12, "height": 12, "marginBottom": 0 } }
        }
      ]
    },
    {
      "id": "title",
      "elements": [
        { "type": "rh-odd", "content": "Chapter Title" }
      ]
    }
  ]
}
```

- `stripLayout.tracks` — array of column sizing objects (same `mode`/`fr`/`value` as tables)
- `stripLayout.gap` — inter-slot gap in points
- `slots[]` — each carries `id` (optional) and `elements[]`
- Each slot is an independent layout context; content does not flow between slots

**Three-part footer folio**:

```json
{
  "type": "strip",
  "stripLayout": {
    "tracks": [
      { "mode": "flex", "fr": 1 },
      { "mode": "fixed", "value": 86 },
      { "mode": "flex", "fr": 1 }
    ],
    "gap": 8
  },
  "slots": [
    { "id": "left",   "elements": [ { "type": "folio-left",  "content": "Book Title" } ] },
    { "id": "center", "elements": [ { "type": "folio-page",  "content": "Page {pageNumber} of {totalPages}" } ] },
    { "id": "right",  "elements": [ { "type": "folio-right", "content": "Chapter Name" } ] }
  ]
}
```

**Fixture**: `17-header-footer-test.json` — strips in headers/footers with logo + title

---

## 14. Headers and Footers

```json
"header": {
  "firstPage": null,
  "odd": {
    "elements": [
      { "type": "rh-odd", "content": "Chapter Title" }
    ]
  },
  "even": {
    "elements": [
      { "type": "rh-even", "content": "Book Title" }
    ]
  }
},
"footer": {
  "firstPage": null,
  "default": {
    "elements": [
      {
        "type": "strip",
        "stripLayout": {
          "tracks": [
            { "mode": "flex", "fr": 1 },
            { "mode": "fixed", "value": 32 },
            { "mode": "flex", "fr": 1 }
          ]
        },
        "slots": [
          { "id": "left",   "elements": [ { "type": "folio-left",  "content": "Left text" } ] },
          { "id": "center", "elements": [ { "type": "folio-page",  "content": "{pageNumber}" } ] },
          { "id": "right",  "elements": [ { "type": "folio-right", "content": "Right text" } ] }
        ]
      }
    ]
  }
}
```

- Selector priority: `firstPage` > `odd`/`even` > `default`
- `firstPage: null` — suppresses header/footer on page 1
- `{pageNumber}` — logical page number (counts only pages where token appears)
- `{physicalPageNumber}` — absolute sheet count
- `{totalPages}` — total physical page count (resolved after pagination settles)
- `headerInsetTop/Bottom`, `footerInsetTop/Bottom` — margin insets in `layout`

**Per-page override on an element**:

```json
{
  "type": "chapter-title",
  "content": "Chapter II",
  "properties": {
    "style": { "pageBreakBefore": true },
    "pageOverrides": {
      "header": {
        "elements": [
          {
            "type": "strip",
            "stripLayout": { "tracks": [ { "mode": "fixed", "value": 16 }, { "mode": "flex", "fr": 1 } ], "gap": 8 },
            "slots": [
              { "id": "logo",  "elements": [ { "type": "image", "image": { "mimeType": "image/png", "fit": "contain", "data": "..." }, "properties": { "style": { "width": 12, "height": 12 } } } ] },
              { "id": "title", "elements": [ { "type": "rh-odd", "content": "Chapter II" } ] }
            ]
          }
        ]
      },
      "footer": null
    }
  }
}
```

Override applies only to the first page the element lands on. Setting a region to `null` suppresses it for that page.

---

## 15. Multilingual and Scripts

Enable optical scaling in `layout`:

```json
"opticalScaling": {
  "enabled": true,
  "cjk": 0.88,
  "thai": 0.92,
  "devanagari": 0.95,
  "arabic": 0.92
}
```

For RTL text, set `direction` and `lang` on the element:

```json
{
  "type": "text",
  "content": "مرحباً بالعالم",
  "properties": { "style": {
    "fontFamily": "Noto Sans Arabic",
    "direction": "rtl",
    "lang": "ar"
  }}
}
```

Mixed-script inline paragraph:

```json
{
  "type": "body",
  "content": "",
  "children": [
    { "type": "text", "content": "Latin baseline, then " },
    { "type": "text", "content": "مرحباً", "properties": { "style": { "fontFamily": "Noto Sans Arabic", "direction": "rtl", "lang": "ar" }}},
    { "type": "text", "content": " Arabic, " },
    { "type": "text", "content": "สวัสดี", "properties": { "style": { "fontFamily": "Noto Sans Thai", "lang": "th" }}},
    { "type": "text", "content": " Thai, " },
    { "type": "text", "content": "精確", "properties": { "style": { "fontFamily": "Noto Sans JP", "lang": "ja" }}},
    { "type": "text", "content": " CJK." }
  ]
}
```

---

## 16. Pagination Control

| Property | Where | Effect |
|----------|-------|--------|
| `pageBreakBefore: true` | `properties.style` | Force page break before this element |
| `keepWithNext: true` | style or `properties` | Keep with the following element |
| `allowLineSplit: true` | style | Allow paragraph to split across pages |
| `orphans: 2` | style | Min lines at bottom before split |
| `widows: 2` | style | Min lines at top of continuation |
| `overflowPolicy` | style | `"clip"`, `"move-whole"`, or `"error"` |

Standard paragraph boilerplate:

```json
"body": {
  "marginBottom": 10,
  "allowLineSplit": true,
  "orphans": 2,
  "widows": 2,
  "textAlign": "justify"
}
```

**Continuation markers** (annotate where a paragraph was split):

```json
{
  "type": "p",
  "content": "A very long paragraph...",
  "properties": {
    "paginationContinuation": {
      "enabled": true,
      "markerAfterSplit": {
        "type": "split-marker",
        "content": "Continued on next page"
      },
      "markerBeforeContinuation": {
        "type": "split-marker",
        "content": "Continued from previous page"
      }
    }
  }
}
```

---

## 17. Document Scripting

Scripts are defined as YAML frontmatter before the JSON body. The format is a single file: YAML front matter (between `---` lines) followed by the JSON document.

### File format

```
---
TITLE: "My Value"
methods:
  onLoad(): |
    setContent("greeting", TITLE)
  summary_onMessage(from, msg): |
    setContent(self, `Received: ${msg.payload.text}`)
  greeter_onCreate(): |
    sendMessage("summary", { subject: "greet", payload: { text: "Hello!" } })
  onReady(): |
    const count = elementsByType("h1").length
    deleteElement("placeholder")
---
{
  "documentVersion": "1.1",
  ...
  "elements": [
    { "type": "p", "name": "greeting",    "content": "Waiting..." },
    { "type": "p", "name": "summary",     "content": "Waiting..." },
    { "type": "p", "name": "greeter",     "content": "Sender." },
    { "type": "p", "name": "placeholder", "content": "Will be deleted." }
  ]
}
```

### Lifecycle hooks

| Method name | When | Context |
|-------------|------|---------|
| `onLoad()` | Before any layout | Document-level |
| `elementName_onCreate()` | When element is first created | Actor (self = element) |
| `onBeforeLayout()` | Before layout settlement | Document-level |
| `onChanged()` | After any DOM mutation triggers relayout | Document-level |
| `onReady()` | After layout fully settles | Document-level |
| `elementName_onMessage(from, msg)` | When element receives a message | Actor (self = element) |

### Scripting API

```javascript
// Read
doc.getPageCount()              // settled page count
elementsByType("h1")            // array of elements by type
element("myName")               // element by name (or null)
self                            // current actor element (in actor hooks)
self.content                    // element's current content

// Write content
setContent("targetName", text)  // or: setContent(self, text)

// Structural mutations (actor-local, from within _onMessage or _onCreate)
replace([...elements])          // replace self with new elements
append({ ...element })          // append after self
prepend({ ...element })         // prepend before self

// Document-level mutations (from onReady / onLoad)
replaceElement("name", [...elements])  // replace named element with array
deleteElement("name")                  // delete named element

// Messaging
sendMessage("targetName", { subject: "greet", payload: { ... } })
```

Elements in scripts use **JavaScript object syntax** (no quotes on keys), same structure as JSON elements. Elements can be named with `name:` for scripting targets:

```json
{ "type": "p", "name": "myTarget", "content": "Initial text." }
```

### Example: page count summary

```
---
methods:
  onReady(): |
    const pages = doc.getPageCount()
    const headings = elementsByType("h1")
    sendMessage("summary", {
      subject: "ready",
      payload: { pages, headingCount: headings.length }
    })
  summary_onMessage(from, msg): |
    if (from.name !== "doc") return
    setContent(self, `${msg.payload.pages} pages, ${msg.payload.headingCount} headings.`)
---
{ "documentVersion": "1.1", ... }
```

**Fixtures**: `scripting/00-hello-world.json`, `scripting/01-message-growth.json`, `scripting/02-ready-summary.json`, `scripting/04-replace-showcase.json`, `scripting/07-live-delete-showcase.json`

---

## 18. Common Layout Patterns

### Kicker + Title + Story (DTP opener)

```json
[
  {
    "type": "kicker",
    "content": "SPECIMEN BLUEPRINT  ·  ENGINE REPORT",
    "properties": { "keepWithNext": true }
  },
  {
    "type": "pageTitle",
    "content": "Measured in Points",
    "properties": { "keepWithNext": true }
  },
  {
    "type": "story",
    "content": "",
    "columns": 3,
    "gutter": 12,
    "children": [ ... ]
  }
]
```

### Three-column story with drop cap and block float

```json
{
  "type": "story",
  "content": "",
  "columns": 3,
  "gutter": 12,
  "children": [
    {
      "type": "body",
      "content": "Drop-cap paragraph text...",
      "dropCap": {
        "enabled": true, "lines": 3, "gap": 5,
        "characterStyle": { "fontFamily": "Tinos", "fontWeight": 700, "color": "#7a3a52" }
      }
    },
    {
      "type": "pull-quote",
      "content": "Any block element can float — no image required.",
      "placement": { "mode": "float", "align": "left", "wrap": "around", "gap": 10 },
      "properties": { "style": { "width": 78, "height": 50 } }
    },
    {
      "type": "body",
      "content": "",
      "children": [
        { "type": "text", "content": "Second paragraph wraps around the float — no " },
        { "type": "text", "content": "iteration", "properties": { "style": { "fontStyle": "italic" } } },
        { "type": "text", "content": ", no backtracking." }
      ]
    }
  ]
}
```

### Cross-page table with repeated header and merged cells

```json
{
  "type": "table",
  "content": "",
  "table": {
    "headerRows": 1,
    "repeatHeader": true,
    "columnGap": 6,
    "columns": [
      { "mode": "flex", "fr": 1 },
      { "mode": "flex", "fr": 1 },
      { "mode": "flex", "fr": 2 },
      { "mode": "fixed", "value": 60 },
      { "mode": "fixed", "value": 60 }
    ]
  },
  "children": [
    {
      "type": "table-row", "content": "",
      "properties": { "semanticRole": "header" },
      "children": [
        { "type": "table-cell", "content": "ID" },
        { "type": "table-cell", "content": "Type" },
        { "type": "table-cell", "content": "Description" },
        { "type": "table-cell", "content": "Origin" },
        { "type": "table-cell", "content": "Size" }
      ]
    },
    {
      "type": "table-row", "content": "",
      "children": [
        { "type": "table-cell", "content": "§1", "properties": { "colSpan": 5,
          "style": { "backgroundColor": "#3a2a2a", "color": "#fdf6e3", "fontWeight": 700 }
        }}
      ]
    }
  ]
}
```

### Justified body text with advanced hyphenation

```json
"layout": {
  "hyphenation": "auto",
  "justifyEngine": "advanced",
  "justifyStrategy": "auto"
}
```

```json
"styles": {
  "body": {
    "textAlign": "justify",
    "allowLineSplit": true,
    "orphans": 2,
    "widows": 2,
    "hyphenation": "auto",
    "hyphenMinWordLength": 6,
    "hyphenMinPrefix": 3,
    "hyphenMinSuffix": 3
  }
}
```

---

## 19. Critical Gotchas

### `documentVersion` must be `"1.1"`
The engine validates this field. Using `"1.0"` with AST 1.1 features will fail.

### `image`, `table`, `dropCap`, `columnSpan`, `placement` are top-level keys in 1.1
These are NOT nested inside `properties` in AST 1.1. This is the most common migration mistake from 1.0.

```json
// WRONG (old 1.0 style):
{ "type": "image", "properties": { "image": { ... }, "style": { ... } } }

// CORRECT (1.1 style):
{ "type": "image", "image": { ... }, "properties": { "style": { ... } } }
```

### Block floats require explicit `style.width` and `style.height`
Non-image block floats **must** declare both in `properties.style`. If either is missing, the element silently falls through to normal block layout. Image floats can omit them.

### Drop cap MUST precede float obstacle
In story children, the drop-cap paragraph must come **before** the float obstacle. If you reverse the order, both anchor at the same y position causing visual overlap.

### `color` is not allowed in the `layout` block
The engine rejects `layout.color`. Body text color belongs in `styles["body"].color` or per-element `properties.style.color`.

### Unicode narrow no-break space (U+202F) renders as □
Avoid `\u202f` in content strings. Use a regular ASCII space ` ` instead.

### `colSpan`/`rowSpan` are in `properties`, not top-level
```json
{ "type": "table-cell", "content": "Wide", "properties": { "colSpan": 3 } }
```
Putting them under `properties.style` has no effect.

### `repeatHeader` requires `semanticRole: "header"` on the row
```json
{ "type": "table-row", "content": "", "properties": { "semanticRole": "header" }, "children": [...] }
```
Without `semanticRole`, `repeatHeader: true` does nothing.

### `balance: true` interacts badly with float obstacles
Use `balance: false` (the default) whenever a story contains float elements.

### `columnSpan` interacts with `balance: true`
Use `balance: false` in stories that contain spanning elements.

### `columnSpan` must NOT appear in the `styles` block
`columnSpan` is a top-level element key, not a style property. Place it on the element itself, never inside a style definition.

### Header/footer selectors must wrap elements in `{ "elements": [...] }`
The value of each selector (`default`, `odd`, `even`, `firstPage`) must be an object with an `elements` array — not the element directly:
```json
// WRONG:
"header": { "default": { "type": "strip", "slots": [...] } }
// CORRECT:
"header": { "default": { "elements": [ { "type": "strip", "slots": [...] } ] } }
```

### Use `keepWithNext: true` on `columnSpan` elements that introduce content
If a spanning banner lands near the bottom of a page with little room below it, the reset columns overflow to the next page — leaving the banner visually isolated. Add `"keepWithNext": true` to `properties` to prevent this: the engine measures whether the next flow child fits after the span and, if not, pushes the span to the next page.

```json
{
  "type": "section-flag",
  "content": "WORLD & NATION",
  "columnSpan": "all",
  "properties": { "keepWithNext": true }
}
```

For a banner that *opens* a new story with nothing before it, placing it outside the story as a standalone element is also valid and needs no `columnSpan`:
```json
{ "type": "section-flag", "content": "WORLD & NATION" },
{ "type": "story", "columns": 3, "children": [ ... ] }
```

### `keepWithNext` chains stop working across page boundaries
A chain of `keepWithNext` elements must fit together on a single page. Check that the total height fits `contentHeight`.

### Page content must fit within `contentHeight`
Always compute: `contentHeight = pageHeight - marginTop - marginBottom`. Use `--emit-layout` to inspect actual box heights.

### Scripts use YAML frontmatter; plain JSON cannot have scripts
If you need scripting, the file must be in the `---\n<yaml>\n---\n<json>` format. Pure JSON files cannot contain scripts.

### Actor mutations (`replace`, `append`, `prepend`) are actor-local
These only work from within `_onMessage` or `_onCreate` handlers. For document-level mutations use `replaceElement` and `deleteElement` from `onReady`.

### Adding content to fill empty story columns is safe
Story height = max(column heights). If column 1 is already full, adding more text to the story just flows into columns 2 and 3 without changing the story height.

---

## 20. Workflow: Design → Measure → Adjust

1. **Sketch the layout** — list elements, estimate column count and content volume
2. **Compute geometry** — `contentWidth`, `columnWidth`, `linesPerColumn`, word count targets
3. **Write the JSON** — start with `layout`, then `styles`, then `elements`
4. **Render with layout emit**:
   ```
   node cli/dist/index.js -i doc.json -o doc.pdf --emit-layout doc.layout.json
   ```
5. **Inspect the layout JSON** — check `pages.length`, box `y` and `h` values per page
6. **Adjust** — trim or expand content, adjust margins, tweak styles
7. **Iterate** — re-render, re-inspect until correct page count and visual balance

Key layout JSON fields to check:
```js
const layout = require('./doc.layout.json');
layout.pages.length;
layout.pages[0].boxes.map(b => ({ type: b.type, y: b.y, h: b.h }));
```

---

## 21. Fixture Index

### Regression fixtures (`engine/tests/fixtures/regression/`)

| Fixture | Demonstrates |
|---------|-------------|
| `00-all-capabilities` | Everything: CJK, inline styles, images, tables, story |
| `01-text-flow-core` | Basic paragraphs, flow, orphan/widow |
| `02-text-layout-advanced` | Advanced text layout, drop caps, page flow |
| `03-typography-type-specimen` | Font weight/size/style spectrum |
| `04-multilingual-scripts` | RTL, Thai, Devanagari, CJK in flow |
| `05-page-size-letter-landscape` | LETTER landscape, 2-column story |
| `06-page-size-custom-landscape` | Custom `{width, height}` page size |
| `07-pagination-fragments` | Large content spanning many pages |
| `08-dropcap-pagination` | Drop caps at page boundaries (top-level `dropCap`) |
| `09-tables-spans-pagination` | `colSpan`, `rowSpan`, `repeatHeader`, multi-page table |
| `10-packager-split-scenarios` | Split handling edge cases, top-level `table` config |
| `11-story-image-floats` | Float images in story, `wrap:around` |
| `12-inline-baseline-alignment` | `verticalAlign`, `baselineShift`, inline images (top-level `image`) |
| `13-inline-rich-objects` | Inline images of various sizes in rich text |
| `14-flow-images-multipage` | Block images across pages |
| `15-story-multi-column` | 3-column story, balance, float obstacles |
| `16-standard-fonts-pdf14` | Standard PDF 1.4 fonts without embedding |
| `17-header-footer-test` | `firstPage/odd/even/default`, `pageOverrides`, `{pageNumber}`, `{totalPages}`, strips |
| `18-multilingual-arabic` | Full Arabic document, RTL, bidirectional |
| `19-accepted-split-branching` | `paginationContinuation`, split markers |
| `20-block-floats-and-column-span` | Block floats with `placement`, `columnSpan: "all"` |
| `21-zone-map-sidebar` | Zone map: 70/30 flex split and equal three-column strip |

### Scripting fixtures (`engine/tests/fixtures/scripting/`)

| Fixture | Demonstrates |
|---------|-------------|
| `00-hello-world` | `onLoad()`, `setContent()`, YAML vars |
| `01-message-growth` | `_onCreate()`, `sendMessage`, `_onMessage`, `append()` |
| `02-ready-summary` | `onReady()`, `elementsByType()`, `doc.getPageCount()` |
| `04-replace-showcase` | `replaceElement()`, `onChanged()`, `element()` |
| `05-live-replace-message` | Actor-local `replace()` from `_onMessage` |
| `06-live-insert-message` | Actor-local `prepend()` + `append()` from `_onMessage` |
| `07-live-delete-showcase` | `deleteElement()` from `onReady()` |

When in doubt, find the closest fixture to your task and study its JSON directly.
