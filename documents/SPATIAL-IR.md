# Spatial IR (Intermediate Representation)

This document defines VMPrint's **Spatial IR** (Intermediate Representation) — the normalized, lowered representation of a document that sits between the author-facing, hierarchical semantic AST (`DocumentInput` / `DocumentIR`) and the physical simulation actors (`PackagerUnit` / `LayoutProcessor`) running on the engine board.

For the broader system map, see [ARCHITECTURE.md](ARCHITECTURE.md). For layout engine internals, see [ENGINE-INTERNALS.md](ENGINE-INTERNALS.md).

---

## 1. Overview & Architectural Role

Every document in VMPrint begins as a semantic hierarchical tree: the author-facing **AST** (`DocumentInput`). In this AST, elements express meaning and structure (e.g., a table has rows, a story has paragraphs, styles are looked up from a document-level stylesheet).

Before simulation starts, the engine compiles and normalizes this AST into the **Spatial IR**. The Spatial IR serves as a "board setup" for the simulation kernel:

```text
       Author-Facing AST (DocumentInput / DocumentIR)
                            ↓
                [ AST Normalization Phase ]
      (Resolves styles, page templates, columns & grid tracks)
                            ↓
                 Spatial IR (SpatialDocument)
                            ↓
             [ Actor Instantiation Phase ]
          (Maps Spatial IR items to PackagerUnits)
                            ↓
                 Live Simulation Session
```

### Key Differences: AST vs. Spatial IR

| Characteristic | Author-Facing AST | Spatial IR |
| :--- | :--- | :--- |
| **Hierarchy** | Deeply nested (e.g., `table` -> `table-row` -> `table-cell` -> `p`). | Flattened sequence of block-level layout participants (`SpatialZoneContentItem`). |
| **Sizing / Coordinates** | High-level, abstract (e.g., `width: "50%"`, `columns: 3`, CSS-like track modes `flex`, `auto`). | Pre-resolved absolute-relative offsets, solved track sizes, and coordinates in points (e.g., `{ x: 24, width: 120 }`). |
| **Styles** | Inherited and referenced styles via a document-level `styles` table. | Flattened, resolved, and merged inline style records on each individual item. |
| **Viewports / Margins** | Declared in document-level `layout` or polymorphic page templates. | Lowered into concrete, compiled page regions (`firstPage`, `odd`, `even`, `default`) with absolute boundaries. |
| **Provenance** | Native source structure. | Traced via explicit `SpatialSourceRef` properties to allow bi-directional mapping during simulation. |

---

## 2. Design Principles

### Pre-Resolved Layout Geometry
The Spatial IR pre-calculates layout variables that do not require full flow simulation. For example, columns in multi-column stories and tables are pre-solved using track-sizing algorithms (`solveTrackSizing`) based on parent content widths and column gaps. This resolves flex/auto/fixed sizing into exact relative `x` coordinates and `width` values, reducing layout logic to a physical simulation of flow height and page splitting.

### Hierarchy Flattening
Deeply nested semantic structures are flattened into a simple sequence of block-level layout participants (`SpatialZoneContentItem`). For example:
- A multi-column story is divided into **linked zone strips** (`SpatialZoneStrip` with `overflow: 'linked'`) separated by column-spanning elements.
- A table is lowered to a **spatial grid** (`SpatialGrid`) consisting of solved column metrics and a flat list of cell objects (`SpatialGridCell`), each hosting its own isolated flow content.

### Provenance Mapping (Traceability)
Every block in the Spatial IR carries a `SpatialSourceRef` containing:
- `path`: The exact path back to the source AST element (e.g., `elements[0].children[2]`).
- `sourceId`, `semanticRole`, `reflowKey`: Metadata to locate and identity actors.
- `__elementProperties`: Original AST property values.

This bi-directional traceability allows the layout engine, simulation clock, and debugging tools to map flat, absolutely positioned output boxes back to the original AST source. This guarantees correctness when live scripts mutate the document mid-simulation: the engine can trace the change to a specific frontier, swap the actor, and resimulate downstream elements seamlessly.

---

## 3. Format & Schema Reference

The Spatial IR is defined in [spatial-document.ts](file:///Users/cosmiciron/Projects/vmprint/engine/src/engine/spatial-document.ts). The structure of a compiled document is represented by the `SpatialDocument` interface.

```typescript
export interface SpatialDocument {
    spatialIrVersion?: string;
    pageTemplate?: {
        header?: SpatialCompiledPageRegionSet;
        footer?: SpatialCompiledPageRegionSet;
    };
    items: SpatialZoneContentItem[];
}
```

### Compiled Page Regions
Page templates (headers and footers) are compiled relative to page geometry and margins, mapping to specific selectors.

```typescript
export interface SpatialCompiledPageRegionSet {
    default?: SpatialCompiledPageRegion | null;
    firstPage?: SpatialCompiledPageRegion | null;
    odd?: SpatialCompiledPageRegion | null;
    even?: SpatialCompiledPageRegion | null;
}

export interface SpatialCompiledPageRegion {
    kind: 'page-region';
    role: 'header' | 'footer';
    selector: 'default' | 'firstPage' | 'odd' | 'even';
    x: number;
    y: number;
    width: number;
    height: number;
    style?: Record<string, unknown>;
    content: SpatialZoneContent;
}

export interface SpatialZoneContent {
    items: SpatialZoneContentItem[];
}
```

### Spatial Zone Content Items
A `SpatialZoneContentItem` represents a physical layout element. It is a union of four types:

```typescript
export type SpatialZoneContentItem =
    | SpatialFlowBlock
    | SpatialBlockObstacle
    | SpatialZoneStrip
    | SpatialGrid;
```

---

### A. `SpatialFlowBlock`
Represents block-level elements that flow sequentially (paragraphs, headings, blockquotes, images, etc.).

```typescript
export interface SpatialFlowBlock {
    kind: 'flow-block';
    sourceType: string;         // The original AST tag name (e.g., 'p', 'h1', 'blockquote')
    content: string;            // Plain text content of the block
    children?: Element[];       // Inline children (such as bold/italic text runs)
    columnSpan?: 'all' | number;
    style: Record<string, unknown>; // Flattened, merged CSS style properties
    keepWithNext: boolean;
    pageBreakBefore: boolean;
    allowLineSplit: boolean;    // Control whether the block can split across pages
    overflowPolicy: 'clip' | 'move-whole' | 'error';
    dropCap?: Record<string, unknown>;
    paginationContinuation?: Record<string, unknown>;
    pageReservationAfter?: number;
    image?: {
        data?: string;          // Base64-encoded image payload
        mimeType: string;
        intrinsicWidth: number;
        intrinsicHeight: number;
        fit: 'contain' | 'fill';
    };
    pageOverrides?: {
        header?: SpatialCompiledPageRegion | null;
        footer?: SpatialCompiledPageRegion | null;
    };
    source: SpatialSourceRef;
}
```

---

### B. `SpatialBlockObstacle`
Represents floating or absolute layout elements that claim space and push surrounding text flow around them.

```typescript
export interface SpatialBlockObstacle {
    kind: 'block-obstacle';
    resolvedX: number;          // Solved relative X position within parent content box
    width: number;
    height: number;
    wrap: 'around' | 'top-bottom' | 'none';
    gap: number;                // Space to preserve around the obstacle
    yAnchor: 'at-cursor';
    align: 'left' | 'center' | 'right';
    mode: 'float' | 'story-absolute';
    shape?: 'rect' | 'circle' | 'ellipse' | 'polygon';
    path?: string;              // Specific clipping path when shape is 'polygon'
    exclusionAssembly?: {
        members: Array<{
            x: number;
            y: number;
            w: number;
            h: number;
            shape?: 'rect' | 'circle' | 'ellipse' | 'polygon';
            path?: string;
            zIndex?: number;
            traversalInteraction?: TraversalInteractionPolicy;
            resistance?: number; // Spatial resistance (0 to 1) for text wrap
        }>;
    };
    zIndex?: number;
    content: SpatialFlowBlock;  // The block payload inside the obstacle
    source: SpatialSourceRef;
}
```

---

### C. `SpatialZoneStrip`
Represents a multi-column story layout or independent zone mapping.

```typescript
export interface SpatialZoneStrip {
    kind: 'zone-strip';
    overflow: 'linked' | 'independent';
    sourceKind: 'story' | 'zone-map';
    zones: SpatialZone[];
    content?: SpatialZoneContent; // Holds flowing content for 'linked' strips
    balance?: boolean;            // Whether to balance column heights
    blockStyle?: Record<string, unknown>;
    placement?: Record<string, unknown>;
    frameOverflow?: 'move-whole' | 'continue';
    worldBehavior?: 'fixed' | 'spanning';
    source: SpatialSourceRef;
}

export interface SpatialZone {
    id?: string;
    x: number;                    // Solved relative offset from strip origin
    y?: number;
    width: number;                // Solved width of the column zone
    height?: number;
    style?: Record<string, unknown>;
    content?: SpatialZoneContent; // Holds independent contents for 'independent' strips
}
```

---

### D. `SpatialGrid`
Represents tables or tabular layouts. Grids resolve column width configurations and express cells in a flat list mapped to rows and columns.

```typescript
export interface SpatialGrid {
    kind: 'spatial-grid';
    resolvedColumns: SpatialResolvedColumn[];
    columns?: TableColumnSizing[];
    columnGap: number;
    rowGap: number;
    headerRows: number;
    repeatHeader: boolean;        // Repeat header rows when splitting across viewports
    cells: SpatialGridCell[];     // Flat array of cells
    blockStyle?: Record<string, unknown>;
    cellStyle?: Record<string, unknown>;
    headerCellStyle?: Record<string, unknown>;
    paginationContinuation?: Record<string, unknown>;
    pageReservationAfter?: number;
    source: SpatialSourceRef;
}

export interface SpatialResolvedColumn {
    x: number;                    // Solved absolute X coordinate relative to table container
    width: number;                // Solved width of the column track
}

export interface SpatialGridCell {
    row: number;
    col: number;
    rowSpan: number;
    colSpan: number;
    resolvedX: number;            // Solved relative X position
    resolvedWidth: number;        // Solved cell width (accounting for spans and gaps)
    rowGroup?: 'header' | 'body' | 'footer';
    content: SpatialZoneContent;
    style: Record<string, unknown>;
    source: SpatialSourceRef;
}
```

---

### E. `SpatialSourceRef`
Guarantees bi-directional traceability, mapping the lowered element to its original position in the author-facing AST.

```typescript
export interface SpatialSourceRef {
    path: string;                      // E.g., "elements[3].children[1]"
    sourceId?: string;
    semanticRole?: string;
    reflowKey?: string;
    language?: string;
    sourceSyntax?: string;
    sourceRange?: Record<string, unknown>;
    __elementProperties?: Record<string, unknown>; // Passthrough container for scripting
}
```

---

## 4. Compilation & Normalization Phase

The AST-to-Spatial-IR translation runs in [spatialize.ts](file:///Users/cosmiciron/Projects/vmprint/engine/tests/harness/spatialize.ts) during testing and in the engine's initialization logic. It operates via several key steps:

### Style Merging & Resolution
1. The compiler traverses each AST element.
2. It looks up the element's `type` in the document-level `styles` sheet.
3. It merges the sheet style, the inline element style (`element.properties.style`), and any layout-specific modifiers into a single flat `style` dictionary on the target `SpatialFlowBlock`, `SpatialGridCell`, or `SpatialZoneStrip`.

### Column Sizing Resolution
For tables (`table`) and columns (`story` / `zone-map`), the compiler calls `solveTrackSizing()` to resolve abstract track definitions (e.g. `1fr`, `auto`, `100` points) into concrete widths. 
- Relative coordinates (`resolvedColumns` / `zones`) are assigned absolute offset values based on solved sizes and gaps.
- Spanning cells (`colSpan` / `rowSpan`) are assigned pre-summed widths (`resolvedWidth`) spanning across their target tracks.

### Story Segmentation
A multi-column story is divided into linked strips separated by column-spanning elements:
1. When compiling a `story` element with `columns > 1`, the compiler sweeps its children.
2. If a child block is a normal flow element, it is grouped into a linked segment.
3. If a child carries `columnSpan: "all"` (or span count $\ge 2$), the compiler closes the active column segment, emits a `SpatialZoneStrip` (with `overflow: 'linked'`), inserts the column-spanning `SpatialFlowBlock`, and opens a new segment.
4. This preserves flat flow order while allowing column-spans to act as physical break boundaries.

---

## 5. Settlement & Simulation Flow

Once Spatial IR is compiled, the engine executes the simulation:

1. **Instantiation**: The engine maps the flat `items` list of the `SpatialDocument` into live physical actors (`PackagerUnit` subclasses, e.g., `FlowBoxPackager`, `SpatialGridPackager`, `StoryPackager`).
2. **Page Templates**: Running page headers and footers from `pageTemplate` are sliced per page selector (`firstPage`, `odd`, `even`, `default`) onto the active page viewport.
3. **Simulation Loop**: The engine drives the simulation clock, negotiating height queries (`getRequiredHeight()`), layout fits, and splits (`split()`) along the explore frontier.
4. **Committed Output**: When the simulation settles, the engine walks the settled actors and calls `emitBoxes()` to yield the flat array of positioned `Box` primitives containing pre-shaped text segment runs (`RichLine`).

---

## 6. Notable Characteristics

### Bidi & Multilingual Baseline Stability
The Spatial IR retains rich text formatting, language metadata (`source.language`), and source syntax (`source.sourceSyntax`). This metadata allows the layout engine to perform font-aware text shaping, bidi analysis, and baseline alignment at layout time, yielding stable, unified baselines for multiple scripts (Latin, CJK, Devanagari, Arabic, etc.) on a single line.

### Transactional Communication Staging
As actors simulate and settle, they publish signals (e.g., heading actors publish structural indices). Observer actors (like TOC) subscribe to these signals.
- In speculative branches (e.g., widow/orphan lookahead), signals are isolated in provisional buffers.
- When a branch is rolled back, provisional signals are discarded.
- When committed, signals are promoted to the main bus, allowing observer actors to update their content reactively during the single simulation pass.

### Tier-2 Content-Only Updates
If an actor's content updates mid-simulation (such as a page number changing or script variable updating) but its required bounding dimensions remain identical:
- The engine marks it as a **Tier 2 (Content-Only)** update.
- It redraws the actor's boxes in-place without invalidating the dirty-frontier.
- It avoids running a resettlement sweep over downstream actors, ensuring high-performance, real-time rendering updates.
