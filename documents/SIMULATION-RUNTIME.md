# VMPrint Simulation Runtime

This is the canonical detailed runtime document for VMPrint's current engine.

It replaces the earlier overhaul-era design notes that were useful while the
architecture was being discovered, but that now overlap, contradict one
another, or describe transitional states the engine has already left behind.

Read this document as the current answer to:

- what the engine is
- what the kernel owns
- how actors communicate
- how pagination, replay, and capture relate
- how page regions, TOC, and temporal progression fit into the same runtime

For the shorter overview, see
[ARCHITECTURE.md](/c:/Users/cosmic/Projects/vmprint/documents/ARCHITECTURE.md).
For world-space and region-specific deep dives, see
[WORLD-MAP.md](/c:/Users/cosmic/Projects/vmprint/documents/WORLD-MAP.md) and
[LAYOUT-ZONES.md](/c:/Users/cosmic/Projects/vmprint/documents/LAYOUT-ZONES.md).

---

## 1. Core Claim

VMPrint is a deterministic document simulation engine.

It is not best understood as:

- a browser without a DOM
- a classic multi-pass typesetter
- or a renderer that discovers layout while painting

It is better understood as:

- a world with stable actor identity
- a kernel that advances world state
- systems that settle spatial consequences
- pages that capture viewports onto that world
- renderers that paint already-settled output

The engine may still produce printable pages, but print is a capture of
simulation state, not the ontology of the engine itself.

---

## 2. Runtime Layers

The current engine is most usefully read in four runtime layers:

- **Kernel**: stable actor identity, session state, snapshots, rollback,
  simulation clock, progression stop/resume primitives
- **Systems**: march orchestration, checkpoint settlement, observer sweeps,
  spatial negotiation, page-region stamping, speculative branching support
- **Document Semantics**: normalization, shaping, packagers, stories, grids,
  strips, zones, page regions, source provenance
- **Rendering Handoff**: settled `Page[]` and positioned boxes handed to PDF or
  other contexts

The important rule is that lower layers provide general runtime capability,
while higher layers express document-specific behavior through those
capabilities rather than bypassing them with one-off orchestration.

---

## 3. World, Pages, and Capture

The current architecture treats:

- the **world** as primary
- the **page** as a viewport/local map
- **pagination** as one system that advances viewport planning
- **capture** as the act of freezing a settled world slice into `Page[]`

This matters because it prevents the engine from treating print as a special
case outside the simulation model.

In practice today, the default contract is still:

- advance until settled
- finalize page regions
- capture finalized pages

But this is now understood as a default progression/capture policy, not as a
different kind of engine.

---

## 4. Actor Model

The engine now has a real actor model.

Actors are layout/runtime participants with stable identity and lifecycle
hooks. In practice these are packager units plus collaborators and runtime
observers that can:

- commit content
- publish signals
- observe committed facts
- redraw content in place
- request geometry resettlement
- and, when opted in, step on simulation ticks

This is the important boundary:

- old VMPrint solved many hard seams through orchestration and post-processing
- current VMPrint increasingly solves them through actors living in the world

---

## 5. Signals and Observers

The actor communication substrate is now a first-class runtime primitive.

The current model includes:

- committed signal publication
- topic-based subscriptions
- checkpoint-bounded observer sweeps
- dirty frontier reporting
- content-only vs geometry-changing update classification
- rollback-safe restoration of signal state

This means a world fact can now be handled as:

1. a committed signal is published
2. only interested actors wake
3. each actor reports `none`, `content-only`, or `geometry`
4. content-only actors redraw in place
5. geometry actors route through checkpoint-based replay/resettlement

This is the core replacement for older “patch after layout” patterns.

---

## 6. Content-Only and Geometry Updates

The distinction between `content-only` and `geometry` updates is now a central
runtime boundary.

Why it matters:

- it protects ordinary performance
- it lets late-known facts update visible content without forcing full replay
- it gives the kernel a generic answer instead of feature-specific patch paths

Current shipped proofs of this boundary:

- live reactive TOC proves geometry-affecting reactive behavior
- `{totalPages}` page regions prove content-only reactive behavior

The old second-pass `{totalPages}` path has been retired in favor of this
runtime model.

---

## 7. Checkpoints, Replay, and Safe Resettlement

The engine now has meaningful checkpoint-based settlement, not just page-loop
reruns.

Key behavior:

- safe checkpoints are recorded at actor/page boundaries
- dirty frontiers resolve to the nearest safe checkpoint
- replay can preserve upstream actors while re-running affected regions
- speculative branches snapshot and restore session state exactly
- oscillating reactive geometry is bounded and fails deterministically

This machinery is one of the strongest pieces of the current engine and is the
foundation for both reactive layout and deliberate temporal progression.

---

## 8. Kernel Clock and Progression

The kernel now owns an agnostic discrete simulation clock.

Important properties:

- the clock is kernel-owned, not subsystem-owned
- it is a simulation clock, not a wall clock
- signals can be stamped with committed tick
- session snapshots preserve clock state
- same-timeline replay preserves forward temporal continuity

This matters because the world should only know that time advanced, not why.
Pagination, observer sweeps, and render capture may all correlate with time,
but none of them define what time is.

The kernel currently owns these basic primitives:

- advance
- stop
- resume
- snapshot
- restore
- capture

The default print run still uses an implicit “until settled” stopping policy,
but the runtime no longer assumes that this is the only meaningful kind of
progression.

---

## 9. Stepped Actors

The engine now supports true stepped actors in the kernel/runtime path.

That means an actor can participate in simulation ticks even when it is not
simply reacting to a newly committed signal.

This capability is:

- real in the kernel
- verified by synthetic proofs
- not yet broadly exposed as an author-facing feature

Today this is primarily an internal engine capability. That is intentional.
It lets the architecture owner solve difficult engine problems using the new
runtime without prematurely freezing a public author API.

The “clock cooking” proof exists specifically to verify this path. It exposed a
real architectural gap earlier in the rollout and helped close it.

---

## 10. Page Regions, TOC, and Other Former Trouble Spots

Several historically awkward document problems are now better explained as
runtime actor problems.

### 10.1 TOC

The live TOC is now a real in-flow reactive actor.

The important point is not merely that the feature works, but that it works by
the engine’s own model:

- headings publish world facts
- the TOC actor observes committed facts
- the TOC can request geometry resettlement
- checkpoint/replay carries the spatial consequence

### 10.2 Header/Footer and `{totalPages}`

`{totalPages}` is no longer handled as a second-pass patch over finalized
pages. Page-region actors subscribe to committed pagination facts and redraw
owned boxes in place as `content-only` updates.

This was a major architectural cleanup because it removed domain-specific
defer-and-patch orchestration from the live engine path.

### 10.3 Remaining Rule of Thumb

Any feature that still sounds like:

- “after simulate, patch this”
- “do a second pass for that”
- “special-case this token after finalization”

should now be treated as suspect and re-evaluated against the runtime
primitives above.

---

## 11. World Space, Zones, and Terrain

The engine’s spatial model is now strong enough that page-first mental models
are increasingly misleading.

The current direction is:

- world space is continuous
- pages are local frames/viewports
- zones are authored regions of the world
- stories, tables, strips, and other structures are actor systems inhabiting
  those regions
- headers, footers, margins, exclusions, and reservations are terrain shaping
  traversable space

The deeper implications of that model are explored in:

- [WORLD-MAP.md](/c:/Users/cosmic/Projects/vmprint/documents/WORLD-MAP.md)
- [LAYOUT-ZONES.md](/c:/Users/cosmic/Projects/vmprint/documents/LAYOUT-ZONES.md)
- [SPATIAL-IR.md](/c:/Users/cosmic/Projects/vmprint/documents/SPATIAL-IR.md)

Those documents remain useful because they cover focused subdomains rather than
transitional overhaul narration.

---

## 12. Current Default Contract

Although the runtime is now richer, the default engine contract is still
conservative and deterministic:

1. normalize document semantics into executable runtime units
2. advance the world through the march
3. settle reactive consequences until stable
4. finalize the current page capture contract
5. return settled `Page[]` plus report/provenance

That default is good and should remain cheap for ordinary documents. Dormant
actors must stay cheap. The more advanced runtime capabilities exist so the
engine can solve difficult problems honestly, not so every simple document pays
for maximum generality.

---

## 13. What Still Needs Work

The main remaining gaps are no longer missing primitives. They are mismatches
between the strength of the runtime and the shape of some older orchestration.

Most important targets:

- the march loop still owns too much domain policy inline
- some spatial behavior is still split between shared terrain and
  packager-private logic
- some docs and public helper shapes still preserve older post-process mental
  models
- stopping/capture policy is still more implicit than it should eventually be

So the next phase is less about inventing new foundations and more about
moving more of the engine onto the foundations that now exist.

---

## 14. Documentation Policy

This document is the canonical runtime reference.

The following kinds of documents should be treated as temporary unless they are
actively maintained:

- overhaul execution plans
- “next phase” strategy notes
- design notes that existed to justify a feature before the feature landed

Once a capability is shipped and verified, its current truth should be folded
into one of:

- this runtime document
- a focused stable deep-dive such as world map, zones, or AST reference

That policy keeps the documentation set from drifting into multiple competing
architectural eras.
