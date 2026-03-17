# VMPrint AST Reference

This document is the reference for the public **VMPrint document input format**: the JSON/object tree you author and hand to the VMPrint pipeline.

The AST is the canonical public source format. The engine internally normalizes it into a spatial runtime form, but callers work with the AST.

For the current design audit and redesign notes, see [AST-SPATIAL-ALIGNMENT.md](c:\Users\cosmic\Projects\vmprint\documents\AST-SPATIAL-ALIGNMENT.md).

---

## 1. Pipeline Overview

```text
Markdown string
  -> [remark / semantic.ts]
SemanticDocument                (draft2final intermediate layer)
  -> [FormatHandler / FormatContext]
DocumentInput / Element tree    <- public authored source
  -> [normalize()]
SpatialDocument / runtime config
  -> [LayoutEngine]
Page[] of Box[]                 (flat, positioned output)
```

Direct callers usually construct **`DocumentInput`**. The `SemanticDocument` layer is only relevant when using `draft2final`.

---

## 2. `DocumentInput`

```typescript
interface DocumentInput {
    documentVersion: '1.0' | '1.1';
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
| `documentVersion` | yes | `"1.1"` is the current authored surface. `"1.0"` remains supported for compatibility. |
| `layout` | yes | Page geometry and default typography. |
| `fonts` | no | Font file sources keyed by weight/style. |
| `styles` | yes | Named style table; keys are element `type` strings. |
| `elements` | yes | Top-level content elements. |
| `header` | no | Running page header; see §15. |
| `footer` | no | Running page footer; see §15. |
| `debug` | no | Enable engine debug output. |

---

## 3. `LayoutConfig`

All numeric values are in points unless noted.

```typescript
interface LayoutConfig {
    pageSize: 'A4' | 'LETTER' | { width: number; height: number };
    orientation?: 'portrait' | 'landscape';
    margins: { top: number; right: number; bottom: number; left: number };
    fontFamily: string;
    fontSize: number;
    lineHeight: number;

    pageBackground?: string;

    headerInsetTop?: number;
    headerInsetBottom?: number;
    footerInsetTop?: number;
    footerInsetBottom?: number;

    pageNumberStart?: number;

    lang?: string;
    direction?: 'ltr' | 'rtl' | 'auto';
    hyphenation?: 'off' | 'auto' | 'soft';
    hyphenateCaps?: boolean;
    hyphenMinWordLength?: number;
    hyphenMinPrefix?: number;
    hyphenMinSuffix?: number;
    justifyEngine?: 'legacy' | 'advanced';
    justifyStrategy?: 'auto' | 'space' | 'inter-character';

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

Values are file paths or embedded data URLs.

---

## 5. `Element`

```typescript
interface Element {
    type: string;
    content: string;
    children?: Element[];

    image?: EmbeddedImagePayload;
    table?: TableLayoutOptions;

    slots?: StripSlot[];
    columns?: number;
    gutter?: number;
    balance?: boolean;
    zones?: ZoneDefinition[];

    zoneLayout?: ZoneLayoutOptions;
    stripLayout?: StripLayoutOptions;
    dropCap?: DropCapSpec;
    columnSpan?: 'all' | number;

    properties?: ElementProperties;
}
```

| Field | Description |
|---|---|
| `type` | Identifies the element. Used to look up the base style from `styles`. |
| `content` | Flat text for leaf nodes. Use `""` for containers. |
| `children` | Structural children or inline runs. |
| `image` | Preferred on AST `1.1+` for image-bearing nodes. |
| `table` | Preferred on AST `1.1+` on `type: "table"` elements. |
| `slots` | `strip` only. One-row horizontal composition slots. |
| `columns` | `story` only. Number of columns. |
| `gutter` | `story` only. Inter-column gap in points. |
| `balance` | `story` only. Balance column heights. |
| `zones` | `zone-map` only. Independent authored regions. |
| `zoneLayout` | Preferred on AST `1.1+` on `type: "zone-map"` elements. |
| `stripLayout` | Preferred on AST `1.1+` on `type: "strip"` elements. |
| `dropCap` | Preferred on AST `1.1+` for paragraph-like elements. |
| `columnSpan` | Preferred on AST `1.1+` for children of multi-column `story` elements. |
| `properties` | Per-element overrides; see §6. |

Style resolution order: `styles[element.type]` -> `properties.style`.

---

## 6. `ElementProperties`

```typescript
interface ElementProperties {
    style?: Partial<ElementStyle>;

    image?: EmbeddedImagePayload;
    table?: TableLayoutOptions;
    zones?: ZoneLayoutOptions;
    strip?: StripLayoutOptions;
    colSpan?: number;
    rowSpan?: number;

    sourceId?: string;
    linkTarget?: string;
    semanticRole?: string;
    dropCap?: DropCapSpec;
    layout?: StoryLayoutDirective;
    columnSpan?: 'all' | number;
    reflowKey?: string;

    keepWithNext?: boolean;
    marginTop?: number;
    marginBottom?: number;

    simulationContinuation?: SimulationContinuationSpec;
    pageOverrides?: {
        header?: PageRegionContent | null;
        footer?: PageRegionContent | null;
    };

    sourceRange?: { lineStart: number; colStart: number; lineEnd: number; colEnd: number };
    sourceSyntax?: string;
    language?: string;
}
```

AST `1.1` keeps `properties` for overrides, metadata, and cross-cutting controls, but promotes structural payloads onto the element itself. Legacy AST `1.0` placements such as `properties.image`, `properties.table`, `properties.zones`, `properties.strip`, `properties.dropCap`, and `properties.columnSpan` are still accepted for compatibility.

| Property | Applies to | Description |
|---|---|---|
| `style` | any | Inline style overrides. |
| `image` | legacy `1.0` image-bearing nodes | Legacy image payload placement; prefer `element.image` in `1.1`. |
| `table` | legacy `1.0` `table` | Legacy table layout placement; prefer `element.table` in `1.1`. |
| `zones` | legacy `1.0` `zone-map` | Legacy zone-map layout placement; prefer `element.zoneLayout` in `1.1`. |
| `strip` | legacy `1.0` `strip` | Legacy strip layout placement; prefer `element.stripLayout` in `1.1`. |
| `colSpan` | `table-cell` | Number of columns this cell spans. |
| `rowSpan` | `table-cell` | Number of rows this cell spans. |
| `sourceId` | any | Caller-assigned stable ID surfaced in `BoxMeta`. |
| `linkTarget` | inline `text`, `inline` | Hyperlink URL. |
| `semanticRole` | `table-row` | `"header"` marks the row as a header row. |
| `dropCap` | legacy `1.0` paragraph-like | Legacy drop-cap placement; prefer `element.dropCap` in `1.1`. |
| `layout` | children of `story` | Float / absolute positioning; see §13. |
| `columnSpan` | legacy `1.0` children of multi-column `story` | Legacy column-span placement; prefer `element.columnSpan` in `1.1`. |
| `reflowKey` | any | Explicit cache key for the reflow cache. |
| `keepWithNext` | any | Keep this element on the same page as the one after it. |
| `marginTop` | any | Top margin shorthand override. |
| `marginBottom` | any | Bottom margin shorthand override. |
| `simulationContinuation` | any | Cross-page split markers; see §14. |
| `pageOverrides` | any | Override or suppress the header/footer for this element's pages. |
| `language` | code blocks | Language hint such as `"typescript"`. |

---

## 7. `ElementStyle`

All fields are optional. Common fields include:

- typography: `fontFamily`, `fontSize`, `fontWeight`, `fontStyle`, `textAlign`, `letterSpacing`, `lineHeight`, `textIndent`, `color`, `opacity`
- internationalisation: `lang`, `direction`, `hyphenation`, `hyphenateCaps`, `hyphenMinWordLength`, `hyphenMinPrefix`, `hyphenMinSuffix`, `justifyEngine`, `justifyStrategy`
- box model: `marginTop`, `marginBottom`, `marginLeft`, `marginRight`, `padding*`, `width`, `height`, `backgroundColor`, `zIndex`
- borders: `borderWidth`, `borderColor`, `borderRadius`, `borderTopWidth`, `borderBottomWidth`, `borderLeftWidth`, `borderRightWidth`, `borderTopColor`, `borderBottomColor`, `borderLeftColor`, `borderRightColor`
- inline object alignment: `verticalAlign`, `baselineShift`, `inlineMarginLeft`, `inlineMarginRight`, `inlineOpticalInsetTop`, `inlineOpticalInsetRight`, `inlineOpticalInsetBottom`, `inlineOpticalInsetLeft`
- pagination control: `pageBreakBefore`, `keepWithNext`, `allowLineSplit`, `orphans`, `widows`, `overflowPolicy`

See [engine/src/engine/types.ts](c:\Users\cosmic\Projects\vmprint\engine\src\engine\types.ts) for the complete shape.

---

## 8. Reserved Structural `type` Values

| `type` | Purpose |
|---|---|
| `story` | Multi-column flowing content area. Uses `columns`, `gutter`, `balance`. Children may carry `properties.layout`. |
| `table` | Table container. Children must be `table-row`. Uses `element.table` in `1.1` and legacy `properties.table` in `1.0`. |
| `table-row` | Table row. Children must be `table-cell`. |
| `table-cell` | Table cell. Supports `properties.colSpan` and `properties.rowSpan`. |
| `strip` | One-row horizontal composition band. Uses `slots[]` plus `element.stripLayout` in `1.1` and legacy `properties.strip` in `1.0`. |
| `zone-map` | Independent-region layout. Uses `zones[]` plus `element.zoneLayout` in `1.1` and legacy `properties.zones` in `1.0`. |

All other `type` strings are user-defined and are used for style lookup.

---

## 9. Inline Element Types

| `type` | Description |
|---|---|
| `text` | Plain text run. |
| `inline` | Styled inline wrapper. |
| `image` | Inline image. Prefer `element.image` in AST `1.1`; `properties.image` remains valid in `1.0`. |
| `inline-box` | Inline bordered widget. |

---

## 10. Image Payload (`element.image`)

```typescript
interface EmbeddedImagePayload {
    data: string;
    mimeType?: string;
    fit?: 'contain' | 'fill';
}
```

Used for both block and inline images.

---

## 11. Table Configuration (`element.table`)

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

### `TableColumnSizing`

```typescript
interface TableColumnSizing {
    mode?: 'fixed' | 'auto' | 'flex';
    value?: number;
    fr?: number;
    min?: number;
    max?: number;
    basis?: number;
    minContent?: number;
    maxContent?: number;
    grow?: number;
    shrink?: number;
}
```

---

## 11a. Strip (`type: "strip"`)

A `strip` is a compact one-row horizontal composition band for bylines, folio lines, masthead sub-rows, and similar left/center/right compositions.

```json
{
  "type": "strip",
  "stripLayout": {
    "tracks": [
      { "mode": "flex", "fr": 1 },
      { "mode": "fixed", "value": 32 },
      { "mode": "flex", "fr": 1 }
    ],
    "gap": 8
  },
  "slots": [
    { "id": "left", "elements": [{ "type": "folio-left", "content": "Work Title" }] },
    { "id": "center", "elements": [{ "type": "folio-center", "content": "{pageNumber}" }] },
    { "id": "right", "elements": [{ "type": "folio-right", "content": "Chapter Title" }] }
  ]
}
```

```typescript
interface StripLayoutOptions {
    tracks?: TableColumnSizing[];
    gap?: number;
}

interface StripSlot {
    id?: string;
    elements: Element[];
    style?: Record<string, any>;
}
```

Use `strip` for lightweight composition, not tabular data.

---

## 11b. Zone Map (`type: "zone-map"`)

A `zone-map` divides a horizontal strip of the page into independent layout regions.

```json
{
  "type": "zone-map",
  "zoneLayout": {
    "columns": [
      { "mode": "flex", "fr": 2 },
      { "mode": "flex", "fr": 1 }
    ],
    "gap": 16
  },
  "properties": {
    "style": {
      "marginTop": 12,
      "marginBottom": 12
    }
  },
  "zones": [
    {
      "id": "main",
      "elements": [
        { "type": "h2", "content": "Main Area" },
        { "type": "p", "content": "Body text in the left zone." }
      ]
    },
    {
      "id": "sidebar",
      "elements": [
        { "type": "sidebar-label", "content": "SIDEBAR" },
        { "type": "sidebar-body", "content": "Sidebar content." }
      ]
    }
  ]
}
```

```typescript
interface ZoneLayoutOptions {
    columns?: TableColumnSizing[];
    gap?: number;
}

interface ZoneDefinition {
    id?: string;
    elements: Element[];
    style?: Record<string, any>;
}
```

`zones[]` entries are region descriptors, not DOM children.

---

## 12. Drop Cap (`element.dropCap`)

```typescript
interface DropCapSpec {
    enabled?: boolean;
    lines?: number;
    characters?: number;
    gap?: number;
    characterStyle?: Partial<ElementStyle>;
}
```

---

## 13. Story Layout Directives (`properties.layout`)

Declared on children of a `story` element to float or absolutely position them relative to the story's content area.

```typescript
interface StoryLayoutDirective {
    mode: 'float' | 'story-absolute';
    x?: number;
    y?: number;
    align?: 'left' | 'right' | 'center';
    wrap?: 'around' | 'top-bottom' | 'none';
    gap?: number;
}
```

Any block element can float if it carries explicit obstacle size through style width/height. `story-absolute` is currently restricted to image elements.

---

## 13a. Column Span (`element.columnSpan`)

Declared on children of a multi-column `story`. A spanned element breaks the column flow, is laid out at full story width, then flow resumes below.

```typescript
columnSpan?: 'all' | number
```

---

## 14. Simulation Continuation (`properties.simulationContinuation`)

Controls marker elements inserted automatically around page splits.

---

## 15. Page Regions

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

`"{pageNumber}"` tokens inside `content` are substituted during finalization.

---

## 16. Nesting Rules

| Parent `type` | Valid children |
|---|---|
| `story` | Any block `Element`. Children may carry `properties.layout`. |
| `table` | `table-row` only. |
| `table-row` | `table-cell` only. |
| `table-cell` | Either `content` or inline `children`. |
| paragraph-like | Inline `children`: `text`, `inline`, `image`, `inline-box`. |
| page region | Any `Element`. |

---

## 17. Minimal Example

```json
{
  "documentVersion": "1.1",
  "layout": {
    "pageSize": "LETTER",
    "margins": { "top": 72, "right": 72, "bottom": 72, "left": 72 },
    "fontFamily": "Helvetica",
    "fontSize": 12,
    "lineHeight": 1.4
  },
  "styles": {
    "h1": { "fontSize": 24, "fontWeight": "bold", "marginBottom": 12, "keepWithNext": true },
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
  "table": {
    "headerRows": 1,
    "repeatHeader": true,
    "columns": [
      { "mode": "flex", "fr": 2 },
      { "mode": "flex", "fr": 1 },
      { "mode": "fixed", "value": 60 }
    ]
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
      "image": { "data": "<base64>", "mimeType": "image/png", "fit": "contain" },
      "properties": {
        "layout": { "mode": "float", "align": "right", "wrap": "around", "gap": 8 },
        "style": { "width": 120, "height": 90 }
      }
    },
    { "type": "paragraph", "content": "Text flows around the floated image." }
  ]
}
```

---

## 18. Key Source Files

| What | Where |
|---|---|
| Type definitions | [engine/src/engine/types.ts](c:\Users\cosmic\Projects\vmprint\engine\src\engine\types.ts) |
| AST normalization | [engine/src/engine/document.ts](c:\Users\cosmic\Projects\vmprint\engine\src\engine\document.ts) |
| Spatial fixture normalization helper | [engine/tests/harness/spatialize.ts](c:\Users\cosmic\Projects\vmprint\engine\tests\harness\spatialize.ts) |
| Architecture narrative | [documents/ARCHITECTURE.md](c:\Users\cosmic\Projects\vmprint\documents\ARCHITECTURE.md) |
| Header/footer details | [documents/HEADER-FOOTER.md](c:\Users\cosmic\Projects\vmprint\documents\HEADER-FOOTER.md) |
| Overlay system | [documents/OVERLAY.md](c:\Users\cosmic\Projects\vmprint\documents\OVERLAY.md) |
| Standard fonts | [documents/STANDARD-FONTS.md](c:\Users\cosmic\Projects\vmprint\documents\STANDARD-FONTS.md) |
| Markdown compilation core | [markdown-core/src/index.ts](c:\Users\cosmic\Projects\vmprint\markdown-core\src\index.ts) |
| Transmuters | [transmuters](c:\Users\cosmic\Projects\vmprint\transmuters) |
| Regression fixtures | [engine/tests/fixtures](c:\Users\cosmic\Projects\vmprint\engine\tests\fixtures) |
