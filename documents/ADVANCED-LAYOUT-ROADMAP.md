# Advanced Layout Roadmap

## Executive Summary
The VMPrint engine currently excels at producing single-flow, DTP-style documents with exceptional typographic precision. However, when creating complex, magazine- or newspaper-style layouts, the current architecture requires brittle, hand-tuned content lengths. While users can cleverly simulate grids and sidebars by perfectly balancing text volume inside a single `story` block, these layouts break if the content length changes dynamically. 

This document details the current limitations of the system and proposes architectural enhancements to enable robust, dynamic, and structurally stable advanced layouts.

---

## 1. Macro-Layout Grids for Independent Flows

### Current Limitation
The standard method for side-by-side content arrangement in VMPrint is either the `story` block (which flows text sequentially from column to column) or the `table` element. However, `table-cell` elements currently only accept inline children. There is no container that allows side-by-side placement of independent block-level flows. To create a "sidebar", users must currently force content into the last column of a `story` by manually tuning the exact word count of the preceding columns.

### Proposed Feature: Block-Level Tables or Structural Grids
* **Enhancement:** Modify the `table-cell` validation and layout logic to accept block elements (including nested `story` elements, headings, and paragraphs) instead of just inline children.
* **Alternative:** Introduce a dedicated `grid` block type with configurable rows and columns that accept independent arrays of block elements.
* **Benefit:** Allows developers to establish a fixed page geometry (e.g., a 70% left column for the main article and a 30% right column for a sidebar) where content flows independently within each region without spilling over into adjacent sections when lengths change.

---

## 2. Universal Block-Level Floats

**Status: Completed** — shipped in engine v0.3.2.

### ~~Current Limitation~~
~~The engine currently supports floating elements and text wrapping via `properties.layout: { mode: 'float' }`, but this feature is explicitly restricted to `image` elements. To wrap text around an information box, developers must use a transparent 1x1 placeholder image and absolutely position the text over it. Real text blocks, such as pull-quotes, cannot be natively floated.~~

### Implementation
`layout.mode: 'float'` now works on any block-level element. Non-image block floats require explicit `properties.style.width` and `properties.style.height`; if either is absent the element falls through to normal block layout. The 1×1 placeholder PNG workaround is no longer necessary.

See `documents/LAYOUT-SKILL.md` §8 and `documents/AST-REFERENCE.md` §13 for usage, and regression fixture `20-block-floats-and-column-span.json`.

---

## 3. Column Spanning Within Stories

**Status: Completed** — shipped in engine v0.3.2.

### ~~Current Limitation~~
~~In a multi-column `story`, content flows linearly. If a heading or a large image needs to span across multiple columns, it must be placed completely outside (above or below) the `story` container. It is currently impossible to have an element span across columns *in the middle* of a continuous flow without breaking the flow into two separate `story` blocks.~~

### Implementation
`properties.columnSpan: "all"` (or a number ≥ 2) can be set on any child of a multi-column `story`. The element is laid out at full story width, then column flow resets to column 1 below it.

See `documents/LAYOUT-SKILL.md` §8a and `documents/AST-REFERENCE.md` §13a for usage, and regression fixture `20-block-floats-and-column-span.json`.

---

## 4. Linked Content Frames (Non-Contiguous Flows)

### Current Limitation
The engine fundamentally operates on a single continuous document flow. If a front-page newspaper article needs to "Continue on Page 4", there is no structural mechanism to link independent layout frames across non-contiguous pages.

### Proposed Feature: Named Flows / Linked Regions
* **Enhancement:** Introduce the concept of named flows (e.g., assigning a `flowId` to a block of content) and target frames, allowing overflow text from one explicit box to seamlessly continue into another explicit box on a different page.
* **Benefit:** Enables true magazine and newspaper publishing where multiple articles can weave through a document, jumping over centerfolds or full-page advertisements, and landing accurately in pre-defined layout containers.

---

## Conclusion
VMPrint's typography and precision are already at a desktop-publishing tier. By implementing macro-grids, block-level floats, inline column spanning, and linked frames, the engine will evolve from a linear document generator into a fully robust, dynamic page-layout platform capable of handling highly variable, data-driven content safely.