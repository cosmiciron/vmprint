# Kernel Simulation Clock And Progression

*Design draft, March 2026.*

Companion to:

* [PRINT-AS-WORLD-SLICE.md](/c:/Users/cosmic/Projects/vmprint/documents/PRINT-AS-WORLD-SLICE.md)
* [KERNEL-ACTOR-ACTIVATION-AND-UPDATE.md](/c:/Users/cosmic/Projects/vmprint/documents/KERNEL-ACTOR-ACTIVATION-AND-UPDATE.md)

---

## 1. Why This Document Exists

VMPrint now has enough simulation substrate that the next missing kernel concept is no longer actor activation.

It is **time**.

The engine already has:

* actor identity
* committed signals
* content-only redraw
* geometry resettlement
* checkpoints
* rollback

What it does not yet have is a first-class, kernel-owned simulation clock that the world can refer to.

Right now, the engine has order:

* signal sequence numbers
* checkpoint sequences
* settlement loops

But it does not yet have a shared temporal coordinate.

This document defines the missing architectural layer:

* a kernel-owned simulation clock
* a resumable progression model
* explicit stop / snapshot / sleep / resume semantics
* and a clean separation between kernel progression and higher-level stopping policy

---

## 2. Core Thesis

The kernel must own an agnostic simulation clock.

Not because VMPrint is trying to imitate game engines cosmetically, but because the world must not inherit its notion of time from any one subsystem.

That means:

* pagination does not define time
* observer sweeps do not define time
* rendering does not define time
* capture does not define time

Those systems may correlate with temporal advancement.

They must not *be* time.

The correct architecture is:

* the kernel owns a discrete deterministic clock
* the world advances against that clock
* systems observe and mutate the world relative to that clock
* stopping conditions are policies layered above that clock

---

## 3. The Philosophical Test

The clearest test is simple:

**Does the world care why time advanced?**

No.

The world should only care that:

* time advanced
* the current tick is now `n`
* certain world facts became true at tick `n`

If time is defined in subsystem terms, the architecture is already compromised.

For example:

* "a tick is a pagination pass"
* "a tick is a render frame"
* "a tick is an observer sweep"

All of those are too narrow as ontology.

At most, they are implementation-correlated advancement boundaries.

The kernel clock must be more indifferent than that.

---

## 4. What The Clock Is

The kernel simulation clock should be:

* discrete
* integer-based
* deterministic
* kernel-owned
* subsystem-agnostic
* serializable as part of world state

Conceptually:

```ts
type SimulationTick = number;

type SimulationClockSnapshot = {
  tick: SimulationTick;
};

interface SimulationClock {
  readonly tick: SimulationTick;
  advance(): SimulationTick;
  captureSnapshot(): SimulationClockSnapshot;
  restoreSnapshot(snapshot: SimulationClockSnapshot): void;
}
```

This is intentionally minimal.

The point is not to build a rich time API first.

The point is to establish a single authoritative temporal coordinate.

---

## 5. What The Clock Is Not

The clock should **not** be:

* a wall clock
* elapsed milliseconds
* dependent on machine speed
* tied to rendering cadence
* defined by user-interface refresh

Wall-clock time is the wrong primitive because it weakens determinism.

Given:

* same input
* same runtime config
* same systems
* same stopping policy

the engine should produce:

* the same captured output

That becomes fragile if stopping depends on elapsed milliseconds.

So the clock must be simulation time, not real time.

---

## 6. What The Clock Unlocks

The kernel clock is not an isolated object. It solves several missing problems at once.

### 6.1 Signals Gain Temporal Position

`ActorSignal` currently has sequence, but not tick.

With a kernel clock, a committed signal can also carry:

* `tick`

This answers:

* when did this world fact become committed?

not just:

* in what local publication order did it appear?

### 6.2 Actor Stepping Becomes Grounded

If actors eventually gain explicit stepping, the runtime can call them relative to a shared simulation tick rather than an ad hoc loop counter.

### 6.3 Stopping Policy Becomes Concrete

Policies like:

* until settled
* after 8 ticks
* until signal X commits

become explicit runtime decisions over a shared temporal reference.

### 6.4 Performance Gains Temporal Semantics

The engine can report:

* settled in 1 tick
* settled in 3 ticks
* required 2 resettlement ticks after world fact publication

This is more meaningful than opaque loop counts.

---

## 7. Progression Is More Fundamental Than Horizon

The architecture should not start by hardcoding a taxonomy of horizon kinds.

That is too high-level too early.

The more fundamental kernel powers are:

* advance
* stop
* snapshot
* sleep
* resume
* capture

These are the real progression primitives.

Everything else is policy.

For example:

* "until settled"
* "after 8 ticks"
* "until signal X"
* "until user-defined predicate Y"

should be treated as stopping policies built on top of kernel progression, not as the kernel ontology itself.

This keeps the architecture flexible and avoids prematurely freezing the engine around one set of stopping modes.

---

## 8. Stop, Snapshot, Sleep, Resume

If print is a world slice, then VMPrint must eventually support resumable simulation.

That implies four first-class operations.

### Stop

Pause the world at a deterministic point.

### Snapshot

Capture sufficient state to resume later without losing world continuity.

### Sleep

Persist or hold a stopped world without continuing progression.

### Resume

Continue progression from an earlier stopped or sleeping state.

These are not optional niceties.

They are what make "capture a world slice" a real model rather than a metaphor.

---

## 9. Relationship To Existing VMPrint Mechanisms

This is not greenfield architecture.

The engine already has a lot of the needed substrate:

* branch snapshots
* rollback
* local branch restore
* committed signal routing
* checkpoint recording

What is missing is unification.

Today:

* snapshots are mainly framed around speculative correctness
* observer sweeps are mainly framed around reactive settlement

What the new model adds is:

* a shared clock
* a progression contract
* a cleaner distinction between:
  * speculative restoration
  * ordinary pause/resume
  * capture of world slices

The new clock should integrate with the existing session/snapshot model rather than replace it.

---

## 10. First Practical Interpretation Of A Tick

The clock must remain subsystem-agnostic in principle.

But it still needs an initial concrete advancement rule in implementation.

The best near-term candidate is:

* the kernel advances one simulation tick at each progression cycle boundary in the session march

That may correlate strongly with the existing checkpoint/settlement loop, especially early on.

But the architecture should phrase it carefully:

* observer sweeps may be one of the first places where tick advancement is visible
* they should not permanently define what a tick *is*

In other words:

* implementation may begin by advancing tick around the existing march cycle
* ontology must remain broader than that implementation detail

This gives us a practical path without making the architecture brittle.

---

## 11. Signals Should Eventually Carry Tick

Once the clock exists, `ActorSignal` should eventually include:

```ts
type ActorSignal = {
  tick: number;
  branchId: string | null;
  maturity: 'speculative' | 'committed';
  // existing fields...
};
```

That would give the engine three distinct dimensions:

* **order** via sequence
* **branch provenance** via `branchId`
* **temporal position** via `tick`

That is a much stronger signal model than the current one.

It would also help Phase A mature into a more complete transactional-plus-temporal signal system.

---

## 12. Capture Must Become More Explicit

Today, `simulate()` still fuses several things:

* advance the world
* finalize/capture pages
* return the captured output

The long-term architecture implied by this document is cleaner:

* progress the world
* capture the world slice
* render the capture

Conceptually:

```ts
simulate(...) -> WorldState
capture(world) -> CapturedLayout
render(capture) -> Output
```

This does not need to be implemented immediately.

But it should become the architectural direction.

Otherwise, print capture will remain too entangled with progression semantics.

---

## 13. Relationship To Document Cooking

This is the piece that makes document cooking real.

Without a kernel clock and resumable progression, "cook the document" is just a slogan.

With them, it becomes ordinary world behavior:

* actor wakes or steps
* actor accumulates state
* actor generates text, graphs, labels, structure, or transforms
* world continues progressing
* capture happens when policy chooses

That means a cooking demo should not be thought of as a special feature.

It should be thought of as:

* the first synthetic proof that the world can be progressed intentionally before capture

That makes it a perfect downstream proof case for this architecture.

---

## 14. Risks

Main risks:

* defining tick too narrowly around one subsystem
* overcomplicating progression before the clock is minimally useful
* conflating speculative restore snapshots with ordinary pause/resume
* introducing hidden cost to ordinary until-settled documents
* exposing stopping policy too early in a way that freezes weak abstractions

These risks argue for a staged rollout, not for avoiding the clock.

---

## 15. Guardrails

### Guardrail 1

The default print path must remain cheap.

If no actor meaningfully participates in time beyond ordinary settlement, the new clock must not impose visible cost.

### Guardrail 2

The clock must be simulation time, never wall time.

### Guardrail 3

Stop/snapshot/resume must be kernel capabilities before stopping policy becomes elaborate.

### Guardrail 4

Tick advancement may begin in the current march loop, but the architecture must not permanently equate time with any one subsystem boundary.

### Guardrail 5

Every rollout slice must be measured.

That includes:

* tick count
* wake count
* update count
* resettlement count
* dormant overhead

---

## 16. Recommended Rollout Order

The next implementation sequence should likely be:

1. add a minimal `SimulationClock` to the session
2. include clock snapshot/restore in branch state
3. expose current tick through runtime/session context
4. stamp committed signals with tick
5. make the default print path explicitly "progress until settled"
6. add one synthetic proof that progresses for more than one deliberate tick before capture
7. only then design a public stopping-policy surface

This keeps the kernel primitive ahead of the policy surface.

---

## 17. Success Criteria

This architecture is real when:

* the kernel owns a discrete deterministic simulation clock
* the clock participates in snapshot/restore
* world facts can be stamped with tick
* progression can be stopped and resumed coherently
* ordinary print remains cheap
* one synthetic proof demonstrates deliberate progression before capture
* a future cooking demo becomes a straightforward application of the model rather than an architectural exception

---

## 18. Final Position

VMPrint now needs a kernel-owned simulation clock because the world has become too real to keep borrowing its notion of time from local runtime mechanics.

Time must become:

* shared
* explicit
* deterministic
* resumable
* and owned by the kernel

Only then can print fully become what the architecture is pointing toward:

* not a special mode
* not an exception
* but a captured slice of one continuously intelligible world
