# VMPrint AST Layout Skill

A practitioner's guide to constructing sophisticated layouts with the VMPrint JSON AST. Use this alongside `AST-REFERENCE.md` (complete property reference) and the regression fixtures in `engine/tests/fixtures/regression/` (working examples for every feature).

---

## 1. Root Structure

Every document is a single JSON object:

```json
{
  "documentVersion": "1.0",
  "layout": { ... },
  "fonts":  { ... },
  "styles": { "myType": { ... } },
  "elements": [ ... ],
  "header": { ... },
  "footer": { ... }
}
```

- `documentVersion` — always `"1.0"`
- `layout` — page geometry and typographic defaults
- `fonts` — optional; only needed for custom font files
- `styles` — maps element `type` strings to base styles; anything not here defaults to layout values
- `elements` — the content tree
- `header` / `footer` — optional running regions

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
| `"story"` | Multi-column DTP zone; carries `columns`, `gutter`, `balance` |
| `"table"` | Table container; must have `properties.table` |
| `"table-row"` | Row inside a table |
| `"table-cell"` | Cell inside a row; supports `colSpan`, `rowSpan` |

All other type strings are user-defined and look up styles only.

Use `"content": ""` (empty string) on container elements. Never omit `content`.

---

## 6. Inline Runs (Rich Text)

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

```json
{
  "type": "image",
  "content": "",
  "properties": {
    "style": {
      "width": 16, "height": 16,
      "verticalAlign": "baseline", "baselineShift": 0,
      "inlineMarginLeft": 1, "inlineMarginRight": 3
    },
    "image": { "data": "<base64>", "mimeType": "image/png", "fit": "contain" }
  }
}
```

`verticalAlign` options: `"baseline"`, `"text-top"`, `"middle"`, `"text-bottom"`, `"bottom"`.

> **GOTCHA**: Do NOT use `\u202f` (narrow no-break space U+202F) in content strings — it is not in most font glyph sets and renders as □. Use a regular space ` ` or omit it.

---

## 7. Story: Multi-Column DTP Layout

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

## 8. Floats and Obstacles

Float elements must be **image elements** (must have `properties.image`). Use a 1×1 placeholder PNG if you want an info box obstacle:

```
data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR42mP48OQMAAVoAqEPT7KoAAAAAElFTkSuQmCC
```

```json
{
  "type": "obstacleImg",
  "content": "",
  "properties": {
    "sourceId": "my-float",
    "image": {
      "data": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR42mP48OQMAAVoAqEPT7KoAAAAAElFTkSuQmCC",
      "mimeType": "image/png",
      "fit": "fill"
    },
    "style": { "width": 78, "height": 50 },
    "layout": { "mode": "float", "align": "left", "wrap": "around", "gap": 10 }
  }
}
```

The float element goes in `story.children`. Exclusion field = `style.width + gap`.

`wrap` options: `"around"` (text wraps both sides), `"top-bottom"` (no side wrap), `"none"`.

> **CRITICAL ORDERING RULE**: If you combine a drop cap paragraph with a float obstacle, the drop cap paragraph MUST be the FIRST child of the story, and the float obstacle MUST come AFTER it. Reversing this causes both to anchor at the same y coordinate (visual overlap).

```json
"children": [
  { "type": "body", "content": "Drop cap paragraph...", "properties": { "dropCap": {...} } },
  { "type": "obstacleImg", ... },
  { "type": "body", "content": "Second paragraph wraps around obstacle..." }
]
```

**Story-absolute positioning** (pins element at exact coordinates within the story):

```json
"properties": {
  "layout": { "mode": "story-absolute", "x": 120, "y": 45, "wrap": "none" }
}
```

---

## 9. Drop Caps

```json
{
  "type": "body",
  "content": "Every element arrived through collision...",
  "properties": {
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
}
```

- `lines` — how many body lines tall the drop cap spans (default 3)
- `characters` — number of leading characters to enlarge (default 1)
- `gap` — horizontal gap in points between cap and body text
- `characterStyle` — overrides only the enlarged character(s)

---

## 10. Tables

```json
{
  "type": "table",
  "content": "",
  "properties": {
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
    }
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
- `semanticRole: "header"` on the row — required to mark the header row
- `repeatHeader: true` — repeats header rows on continuation pages
- `colSpan` and `rowSpan` are on `properties` (not `properties.style`)
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

## 11. Headers and Footers

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
        "type": "table",
        "content": "",
        "properties": {
          "table": {
            "columns": [
              { "mode": "flex", "fr": 1 },
              { "mode": "fixed", "value": 32 },
              { "mode": "flex", "fr": 1 }
            ]
          }
        },
        "children": [{
          "type": "table-row", "content": "",
          "children": [
            { "type": "table-cell", "content": "Left text", "properties": { "style": { "textAlign": "left" } } },
            { "type": "table-cell", "content": "{pageNumber}", "properties": { "style": { "textAlign": "center" } } },
            { "type": "table-cell", "content": "Right text", "properties": { "style": { "textAlign": "right" } } }
          ]
        }]
      }
    ]
  }
}
```

- Selector priority: `firstPage` > `odd`/`even` > `default`
- `firstPage: null` — suppresses header/footer on page 1
- `{pageNumber}` — logical page number (counts only pages where token appears)
- `{physicalPageNumber}` — absolute sheet count
- `headerInsetTop/Bottom`, `footerInsetTop/Bottom` — margin insets in `layout`

**Per-page override on an element**:

```json
{
  "type": "chapter-title",
  "content": "Chapter II",
  "properties": {
    "style": { "pageBreakBefore": true },
    "pageOverrides": {
      "header": { "elements": [ { "type": "rh", "content": "Chapter II" } ] },
      "footer": null
    }
  }
}
```

---

## 12. Multilingual and Scripts

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

Mixed-script inline paragraph (Latin + Arabic + Thai + CJK + Devanagari in one paragraph):

```json
{
  "type": "body",
  "content": "",
  "children": [
    { "type": "text", "content": "Latin baseline, then " },
    {
      "type": "text",
      "content": "مرحباً",
      "properties": { "style": { "fontFamily": "Noto Sans Arabic", "direction": "rtl", "lang": "ar" }}
    },
    { "type": "text", "content": " Arabic, " },
    {
      "type": "text",
      "content": "สวัสดี",
      "properties": { "style": { "fontFamily": "Noto Sans Thai", "lang": "th" }}
    },
    { "type": "text", "content": " Thai, " },
    {
      "type": "text",
      "content": "精確",
      "properties": { "style": { "fontFamily": "Noto Sans JP", "lang": "ja" }}
    },
    { "type": "text", "content": " CJK, " },
    {
      "type": "text",
      "content": "सटीक",
      "properties": { "style": { "fontFamily": "Noto Sans Devanagari", "lang": "hi" }}
    },
    { "type": "text", "content": " Devanagari." }
  ]
}
```

---

## 13. Pagination Control

| Property | Where | Effect |
|----------|-------|--------|
| `pageBreakBefore: true` | `properties.style` | Force page break before this element |
| `keepWithNext: true` | style or `properties` | Keep with the following element (e.g. heading + paragraph) |
| `allowLineSplit: true` | style | Allow paragraph to split across pages at line boundaries |
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

Add `"split-marker"` to your styles table:

```json
"split-marker": {
  "fontSize": 9, "fontStyle": "italic", "color": "#888",
  "borderTopWidth": 1, "borderTopColor": "#ccc",
  "paddingTop": 4, "marginTop": 6, "marginBottom": 6
}
```

---

## 14. Common Layout Patterns

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

### Three-column story with drop cap and float obstacle

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
      "properties": {
        "dropCap": { "enabled": true, "lines": 3, "gap": 5,
          "characterStyle": { "fontFamily": "Tinos", "fontWeight": 700, "color": "#7a3a52" }
        }
      }
    },
    {
      "type": "obstacleImg",
      "content": "",
      "properties": {
        "image": {
          "data": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR42mP48OQMAAVoAqEPT7KoAAAAAElFTkSuQmCC",
          "mimeType": "image/png", "fit": "fill"
        },
        "style": { "width": 78, "height": 50 },
        "layout": { "mode": "float", "align": "left", "wrap": "around", "gap": 10 }
      }
    },
    {
      "type": "body",
      "content": "",
      "children": [
        { "type": "text", "content": "Second paragraph wraps around the float — no " },
        { "type": "text", "content": "iteration",
          "properties": { "style": { "fontStyle": "italic" } }
        },
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
  "properties": {
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
    }
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
    },
    {
      "type": "table-row", "content": "",
      "children": [
        { "type": "table-cell", "content": "story-float" },
        { "type": "table-cell", "content": "box" },
        { "type": "table-cell", "content": "Float obstacle, wrap:around", "properties": { "rowSpan": 2 } },
        { "type": "table-cell", "content": "50, 211" },
        { "type": "table-cell", "content": "78 × 50" }
      ]
    }
  ]
}
```

### Justified body text with advanced hyphenation

```json
"layout": {
  ...
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

## 15. Critical Gotchas

These are hard-won lessons — mistakes that cost hours:

### Float elements must be image elements
Only elements with `properties.image` can be floated (`mode: "float"` or `mode: "story-absolute"`). You cannot float a plain text/body element. Use a 1×1 placeholder PNG if you want a non-image obstacle box.

### Drop cap MUST precede float obstacle
In story children, the drop-cap paragraph must come **before** the float obstacle. If you reverse the order, both elements anchor at the same y position (the story origin), causing visual overlap.

### `color` is not allowed in the `layout` block
The engine validates and rejects `layout.color`. Body text color belongs in `styles["body"].color` or per-element `properties.style.color`. Never put color in the layout config.

### Unicode narrow no-break space (U+202F) renders as □
Avoid `\u202f` in content strings. Fonts commonly lack this glyph. Use a regular ASCII space ` ` instead. Also avoid `\u00a0` (non-breaking space) in contexts where you don't actually need it.

### Adding content to fill empty story columns is safe
Story height = max(column heights). If column 1 is already full (because of content + float obstacle), adding more text to the story just flows into columns 2 and 3 without changing the story height. You can freely add content to fill under-used columns.

### `colSpan`/`rowSpan` are on `properties`, not `properties.style`
```json
{ "type": "table-cell", "content": "Wide", "properties": { "colSpan": 3 } }
```
Putting them under `properties.style` has no effect.

### `repeatHeader` requires `semanticRole: "header"` on the row
```json
{ "type": "table-row", "content": "", "properties": { "semanticRole": "header" }, "children": [...] }
```
Without `semanticRole`, `repeatHeader: true` does nothing.

### Overlay scripts (pdfkit-based) use built-in font names only
If your document uses custom fonts (Arimo, Tinos, Cousine, etc.), the overlay JavaScript context uses **pdfkit** and cannot load these. Use pdfkit's built-in names: `"Helvetica"`, `"Courier"`, `"Times-Roman"`. Calling `ctx.font('Arimo', 12)` will throw `ENOENT`.

### `balance: true` interacts badly with float obstacles
`balance` tries to equalise column heights, but float obstacles create exclusion zones that confuse the balancer. Use `balance: false` (the default) whenever a story contains float elements.

### Page content must fit within `contentHeight`
Always compute: `contentHeight = pageHeight - marginTop - marginBottom`. If your elements' total height (including inter-element margins) exceeds `contentHeight`, content spills to a new page. Use `--emit-layout` to inspect actual box heights and positions before committing to a design.

### `keepWithNext` chains stop working across page boundaries
A chain of `keepWithNext` elements (kicker → title → story) must fit together on a single page. If the combined height exceeds `contentHeight`, the engine breaks the chain: some elements land on the previous page and others on the next. Check that the total height fits before adding keepWithNext.

---

## 16. Workflow: Design → Measure → Adjust

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
layout.pages.length;                       // page count
layout.pages[0].boxes.map(b => ({ type: b.type, y: b.y, h: b.h }));
```

---

## 17. Fixture Index

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
| `08-dropcap-pagination` | Drop caps at page boundaries |
| `09-tables-spans-pagination` | `colSpan`, `rowSpan`, `repeatHeader`, multi-page table |
| `10-packager-split-scenarios` | Split handling edge cases |
| `11-story-image-floats` | Float images in story, `wrap:around` |
| `12-inline-baseline-alignment` | `verticalAlign`, `baselineShift`, inline images |
| `13-inline-rich-objects` | Inline images of various sizes in rich text |
| `14-flow-images-multipage` | Block images across pages |
| `15-story-multi-column` | 3-column story, balance, float obstacles |
| `16-standard-fonts-pdf14` | Standard PDF 1.4 fonts without embedding |
| `17-header-footer-test` | `firstPage/odd/even/default`, `pageOverrides`, `{pageNumber}` |
| `18-multilingual-arabic` | Full Arabic document, RTL, bidirectional |
| `19-accepted-split-branching` | `paginationContinuation`, split markers |

When in doubt, find the closest fixture to your task and study its JSON directly.
