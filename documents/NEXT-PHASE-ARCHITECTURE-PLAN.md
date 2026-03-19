# Next-Phase Architecture Plan

This document defines the next implementation phase of the VMPrint architecture overhaul.

It is guided by the current conclusion that the engine's **substrate is now real**, but that the higher-level runtime systems are still only **partially ported** to that substrate.

The short version is:

* speculative branching, rollback, checkpoints, and observer infrastructure are real
* the signal model is not yet transactionally mature
* the engine still replays too much state when recovering from invalidation
* the simulator loop still owns too much domain intelligence
* the architecture still lacks one decisive proof feature: a live in-flow reactive layout actor

This phase exists to close that gap.

---

## 1. Primary Objective

Turn the current simulation substrate into an honestly reactive runtime.

That means this phase is not about adding more vocabulary.
It is about making the following architectural claims true in runtime behavior:

* speculative signals are branch-local until commit
* committed observers only see committed truth
* dirty-frontier replay becomes narrower and more intentional
* the simulator loop loses more domain ownership
* at least one real layout feature proves the model by depending on live signal propagation

The canonical proof feature for this phase is a **live Table of Contents actor**.

---

## 2. Why This Phase Comes Next

The current engine has already built the hard lower-level machinery:

* explicit speculative branches
* snapshot / rollback
* checkpoint registry
* observer sweeps
* artifact channels

What remains unfinished is the **runtime contract above that machinery**.

So this phase is about porting the game onto the engine that now exists.

---

## 3. Success Criteria

This phase should be considered successful when all of the following are true:

* signals have branch provenance and explicit maturity
* speculative signals do not leak into committed reads
* observer-triggered invalidation uses more precise replay boundaries than "nearest broad restore point"
* the march loop delegates more logic into systems and collaborators
* a TOC or equivalent live dependent actor exists and works through real runtime reactivity
* the proof feature survives regression and performance checks

If those conditions are not met, the architecture is still only partially embodied.

---

## 4. Strategic Order

Work should be taken in this order:

1. **Signal maturity**
2. **Precision restore-point targeting**
3. **Live in-flow reactive actor**
4. **Thin the simulator loop around the new runtime model**
5. **Only then broaden the model into richer multi-hop reactive chains**

This order is intentional.
Signal maturity is the prerequisite for trustworthy reactivity.
The live actor is the proof target that forces the rest of the model to become real.

---

## 5. Phase A - Transactional Signal Maturity

### Objective

Upgrade the signal model from "published data on a rollback-capable bulletin board" to "branch-aware staged truth with explicit commit semantics."

### Problem Being Solved

The current engine gates observers largely through scheduling.
That is useful, but it is weaker than true transactional isolation.

What is missing is:

* branch provenance on emitted signals
* maturity state
* separation between speculative signal visibility and committed signal visibility

### Architectural Outcome

After this phase, the engine should be able to say:

* speculative branches may publish signals
* those signals exist in the branch
* they do not become committed truth unless the branch commits
* committed observers and committed readers cannot accidentally consume speculative truth

### Required Runtime Changes

Introduce explicit signal provenance data:

```ts
type SignalMaturity = 'speculative' | 'committed';

type PublishedSignal = {
  id: string;
  topic: string;
  payload: unknown;
  actorId: string;
  branchId: string | null;
  maturity: SignalMaturity;
  sequence: number;
  pageIndex: number | null;
};
```

### Implementation Targets

Likely touch points:

* `engine/src/engine/layout/actor-event-bus.ts`
* `engine/src/engine/layout/layout-session.ts`
* `engine/src/engine/layout/session-collaboration-runtime.ts`
* `engine/src/engine/layout/session-world-runtime.ts`
* `engine/src/engine/layout/ai-runtime.ts`
* `documents/SPECULATIVE-TRANSACTIONS.md`
* engine tests around speculative branching and observer behavior

### Concrete Steps

1. Add `branchId` and `maturity` to the signal model.
2. Ensure `executeSpeculativeBranch(...)` opens a signal scope.
3. Route speculative publications into a branch-local lane.
4. On branch commit, promote staged signals into committed truth.
5. On rollback, discard staged signals completely.
6. Add explicit read APIs:
   * committed-only reads
   * branch-visible reads
7. Ensure committed observers only use committed reads by default.
8. Add telemetry for:
   * speculative signal count
   * committed signal promotions
   * discarded speculative signals

### Acceptance Criteria

* a speculative branch can publish a signal and then roll back without leaving residue
* a speculative branch can publish a signal and commit it into committed truth
* a committed observer cannot observe speculative-only signals
* tests prove the difference between branch-visible reads and committed reads

### Priority

**Highest**

---

## 6. Phase B - Precision Restore-Point Targeting

### Objective

Narrow replay after invalidation so the engine stops treating checkpoint restoration as a broad re-simulation hammer.

### Problem Being Solved

Current replay restores from a safe checkpoint and reruns all work after that point.
That is real infrastructure, but it is weaker than the more precise restore-point targeting the architecture is aiming for.

The missing behavior is:

* preserving stable upstream work
* narrowing replay ownership to the invalidated frontier as much as the runtime honestly allows

### Architectural Outcome

After this phase, replay should be explainable as:

* restore the nearest safe valid substrate state
* preserve explicitly locked committed prelude state
* replay only what the invalidation actually dirtied

This phase does **not** require perfect zero-replay for every upstream component immediately.
It does require the runtime to move in that direction honestly and measurably.

### Implementation Targets

Likely touch points:

* `engine/src/engine/layout/layout-session.ts`
* `engine/src/engine/layout/lifecycle-runtime.ts`
* `engine/src/engine/layout/pagination-loop-runtime.ts`
* `engine/src/engine/layout/simulation-report-bridge.ts`
* checkpoint / frontier restore utilities
* replay-related regression probes

### Concrete Steps

1. Define replay tiers:
   * substrate restore point
   * locked committed prelude
   * dirty frontier start
2. Add metadata that distinguishes:
   * replay-safe committed actors
   * replay-required actors
3. Track whether a checkpoint preserves a committed prelude slice.
4. Add replay accounting:
   * actor render count before replay
   * actor render count after replay
   * replay span width
5. Introduce a narrow probe fixture where a dirty frontier invalidates downstream layout while an upstream actor should remain stable.
6. Use the probe to drive incremental narrowing of replay ownership.

### Acceptance Criteria

* replay metrics are visible in tests or simulation reports
* at least one probe demonstrates a stable upstream prelude across targeted replay
* replay boundaries are described by explicit runtime metadata instead of being implicit in loop control

### Priority

**High**

---

## 7. Phase C - Live In-Flow Reactive Actor

### Objective

Build the first real feature that cannot be honestly implemented without the architecture becoming reactive.

### Canonical Target

A live **Table of Contents actor**.

This actor should:

* exist in the layout flow
* subscribe to heading emergence
* grow based on committed heading telemetry
* invalidate downstream geometry when it outgrows its reserved footprint
* participate in replay through the same runtime model as any other actor

### Why TOC Is The Right Proof

TOC is the best forcing function because it requires:

* committed signal maturity
* live dependent structure
* invalidation and replay
* downstream displacement
* proof that the architecture is more than artifact collection

### Important Boundary

The first implementation does **not** need to be the most feature-rich TOC generator.
It needs to be the most honest architecture proof.

So the first TOC actor should be intentionally narrow:

* single document TOC
* heading level subset if necessary
* no attempt to solve every front-matter convention immediately

### Implementation Targets

Likely touch points:

* `engine/src/engine/layout/heading-telemetry-collaborator.ts`
* `engine/src/engine/layout/page-reservation-collaborator.ts`
* `engine/src/engine/layout/page-region-artifact-collaborator.ts`
* `engine/src/engine/layout/layout-core.ts`
* `engine/src/engine/layout/packagers/`
* `engine/src/engine/layout/actor-event-bus.ts`
* `engine/src/engine/layout/simulation-report.ts`
* AST / document plumbing for declaring a TOC actor

### Concrete Steps

1. Define a minimal authored TOC element or print-pipeline actor declaration.
2. Make heading telemetry available as committed signal traffic, not just passive artifacts.
3. Implement a TOC actor that can:
   * subscribe to committed heading signals
   * stage TOC entries
   * measure its own growth
   * request invalidation when its footprint changes
4. Reserve a bounded front-matter region for the TOC actor.
5. Add replay logic that allows body pagination to settle against the updated TOC footprint.
6. Add a regression fixture proving:
   * TOC grows from committed heading truth
   * body pages shift accordingly
   * replay remains deterministic

### Acceptance Criteria

* a real document fixture generates a TOC through the runtime, not offline post-processing
* TOC updates are driven by committed heading signals
* the engine converges deterministically
* the feature works through runtime reactivity, not a hidden second-pass AST rewrite

### Priority

**High**

---

## 8. Phase D - Thin The Simulator Loop Again

### Objective

Use the new transactional signal model and live reactive actor pressure to remove more domain intelligence from the march loop.

### Problem Being Solved

The simulator loop is still too thick.
That thickness is now more visible because the lower substrate is strong enough to support a cleaner ownership model.

### Architectural Outcome

`execute-simulation-march.ts` should become more obviously:

* sequencing
* dispatch
* resolution handoff

and less obviously:

* continuity policy
* replay policy
* special-case local feature logic

### Concrete Steps

1. Re-audit the loop after Phases A-C land.
2. Classify every remaining domain branch as one of:
   * true coordinator concern
   * transitions concern
   * AI concern
   * lifecycle concern
   * reactive invalidation concern
3. Move branch-specific logic out of the loop.
4. Keep line count reduction secondary to ownership transfer.

### Acceptance Criteria

* more of the march loop reads like runtime coordination instead of policy logic
* TOC / reactive invalidation logic does not get added to the loop as ad hoc exceptions

### Priority

**Medium-High**

---

## 9. Phase E - Multi-Hop Reactive Chains

### Objective

Move beyond one-hop heading-to-TOC reactivity into a more general model of dependent layout actors.

### This Phase Is Not Immediate

Do not start here first.
TOC is the proof feature.
Multi-hop chains should only begin after the TOC path is real and stable.

### Examples Of Future Targets

* TOC influencing running heads or outline regions
* index-like observers
* bibliography or endnote structures whose footprint affects later regions
* adjacent live panels in future editor surfaces

### Priority

**Deferred until the TOC proof is stable**

---

## 10. Testing Strategy For This Phase

Each slice in this phase must add proof-oriented tests, not only implementation.

### New Test Categories Needed

* speculative signal maturity tests
* branch commit / rollback signal visibility tests
* targeted replay accounting tests
* live TOC convergence fixture
* loop-thinning ownership checks where possible

### Benchmark Discipline

Every meaningful slice should run at least:

* `00-all-capabilities`
* `10-packager-split-scenarios`
* `17-header-footer-test`
* the new TOC proof fixture once it exists

If replay or signal maturity changes touch long-document behavior, also run the long manuscript benchmark path.

---

## 11. Immediate Backlog

This is the recommended first working backlog for the phase:

1. Design and implement branch-aware signal provenance.
2. Add committed-only vs branch-visible signal read paths.
3. Write rollback leakage tests for speculative signals.
4. Add replay accounting and a locked-prelude replay probe.
5. Convert heading telemetry from passive artifact-only output into committed runtime signal flow.
6. Define the minimal authored TOC declaration.
7. Implement the first in-flow TOC actor.
8. Add a deterministic TOC proof fixture.
9. Re-audit the simulator loop and remove newly exposed policy branches.

If there is any doubt about prioritization, choose the task that most directly advances the TOC proof path.

---

## 12. What Not To Do In This Phase

Do not spend this phase on:

* naming cleanup without runtime ownership change
* broad "physics" rewrites without a concrete forcing seam
* generalized multi-hop reactive infrastructure before one honest live actor exists
* TOC generation as a hidden post-process masquerading as runtime behavior
* feature growth before signal maturity is correct

This phase is about proof, not breadth.

---

## 13. Progress Judgment

At the end of this phase, ask:

* Are signals now transactionally honest?
* Can a live layout actor react to committed truth inside the runtime?
* Has replay become narrower and more measurable?
* Has the simulator loop become less like the domain brain?

If yes, the architecture will have crossed from "substrate achieved" into "runtime model embodied."

If no, the engine will still be in the halfway state:
real substrate, old systems.
