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
