# Actor Communication

This document defines the missing communication primitives between actors in VMPrint.

It exists because we reached the point where a smarter actor such as TOC exposed a real gap:

* actors can exist
* actors can split and continue
* actors can render and evolve
* but actors cannot yet communicate with one another in a first-class way

That is now the missing engine primitive.

---

## Status

The first bulletin-board primitive is now proven in the engine.

What is already working:

* session-owned actor event bus
* deterministic publish/read behavior
* many-publisher -> one-observer routing
* observer geometry changing from aggregate signal count
* observer -> follower summary chaining
* page-boundary-safe routing
* rollback cleanup for discarded speculative timelines

This matters because it proves actor communication is no longer theoretical.
Actors can now affect other actors through a normalized engine-system channel
without pushing communication into the `Kernel`.

Methodology is now part of the contract too:

* automated regression proof is required
* generated visual PDF proof is also required for engine-behavior experiments

For communication work, "tests pass" is not enough.
We should be able to see the behavior on the page the same way we did with the
yellow-box experiment.

---

## 1. Core Principle

Actors should not need to:

* inspect unrelated document tree structure
* crawl arbitrary nested authored JSON
* rely on engine-level feature-specific orchestration

Instead, actors should communicate through explicit engine primitives.

The engine should provide the communication mechanisms.
Actors should use those mechanisms.

This substrate does **not** belong in the `Kernel`.

The `Kernel` must remain protected and minimal:

* identity
* state substrate
* rollback / branching memory
* low-level world stores

Actor communication is higher-order behavior.
It belongs to the **engine systems layer**, on the same plane as:

* Physics
* Collision
* AI
* Transitions
* Lifecycle
* Event Dispatch

This boundary matters.
If communication is pushed into the `Kernel`, we risk bloating the heart again.
The `Kernel` should be protected at all cost.

The practical owner of the communication substrate should therefore be the
session/runtime shell above the kernel.

In current architecture terms:

* `LayoutSession` (or its future thinner successor) should own the session-scoped bus
* actors should receive a narrow communication interface through runtime context
* the `Kernel` should not spawn actors with raw communication infrastructure attached

Actors should talk through the session, not through the kernel.

---

## 2. Why This Exists

The TOC detour exposed the problem clearly.

A heading actor knows:

* that it is a heading
* whether it carries a TOC label
* its identity
* eventually, its page truth

A TOC actor should not have to guess those things by crawling the document.

The heading actor should be able to hand that information off.

This is not only about TOC.
It applies equally to:

* bookmark collectors
* index collectors
* cross-reference systems
* footnote/endnote collectors
* future outline/sidebar actors
* future UI or editor companions

---

## 3. Two Communication Families

We need two families of actor communication.

### 3.1 Direct Handoff

One actor sends something directly to another actor.

This must be addressed by **actor ID**, not by actor type.

Why:

* type-based routing is too vague
* multiple actors of the same type may exist
* direct communication should mean explicit intent

Use direct handoff when:

* the sender knows exactly who the receiver is
* the relationship is strong and intentional
* one actor is explicitly subordinate or attached to another

Examples:

* a heading actor handing itself to a specific TOC actor instance
* a note anchor actor handing itself to a specific note collector
* a companion actor reporting to its owning region actor

### 3.2 Observer / Bulletin Board

Actors publish events or announcements to a shared board.
Other actors subscribe or observe.

Why:

* the sender should not need to know all listeners
* multiple actors may care about the same signal
* the interaction is world-like, not pairwise

Use bulletin-board communication when:

* many consumers may care
* the sender is publishing a fact about itself
* the relationship is loose

Examples:

* headings publishing "I exist"
* headings publishing "my page changed"
* anchors publishing "my first page is now X"
* section actors publishing "I entered continuation"

---

## 4. Initial Recommendation

Both families belong in the engine.

But they should not be implemented at the same time unless needed.

Recommended order:

1. bulletin board first
2. direct handoff second

Why bulletin board first:

* it is more general for the current document domain
* it keeps publishers and consumers loosely coupled
* it is the most natural fit for TOC-like collectors
* it avoids prematurely forcing every actor to know other actor IDs

Why direct handoff second:

* it is still important
* some future actor relationships will need it
* but it is a stronger coupling mechanism and should be added deliberately

---

## 5. Session-Owned Event Bus

The first implementation should be a session-owned bulletin board / event bus.

That means:

* the bus exists for the lifetime of a simulation session
* actors publish normalized signals into it
* observers read from it through controlled engine-system interfaces
* phase timing remains deterministic because session/runtime already governs phase boundaries

Actors should **not** be given a raw global service bag.

Instead, actors should see a narrow contract such as:

* publish actor signal
* observe committed actor signals
* optionally, later, observe speculative signals if explicitly allowed

This keeps the communication mechanism:

* available to actors
* owned by the engine systems layer
* out of the kernel
* out of consumer-specific code

---

## 6. Transactional Signals And Discarded Timelines

Because VMPrint supports speculative branches and rollback, the communication
substrate cannot be naive.

Signals published inside a speculative branch must not leak into committed truth.

Example:

* a heading actor publishes "I am on Page 5" during a speculative branch
* the branch is rejected
* the heading later really lands on Page 6

If the earlier signal leaked, the bus would preserve false history.

So the bus must be **branch-aware**.

Conceptually it should support:

1. `publish(signal, branchId)`
2. `commit(branchId)`
3. `rollback(branchId)`

And the visibility rule should be:

* normal observers see **committed** signals only
* speculative signals live in a branch-local staging area
* rollback destroys staged speculative signals
* commit promotes them into the committed stream

This keeps actor communication compatible with Schrödinger-style rollback.

The bus does not need to live in the kernel to achieve this.
It only needs to be transactionally coupled to the session's branch/snapshot model.

---

## 7. What The Engine Should Provide

The engine should provide a communication substrate, not feature-specific policy.

That substrate should include:

* actor identity
* a publish mechanism
* a subscription or observation mechanism
* message/event lifecycle timing
* deterministic ordering rules
* clear scoping rules for what survives splits and continuations
* branch-aware staging / commit / rollback behavior

The engine should **not** provide:

* TOC-specific orchestration
* actor-specific multi-pass hacks
* consumer-feature-specific routing in core engine files

And the engine should not solve this by hiding communication inside the `Kernel`.
It should be a dedicated engine-system primitive above the kernel, not a new kernel responsibility.

---

## 8. Proven Interaction Pattern

The first successful pattern is:

* many publishers
* one observer
* observer changes its own geometry from the aggregate signal count

The next successful pattern is:

* many publishers
* one observer
* one downstream follower
* observer publishes a normalized summary
* follower changes its own layout from that summary

This is a stronger proof than text-only signaling because it demonstrates that:

* actor communication can change spatial behavior
* routing still works when publishers span across pages
* chained actor interactions are possible without special-case engine orchestration
* speculative signals do not leak after rollback

This is the pattern we should keep using as we move from synthetic probe actors
to real document-domain actors.

---

## 9. Next Step

The next step should be to route **real labeled domain actors** into the
bulletin board without forcing them to become fake communication-only types.

That means:

* consumer attaches normalized labels/intent
* ordinary actors publish through the runtime contract
* observer actors react through the bus

The goal is to prove that actor communication works for real domain
interactions, not only for dedicated dummy probe actors.

---

## 8. What An Actor Should Publish

Actors should publish normalized facts or task envelopes.

They should not publish raw DOM-like structure.

Good:

* source ID
* actor ID
* semantic label
* heading level
* page index
* y position
* continuation state
* explicit task payloads

Bad:

* raw nested authored children trees
* arbitrary JSON fragments from the authoring layer
* implicit signals that require listeners to reconstruct meaning

This preserves the same rule we already established for packagers:

* actors should read shipping labels
* not rummage through warehouses

This is the same rule consumers should follow when they want actors to react.

Consumer/domain code should attach explicit labels or normalized facts.
Actors should not infer intent by crawling nested authored structure.

---

## 9. Timing

Actor communication needs defined phases.

At minimum we likely need:

* actor spawned
* actor prepared
* actor committed
* actor continued / split
* page finalized
* simulation finalized

Not every communication primitive needs every phase, but phase boundaries must be explicit.

For example:

* a heading existence announcement may happen at spawn or prepare
* page-truth updates may only make sense after commit or page finalization
* final bookmark assembly may only make sense after simulation finalization

---

## 10. Continuations And Identity

Communication must respect actor identity across continuation.

That means:

* a split actor must still be understood as the same higher-level entity when appropriate
* continuation fragments must not duplicate announcements blindly
* listeners must have enough identity/provenance to distinguish:
  * first appearance
  * continuation
  * clone
  * transformed successor

This is why communication must sit on top of the actor identity model we already built.

---

## 11. First Use Case

The first proving ground should still be the TOC problem.

But TOC should no longer drive the architecture.
It should validate it.

The clean future shape is:

* heading actor carries `_tocEntry`-like intent from the consumer
* heading actor publishes normalized TOC-relevant facts
* TOC actor observes those facts and updates itself
* later, heading/anchor actors publish page-truth updates
* TOC actor updates page labels from those updates

That would make TOC:

* a real smart actor
* a real client of the communication primitive
* and not a special-case orchestration hack

---

## 12. Anti-Goals

Do not:

* put TOC-specific branching into `LayoutEngine`
* make actors read raw authored trees just to infer intent
* implement only direct type-based handoff and call it communication
* centralize feature behavior in a god-object coordinator
* leak speculative branch signals into committed world truth

The point of this primitive is to reduce special-case orchestration, not to rename it.

---

## 13. Immediate Next Step

Before writing the full mechanism, we should define the smallest viable form.

That likely means:

1. a bulletin-board style actor event publication API
2. a session-owned event store or bus
3. transactional branch-aware staging / rollback behavior
4. deterministic observation rules
5. one narrow proving test with a non-TOC experimental actor

The experimental actor should look more like the yellow expanding probe than like a polished publishing feature.

That keeps us testing engine capability, not feature polish.

---

## 14. The Domain Problem, Seen Clearly

The next communication problem is not merely "actors can talk."
It is:

* an actor discovered later in layout can affect an actor placed earlier
* that earlier actor can change geometry
* that changed geometry can invalidate downstream layout
* the document world must then settle again without throwing away the entire run

This is the real document-layout version of the problem.

In ordinary formatter terms, this often gets flattened into:

* "do another pass"
* "rerun from the start"
* "keep looping until the references stabilize"

That language is too blunt for VMPrint.

Because VMPrint has:

* a protected `Kernel`
* speculative branches
* rollback
* actor identity
* a branch-aware event bus

we do not need to restart the whole universe the way traditional systems often do.

We need a more precise model.

---

## 15. Why The Game-Engine Mapping Helps

This problem becomes easier to reason about when mapped to game engines,
especially a 2D open-world RPG.

Equivalent game-engine situations include:

* a world-state update discovered later invalidates an earlier region
* navigation in one region changes because something happened elsewhere
* streamed world chunks must be reloaded after a newly discovered dependency
* speculative simulation branches publish events that must be discarded on rollback

The document-layout version is structurally similar:

* a later heading/publisher/anchor signal reaches an earlier collector
* that collector changes size
* that size change affects earlier pages
* and therefore changes downstream world geometry

Seen this way, the problem is not "multi-pass typesetting" in the old sense.
It is much closer to:

* dirty-region invalidation
* checkpointed world resimulation
* bounded settling of a stateful simulation

That framing is important because it gives us better tools and better instincts.

---

## 16. The Optimized VMPrint Direction

The game-engine mapping suggests a better solution than either:

* rerunning the whole document from Page 1 after the end
* or instantly panicking and micro-rolling back the moment a backward-affecting signal appears

The better direction is:

* let the session run forward normally
* classify signals by spatial consequence
* mark the earliest invalid spatial frontier as dirty
* continue until a safe checkpoint
* then resimulate only from that frontier forward
* repeat until the world settles, or hit a bounded iteration limit

This gives us a more VMPrint-native model:

* not full-document restart
* not twitchy immediate rewind
* but targeted reflow driven by world invalidation

In current language, this means:

* the session owns the dirty frontier
* the event bus carries normalized truth without leaking discarded branches
* checkpoints define safe moments to settle
* settling means "rerun only what became invalid"

This is a stronger model than "pass management" alone.
It turns the problem from generic repagination into targeted world resimulation.

---

## 17. New Planning Rule

When we start the first true co-evolving layout experiment, we should not ask:

* "how many passes does this need?"

We should ask:

* what signal changed the world?
* what spatial consequence category does it belong to?
* what is the earliest dirty frontier?
* what is the next safe checkpoint?
* what downstream region must be resimulated?
* when do we declare the world settled?

That is the architecture-correct way to think about the next phase of VMPrint.

---

## 18. From Spatial Layout To Spatiotemporal Simulation

There is a deeper shift happening underneath the checkpoint discussion.

Traditional typesetters are mostly linear.
They may have multiple passes, but they do not usually treat time as a
first-class simulation dimension.

VMPrint already crossed one important threshold by introducing **spatiality**:

* actors occupy space
* actors collide
* actors displace one another
* regions can grow
* geometry can invalidate geometry

That was the first major break from the old model.

The checkpoint question reveals the next threshold:

* not only where is something?
* but when did this become true?
* when is it safe to trust?
* when should it be reconsidered?
* what timeline did this signal come from?
* what simulation moment should trigger resettling?

That is temporality.

Once temporality enters the model, "pass management" stops being a sufficient
description.
Passes are bookkeeping.
Time is a simulation dimension.

This is why rollback, speculative branches, committed truth, checkpoints, and
settling all feel connected.
They are not separate tricks.
They are signs that VMPrint is beginning to behave like a spatiotemporal
simulation engine for documents.

---

## 19. Why This Matters

Thinking temporally opens options that traditional typesetting does not really
have as first-class tools.

Examples:

* different kinds of checkpoints
* staged truth versus committed truth
* delayed reactions instead of immediate panic rewinds
* bounded settling windows
* event maturity
* timeline-aware invalidation

This does not mean VMPrint should become a time simulator for its own sake.

It means that once actors can:

* publish signals
* react later
* invalidate earlier geometry
* and survive rollback

then time has already entered the architecture whether we name it or not.

Naming it is useful because it helps us design the right next abstractions.

---

## 20. New Design Lens

Going forward, we should treat VMPrint as:

* spatial, because layout is about geometry
* temporal, because document truth emerges, mutates, stabilizes, and sometimes rolls back

So the design lens becomes:

* not just page composition
* not just pass orchestration
* but the controlled simulation of a document world across space and time

That is the more accurate description of what the engine is becoming.

---

## 21. Blueprint For The First In-Flow Collector Test

The first true co-evolving layout experiment should stay entirely in the
`Test...` lane.

It should not use:

* real TOC
* real transmuters
* real document semantics

It should use a synthetic in-flow collector actor that lives near the front of
the document, while labeled publishers appear later.

The purpose is to prove:

* mature signals discovered later can change earlier geometry
* that earlier geometry can invalidate downstream layout
* the session can resettle the world without restarting the whole document

### 21.1 Initial Forward March

The synthetic collector appears near the front of the document with minimal
geometry.

At this moment it has observed no mature signals, so its bounding box is small.

The session then marches forward normally, placing ordinary trailing flow after
it.

### 21.2 Signal Maturation

Later in the document, a publisher actor appears and publishes a signal.

That signal is initially speculative.

If the branch succeeds and commits, the signal becomes mature.

The important rule is:

* maturity belongs to committed world truth
* immature speculative signals must not drive stable geometry

### 21.3 Collector Observation

The event bus does not "push-mutate" the collector in an eager callback sense.

Instead:

* the mature signal becomes visible on the bulletin board
* on its next evaluation, the collector observes the new mature state
* the collector recomputes its required geometry

If the required geometry has grown, the collector does **not** immediately force
world rewind.

It reports:

* my geometry is now invalid relative to committed layout
* mark my earliest committed spatial frontier as dirty

### 21.4 Slice Checkpoint

The session continues forward until it reaches the current provisional slice
boundary.

For the first implementation, this slice boundary may be aligned with the end of
the current page.

That does **not** mean pages are metaphysically final.
It only means page boundaries are serving as the first practical safe
resimulation checkpoints.

### 21.5 Settling Cycle

When the session reaches the checkpoint, it inspects its state.

If a dirty frontier has been recorded, it:

* locates the nearest safe snapshot preceding that frontier
* restores that snapshot
* replays the world forward from there

Now the collector enters the world again with its expanded geometry, and
downstream flow is displaced accordingly.

### 21.6 Resume Or Repeat

If replay from the dirty frontier produces no new invalidation, the world is
settled and forward march resumes.

If replay produces another backward-affecting geometry change, a new dirty
frontier is recorded and the session repeats the same checkpointed resettling
logic.

This process must be bounded:

* stop when no new invalidation appears
* or stop at a controlled iteration limit and surface instability

---

## 22. Important Implementation Guardrails

For this first in-flow collector experiment:

* do not let the event bus behave like an eager callback system
* do not make "Page 1" the true internal frontier concept
* do not hardcode restart-from-document-start behavior
* do not wait until EOF unless used only as a later fallback policy

Instead:

* mature signals become visible
* actors observe them during ordinary evaluation
* dirty state is tracked as an earliest spatial frontier
* settling restores the nearest safe snapshot before that frontier

This keeps the experiment aligned with the spatiotemporal simulation model
rather than slipping back into old pass-based habits.

---

## 23. How Observers Wake Up

The collector on Page 1 is not continuously running while the session is busy
packing Page 3.

So the question is:

* how does an earlier observer get its "next evaluation"?

The answer should **not** be a continuous `tick()` on every actor.

Why not:

* it would waste CPU on the overwhelming majority of actors that are static
* it would make control flow noisier and harder to reason about
* it would be a poor fit for VMPrint's deterministic layout runtime

Instead, `LayoutSession` should own an **observer registry**.

Only actors that explicitly depend on committed bulletin-board state should be
registered there.

Then, at slice checkpoints, the session performs a controlled reevaluation
phase:

* iterate registered observers
* let each observer inspect committed bus state
* ask whether its derived state changed
* ask whether that changed state affects geometry

This keeps the engine efficient:

* 10,000 actors may exist in the world
* perhaps only 10 are state observers
* only those 10 need reevaluation at checkpoint time

That is the correct wake-up model for the first co-evolving experiment.

---

## 24. Observation Result

The observer hook should return an explicit result object rather than mutating
the world implicitly.

Conceptually:

```ts
type ObservationResult = {
  changed: boolean;
  geometryChanged: boolean;
  earliestAffectedFrontier?: SpatialFrontier;
};
```

The most important distinction is:

* `changed`
* `geometryChanged`

These are not the same thing.

Examples:

* a collector updates internal text or page labels, but its required bounding box
  stays identical
* in that case:
  * `changed = true`
  * `geometryChanged = false`

This is a major optimization because it lets the session avoid needless
resimulation.

Only geometry-changing observations should invalidate the spatial frontier and
trigger settling.

So the checkpoint logic becomes:

1. physical placement runs forward for the slice
2. speculative signals from that slice are promoted to mature committed truth
3. observer registry is reevaluated
4. if any observer reports `geometryChanged: true`, the session marks the
   earliest affected frontier dirty
5. if no geometry changed, the session simply continues marching forward

This bypasses the wasteful behavior typical of legacy DOM-style systems where
any semantic change tends to dirty layout indiscriminately.

---

## 25. Safe Checkpoint Registry

Once an observer reports an `earliestAffectedFrontier`, the session must map
that frontier back to a restore point the kernel can actually understand.

The kernel understands snapshots, not document semantics.

So `LayoutSession` should maintain a **safe checkpoint registry** during forward
march.

Each checkpoint entry should include at least:

* a snapshot token
* the page index at that checkpoint
* the spatial frontier represented by that checkpoint
* enough session metadata to restore the bus and replay deterministically

Conceptually:

```ts
type SafeCheckpoint = {
  id: string;
  snapshotToken: string;
  pageIndex: number;
  frontier: SpatialFrontier;
};
```

For the first implementation, these checkpoints may be page-aligned.

That means the first practical registry will often behave like:

* page boundary -> snapshot token

But the abstraction should remain broader than raw page indexing.

Why:

* page boundaries are only the first convenient checkpoint type
* later, VMPrint may want finer slice checkpoints inside a page
* or other frontier-aligned restore points

So the session should not think in terms of:

* "restore Page 1"

It should think in terms of:

* "restore the nearest safe checkpoint preceding the dirty frontier"

That is the general and future-proof rule.

The next refinement is to make these checkpoints **anchored**, not merely
page-indexed.

That means a safe checkpoint may also carry:

* actor identity
* source identity
* actor index within the current slice

Why this matters:

* page-aligned checkpoints are enough to prove coarse settling
* but they do not prove finer restore precision
* an anchored checkpoint lets the session preserve already-committed earlier
  actors while restoring only from the true frontier onward

This is the point where restore precision becomes visible, not merely
architectural.

One scope rule should now be made explicit.

Safe checkpoints in this document are tools for speculative or invalidatable
flows. They are not meant to be recorded continuously across the entire layout
march as a general insurance policy.

That distinction matters because the engine has now demonstrated the failure
mode of over-broad checkpointing on long manuscripts:

* rollback-capable infrastructure was being paid for continuously
* but the actual rollback path was rarely or never used

So the correct interpretation is:

* observer registries, dirty frontiers, and safe checkpoints are activated when
  mature committed truth can invalidate already-committed geometry
* speculative branch seams may also justify checkpoints
* ordinary committed progression should remain forward-only unless a real
  communication-driven ambiguity is active

In short:

> communication-aware rollback should be activated by real uncertainty, not
> treated as the default execution mode of the entire document.

The concrete transaction API for speculative branches is defined in
`documents/SPECULATIVE-TRANSACTIONS.md`.

---

## 26. Refined Checkpoint Execution Flow

Putting the pieces together, the first co-evolving experiment should execute
like this:

1. The session performs ordinary physical placement for the current slice.
2. Signals produced during the slice remain speculative until the branch is committed.
3. When the branch commits, those signals mature on the bulletin board.
4. At the slice checkpoint, `LayoutSession` reevaluates the observer registry.
5. If an observer returns:
   * `changed = true`
   * `geometryChanged = false`
   then the session keeps marching forward with no spatial invalidation.
6. If an observer returns:
   * `geometryChanged = true`
   * `earliestAffectedFrontier = ...`
   then the session records the dirty frontier.
7. The session consults the safe checkpoint registry and restores the nearest
   safe snapshot preceding that frontier.
8. The world is replayed from there.
9. If replay produces no further invalidation, the simulation is settled.
10. If replay produces another dirty frontier, the same bounded resettling
    logic repeats.

This is the concrete execution model for the first in-flow collector test.

---

## 27. Locked Prelude Precision Proof

The first in-flow and same-page fixtures proved that:

* settling can happen before EOF
* settling can happen before a page turn
* earlier geometry can be invalidated by later mature signals

But they still left one subtle question open:

* are we really restoring from a finer checkpoint
* or merely getting the same visible result from a blurrier replay path?

So we introduced a stronger synthetic proof in the `Test...` lane:

* a **locked prelude** actor appears before the collector frontier
* it is a replay marker that visibly reports its own render count
* the collector appears after it
* a later publisher matures a signal for the collector

The important invariant is:

* the collector should grow
* the downstream flow should move
* the locked prelude should **not** be replayed

Visually, this appears as:

* `Locked Prelude`
* `Render Count: 1`
* `Precision Collector`
* `1. Anchored Entry`

If settling were restoring from an earlier blurrier checkpoint, the locked
prelude would visibly re-emit and its marker would increment.

Instead, the proof stays at:

* `Render Count: 1`

while the collector still learns the later mature signal.

That makes this the first proof where finer restore precision is visible on the
page rather than only inferred from tests or code inspection.

---

## 28. What This New Proof Establishes

The locked-prelude proof gives us a stronger statement than the earlier
fixtures:

* not only can VMPrint settle intra-page
* not only can it reevaluate observers at generalized checkpoints
* it can also preserve a committed earlier region while resettling a later
  frontier on the same page

That is the practical meaning of anchored safe checkpoints.

It shows that VMPrint is no longer limited to:

* page-start replay
* or visually equivalent but coarser restore behavior

Instead, it can preserve earlier committed state and replay only from the
meaningful frontier forward.
