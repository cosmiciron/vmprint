# Scripting API

This document is the living reference for VMPrint's current scripting surface.

Use [SCRIPTING-ARCHITECTURE.md](c:\Users\cosmic\Projects\vmprint\documents\SCRIPTING-ARCHITECTURE.md) for the why and the overall direction.
Use this document for the actual shape of the API as it exists today.

The tone of this document is intentionally practical:

- what is already implemented
- what is friendly and ready to use
- what still feels provisional

---

## 1. Overall Evaluation

The current scripting API is good enough to document and grow in public.

Why it is in decent shape already:

- the main verbs are simple and readable
- the current event model is small
- the API avoids most internal runtime jargon
- the scripting experience is already capable of real structural generation

Where it is still biased:

- it is currently strongest at document-tree mutation
- it is currently weakest at reading richer settled facts
- replay is still a coarse tool
- identity still leans on engine-facing names like `sourceId` and `semanticRole`

So the current conclusion is:

- yes, the API is friendly enough to document
- no, it is not a finished or fully balanced surface yet

That is fine. A living reference is exactly the right next step.

---

## 2. Authoring Shape

The current authored format is:

1. optional YAML front matter
2. followed by a JSON document body

The front matter is primarily used for `methods`.

Example:

```text
---
methods:
  helloWorld: |
    vm.doc.setContent('greeting', 'Hello, world!');
---
{
  "documentVersion": "1.1",
  "onBeforeLayout": "helloWorld",
  "elements": [
    {
      "type": "p",
      "content": "Pending greeting",
      "properties": {
        "sourceId": "greeting"
      }
    }
  ]
}
```

The engine owns this parsing contract.

---

## 3. Event Surface

### 3.1 Document Events

Currently implemented:

- `onBeforeLayout`
- `onAfterSettle`

Example:

```json
{
  "onAfterSettle": "composeShowcase"
}
```

### 3.2 Element Events

Currently implemented:

- `properties.onResolve`

Example:

```json
{
  "type": "p",
  "content": "Pending greeting",
  "properties": {
    "sourceId": "greeting",
    "onResolve": "resolveGreeting"
  }
}
```

### 3.3 Event Naming Assessment

The event names are mostly readable.

The only one that still feels slightly engine-ish is:

- `onResolve`

It is serviceable for now, but it may eventually want a more user-facing name if a clearer lifecycle vocabulary emerges.

---

## 4. Method Table

Methods are declared by name in YAML front matter:

```yaml
methods:
  buildOutline: |
    const headings = vm.report.getHeadings();
    // ...
```

Bindings in the document point to those names:

```json
{
  "onAfterSettle": "buildOutline"
}
```

This is one of the friendliest parts of the current design. It keeps:

- event bindings small
- code centralized
- the document readable

---

## 5. The `vm` Object

Every handler currently receives one argument:

- `vm`

The surface is intentionally small.

### 5.1 `vm.doc`

Current methods:

- `vm.doc.get(sourceId)`
- `vm.doc.findByRole(role)`
- `vm.doc.findByType(type)`
- `vm.doc.setContent(sourceId, content)`
- `vm.doc.replace(sourceId, elements)`
- `vm.doc.insertBefore(sourceId, elements)`
- `vm.doc.insertAfter(sourceId, elements)`
- `vm.doc.remove(sourceId)`

### 5.2 `vm.self`

Available only for element-level handlers.

Current fields and methods:

- `vm.self.sourceId`
- `vm.self.type`
- `vm.self.role`
- `vm.self.setContent(content)`
- `vm.self.replace(elements)`

### 5.3 `vm.report`

Available in post-settlement handlers.

Current methods:

- `vm.report.getPageCount()`
- `vm.report.getHeadings()`
- `vm.report.getSourcePositions()`

### 5.4 Replay

Current method:

- `vm.requestReplay()`

This is the current coarse resettlement request.

---

## 6. Current API Bias

The current surface is not random. It has a clear center of gravity.

It is strongest at:

- finding nodes
- replacing nodes
- inserting generated blocks
- removing generated blocks
- asking for another pass

That means it is currently excellent for:

- placeholders
- generated summaries
- outlines
- navigation previews
- proof-of-power structural demos

It is weaker at:

- rich fact inspection beyond headings and source positions
- localized replay or refresh semantics
- style/property mutation helpers
- node creation convenience helpers
- authored-versus-generated distinction

So the current API is biased toward composition and regeneration, not yet toward introspection and fine-grained control.

That bias is acceptable for the current stage, but it should be acknowledged explicitly.

---

## 7. Naming Assessment

### 7.1 Friendly Names

These names already read well:

- `get`
- `findByRole`
- `findByType`
- `setContent`
- `replace`
- `insertBefore`
- `insertAfter`
- `remove`
- `requestReplay`

These are straightforward and product-friendly.

### 7.2 Names Carrying Engine DNA

These are still slightly internal in flavor:

- `sourceId`
- `semanticRole`
- `onResolve`

They are not terrible, but they do carry older engine terminology.

For now, they are acceptable because:

- `sourceId` functions well as the main element name
- `semanticRole` is understandable enough
- the API around them is still simple

So there is no urgent rename needed yet.

---

## 8. Return Style

The current API uses mutation methods that return booleans.

Examples:

- `vm.doc.setContent(...) -> boolean`
- `vm.doc.replace(...) -> boolean`

This is simple, but slightly low-information.

It tells the script whether something happened, but not:

- why it failed
- what was matched
- how many nodes were affected

That is acceptable for v1, but it is one of the places where the surface may eventually want to mature.

---

## 9. Current Rough Edges

### 9.1 Replay Is Coarse

`vm.requestReplay()` is useful, but broad.

It does not yet express:

- content-only refresh
- geometry-local refresh
- geometry-global refresh

So scripts currently ask for "another pass" rather than declaring a narrower invalidation need.

### 9.2 Report Access Is Narrow

`vm.report` currently exposes only a small slice of settled facts.

That slice is enough for the showcase, but not yet enough for a truly broad programmable document platform.

### 9.3 No Convenience Layer for Common Generated Patterns

Scripts currently create raw AST objects by hand.

That is fine for developers, but over time you may want helpers for common patterns without bloating the core AST.

### 9.4 Element Objects Are Raw

`vm.doc.get(...)` and `find...(...)` return raw element objects.

That is powerful, but it means scripts are touching the same structural vocabulary the engine uses internally.

That is not inherently bad, but it is worth watching as the API grows.

---

## 10. Practical Guidance

If you are writing scripts today:

- use `sourceId` as your primary anchor
- use `semanticRole` for repeated generated families
- prefer `insertBefore` and `insertAfter` when augmenting authored content
- prefer `replace` when filling a placeholder
- keep generated content idempotent
- only call `requestReplay()` when you truly need another settled pass

This matches the way the current showcase fixtures are written.

---

## 11. Current Examples

Reference fixtures:

- [00-hello-world.json](c:\Users\cosmic\Projects\vmprint\engine\tests\fixtures\scripting\00-hello-world.json)
- [01-after-settle-replay.json](c:\Users\cosmic\Projects\vmprint\engine\tests\fixtures\scripting\01-after-settle-replay.json)
- [02-generated-outline.json](c:\Users\cosmic\Projects\vmprint\engine\tests\fixtures\scripting\02-generated-outline.json)
- [03-scripted-insights-panel.json](c:\Users\cosmic\Projects\vmprint\engine\tests\fixtures\scripting\03-scripted-insights-panel.json)
- [04-scripted-showcase.json](c:\Users\cosmic\Projects\vmprint\engine\tests\fixtures\scripting\04-scripted-showcase.json)

These form the current practical progression from simple mutation to replay-sensitive structural generation.

---

## 12. Recommended Next Improvements

The most promising next additions are probably:

- richer `vm.report` helpers
- clearer replay intent over time
- a small convenience layer for common generated-block patterns
- possibly a more user-facing lifecycle name than `onResolve`

The important thing is not to rush breadth.

The current API is strongest because it is still small.

