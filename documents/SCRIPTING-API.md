# VMPrint Scripting API

This document formalizes the public API for VMPrint Scripting Series 1.

Series 1 is about one thing:

- dynamic document content manipulation

It is intentionally not about page scripting, animation, rich world interaction, or open-ended runtime state systems.

## Core Model

Series 1 is built around two supporting structures:

- Events
- Messages

Together they form the basic paradigm of the scripting system.

- events tell the script what happened
- messages let document participants coordinate directly

Series 1 is therefore not procedural-first.
A scripter can still write procedural code inside a handler, but the public model is organized around:

- receivers
- events
- messages
- content mutation

## Authoring Format

Script code lives in YAML front matter.
The document body remains ordinary JSON.

```yaml
---
TITLE: "Hello World"

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

The engine parses this front matter itself. This is not delegated to the CLI.

## Implied Scopes

Series 1 relies heavily on implied scope.

### Document Scope

The top-level scope is the document scope.

Its representative object is:

- `doc`

Top-level handlers belong to the document by default.
They do not need an explicit `doc_` prefix.

Examples:

- `onLoad()`
- `onReady()`
- `onChanged()`
- `onRefresh()`
- `onMessage(from, msg)`

So this:

```yaml
methods:
  onLoad(): |
    append({
      type: "p",
      content: "Loaded."
    })
```

means the handler belongs to the document and `append(...)` applies to the document.

### Element Scope

Named element handlers are bound by convention:

- `<elementName>_onCreate()`
- `<elementName>_onChanged()`
- `<elementName>_onMessage(from, msg)`

Inside those handlers, `self` is that element.

So:

```yaml
methods:
  summary_onMessage(from, msg): |
    append({
      type: "p",
      content: "Updated from message."
    })
```

means the new content is appended to `summary`, not to the document.

## Variable Scope

Series 1 defines scope in scripting terms, not engine terms.

### Top-Level Variables

Variables declared in YAML front matter outside function bodies belong to the document scope.

They are implicitly document variables.

They may be accessed:

- implicitly by name
- explicitly through `doc.vars.<NAME>`

Example:

```yaml
---
TITLE: "Hello World"
ACCENT: "#8A5A2B"

methods:
  onLoad(): |
    append({
      type: "p",
      content: TITLE
    })
---
```

By convention, authors may use `ALL_CAPS` for these bindings, but that is only a convention.

### Handler-Local Variables

Variables declared inside a handler are local to that handler call only.

Example:

```js
onReady(): |
  const titles = elementsByType("h1")
  const count = titles.length
```

### Not Supported In Series 1

Series 1 does not formally support:

- free-floating script globals
- persistent local variables
- shared mutable state bags beyond document-scoped bindings

That limitation is intentional. Series 1 is about dynamic content manipulation, not open-ended runtime state design.

## Identity

Use top-level `name` as the public identity for elements.

Example:

```json
{
  "type": "p",
  "name": "summary",
  "content": ""
}
```

Internally the engine may map this into its own identity system.
That is not part of the public scripting language.

## Handlers

### Document Handlers

Series 1 document handlers:

- `onLoad()`
- `onReady()`
- `onChanged()`
- `onRefresh()`
- `onMessage(from, msg)`

These handlers are declared directly at top level.
They are document handlers by implication, not by a `doc_` naming prefix.

Lifecycle meaning:

- `onLoad()`
  Called once before layout.
- `onReady()`
  Called once, the first time the document becomes ready.
- `onChanged()`
  Called later when the document content or structure changed.
- `onRefresh()`
  Called later when the realized document refreshed.
- `onMessage(from, msg)`
  Called when the document receives a message.

This distinction is intentional. The public lifecycle follows user perception, not internal settlement terminology.

### Element Handlers

Series 1 element handlers:

- `<name>_onCreate()`
- `<name>_onChanged()`
- `<name>_onMessage(from, msg)`

The current receiver is always available as:

- `self`

Event parameters are only for event payload. The receiver itself is not passed positionally.

## Public Objects

Series 1 currently exposes these primary objects:

- `doc`
- `self`

### `doc`

The document participant.

Current document members:

- `doc.vars`
- `doc.getPageCount()`

### `self`

The current receiver.

Typical element-facing members:

- `self.name`
- `self.type`
- `self.content`
- `self.replace(...)`
- `self.append(...)`
- `self.prepend(...)`
- `self.setContent(...)`
- `self.sendMessage(recipient, msg)`

For document handlers, `self` is the document.

## Global Helpers

These helpers are available directly inside handlers.

- `element(name)`
- `elementsByType(type)`
- `sendMessage(recipient, msg)`
- `setContent(target, value)`
- `replace(value)`
- `append(value)`
- `prepend(value)`
- `replaceElement(target, value)`
- `insertBefore(target, value)`
- `insertAfter(target, value)`
- `deleteElement(target)`

### Helper Meaning

`replace(...)` is receiver-oriented.

It means:

- replace the current receiver with entirely new AST

`append(...)` and `prepend(...)` are receiver-oriented.

They mean:

- append/prepend to the current receiver

So:

- inside `summary_onMessage(...)`, `replace(...)` replaces `summary`
- inside `onLoad()`, they affect the document
- inside `summary_onMessage(...)`, they affect `summary`

Explicit targeted forms are also valid through the receiver object, for example:

- `element("summary").replace(...)`
- `element("summary").append(...)`
- `element("summary").prepend(...)`

If later Series need additional targeted helpers, they can be added explicitly. Series 1 should prefer the implicit receiver model first.

### Value Shape

`append(...)` and `prepend(...)` may accept:

- a single element
- a block of AST

The runtime is responsible for normalizing that input.

`replace(...)` accepts the same shapes.

This is the preferred structural mutation primitive for compound or ambiguous elements, where `setContent(...)` may not have a clear meaning.

### Recipient / Target Resolution

A target or recipient can be:

- an element name string
- a resolved element reference
- `doc`

Examples:

```js
sendMessage("summary", { subject: "refresh" })
sendMessage(doc, { subject: "refreshAll" })

element("chapterTitle").append({
  type: "p",
  content: "Act I"
})
```

## Queries

Series 1 keeps queries intentionally small and generic.

Supported now:

- `element(name)`
- `elementsByType(type)`

This is deliberate. Series 1 should not grow into a catalog of hard-coded document semantics.

## Messages

Sending:

```js
sendMessage("summary", {
  subject: "refresh",
  payload: {
    total: 3
  }
})
```

Receiving:

```js
summary_onMessage(from, msg)
```

Document receiving:

```js
onMessage(from, msg)
```

`msg` is the full message object, not just raw payload.

Current expected shape:

- `msg.subject`
- `msg.payload`

`from` is the sender reference.

When the document sends a message, `from.name` is `doc`.

## Update Model

The public scripting model does not ask the author to think about replay.

Authors should think in terms of:

- changing content
- reacting to events
- reacting to messages

The engine is responsible for mapping those changes onto its native update model:

- `none`
- `content-only`
- `geometry`

Manual refresh control is not part of the intended public Series 1 surface.

## Examples

### Minimal Hello World

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

### Message-Driven Element Growth

```yaml
---
methods:
  greeter_onCreate(): |
    sendMessage("messageTarget", {
      subject: "greet",
      payload: {
        text: "Hello from another element!"
      }
    })

  messageTarget_onMessage(from, msg): |
    if (from.name !== "greeter") return
    if (msg.subject !== "greet") return

    append({
      type: "p",
      content: msg.payload.text
    })
---
```

## Notes

- top-level `name` is the preferred authored identity
- `page` is not part of the public Series 1 scripting surface
- Events and Messages are the central paradigm of Series 1
- helper additions should stay generic, small, and user-facing
