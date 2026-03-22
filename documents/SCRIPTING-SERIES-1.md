# Scripting Series 1

## Purpose

Series 1 exists to establish VMPrint scripting as a clean system for dynamic document content manipulation.

This series is not about exposing the full engine.
It is not about animation, world simulation, page programming, or rich runtime state systems.

It is about one thing:

- letting documents and elements change document content dynamically through events and messages

## Core Thesis

Events and messages are the two fundamental supporting structures of the scripting system.

Together they form the longitude and latitude of the Series 1 model:

- events tell scripts what happened
- messages let document participants coordinate with each other

This is the heart of the paradigm.

Series 1 is intentionally not procedural-first.
A scripter can still write procedural code inside a handler, but the system itself is organized around:

- receivers
- events
- messages
- content mutation

If a script ignores those structures entirely, it is not really taking advantage of what VMPrint scripting is meant to offer.

## Public Scope

Series 1 supports:

- document events
- element events
- element-to-element and document-to-element messages
- content updates
- basic generic element queries
- user-facing identities through element `name`

Current public objects:

- `doc`
- `self`

Current public event families:

- document events
- element events
- message handlers

Document events are top-level by implication.
Series 1 does not require an explicit `doc_` prefix for document handlers.

Current public mutation helpers:

- `append(...)`
- `prepend(...)`
- `setContent(...)`
- `replaceElement(...)`
- `insertBefore(...)`
- `insertAfter(...)`
- `deleteElement(...)`

Current public generic queries:

- `element(name)`
- `elementsByType(type)`

## Deliberate Non-Goals

Series 1 does not support:

- page scripting as a public feature
- semantic document helpers such as `getHeadings()` or other hard-coded content categories
- user-managed replay control
- animation or ticking
- rich world interaction
- a formal persistent state system
- free-floating script globals as a supported feature

These are not deficiencies in Series 1.
They are intentionally deferred so the first scripting release stays tight and useful.

## API Admission Rule

New Series 1 API should be added only if it satisfies all of these:

- it directly supports dynamic document content manipulation
- it is generic rather than hard-coded to one document semantic
- it is phrased in user terms, not engine terms
- it strengthens the event/message model rather than bypassing it
- it can be explained simply in the public scripting language

If a proposed helper fails those tests, it should wait for a later series or be redesigned.

## Variable Scope Policy

Series 1 defines variable scope in scripting terms, not engine terms.

Supported now:

- document-scoped bindings declared at top level and exposed through `doc.vars`
- handler-local variables
  These live only for the duration of one handler call.

Not supported now:

- formal persistent local variables
- formal shared mutable state bags

This is intentional.
Series 1 should not introduce state systems casually.

## Release Standard

Series 1 is successful if it proves all of the following:

- documents can react to lifecycle events
- elements can react to their own events
- document participants can coordinate through messages
- content can change dynamically without exposing engine plumbing
- the author can understand the scripting model without learning internal runtime architecture

That is the bar for this release line.

## Runtime Composition Caveat

Series 1 should preserve a clean user-facing scripting surface while the runtime underneath is strengthened.

The architectural note for that work lives in:

- [SCRIPTING-RUNTIME-COMPOSITION.md](/c:/Users/cosmic/Projects/vmprint/documents/SCRIPTING-RUNTIME-COMPOSITION.md)
