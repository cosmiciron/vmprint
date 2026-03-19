# Kernel Simulation Clock Implementation Plan

*Execution plan, March 2026.*

Companion to:

* [KERNEL-SIMULATION-CLOCK-AND-PROGRESSION.md](/c:/Users/cosmic/Projects/vmprint/documents/KERNEL-SIMULATION-CLOCK-AND-PROGRESSION.md)
* [PRINT-AS-WORLD-SLICE.md](/c:/Users/cosmic/Projects/vmprint/documents/PRINT-AS-WORLD-SLICE.md)

---

## 1. Objective

Introduce a kernel-owned simulation clock and resumable progression model in VMPrint without destabilizing the current print path.

The goal of this phase is **not** to build the cooking demo immediately.

The goal is to:

* establish the clock as a real kernel primitive
* integrate it with session state and snapshot/restore
* make progression and stopping more explicit
* and prove one small synthetic case of deliberate progression before capture

The cooking demo should come after that proof, not before it.

---

## 2. Guiding Rules

1. The clock must be kernel-owned and subsystem-agnostic.
2. The clock must be simulation time, never wall time.
3. Stop/snapshot/resume must be established before public stopping policy gets elaborate.
4. Ordinary print must remain cheap and deterministic.
5. Progression policy must remain layered above kernel progression primitives.
6. The first proof should be synthetic, visual, and measurable.

---

## 3. High-Level Rollout

The work should proceed in six phases:

1. Phase 0 - Baseline instrumentation and terminology cleanup
2. Phase 1 - Minimal `SimulationClock` in the session
3. Phase 2 - Snapshot/restore integration
4. Phase 3 - Signal stamping and observability
5. Phase 4 - Explicit progression/stop contract for the default print path
6. Phase 5 - First synthetic deliberate-progression proof

Only after those phases should the team begin a cooking demo or a public stopping-policy surface.

---

## 4. Success Criteria

This phase is successful when:

* the session owns a discrete deterministic simulation clock
* the clock can be captured and restored with branch state
* committed signals can be stamped with tick
* runtime/profile output can report tick counts
* the default print path is explicitly understood as "progress until settled"
* ordinary documents show negligible overhead from the clock
* one synthetic proof demonstrates deliberate multi-tick progression before capture
* no public API forces a premature stopping-policy taxonomy

---

## 5. Phase 0 - Baseline Instrumentation And Terminology

### Purpose

Prepare the codebase and profiling surface so the clock can be added without ambiguity.

### Required work

* reserve profile counters for:
  * `simulationTickCount`
  * `progressionStopCalls`
  * `progressionResumeCalls`
  * `progressionSnapshotCalls`
* identify where the current march loop implicitly advances world state
* identify which existing counters will act as the dormant-path watchlist
* normalize document wording in plans and comments:
  * prefer "progression" or "simulation advancement" over ad hoc loop language

### Deliverables

* baseline perf numbers recorded before the clock lands
* naming agreement around:
  * clock
  * tick
  * progression
  * stop
  * snapshot
  * resume
  * capture

---

## 6. Phase 1 - Minimal Session Clock

### Purpose

Add the smallest useful `SimulationClock` without exposing major public API changes yet.

### Required work

Introduce a minimal kernel/session-owned clock, conceptually:

```ts
type SimulationClockSnapshot = { tick: number };

class SimulationClock {
  readonly tick: number;
  advance(): number;
  captureSnapshot(): SimulationClockSnapshot;
  restoreSnapshot(snapshot: SimulationClockSnapshot): void;
}
```

### Likely touch points

* `engine/src/engine/layout/layout-session.ts`
* `engine/src/engine/layout/layout-session-types.ts`
* possibly `engine/src/engine/layout/kernel.ts`

### Important constraint

This phase should not yet expose a public "run for N ticks" API.

It should only make the clock exist and be observable inside the session/runtime.

---

## 7. Phase 2 - Snapshot/Restore Integration

### Purpose

Make the clock part of resumable world state.

### Required work

Include the clock in:

* local branch snapshots
* speculative branch rollback
* safe checkpoint restoration

This is essential because time continuity is part of world continuity.

### Likely touch points

* `engine/src/engine/layout/fragment-session-runtime.ts`
* `engine/src/engine/layout/kernel.ts`
* `engine/src/engine/layout/layout-session-types.ts`
* `engine/src/engine/layout/layout-session.ts`
* `engine/src/engine/layout/actor-communication-runtime.ts`

### Proof requirement

At least one small experiment should assert:

* clock advances
* speculative branch advances further
* rollback restores the prior tick exactly

---

## 8. Phase 3 - Signal Stamping And Observability

### Purpose

Give world facts a temporal coordinate.

### Required work

Extend committed signals to carry:

* `tick`

Potentially alongside future:

* `branchId`
* `maturity`

### Why now

This phase gives us immediate value without requiring actor stepping yet:

* we can tell when a fact committed
* we can compare sequence vs tick
* we can reason about progression history more cleanly

### Likely touch points

* `engine/src/engine/layout/actor-event-bus.ts`
* `engine/src/engine/layout/layout-session.ts`
* `engine/src/engine/layout/actor-communication-runtime.ts`
* experiments around signal rollback and communication

---

## 9. Phase 4 - Explicit Default Progression Contract

### Purpose

Make the existing print path explicitly "progress until settled" rather than leaving that behavior as implicit loop structure.

### Required work

Without overdesigning public API, clarify in runtime code and reporting that:

* the session is progressing the world
* the default stop policy is settlement
* the final page output is a capture taken when that stop condition is met

### This phase should not do

* public custom stopping-policy surface
* duration-based runtime controls
* arbitrary user predicates in public API

### Deliverable

An internal progression contract that makes the default print path legible as policy rather than magic.

---

## 10. Phase 5 - First Synthetic Deliberate-Progression Proof

### Purpose

Prove that the world can progress for more than one deliberate tick before capture.

### Canonical proof shape

Use a synthetic visual proof, not a product demo.

Possible shape:

* one actor wakes or steps over several ticks
* each tick leaves a visible mark
* content accumulates or changes deterministically
* final capture shows the world after multiple deliberate advances

Examples:

* a text actor that appends one line per tick
* a tiny bar chart that grows one column step per tick
* a synthetic "cooking" actor whose state panel visibly increments from tick to tick

### Assertions

Tests should assert:

* the final capture reflects more than one tick of progression
* tick count is reported
* deterministic repeated runs match exactly
* rollback still restores the prior tick if speculative branching occurs

### Important rule

This is not yet the public demo.

It is the first proof that deliberate progression before capture is real.

---

## 11. Performance Discipline

Every substantial slice must record before/after numbers.

At minimum:

* `00-all-capabilities`
* `17-header-footer-test`
* `24-toc-live-reactive`
* `25-total-pages-footer`
* the new synthetic clock/progression proof once added

For the clock specifically, record:

* total tick count
* dormant actor skip count
* actor wake count
* actor update count
* resettlement cycles
* total layout time

The key safety question is simple:

**does the new clock impose hidden cost on ordinary until-settled documents?**

If yes:

* measure it
* explain it
* and reduce it before proceeding

---

## 12. Files Likely To Be Touched

Likely kernel/runtime files:

* `engine/src/engine/layout/layout-session.ts`
* `engine/src/engine/layout/layout-session-types.ts`
* `engine/src/engine/layout/kernel.ts`
* `engine/src/engine/layout/fragment-session-runtime.ts`
* `engine/src/engine/layout/actor-event-bus.ts`
* `engine/src/engine/layout/actor-communication-runtime.ts`
* `engine/src/engine/layout/packagers/execute-simulation-march.ts`
* `engine/src/engine/layout/simulation-report.ts`

Likely proof/test files:

* `engine/experiments/proofs/...`
* `engine/tests/...`

---

## 13. Anti-Goals

This phase should not:

* introduce wall-clock-driven progression
* hardcode a public taxonomy of stopping modes too early
* require all actors to step every tick
* confuse speculative rollback snapshots with ordinary sleep/resume persistence
* jump straight into a flashy cooking demo before the kernel proof exists

---

## 14. Completion Standard

Do not call the clock architecture "done" when a `tick` field exists.

Call it done for this phase only when:

* the kernel clock exists
* snapshot/restore includes it
* committed signals can carry it
* the default print path is explicitly framed as progression-until-settled
* one synthetic deliberate-progression proof passes
* and the dormant-path perf remains healthy

Only then should the project move on to a document cooking demo.
