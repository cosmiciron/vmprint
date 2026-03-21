# TOC as a VPX

This document defines the architectural stance for Table of Contents support in VMPrint and, in doing so, formally introduces the `VPX` model.

The short version:

- TOC is not a core engine primitive.
- TOC is not part of the public AST contract.
- TOC is provided as a bundled `VPX`.
- Authors invoke it through a `vpx` placeholder element in the AST.
- The `VPX` lives alongside the engine during document realization and expands that placeholder into ordinary AST content.

---

## 1. Problem

A Table of Contents is common enough that users should not have to reinvent it, but it is also too semantically and stylistically rich to belong in the core AST.

A novel TOC, an academic TOC, a legal TOC, and a technical-manual TOC all differ substantially in:

- entry selection
- hierarchy rules
- numbering rules
- page reference style
- title treatment
- indentation and leaders
- frontmatter/bodymatter interactions
- decorative structure

Trying to capture all of this in the engine AST would push the AST toward a bloated pseudo-DOM that tries to absorb higher-order document semantics rather than remain a clean spatial contract.

That is not the direction VMPrint should take.

---

## 2. Decision

VMPrint does not treat TOC as an engine-native concept.

By the time content reaches the public AST, the engine should only see ordinary authored content and placeholders. It should not own a built-in semantic notion of "table of contents".

Instead:

- transmuters may emit a `vpx` placeholder for `TOC`
- the host environment attaches a TOC `VPX`
- the TOC `VPX` interacts with the engine through approved surfaces
- the `VPX` expands the placeholder into ordinary AST elements

This keeps the engine small, the AST honest, and TOC support widely available.

---

## 3. What Is a VPX

`VPX` is the platform term for an engine-attached extension module.

The expansion of the acronym is intentionally unimportant. `VPX` is a product term, not a contract that has to keep spelling out its own meaning.

What matters is its role:

- a `VPX` is attached to the engine by a host application or standard library
- a `VPX` is narrower than a general-purpose plugin system
- a `VPX` is typically driven by authored placeholders
- a `VPX` can interact with the engine programmatically over the lifetime of document realization
- a `VPX` produces or refines ordinary AST content rather than introducing permanent new engine primitives

In spirit, a `VPX` is closer to a bundled platform module or an embedded document component than to a one-shot preprocessor.

---

## 4. Why Not Engine-Native TOC

The old temptation is to model TOC as a first-class AST node or a built-in engine actor. VMPrint should reject that approach for several reasons.

### 4.1 TOC Is Domain-Specific

There is no single generic TOC worth canonizing in the AST. There are only domain-specific TOCs implemented with different rules and appearances.

### 4.2 TOC Depends on Settled Facts

A useful TOC usually depends on finalized document facts such as:

- discovered headings
- their hierarchy
- page assignments
- page labels
- anchor targets

Those are engine-side facts, but the way they become a TOC is not an engine concern.

### 4.3 TOC Customization Is Open-Ended

If TOC enters the core AST, pressure immediately builds to support every niche variation. That leads to a swollen authored surface and an engine that owns styling logic it should never have owned.

### 4.4 TOC Is Better as a Standard Capability Than a Core Primitive

Users should have easy access to TOC support, but that does not require TOC to live in the engine core. A bundled `VPX` gives the user experience of a native feature without the architectural cost of making it one.

---

## 5. Why Not Pure Transmuters

Pure engine-decoupled transmuters are too weak for this job.

They were based on a simpler assumption:

- the AST can express everything
- therefore a transmuter only needs to emit AST

That assumption no longer holds for features like TOC, which need engine knowledge and possibly staged interaction with the runtime.

Transmuters still matter, but their role is narrower:

- parse source formats
- emit base AST
- emit placeholders such as `{{TOC}}`

The actual realization of a higher-order construct belongs to a `VPX`.

---

## 6. Placeholder Model

The authored entry point for a TOC is a placeholder.

Example:

```json
{
  "type": "vpx",
  "name": "TOC",
  "props": {
    "variant": "novel",
    "depth": 2,
    "pageNumbers": true,
    "leaders": "dots"
  }
}
```

The important point is that the AST carries an invocation point, not a built-in TOC semantic object.

---

## 7. Lifecycle of a TOC VPX

A TOC `VPX` is not a one-time textual expander. While attached, it lives with the engine and may interact with it through multiple stages.

Conceptually, the lifecycle looks like this:

1. A transmuter or author emits a TOC placeholder.
2. The host registers the TOC `VPX` with the engine.
3. The `VPX` claims the placeholder.
4. The `VPX` reads the placeholder properties and the relevant engine facts.
5. The `VPX` produces ordinary AST elements for the TOC.
6. The engine lays those elements out like any other content.

Depending on the final design, a `VPX` may work in one or more stages:

- pre-simulation, for decisions that need no settled facts
- post-settlement, for decisions that require final page data
- controlled replay or resettlement, if inserted content itself affects pagination

The exact staging contract is an implementation topic. The architectural point is that a `VPX` is engine-attached, not engine-decoupled.

---

## 8. TOC as a Standard Library VPX

TOC is the first obvious candidate for the VMPrint standard library.

That means:

- users do not need to write their own TOC code to get started
- hosts can ship the TOC `VPX` by default
- the engine remains free of TOC-specific semantics
- advanced customization can grow in the `VPX` without polluting the AST

This does not mean every adjacent frontmatter artifact belongs inside the TOC `VPX`. Supplemental features such as List of Figures, List of Tables, and similar matter lists should be treated as separate supplementary components with their own surfaces, even if they later share conventions or helper infrastructure with TOC.

In practical terms, VMPrint can say:

- a `vpx` element with `name: "TOC"` is a supported standard invocation point
- the standard library ships a TOC `VPX`
- if the TOC `VPX` is plugged in, the placeholder resolves
- if it is not plugged in, the placeholder remains unresolved and should fail clearly

This is the same architectural pattern used by many successful platforms:

- keep the core small
- bundle serious extension modules
- let those modules feel first-class without making them core language features

---

## 9. Responsibilities Split

### 9.1 Engine Core

The engine is responsible for:

- simulation
- settled world facts
- pagination
- rendering handoff
- ordinary AST layout primitives
- the attachment surface through which `VPX`s interact with the engine

### 9.2 Transmuters

Transmuters are responsible for:

- parsing source inputs
- lowering source syntax into VMPrint AST
- inserting `vpx` placeholders such as `name: "TOC"`

### 9.3 VPXs

`VPX`s are responsible for:

- claiming placeholders
- reading declared properties
- using approved engine-side facts
- generating domain-specific ordinary AST output

### 9.4 Hosts

Applications such as Draft2Final are responsible for:

- deciding which `VPX`s are plugged in
- shipping bundled standard-library `VPX`s
- enabling or disabling domain-specific capability sets

---

## 10. Consequences

This decision has several immediate consequences.

### 10.1 Remove TOC from the Core AST Story

TOC should no longer be treated as a permanent public AST primitive.

### 10.2 Remove TOC from the Engine's Self-Identity

The engine should stop describing itself as owning TOC as a built-in document semantic concept.

### 10.3 Build the Right Engine Surfaces Instead

The correct engine work is not "make TOC smarter in the AST".

The correct engine work is:

- expose the right settled facts
- define the right placeholder contract
- define the right `VPX` attachment surface

### 10.4 Let TOC Become a Serious Module

Once outside the engine core, TOC can grow into a genuinely capable standard module with deep domain styling and behavior, without dragging the engine contract along with it.

---

## 11. Non-Goals

This document does not yet define:

- the final structured AST representation of placeholders
- the final `VPX` registration API
- the exact lifecycle callbacks for a `VPX`
- the exact settled-fact surface exposed by the engine
- the final TOC customization schema
- the design of supplementary frontmatter components such as List of Figures or List of Tables

Those are follow-on design documents.

This document only establishes the architectural decision:

- TOC is a `VPX`
- `VPX`s are the right home for higher-order document capabilities
- the engine and AST should remain smaller than the feature universe they enable
