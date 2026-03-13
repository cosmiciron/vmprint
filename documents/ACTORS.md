# Actors

This document defines how actors should be understood in VMPrint.

It exists because the architecture has now crossed a threshold:

* VMPrint is not just a formatter with special cases
* VMPrint is a domain engine for document layout and typesetting
* therefore, "what is an actor?" and "where should it live?" must be explicit

---

## 1. Core Principle

VMPrint owns the **document-layout domain**.

That means VMPrint is allowed to own the actors that are native to that domain.

This is not a design failure.
It is the sensible boundary for a domain engine.

In game terms:

* a fully generic engine should not hardcode the Dwarf
* but VMPrint is not trying to be a universal simulation engine
* it is an engine for document worlds
* so the native inhabitants of document worlds may live inside it

The real rule is not "never put actors in the engine."
The real rule is:

* do not over-engineer
* do not burden ordinary consumers with engine-integration work they should not need
* do not make native actors impossible to customize or replace later

---

## 2. What The Engine Owns

VMPrint should own both:

* the actor machinery
* the actors that are native to document layout/typesetting

That includes engine infrastructure such as:

* actor identity
* actor lifecycle
* placement and collision participation
* split / continuation semantics
* transitions
* rendering hooks
* shared world interaction through the kernel and engine systems

And it may also include domain-native actor families such as:

* paragraph-like actors
* heading-like actors
* table actors
* drop-cap actors
* TOC actors, if we conclude TOC is truly part of the document-layout domain

VMPrint should feel no guilt about owning these.

---

## 3. What Consumers Own

Consumers such as `mkd-manuscript` and `draft2final` should primarily own:

* content
* structure
* configuration
* styling
* behavior parameters
* presets and domain-specific usage patterns

They should not be forced to define actors just to perform ordinary document work.

In practice, they are closer to:

* world builders
* rulesets
* presets
* mods

They dress the actors.
They do not need to manufacture the species for everyday use.

In game terms:

* VMPrint owns the Dwarf
* the consumer decides whether that Dwarf appears as a king, a drunk, a monk, or a soldier

---

## 4. Legacy Built-Ins Are Not Embarrassing

VMPrint already contains legacy built-in actors in the engine, including examples like:

* `DropCap`
* `Table`
* `Story`

That is not proof the architecture is wrong.

It is proof that VMPrint has always been closer to a domain engine than a purely generic formatter.

What matters is this:

* those actors should be understood as native domain inhabitants
* not as excuses to keep baking unrelated future features into the engine carelessly

Longer term, the engine should still make it possible to swap or replace even these if the domain broadens.

So the standard is:

* native actors may live in the engine
* but they should not be treated as immovable walls

---

## 5. The TOC Lesson

The first experimental TOC implementation exposed an important mistake.

It emitted a custom AST type:

* `manuscript-toc-region`

But that thing was not introduced as a real actor.
It fell through to ordinary flow handling while carrying a name that implied stronger runtime meaning.

That produced the worst middle state:

* not ordinary authored content
* not a true actor
* not honestly named

The lesson is:

* if something is ordinary flow, emit it as ordinary flow
* if something is a real actor, give it real actor treatment
* do not invent in-between labels that overclaim architectural significance

The TOC problem also revealed something more important:

* a static preassembled TOC block could have been built even in the old architecture
* therefore it does not prove the value of the new engine

The architecture-worthy version of TOC is the one that behaves like a true actor:

* chapter-driven state
* growth
* continuity
* future page-reference synchronization
* eventual coupled-region behavior

That is the version worth building.

---

## 6. Naming Rule

Actor names must be honest about what they are.

Bad:

* names that imply region or actor semantics when the thing is only a plain flow element

Better:

* ordinary names for ordinary flow content
* actor names only when actor semantics are real

In short:

* do not use a strong engine name for a weak implementation

---

## 7. Actor Levels

There are still important levels to respect.

### 7.1 Authored AST Level

This level should stay conservative.

It should describe authored document substance:

* paragraphs
* headings
* tables
* images
* similar directly authored content

It should not casually absorb generated companions as if they were authored document substance.

### 7.2 Engine Domain Level

This is the main home of native document actors.

Examples:

* paragraph actors
* heading actors
* table actors
* drop-cap actors
* TOC actors, if they are accepted as domain-native

This is where VMPrint defines how the species behaves.

### 7.3 Consumer Composition Level

This is where consumers decide how native actors are used and dressed.

Examples:

* `mkd-manuscript` chooses when a TOC should appear
* `draft2final` chooses title, numbering style, layout rules, or presentation
* future tools may provide different presets for the same underlying actor

This level decides how the game is staged, not how the engine species is implemented.

### 7.4 Extension Level

VMPrint should still preserve an extension seam for actors beyond the current domain.

That matters for future cases such as:

* generative UI
* editor-side companion systems
* interactive layout surfaces
* non-standard document worlds

This is how we stay extensible without forcing ordinary consumers to become engine programmers.

---

## 8. Desired Model

The long-term model should be:

1. VMPrint owns the native actors of the document-layout domain
2. consumers provide content, configuration, styling, and behavioral dressing
3. truly new future-domain actors can still enter through an extension seam
4. the engine runs all of them through the same kernel, physics, AI, transitions, lifecycle, and rendering systems

This gives us the practical middle path:

* not over-engineered purity
* not legacy feature soup

---

## 9. Immediate Rule

Before adding a new special feature, ask:

* Is this native to the document-layout/typesetting domain?
* Or is this a future-domain or mod-like inhabitant?

If it is native, it may live in VMPrint.

If it is outside the domain, it should enter through an extension seam instead of being baked into engine core by habit.

---

## 10. Immediate Implication For TOC

TOC should now be treated as a likely engine-native actor candidate, not as a consumer-defined stopgap block.

Why:

* it has advanced behavior
* it participates in layout
* it grows
* it continues across pages
* it is likely to synchronize with page truth later
* and it may become a proving ground for dependent-region behavior

So the next architecture-correct direction is:

* stop treating TOC as a fake custom flow block
* define it as a real actor in the engine
* make it configurable enough for consumers like `mkd-manuscript` and `draft2final` to fully dress it up

That gives us the sensible design:

* VMPrint owns the Dwarf
* consumers decide whether that Dwarf wears a crown, a robe, or a wineskin

And that fits the core rule this project should keep:

* never over-engineer
