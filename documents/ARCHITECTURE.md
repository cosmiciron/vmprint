# VMPrint Architecture Overview

This document is for developers who want to contribute to, extend, or embed VMPrint. It describes the main architectural boundaries, the data flow from source input to rendered output, and the runtime properties the engine is designed to preserve.

## 1. Four-Layer Architecture

VMPrint is a deterministic document layout engine. You provide a JSON document description plus a rendering context, and the engine produces a paginated collection of positioned boxes.

It is not a headless browser. It does not parse HTML or CSS, and it does not delegate layout to a DOM implementation. The engine owns layout directly.

The repo is organized around four layers:

- **Layer 1 - Simulation Kernel**: Stable actor identity, mutable world state, spatial boundaries, snapshots, and rollback primitives.
- **Layer 2 - Engine Systems**: Runtime orchestration, collision handling, transitions, eventing, and speculative branching support.
- **Layer 3 - Document Semantics**: Text shaping, font resolution, script handling, and transformation from author-facing JSON into executable layout units.
- **Layer 4 - Rendering Handoff**: Conversion of settled page geometry into graphics-context calls such as PDF output.

## 2. Repository Layout

```text
VMPrint/
|-- contracts/          Shared interfaces
|-- engine/             Core layout and rendering pipeline
|   `-- src/engine/
|       |-- types.ts
|       |-- layout-engine.ts
|       |-- renderer.ts
|       `-- layout/
|           |-- kernel.ts
|           |-- layout-session.ts
|           |-- physics-runtime.ts
|           |-- actor-event-bus.ts
|           |-- layout-core.ts
|           `-- packagers/
|-- contexts/           Output context implementations
|-- font-managers/      Font loading implementations
|-- transmuters/        Source-to-DocumentInput translators
|-- draft2final/        Markdown-first authoring CLI
`-- cli/                Standard vmprint CLI
```

## 3. Data Flow

The main flow is:

1. Source content is normalized into VMPrint's `DocumentInput` JSON shape.
2. Fonts, styles, and inline semantics are resolved into shaped line fragments.
3. Elements are converted into executable layout units with measurable geometry.
4. The layout runtime paginates those units into a flat `Page[]` model.
5. The renderer paints the resulting page geometry through a `Context` implementation.

The important invariant is that rendering does not need to rediscover layout. By the time a page reaches the renderer, positions, dimensions, and provenance metadata have already been computed.

## 4. Layout Model

VMPrint treats layout as spatial negotiation among executable units rather than as recursive DOM flow.

Important properties:

- Elements can split when constraints require it.
- Split decisions can carry continuation metadata and synthetic markers.
- Multi-column flow, floats, tables, and page-boundary transitions are resolved inside the engine runtime.
- Output is flattened into page-local boxes so downstream consumers can inspect, diff, cache, or replay results without reconstructing an internal tree.

## 5. Speculation and Determinism

VMPrint supports speculative branching for genuinely ambiguous layout seams, but speculative machinery is not meant to become the default cost model for routine forward layout.

Architectural rules:

- Committed forward layout is the default mode.
- Speculative layout must be entered intentionally.
- Snapshots are justified only when a trial mutation is required to judge correctness.
- Routine page advance and routine actor commitment should not pay ambient rollback costs.

This boundary keeps deterministic layout fast while still allowing targeted lookahead when the engine truly needs it.

## 6. Output and Provenance

The engine settles into a flat page model:

- Each page contains absolute-positioned boxes.
- Boxes retain semantic provenance such as source identity, fragment index, and continuation state.
- That page model can be regression-tested, serialized, cached, or rendered through different contexts.

This is one of the main architectural advantages of the system: layout output is inspectable and portable rather than trapped inside a renderer-specific scene graph.

## 7. Extension Points

VMPrint is designed to be extended at clear seams:

- **Font managers** decide how fonts are discovered and loaded.
- **Contexts** decide how settled page geometry is painted.
- **Transmuters** decide how upstream authoring formats map into `DocumentInput`.
- **Overlays** can instrument or annotate pages without changing the core layout result.

## 8. Architectural Outcomes

The current architecture is designed to preserve these properties:

- Deterministic layout for identical inputs
- Clear separation between shaping, layout, and rendering
- Portable `Page[]` output
- Swap-in rendering and font-loading implementations
- Testability through layout snapshots and structural invariants

For the current detailed runtime model, see
[SIMULATION-RUNTIME.md](/c:/Users/cosmic/Projects/vmprint/documents/SIMULATION-RUNTIME.md).
Focused spatial deep-dives remain in
[WORLD-MAP.md](/c:/Users/cosmic/Projects/vmprint/documents/WORLD-MAP.md),
[LAYOUT-ZONES.md](/c:/Users/cosmic/Projects/vmprint/documents/LAYOUT-ZONES.md),
and [SPATIAL-IR.md](/c:/Users/cosmic/Projects/vmprint/documents/SPATIAL-IR.md).
