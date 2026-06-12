# VMPrint AST Reference

This document is the reference for the public **VMPrint document input format**: the JSON/object tree you author and hand to the VMPrint pipeline.

The AST is the canonical public source format. The engine internally normalizes it into a spatial runtime form, but callers work with the AST.

If you want the guided teaching path instead of the full contract, start with the authoring guide:

- [Authoring Guide](../guides/)

Native lists are documented in [§11a](#11a-list-type-list). Use `list` and
`list-item` elements for bullets, ordered numbering, nested levels,
multilingual marker styles, and custom generated markers.

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
    publicationMode?: 'paginated' | 'continuous';
    printBreakPolicy?: 'preserve' | 'ignore';
    pageTemplates?: PageTemplate[];
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
    microLanePolicy?: 'allow' | 'balanced' | 'typography';
    worldPlain?: WorldPlainOptions;
}

interface PageTemplate {
    pageIndex?: number;
    selector?: 'first' | 'odd' | 'even' | 'all';
    pageSize?: 'A4' | 'LETTER' | { width: number; height: number };
    orientation?: 'portrait' | 'landscape';
    margins?: { top: number; right: number; bottom: number; left: number };
}
```

`layout.pageTemplates` overrides page geometry for matching pages. Templates are
applied in declaration order over the document defaults, so later matches can
refine earlier broad selectors. `pageIndex` is zero-based; `selector` uses
human page parity, so page index `0` is the first odd page. A matching template
may override `pageSize`, `orientation`, `margins`, or any combination of those
fields. Pages without a matching template keep the document-level layout.

`layout.publicationMode` controls how the settled world is captured. The default
`paginated` mode publishes ordinary print pages. `continuous` mode publishes the
root flow as a browser-like continuous page. In continuous mode, authored print
breaks are ignored by default because they are print pagination instructions;
set `printBreakPolicy: "preserve"` to keep them. In paginated mode, print breaks
are preserved by default; set `printBreakPolicy: "ignore"` only for specialized
probes that need to neutralize authored page breaks.

```json
{
  "layout": {
    "pageSize": { "width": 460, "height": 360 },
    "margins": { "top": 32, "right": 32, "bottom": 32, "left": 32 },
    "pageTemplates": [
      {
        "pageIndex": 1,
        "pageSize": { "width": 280, "height": 420 },
        "margins": { "top": 34, "right": 22, "bottom": 34, "left": 22 }
      },
      {
        "pageIndex": 2,
        "pageSize": { "width": 420, "height": 230 },
        "margins": { "top": 20, "right": 44, "bottom": 20, "left": 44 }
      }
    ]
  }
}
```

The engine resolves template geometry before measuring each page, so available
flow width, header/footer regions, debug margins, overlays, and rendered page
media boxes all use the active page's dimensions.

`layout.microLanePolicy` controls whether spatial wrapping may use very narrow
horizontal lanes carved by obstacles:

- `"allow"` keeps every mathematically valid lane, including tiny expressive notches
- `"balanced"` is the default; it filters out obviously useless slivers while still allowing practical side lanes
- `"typography"` is stricter and prefers dropping below an obstacle over fitting text into very narrow gaps

### `layout.worldPlain`

`worldPlain` defines the document-stage world substrate. When present, root
elements inhabit that stage instead of being treated as only sequential flow.

```typescript
interface WorldPlainOptions {
    style?: Partial<ElementStyle>;
}
```

`worldPlain` is authored through `layout`. Do not author
`{ "type": "world-plain" }` directly; the engine may synthesize an internal
host wrapper at runtime, but that wrapper is not part of the public AST.

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
    list?: ListLayoutOptions;

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
| `list` | Preferred on AST `1.1+` on `type: "list"` elements. |
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
    spatialField?: SpatialFieldDirective;
    zoneField?: SpatialFieldDirective;
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
| `spatialField` | any actor | Generic actor-published spatial field. |
| `zoneField` | any actor | Compatibility alias for early zone experiments. Prefer `spatialField`. |

### `SpatialFieldDirective`

```typescript
type StoryFloatShape = 'rect' | 'circle' | 'polygon';

interface StoryExclusionAssemblyMember {
    x: number;
    y: number;
    w: number;
    h: number;
    shape?: StoryFloatShape;
    path?: string;
}

interface StoryExclusionAssembly {
    members: StoryExclusionAssemblyMember[];
}

interface SpatialFieldDirective {
    kind?: 'exclude';
    x?: number;
    y?: number;
    align?: 'left' | 'right' | 'center';
    wrap?: 'around' | 'top-bottom' | 'none';
    gap?: number;
    shape?: StoryFloatShape;
    path?: string;
    exclusionAssembly?: StoryExclusionAssembly;
    hidden?: boolean;
    zIndex?: number;
    traversalInteraction?: 'auto' | 'wrap' | 'overpass' | 'ignore';
}
```

Hosts decide what the field means:

- `story` consumes it as wrap/exclusion geometry
- `zone-map` consumes it as placed spatial presence within a region host
- `worldPlain` consumes it as world-space presence on the stage declared in `layout`

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
| `list` | Native list container. Children must be `list-item`. Uses `element.list`. |
| `list-item` | Native list item body. The engine generates marker boxes; do not author bullet or number text in `content`. |
| `list-marker` | Generated marker flow box type. May be styled through `styles["list-marker"]`. |
| `table` | Table container. Children must be `table-row`. Uses `element.table`. |
| `table-row` | Table row. Children must be `table-cell`. |
| `table-cell` | Table cell. Supports `properties.colSpan` and `properties.rowSpan`. |
| `strip` | One-row horizontal composition band. Uses `slots[]` plus `element.stripLayout`. |
| `zone-map` | Independent-region layout. Uses `zones[]` plus `element.zoneLayout`. |
| `field-actor` | Visible placeable spatial body, typically paired with `properties.spatialField`. |

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

## 11a. List (`type: "list"`)

A `list` is a native flowing block for unordered and ordered lists. The authored
tree contains `list-item` children; VMPrint generates visible marker boxes at
layout time so callers do not need to put bullets or numbers into item text.
`list-item` nodes may contain inline children for rich text, plus block
children such as `p`, `list`, `story`, `zone-map`, or `table`. Nested `list`
children are laid out recursively, so marker generation, hanging indents, and
host behavior travel through ordinary flow, stories/columns, zones, and table
cell block content.

```json
{
  "type": "list",
  "content": "",
  "list": {
    "kind": "ordered",
    "markerStyle": "decimal",
    "start": 3,
    "indent": 28,
    "markerWidth": 18,
    "markerGap": 10
  },
  "children": [
    { "type": "list-item", "content": "Third item body." },
    { "type": "list-item", "content": "Fourth item body." }
  ]
}
```

```typescript
interface ListLayoutOptions {
    kind?: 'unordered' | 'ordered';
    markerStyle?:
        | 'disc'
        | 'bullet'
        | 'circle'
        | 'square'
        | 'decimal'
        | 'arabic-indic'
        | 'extended-arabic-indic'
        | 'devanagari'
        | 'thai'
        | 'cjk-decimal'
        | 'cjk-ideographic'
        | 'hiragana'
        | 'katakana'
        | 'lower-alpha'
        | 'upper-alpha'
        | 'lower-roman'
        | 'upper-roman';
    markerText?: string;
    markerTextStyle?: ElementStyle;
    start?: number;
    indent?: number;
    markerWidth?: number;
    markerGap?: number;
    itemSpacing?: number;
    nestedListSpacingBefore?: number;
    nestedListSpacingAfter?: number;
    levels?: ListLevelOptions[];
}

interface ListLevelOptions {
    kind?: 'unordered' | 'ordered';
    markerStyle?:
        | 'disc'
        | 'bullet'
        | 'circle'
        | 'square'
        | 'decimal'
        | 'arabic-indic'
        | 'extended-arabic-indic'
        | 'devanagari'
        | 'thai'
        | 'cjk-decimal'
        | 'cjk-ideographic'
        | 'hiragana'
        | 'katakana'
        | 'lower-alpha'
        | 'upper-alpha'
        | 'lower-roman'
        | 'upper-roman';
    markerText?: string;
    markerTextStyle?: ElementStyle;
    indent?: number;
    markerWidth?: number;
    markerGap?: number;
    itemSpacing?: number;
    nestedListSpacingBefore?: number;
    nestedListSpacingAfter?: number;
}
```

`indent` is the distance from the list container's left edge to the item body.
`markerWidth` is the marker column width, and `markerGap` is the space between
the marker column and the item body. Wrapped item lines continue at the item
body x-position, producing a hanging indent.

`markerText` overrides the generated marker label with a literal custom marker
for that list level, such as `>>`, `✓`, or `Q:`. It still creates a generated
marker box; callers should not repeat the marker in `list-item.content`.

`markerTextStyle` applies only to generated marker boxes. Use it for marker
color, font family, font size, weight, and similar text styling without leaking
that paint into the list item body.

Ordered marker styles support Latin, Roman, CJK, kana, and several locale digit
systems. `cjk-ideographic` emits informal Chinese number words such as `九.`,
`十.`, and `十一.`; `cjk-decimal` emits CJK digit substitution such as `一〇.`.
`hiragana` and `katakana` use Japanese kana sequences. `arabic-indic`,
`extended-arabic-indic`, `devanagari`, and `thai` substitute decimal digits in
their respective numeral systems. Marker text is still generated from list
structure; callers should not put these marker strings in `list-item.content`.

`itemSpacing` adds vertical space between sibling list items. It is owned by the
list actor, so pagination and continuation decisions include the same spacing
that will render. `nestedListSpacingBefore` and `nestedListSpacingAfter` add
space around nested list children without authoring spacer paragraphs.

`levels` provides per-depth defaults for native nested lists. `levels[0]`
applies to the declaring list, `levels[1]` applies to nested list children, and
so on. A nested `list` inherits the nearest ancestor level table unless it
declares its own `list.levels`; explicit options on the nested list override the
inherited level defaults.

Pagination may split lists at item boundaries or through a nested item body.
When a list item continues onto a later page, VMPrint suppresses the repeated
parent marker and keeps the continuation aligned to the item body.

---

## 11b. Strip (`type: "strip"`)

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

## 11c. Zone Map (`type: "zone-map"`)

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
    shape?: 'rect' | 'circle' | 'polygon';
    path?: string;
    exclusionAssembly?: StoryExclusionAssembly;
    zIndex?: number;
}
```

Any block element can float or use `story-absolute` if it carries explicit obstacle size through style `width` and `height`. Images may omit explicit size and derive it from intrinsic image dimensions.

`shape` defaults to `"rect"`. Use `"circle"` for circular carving, or
`"polygon"` together with `path` when you want an authored SVG silhouette.
`exclusionAssembly` lets one actor publish a compound field made from multiple
rect/circle/polygon members.

---

## 13b. `field-actor`

`field-actor` is the public visible body actor for world/map-style spatial
presence. It exists so callers do not need to model a rock, hazard, or
creature as `image + spatialField`.

```json
{
  "type": "field-actor",
  "content": "",
  "properties": {
    "style": {
      "width": 96,
      "height": 72,
      "backgroundColor": "#0f8b8d"
    },
    "spatialField": {
      "kind": "exclude",
      "hidden": false,
      "x": 180,
      "y": 120,
      "exclusionAssembly": {
        "members": [
          { "x": 0, "y": 10, "w": 42, "h": 42, "shape": "circle" },
          { "x": 28, "y": 18, "w": 46, "h": 18, "shape": "rect" },
          { "x": 54, "y": 0, "w": 42, "h": 42, "shape": "circle" }
        ]
      }
    }
  }
}
```

`field-actor` must declare `properties.style.width` and
`properties.style.height`.

---

## 13c. Column Span (`element.columnSpan`)

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
| `table-cell` | `content`, inline `children`, or block children such as `list` for nested cell flow. |
| `list` | `list-item` only. |
| `list-item` | Inline children plus block children such as nested `list`, `p`, `story`, `zone-map`, or `table`. |
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

### Native List Example

```json
{
  "type": "list",
  "list": {
    "kind": "ordered",
    "markerStyle": "cjk-ideographic",
    "start": 9,
    "indent": 34,
    "markerWidth": 24,
    "markerGap": 8,
    "levels": [
      { "kind": "ordered", "markerStyle": "cjk-ideographic", "indent": 34, "markerWidth": 24, "markerGap": 8 },
      { "kind": "unordered", "markerText": "✓", "indent": 24, "markerWidth": 14, "markerGap": 6 }
    ]
  },
  "children": [
    {
      "type": "list-item",
      "content": "Ninth item uses generated ideographic numbering.",
      "children": [
        {
          "type": "list",
          "children": [
            { "type": "list-item", "content": "Nested item uses a generated custom check marker." }
          ]
        }
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
| Native list option normalization | [engine/src/engine/layout/normalized-list.ts](https://github.com/cosmiciron/vmprint/blob/main/engine/src/engine/layout/normalized-list.ts) |
| Native list packager | [engine/src/engine/layout/packagers/list-packager.ts](https://github.com/cosmiciron/vmprint/blob/main/engine/src/engine/layout/packagers/list-packager.ts) |
| Spatial fixture normalization helper | [engine/tests/harness/spatialize.ts](https://github.com/cosmiciron/vmprint/blob/main/engine/tests/harness/spatialize.ts) |
| Architecture and Runtime Internals | [ENGINE-INTERNALS.md](https://github.com/cosmiciron/vmprint/blob/main/documents/ENGINE-INTERNALS.md) |
| Scripting API | [scripting.html](./scripting.html) |
| Overlay system | [overlay.html](./overlay.html) |
| Standard fonts | [standard-fonts.html](./standard-fonts.html) |
| Testing guide | [TESTING.md](https://github.com/cosmiciron/vmprint/blob/main/documents/TESTING.md) |
| Markdown compilation core | [External](https://github.com/cosmiciron/vmprint-transmuters/blob/main/markdown-core/src/index.ts) |
| Transmuters | [External](https://github.com/cosmiciron/vmprint-transmuters) |
| Regression fixtures | [engine/tests/fixtures](https://github.com/cosmiciron/vmprint/tree/main/engine/tests/fixtures) |
