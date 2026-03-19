# Next-Phase Architecture Plan

*Revised after recovering and re-running the experimental proof suite (March 2026). Updated after TOC landed and total-pages analysis completed (March 2026).*

---

## Revised Opening Assessment

The previous version of this document was written against a code audit that missed a series of experimental commits. Those commits have since been recovered, restored to `engine/experiments/`, and confirmed fully passing.

The corrected picture is materially different from the original assessment.

**What the experiments already proved:**

* In-flow observer growing from later committed signals - proven and passing
* Downstream content resettling from observer geometry change - proven and passing
* Sub-page intra-slice settling (checkpoint fires before page boundary) - proven and passing
* Concurrent independent dual-observer settlement - proven and passing
* Precision restore-point targeting (locked prelude at Render Count: 1, upstream actor excluded from replay) - proven and passing
* Multi-hop signal chain (observer publishes summary, follower reacts spatially) - proven and passing
* Signal bus rollback on speculative discard - proven and passing

Every major architectural claim in the patent specification now has experimental proof.

That does not mean every major architectural claim has been production-hardened.

The correct status is:

* experimentally proven
* not yet fully embodied in shipped document features
* not yet fully promoted into ordinary regression coverage

**What the experiments did not do:**

* Connect real domain actors (headings) as signal publishers during layout - still post-process only *(now done — HeadingSignalCollaborator shipped)*
* Build a real TOC packager using the proven infrastructure *(now done — TocPackager shipped, regression fixture 24 passing)*
* Formally tag individual signals with branch provenance (rollback behavior works via bus snapshot; per-signal `branchId` is still absent)

**The corrected framing:**

The architecture is not "substrate achieved, systems still old-school."
It is: **mechanism proven experimentally, not yet wired to real domain actors.**

That is a much smaller and more targeted gap than the previous assessment described.

---

## 1. Primary Objective

Wire the proven experimental mechanism to real domain actors.

The canonical proof of this is a **live Table of Contents actor** - a packager that:

* sits in the document flow
* subscribes to heading signals emitted during layout
* grows its geometry from committed signal accumulation
* causes downstream resettlement through the same mechanism the experiments proved

This is not a research objective. The mechanism exists and passes the proof suite. The remaining work is domain wiring, not architecture invention.

---

## 2. Revised Strategic Order

The original order was A -> B -> C -> D -> E, where A and B were prerequisites for C.

That ordering no longer holds.

Phase B (precision restore-point targeting) is already done experimentally - the locked prelude experiment proves it. Phase A (signal maturity) is now a formalization task, not a foundational prerequisite. The rollback behavior is correct; what is missing is formal per-signal `branchId` provenance, which is a tightening step, not a blocking one.

The revised order is:

1. **Phase C** - Live in-flow reactive actor (TOC). **CLOSED — shipped.**
2. **Phase C.2** - Content-only reactive update (total pages). **CLOSED â€” shipped.**
3. **Phase A** - Signal maturity formalization. Next tightening task.
4. **Phase D** - Thin the simulator loop. Unlocked by C.2 landing.
5. **Phase E** - Multi-hop reactive chains with real domain actors.

Phase B is closed as an architecture-discovery question, but still needs production hardening before it should be treated as fully retired in the broader overhaul scorecard.

---

## 3. Success Criteria

This phase is complete when:

* ~~A heading packager emits committed signals during layout, not as a post-process artifact~~ **DONE**
* ~~A TOC packager implements `observeCommittedSignals()` and grows from those signals~~ **DONE**
* ~~Downstream body content resettles correctly when the TOC grows~~ **DONE**
* ~~The behavior is deterministic and regression-tested~~ **DONE (fixture 24)**
* ~~A header/footer actor observes `'pagination:finalized'` and patches its box content in place without triggering resimulation~~ **DONE (fixture 25)**
* ~~`changed: true, geometryChanged: false` is acted on by the engine (content re-render, not resimulation)~~ **DONE**
* At least one recovered experiment for each "closed" phase is either migrated into `engine/tests/` or wired into an expected root verification path
* Signal maturity (`branchId`, `maturity`) is formalized on `ActorSignal`
* Speculative signals demonstrably cannot contaminate committed reads by construction, not just by scheduling
* Each meaningful refactor slice has recorded before/after performance evidence and no unexplained regression

---

## 4. Phase B - Precision Restore-Point Targeting

### Status: Closed experimentally

The locked prelude experiment (`testAnchoredCheckpointAvoidsReplayingLockedPrelude`) passes.

The upstream actor (red "Locked Prelude" box) shows Render Count: 1 after the collector settles from a later mature signal. The anchored checkpoint correctly positioned the restore point after the prelude's committed trailing edge. The upstream actor was not replayed.

The implementation in `actor-communication-runtime.ts` and `execute-simulation-march.ts` already delivers the behavior this phase was meant to prove.

No further architecture invention is required for Phase B.

Production-hardening requirement:

* before this phase is treated as fully closed in the main overhaul scorecard, at least one locked-prelude-style replay proof should exist outside the experiments lane

---

## 5. Phase A - Transactional Signal Maturity

### Status: Behavior correct, formal model incomplete

### What works

Signal bus snapshot and restore works correctly. When a speculative branch is discarded, its signals are removed. The rollback test proves this:

* speculative signal published -> visible
* `restoreLocalActorSignalSnapshot()` called -> signal gone
* committed observers only see signals that survived rollback

The behavioral isolation is real.

### What is missing

Individual signals carry no `branchId` or `maturity` field. The isolation is implemented through scheduling (observers are only called at checkpoint boundaries) and through bus-level snapshot/restore, not through per-signal provenance.

This means:

* a signal cannot be inspected to determine which branch published it
* there is no construction-level guarantee that a committed reader cannot access speculative signals - only a scheduling guarantee
* telemetry for speculative signal counts, promotions, and discards is absent

### Required Changes

Add to `ActorSignal`:

```ts
type SignalMaturity = 'speculative' | 'committed';

type ActorSignal = {
  branchId: string | null;
  maturity: SignalMaturity;
  // existing fields...
};
```

Route speculative publications into a branch-local lane inside `actor-event-bus.ts`. On branch commit, promote staged signals. On rollback, discard them. Add explicit committed-only and branch-visible read paths.

### Touch Points

* `engine/src/engine/layout/actor-event-bus.ts`
* `engine/src/engine/layout/layout-session.ts`
* `engine/src/engine/layout/actor-communication-runtime.ts`
* recovered proof `testActorEventBusRollback` - extend to assert per-signal maturity fields

### Priority

**Medium-High** - important for correctness guarantees, but does not gate the TOC implementation. Run alongside or immediately after Phase C.

---

## 6. Phase C - Live In-Flow Reactive Actor

### Status: CLOSED — shipped and regression-tested

### What shipped

* `HeadingSignalCollaborator` — emits `'heading:committed'` signals during layout (additive, does not replace `HeadingTelemetryCollaborator`)
* `TocPackager` — implements `observeCommittedSignals()`, grows from committed heading signals, reports `geometryChanged` correctly, triggers dirty-frontier resimulation
* `type: 'toc'` registered in `create-packagers.ts` and plumbed through the AST/IR
* Regression fixture `24-toc-live-reactive.json` — TOC on page 0 shows correct page references for headings committed on pages 1–3, all in a single simulation pass

This is the proof that **geometric reactive growth** works end-to-end with real domain actors: new TOC entries increase the TOC height, downstream actors shift, the simulation resettles deterministically.

With Phase C and Phase C.2 both now landed, the next architectural pressure is no longer merely "reactivity."
It is **time itself**:

* who owns it
* how the world advances against it
* how the kernel can stop, snapshot, sleep, and resume
* and how print capture should be understood as a slice of that progression

That next step is described more directly in [PRINT-AS-WORLD-SLICE.md](/c:/Users/cosmic/Projects/vmprint/documents/PRINT-AS-WORLD-SLICE.md).

### Priority

**Closed**

---

## 6.2 Phase C.2 — Content-Only Reactive Update (Total Pages)

### Status: CLOSED â€” shipped and regression-tested

### The architectural gap this proves

Phase C proved **geometric reactive growth**: observer geometry changes, downstream actors move, resimulation runs.

This phase proves the second fundamental reactive mode: **content-only reactive update** — world state changes, an actor re-renders its content in place, nothing downstream moves, no resimulation is needed.

The canonical proof feature is **"total pages" in headers and footers** — a header that reads `Page 1 of {totalPages}` where `{totalPages}` is only knowable after the full document is laid out.

### The game-engine framing

This problem does not exist in the game engine model. A typesetter would call it a two-pass problem ("lay out everything, then go back and patch total pages"). A game engine does not make that distinction.

In a 2D multi-party action RPG, the equivalent is an HUD element that shows "Players: X / Total in match: N". Total players only becomes known after matchmaking completes. The HUD does not wait for a second matchmaking pass — it has an `update()` loop. When the last player joins, the world emits `'match:player-count-finalized'`. The HUD actor receives it, updates its text, re-renders its sprite. No physics recalculation. No other actors move. The HUD's geometry (its screen rect) is unchanged — only its visual content changes.

In vmprint terms:

* After `simulate()` converges, `pages.length` is the total page count. This is a **world-state finalization signal**: `'pagination:finalized'` with `{ totalPageCount: N }`.
* Header/footer actors that contain dynamic content observe this signal. Their response is a **content patch** — they update the text in their already-placed boxes.
* Their geometry (the header/footer rect on each page) does not change.
* Therefore: `changed: true, geometryChanged: false` is the **correct and expected result**. No resimulation needed. No downstream actors move.

The engine must **act on** a `changed: true, geometryChanged: false` observation: re-emit the actor's boxes in place (content swap), without triggering the dirty-frontier resimulator. This is a first-class, cheap operation — drawing, not simulating.

### What this phase does not mean

`changed: true, geometryChanged: false` is not a dead-end or a gap. It is the signal for "re-draw this actor's content without touching the world." The machinery for geometric resimulation already exists and is proven. This phase adds the complementary machinery: targeted content re-render.

These two modes together cover the full reactive surface:

| Mode | Changed | Geometry Changed | Action |
|---|---|---|---|
| Geometric reactive growth (TOC) | true | true | dirty-frontier resimulation |
| Content-only reactive update (total pages) | true | false | targeted box content patch |
| No change | false | false | no action |

### What shipped

**Step 1 — World-state finalization signal**

After `simulate()` convergence loop exits, publish `'pagination:finalized'` to the committed signal store:

```ts
session.publishActorSignal({
    topic: 'pagination:finalized',
    signalKey: 'pagination:total-pages',
    payload: { totalPageCount: pages.length }
});
```

**Step 2 — Header/footer observer pass**

After the main convergence loop, run a single `observeCommittedSignals()` sweep over header/footer actors. Any that return `changed: true, geometryChanged: false` get a box content patch — their existing placed boxes have their content updated in place. No resimulation, no frontier advance.

**Step 3 — Dynamic content token resolution**

Header/footer content that references `{totalPages}` (or equivalent authoring syntax) resolves the token against the committed `'pagination:finalized'` signal payload during the observer sweep.

**Step 4 — Regression fixture**

A fixture with `Page {pageNumber} of {totalPages}` in the footer. After layout, every footer box shows the correct total. Deterministic across repeated runs.

### Implementation notes

What shipped is intentionally generic in runtime shape:

* the march publishes a committed `'pagination:finalized'` world fact
* page-finalized regions that reference `{totalPages}` are registered as reactive page-region actors
* those actors wake through normal committed-signal routing
* they report `changed: true, geometryChanged: false`
* the session performs actor-owned box redraw in place

What was removed:

* feature-specific deferred footer/header storage
* the post-march `applyTotalPages(...)` patch path
* `{totalPages}`-specific orchestration in `simulate()`

### What this phase does not need to solve

* Arbitrary reactive content tokens beyond `{totalPages}` and `{pageNumber}`
* Reactive chains that make total-pages knowledge drive further geometry changes (that would be Phase E territory)

### Priority

**Closed**

---

## 6.1 Performance Discipline

Every step in the ensuing refactors must be checked for performance regression.

The rule is simple:

* no meaningful refactor slice lands on architectural confidence alone
* every substantial slice must also be judged on warmed, isolated performance data

At minimum, each substantial slice in this phase should capture before/after numbers for:

* `00-all-capabilities`
* `10-packager-split-scenarios`
* `17-header-footer-test`
* the new TOC proof fixture once it exists

If a change touches observer sweeps, replay, signal routing, or checkpoint behavior, also run:

* the long-manuscript benchmark path if available
* at least one same-page or locked-prelude communication proof

The performance notes for each slice should record:

* fixture name
* warm timing
* whether replay count changed
* whether signal volume changed
* whether the result is neutral, improved, or regressed

If a regression appears, do not wave it through as "expected architecture cost" without evidence.
Either:

* fix it
* bound it and document why it is acceptable
* or defer the refactor until the cost model is understood

---

## 7. Phase D - Thin the Simulator Loop

### Status: Deferred until Phase C lands

### Problem

`execute-simulation-march.ts` still owns domain intelligence that belongs in systems:

* keep-with-next formation policy
* whole-formation overflow handling
* special-case page-break logic
* replay policy

The loop is a coordinator that has accumulated concerns it should not own.

### Why This Phase Comes After C

The TOC actor will add reactive invalidation paths through the march loop. If the loop is thinned before that pressure arrives, the thinning may not cut in the right places. Let C land first, then re-audit what the loop owns versus what the new reactive model handles.

### Priority

**Medium-High, deferred**

---

## 8. Phase E - Multi-Hop Reactive Chains With Domain Actors

### Status: Mechanism proven, domain use cases deferred

The experiment proves three-hop chains work: publisher -> aggregator observer -> follower spatial reaction, all in one pass.

Domain use cases (TOC driving running heads, bibliography footprint affecting body regions, index-like dependent structures) should only be built after the single-hop TOC path is stable.

### Priority

**Deferred until TOC is in production use**

---

## 9. Immediate Backlog

Ordered by dependency:

1. ~~Wire heading actors to emit committed signals during layout~~ **DONE**
2. ~~Implement `TocPackager` using the `observeCommittedSignals()` protocol~~ **DONE**
3. ~~Register `type: 'toc'` in `create-packagers.ts`~~ **DONE**
4. ~~Add a deterministic TOC regression fixture to `engine/tests/`~~ **DONE (fixture 24)**
5. ~~Publish `'pagination:finalized'` signal after `simulate()` convergence with `{ totalPageCount }`~~ **DONE**
6. ~~Implement content-patch mechanism: act on `changed: true, geometryChanged: false` by re-emitting actor boxes in place (no resimulation)~~ **DONE**
7. ~~Wire header/footer region actors to observe `'pagination:finalized'` and resolve `{totalPages}` tokens~~ **DONE**
8. ~~Add regression fixture proving `Page X of N` renders correctly in all footers after single simulation pass~~ **DONE (fixture 25)**
9. Add `branchId` and `maturity` to `ActorSignal` and formalize the two read paths
10. Extend the rollback experiment to assert per-signal maturity fields
11. Design the kernel-owned simulation clock and resumable progression model that will support stopping, snapshot, sleep, resume, and capture as first-class runtime powers
12. Re-audit the march loop after C.2 lands and classify domain branches for extraction
13. For each slice above, capture and record warmed before/after performance numbers

If there is any doubt about prioritization, choose the task that most directly advances the total-pages proof path.

---

## 10. What Not To Do

* Do not implement TOC as a hidden post-process that merely produces the same visual output *(already avoided — fixture 24 proves it)*
* Do not implement total pages as a second `simulate()` call — that is the typesetter ghost; the shipped game-engine answer is a post-convergence content patch through reactive actors
* Do not treat `changed: true, geometryChanged: false` as a no-op; it is the content-only reactive update signal and must trigger box re-emission
* Do not formalize signal maturity first and then stall the total-pages path; Phase A is a tightening step, not the main product proof
* Do not broaden into multi-hop domain chains before both product proofs (TOC and total pages) are stable and in regression
* Do not add total-pages special cases to the march loop
* Do not accept performance regressions without measured evidence and an explicit justification

---

## 11. Progress Judgment

At the end of this phase, ask:

* ~~Does a real document element declared as `type: 'toc'` produce a correct table of contents through live runtime reactivity?~~ **YES — fixture 24 passes**
* ~~Do heading page references in the TOC reflect final committed layout positions?~~ **YES**
* ~~Is the behavior deterministic across repeated runs?~~ **YES**
* Does a header/footer actor that references `{totalPages}` render the correct total after a single simulation pass, with no second `simulate()` call? **YES — fixture 25 passes**
* Is `changed: true, geometryChanged: false` handled by a content-patch path, not ignored and not treated as resimulation? **YES**
* Are signals formally tagged with maturity and branch provenance?
* Has the next-step design for kernel-owned time and resumable world progression been made explicit, so print remains one slice of the same world rather than a special mode?
* Is the proof mechanism (experiments) clearly separated from the production feature (regression fixture)?
* Has each landed slice been checked for performance regression with recorded before/after evidence?

If yes, the architecture will have crossed from "mechanism proven in experiments" into "mechanism embodied in real document features."

The experiments are the proof.
The TOC is the first product proof (geometric reactive growth).
Total pages is the second product proof (content-only reactive update).
Together they cover the full reactive surface.
The regression suite is the contract.
Performance discipline is the guardrail.
