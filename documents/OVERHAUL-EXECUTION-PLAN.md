# Architecture Overhaul Execution Plan

This document is the working execution plan for the VMPrint architecture overhaul.

It is derived from:

* [COLLABORATOR.md](/c:/Users/cosmic/Projects/vmprint/documents/COLLABORATOR.md)
* [OVERHAUL-OBJECTIVE.md](/c:/Users/cosmic/Projects/vmprint/documents/OVERHAUL-OBJECTIVE.md)

It is intentionally concrete. Its purpose is to help choose work, sequence it, and keep the overhaul moving toward completion faster.

---

## 1. Current Estimate

Estimated completion of the overhaul: **about 68%**.

That estimate means:

* the simulation substrate is mostly in place
* the engine already has session state, collaborator hooks, actor identity, transform metadata, reservation/exclusion primitives, and snapshot branching
* the remaining work is mainly about **ownership transfer** out of the paginator and into simulation primitives, collaborators, and the print pipeline

The main risk is no longer missing terminology or missing scaffolding.
The main risk is that too much domain intelligence still lives in the pagination coordinator.

---

## 2. What "Done" Means

The overhaul should be considered complete when these conditions are all true:

* the paginator is a thin coordinator rather than the domain brain
* keep-with-next, continuation aftermath, reservations, exclusions, and similar cross-cutting behaviors are expressed as systems over shared world state
* hard pagination seams are explained by engine primitives, not paginator-local exceptions
* the print-domain handoff exists cleanly for post-processing features such as heading telemetry and future TOC generation
* new fixtures are explainable in simulation terms without backsliding into special-case loop logic
* performance remains stable under warmed isolated checks

---

## 3. Working Rules

Every overhaul slice should follow these rules:

1. Start from a real seam in the current engine or fixture suite.
2. Prefer extracting ownership over inventing new abstractions.
3. Do not add new feature-specific branches to `paginate-packagers.ts` unless they are temporary transition glue with a clear removal target.
4. Pair meaningful refactors with warmed perf checks.
5. A slice is not complete until correctness, architectural ownership, and perf have all been checked.

---

## 4. Strategic Order

Work should be taken in this order unless an urgent fixture forces a different sequence:

1. Thin the paginator coordinator.
2. Strengthen system-to-system interaction through `LayoutSession`.
3. Make spatial negotiation richer and more honestly shared.
4. Harden transformable actor contracts.
5. Build print-pipeline handoff and post-processing substrate.
6. Add multi-pass / fixpoint semantics.
7. Defer real-time / incremental semantics until the above are stable.

This is the shortest path to meaningful completion because it removes the highest architectural risk first: hidden paginator ownership.

---

## 5. Execution Phases

### Phase A: Thin The Coordinator

Objective:
Move remaining cross-cutting orchestration out of `paginate-packagers.ts`.

Primary targets:

* `keepWithNext` placement ownership
* continuation marker aftermath ownership
* accepted-split aftermath and queue handling ownership
* page-advance decisions that can be expressed through session primitives

Definition of done:

* `paginate-packagers.ts` is materially smaller
* it reads as a coordinator loop rather than a domain-specific procedure
* keep-with-next and continuation behaviors are explained by collaborators plus session primitives, not inline pagination policy

Concrete steps:

1. Identify every branch in `paginate-packagers.ts` that exists only for keep-with-next or continuation aftermath.
2. Classify each branch as one of:
   `collaborator concern`, `session primitive`, `actor concern`, or `true coordinator concern`.
3. Move reusable state transitions into `LayoutSession`.
4. Move policy decisions into collaborators.
5. Leave only sequencing glue in the paginator.
6. Re-run regression and perf checks.

Priority:
**Highest**

---

### Phase B: Strengthen Shared World State

Objective:
Make `LayoutSession` the clear owner of shared runtime state rather than just a large utility container.

Primary targets:

* collaborator-to-collaborator coordination through session APIs
* explicit page-scoped and run-scoped state ownership
* reservation/exclusion targeting and resolution living in session-owned logic
* cleaner reporting of page-local simulation state

Definition of done:

* collaborators do not reinvent selector or targeting logic
* session APIs describe durable world-state concepts rather than paginator accidents
* new systems can coordinate through session-owned state without touching the paginator

Concrete steps:

1. Audit current `LayoutSession` APIs for accidental paginator-shape leakage.
2. Consolidate selector and targeting logic behind session-owned helpers.
3. Normalize reservation and exclusion lifecycle naming around page-start, negotiation, commit, and finalization.
4. Add or refine simulation artifacts only where they prove shared runtime state, not just diagnostics.

Priority:
**High**

---

### Phase C: Richer Spatial Negotiation

Objective:
Make `ConstraintField` feel like real shared terrain, not just width/height plus attachments.

Primary targets:

* shared use of exclusions and lane narrowing
* clearer reservation/exclusion negotiation semantics
* reducing any remaining one-off spatial logic that bypasses the shared model

Definition of done:

* terrain-affecting behaviors are expressed through shared negotiation surfaces
* spatial constraints are explainable in one model across story, tables, page reservations, and exclusions

Concrete steps:

1. Audit where spatial rules are still packager-private or paginator-private.
2. Promote reusable terrain logic into shared constraint/session mechanisms.
3. Add narrow probes when a spatial seam resists generalization.
4. Keep `StoryPackager` internals intact unless a shared mechanism can replace duplication honestly.

Priority:
**High**

---

### Phase D: Harden Transformable Actor Contracts

Objective:
Treat split, morph, and clone as stronger runtime contracts rather than metadata-only declarations.

Primary targets:

* transform capability consistency across all packagers
* continuation identity integrity across transformations
* clearer actor-level guarantees around split/morph/clone behavior

Definition of done:

* actor transform capabilities are trustworthy enough for collaborators and future orchestration
* transform summaries match actual runtime behavior on fixtures
* clone-aware and morph-aware behavior is validated beyond the initial proof points

Concrete steps:

1. Audit each packager's declared transform profile against actual behavior.
2. Tighten any mismatches between declared capability and runtime reality.
3. Add probe fixtures where transform semantics are still implicit.

Priority:
**Medium-High**

---

### Phase E: Print Pipeline Handoff

Objective:
Build the clean post-simulation handoff described in the architecture docs.

Primary targets:

* heading telemetry collaborator
* simulation-complete artifact handoff for print-domain consumers
* groundwork for TOC, bookmarks, and cross-reference post-processing

Definition of done:

* heading landing data is available as simulation output
* a print-domain consumer can build post-processed artifacts without touching the paginator
* TOC work has a clean substrate even if full TOC generation is not yet built

Concrete steps:

1. Implement `HeadingTelemetryCollaborator`.
2. Publish heading telemetry into the simulation report.
3. Expose a print-oriented read path for finalized pages plus artifacts.
4. Add at least one regression or integration check proving the handoff.

Priority:
**Medium**

---

### Phase F: Multi-Pass / Fixpoint Simulation

Objective:
Support controlled reruns for genuinely layout-coupled features.

Primary targets:

* host-owned rerun mechanism
* full rerun first, dirty-region optimization later
* comparison of source-to-page assignment across runs

Definition of done:

* rerun decisions are owned by the pipeline host, not collaborators
* one honest end-to-end rerun path exists
* dirty-region optimization remains optional until needed

Concrete steps:

1. Define the minimal pipeline API for a second pass.
2. Use session artifacts to compare `sourceId -> pageIndex` across passes.
3. Implement full rerun support before any dirty-region optimization.
4. Add a narrow probe for a layout-coupled rerun case.

Priority:
**Medium**

---

### Phase G: Incremental / Real-Time Semantics

Objective:
Reserve for later. Do not pull this forward unless another phase proves blocked by it.

Priority:
**Low**

---

## 6. Immediate Backlog

These are the next best slices to do now:

1. Audit and annotate the remaining non-coordinator logic in [`paginate-packagers.ts`](/c:/Users/cosmic/Projects/vmprint/engine/src/engine/layout/packagers/paginate-packagers.ts).
2. Extract another concrete keep-with-next ownership slice out of the paginator.
3. Extract another continuation-aftermath slice out of the paginator.
4. Add `HeadingTelemetryCollaborator` and report output.
5. Add at least one probe fixture for a print-pipeline telemetry consumer.

If there is uncertainty between two tasks, choose the one that removes more logic from the paginator.

---

## 7. Per-Slice Checklist

For every overhaul change:

1. State the seam being addressed.
2. State who should own that behavior in the target architecture.
3. Implement the smallest honest transfer of ownership.
4. Run targeted regression checks.
5. Run warmed hotspot perf checks:
   `09-tables-spans-pagination`
   `10-packager-split-scenarios`
   `00-all-capabilities`
6. If the slice is substantial, run a warmed broader perf pass.
7. Record whether the paginator became thinner, unchanged, or thicker.

If the paginator gets thicker, assume the slice needs another pass or should be reconsidered.

---

## 8. Progress Scoring

Use this scorecard for future reassessment:

* Thin coordinator semantics: **50%**
* Shared world-state ownership: **75%**
* Rich spatial negotiation: **70%**
* Transformable actor contract: **70%**
* Print pipeline handoff: **25%**
* Multi-pass / fixpoint support: **10%**
* Incremental semantics: **0%**

This weighted view is why the overall estimate is around **68%** rather than higher.

---

## 9. Anti-Goals

Do not spend overhaul time on:

* naming churn without ownership change
* generalized abstractions that only mirror current code
* showcase-first work without substrate value
* speculative incremental architecture before print/batch completion
* adding fresh paginator exceptions to solve local feature needs

---

## 10. How This Plan Should Be Used

This document should be the default reference for future overhaul work.

When choosing the next task:

1. Prefer the highest-priority incomplete phase.
2. Prefer the slice that removes the most non-coordinator ownership from the paginator.
3. Use fixtures and probes to prove new primitives before broadening them.
4. Re-estimate progress only after meaningful ownership transfer, not after cosmetic refactors.

If a task does not make VMPrint more honestly behave like a layout simulation engine, it is not overhaul work.
