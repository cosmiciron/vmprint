# VMPrint Architecture Overview

This document is aimed at developers who want to contribute to, extend, or embed VMPrint. It covers how the system is structured, why key decisions were made, and what distinguishes it from more conventional layout approaches.

---

## 1. Core Philosophy: The Four-Layer Architecture

VMPrint is a deterministic spatiotemporal document layout simulation engine. You feed it a JSON document description and a rendering context, and it produces a paginated collection of positioned boxes. 

It is **not** a headless browser. It does not parse HTML or CSS, nor does it rely on a recursive DOM traversal to "paint" text. Instead, it functions as a programmatic Desktop Publishing Virtual Machine operating on spatial physics. Pages are bounded spatial arenas, document elements are autonomous transformable actors navigating a constraint field, and layout is the process of reaching spatial equilibrium.

To achieve this cleanly, the engine enforces a strict four-layer architecture separating mathematics from typographic semantics:

- **Layer 1 — Simulation Kernel (The Substrate)**: Built purely on physical foundations (`kernel.ts`), this layer is deliberately devoid of typographic awareness. It exclusively controls mutable world state, stable actor identity, spatial boundaries, and bit-for-bit deterministic state snapshot and rollback primitives.
- **Layer 2 — Engine Systems (The Runtime)**: The lateral execution plane operating above the Kernel. It governs physical constraint resolution (`physics-runtime.ts`), check-pointing, multi-actor transitions across boundaries, and the transactional inter-actor communication bus.
- **Layer 3 — Document Semantics**: The translation layer that shapes text, parses fonts, and maps user-authored JSON Abstract Syntax Trees into executable "Simulation Actors" with explicit geometries and padding.
- **Layer 4 — Print/Composition Handoff**: The output layer (`renderer.ts`) converting the final, settled flat spatial coordinates into renderable composition targets like PDF streams or WebGL buffers.

---

## 2. Repository Layout

```
VMPrintStack/
├── contracts/          VMPrint-level interfaces (Context, FontManager, OverlayProvider).
├── engine/             Core layout and physics logic.
│   └── src/engine/
│       ├── types.ts            All shared data structures (DocumentInput, Box, Page, …)
│       ├── layout-engine.ts    Public orchestration entry point
│       ├── renderer.ts         Layer 4: Consumes flat pages, paints boxes
│       └── layout/
│           ├── kernel.ts                   Layer 1: Simulation Kernel (Substrate)
│           ├── layout-session.ts           Layer 2: Engine Systems orchestrator
│           ├── physics-runtime.ts          Layer 2: Constraint field collision physics
│           ├── ai-runtime.ts               Layer 2: Speculative pathfinding
│           ├── actor-event-bus.ts          Layer 2: Transactional telemetry communication
│           ├── layout-core.ts              Layer 3: Element shaping and text resolution
│           └── packagers/
│               ├── execute-simulation-march.ts  The main physical simulation loop
│               ├── story-packager.ts       Actor: DTP text flow (resolves float/wrap)
│               ├── table-packager.ts       Actor: Multi-column Table layout
│               └── spatial-map.ts          Collision geometry mapping
│
├── contexts/pdf/       PDF rendering context implementation (wraps PDFKit)
├── transmuters/        Source-to-AST translation (Markdown -> JSON IR)
├── draft2final/        CLI orchestration (Transmuter -> Engine -> Output)
└── cli/                Standard `vmprint` CLI
```

---

## 3. Data Flow & Shaping

The journey from user input to physical layout requires translating continuous streams of heavily formatted text into discrete geometric actors.

### The Document IR (`DocumentInput`)
`DocumentInput` is the vmprint-native input format. It is a plain, schema-enforced JSON object containing style dictionaries, font declarations, and an array of raw element data blocks (headings, paragraphs, tables). There is no native code AST class hierarchy at this stage; it is pure, serializable data.

### Typographic Shaping & Font Management
Font loading is handled via a `FontManager` interface. The `TextProcessor` natively performs grapheme cluster segmentation, optical scaling, Arabic bidirectional string slicing, and hyphenation utilizing `fontkit`. 

### Microscopic Flat-Boxing (`RichLine` Segments)
A core strength of the engine is that formatting complexity does not bleed up into the layout physics. The `TextProcessor` intelligently slices raw paragraph strings into discrete, entirely independent semantic arrays called `RichLines`. 
- **Mixed Scripts**: Foreign texts (e.g., Arabic or CJK inside Latin text) are automatically segmented, scaled optically, and assigned appropriate fallback fonts natively.
- **Inline Elements**: Inline images or specifically styled spans (`<code>`, `<strong>`) become independent bounding boxes sitting natively on the baseline.

### Explicit Glyph-Level Precision
Because VMPrint implements its own shaping layer, it computes and retains the absolute `X/Y` coordinate data for every single printable character (including contextual forms for complex scripts like Arabic via `ShapedGlyph` arrays). This microscopic data is embedded directly into the layout fragments, ensuring that character positioning is never lazily pushed down to the rendering backend for interpretation.

### The Engine IR (`FlowBox`)
Before elements are submitted to the spatial simulator, they are converted into `FlowBoxes`. This constitutes the fully shaped but not-yet-positioned state. A `FlowBox` contains the unrolled `RichLine` sequences, total measured required height, orphans/widows rules, and margin directives. The heavy lifting of text layout has concluded; going forward, the engine only cares about navigating these rigid bounding blocks.

---

## 4. Layout Mechanics: The Spatial Simulator

Classic engines use a recursive single pass to lay out a document. VMPrint instead fields "Actors" into a "Constraint Field." 

### Simulator & Actor Mechanics
Every conceptual block is wrapped into a programmatic `PackagerUnit` (an Actor) which enforces a rigorous physical contract (`emitBoxes()`, `split()`, `getRequiredHeight()`). 

The core loop (`executeSimulationMarch()`) executes a continuous physics tick:
1. It requests the Physics Runtime to measure the actor's vertical requirements.
2. It tests spatial bounds against `ConstraintField` geometries (accounting for "floating" image exclusions acting as physical blockers).
3. If it fits, it successfully yields `emitBoxes()`.
4. If it collides or overflows, it forces the actor to `split()`, generating a continuation fragment for the next available geometric boundary (e.g., the next page).

The march loop is type-agnostic. Adding new layout structures (like mathematical equation blocks) merely involves writing a new Actor `PackagerUnit` that respects the overarching physical collision contract.

### Speculative Branching & Determinism
To resolve layout decisions that require foresight (like keeping a caption "with next", or balancing multi-column run-offs), VMPrint utilizes deterministic heuristic lookaheads via the `AIRuntime`.
It commands the Kernel to take O(1) shallow memory snapshots, provisionally marches the actor into a virtual future state, grades the collision outcomes, and if the layout logic is unsound, it triggers an instantaneous stateless rollback safely.

This needs one hard clarification.

Snapshots belong to the speculative lane, not to ordinary forward layout.

What justified snapshots originally was the Schrodinger-style case: the engine was
about to enter a genuinely ambiguous seam, could not know the right outcome
without partial execution, and therefore needed a reversible trial branch.

That is valid.

What is not valid is broadening the same mechanism into an ambient insurance
policy recorded at routine actor/page boundaries "just in case" something later
might want a rollback. Long-document profiling has now shown the failure mode of
that broadening clearly: deterministic progression begins paying speculative
costs continuously even when the rollback path is never used.

So the architectural rule is now explicit:

* committed forward layout is the default mode
* speculative layout must be entered intentionally
* snapshots are justified only for speculative mutation whose correctness cannot
  be known without trial execution and whose failure would require restoration
* routine paragraph flow, routine page advance, and normal actor commitment
  must not pay ambient checkpoint costs

VMPrint should follow the same discipline used in mature simulation and game
engines:

* normal world update runs forward
* rollback exists, but only inside explicit prediction / speculative subsystems
* the engine does not deep-clone world state at every routine boundary

If snapshots appear to be required everywhere, then the architecture has likely
failed to distinguish deterministic progression from speculative branching.

The concrete transaction model for this lane is defined in
`documents/SPECULATIVE-TRANSACTIONS.md`.

### Transactional Inter-Actor Communication
Actors often need to coordinate across vast page divides (e.g., a Table of Contents requiring downstream chapter numbers). Instead of brittle 2-pass AST rewrites, VMPrint utilizes a transactional **Actor Event Bus**.
- Downstream actors publish immutable telemetry snapshots.
- If an upstream **Committed Observer** (like the TOC) receives new telemetry that breaks its geometric boundaries, the engine issues a **Targeted Dirty-Frontier Resimulation**, safely winding back physical time to the specific upstream checkpoint without requiring a full document restart.

### Continuation Markers
When an actor splits across a page boundary (e.g., a massive table), the Transitions Runtime intelligently weaves synthetic, fully-shaped formatting fragments ("(continued on next page)") squarely into the actor queue, forcing them to run the identical collision gauntlets as normal user structures.

---

## 5. Output Mechanics & Provenance

When the simulator reaches equilibrium, it settles into an output state optimized explicitly for rigid graphics environments rather than flowing web renderers.

### The All-Flat Box Model
Every element in the simulation, regardless of semantic nesting, is ultimately flattened into a 1-dimensional array of `Box` objects mapped to a specific `Page`. There are no hierarchies, flexboxes, or containing containers emitted. The renderer simply loops over `page.boxes[]`, sorts them by their Z-index, and blindly paints geometry directly onto the graphics context at absolute canvas coordinates.

### Semantic Provenance (`BoxMeta`)
A fatal flaw of traditional PDF engines is the loss of structured data upon vectorization. VMPrint solves this via rigorous physical traceability.
Every flat output `Box` carries a `BoxMeta` object:
```typescript
{ sourceId: 'ast-node-10', fragmentIndex: 2, transformKind: 'split', isContinuation: true }
```
A consumer can sequentially stitch the absolute visual bounds back together across multiple physical pages to perfectly recreate the underlying interactive semantic tree.

### The Context Abstraction & Rendering
The output vectors communicate to endpoints via a rigorous, graphics-agnostic `Context` interface. The engine produces identical output artifacts—regardless of whether they are routed through the `contexts/pdf/` Node.js pipeline printing physically to CMYK bytes, or mapped onto an HTML5 canvas layer running in chrome.

### Scriptable Overlay Architecture
Because pages are guaranteed pure arrays of bounded geometry, developers can seamlessly inject highly complex custom logic into the engine via the **Overlay Provider Hook**:
```typescript
interface OverlayProvider {
    backdrop?(page: OverlayPage, context: OverlayContext): void;
    overlay?(page: OverlayPage, context: OverlayContext): void;
}
```
Diagnostic logic can parse the `OverlayBox[]` arrays and draw analytical highlight layers, grid tracking lines, crop marks, and source-code alignment mappings instantly using the native `Context` drawing commands.

---

## 6. System Properties Enabled by Architecture

By discarding DOM paradigms in favor of deterministic spatial physics arrays, the system yields several powerful emergent invariants:

1. **Pre-Compiled JSON Streaming:** Because the core output object (`AnnotatedLayoutStream`) is pure JSON encapsulating absolute spatial physics and font shaping, cloud backends can "pre-compile" heavy documents. Lightweight web viewers or mobile endpoints can simply download the final JSON arrays and execute blazing fast text rendering with literally zero computation algorithms required client-side.
2. **GPU-Optimized Scene Graphs:** A `Page[]` of purely absolute bounding boxes containing explicit `X/Y` mapped character glyphs translates natively into 1:1 textured 2D quad arrays. Native graphics solutions (WebGL/WebGPU) can swallow the layout output directly, delivering millions of perfectly set typographical polygons at 60 fps devoid of UI thread layout lockups.
3. **Snapshot Regression Testing:** VMPrint does not require fuzzy, error-prone visual image diff algorithms to prove stability. The regression framework (`engine-regression.spec.ts`) strictly asserts exact JSON data structures. A sub-pixel deviation in a font-width update triggers a surgical string-diff failure, highlighting the precise actor ID that deviated.
4. **Identical Output Across Surfaces:** By separating mathematical layout completely from graphics rendering pipelines, the classic "rendered differently on Windows vs Mac" problem is entirely eradicated.

---

## 7. Summary of Key Design Properties

| Property | Implementation Foundation |
|---|---|
| Four-Layer Boundary | Hardware-like Kernel isolated from typography heuristics |
| Spatiotemporal Physics | Physics runtime tests autonomous actors against continuous `ConstraintField`s |
| Speculative Lookahead | Deterministic snapshots are reserved for explicit speculative branches, not ambient progression |
| Single-Pass Tooling | Transactional Event Bus assemblies downstream telemetry targets inline |
| Flat Spatial Output | Deep hierarchies reduce perfectly to absolute, 1-dimensional `Box[]` boundaries |
| Semantic Provenance | Object `BoxMeta` traces absolute visual bounds securely back to source AST nodes |
| Glyph-Level Precision | Render targets are fed raw `{ char, x, y }` coordinates sidestepping external bugs |
| GPU-Ready Format | `Page[]` is a pre-calculated vector scene graph requiring zero display-thread blocking |
| Pre-Compiled Caching | Deterministic JSON layouts provide massively accelerated client-side streaming |
| Identical Cross-Surface | Strict segregation of spatial layout vs independent graphics rendering contexts |
| Scriptable Overlays | Hook architecture enables drawing custom analytics precisely onto settled layout arrays |
