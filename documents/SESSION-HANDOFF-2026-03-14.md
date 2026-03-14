# Session Handoff

Date: 2026-03-14

This handoff is for the next session to resume work without reloading the full
conversation history.

---

## Current State

The architectural overhaul is in a strong state.

What is now real:

* actor-to-actor communication exists through a session-owned bulletin board
* the event bus is branch-aware and rollback-safe
* observers are reevaluated by `LayoutSession` at controlled checkpoints
* observers return `ObservationResult`
* `changed` and `geometryChanged` are distinct
* dirty frontiers are tracked explicitly
* settling restores from safe checkpoints rather than restarting the world
* same-page / intra-page settling is proven
* finer restore precision is now visibly proven, not just inferred

The synthetic test lane has probably done its job.
The next likely step is to spend this machinery on a real domain actor, most
likely TOC, while staying disciplined about the consumer/engine boundary.

---

## Read These First

Primary documents:

* [ACTOR-COMMUNICATION.md](C:/Users/cosmic/Projects/vmprint/documents/ACTOR-COMMUNICATION.md)
* [ACTORS.md](C:/Users/cosmic/Projects/vmprint/documents/ACTORS.md)
* [OVERHAUL-OBJECTIVE.md](C:/Users/cosmic/Projects/vmprint/documents/OVERHAUL-OBJECTIVE.md)
* [OVERHAUL-EXECUTION-PLAN.md](C:/Users/cosmic/Projects/vmprint/documents/OVERHAUL-EXECUTION-PLAN.md)

Most important recent additions are in:

* sections `23` through `28` of [ACTOR-COMMUNICATION.md](C:/Users/cosmic/Projects/vmprint/documents/ACTOR-COMMUNICATION.md)

Those sections cover:

* how observers wake up
* `ObservationResult`
* safe checkpoint registry
* refined checkpoint execution flow
* locked-prelude precision proof
* what that proof establishes

---

## Key Architectural Conclusions

### 1. VMPrint is now better understood as spatiotemporal simulation

We began by introducing spatiality into the document engine.
This session formalized that temporality is now also part of the architecture:

* signals mature over time
* speculative truth can be discarded
* committed truth can invalidate earlier geometry
* the world can settle without a full restart

This is now part of the design language, not a side observation.

### 2. The event bus is a passive bulletin board

The bus does not eagerly callback actors.

Instead:

* actors publish normalized signals
* mature signals become visible on the board
* `LayoutSession` reevaluates registered observers at checkpoints

This preserves deterministic control.

### 3. No continuous `tick()`

We rejected a continuous actor `tick()` model.

Instead:

* only registered observers are reevaluated
* reevaluation happens at controlled checkpoints

This is a big performance and clarity win.

### 4. `ObservationResult` is a major optimization

Observers report:

* `changed`
* `geometryChanged`
* `earliestAffectedFrontier`

This allows the session to distinguish:

* semantic change with no reflow
* geometry change that truly invalidates spatial layout

### 5. Safe checkpoints are the abstraction, not page restarts

We started with page-aligned safe checkpoints.

Then we refined the model toward:

* actor/source anchored checkpoints
* finer restore precision
* intra-page settling

The engine should think in terms of:

* "restore the nearest safe checkpoint preceding the dirty frontier"

not:

* "restart from Page 1"

---

## What Was Proven In This Session

### Bulletin-board communication

Proven:

* many publishers -> one observer
* observer geometry change
* observer -> follower chaining
* rollback cleanup for speculative timelines

Relevant visual artifact:

* [actor-communication-visual.pdf](C:/Users/cosmic/Downloads/actor-communication-visual.pdf)

### Synthetic collector / TOC-like behavior

Proven:

* many publishers can feed a collector
* collector can render a numbered list
* collector can span pages
* collector can push trailing flow down

Relevant visual artifact:

* [actor-communication-collector-visual.pdf](C:/Users/cosmic/Downloads/actor-communication-collector-visual.pdf)

### In-flow collector resettling from later mature signals

Proven:

* collector near the front
* publishers later
* later mature signals change earlier collector geometry
* early region resettles
* forward march resumes

Relevant visual artifact:

* [actor-communication-inflow-collector-visual.pdf](C:/Users/cosmic/Downloads/actor-communication-inflow-collector-visual.pdf)

### Dual in-flow collectors

Proven:

* two early collectors
* interleaved later publishers on separate topics
* both collectors resettle
* late aftermath begins only after both have finished claiming space

Relevant visual artifact:

* [actor-communication-dual-inflow-visual.pdf](C:/Users/cosmic/Downloads/actor-communication-dual-inflow-visual.pdf)

### Same-page frontier proof

Proven:

* collector and later publisher remain on the same page
* intra-page settling occurs
* settling is not limited to page-turn checkpoints

Relevant visual artifact:

* [actor-communication-same-page-frontier-visual.pdf](C:/Users/cosmic/Downloads/actor-communication-same-page-frontier-visual.pdf)

Important nuance:

* this proves same-page / intra-page settling
* it does not by itself prove the most precise anchored restore point

### Locked prelude precision proof

This is the strongest new proof from the latest slice.

Proven:

* a replay marker before the collector frontier is preserved
* the collector still learns the later mature signal
* settling affects the collector and downstream flow
* the earlier locked prelude is not replayed

Visible invariant:

* `Render Count: 1`

Relevant visual artifact:

* [actor-communication-locked-prelude-visual.pdf](C:/Users/cosmic/Downloads/actor-communication-locked-prelude-visual.pdf)

This is the first proof where finer restore precision is visible on the page
rather than only inferred from code or tests.

---

## Important Code Files

Engine/session core:

* [layout-session.ts](C:/Users/cosmic/Projects/vmprint/engine/src/engine/layout/layout-session.ts)
* [paginate-packagers.ts](C:/Users/cosmic/Projects/vmprint/engine/src/engine/layout/packagers/paginate-packagers.ts)
* [packager-types.ts](C:/Users/cosmic/Projects/vmprint/engine/src/engine/layout/packagers/packager-types.ts)
* [create-packagers.ts](C:/Users/cosmic/Projects/vmprint/engine/src/engine/layout/packagers/create-packagers.ts)

Synthetic proof actors:

* [test-signal-packagers.ts](C:/Users/cosmic/Projects/vmprint/engine/src/engine/layout/packagers/test-signal-packagers.ts)

Key regression suite:

* [actor-communication.spec.ts](C:/Users/cosmic/Projects/vmprint/engine/tests/actor-communication.spec.ts)

Visual proof generators:

* [actor-communication-visual.ts](C:/Users/cosmic/Projects/vmprint/engine/tests/actor-communication-visual.ts)
* [actor-communication-collector-visual.ts](C:/Users/cosmic/Projects/vmprint/engine/tests/actor-communication-collector-visual.ts)
* [actor-communication-inflow-collector-visual.ts](C:/Users/cosmic/Projects/vmprint/engine/tests/actor-communication-inflow-collector-visual.ts)
* [actor-communication-dual-inflow-visual.ts](C:/Users/cosmic/Projects/vmprint/engine/tests/actor-communication-dual-inflow-visual.ts)
* [actor-communication-same-page-frontier-visual.ts](C:/Users/cosmic/Projects/vmprint/engine/tests/actor-communication-same-page-frontier-visual.ts)
* [actor-communication-locked-prelude-visual.ts](C:/Users/cosmic/Projects/vmprint/engine/tests/actor-communication-locked-prelude-visual.ts)

---

## Current Test Commands

Main synthetic communication regression:

```powershell
npm run test:actors --workspace=engine
```

Visual proofs:

```powershell
npm run test:actors:visual --workspace=engine
npm run test:actors:collector-visual --workspace=engine
npm run test:actors:inflow-collector-visual --workspace=engine
npm run test:actors:dual-inflow-visual --workspace=engine
npm run test:actors:same-page-frontier-visual --workspace=engine
npm run test:actors:locked-prelude-visual --workspace=engine
```

Broader engine confidence:

```powershell
npm run test:engine --workspace=engine
npm run test:perf --workspace=engine
```

---

## Recommended Next Step

The synthetic testing ground is likely exhausted enough.

Recommended next move:

1. Leave the `Test...` lane.
2. Spend the new machinery on the first real domain actor.
3. Most likely candidate: TOC.

But do it with the new discipline:

* consumer stays declarative
* consumer supplies normalized labels/intent
* engine actor stays smart
* event bus remains passive bulletin board
* `LayoutSession` remains the owner of reevaluation and settling

The earlier failed TOC attempts should not be repeated.
This time the TOC should be built on top of the now-proven communication and
settling substrate.

---

## Practical Summary For The Next Session

If starting cold, do this:

1. Read [ACTOR-COMMUNICATION.md](C:/Users/cosmic/Projects/vmprint/documents/ACTOR-COMMUNICATION.md), especially sections `23` to `28`.
2. Open the latest proof artifact:
   * [actor-communication-locked-prelude-visual.pdf](C:/Users/cosmic/Downloads/actor-communication-locked-prelude-visual.pdf)
3. Skim the regression harness:
   * [actor-communication.spec.ts](C:/Users/cosmic/Projects/vmprint/engine/tests/actor-communication.spec.ts)
4. Then decide whether to:
   * begin real TOC re-entry
   * or do one very small integration step toward a real domain actor

Short version:

* synthetic proof lane: mostly complete
* architecture: strong and well documented
* next value: spend it on a real actor
