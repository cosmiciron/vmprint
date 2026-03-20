# VMPrint Engine Internals - Technical Architecture & Design Reference

This document provides a comprehensive technical overview of the VMPrint engine's architecture, internal representation, and runtime mechanics. It is designed for AI assistants and contributors who need to understand the engine's core intricacies.

---

## 1. Core Philosophy: The World as Simulation

VMPrint is a **deterministic document simulation engine**, not a traditional typesetter or a headless browser.

### 1.1 The World vs. The Page
- **The World is Primary**: The document is a continuous 2D spatial surface (the "world").
- **Pages are Viewports**: A page is a viewport or a local map projection onto a slice of the continuous world.
- **Continuous Tape**: `worldY` is one continuous coordinate system. Page breaks are viewport shifts, not ruptures in existence.
- **Terrain as Physics**: Margins, headers, footers, and exclusions are non-playable "terrain"—collision geometry that shapes the playable space but does not belong to any content zone.

### 1.2 Simulation Model
- **Stable Actor Identity**: Elements (paragraphs, tables, etc.) are "actors" with stable identities moving through constrained space.
- **Discrete Clock**: The kernel owns a discrete simulation clock. Time advances as the simulation inhabits the world.
- **Deterministic Outcomes**: Identical inputs always produce identical spatial outcomes.

---

## 2. Four-Layer Architecture

VMPrint is organized into four distinct layers:

1.  **Layer 1 - Simulation Kernel**: Stable actor identity, mutable world state, simulation clock, snapshots, and rollback primitives.
2.  **Layer 2 - Engine Systems**: Runtime orchestration (the "march"), checkpoint settlement, observer sweeps, and speculative branching support.
3.  **Layer 3 - Document Semantics**: Normalization from AST to Spatial IR, text shaping, font resolution, and script handling.
4.  **Layer 4 - Rendering Handoff**: Conversion of settled page geometry (positioned boxes) into graphics calls (e.g., PDF output).

---

## 3. Actor Model & Reactive Signaling

### 3.1 Actors
Actors are the native inhabitants of document worlds.
- **In-Engine Actors**: The engine owns domain-native actors like Paragraphs, Tables, Stories, and TOCs.
- **Lifecycle**: Actors have hooks for measurement, placement, and reaction.
- **Stepped Actors**: Some actors can participate in simulation ticks even without external signals.

### 3.2 Signals and Observers
The communication substrate uses topic-based subscriptions and signal publication.
- **Committed Fact**: When an actor's geometry is settled, it publishes a world fact.
- **Observer Sweep**: Interested actors (e.g., Table of Contents) observe these facts and may request resettlement.
- **Update Classification**:
    - `content-only`: Redraw in place (e.g., total page count).
    - `geometry`: Requires a checkpoint-based replay (e.g., TOC growth).

---

## 4. Spatial Intermediate Representation (Spatial IR)

The Spatial IR is the normalized internal form of the document, resolving as much geometry as possible before the simulation begins.

### 4.1 Normalization Boundary
- **Normalize-Time**: Track sizing, zone widths, obstacle X-positions, and style merging are resolved. Tree hierarchy (DOM-like) is flattened.
- **March-Time**: Obstacle Y-anchors, row heights (content-dependent), line breaks, and page assignments are resolved.

### 4.2 IR Node Catalogue
- **ZoneStrip**: Represents both `story` (linked lanes) and `zone-map` (independent regions).
- **SpatialGrid**: Represents a constrained grid (table) with pre-resolved column widths.
- **FlowBlock**: A single block of text participating in flow, carrying processed styles and content.
- **BlockObstacle**: A pre-resolved spatial obstacle (float) with an anchor point in the flow.

---

## 5. Layout Systems & Intricacies

### 5.1 Spatial Partitioning: Layout Zones
Zones are bounded regional contexts with local coordinate spaces.
- **Parallelism**: Zones are peers, not hierarchical descendants.
- **Occupancy Rules**: Actors inhabit traversable field space. Overcrowding is a world-rule question (Fixed vs. Expandable).
- **Continuation**: A zone may continue across viewports (pages) if its world behavior allows.

### 5.2 Speculative Transactions
Predictive layout (e.g., "will this fit?") uses explicit transactions.
- **Transaction Boundary**: Speculative mutation must be entered intentionally and either `accept` (commit) or `rollback`.
- **Checkpointing**: Snapshots are taken only for transactions, not as an ambient habit.
- **Telemetry**: Branches are reason-tagged (e.g., `keep-with-next`, `accepted-split`) for profiling.

---

## 6. AST & Authoring Philosophy

The AST (JSON) is the public "C-level" contract for the engine.

### 6.1 Design Principles
- **Anti-False-Hierarchy**: Resist tree-nesting where the real concept is a spatial region or lane.
- **Spatially Honest**: If an intent is spatial, the AST should represent it with spatial vocabulary.
- **Macro Layer**: A higher-level "Standard Library" (Macros) exists to expand human-friendly concepts into valid AST.

### 6.2 Implementation of `strip` and `zone-map`
- **Strip**: A one-row horizontal composition band (byline, folio).
- **Zone Map**: A field of authored regions.
- **Standardization**: Both lower into the internal `ZoneStrip` IR primitive.
