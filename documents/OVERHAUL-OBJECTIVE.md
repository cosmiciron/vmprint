# Architecture Overhaul Objective

This document is the short operational companion to [COLLABORATOR.md](/c:/Users/cosmic/Projects/vmprint/documents/COLLABORATOR.md).

It states:

* what the overhaul is trying to accomplish
* how work should be chosen
* how progress should be judged
* how performance discipline must be maintained

It is intentionally shorter and more operational than the main architecture document.

---

## 1. Primary Objective

Turn VMPrint into a true simulation engine for layout, not a traditional paginator with plugins.

That means the real ontology of the engine should be:

* world state
* actors
* systems
* phases
* spatial terrain
* formations
* transformable actors
* snapshots for ambiguous transitions
* a thin coordinator

The engine must solve layout problems in these terms, not by adding feature-specific paginator exceptions.

---

## 2. Success Criteria

The overhaul is successful when:

* current regression fixtures are explainable in simulation terms
* hard layout seams are absorbed by engine primitives, not hidden paginator logic
* actor intelligence remains the heart of local behavior
* the paginator becomes a coordinator rather than the domain brain
* new capabilities emerge honestly from the runtime model

The target is not "clean code" in the abstract.
The target is a better engine model.

---

## 3. Core Architectural Direction

VMPrint should continue moving toward this shape:

| Engine Concern | Architectural Owner |
|---|---|
| Local layout intelligence | `PackagerUnit` actors |
| World state | `LayoutSession` |
| Spatial terrain | `ConstraintField` and session-owned spatial state |
| Feature behavior | collaborators / systems |
| Group movement / local orchestration | formations |
| Ambiguous transition seams | local snapshot branching |
| Progression / tick control | thin paginator coordinator |

Packager has not been diminished by this shift. It has been correctly placed inside a larger and stronger simulation system.

That larger system should not harden into one large session object.
The longer-term direction is a **microkernel-style simulation substrate** at the bottom of the engine.

That bottom layer should own only substrate concerns such as:

* identity
* mutable world state
* interaction state
* events
* snapshots / rollback
* artifact channels

It should not own document-specific meaning such as:

* AST interpretation
* pages as publishing concepts
* pagination policy
* print-feature behavior

In practice, VMPrint should be understood as layered:

1. simulation kernel
2. layout runtime
3. document semantics
4. print / composition handoff

This is how the overhaul avoids replacing paginator-centric design with a new `LayoutSession` god object.

---

## 4. Working Method

### 4.1 Fixture-Driven Architecture

Use current regression fixtures as architectural forcing functions.

A fixture should count as "covered" only if:

* its behavior is honestly explained by the new model
* the solution does not secretly rely on old paginator ownership
* the engine primitive introduced for it looks reusable beyond that one fixture

### 4.2 Narrow Probes Before Broad Generalization

When a seam resists refactor, do not force extraction.

Instead:

1. identify the missing primitive
2. build a narrow honest probe
3. validate correctness and performance
4. only then generalize

This is how the engine correctly arrived at:

* formations
* snapshot branching
* explicit transform kinds

### 4.3 Stop Demo-Chasing

Showcases are not the goal.

A capability should be considered real when:

* it exists as runtime substrate
* it solves an honest fixture or seam
* it survives regression and performance checks

Visual showcases are useful only after that.

### 4.4 Favor Honest Primitives Over Cosmetic Abstractions

Continue a refactor when it:

* removes real domain ownership from the paginator
* turns implicit behavior into a runtime primitive
* makes a seam understandable in simulation terms
* improves testability without lying about behavior

Stop when the work becomes:

* naming churn
* ceremony
* abstraction that only mirrors already-obvious flow
* purity tax

---

## 5. Performance Methodology

Performance discipline is mandatory and must remain explicit.

### 5.1 Per-Slice Hotspot Checks

Every meaningful refactor slice should be paired with isolated, warmed perf checks on the relevant hotspots.

Default benchmark set:

* `09-tables-spans-pagination`
* `10-packager-split-scenarios`
* `00-all-capabilities`

Add one extra directly affected fixture when needed.

### 5.2 Periodic Full-Suite Perf Pass

In addition to hotspot checks, a warmed full regression-fixture perf pass must be run at meaningful checkpoints.

This is required to catch:

* aggregate drift
* interaction costs across many features
* small costs that accumulate invisibly

### 5.3 No Noisy Numbers

Do not trust performance data from parallel build/test activity.

Performance runs must be:

* isolated
* warmed
* compared against a trusted baseline

### 5.4 Performance Judgment Rule

A change is acceptable when:

* correctness improves or architecture improves materially
* and there is no credible performance regression

An isolated noisy sample is not enough evidence.
Use warmed isolated runs and periodic full-suite runs.

---

## 6. Current Strategic Fronts

The main unfinished fronts are:

1. transformable actors as a stronger runtime contract
2. richer spatial negotiation
3. thinner coordinator semantics
4. system-to-system interaction through shared world state
5. multi-pass / fixpoint simulation
6. future real-time / incremental simulation semantics

These should be approached in that order unless a current fixture forces a different priority.

---

## 7. Rule of Thumb

When unsure, ask:

> Does this change make VMPrint more honestly behave like a layout simulation engine?

If yes, continue.
If not, stop and reassess.
