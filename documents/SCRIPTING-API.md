# VMPrint Scripting API

This document describes the current user-facing scripting surface for VMPrint.

The guiding rule is simple:

- scripts should be written around document intent
- not around engine plumbing

So the public model is built from:

- `doc`
- `page`
- `self`
- event handlers
- messages between elements

It is not built around:

- `vm`
- `report`
- `onResolve`
- manual replay requests

## Status

This API is now the active direction.

It is still early, but the goal is already fixed:

- one scripting model
- object-centered handler naming
- element-friendly helpers
- actor-native behavior underneath

## Authoring Format

Script methods live in YAML front matter.
The document body remains ordinary JSON.

```yaml
---
methods:
  doc_onLoad(): |
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

The engine parses the front matter itself. This is not delegated to the CLI.

## Element Identity

Use top-level `name` as the authored identity for elements.

Example:

```json
{
  "type": "p",
  "name": "summary",
  "content": ""
}
```

Internally the engine still maps this onto its stable source identity machinery.
That internal mapping is not the public scripting concept.

## Handler Naming

Bindings are inferred by convention.
You do not need to put `onXxx: "methodName"` in the JSON for the public model.

Current convention:

- `doc_onLoad()`
- `doc_onReady()`
- `doc_onRefresh()`
- `doc_onDocumentChanged()`
- `<elementName>_onCreate()`
- `<elementName>_onMessage(from, msg)`

Examples:

```yaml
methods:
  doc_onLoad(): |
    setContent("greeting", "Hello, world!")

  summary_onMessage(from, msg): |
    if (msg.subject !== "refresh") return
    self.setContent("Updated")
```

## Receiver Model

Every handler receives its current receiver implicitly as `self`.

That means:

- in `doc_onLoad()`, `self` is the document
- in `summary_onMessage(from, msg)`, `self` is the `summary` element

Event parameters are only for event payload.
The receiver itself is not passed as a positional argument.

## Current Event Surface

Implemented now:

- document:
  - `onLoad`
  - `onReady`
  - `onRefresh`
  - `onDocumentChanged`
- elements:
  - `onCreate`
  - `onMessage`

Planned next:

- page events
- richer element lifecycle events such as split/move/repackage

### Document lifecycle meaning

- `onLoad`
  Called once before layout.
- `onReady`
  Called once, the first time the document becomes ready.
- `onDocumentChanged`
  Called on later cycles when the document content or structure changed.
- `onRefresh`
  Called on later cycles when the realized document refreshes.

This distinction is intentional. `onReady` should match user expectation and not re-fire just because the engine internally settles again.

## Current Globals

These names are available directly inside handlers.

### `doc`

The whole document runtime.

Current helpers:

- `doc.findElementByName(name)`
- `doc.findElementsByRole(role)`
- `doc.findElementsByType(type)`
- `doc.getPageCount()`

### `page`

Reserved for page-scoped scripting.

It is not meaningfully populated yet.

### `self`

The current receiver.

Current element helpers:

- `self.name`
- `self.type`
- `self.role`
- `self.content`
- `self.setContent(value)`
- `self.sendMessage(recipient, msg)`

For document handlers, `self` is the document.

## Current Global Helpers

These are available directly in handlers.

- `sendMessage(recipient, msg)`
- `findElementByName(name)`
- `findElementsByRole(role)`
- `findElementsByType(type)`
- `setContent(target, value)`
- `replaceElement(target, elements)`
- `insertElementsBefore(target, elements)`
- `insertElementsAfter(target, elements)`
- `deleteElement(target)`

### Recipient / Target Resolution

The helper target can be:

- an element name string
- a resolved element reference
- `doc`

Examples:

```js
sendMessage("summary", { subject: "refresh" })
sendMessage(doc, { subject: "refreshAll" })

const heading = findElementByName("chapterTitle")
setContent(heading, "Act I")
```

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

`msg` is the full message object, not just raw payload.

Current expected shape:

- `msg.subject`
- `msg.payload`

`from` is the sender reference.

When the document sends the message, `from.name` is `doc`.

## Update Model

The public scripting model does not ask the author to think about replay.

Authors should think in terms of:

- changing content
- reacting to messages
- updating elements

The engine is responsible for mapping those changes onto its native update model:

- `none`
- `content-only`
- `geometry`

Manual refresh control is not the intended public surface.

## Hello World

Current minimal example:

```yaml
---
methods:
  doc_onLoad(): |
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

## Ready Example

```yaml
---
methods:
  doc_onReady(): |
    const majorTitles = doc.findElementsByType("h1")
    const minorTitles = doc.findElementsByType("h2")
    const titleCount = majorTitles.length + minorTitles.length
    const firstTitle = majorTitles[0] || minorTitles[0] || null
    sendMessage("summary", {
      subject: "ready-summary",
      payload: {
        pageCount: doc.getPageCount(),
        titleCount,
        firstTitle: firstTitle ? firstTitle.content : "None"
      }
    })

  summary_onMessage(from, msg): |
    if (!from || from.name !== "doc") return
    if (msg.subject !== "ready-summary") return
    setContent(
      self,
      `Document settled across ${msg.payload.pageCount} page(s).\n\nFirst title: ${msg.payload.firstTitle}.`
    )
---
```

## Notes

- top-level `name` is the preferred authored identity.
- Older explicit JSON bindings and older `vm.*` examples should be treated as legacy/provisional material, not the public direction.
- This document should keep growing as the new scripting surface evolves.
