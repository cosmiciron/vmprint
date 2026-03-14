# VMPrint AST Reference

This document is the complete reference for the **VMPrint document input format** — the JSON/object tree you construct and pass to the layout engine. It covers every supported node type, property, style field, and configuration option.

---

## 1. Pipeline Overview

```
Markdown string
  → [remark / semantic.ts]
SemanticDocument                (draft2final intermediate layer)
  → [FormatHandler / FormatContext]
DocumentInput / Element tree    ← you work here
  → [LayoutEngine]
Page[] of Box[]                 (flat, positioned output — not authored)
```

Direct callers always construct **`DocumentInput`**. The `SemanticDocument` layer is only relevant when using `draft2final`.

---

## 2. `DocumentInput` — Root Object

```typescript
interface DocumentInput {
    documentVersion: '1.0';
    layout: LayoutConfig;
    fonts?: FontSources;
    styles: Partial<Record<string, ElementStyle>>;
    elements: Element[];
    header?: PageRegionDefinition;
    footer?: PageRegionDefinition;
    debug?: boolean;
}
```

| Field | Required | Description |
|---|---|---|
| `documentVersion` | yes | Always `"1.0"` |
| `layout` | yes | Page geometry, default typography — see §3 |
| `fonts` | no | Font file sources keyed by weight/style — see §4 |
| `styles` | yes | Named style table; keys are element `type` strings |
| `elements` | yes | Top-level content elements |
| `header` | no | Running page header — see §12 |
| `footer` | no | Running page footer — see §12 |
| `debug` | no | Enable engine debug output |

---

## 3. `LayoutConfig` — Page Layout Settings

All numeric values are in **points** unless noted.

```typescript
interface LayoutConfig {
    pageSize: 'A4' | 'LETTER' | { width: number; height: number };
    orientation?: 'portrait' | 'landscape';
    margins: { top: number; right: number; bottom: number; left: number };
    fontFamily: string;
    fontSize: number;
    lineHeight: number;

    pageBackground?: string;

    // Header/footer inset distances from the page edge
    headerInsetTop?: number;
    headerInsetBottom?: number;
    footerInsetTop?: number;
    footerInsetBottom?: number;

    pageNumberStart?: number;

    // Internationalisation defaults
    lang?: string;
    direction?: 'ltr' | 'rtl' | 'auto';
    hyphenation?: 'off' | 'auto' | 'soft';
    hyphenateCaps?: boolean;
    hyphenMinWordLength?: number;
    hyphenMinPrefix?: number;
    hyphenMinSuffix?: number;
    justifyEngine?: 'legacy' | 'advanced';
    justifyStrategy?: 'auto' | 'space' | 'inter-character';

    // Per-script optical scaling (multiplier, e.g. 0.88 for CJK)
    opticalScaling?: {
        enabled?: boolean;
        cjk?: number;
        korean?: number;
        thai?: number;
        devanagari?: number;
        arabic?: number;
        cyrillic?: number;
        latin?: number;
        default?: number;
    };

    storyWrapOpticalUnderhang?: boolean;
}
```

---

## 4. Font Sources

```typescript
interface FontSources {
    regular?: string;
    bold?: string;
    italic?: string;
    bolditalic?: string;
    [key: string]: string | undefined;
}
```

Values are file paths or embedded data URLs. The engine maps `fontWeight`/`fontStyle` combinations to the correct key at render time.

---

## 5. `Element` — Core AST Node

```typescript
interface Element {
    type: string;
    content: string;
    children?: Element[];
    columns?: number;
    gutter?: number;
    balance?: boolean;
    properties?: ElementProperties;
}
```

| Field | Description |
|---|---|
| `type` | Identifies the element. Used to look up the base style from `styles`. Open string — not an enum. |
| `content` | Flat text for leaf nodes. Use an empty string `""` for containers. |
| `children` | Sub-elements (structural children) or inline runs. Mutually exclusive with a populated `content`. |
| `columns` | **`story` only.** Number of columns (default `1`). |
| `gutter` | **`story` only.** Inter-column gap in points. |
| `balance` | **`story` only.** Balance column heights (CSS `column-fill: balance` semantics). |
| `properties` | Per-element overrides — see §6. |

**Style resolution order:** `styles[element.type]` (base) → `properties.style` (override).

---

## 6. `ElementProperties` — Per-Element Properties

```typescript
interface ElementProperties {
    style?: Partial<ElementStyle>;

    image?: EmbeddedImagePayload;
    table?: TableLayoutOptions;
    colSpan?: number;
    rowSpan?: number;

    sourceId?: string;
    linkTarget?: string;
    semanticRole?: string;
    dropCap?: DropCapSpec;
    layout?: StoryLayoutDirective;
    reflowKey?: string;

    keepWithNext?: boolean;
    marginTop?: number;
    marginBottom?: number;

    simulationContinuation?: SimulationContinuationSpec;
    pageOverrides?: {
        header?: PageRegionContent | null;
        footer?: PageRegionContent | null;
    };

    // Provenance (set by draft2final, ignored by engine)
    sourceRange?: { lineStart: number; colStart: number; lineEnd: number; colEnd: number };
    sourceSyntax?: string;
    language?: string;
}
```

| Property | Applies to | Description |
|---|---|---|
| `style` | any | Inline style overrides (§7). |
| `image` | `"image"`, block images | Image payload — see §9. |
| `table` | `"table"` | Table layout options — see §10. |
| `colSpan` | `"table-cell"` | Number of columns this cell spans. |
| `rowSpan` | `"table-cell"` | Number of rows this cell spans. |
| `sourceId` | any | Caller-assigned stable ID surfaced in `BoxMeta`. |
| `linkTarget` | inline `"text"`, `"inline"` | Hyperlink URL. |
| `semanticRole` | `"table-row"` | `"header"` marks the row as a header row. |
| `dropCap` | paragraph-like | Drop-cap configuration — see §11. |
| `layout` | children of `"story"` | Float / absolute positioning — see §12. |
| `reflowKey` | any | Explicit cache key for the reflow cache. |
| `keepWithNext` | any | Keep this element on the same page as the one after it. |
| `marginTop` | any | Top margin shorthand override (points). |
| `marginBottom` | any | Bottom margin shorthand override (points). |
| `simulationContinuation` | any | Cross-page split markers — see §14. |
| `pageOverrides` | any | Override or suppress the header/footer for this element's pages. Set to `null` to suppress. |
| `language` | code blocks | Language hint (e.g. `"typescript"`). |

---

## 7. `ElementStyle` — Complete Style Properties

All numeric values are in **points** unless noted. All fields are optional.

### Typography

| Property | Type | Description |
|---|---|---|
| `fontFamily` | `string` | Font family name. |
| `fontSize` | `number` | Font size in points. |
| `fontWeight` | `number \| string` | e.g. `400`, `700`, `"bold"`. |
| `fontStyle` | `string` | `"normal"` or `"italic"`. |
| `textAlign` | `'left' \| 'right' \| 'center' \| 'justify'` | Horizontal alignment. |
| `letterSpacing` | `number` | Extra space between characters in points. |
| `lineHeight` | `number` | Line-height multiplier (e.g. `1.5`). |
| `textIndent` | `number` | First-line indent in points. |
| `color` | `string` | Text color (CSS hex or named). |
| `opacity` | `number` | Opacity `0`–`1`. |

### Internationalisation

| Property | Type | Description |
|---|---|---|
| `lang` | `string` | BCP 47 language tag (e.g. `"en"`, `"ar"`, `"ja"`). |
| `direction` | `'ltr' \| 'rtl' \| 'auto'` | Text direction. |
| `hyphenation` | `'off' \| 'auto' \| 'soft'` | Hyphenation mode. `"soft"` respects only soft-hyphen characters. |
| `hyphenateCaps` | `boolean` | Allow hyphenation of all-caps words. |
| `hyphenMinWordLength` | `number` | Minimum word length to hyphenate. |
| `hyphenMinPrefix` | `number` | Minimum characters before hyphenation point. |
| `hyphenMinSuffix` | `number` | Minimum characters after hyphenation point. |
| `justifyEngine` | `'legacy' \| 'advanced'` | Justification algorithm. |
| `justifyStrategy` | `'auto' \| 'space' \| 'inter-character'` | Where extra space is distributed when justifying. |

### Box Model

| Property | Type | Description |
|---|---|---|
| `marginTop` | `number` | Top margin. |
| `marginBottom` | `number` | Bottom margin. |
| `marginLeft` | `number` | Left margin. |
| `marginRight` | `number` | Right margin. |
| `padding` | `number` | Uniform padding (shorthand). |
| `paddingTop` | `number` | Top padding. |
| `paddingBottom` | `number` | Bottom padding. |
| `paddingLeft` | `number` | Left padding. |
| `paddingRight` | `number` | Right padding. |
| `width` | `number` | Explicit width override. |
| `height` | `number` | Explicit height override. |
| `backgroundColor` | `string` | Background fill color. |
| `zIndex` | `number` | Paint order for overlapping boxes. |

### Borders

| Property | Type | Description |
|---|---|---|
| `borderWidth` | `number` | Uniform border width (shorthand). |
| `borderColor` | `string` | Uniform border color (shorthand). |
| `borderRadius` | `number` | Corner radius. |
| `borderTopWidth` | `number` | Top border width. |
| `borderBottomWidth` | `number` | Bottom border width. |
| `borderLeftWidth` | `number` | Left border width. |
| `borderRightWidth` | `number` | Right border width. |
| `borderTopColor` | `string` | Top border color. |
| `borderBottomColor` | `string` | Bottom border color. |
| `borderLeftColor` | `string` | Left border color. |
| `borderRightColor` | `string` | Right border color. |

### Inline Object Alignment

These apply to inline images and `inline-box` elements:

| Property | Type | Description |
|---|---|---|
| `verticalAlign` | `'baseline' \| 'text-top' \| 'middle' \| 'text-bottom' \| 'bottom'` | Vertical alignment relative to the text line. |
| `baselineShift` | `number` | Shift up (positive) or down (negative) from baseline. |
| `inlineMarginLeft` | `number` | Left margin when used inline. |
| `inlineMarginRight` | `number` | Right margin when used inline. |
| `inlineOpticalInsetTop` | `number` | Optical correction — shrink the top hit-area inward. |
| `inlineOpticalInsetRight` | `number` | Optical correction — right. |
| `inlineOpticalInsetBottom` | `number` | Optical correction — bottom. |
| `inlineOpticalInsetLeft` | `number` | Optical correction — left. |

### simulation Control

| Property | Type | Description |
|---|---|---|
| `pageBreakBefore` | `boolean` | Force a page break before this element. |
| `keepWithNext` | `boolean` | Keep this element on the same page as the next one. |
| `allowLineSplit` | `boolean` | Allow a paragraph to be split across pages at a line boundary. |
| `orphans` | `number` | Minimum lines to leave at the bottom of a page before a split. |
| `widows` | `number` | Minimum lines to carry to the top of the continuation page. |
| `overflowPolicy` | `'clip' \| 'move-whole' \| 'error'` | What to do when a box overflows the page. |

---

## 8. Reserved Structural `type` Values

The engine treats these type strings specially:

| `type` | Purpose |
|---|---|
| `"story"` | Multi-column DTP float zone. Uses `columns`, `gutter`, `balance`. Children may carry `properties.layout`. |
| `"table"` | Table container. Children must be `"table-row"`. Requires `properties.table`. |
| `"table-row"` | Table row. Children must be `"table-cell"`. Set `properties.semanticRole: "header"` for header rows. |
| `"table-cell"` | Table cell. Either `content` (leaf) or `children` (inline runs). Supports `properties.colSpan` and `properties.rowSpan`. |

All other `type` strings are user-defined and are used solely for style lookup.

---

## 9. Inline Element Types

These types are used as `children` of paragraph-like elements:

| `type` | Description |
|---|---|
| `"text"` | Plain text run. `content` holds the string. Apply `properties.style` for run-level styling. |
| `"inline"` | Styled wrapper. `children` holds nested inline elements. `properties.style` is applied to all descendants. |
| `"image"` | Inline image. `properties.image` holds the payload. Use `properties.style.{width, height, verticalAlign, baselineShift, inlineMarginLeft, inlineMarginRight}` to control sizing and alignment. |
| `"inline-box"` | Inline bordered widget. `content` is the label text. `properties.style` controls padding, borders, and colors. |

---

## 10. Image Payload (`properties.image`)

Used for both block and inline images:

```typescript
interface EmbeddedImagePayload {
    data: string;           // Base-64 encoded image bytes
    mimeType?: string;      // "image/png" | "image/jpeg"
    fit?: 'contain' | 'fill';
}
```

---

## 11. Table Configuration (`properties.table`)

```typescript
interface TableLayoutOptions {
    headerRows?: number;
    repeatHeader?: boolean;
    columnGap?: number;
    rowGap?: number;
    columns?: TableColumnSizing[];
    cellStyle?: Partial<ElementStyle>;
    headerCellStyle?: Partial<ElementStyle>;
}
```

| Field | Description |
|---|---|
| `headerRows` | Number of header rows (default `0`). |
| `repeatHeader` | Repeat header rows when the table spans multiple pages. |
| `columnGap` | Gap between columns in points. |
| `rowGap` | Gap between rows in points. |
| `columns` | Per-column sizing specs — see below. |
| `cellStyle` | Style applied to all body cells. |
| `headerCellStyle` | Style applied to header cells. |

### `TableColumnSizing`

```typescript
interface TableColumnSizing {
    mode?: 'fixed' | 'auto' | 'flex';
    value?: number;     // fixed: width in points
    fr?: number;        // flex: fractional unit weight
    min?: number;
    max?: number;
    basis?: number;
    minContent?: number;
    maxContent?: number;
    grow?: number;
    shrink?: number;
}
```

| `mode` | Behaviour |
|---|---|
| `"fixed"` | Column is exactly `value` points wide. |
| `"auto"` | Column sizes to its content. |
| `"flex"` | Column takes a share of remaining space proportional to `fr`. |

---

## 12. Drop Cap (`properties.dropCap`)

```typescript
interface DropCapSpec {
    enabled?: boolean;
    lines?: number;
    characters?: number;
    gap?: number;
    characterStyle?: Partial<ElementStyle>;
}
```

| Field | Default | Description |
|---|---|---|
| `enabled` | — | Must be `true` to activate. |
| `lines` | `3` | Number of body-text lines the enlarged character spans. |
| `characters` | `1` | Number of leading characters to enlarge. |
| `gap` | — | Horizontal gap in points between the enlarged character and the body text. |
| `characterStyle` | — | Style overrides applied only to the enlarged character(s). |

---

## 13. Story Layout Directives (`properties.layout`)

Declared on **children of a `"story"` element** to float or absolutely position them relative to the story's content area.

```typescript
interface StoryLayoutDirective {
    mode: 'float' | 'story-absolute';

    // story-absolute only
    x?: number;
    y?: number;

    // float only
    align?: 'left' | 'right' | 'center';

    // both modes
    wrap?: 'around' | 'top-bottom' | 'none';
    gap?: number;
}
```

| Field | Description |
|---|---|
| `mode` | `"float"` — anchored to a margin; `"story-absolute"` — placed at explicit `x`/`y`. |
| `x` | Absolute X offset from the story content-area left edge (points). `story-absolute` only. |
| `y` | Absolute Y offset from the story origin (points). `story-absolute` only. |
| `align` | Which margin to anchor the float to: `"left"`, `"right"`, or `"center"`. `float` only. |
| `wrap` | How flowing text responds to the obstacle: `"around"` (both sides), `"top-bottom"` (no side wrap), `"none"` (no wrap at all). |
| `gap` | Clearance in points around the obstacle's bounding box. |

---

## 14. Simulation Continuation (`properties.simulationContinuation`)

Controls marker elements inserted automatically around page-split points.

```typescript
interface SimulationContinuationSpec {
    enabled?: boolean;
    markerAfterSplit?: {
        type: string;
        content: string;
        style?: Partial<ElementStyle>;
        properties?: Partial<ElementProperties>;
    };
    markerBeforeContinuation?: {
        type: string;
        content: string;
        style?: Partial<ElementStyle>;
        properties?: Partial<ElementProperties>;
    };
    markersBeforeContinuation?: Array<{
        type: string;
        content: string;
        properties?: Partial<ElementProperties>;
    }>;
}
```

---

## 15. Page Regions (Headers & Footers)

```typescript
interface PageRegionDefinition {
    default?: PageRegionContent | null;
    firstPage?: PageRegionContent | null;
    odd?: PageRegionContent | null;
    even?: PageRegionContent | null;
}

interface PageRegionContent {
    elements: Element[];
    style?: Partial<ElementStyle>;
}
```

- The string `"{pageNumber}"` anywhere inside a `content` field is substituted with the current page number.
- Use `properties.pageOverrides: { header: null, footer: null }` on an element to suppress the header/footer on that element's pages.

---

## 16. Nesting Rules

| Parent `type` | Valid children |
|---|---|
| `"story"` | Any block `Element`. Children may carry `properties.layout`. |
| `"table"` | `"table-row"` elements only. |
| `"table-row"` | `"table-cell"` elements only. |
| `"table-cell"` | Either `content` (leaf text) or inline `children` (`"text"`, `"inline"`, `"image"`, `"inline-box"`). |
| Any paragraph-like | Inline `children`: `"text"`, `"inline"`, `"image"`, `"inline-box"`. |
| Page region | Any `Element` (same rules as body elements). |

---

## 17. Transmuter-Emitted Type Names (`draft2final`)

When using `draft2final`, transmuters emit elements with these `type` strings into `DocumentInput.elements`. These are the keys you target in your `styles` table when theming a transmuter output.

### Markdown / Academic / Literature / Novel

| `type` | Source |
|---|---|
| `heading-1` … `heading-6` | `<h1>`–`<h6>` |
| `subheading` | Paragraph starting with `::` following an `h1` |
| `paragraph` | `<p>` |
| `blockquote` | `<blockquote>` |
| `code-block` | Fenced code block |
| `thematic-break` | `<hr>` |
| `definition-term`, `definition-desc` | `<dl>/<dt>/<dd>` |
| `list-item-unordered-0`, `list-item-ordered-0`, `list-item-continuation-1` | Lists |
| `table` → `table-row` → `table-cell` | `<table>` |
| `image` | Standalone block image |
| `references-heading` | Auto-generated references section heading |
| `footnotes-heading` | Auto-generated footnotes section heading |

### Manuscript Format

| `type` | Description |
|---|---|
| `cover-title`, `cover-line` | Cover page elements |
| `chapter-heading` | From `<h2>` |
| `scene-break` | From `<h3>`–`<h6>` or `<hr>` |
| `paragraph`, `paragraph-first` | Body paragraphs |
| `blockquote`, `poem`, `lyrics`, `literary-quote`, `epigraph`, `epigraph-attribution` | Quoted material variants |
| `thematic-break` | Scene separator |
| `notes-heading`, `notes-item` | Notes section |

### Screenplay Format

| `type` | Description |
|---|---|
| `title`, `title-meta`, `title-contact` | Title page elements |
| `scene-heading` | `INT.`/`EXT.` sluglines |
| `character`, `parenthetical`, `dialogue` | Standard speech block |
| `character-dual-left`, `parenthetical-dual-left`, `dialogue-dual-left` | Left column of dual dialogue |
| `character-dual-right`, `parenthetical-dual-right`, `dialogue-dual-right` | Right column of dual dialogue |
| `more` | Page-turn continuation marker (`(MORE)`) |
| `transition` | e.g. `CUT TO:` |
| `action` | Standard action lines |
| `beat` | From `<hr>` |

---

## 18. Minimal Complete Example

```json
{
  "documentVersion": "1.0",
  "layout": {
    "pageSize": "LETTER",
    "margins": { "top": 72, "right": 72, "bottom": 72, "left": 72 },
    "fontFamily": "Helvetica",
    "fontSize": 12,
    "lineHeight": 1.4
  },
  "styles": {
    "h1":        { "fontSize": 24, "fontWeight": "bold", "marginBottom": 12, "keepWithNext": true },
    "paragraph": { "marginBottom": 10, "allowLineSplit": true, "orphans": 2, "widows": 2 }
  },
  "elements": [
    { "type": "h1", "content": "Title" },
    {
      "type": "paragraph",
      "content": "",
      "children": [
        { "type": "text", "content": "Plain text, then " },
        { "type": "text", "content": "bold", "properties": { "style": { "fontWeight": "bold" } } },
        { "type": "text", "content": " and " },
        {
          "type": "inline",
          "content": "",
          "properties": { "style": { "fontStyle": "italic", "color": "#333" } },
          "children": [{ "type": "text", "content": "italic" }]
        },
        { "type": "text", "content": "." }
      ]
    }
  ]
}
```

### Table Example

```json
{
  "type": "table",
  "content": "",
  "properties": {
    "table": {
      "headerRows": 1,
      "repeatHeader": true,
      "columns": [
        { "mode": "flex", "fr": 2 },
        { "mode": "flex", "fr": 1 },
        { "mode": "fixed", "value": 60 }
      ]
    }
  },
  "children": [
    {
      "type": "table-row",
      "content": "",
      "properties": { "semanticRole": "header" },
      "children": [
        { "type": "table-cell", "content": "Name" },
        { "type": "table-cell", "content": "Status" },
        { "type": "table-cell", "content": "Score" }
      ]
    },
    {
      "type": "table-row",
      "content": "",
      "children": [
        { "type": "table-cell", "content": "Alice" },
        { "type": "table-cell", "content": "Active" },
        { "type": "table-cell", "content": "98" }
      ]
    }
  ]
}
```

### Story / Float Example

```json
{
  "type": "story",
  "columns": 2,
  "gutter": 18,
  "children": [
    {
      "type": "image",
      "content": "",
      "properties": {
        "layout": { "mode": "float", "align": "right", "wrap": "around", "gap": 8 },
        "style": { "width": 120, "height": 90 },
        "image": { "data": "<base64>", "mimeType": "image/png", "fit": "contain" }
      }
    },
    { "type": "paragraph", "content": "Text flows around the floated image." }
  ]
}
```

---

## 19. Key Source Files

| What | Where |
|---|---|
| All type definitions | [engine/src/engine/types.ts](../engine/src/engine/types.ts) |
| Input validation | [engine/src/engine/document.ts](../engine/src/engine/document.ts) |
| Architecture narrative | [documents/ARCHITECTURE.md](ARCHITECTURE.md) |
| Header/footer details | [documents/HEADER-FOOTER.md](HEADER-FOOTER.md) |
| Overlay system | [documents/OVERLAY.md](OVERLAY.md) |
| Standard fonts | [documents/STANDARD-FONTS.md](STANDARD-FONTS.md) |
| Markdown compilation core | [markdown-core/src/index.ts](../markdown-core/src/index.ts) |
| Transmuter implementations | [transmuters/](../transmuters/) |
| Regression fixtures | [engine/tests/fixtures/](../engine/tests/fixtures/) |
