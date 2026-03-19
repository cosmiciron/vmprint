# Kernel-Level Actor Activation and Update

*Design draft, March 2026.*

---

## 1. Why This Document Exists

Recent work on live TOC proved that VMPrint can embody a simulation-style architecture in production code, not just in experiments.

Recent work on `{totalPages}` originally revealed the opposite pressure: when the engine lacked a general temporal primitive, even a minor feature could push us back toward typesetter-style patching.

That pressure has now been addressed in production: `{totalPages}` is implemented through the actor activation/update substrate rather than a footer-specific post-process.

The issue is bigger than page counters.

The problem is architectural:

* the engine currently has strong support for committed signals, checkpoints, rollback, and selective resettlement
* but it still lacks a general kernel-level concept of actor activation and actor update
* in the absence of that primitive, late-resolving behaviors risk being implemented as domain-specific post-processes

This document proposes a generic, non-domain-specific runtime capability that lets actors become active, react to world changes, and update themselves without forcing the engine into feature-specific orchestration hacks.

---

## 2. The Design Pressure We Should Take Seriously

The old `{totalPages}` implementation was useful as a symptom.

It worked, but its shape should concern us:

* feature-specific token detection was added
* header/footer regions gained a special deferred bucket
* unresolved data was stored in a feature-owned side structure
* a post-march patch step was added
* `simulate()` gained bespoke orchestration for one narrow feature

That is the wrong direction for an engine trying to think like a simulation runtime.

If this pattern continues, every awkward late-bound feature will want:

* another detector
* another deferred store
* another patch stage
* another branch in orchestration

That is how an engine gradually loses its identity and drifts back into pass choreography.

The lesson is not "page counters are hard."

The lesson is:

**the engine is missing a primitive, and domain code is compensating for its absence.**

---

## 3. The Core Thesis

VMPrint should support **kernel-level actor activation and actor update** as a general capability.

This does **not** mean:

* every actor must animate
* every actor must tick every frame
* the engine must become a real-time renderer today

It means:

* every actor may, in principle, participate in time
* most actors remain dormant
* many actors wake only in response to events or committed signals
* a smaller class of actors may be explicitly stepped by the runtime
* the same primitive should serve both internal engine actors and eventual user-authored programmable actors

This is the cleanest way to avoid solving temporal problems through special-purpose feature plumbing.

---

## 4. Why This Belongs in the Kernel

If actor activation and update is real engine capability, it cannot live as a footer system, a TOC trick, or a scripting addon.

It must exist below document semantics and below individual features.

The kernel should know:

* whether an actor is dormant, active, or event-awakened
* how actors are scheduled
* how an actor update step is invoked
* how update results are classified
* how dirty frontiers or dirty surfaces are reported
* how snapshots and rollback interact with active actors
* how update work is measured

The kernel should **not** know:

* paragraphs
* total page counts
* headers and footers
* TOCs
* author scripting semantics
* any document-specific token language

That boundary is essential.

The primitive must be generic enough that:

* the engine can use it now for problems like page-finalization facts
* future users can use it for programmable document behavior
* future interactive surfaces can use it without needing a second runtime grafted onto VMPrint

---

## 5. Architectural Goal

Introduce a **generic actor activation/update substrate** that allows the runtime to express three kinds of behavior through one coherent model:

1. **Dormant actors**
   Actors that never update unless directly re-entered by layout settlement.

2. **Reactive actors**
   Actors that wake when committed world state changes and then report one of:
   * no change
   * content-only change
   * geometry-changing change

3. **Stepped actors**
   Actors that may participate in an explicit update cycle when activated by engine logic or, eventually, by authored scripting/runtime behavior.

This should let VMPrint solve late-bound and temporal problems without feature-specific orchestration and without abandoning deterministic layout settlement.

---

## 6. What This Is Not

This proposal is not a demand that VMPrint immediately become a full real-time engine.

It does not require:

* a global `dt` loop for all actors
* a 60 FPS render model
* universal polling
* permanent activity for every actor

VMPrint's current document-layout mode remains valid:

* deterministic
* largely event-driven
* settlement-oriented
* selective in what gets recomputed

The point is not to replace that with a noisy tick model.

The point is to ensure the engine has a real temporal primitive available when needed, so it does not fall back to domain-specific patching.

---

## 7. Conceptual Model

### 7.1 Actor Lifecycle States

At the kernel level, actors should be able to exist in states such as:

* `dormant`
* `event-awakened`
* `active`
* `suspended`

The exact names may change, but the distinction matters.

Most actors in a print document will stay dormant almost all the time.

That is not a weakness. It is an efficiency advantage.

### 7.2 Update Triggers

Actors may be awakened by:

* committed signal publication
* runtime lifecycle boundaries
* explicit kernel scheduling
* authored scripting in future runtime modes

This lets the engine keep the normal case cheap while still supporting genuinely temporal behavior.

### 7.3 Update Outcomes

An actor update must report the kind of change it caused.

At minimum:

* `none`
* `content-only`
* `geometry`

Those three outcomes are architecturally significant:

* `none` means no redraw and no resettlement
* `content-only` means redraw or box-content patch in place
* `geometry` means settlement or resimulation from an affected frontier/surface

This turns content-only reactive update into a first-class engine concept instead of an afterthought.

---

## 8. Relationship to Existing VMPrint Mechanisms

The proposal is additive, not a rejection of the current architecture.

VMPrint already has strong building blocks:

* committed signal publication
* observer sweeps at controlled boundaries
* speculative branch snapshot/rollback
* safe checkpoints
* dirty-frontier resettlement
* collaborator lifecycle hooks

What is missing is the next abstraction up:

* a generic kernel-owned notion of actor activation
* a generic actor update step
* a runtime-level interpretation of update outcomes

Today, `observeCommittedSignals()` approximates part of this for reactive actors.

This proposal generalizes that idea rather than replacing it.

Possible future direction:

* `observeCommittedSignals()` becomes one activation path
* a true optional `update()`-style capability becomes another
* both feed the same update-outcome classification and scheduling machinery

---

## 9. The `{totalPages}` Case Reframed

`{totalPages}` is not important because page counters matter.

It is important because it reveals the difference between two engine identities.

### Typesetter answer

"We only know total pages after layout completes, so defer the region, then patch it afterward."

### Engine answer

"Pagination finalized and published a world fact. The footer actor woke, changed its content, and redrew without affecting geometry."

The latter is the answer we want the engine to be capable of expressing naturally.

That warning has now been validated and resolved:

* the old defer-and-patch path was the wrong architectural shape
* the replacement reactive page-region actor path is the correct one
* the engine now has a production example of content-only reactive update

---

## 10. Why This Matters Beyond Typesetting

This capability is not just for internal cleanup.

It is also the right foundation for future VMPrint evolution:

* live writing surfaces
* programmable document widgets
* dynamic counters and references
* author-scripted behaviors
* interactive cards or HyperCard-like environments
* visual morphing of authored elements
* temporal overlays or document-local agents

If the engine never gains a general actor activation/update primitive, those futures will either:

* require a second runtime bolted on beside the existing engine
* or be implemented through increasingly fragile feature-specific hooks

Neither is acceptable.

---

## 11. Design Principles

### 11.1 Kernel-Level, Domain-Agnostic

No page-counter-specific API.
No footer-specific API.
No TOC-specific API.

Only generic actor activation, stepping, and update reporting.

### 11.2 Dormant by Default

The common case must stay cheap.

Most actors should do nothing until the runtime has a reason to awaken them.

### 11.3 Event-Driven First, Step-Capable Second

The engine should not force a frame loop into all scenarios.

But it must support an explicit update step when needed.

### 11.4 Outcome Classification Is First-Class

The engine must treat:

* no change
* content-only change
* geometry change

as distinct runtime outcomes with distinct cost models.

### 11.5 Determinism Remains a Core Requirement

Any actor update mechanism must preserve deterministic settlement under deterministic inputs.

### 11.6 Performance Must Be Measured

Activation and stepping are not "free because architecture."

Every meaningful rollout slice must record performance impact.

---

## 12. Proposed Minimal Kernel Responsibilities

At minimum, the kernel/runtime layer should eventually provide generic support for:

* actor activation state tracking
* actor wake scheduling
* actor update invocation
* update result classification
* dirty-frontier or dirty-surface reporting
* snapshot/rollback integration for active actor state
* metrics around activation counts, update counts, and update cost

This is intentionally narrower than "a complete gameplay framework."

It is the minimum viable temporal substrate for VMPrint's identity.

---

## 13. Suggested Runtime Shape

This is conceptual, not final API design.

Possible generic vocabulary:

```ts
type ActorActivationState = 'dormant' | 'event-awakened' | 'active' | 'suspended';

type ActorUpdateKind = 'none' | 'content-only' | 'geometry';

type ActorUpdateResult = {
  changed: boolean;
  kind: ActorUpdateKind;
  earliestAffectedFrontier?: SpatialFrontier;
};
```

Possible actor-side capability:

```ts
interface RuntimeUpdatableActor {
  update?(context: RuntimeUpdateContext): ActorUpdateResult | null | undefined;
}
```

Possible interpretation:

* `kind: 'none'` -> do nothing
* `kind: 'content-only'` -> redraw or patch actor-owned boxes in place
* `kind: 'geometry'` -> resettle from reported frontier/checkpoint

The exact API is less important than the architectural rule:

**the kernel must understand the category of change without understanding the feature domain.**

---

## 14. Signal Routing and Update Scheduling

The activation/update model should be selective, not broadcast-heavy.

The runtime should not wake every actor on every meaningful world change.

The preferred shape is:

* the committed signal store remains topic-based
* actors may declare interest in one or more topics
* when a committed signal is published, only subscribed actors are awakened
* the runtime drains the awakened actor set and invokes their update capability
* each actor returns `none`, `content-only`, or `geometry`
* the runtime routes the result to redraw or resettlement as appropriate

Conceptually:

```ts
type ActorWakeReason =
  | { kind: 'signal'; topic: string; signalKey?: string }
  | { kind: 'lifecycle'; phase: string }
  | { kind: 'scheduled' };
```

Possible kernel/runtime responsibilities:

* maintain actor-to-topic subscriptions
* maintain a deduplicated awakened-actor queue or set
* preserve deterministic processing order for awakened actors
* associate update work with a wake reason for metrics and debugging

This suggests a more precise flow than a coarse global `"WORLD_STATE_COMMITTED"` broadcast:

1. runtime publishes a committed signal such as `'pagination:finalized'`
2. only actors subscribed to that topic are marked awakened
3. the runtime drains that awakened set in deterministic order
4. each actor update result is classified
5. `content-only` updates are redrawn in place
6. `geometry` updates are routed through bounded settlement

A coarse engine-wide lifecycle signal may still exist for rare boundaries, but it should not become the default wake mechanism.

The normal rule should be:

**publish narrowly, wake narrowly, settle narrowly.**

---

## 15. Oscillation and Settlement Limits

The largest technical danger in this design is not activation itself. It is **reactive geometry oscillation**.

Example pattern:

* an actor receives a committed signal
* it updates and reports `geometry`
* resettlement changes pagination
* pagination emits another committed fact
* the same or another actor wakes again
* the system can enter a loop

This is not hypothetical. It is the natural hard case for any reactive spatial engine.

The design should treat this as a first-class runtime problem, not an implementation footnote.

### Required safeguards

At minimum, the runtime should eventually support:

* **bounded settlement cycles**
  Hard cap on geometry-triggered resettlement cycles per simulation/update window.

* **repeated-state detection**
  If the runtime observes the same actor/update frontier/state signature repeating, it should stop and surface the oscillation clearly.

* **causality tracing**
  Update logs should record which signal woke which actor and which actor triggered the next geometry change.

* **deterministic failure mode**
  If a settlement cap is exceeded, the engine should fail deterministically with useful diagnostics rather than degrade into silent churn.

### Optional stronger constraint

For especially sensitive reactive chains, the runtime may eventually enforce or encourage a DAG-like signal discipline:

* upstream facts publish downstream facts
* cycles are either disallowed or require explicit acknowledgement

This does not need to be mandatory for the first rollout, but the architecture should leave room for it.

### Design principle

`geometry` is powerful and expensive.

The engine should make `content-only` cheap and common, and make `geometry` possible but observable, bounded, and debuggable.

---

## 16. Relationship to User Programmability

This capability should be designed for both:

* internal engine actors
* future user-authored programmable actors

That does not mean exposing the full kernel immediately.

It means we should avoid an implementation that is only usable by built-in features.

The engine should eventually be able to support scenarios like:

* an author activates a paragraph actor
* the paragraph reacts to world signals
* the paragraph changes content, style, or visual state
* the runtime classifies whether the result is content-only or geometry-changing
* the engine redraws or resettles accordingly

This is far more coherent than maintaining one runtime for engine features and another for "programmable content."

---

## 17. Risks and Guardrails

### Main risks

* smuggling domain-specific behaviors into the kernel under generic names
* accidentally forcing all actors into unnecessary update traffic
* weakening determinism
* creating a second orchestration stack that competes with existing settlement logic
* taking on real-time complexity without measuring cost

### Guardrails

* dormant by default
* optional capability, not mandatory actor burden
* event-driven wakeups remain the normal path
* geometry-changing updates must reuse the existing checkpoint/resettlement model
* content-only updates must not be allowed to silently mutate geometry
* every rollout slice must include regression and performance evidence

---

## 18. Immediate Architectural Consequence

We should stop treating `{totalPages}` as the feature to solve and start treating it as the first proof case for a larger design.

The new sequence should be:

1. define kernel-level activation/update primitives in a domain-neutral way
2. define how update outcomes map to redraw vs resettlement
3. prove the primitive first through synthetic visual experiments
4. migrate one small built-in actor path onto that primitive only after the synthetic proofs are stable
5. use `{totalPages}` as the first production-domain adoption case after the proof suite is stable

That keeps the engine honest.

---

## 19. Proof-First Test Strategy

The first implementation target for this design should **not** be footer/page-count behavior.

That feature is useful as architectural motivation, but it is a poor first proof bed because:

* it carries document-domain semantics we do not want leaking into the primitive
* it can tempt the implementation toward another feature-shaped shortcut
* it is less visually diagnostic than a synthetic spatial proof

The better tradition already exists in the repo:

* synthetic experiments
* visually obvious fixtures
* colored boxes and simple shapes
* proofs that leave behind visible traces of what happened during settlement

This architecture should follow that tradition.

### Recommended first proof style

Use synthetic actors similar to the experiments in `engine/experiments/`, designed to make update behavior visible on the page itself.

Examples:

* a dormant colored box that wakes on a committed signal and changes only its text or fill while preserving geometry
* a follower box that wakes on a signal and grows, visibly forcing downstream resettlement
* a pair of boxes where one leaves a visible render-count mark so we can prove whether content-only update avoided replay
* a chain of colored actors that visually demonstrate wake order, update kind, and final settled state

The ideal proof should be inspectable by eye before reading logs.

It should be possible to look at the page and answer questions like:

* which actor woke?
* did it redraw in place or force resettlement?
* did upstream actors replay?
* did the system leave behind duplicate marks?
* did a content-only update preserve geometry exactly?

### Why this matters

This work is about proving a kernel primitive, not shipping a feature.

Synthetic proofs are better because they:

* isolate runtime semantics from document semantics
* expose incorrect replay or wake behavior immediately
* make regressions easier to understand
* keep the implementation honest about what is really being tested

### Production adoption rule

That sequencing has now been followed:

* synthetic proof suite landed first
* `{totalPages}` was adopted afterward as the first production-domain content-only case
* the old special-case patch path was removed

That sequencing preserves clarity:

* experiments prove the primitive
* production adoption proves the primitive can replace a real feature hack

---

## 20. Success Criteria for This Design Direction

This design direction is validated when all of the following are true:

* VMPrint has a kernel-owned, non-domain-specific actor activation/update primitive
* most actors remain dormant with negligible overhead
* content-only actor updates are first-class runtime behavior
* geometry-changing actor updates route through normal settlement logic
* at least one built-in feature currently solved through special orchestration is migrated to the new primitive
* the migration reduces engine-specific patch logic rather than adding another abstraction on top of it
* the runtime shape is usable by both built-in engine actors and future programmable actors
* performance evidence shows the dormant path remains cheap

---

## 21. Final Position

VMPrint should not solve temporal problems by repeatedly inventing domain-specific escape hatches.

It should solve them by becoming more fully itself.

That means:

* kernel-level activation
* generic actor update capability
* first-class distinction between content-only and geometry-changing change
* one coherent actor model for both engine features and future programmable content

The goal is not to imitate every convention of mainstream game engines.

The goal is to import the superior simulation mindset deeply enough that the engine stops falling back to typesetter-shaped solutions when time enters the picture.
