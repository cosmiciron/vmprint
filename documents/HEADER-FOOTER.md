# Header and Footer Architecture

This document specifies the design for named page regions, headers and footers, in VMPrint.

---

## 1. Design Principles

### Name the concept, not the coordinate

Headers and footers are well-understood print concepts. They are not special cases of a generalized `PageRegion` abstraction. Using the specific names keeps the IR self-documenting and the mental model immediate. A document author thinks "I want a running header on odd pages", not "I want a region at y=36 with h=18".

### The engine owns the geometry

Header and footer dimensions are derived from the document's existing `margins` declaration. The top margin is the header's vertical budget; the bottom margin is the footer's. The author does not specify `x`, `y`, `w`, or `h`. If the margins change, the regions resize automatically.

### Content reuses the same box model, with region-safe semantics

A header or footer is a clipped rectangle. Inside it, the engine reuses the same flat box shaping and materialization pipeline it already uses for page content, but under a region-local layout context. This keeps implementation cost low and rendering behavior familiar.

Headers and footers are intended for lightweight, non-paginating content: paragraphs, rules, small images, and similar fixed-height compositions. Region content does not participate in page breaking. If content exceeds the region box, it is clipped.

To keep the engine fast and the mental model simple, simulation-sensitive behavior is disabled inside page regions:
- `pageBreakBefore` is ignored.
- `keepWithNext` is ignored.
- continuation and simulation markers are ignored.
- content does not split across pages.

Practical use will almost always be a single line of text or a rule. The model stays creator-friendly without promising full document-flow semantics inside a margin-sized box.

### Odd/even/firstPage targeting at the definition level

Running headers in real documents differ between odd and even pages (recto/verso) and are suppressed or replaced on a first page (chapter opener, title page). This is a declared property of the header/footer definition, not an override spread across individual elements.

### Per-page suppression via element properties

Individual elements in the flow can suppress or replace a header or footer on the page they land on. This replaces the current `layoutDirectives.suppressPageNumber` hack with a proper, extensible structure.

### This replaces the current page number API

The existing flat `showPageNumbers` / `pageNumberFormat` / `pageNumberOffset` / ... cluster in `LayoutConfig.layout` is removed. Page numbers become content placed inside a header or footer definition. There is no backwards compatibility shim.

---

## 2. IR Representation

### 2.1 Top-level additions to `DocumentInput`

```typescript
interface DocumentInput {
    documentVersion: '1.0';
    layout: LayoutConfig['layout'];                 // existing
    fonts: LayoutConfig['fonts'];                   // existing
    styles: Partial<Record<string, ElementStyle>>;  // existing
    elements: Element[];                            // existing

    header?: HeaderDefinition;                      // new
    footer?: FooterDefinition;                      // new
}
```

### 2.2 `HeaderDefinition` and `FooterDefinition`

```typescript
interface HeaderDefinition {
    /**
     * Used when no more specific selector matches.
     * Omit to render no header by default.
     */
    default?: HeaderContent;

    /**
     * Overrides `default` on the very first page of the document (page index 0).
     * Set to `null` to suppress the header on the first page.
     */
    firstPage?: HeaderContent | null;

    /**
     * Overrides `default` on odd-numbered physical pages (1, 3, 5, ...).
     */
    odd?: HeaderContent;

    /**
     * Overrides `default` on even-numbered physical pages (2, 4, 6, ...).
     */
    even?: HeaderContent;
}

interface FooterDefinition {
    default?: FooterContent | null;
    firstPage?: FooterContent | null;
    odd?: FooterContent;
    even?: FooterContent;
}
```

Selector precedence (highest to lowest): `firstPage` -> `odd`/`even` -> `default`.

Resolution is based on the physical document page:
- `firstPage` means page index `0`.
- `odd` / `even` mean physical 1-based page numbers `1, 2, 3, ...`.
- Selector logic is independent of whether a footer later displays a logical page number.

### 2.3 `HeaderContent` / `FooterContent`

Both share the same content shape. The named types are kept distinct for clarity and potential future divergence.

```typescript
interface HeaderContent {
    /**
     * Elements to lay out inside the region.
     */
    elements: Element[];

    /**
     * Optional style overrides applied to the region's containing box.
     * Controls background, borders, padding, etc.
     */
    style?: ElementStyle;
}

type FooterContent = HeaderContent;
```

`elements` uses the same IR as the main flow, but region content is laid out with region-safe semantics:
- no simulation
- no page splitting
- clipping on overflow

A typical header is a single `paragraph` element. A header with a decorative rule is a `paragraph` followed by a `rule` element.

### 2.4 Per-page element overrides

```typescript
interface ElementProperties {
    // ... existing fields ...

    /**
     * Overrides the document-level header/footer on the page this element
     * lands on during simulation.
     *
     * `null` suppresses the region entirely on that page.
     * An object replaces the region's content on that page.
     *
     * Evaluated after selector resolution (firstPage/odd/even/default),
     * so it wins over all of them.
     */
    pageOverrides?: {
        header?: HeaderContent | null;
        footer?: FooterContent | null;
    };
}
```

This replaces `layoutDirectives.suppressPageNumber`. A chapter opener that should have no header sets:

```json
{
  "type": "h1",
  "content": "Chapter One",
  "properties": {
    "pageOverrides": { "header": null, "footer": null }
  }
}
```

---

## 3. Geometry

Header and footer dimensions are computed from the page margins, not declared in the content.

The region rect is derived from margins by default. To keep the API creator-friendly without exposing page-space coordinates, optional inset fields may shrink the usable region inside the margin budget:

```typescript
layout: {
    ...
    headerInsetTop?: number;     // default 0
    headerInsetBottom?: number;  // default 0
    footerInsetTop?: number;     // default 0
    footerInsetBottom?: number;  // default 0
}
```

Default geometry:

```typescript
headerRect = {
    x: margin.left,
    y: headerInsetTop,
    w: page.width - margin.left - margin.right,
    h: max(0, margin.top - headerInsetTop - headerInsetBottom)
}

footerRect = {
    x: margin.left,
    y: page.height - margin.bottom + footerInsetTop,
    w: page.width - margin.left - margin.right,
    h: max(0, margin.bottom - footerInsetTop - footerInsetBottom)
}
```

If all inset fields are omitted, the entire top margin is the header region and the entire bottom margin is the footer region. The flow content area remains bounded by the full margins. Header and footer geometry lives inside the margin budget, not in the main content column.

---

## 4. Pipeline Integration

### 4.1 Baseline region resolution

Before the simulation loop processes page `N`, a cheap selector-resolution step determines the baseline region content for that page:

1. Resolve which `HeaderContent` applies to this page using selector precedence.
2. Resolve which `FooterContent` applies to this page.
3. Return `{ header: HeaderContent | null, footer: FooterContent | null }`.

At this stage, per-element `pageOverrides` are not yet applied. They are resolved in finalization once the engine knows which elements landed on which pages.

### 4.2 Exclusion zones

If a header or footer is present on a page, its bounding rect may be pre-declared as an exclusion in the page-level `SpatialMap` when that infrastructure exists. This is future-facing only. Today the main content column is already bounded by margins, so no additional runtime work is required.

### 4.3 Finalization phase

After all pages are simulated, a second pass over `Page[]`, extending the existing `finalizePagesWithCallbacks` pattern, processes headers and footers:

1. For each page, resolve any per-page override from the page's laid-out boxes.
2. Run `layoutRegion(content, regionRect, config)` using the existing shaping and materialization pipeline under a region-local layout context:
   - content width is `regionRect.w`
   - origin is `(regionRect.x, regionRect.y)`
   - region content is clipped to `regionRect`
   - no simulation or splitting occurs inside the region
3. Append those boxes to `page.boxes` with a distinct `meta.sourceType` (`'header'` / `'footer'`).

This keeps headers and footers outside the main simulation loop, avoids cursor interaction, and limits additional cost to one lightweight post-pass per page.

### 4.4 Override precedence on a page

`pageOverrides` must resolve deterministically and cheaply.

Rule:
1. Inspect boxes on the page in reading order.
2. Consider only boxes whose source element defines `pageOverrides`.
3. Collapse multiple boxes from the same source element to a single candidate.
4. The first non-continuation source element on the page wins.
5. If every candidate comes from continuation fragments, the first candidate wins.

This makes chapter openers and similar leading elements behave predictably without introducing expensive or complex conflict logic.

### 4.5 Replacement of the existing page number system

The existing page number machinery (`showPageNumbers`, `pageNumberFormat`, `pageNumberOffset`, etc.) and the `finalizePagesWithCallbacks` implementation that drives it are removed.

The canonical way to put a page number in a footer is:

```json
"footer": {
  "default": {
    "elements": [{
      "type": "paragraph",
      "content": "{pageNumber}",
      "properties": { "style": { "textAlign": "center" } }
    }]
  }
}
```

Reserved substitutions are handled during finalization:

- `{physicalPageNumber}`: the physical 1-based page index in the document.
- `{logicalPageNumber}`: the visible running page number used for publication-style numbering.

`logicalPageNumber` follows these rules:
- numbering increments only on pages whose header or footer content actually renders a `{logicalPageNumber}` token
- numbering starts at `1`
- suppressing a header/footer on a page also suppresses the token on that page, so numbering skips naturally

For creator ergonomics, `{pageNumber}` is accepted as an alias of `{logicalPageNumber}`.

The `suppressPageNumber` field on `ElementLayoutDirectives` is removed. Per-page suppression is handled entirely through `pageOverrides`.

---

## 5. Design Boundaries

**What headers and footers are:**
- Page-anchored clipped regions.
- Rendered with the same shaping and materialization pipeline as page content, under a region-local context.
- Defined once in the document IR, not repeated per element.

**What headers and footers are not:**
- Flow participants. They do not advance the main cursor.
- Coordinate-addressed. Authors declare content, not geometry.
- Generalized regions. There is no arbitrary-named region API. If a future "side margin annotation" feature is needed, it will be its own named concept with its own semantics, not a parameter on a generic container.

**What is explicitly out of scope for this design:**
- Headers/footers that paginate internally. The region is sized to its margin budget; content that overflows is clipped.
- Per-section header changes driven by section elements. A future `SectionDefinition` concept would address this. For now, `firstPage`/`odd`/`even`/`default` covers the overwhelming majority of real documents.
- A general rich templating language for page metadata. Only a small reserved token set is supported.
- Running expensive region layout during the main simulation loop. Region rendering happens only in finalization.
