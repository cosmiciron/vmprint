# VMPrint Scripting Architecture

## Why This Exists

VMPrint always had enough AST power to render rich static output.

The real missing piece was different:

- some document features need programmatic control
- some need settled document facts
- some need elements to coordinate with each other
- and none of that should force the AST to become a scripting language

So the scripting layer exists to provide a humane programmable surface over the engine's native dynamic model.

## Design Goal

The scripting model should be shaped around user intent and perception.

That means:

- document and element concepts
- events
- messages
- direct helper methods

That does not mean:

- engine jargon
- exposed refresh plumbing
- internal lifecycle names
- low-level runtime objects as the public language

## Current Mental Model

There are two kinds of handlers:

- event handlers
- message handlers

Event handlers are raised by the system.
Message handlers are raised by other document participants.

### Event Handlers

Current surface:

- `onLoad()`
- `onReady()`
- `onChanged()`
- `onRefresh()`
- `onMessage(from, msg)`
- `<elementName>_onCreate()`
- `<elementName>_onChanged()`

### Message Handlers

Current surface:

- `<elementName>_onMessage(from, msg)`

This split is intentional:

- events describe what happened in the system
- messages let document participants build more complex logic in a simple, direct way

## Handler Binding

Bindings are inferred by naming convention.

The document JSON does not need to redundantly declare:

- `onXxx`
- plus a method name

Instead, the method name itself is the binding.

Examples:

- `onLoad()`
- `summary_onMessage(from, msg)`
- `tocTitle_onCreate()`

## Script Objects

The user-facing objects are:

- `doc`
- `self`

And the current helper functions are:

- `element(name)`
- `elementsByType(type)`
- `sendMessage(recipient, msg)`
- `setContent(target, value)`
- `append(value)`
- `prepend(value)`
- `replaceElement(target, value)`
- `insertBefore(target, value)`
- `insertAfter(target, value)`
- `deleteElement(target)`

Current settled-fact helpers on `doc`:

- `doc.vars`
- `doc.getPageCount()`

`self` is always the current receiver.
Event parameters are only for event payload.

## Identity

Authored scripts should think in terms of element names, not internal engine source identifiers.

So the preferred authored identity is:

- `name`

Internally the engine may still normalize that into its own stable source identity system.
That is an implementation detail.

## Messages

Messages are the user-friendly scripting abstraction over the engine's deeper communication machinery.

The engine may use bulletin boards, actor bridges, or signal transport internally.
Scripters should not need to think about that.

They should only need:

- `sendMessage(recipient, msg)`
- `onMessage(from, msg)`

`msg` is a structured message object.

Current core shape:

- `msg.subject`
- `msg.payload`

## Update Semantics

The scripting layer should not burden authors with replay management.

The public model is:

- change content
- send messages
- react to events

The engine then classifies the effect natively as:

- `none`
- `content-only`
- `geometry`

That is the same deeper capability the engine already proved in its actor-driven experiments.

## Lifecycle Semantics

The public lifecycle should match user perception, not engine settlement jargon.

- `onLoad`
  once, before layout
- `onReady`
  once, the first time the document becomes ready
- `onChanged`
  later, when content or structure changed
- `onRefresh`
  later, when the realized document refreshed

This means the engine may internally settle many times, but the user does not need to treat every later settle as another `onReady`.

## Series 1 Scope

Series 1 is specifically about dynamic document content manipulation.

Its strongest structures are:

- events
- messages

These are not secondary conveniences.
They are the primary paradigm of the scripting model for this release line.

Series 1 intentionally excludes:

- page scripting
- semantic convenience helpers tied to specific document domains
- user-managed replay concepts
- formal persistent script state systems
- animation and continuous world interaction

That discipline is deliberate.
The scripting layer should evolve in controlled series, each serving a distinct purpose.

## Authoring Envelope

Methods are authored in YAML front matter.
The document body remains JSON.

This is owned by the engine itself, not by the CLI.

Example:

```yaml
---
methods:
  onLoad(): |
    setContent("greeting", "Hello, world!")
---
{
  "documentVersion": "1.1",
  "layout": {
    "pageSize": "LETTER",
    "margins": { "top": 72, "right": 72, "bottom": 72, "left": 72 },
    "fontFamily": "Times New Roman",
    "fontSize": 20,
    "lineHeight": 1.4
  },
  "styles": {},
  "elements": [
    {
      "type": "p",
      "name": "greeting",
      "content": "Waiting for script..."
    }
  ]
}
```

## Current Stage

The fixture lane has been intentionally reset.

The new plan is:

1. establish the clean public scripting surface
2. prove it with a minimal Hello World
3. evolve it gradually from there

That is preferable to carrying a large legacy comparison corpus while the public API is still being renamed and reshaped.

## Runtime Composition Note

There is now a separate note tracking the architectural gap between:

- authored document structure
- live runtime actor composition

See [SCRIPTING-RUNTIME-COMPOSITION.md](/c:/Users/cosmic/Projects/vmprint/documents/SCRIPTING-RUNTIME-COMPOSITION.md).
