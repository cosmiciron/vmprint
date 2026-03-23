# 06. Scripting

VMPrint documents can participate in their own layout lifecycle. Elements can
react to events, query the settled document, and change each other's content
through messages — all without a second rendering pass.

This guide covers the practical authoring model. For the full API contract, see
[SCRIPTING-API.md](../SCRIPTING-API.md).

---

## The authoring format

Script methods live in a YAML front matter block. The document body stays
ordinary JSON.

```yaml
---
methods:
  onLoad(): |
    setContent("greeting", "Hello, VMPrint.")
---
{
  "documentVersion": "1.1",
  "layout": {
    "pageSize": "LETTER",
    "margins": { "top": 72, "right": 72, "bottom": 72, "left": 72 },
    "fontFamily": "Times New Roman",
    "fontSize": 12,
    "lineHeight": 1.45
  },
  "styles": {},
  "elements": [
    {
      "type": "p",
      "name": "greeting",
      "content": "Waiting..."
    }
  ]
}
```

Three things to notice:

- the front matter opens with `---` and closes with `---`
- each method is declared as `methodName(): |` followed by an indented body
- the document body is unchanged — it is still ordinary JSON

The engine parses the front matter itself. No CLI flags or extra files needed.

---

## Naming elements

Scripts address elements by `name`. Give any element you want to script a
top-level `name` field.

```json
{
  "type": "p",
  "name": "summary",
  "content": "Calculating..."
}
```

Use `name` consistently — it is the only identity the scripting layer needs.

---

## Document event handlers

Top-level methods are document handlers by default. No prefix needed.

The four document lifecycle events:

| Handler | When it fires |
|---|---|
| `onLoad()` | Once, before layout begins |
| `onReady()` | Once, when the document first becomes fully settled |
| `onChanged()` | When document content or structure changed after ready |
| `onRefresh()` | When the realized document refreshed after a change |

Use `onLoad()` to set initial content from variables. Use `onReady()` to read
facts that only exist after layout has settled — page count, discovered elements,
and so on.

### Setting initial content on load

```yaml
---
AUTHOR: "Ada Lovelace"
SUBTITLE: "Notes on the Analytical Engine"

methods:
  onLoad(): |
    setContent("byline", AUTHOR)
    setContent("subtitle", SUBTITLE)
---
```

Variables declared in the front matter outside any method are document-scoped.
They are available by name inside any handler.

### Reading settled facts on ready

`onReady` fires after layout has fully settled. By then you can ask the document
things you couldn't know before layout ran.

```yaml
---
methods:
  onReady(): |
    const pages = doc.getPageCount()
    const chapters = elementsByType("h1")
    setContent("colophon",
      `${chapters.length} chapters · ${pages} pages`)
---
```

`doc.getPageCount()` returns the real settled page count — not an estimate.
`elementsByType(type)` returns all elements of that type as they exist in the
settled document.

---

## Element event handlers

An element can handle its own lifecycle events. Name the method using the
element's `name` as a prefix.

```yaml
---
methods:
  banner_onCreate(): |
    setContent("banner", "Document is loading.")

  banner_onChanged(): |
    setContent("banner", "Document content has changed.")
---
```

Inside an element handler, `self` refers to that element. You can read
`self.name`, `self.type`, and `self.content`, and call helpers like
`self.setContent(...)` or `self.append(...)` directly on it.

---

## Messaging between elements

The scripting model is built around two things: events (raised by the engine)
and messages (sent between elements). Messages are how elements coordinate
without needing a central script to orchestrate everything.

Send a message from one element, handle it in another:

```yaml
---
methods:
  sender_onCreate(): |
    sendMessage("display", {
      subject: "update",
      payload: { text: "Sent from the sender element." }
    })

  display_onMessage(from, msg): |
    if (from.name !== "sender") return
    if (msg.subject !== "update") return
    setContent(self, msg.payload.text)
---
```

`sendMessage(recipient, msg)` takes a target name and a message object.
The message object has a `subject` and an optional `payload`.

The receiving handler gets `from` (the sender) and `msg` (the full message).
Check both before acting — an element can receive messages from multiple senders.

---

## Querying elements

Two generic queries are available inside any handler:

```js
element("summary")          // returns the element named "summary", or null
elementsByType("h1")        // returns all elements of type "h1"
```

These are useful in `onReady()` when you want to inspect what the settled
document actually contains.

```yaml
---
methods:
  onReady(): |
    const headings = elementsByType("h1")
    if (headings.length === 0) return
    sendMessage("toc", {
      subject: "populate",
      payload: { titles: headings.map(h => h.content) }
    })

  toc_onMessage(from, msg): |
    if (msg.subject !== "populate") return
    msg.payload.titles.forEach(title => {
      append({ type: "toc-entry", content: title })
    })
---
```

The `toc` element starts empty. After the document settles, it receives the
real heading list and appends an entry for each one.

---

## Structural mutation

Beyond `setContent`, scripts can change the structure of the document.

**`append(element)` / `prepend(element)`** — add content to the current
receiver (or to any named element using `element("name").append(...)`):

```yaml
---
methods:
  notes_onMessage(from, msg): |
    if (msg.subject !== "add-note") return
    append({
      type: "note-item",
      content: msg.payload.text
    })
---
```

**`replace(elements)`** — replace the current receiver with entirely new
content. The old element is removed from the live document; the replacement
takes its place and the document resettles from that point:

```yaml
---
methods:
  onReady(): |
    sendMessage("placeholder", { subject: "build" })

  placeholder_onMessage(from, msg): |
    if (msg.subject !== "build") return
    replace([
      { type: "h2", content: "Generated Section" },
      { type: "p", content: "This replaced the placeholder after layout settled." }
    ])
---
```

**`deleteElement(target)`** — remove a named element entirely:

```yaml
---
methods:
  onReady(): |
    if (doc.getPageCount() === 1) {
      deleteElement("overflow-note")
    }
---
```

All structural helpers operate on live layout participants. The document does
not restart from scratch — settlement resumes from the earliest affected point.

---

## Receiver orientation

Most helpers are receiver-oriented: they act on whoever `self` is at the time.

Inside a document handler (`onLoad`, `onReady`, etc.), `self` is the document.
Inside an element handler (`summary_onMessage`, etc.), `self` is that element.

```yaml
---
methods:
  onLoad(): |
    append({ type: "p", content: "Added to the document." })

  footer_onMessage(from, msg): |
    append({ type: "p", content: "Added to the footer element." })
---
```

The same `append()` call does different things depending on context. When in
doubt, use the explicit form to be unambiguous:

```js
element("footer").append({ type: "p", content: "Explicit target." })
```

---

## A complete example

A document that sets a byline on load, then updates a summary block after
settling with real page and chapter counts:

```yaml
---
AUTHOR: "Ada Lovelace"

methods:
  onLoad(): |
    setContent("byline", AUTHOR)

  onReady(): |
    const chapters = elementsByType("h1")
    sendMessage("summary", {
      subject: "settle",
      payload: {
        chapters: chapters.length,
        pages: doc.getPageCount()
      }
    })

  summary_onMessage(from, msg): |
    if (msg.subject !== "settle") return
    const p = msg.payload
    setContent(self, `${p.chapters} chapters · ${p.pages} pages`)
---
{
  "documentVersion": "1.1",
  "layout": {
    "pageSize": "LETTER",
    "margins": { "top": 72, "right": 72, "bottom": 72, "left": 72 },
    "fontFamily": "Times New Roman",
    "fontSize": 12,
    "lineHeight": 1.45
  },
  "styles": {
    "h1": { "fontSize": 18, "fontWeight": "bold", "marginBottom": 10 },
    "p": { "marginBottom": 8 }
  },
  "elements": [
    { "type": "p", "name": "byline", "content": "" },
    { "type": "p", "name": "summary", "content": "Calculating..." },
    { "type": "h1", "content": "Chapter One" },
    { "type": "p", "content": "Opening paragraph..." },
    { "type": "h1", "content": "Chapter Two" },
    { "type": "p", "content": "Second chapter..." }
  ]
}
```

---

For the full API — all handlers, all helpers, all objects, variable scope rules,
and what this version does not include:

- [SCRIPTING-API.md](../SCRIPTING-API.md)
