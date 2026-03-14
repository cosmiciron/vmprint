# Architectural Design: Typesetting as a Deterministic Simulation (v2.0)

> **Note on this revision:** v1.0 of this document described the simulation model as a future ideal.
> This v2.0 revision grounds it in what the engine already is. The goal is to identify precisely
> what remains to be formalized — not to redesign what already works.

---

## 1. The Non-Negotiable Mental Model

VMPrint should not treat typesetting as a long list of publishing exceptions.
It should treat layout as a **deterministic simulation** over a 2D spatial world.

This is not a metaphor used for explanation after the fact. It is the architecture.

If the engine is to become meaningfully more powerful than traditional typesetting systems, then the simulation model must be the primary ontology and all features must be expressed in its terms.

That means:

*   We do **not** start from "footnotes", "TOC", "headers", or other publishing features.
*   We start from **world state**, **actors**, **systems**, **phases**, **constraints**, and **artifacts**.
*   Publishing features are then implemented as **systems operating on the simulation**, not as special cases that define the engine.

The rule is simple:

> Never let a document feature define the architecture.
> Let the simulation architecture define how document features exist.

---

## 2. Current State: What the Engine Already Is

Before describing what to build, it is essential to recognize what already exists and is working.
The simulation model is not a future aspiration — large parts of it are already the engine's reality.

### Already Implemented

**The three-layer data model is already correct.**

The engine already has a clean separation between three distinct representations:

| Layer | Type | Role |
|---|---|---|
| Authored Data | `Element` | Static semantic tree — immutable input |
| Runtime IR | `FlowBox` | Shaped, measured, but not yet committed |
| Committed Artifacts | `Box[]` | Flat, absolutely positioned output per page |

This is the simulation ontology. No redesign of this layer is needed.

**The Packager is already a runtime actor.**

`PackagerUnit` (`engine/src/engine/layout/packagers/packager-types.ts`) already implements the actor lifecycle:

*   `prepare(availableWidth, availableHeight, context)` — deterministic geometry computation
*   `emitBoxes(availableWidth, availableHeight, context)` — artifact commitment
*   `split(availableHeight, context)` — continuation production

Four concrete implementations exist and are correct: `FlowBoxPackager`, `StoryPackager`, `TablePackager`, `DropCapPackager`. These are not to be replaced or restructured.

**The simulation loop is already type-agnostic.**

`execute-simulation-march.ts` already treats all packagers uniformly. It does not know about paragraphs, tables, or drop caps. All layout logic lives inside packagers. This is the right design.

**Artifact identity is already tracked.**

Every committed `Box` already carries `BoxMeta`:

```typescript
interface BoxMeta {
    sourceId: string;
    engineKey: string;
    sourceType: string;
    semanticRole?: string;
    fragmentIndex: number;
    isContinuation: boolean;
    pageIndex?: number;
    generated?: boolean;
    originSourceId?: string;
}
```

Identity at the output level is solved. What is missing is identity at the **runtime actor** level (on the `PackagerUnit` itself, before boxes are emitted).

**`SpatialMap` already exists.**

A spatial collision and exclusion system is already in production use inside `StoryPackager`. It is not to be introduced — it is to be promoted to a shared system available to all collaborators.

**Determinism is already the contract.**

`EngineRuntime` (`engine/src/engine/runtime-types.ts`) holds all shared caches (font, measurement, buffer) keyed on content-addressed inputs. The measurement cache key includes page index, cursor Y, element type, and content width. Given identical inputs, the engine already produces identical output.

**Header/footer injection is already separated.**

`layout-page-finalization.ts` already runs headers and footers as a post-pass over committed pages, layouting region content in a sub-engine. It is already isolated from the main simulation loop. The remaining work is to route it through the collaborator interface rather than as a direct call.

### What Is Not Yet Built

Only three structural pieces are missing from the simulation model:

1.  **`LayoutSession`**: simulation state lives as local variables in the `executeSimulationMarch` while-loop. It needs to become a formal object.

2.  **`ConstraintField`**: Available space is passed as raw numbers. There is no object that aggregates margins, reservations, and exclusions into a negotiable surface.

3.  **`LayoutCollaborator` interface and phase hooks**: There is no system registration, no phase notification, and no structured way for cross-cutting behaviors to participate in the simulation.

Additionally, two behaviors that belong in collaborator systems are currently embedded directly in the simulator:

*   `keepWithNext` sequencing logic — inline in `execute-simulation-march.ts`
*   Continuation marker injection — inline in `execute-simulation-march.ts`

These are the target of extraction in Phase 5.

---

## 3. What a Page Is

A page is **not** the source of truth.

A page is a **resolved simulation surface**: the committed result of one bounded frame of the world.

The source of truth is:

*   the authored document (`Element[]`)
*   the active simulation state (`LayoutSession`)
*   the actor continuations that move forward across frames (`PackagerUnit[]`)
*   the committed artifact stream (`Box[]` per page)

This distinction matters. If the page is treated as the primary abstraction, the architecture collapses back into a traditional simulator with plugin hooks. If the page is treated as a bounded output surface inside a simulation, the engine remains extensible.

---

## 4. The Packager as a Runtime Actor

The `PackagerUnit` interface already correctly defines the actor lifecycle. This section names what already exists with the simulation vocabulary so that future work is built on a shared understanding.

### Lifecycle (Already Implemented)

1.  **Spawn**: `createPackagers(elements)` materializes `Element[]` into `PackagerUnit[]`.
2.  **Prepare**: `packager.prepare(availableWidth, availableHeight, context)` computes deterministic internal geometry. Measurement results are cached by content-addressed key in `EngineRuntime.measurementCache`.
3.  **Negotiate** *(not yet implemented)*: Systems contribute reservations and exclusions to the `ConstraintField` before the packager commits.
4.  **Commit**: `packager.emitBoxes(...)` emits concrete `Box[]` to the current page surface.
5.  **Continue**: `packager.split(availableHeight, context)` produces a successor `PackagerUnit` when the actor cannot complete on the current page surface.

The crucial point is that packagers do not represent document features. They represent runtime behavior under spatial constraints. This is already true of all four existing packager implementations.

### Runtime Identity (Partially Implemented)

Identity at the output level is complete (see `BoxMeta`). Identity at the runtime actor level is not. The `PackagerUnit` interface should be extended with:

```typescript
interface PackagerUnit {
    // ... existing methods unchanged ...

    readonly actorId: string;       // Stable across the simulation run
    readonly sourceId: string;      // Author-assigned element identity
    readonly actorKind: string;     // Element type
    readonly fragmentIndex: number; // 0 for originals, 1+ for continuations
    readonly continuationOf?: string; // actorId of the predecessor, if any
}
```

This allows collaborators to reason about actors **before** boxes are emitted — necessary for reservation systems that need to know what is coming before it is committed.

### Transformable Actors

The runtime actor model must not assume that actors are rigid units.

In VMPrint, actors are often **transformable**. They may need to alter their runtime form in order to navigate terrain, preserve readability, or maintain formation rules.

This capability space is broader than `split()`.

**Split**
The actor fragments into a committed current piece and a continuation successor. This is the existing `split(availableHeight, context)` behavior.

**Morph**
The actor recomputes itself under changed terrain. Examples include reflowing line breaks, hyphenation, or internal geometry when the `ConstraintField` introduces exclusions or narrowed lanes.

**Clone**
The actor duplicates a stable substructure onto a new surface while continuing as the same higher-level actor. The clearest example is repeated table headers across pages. This is not merely a split; it is duplication in service of readability.

**Continue**
The runtime preserves identity links across transformed fragments, clones, or successors so that systems can reason about the actor as one evolving entity.

This matters because future orchestration systems must not treat actors as rigid pieces moving through space. A formation coordinator may need to know:

*   whether an actor can split at all
*   whether it can morph to fit constrained terrain
*   whether it can clone stable subparts for readability
*   whether a transformation preserves formation validity or forces page advance

This is especially relevant to:

*   `keepWithNext` and other formation/orchestration policies
*   tables with repeated headers
*   story and drop-cap fragments that must preserve actor-owned spatial intent across continuation boundaries

The important architectural rule is:

> Do not encode cloning, morphing, or continuation-preservation as packager-specific simulator exceptions.
> Treat them as actor transformation capabilities expressed through the simulation model.

What has now been proven in the engine is:

*   repeated table headers on continuation pages can be emitted as explicit cloned substructures rather than silent duplication
*   clone identity can survive into box metadata and runtime artifact summaries
*   clone-aware output holds not only on the original mixed-span table fixture, but also on a second purpose-built probe with two independent multi-page tables in one run

So cloning is no longer only an architectural intent. It is now a validated engine primitive for transformable actors.

### Transitional Ambiguity and Snapshot Branching

Some runtime seams are not well-described by a large taxonomy of transitional states.

The clearest example is **accepted split placement**:

*   a split has already been accepted
*   a continuation already exists conceptually
*   marker and queue aftermath may already be prepared
*   but the accepted fragment is not yet truly settled on the page surface

This is the simulation equivalent of an actor crossing a world-transition boundary in a game:
the crossing has begun, dependent systems are already reacting, but the actor is not yet fully resolved in the new terrain.

For this class of problem, VMPrint should prefer **local transition snapshots** over an ever-growing list of intermediate statuses.

The philosophy is:

*   coarse, stable engine phases should remain explicit states
*   ambiguous branchy seams should use snapshot-and-branch semantics

That means:

*   capture a local snapshot of page / queue / cursor / relevant session-owned transition state
*   attempt one deterministic branch from that snapshot
*   if the branch settles cleanly, commit the resulting world
*   if it does not, discard it and choose the next deterministic branch

This is intentionally **not** a global full-engine save-state system.
It is a targeted mechanism for local, high-ambiguity transition seams.

Validated consumers now include:

*   accepted split fragment placement after split acceptance
*   page-boundary continuation settlement after a split has already been accepted
*   future multi-actor orchestration seams where a formation has partially committed to one path but not yet settled

What has now been proven in the engine is:

*   local branch snapshots can capture page-local placement state, queue state, split staging state, reservations, exclusions, and fragment-transition state
*   an accepted split can be fully previewed against that snapshot, then rolled back cleanly
*   queue/continuation handling can be derived from the preview branch and then committed deterministically
*   this works not only for the original troublesome simulation-fragment fixture, but also for a second purpose-built accepted-split branching probe designed to expose leaked marker, queue, or reservation state

In other words, snapshot branching is no longer a speculative design note. It is now a validated engine primitive for ambiguous transition seams.

The architectural rule is:

> Do not solve ambiguous transition seams by proliferating fine-grained limbo states when a local snapshot-and-branch model is cleaner.
> Use explicit states for stable phases; use snapshots for unstable boundaries.

---

## 5. The Collaborator as a System

A `LayoutCollaborator` should not be thought of as a bag of callbacks. It is a **simulation system**.

Its purpose is to participate in the layout run without breaking the type-agnostic nature of the simulation core.

| Category | Examples |
|---|---|
| Telemetry systems | TOC capture, index term collection, diagnostics, source maps |
| Reservation systems | Footer area reservation, note anchors, exclusion zones |
| Annotation systems | Cross-reference maps, semantic overlay data |
| Coordination systems | Counters, running furniture, region policies |

The collaborator system exists to influence the simulation in structured, deterministic phases.

---

## 6. Explicit Simulation Phases

The phases described below are **already implicit** in the engine. The work is to make them explicit — to give them stable boundaries that collaborators can hook into, rather than imperative code scattered across a while-loop.

### The Nine Phases

1.  **Simulation Start**
    Initialize session state, counters, lookup tables, and system-local state.
    *(Currently: implicit at the start of `LayoutProcessor.simulate()`)*

2.  **Actor Spawn**
    Materialize authored elements into runtime actors via `createPackagers()`. Assign stable `actorId` to each packager.
    *(Currently: `createPackagers()` call — exists, but actors have no stable identity)*

3.  **Page Start**
    Open a new page surface. Initialize page-scoped reservations and the constraint field from config margins.
    *(Currently: `currentPageBoxes = []` and margin reset — implicit local variable operations)*

4.  **Constraint Negotiation**
    Systems inspect the incoming actor and may contribute reservations, exclusions, or policy adjustments to the `ConstraintField`.
    *(Currently: does not exist — the gap that enables reservation systems)*

5.  **Actor Prepare**
    The packager computes geometry against the current constraint field.
    *(Currently: `packager.prepare(availableWidth, availableHeight, context)` — already exists)*

6.  **Actor Commit**
    The packager emits committed `Box[]` to the current page surface. Telemetry systems observe.
    *(Currently: `packager.emitBoxes(...)` — already exists)*

7.  **Continuation Resolution**
    If the actor is incomplete, `packager.split()` produces a successor. The successor's `continuationOf` links it to the original actor.
    *(Currently: `packager.split()` — already exists, but no `continuationOf` tracking)*

8.  **Page Finalization**
    The page surface is frozen as output. Region systems (headers, footers) inject their artifacts.
    *(Currently: `layout-page-finalization.ts` post-pass — already separated, needs routing through collaborator)*

9.  **Simulation Complete**
    Final telemetry is gathered. Multi-pass fixpoint decisions are evaluated (see Section 10).
    *(Currently: does not exist as a formal phase)*

---

## 7. Architectural Laws

The simulation model only works if it is defended with hard constraints.

### Law 1: Phase Separation
No hidden side effects during speculative measurement or probing.

Observation, reservation, preparation, commitment, and continuation must occur in explicit phases. If a system can mutate layout state during an incidental measurement call, determinism becomes fragile.

The existing `measurementCache` in `EngineRuntime` already respects this — text shaping is cached and never has layout side effects.

### Law 2: World State is First-Class
Reservations, exclusions, anchors, counters, references, and telemetry must live in structured simulation state (`LayoutSession`).

They must not be scattered across local variables, caches, or ad hoc side channels. This is the primary violation in the current code: simulation state lives as local variables in `executeSimulationMarch`. Extracting these into `LayoutSession` is the primary structural work.

### Law 3: Features are Systems
Document features must be expressible as systems over the simulation loop.

If a feature requires special-case logic directly in the simulator, that is a design smell. The current violations are `keepWithNext` sequencing and continuation marker injection, both embedded in `execute-simulation-march.ts`. These must be extracted into collaborators.

Headers and footers are already nearly correct: `layout-page-finalization.ts` is separate, but invoked directly rather than through a phase hook. This is a routing fix, not a redesign.

### Law 4: Pages are Bounded Frames
A page break is not a control-flow exception. It is the boundary between committed simulation frames.

The existing loop already treats page breaks as frame boundaries. This law is already upheld.

### Law 5: Determinism is a Contract
Given identical inputs, font state, and system configuration, the simulation must emit identical output.

This is already the contract. `EngineRuntime` caching, the content-addressed measurement key, and the absence of time or random state in the engine uphold this law today. Collaborators must not violate it: system execution order must be explicit, stable, and registered at session start.

---

## 8. Stable Identity and Continuations

Identity at the output level is already solved by `BoxMeta`. Identity at the runtime actor level is not, and this is the gap.

**Why actor-level identity matters:** A collaborator that needs to reserve space for a footnote anchor must know, at constraint negotiation time, that a specific packager is a note-anchored element. It cannot infer this from boxes that have not yet been emitted. The packager itself must carry the identity.

### Required Extension to `PackagerUnit`

```typescript
interface PackagerUnit {
    // Existing — do not change
    prepare(availableWidth: number, availableHeight: number, context: LayoutRunContext): void;
    emitBoxes(availableWidth: number, availableHeight: number, context: LayoutRunContext): LayoutBox[] | null;
    split(availableHeight: number, context: LayoutRunContext): [PackagerUnit | null, PackagerUnit | null];
    getRequiredHeight(): number;
    isUnbreakable(availableHeight: number): boolean;
    getMarginTop(): number;
    getMarginBottom(): number;
    readonly pageBreakBefore?: boolean;
    readonly keepWithNext?: boolean;

    // New — runtime identity
    readonly actorId: string;
    readonly sourceId: string;
    readonly actorKind: string;
    readonly fragmentIndex: number;
    readonly continuationOf?: string;
}
```

Each existing packager implementation generates `actorId` at construction time (a stable string derived from `sourceId` + `actorKind`). When `split()` produces a successor, the successor receives `continuationOf = original.actorId` and `fragmentIndex = original.fragmentIndex + 1`.

This identity is then mirrored into `BoxMeta` at emit time — `BoxMeta` already has the right fields (`fragmentIndex`, `isContinuation`, `engineKey`). The existing `BoxMeta` fields require no changes; they simply gain a reliable source at construction time.

---

## 9. Artifacts vs. Intent

One of the most important consequences of the simulation model is the distinction between **observation** and **influence**.

### Artifact Systems (Observe)
These observe committed simulation results and must not affect layout behavior.

*   Table of contents capture — records committed heading positions and page indices
*   Index term collection — scans committed boxes for tagged terms
*   Source position maps — maps `sourceId` to `(page, y)` after commitment
*   Diagnostics and debug overlays

### Intent Systems (Influence)
These influence the simulation before commitment via the constraint negotiation phase.

*   Reserved region systems — reduce available page height before actor placement
*   Exclusion zone systems — inject obstacles into `ConstraintField` (same mechanism as `StoryPackager`'s internal `SpatialMap`)
*   Counter and running furniture systems — manage page-scoped state across frames

### What Has Now Been Proven

The engine has now demonstrated this distinction with a concrete reservation subsystem:

*   **Observation path**: reservation state is published as a `pageReservationSummary` artifact in the simulation report.
*   **Influence path**: reservation systems reduce `ConstraintField.effectiveAvailableHeight` before subsequent actor placement.
*   **Multiple production phases**: reservations can be produced both after actor commitment and at page start.
*   **Shared selector logic**: page targeting (`first`, `odd`, `even`, `all`) belongs to session-owned world-state logic, not to individual collaborator policy.

This matters because it is the first proof that unusual layout behavior can be expressed as a shared simulation subsystem rather than as simulator-local special cases.

The engine has also now validated a second kind of shared runtime tool:

*   **snapshot branching for ambiguous transition seams**

This is distinct from reservation/exclusion systems. Reservations and exclusions model persistent world-state influence. Snapshot branching models unstable local boundaries where the engine must preview one deterministic branch, inspect the result, and either commit it or roll it back cleanly.

That distinction is important:

*   use persistent state for durable spatial rules
*   use local snapshots for Schrodinger-like transition seams that are neither safely committed nor safely discarded yet

### The `SpatialMap` Bridge
`SpatialMap` is already used as an internal exclusion mechanism inside `StoryPackager`. When `ConstraintField` is introduced as a shared simulation object, `SpatialMap` should be promoted to the shared system it conceptually is — the same mechanism that `StoryPackager` uses for float obstacles should be the mechanism that a `ReservedFooterRegionSystem` uses to carve out page margins. No new mechanism is needed; only promotion and sharing.

---

## 10. Display Mode, Print Mode, and Post-Processing

### Two Operating Domains

VMPrint serves two fundamentally different domains, and they have different contracts:

**Display mode** — real-time or near-real-time rendering to screen. The simulation runs once. Output is live. Features like TOC are irrelevant here: a reader navigates directly, and the document's interactive structure replaces the need for a printed index.

**Print/batch mode** — producing a final artifact (PDF, print stream). There is no real-time constraint. The pipeline can take as many passes as needed, and post-processing steps are first-class citizens of the output stage.

This distinction matters because traditional typesetters conflate the two domains. They treat multi-pass layout as a problem to be solved *inside* the layout engine — requiring aux files, two-stage compilation, and complex re-run machinery — because their engines are slow enough that re-layout is expensive. VMPrint's engine is not slow.

### The Engine Is Fast Enough to Re-Run

On a 9-watt low-power i7, the engine's most complex regression fixture — 8 pages of mixed-script typography, floated images, and multi-page tables — completes in approximately **66ms of layout time** on a warm runtime (shared font and measurement caches). This is the worst-case fixture. Typical content is substantially faster.

At this speed, a 300-page document of equivalent complexity lays out in roughly 2.5 seconds. A second pass costs the same. For print/batch output, a two-pass pipeline is not a performance problem — it is a 5-second operation on the hardest possible content.

This changes the architecture of multi-pass features fundamentally. A game engine does not re-render the entire world to handle a state change in one region — it processes only the dirty region and carries the rest forward. VMPrint follows the same principle: a second pass, when needed, re-layouts only from the earliest element whose page assignment changed. Everything before that point is frozen. For typical cross-reference scenarios, this means a small fraction of the document is re-processed.

But for TOC specifically, re-layout is not even the right model.

### TOC Is a Post-Processing Concern

The table of contents is almost exclusively a print domain feature. It requires knowing where headings landed after layout is complete. The clean architecture for this is not multi-pass layout — it is post-processing the committed artifact stream.

The pipeline is:

1.  The simulation runs once. `HeadingTelemetryCollaborator` observes `onActorCommitted` and records `{ sourceId, heading, pageIndex }` for every heading element.
2.  `onSimulationComplete` delivers the full heading map to the print pipeline.
3.  The TOC is *generated from the committed output* — element trees are constructed from the telemetry data and laid out as their own document fragment.
4.  The TOC pages are inserted into the final artifact. No re-layout of the body occurs.

The only edge case is if the TOC's own page count shifts everything after it — a realistic but rare condition. The correct response is a **reserved block**: the author declares that the TOC occupies a fixed range of pages, and the post-processor fills that range. If the generated TOC overflows the reservation, it is flagged as a layout error rather than silently triggering a full re-run. This is a more honest contract: the author's intent is explicit, not inferred by the engine.

For documents where the TOC page count genuinely cannot be known in advance, a targeted second pass from the TOC's insertion point forward is the fallback — not a general-purpose convergence loop.

### What `onSimulationComplete` Actually Is

`onSimulationComplete` is not primarily a re-run trigger. It is the **handoff point** between the layout simulation and the print pipeline's post-processing stage.

At this phase:

*   Artifact systems produce their final artifacts (heading maps, index terms, source position maps).
*   The print pipeline receives the committed `Page[]` and the collaborator telemetry.
*   Post-processing steps (TOC generation, cross-reference resolution, PDF bookmark trees) operate on this data.
*   A targeted re-run, if needed, is initiated by the pipeline host — not by the collaborator system itself.

This keeps the collaborator system clean: collaborators observe and influence the simulation, but they do not control whether it re-runs. That decision belongs to the pipeline that owns the session.

### The Dirty-Region Re-Run (For Genuinely Layout-Coupled Features)

Some features — footnote balancing, widow/orphan resolution across chapter boundaries, or content-driven page numbering schemes — are genuinely layout-coupled and cannot be resolved by post-processing alone. For these, a targeted re-run is appropriate.

The mechanism is simple: the session's `sourceId → pageIndex` map from pass N is compared against pass N+1. The first `sourceId` whose `pageIndex` changed marks the boundary. Pass N+2, if needed, re-layouts only from that element forward, carrying committed boxes from before the boundary as frozen artifacts.

This is the dirty-region model. It is an optimization path for large documents, not a requirement for the initial implementation. The simple version — re-run the full simulation from the beginning — is correct and adequate for all documents at the scale this engine currently targets. The dirty-region optimization follows when document scale demands it.

---

## 11. The Collaborator Interface

The collaborator API reflects simulation phases, not implementation accidents.

```typescript
export interface LayoutCollaborator {
    /** Called once before any actors are spawned. Initialize system-local state here. */
    onSimulationStart?(session: LayoutSession): void;

    /** Called when each PackagerUnit is created. Inspect actor identity; do not mutate. */
    onActorSpawn?(actor: PackagerUnit, session: LayoutSession): void;

    /** Called when a new page surface opens. Initialize page-scoped state here. */
    onPageStart?(pageIndex: number, surface: PageSurface, session: LayoutSession): void;

    /**
     * Called before each actor prepares. Systems may mutate the ConstraintField to
     * reduce available space, add exclusions, or assert policy. This is the only
     * sanctioned moment for intent systems to influence spatial allocation.
     */
    onConstraintNegotiation?(actor: PackagerUnit, constraints: ConstraintField, session: LayoutSession): void;

    /** Called after an actor has prepared but before it commits. For read-only inspection. */
    onActorPrepared?(actor: PackagerUnit, session: LayoutSession): void;

    /** Called after an actor commits its boxes. Telemetry systems record here. */
    onActorCommitted?(actor: PackagerUnit, committed: Box[], surface: PageSurface, session: LayoutSession): void;

    /** Called when split() produces a continuation. Link predecessor to successor here. */
    onContinuationProduced?(predecessor: PackagerUnit, successor: PackagerUnit, session: LayoutSession): void;

    /** Called when a page surface is finalized. Region systems inject headers/footers here. */
    onPageFinalized?(surface: PageSurface, session: LayoutSession): void;

    /**
     * Called after all pages are complete. Systems read finalized session-owned state
     * and publish final artifacts here. Re-run decisions belong to the pipeline host.
     */
    onSimulationComplete?(session: LayoutSession): boolean | void;
}
```

---

## 12. New Simulation Objects

Three objects need to be introduced. Their scope is minimal — they formalize what already exists, not invent new behavior.

### `LayoutSession`

Owns one deterministic simulation run. Replaces the local variables in `executeSimulationMarch`.

```typescript
interface LayoutSession {
    // State currently living as local variables — extracted here
    currentPageIndex: number;
    currentY: number;
    currentConstraintField: ConstraintField;
    currentSurface: PageSurface;

    // What EngineRuntime already provides — referenced here, not duplicated
    readonly runtime: EngineRuntime;

    // System registry — execution order is explicit and fixed at session start
    readonly collaborators: readonly LayoutCollaborator[];

    // Phase notification methods — called by the simulation loop
    notifySimulationStart(): void;
    notifyActorSpawn(actor: PackagerUnit): void;
    notifyPageStart(): void;
    notifyConstraintNegotiation(actor: PackagerUnit): void;
    notifyActorPrepared(actor: PackagerUnit): void;
    notifyActorCommitted(actor: PackagerUnit, committed: Box[]): void;
    notifyContinuationProduced(predecessor: PackagerUnit, successor: PackagerUnit): void;
    notifyPageFinalized(): Page;
    finalizePages(pages: Page[]): Page[];

    // Read-side runtime surfaces
    getFinalizedPages(): readonly Page[];
    getSimulationReport(): SimulationReport | undefined;
    getSimulationReportReader(): SimulationReportReader;
}
```

`EngineRuntime` is unchanged. It holds shared infrastructure (font caches, measurement cache). `LayoutSession` holds per-run state. These are already conceptually separate; `LayoutSession` makes the boundary explicit.

### `LayoutSession` as Selector Owner

Reservation targeting is now a useful litmus test for whether a rule belongs in session-owned world state or in a collaborator.

The answer is: **session-owned**.

Collaborators may publish the intent to reserve space, but page selection logic such as:

*   first page only
*   odd pages
*   even pages
*   all pages

should be interpreted by the session itself. This prevents each collaborator from reinventing page policy and keeps targeting logic deterministic, shared, and testable.

### `ConstraintField`

Represents the currently available spatial rules for actor placement.

```typescript
interface ConstraintField {
    availableWidth: number;
    availableHeight: number; // After reservations are applied

    // Read-only for packagers; writable by collaborators during constraint negotiation only
    reservations: RegionReservation[];
    exclusions: SpatialExclusion[];

    // Derived helper — the height packagers should use
    readonly effectiveAvailableHeight: number;
}
```

In the current code, `availableWidth` and `availableHeight` are passed as raw numbers to every packager method. `ConstraintField` wraps these with the additions needed for reservation systems. Existing packager implementations continue to read `availableWidth` and `availableHeight` from the field; no packager internals change.

The existing `SpatialMap` inside `StoryPackager` is the model for `SpatialExclusion`. When the shared `ConstraintField` is available, the same mechanism can be used for page-level exclusions without rewriting `StoryPackager`'s internals.

### `PageSurface`

Owns the committed artifacts for one page frame.

```typescript
interface PageSurface {
    readonly pageIndex: number;
    readonly width: number;
    readonly height: number;
    boxes: Box[]; // Committed artifacts — appended by actor commit, injected by region systems

    // Freezes into the public Page output during onPageFinalized
    finalize(): Page;
}
```

Currently `currentPageBoxes` is a local `Box[]` array. `PageSurface` gives it an owning type that collaborators can inspect and region systems can inject into during `onPageFinalized`.

---

## 13. Re-Architecture Strategy

The goal is to structurally align the simulation loop with the simulation architecture. This must be done in the most minimalistic, high-impact way without breaking established contracts or resorting to superficial renaming.

### Invariants Throughout the Transition

*   `LayoutProcessor.simulate(elements: Element[]): Page[]` does not change signature.
*   Existing regression tests and layout snapshots pass without modification throughout.
*   No non-deterministic collaborator ordering. System registration order at session construction is execution order.
*   No collaborator writes to `EngineRuntime` caches. `EngineRuntime` is read-only to collaborators.
*   No feature-specific exceptions added to the simulator core. Exceptions that already exist are the target of extraction, not a model for new code.

### Phase 1: Preserve the Outer Boundaries *(already satisfied)*

`LayoutProcessor.simulate(elements)` is the public contract. The existing regression tests are the oracle. Any change that causes snapshot failures has violated the contract. These tests need not be modified; they will serve as the continuous correctness signal throughout the transition.

### Phase 2: Introduce `LayoutSession`

Extract `currentPageIndex`, `currentY`, `currentPageBoxes`, `margins`, and page-break state from local variables in `executeSimulationMarch` into a `LayoutSession` object instantiated at the start of `simulate()`.

At this stage, `LayoutSession` has no collaborators and no phase notifications. It is purely a state container. The loop behavior is identical to today. All tests must still pass.

This is a mechanical refactor. It is the foundation for everything else.

### Phase 3: Introduce `ConstraintField`

Replace the raw `availableWidth` / `availableHeight` number arguments passed to `packager.prepare()` and `packager.emitBoxes()` with a `ConstraintField` object.

At this stage, `ConstraintField` contains only the two numbers it replaces — no reservations, no exclusions. Packager implementations read from it instead of from parameters. All tests must still pass.

This is also a mechanical refactor. It establishes the negotiation surface before anything writes to it.

### Phase 4: Add Packager Runtime Identity

Extend `PackagerUnit` with `actorId`, `sourceId`, `actorKind`, `fragmentIndex`, and `continuationOf`. Update each of the four packager implementations to set these fields at construction and propagate them through `split()`.

Confirm that `BoxMeta` on emitted boxes reflects these values correctly. No behavior change — identity fields are additive. All tests must still pass.

### Phase 5: Wire the Collaborator Interface

Add the `LayoutCollaborator` interface and the notification methods to `LayoutSession`. The simulation loop calls `session.notify*()` at each phase boundary.

At this stage, no collaborators are registered. The notification calls are no-ops. All tests must still pass. The collaborator system now exists structurally and can be proven with the next step.

### Phase 6: Prove the Substrate — Two Systems

The substrate is not proven until it demonstrates both observation and influence. Implement two minimal collaborator systems:

**System A — Telemetry (Observation):** `HeadingTelemetryCollaborator`

Listens on `onActorCommitted`. If the committed actor's `actorKind` is a heading type, records `{ sourceId, pageIndex, y }` into session state. This is the seed of TOC generation. No layout behavior changes.

**System B — Reservation (Influence):** `PageFooterRegionCollaborator`

Refactor `layout-page-finalization.ts` so that header/footer injection happens through `onPageFinalized` on this collaborator rather than as a direct call after `simulate()` returns. This is routing, not redesign — the sub-engine layout logic does not change.

If both systems work correctly and all tests pass, the architecture is proven. Features now have a clean path into the engine without touching the simulator core.

### Phase 7: Extract Embedded simulator Logic

With the substrate proven, extract the two existing violations of Law 3:

**`keepWithNext` sequencing** — currently inline in `executeSimulationMarch`. Move to a `KeepWithNextCollaborator` that participates in constraint negotiation to defer placement when the sequence cannot fit.

**Continuation markers** — currently inline in `executeSimulationMarch`. Move to a `ContinuationMarkerCollaborator` that listens on `onContinuationProduced` and injects synthetic marker packagers into the session's actor queue.

After this phase, the simulator core should contain only the fundamental loop: iterate actors, negotiate constraints, prepare, commit, continue. All cross-cutting logic lives in collaborators.

---

## 14. Why This Model Matters

This architecture is valuable because it scales by abstraction instead of by accumulation of exceptions.

It allows VMPrint to express:

*   conventional publishing layout
*   magazine-style spatial composition
*   annotated technical documents
*   multi-pass reference resolution (TOC, cross-references)
*   layout telemetry and introspection
*   future AI-assisted or policy-driven composition systems

All without redefining the engine for each new feature class.

The engine is already most of the way there. The packager model is sound. The three-layer data model is correct. Determinism is a working contract. What remains is to surface the simulation's implicit structure as explicit, stable boundaries — `LayoutSession`, `ConstraintField`, `PageSurface`, and the collaborator interface — so that the engine's power becomes accessible to systems that currently have no clean entry point.

That is the point of the "typesetting virtual machine" idea: not a slogan, but a stable substrate on which very different document behaviors can be simulated. Much of that substrate already exists. The task now is to complete it.
