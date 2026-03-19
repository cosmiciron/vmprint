# Print As World Slice

*Design note, March 2026.*

---

## 1. Why This Document Exists

VMPrint has now crossed an important line.

It no longer only lays out inert document content through a one-shot pagination pipeline. It now contains:

* committed signals
* selective actor wakeups
* content-only reactive redraw
* geometry-triggered resettlement
* checkpoints and rollback

That means the engine is no longer best described as "a typesetter with a few reactive tricks."

It is increasingly better described as **a world simulator whose current most mature projection is print layout**.

This document makes one further architectural claim explicit:

**print layout should be understood as a slice of world simulation, not as an exception to it.**

---

## 2. Core Thesis

A printed document is not a fundamentally different kind of runtime product than a simulated world state.

It is simply:

* a captured slice of the world
* taken at a chosen stopping condition
* rendered into paged spatial output

That stopping condition must be defined against a kernel-owned simulation clock, not against the local semantics of any one subsystem.

That stopping condition may be:

* immediate settlement
* a finite simulation duration
* a fixed tick count
* a stability condition
* a specific committed world fact

Under this model, "print" is not a separate engine identity.

It is one capture mode of the same simulation runtime.

---

## 3. What This Changes Conceptually

The old mental model is:

* input document in
* paginate once
* render pages out

The proposed mental model is:

* instantiate a world from authored input
* simulate that world
* stop at a declared horizon or settled condition
* capture the world into paged output

This is a much more unified ontology.

It means:

* actors do not stop being actors because the final target is print
* temporal behavior is not an exception bolted onto layout
* pagination is one spatial expression of world state, not the definition of the engine itself
* time itself belongs to the kernel, not to pagination, rendering, or observer sweeps

---

## 4. Print Is A Stopping Condition

Under this design, ordinary print remains the common case.

But it is reinterpreted more cleanly.

### Ordinary print

Most documents will still behave like this:

* most actors are dormant
* some actors react to committed signals
* the world quickly reaches spatial settlement
* capture occurs when the engine determines the world is stable

This is still "just print," but now it is understood as:

**simulate until settled, then capture.**

### Extended print

Some documents may intentionally simulate for longer before capture:

* simulate for 12 ticks, then print
* simulate until a world fact is committed, then print
* simulate until a scripted actor finishes "cooking" content, then print

This is not a special escape hatch.

It is the same model with a different horizon.

More precisely:

* the kernel advances the world
* the kernel may stop at any moment
* the kernel may snapshot, sleep, and resume
* capture happens whenever a runtime policy decides the current world slice should be taken

---

## 5. The Clock Must Be Kernel-Owned

If the world is primary, then no subsystem should define what time is.

Not:

* pagination
* observer sweeps
* rendering
* page finalization
* document capture

Those subsystems may observe time, react to it, or advance work during it.

They must not own its meaning.

The correct architectural consequence is:

**the simulation clock belongs to the kernel because the world must not inherit its notion of time from any one subsystem.**

This clock should be:

* discrete
* deterministic
* subsystem-agnostic
* indifferent to why it advanced

That last point matters.

The world should not care whether a tick advanced because:

* a signal matured
* a settlement cycle ran
* an actor was stepped
* or a horizon requested more simulation

The world only needs to know:

* the current tick
* that time advanced
* and what world facts became true at that temporal position

This is the cleanest way to preserve the engine's ontology.

---

## 6. Why This Is Better Than A Two-Mode World

One tempting alternative is:

* keep ordinary print as one engine mode
* add a separate "temporal" or "interactive" mode later

That split is weaker.

It implies:

* two ontologies
* two kinds of actors
* two kinds of runtime reasoning
* and eventually two orchestration stacks

That would recreate the same architectural problem VMPrint has already been working to escape.

The stronger answer is:

* there is one world simulation
* print is one capture horizon
* richer temporal documents are the same world model taken further in time

This preserves identity instead of fragmenting it.

---

## 7. Relationship To Actor Activation And Update

The newly landed kernel activation/update work is the immediate prerequisite for this idea.

That work already proved:

* actors can wake selectively
* actors can hold and react to committed world facts
* actors can redraw in place
* actors can trigger geometric resettlement
* oscillation can be bounded

Those are not merely pagination utilities.

They are the beginnings of a temporal simulation substrate.

The natural next extension is:

* actors may also be stepped intentionally over simulated time
* not just awakened by committed state changes

That does not replace the existing reactive model.

It extends it.

Reactive wakeup and explicit stepping should be understood as two compatible ways actors participate in the same world.

---

## 8. Stopping, Snapshot, Sleep, Resume

If print is a world slice, then the deeper primitive is not a fixed taxonomy of "simulation horizon" kinds.

The deeper primitive is that the kernel can:

* advance the world
* stop the world
* snapshot the world
* sleep the world
* resume the world
* capture the world

Those are the real architectural powers.

Everything else is policy.

For example:

* "until settled"
* "after 8 ticks"
* "when signal X commits"
* "when a user-defined predicate becomes true"

are not the ontology of the kernel.

They are stopping policies defined over the kernel-owned clock and world state.

That is a cleaner separation because it keeps the architecture general:

* the kernel owns progression and state continuity
* runtime or user policy decides when to pause and capture

So the right long-term question is not:

* "Which horizon kinds should the engine hardcode?"

It is:

* "How should the kernel expose controllable progression and resumable state so different stopping policies can be expressed cleanly?"

---

## 9. "Cooking" The Document

Under this model, "cooking" a document is not a metaphor.

It is a real simulation act.

An actor may:

* accumulate state over time
* generate new text
* grow a graph
* synthesize labels
* procedurally assemble content
* or transform its visual output

Then the document is captured at the chosen horizon.

This means VMPrint should eventually support documents whose printed form is:

* not merely authored directly
* but also partially *grown* through simulation

That is a profound expansion of the engine's expressive power.

It also fits the architectural direction much better than treating such behavior as "special effects outside print."

---

## 10. This Does Not Mean Chaos

Treating print as world slice does not mean sacrificing determinism.

In fact, determinism becomes even more important.

The rule should be:

* same input world
* same simulation horizon
* same runtime configuration
* same deterministic systems

must produce:

* the same captured document output

This means temporal simulation in VMPrint should still be:

* bounded
* measurable
* reproducible
* and explicit about stopping conditions

The goal is not uncontrolled liveness.

The goal is **deterministic temporal authorship**.

---

## 11. Relationship To Pagination

Pagination remains important, but its role changes.

Pagination is not the engine's ontology.

It is one system that spatializes world state into pages.

That means:

* pagination can still settle
* page counts can still emerge late
* actors can still react to pagination facts
* print can still remain a first-class target

But pagination is now downstream of a larger idea:

**the world exists first; pages are one way of viewing it.**

This is already visible in VMPrint's terminology:

* world space
* viewports
* terrain
* actors
* signals
* simulation

This document simply pushes that ontology to its logical conclusion.

---

## 12. Architectural Consequences

If this model is accepted, several future design choices become clearer.

### 11.1 No Permanent Split Between "Print Mode" And "Simulation Mode"

There is one runtime.

Print is one capture horizon within it.

### 11.2 Actor Stepping Becomes A First-Class Kernel Concern

The current reactive update path is not enough forever.

A true stepped actor capability should eventually exist alongside reactive wakeup.

### 12.3 The Clock Must Be Visible To The World

The session should eventually expose a first-class simulation clock.

Actors and systems may read:

* current tick
* possibly previous tick
* the tick at which a signal committed

This gives the world a shared temporal reference rather than only a sequence of local events.

### 12.4 Capture Must Become Explicit

The engine should eventually distinguish between:

* simulating the world
* capturing the world
* rendering the capture

These are related, but not identical.

### 12.5 Stability Semantics Must Be Clearer

The engine will need stronger language for:

* settled
* stable
* bounded
* timed out
* horizon reached

### 12.6 Performance Accounting Must Expand

If progression and stopping policy become more explicit, performance discipline must cover:

* tick count
* wake count
* update count
* resettlement cycles
* capture cost
* tick count

---

## 13. Risks

This model is strong, but it is not free.

Main risks:

* over-expanding the scope of the engine too quickly
* muddying current print semantics before horizon design is disciplined
* introducing stepping without clear stopping conditions
* making ordinary print slower or less predictable
* confusing reactive wakeup with continuous ticking

These are real risks.

They are reasons to proceed carefully.

They are not reasons to preserve an artificial conceptual split if the deeper model is right.

---

## 14. Recommended Discipline

If VMPrint adopts this direction, it should do so with explicit guardrails.

### Guardrail 1

Ordinary print must remain cheap by default.

### Guardrail 2

Stopping policy must be explicit, never magical.

### Guardrail 3

The engine must preserve deterministic output for deterministic horizons.

### Guardrail 4

Reactive wakeup and stepped update should share one actor model, not branch into parallel abstractions.

### Guardrail 5

Each temporal extension should be proven synthetically before being normalized into product semantics.

---

## 15. Immediate Implication

The next design question is no longer:

* "Should VMPrint ever have actor stepping?"

It becomes:

* "How should a kernel-owned simulation clock and resumable progression model be introduced so that print remains a first-class slice of the same world?"

That is a better question because it preserves the engine's identity instead of fragmenting it.

---

## 16. Final Position

VMPrint should treat print as a slice of world simulation.

Not as a special case.
Not as a non-temporal exception.
Not as a separate mode that must be protected from the engine's own deeper logic.

The engine simulates a world.
Actors participate in that world.
The kernel owns time.
Pages are one spatial projection of it.
Print is the act of capturing that world at a declared horizon.

That is the cleanest long-term identity VMPrint can have.
