# Kernel Actor Activation and Update Implementation Plan

*Execution plan, March 2026.*

Companion to:

* [KERNEL-ACTOR-ACTIVATION-AND-UPDATE.md](/c:/Users/cosmic/Projects/vmprint/documents/KERNEL-ACTOR-ACTIVATION-AND-UPDATE.md)

---

## 1. Objective

Implement kernel-level, non-domain-specific actor activation and update support in VMPrint without compromising deterministic settlement or the current performance profile.

The initial goal of this phase was **not** to make `{totalPages}` work immediately.

The goal was to establish and prove a generic runtime primitive through synthetic visual experiments first, then adopt it in production features afterward.

That sequencing has now been completed: the synthetic proof suite landed first, and `{totalPages}` was then migrated onto the generic runtime primitive as the first production adoption.

---

## 2. Guiding Rules

1. The primitive must be kernel-level and domain-agnostic.
2. The first proof bed must be synthetic and visual, not a document feature.
3. Dormant actors must remain cheap.
4. `content-only` and `geometry` must be treated as different runtime cost classes.
5. Any geometry-reactive path must be bounded against oscillation.
6. Every meaningful slice must record performance before and after.

---

## 3. High-Level Rollout

The work should proceed in six phases:

1. Phase 0 - Proof harness and baseline instrumentation
2. Phase 1 - Kernel activation/update primitives
3. Phase 2 - Synthetic content-only proof
4. Phase 3 - Synthetic geometry-reactive proof
5. Phase 4 - Oscillation safety and diagnostics
6. Phase 5 - First production adoption

The production adoption phase should come only after the synthetic proofs are stable and regression-protected.

---

## 4. Success Criteria

This implementation phase is successful when:

* the kernel/runtime can track actor activation state generically
* actors can be awakened selectively by committed signals
* awakened actors can produce `none`, `content-only`, or `geometry` outcomes
* `content-only` updates patch or redraw actor-owned output without resettlement
* `geometry` updates route through bounded resettlement
* synthetic visual proofs exist for both content-only and geometry-changing cases
* replay/no-replay behavior is inspectable by eye and asserted in tests
* oscillation protection exists and fails deterministically
* performance evidence shows dormant-path overhead is negligible

---

## 5. Phase 0 - Proof Harness and Baseline Instrumentation

### Purpose

Prepare the repo to prove the primitive visually and measure its cost.

### Required work

* define where the new synthetic proofs live
* decide whether they stay in `engine/experiments/` first, or are paired with regression fixtures from day one
* add any minimal helper packagers/collaborators needed to render visual traces
* add or extend profiling counters for:
  * actor awakenings
  * actor update calls
  * content-only updates
  * geometry updates
  * skipped dormant actors
  * settlement-cycle count

### Recommended proof conventions

Synthetic proofs should use obvious visual artifacts:

* strongly colored boxes
* render-count text
* wake-count text
* stable labels for actor identity
* visible “changed in place” markers
* visible geometry movement markers

### Deliverables

* proof naming convention
* baseline perf numbers captured before implementation
* profiling fields reserved in runtime metrics

---

## 6. Phase 1 - Kernel Activation/Update Primitives

### Purpose

Introduce the minimal generic runtime substrate.

### Required runtime concepts

At minimum, add generic support for:

* actor activation state
* topic-based wake subscriptions
* awakened actor queue/set
* deterministic wake processing order
* actor update invocation
* update result classification

### Conceptual model

Possible generic shapes:

```ts
type ActorActivationState = 'dormant' | 'event-awakened' | 'active' | 'suspended';

type ActorUpdateKind = 'none' | 'content-only' | 'geometry';

type ActorUpdateResult = {
  changed: boolean;
  kind: ActorUpdateKind;
  earliestAffectedFrontier?: SpatialFrontier;
};
```

### Likely touch points

* `engine/src/engine/layout/kernel.ts`
* `engine/src/engine/layout/layout-session.ts`
* `engine/src/engine/layout/actor-communication-runtime.ts`
* `engine/src/engine/layout/packagers/packager-types.ts`
* `engine/src/engine/layout/layout-session-types.ts`

### Important constraint

This phase should not yet adopt page counters, headers, footers, or any other document-domain behavior.

It should only establish the generic runtime vocabulary and scheduling path.

---

## 7. Phase 2 - Synthetic Content-Only Proof

### Purpose

Prove that an awakened actor can update in place without triggering resettlement.

### Canonical proof shape

Create a synthetic actor arrangement where:

* actor A publishes a committed signal
* actor B is visually present before the signal resolves
* actor B wakes and changes content or color only
* actor B's geometry remains identical
* downstream and upstream actors do not move
* replay counters prove no resettlement occurred

### Visual proof requirements

The page itself should let us see:

* original actor placement
* updated actor content
* unchanged geometry footprint
* unchanged upstream render counts
* unchanged downstream positions

### Assertions

Tests should assert:

* actor B woke
* actor B reported `content-only`
* actor B's box rect is unchanged
* no dirty-frontier resettlement was invoked
* no duplicate boxes were left behind

### Deliverable

A synthetic visual proof equivalent in clarity to the strongest existing experiments.

---

## 8. Phase 3 - Synthetic Geometry-Reactive Proof

### Purpose

Prove that awakened actors returning `geometry` route through bounded resettlement correctly.

### Canonical proof shape

Create a synthetic actor arrangement where:

* actor A publishes a committed signal
* actor B wakes and visibly grows
* actor C or later actors move as a result
* a render-count marker proves whether upstream actors replayed
* the dirty frontier is visually understandable

### Assertions

Tests should assert:

* actor B woke
* actor B reported `geometry`
* downstream movement occurred deterministically
* upstream exclusion still holds where expected
* no duplicated residue is left behind

### Deliverable

A synthetic visual proof that complements the TOC proof but is simpler, more isolated, and explicitly about the new primitive.

---

## 9. Phase 4 - Oscillation Safety and Diagnostics

### Purpose

Ensure geometry-reactive updates cannot silently loop forever.

### Required safeguards

Implement and test:

* settlement-cycle cap
* repeated-state detection or equivalent cycle detection
* deterministic failure path with useful diagnostics
* metrics/logging for:
  * wake reason
  * actor updated
  * update kind returned
  * number of settlement cycles triggered

### Synthetic proof cases

Add at least one intentionally pathological proof:

* actor A changes geometry
* resettlement republishes a fact
* actor A or B wakes again
* runtime hits the cap or detects repetition
* failure is deterministic and inspectable

### Deliverable

A proof that the engine cannot be dragged into silent reactive churn.

---

## 10. Phase 5 - First Production Adoption

### Purpose

Use a real feature to prove that the primitive can replace an existing architectural hack.

### Recommended first adoption

`{totalPages}` was the strongest candidate, and it has now been adopted **after** the synthetic proof suite completed.

Why it is a good first adoption:

* it is a clean example of content-only update
* it currently exposes a domain-specific patch path
* replacing that path would be a concrete architectural cleanup

### Adoption rule

The production adoption should replace:

* feature-specific defer buckets
* feature-specific patch stages
* feature-specific orchestration inside `simulate()`

That standard has now been met for `{totalPages}`: the old defer-and-patch path was removed rather than preserved under a new wrapper.

---

## 11. Performance Discipline

Every substantial slice in this plan must record before/after timings.

At minimum, benchmark:

* `00-all-capabilities`
* `10-packager-split-scenarios`
* `17-header-footer-test`
* `24-toc-live-reactive`
* each new synthetic proof once added

For activation/update slices specifically, also record:

* awaken count
* update count
* geometry-update count
* content-only update count
* settlement-cycle count

Each slice should classify the result as:

* neutral
* improved
* regressed

If there is regression:

* fix it
* explain and bound it
* or stop and redesign before proceeding

---

## 12. Implementation Order in Practice

The first concrete coding slices should probably be:

1. Add runtime metric fields for activation/update accounting.
2. Add generic activation/update types to the runtime vocabulary.
3. Add a dormant-path-safe awakened actor queue/set.
4. Add one synthetic actor/update proof for `content-only`.
5. Route `content-only` to in-place redraw/patch.
6. Add one synthetic actor/update proof for `geometry`.
7. Add settlement cap and oscillation diagnostics.
8. Only then evaluate production adoption for `{totalPages}`. **DONE**

This order keeps the primitive honest and keeps the feature pressure from defining the architecture prematurely.

---

## 13. Files Likely to Be Touched

This is a probable list, not a final contract.

Runtime/kernel:

* `engine/src/engine/layout/kernel.ts`
* `engine/src/engine/layout/layout-session.ts`
* `engine/src/engine/layout/layout-session-types.ts`
* `engine/src/engine/layout/actor-communication-runtime.ts`
* `engine/src/engine/layout/actor-event-bus.ts`

Packager and actor interfaces:

* `engine/src/engine/layout/packagers/packager-types.ts`

Simulation orchestration:

* `engine/src/engine/layout/packagers/execute-simulation-march.ts`
* `engine/src/engine/layout/session-collaboration-runtime.ts`

Proofs and tests:

* `engine/experiments/...`
* `engine/tests/...`
* synthetic fixtures and snapshots to be added

Later production adoption:

* `engine/src/engine/layout/layout-page-finalization.ts` **DONE for first adoption**
* `engine/src/engine/layout/layout-core.ts` **DONE for first adoption**

---

## 14. Anti-Goals

This phase should not:

* introduce a mandatory per-frame tick for all actors
* couple the kernel to page counters, headers, or footers
* solve user scripting in full
* broaden the signal system into an unbounded event soup
* adopt production-domain features before the primitive is proven synthetically

---

## 15. Completion Standard

Do not declare this architecture "implemented" when the API exists.

Declare it implemented only when:

* the runtime primitive exists
* synthetic visual proofs are passing
* oscillation safety is passing
* performance is measured
* one real feature has replaced an older patch path with the new primitive **DONE (`{totalPages}`)**

Until then, the work is still in rollout.
