# VMPrint AST Reference

This document is the reference for the public **VMPrint document input format**: the JSON/object tree you author and hand to the VMPrint pipeline.

The AST is the canonical public source format. The engine internally normalizes it into a spatial runtime form, but callers work with the AST.

If you want the guided teaching path instead of the full contract, start with the authoring guide:

- [Authoring Guide](../guides/)

---


## 1. Pipeline Overview

```text
Direct callers usually construct **`DocumentInput`**. The `SemanticDocument` layer is only relevant when using the [draft2final](https://github.com/cosmiciron/draft2final) standalone CLI.

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
| `documentVersion` | yes | `"1.1"` is the current and only supported authored surface. |
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
    placement?: StoryLayoutDirective;

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

    colSpan?: number;
    rowSpan?: number;

    sourceId?: string;
    linkTarget?: string;
    semanticRole?: string;
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

AST `1.1` keeps `properties` for overrides, metadata, and cross-cutting controls. Structural payloads live on the element itself.

| Property | Applies to | Description |
|---|---|---|
| `style` | any | Inline style overrides. |
| `colSpan` | `table-cell` | Number of columns this cell spans. |
| `rowSpan` | `table-cell` | Number of rows this cell spans. |
| `sourceId` | any | Caller-assigned stable ID surfaced in `BoxMeta`. |
| `linkTarget` | inline `text`, `inline` | Hyperlink URL. |
| `semanticRole` | `table-row` | `"header"` marks the row as a header row. |
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
| `story` | Multi-column flowing content area. Uses `columns`, `gutter`, `balance`. Direct children may carry `placement`. |
| `table` | Table container. Children must be `table-row`. Uses `element.table`. |
| `table-row` | Table row. Children must be `table-cell`. |
| `table-cell` | Table cell. Supports `properties.colSpan` and `properties.rowSpan`. |
| `strip` | One-row horizontal composition band. Uses `slots[]` plus `element.stripLayout`. |
| `zone-map` | Independent-region layout. Uses `zones[]` plus `element.zoneLayout`. |

All other `type` strings are user-defined and are used for style lookup.

---

## 9. Inline Element Types

| `type` | Description |
|---|---|
| `text` | Plain text run. |
| `inline` | Styled inline wrapper. |
| `image` | Inline image. Uses `element.image`. |
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

A `zone-map` defines independent layout regions inside the current field. The
classic strip form is still supported, but zones may also use explicit
rectangular `region` bounds with `x`, `y`, `width`, and optional `height`.

```json
{
  "type": "zone-map",
  "zoneLayout": {
    "columns": [
      { "mode": "flex", "fr": 2 },
      { "mode": "flex", "fr": 1 }
    ],
    "gap": 16,
    "frameOverflow": "move-whole",
    "worldBehavior": "fixed"
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
    frameOverflow?: 'move-whole' | 'continue';
    worldBehavior?: 'fixed' | 'spanning' | 'expandable';
}

interface ZoneDefinition {
    id?: string;
    elements: Element[];
    style?: Record<string, any>;
}
```

`zones[]` entries are region descriptors, not DOM children.

`frameOverflow` makes the zone field lifecycle explicit:

- `move-whole`: conservative field behavior; the whole zone-map moves if it does not fit
- `continue`: opt into paged-field lifecycle, but only authored world behaviors that support continuation currently activate it at runtime

`worldBehavior` makes the authored world rule explicit:

- `fixed`: conservative default; the authored region topology is non-expandable
- `spanning`: the author explicitly defines a multi-map region plan, including how the region crosses later local maps
- `expandable`: the region may automatically grow into later local maps while preserving authored topology unless later authored rules say otherwise

`frameOverflow` and `worldBehavior` are related but not the same thing.

For now:

- omitting `frameOverflow` keeps the old `move-whole` behavior
- omitting `worldBehavior` defaults to `fixed`
- `frameOverflow: "continue"` only gains live page-to-page regional continuation when paired with `worldBehavior: "expandable"`

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

## 13. Story Placement (`element.placement`)

Declared on direct children of a `story` element to float or absolutely position them relative to the story's content area.

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

Any block element can float or use `story-absolute` if it carries explicit obstacle size through style `width` and `height`. Images may omit explicit size and derive it from intrinsic image dimensions.

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

`"{pageNumber}"`, `"{physicalPageNumber}"`, and `"{totalPages}"` tokens inside `content` are substituted during finalization.

---

## 16. Nesting Rules

| Parent `type` | Valid children |
|---|---|
| `story` | Any block `Element`. Direct children may carry `placement`. |
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
| Type definitions | [engine/src/engine/types.ts](https://github.com/cosmiciron/vmprint/blob/main/engine/src/engine/types.ts) |
| AST normalization | [engine/src/engine/document.ts](https://github.com/cosmiciron/vmprint/blob/main/engine/src/engine/document.ts) |
| Spatial fixture normalization helper | [engine/tests/harness/spatialize.ts](https://github.com/cosmiciron/vmprint/blob/main/engine/tests/harness/spatialize.ts) |
| Architecture and Runtime Internals | [ENGINE-INTERNALS.md](https://github.com/cosmiciron/vmprint/blob/main/documents/ENGINE-INTERNALS.md) |
| Scripting API | [scripting.html](./scripting.html) |
| Overlay system | [overlay.html](./overlay.html) |
| Standard fonts | [standard-fonts.html](./standard-fonts.html) |
| Testing guide | [TESTING.md](https://github.com/cosmiciron/vmprint/blob/main/documents/TESTING.md) |
| Markdown compilation core | [External](https://github.com/cosmiciron/vmprint-transmuters/blob/main/markdown-core/src/index.ts) |
| Transmuters | [External](https://github.com/cosmiciron/vmprint-transmuters) |
| Regression fixtures | [engine/tests/fixtures](https://github.com/cosmiciron/vmprint/tree/main/engine/tests/fixtures) |
