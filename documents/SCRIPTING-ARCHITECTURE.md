# Scripting Architecture

This document defines the near-term programmable behavior model for VMPrint.

It supersedes the earlier focus on `VPX` as the immediate implementation path. The `VPX` and TOC design notes remain useful backgrounders, but the practical next step is a simpler, more approachable scripting layer.

The short version:

- the real problem is not TOC itself
- the real problem is programmatic document behavior
- VMPrint should expose that behavior through event handlers
- handlers should be easy to declare in document JSON
- method bodies should live in a friendly authoring envelope such as YAML front matter
- the engine should route and execute those handlers through modular collaborators
- the engine itself should own the authored-text parsing contract for that format

---

## 1. Why This Exists

This effort began with TOC, but TOC turned out to be only the first visible symptom of a broader problem.

The core issue was never:

- the AST cannot describe a nicely formatted TOC

The real issue was:

- some content cannot be created declaratively up front
- it requires programmatic control tied to document realization

Examples include:

- collecting headings after layout
- reading settled page facts
- assembling derived content
- replacing or augmenting content at the correct position in flow

That is the class of problem this document addresses.

---

## 2. Product Direction

VMPrint should not feel like a pile of powerful machine parts that only advanced consumers can assemble into something useful.

Developers need:

- a simple AST
- a simple programmable behavior layer
- an immediate visual payoff

That means the near-term priority is not "ship every built-in feature."

It is:

- make the engine programmable in a way that is easy to grasp
- let developers build interesting dynamic behaviors quickly
- prove the platform through that capability

TOC is still an important target, but as a proof-of-power use case rather than the first thing that must be fully productized.

---

## 3. Background: Why We Are Setting VPX Aside

The earlier `VPX` work was valuable because it clarified several things:

- higher-order document capabilities should not bloat the core AST
- some features need runtime knowledge
- host-attached extension capability is a useful idea

However, `VPX` as the immediate surface still asks too much of developers:

- create modules
- register them with the host
- think in terms of extension plumbing

That is too much friction for the first success experience.

So for now:

- the `VPX` and TOC notes are background documents
- the current implementation direction is document scripting

If desired, future `VPX` concepts may later be reinterpreted as packaged scripting behaviors or standard-library modules built on top of the scripting system.

---

## 4. Core Model

The scripting model should follow a simple event-handler pattern inspired by the original Visual Basic model:

- document-level event handlers
- element-level event handlers
- named methods implemented separately

This is intentionally not modeled after HTML plus JavaScript.

The goal is:

- explicit event binding
- low conceptual stress
- easy discoverability
- no need to think about plugin contracts just to get started

---

## 5. Event Declaration

### 5.1 Document-Level Events

The long-term model may include several global lifecycle events.

The document-level events currently implemented are:

- `onBeforeLayout`
- `onAfterSettle`

Future candidates include:

- `onDocumentStart`
- `onDocumentComplete`

Example:

```json
{
  "onAfterSettle": "buildToc"
}
```

### 5.2 Element-Level Events

Elements may declare handlers through their properties.

The element-level event currently implemented is:

- `onResolve`

Future candidates include:

- `onCreate`
- `onUpdate`
- `onSettled`

Example:

```json
{
  "type": "p",
  "content": "",
  "properties": {
    "sourceId": "main-toc",
    "onResolve": "buildToc"
  }
}
```

The exact event set can grow over time. The scripting model itself should remain stable while capabilities and available events expand.

---

## 6. Method Binding

Handlers should point to methods by name.

Example:

```json
{
  "onAfterSettle": "buildToc"
}
```

This is better than embedding raw code strings inside arbitrary JSON properties.

The method implementation lives elsewhere in the document package, not inline at every call site.

This keeps:

- event declarations simple
- behavior discoverable
- the document easier to read

---

## 7. Method Authoring Format

Raw JavaScript embedded directly inside JSON strings is too fragile.

It is easy to break with:

- mismatched quotes
- escaping noise
- multiline formatting problems

So the recommended authoring model is:

- event declarations in JSON
- method bodies in a friendlier envelope
- that authored envelope parsed by the engine itself, not by a host-specific wrapper

The preferred first format is YAML front matter using block scalars.

Example:

```yaml
---
methods:
  buildToc: |
    const headings = vm.report.getHeadings();
    const items = headings.map(h => ({
      type: "p",
      content: `${h.heading} ${h.pageIndex + 1}`
    }));
    vm.doc.replace("main-toc", items);
    vm.requestReplay();
---
```

This gives authors a sane way to write code while keeping the runtime model simple.

The boundary matters:

- the CLI may read source text from disk
- but the engine must own the parsing of YAML front matter plus JSON body
- otherwise the engine becomes dependent on one host environment and loses its self-sustained nature

### 7.1 Current Authored Shape

The currently implemented authored shape is:

1. optional YAML front matter
2. followed by a JSON document body

The front matter is currently used primarily for `methods`.

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
  "layout": {
    "pageSize": { "width": 320, "height": 220 },
    "margins": { "top": 20, "right": 20, "bottom": 20, "left": 20 },
    "fontFamily": "Arimo",
    "fontSize": 12,
    "lineHeight": 1.2
  },
  "fonts": {
    "regular": "Arimo"
  },
  "styles": {
    "p": { "marginBottom": 8 }
  },
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

The engine merges front-matter methods and JSON body fields into one normalized document contract before validation and layout.

---

## 8. Query and Mutation Model

For scripting to be useful, handlers need a small but powerful document API.

The first scripting surface should support:

- query by id
- query by role
- query by type
- read and write content
- replace nodes
- request replay or resettlement when geometry changes

The surface currently implemented is narrower:

- `vm.doc.get(sourceId)`
- `vm.doc.findByRole(role)`
- `vm.doc.findByType(type)`
- `vm.doc.setContent(sourceId, content)`
- `vm.doc.replace(sourceId, elements)`
- `vm.self.setContent(...)`
- `vm.self.replace(...)`
- `vm.report.getHeadings()`
- `vm.report.getSourcePositions()`
- `vm.requestReplay()`

Insertion helpers such as `insertBefore(...)` and `insertAfter(...)` remain future work.

The engine already tracks much of the identity needed for this through:

- `sourceId`
- `semanticRole`
- element `type`
- settled artifacts such as heading telemetry and source positions

So the first scripting API should wrap existing identity surfaces rather than invent a second identity model.

The practical naming model should be:

- `sourceId` is the first-class element name

This gives the scripting layer something close to the old VB experience of naming elements of interest without new conceptual baggage.

---

## 9. Execution Model

Scripts should execute as named event handlers called by the engine at well-defined lifecycle points.

The engine should drive execution. Scripts should not own the loop.

Conceptually:

1. the document declares event bindings
2. the document package provides named methods
3. the engine reaches a lifecycle moment
4. the matching handler is invoked
5. the handler uses a constrained VM facade
6. the handler may request replay if it changes geometry

The current implementation already routes:

- document-level `onBeforeLayout`
- element-level `onResolve`
- document-level `onAfterSettle`

This works well with the engine as it exists today because:

- the implementation language is already TypeScript/JavaScript-friendly
- the kernel already owns a clock
- packagers already have `update()` capacity where needed

So the missing piece is not raw dynamism. The missing piece is a disciplined execution surface.

---

## 10. Script State and Replay

Script state should not be treated as an external sidecar memory bag.

If scripted behavior participates in document realization, then its mutable state belongs to the same simulation truth model as other active runtime state.

That means the right mental model is not:

- persist everything
- or wipe everything

The right model is:

- include the relevant script-visible state in deterministic runtime state
- capture it in snapshots where appropriate
- restore it on rollback exactly as the world is restored

So when replay occurs, the question is not "does script memory survive?" in the abstract.

The real questions are:

- what checkpoint is being restored
- what script-visible state lies inside snapshot scope
- what invalidation boundary the replay represents

This matches the engine's broader simulation design:

- the world is not blindly reloaded for every change
- refresh behavior is scoped
- active state is restored according to restore-point targeting

For the scripting layer, this implies:

- event-local temporary values disappear after the handler returns
- durable script-visible state must be treated as runtime state, not hidden closure magic
- rollback restores that state according to checkpoint semantics
- geometry-changing scripted behavior participates in the same replay machinery as any other geometry-changing actor behavior

This is also why the scripting system must not become a second runtime bolted onto the engine. It needs to live within the engine's existing deterministic simulation rules.

---

## 11. Update Classification

The scripting layer should align with the engine's three-tier update model.

Scripted behavior should eventually map into one of:

- `none`
- `content-only`
- `geometry`

Where:

- `none` means the handler observed state but requires no change
- `content-only` means rendered content changed without affecting geometry
- `geometry` means spatial extent changed and targeted replay is required

This alignment is important because it allows scripted behavior to participate in the existing engine cost model instead of forcing every script-triggered change into the most expensive response.

In other words, the scripting layer is not inventing a separate reaction model. It is exposing the engine's existing reaction model to programmable behavior.

---

## 12. Which Layer Should Own It

The scripting layer should be implemented through collaborators.

This is the most practical near-term choice because collaborators already:

- hook into session lifecycle moments
- sit at the runtime seam
- are modular
- can be introduced incrementally

So the implementation plan is:

- use one collaborator to route core document and element events
- add further collaborators later for richer scripting capabilities

This gives the best of both worlds:

- a simple stable scripting model for users
- modular staged implementation internally

The user-facing scripting layer should not need to change as collaborators grow. The system simply gains:

- more events
- more available facts
- more helper capabilities

---

## 13. Minimal Success Criterion

The near-term scripting layer is successful when it can implement a TOC without modifying engine internals.

That means a script must be able to:

- identify the placeholder or anchor element
- read settled heading and page facts
- generate ordinary AST content
- replace the anchor content
- request replay if needed

If the scripting model can do that cleanly, it is likely already powerful enough for many other derived-content features.

So TOC remains an important benchmark, but not the first thing to implement as a hardcoded feature.

---

## 14. Example Shape

A scripted document package may look like this:

```yaml
---
methods:
  buildToc: |
    const headings = vm.report.getHeadings();
    const items = headings.map(h => ({
      type: "p",
      content: `${h.heading} ${h.pageIndex + 1}`
    }));
    vm.doc.replace("main-toc", items);
    vm.requestReplay();
---
```

```json
{
  "documentVersion": "1.1",
  "onAfterSettle": "buildToc",
  "elements": [
    {
      "type": "p",
      "content": "",
      "properties": {
        "sourceId": "main-toc"
      }
    }
  ]
}
```

This now reflects the actual authored direction rather than a purely hypothetical one. The key point is the separation:

- event bindings stay simple
- method code lives in a friendly authoring format
- handlers manipulate ordinary AST through a constrained API

---

## 15. Non-Goals

This document does not yet fully define:

- the full scripting API surface beyond the current minimal set
- the exact collaborator set as the system grows
- the full long-term event catalog and ordering
- the exact replay request contract beyond the current bounded replay path
- the exact snapshot scope of script-visible state
- sandboxing and security rules
- whether scripts are synchronous only in v1

It does establish the architectural direction clearly:

- the next layer for VMPrint is scripting, not TOC-first implementation
- event handlers are the right mental model
- collaborators are the right implementation seam
- YAML front matter plus JSON body is the current authored shape
- the engine owns parsing of that authored shape
- TOC is the benchmark use case for deciding when the first version is good enough
