# VPX Architecture

This document defines the architectural model for `VPX` in VMPrint.

`VPX` is the platform term for an engine-attached extension module that realizes higher-order document constructs without turning them into core AST or engine primitives.

The short version:

- a `VPX` is attached by the host, much like other host-provided capabilities
- a `VPX` is invoked through a dedicated template placeholder
- placeholder properties are ordinary JSON
- a `VPX` does not become a packager or actor species
- a `VPX` always resolves to ordinary AST blocks

This document defines the platform shape. Feature-specific documents such as TOC build on top of it.

---

## 1. Problem

VMPrint needs a way to support rich document features such as TOC without bloating:

- the core AST
- the engine runtime
- the packager model

Historically, there were two unsatisfying extremes:

- make the feature engine-native
- push the whole problem onto transmuters

Neither is a good fit.

Engine-native features make the AST and runtime absorb too much domain logic. Pure transmuters are too weak for features that need engine facts or staged participation in document realization.

`VPX` is the middle path.

---

## 2. What a VPX Is

A `VPX` is a host-attached extension capability.

It is closer to a bundled platform module than to:

- a one-shot preprocessor
- a packager
- a free-form runtime plugin system

The host is responsible for attaching `VPX`s to the engine in the same broad family of setup concerns as contexts, font managers, and other host-provided capabilities.

A `VPX` may be supplied in either form:

- loaded from a file
- declared directly in host application code

For example:

- the standard library may ship a TOC `VPX` as a file-backed module
- an application may declare a custom corporate-report `VPX` directly in code

---

## 3. What a VPX Is Not

To keep the model disciplined, several boundaries are explicit.

### 3.1 Not a Packager

A `VPX` does not become a new packager category.

It does not measure itself, split itself, or participate in layout as a runtime content actor. Those responsibilities remain with ordinary AST content after expansion.

### 3.2 Not a New AST Primitive Category

A `VPX` does not justify adding a feature-specific public AST primitive such as `toc`.

The public AST stays small. It only carries:

- ordinary content
- template placeholders

### 3.3 Not a General-Purpose Host Mutation Hook

`VPX` is intentionally narrower than a broad plugin platform. Its purpose is to realize placeholders into document content, not to become an unrestricted engine scripting environment.

---

## 4. Invocation Model

`VPX`s are invoked through placeholders.

A placeholder is represented directly in the AST. The engine does not need or care about any separate authoring sugar for it.

Example:

```json
{
  "type": "vpx",
  "name": "TOC",
  "props": {
    "variant": "novel"
  }
}
```

This is the canonical form.

---

## 5. Placeholder Contract

The minimum placeholder contract is:

```ts
interface VpxElement {
  type: "vpx";
  name: string;
  props?: Record<string, unknown>;
}
```

The important properties are:

- `name`
  This identifies which `VPX` should claim the placeholder.

- `props`
  This is ordinary JSON. No custom mini-language should be introduced here.

Feature-specific documents may constrain `props` further. For example, the TOC `VPX` defines its own TOC-specific property schema.

---

## 6. Resolution Model

When the engine encounters a placeholder:

1. it identifies the placeholder name
2. it looks for an attached `VPX` that claims that name
3. it passes the placeholder and allowed engine-facing services to the `VPX`
4. the `VPX` resolves the placeholder into ordinary AST blocks
5. those resulting AST blocks continue through the normal engine pipeline

If no `VPX` claims the placeholder, resolution should fail clearly rather than silently disappear.

That failure behavior should be explicit and deterministic.

---

## 7. Output Contract

The output of a `VPX` is always AST.

More specifically, a `VPX` resolves into ordinary block content suitable for the existing engine pipeline.

Conceptually:

```ts
type VpxResult = Element[];
```

The exact element set returned depends on the feature, but the key rule is stable:

- the output is normal AST
- the output is not a special runtime object
- the output is not a custom packager payload

This preserves the existing layout model and keeps `VPX` as a content-generation layer rather than a new execution species inside the runtime.

---

## 8. Host Attachment Model

The host application owns `VPX` attachment.

This mirrors how the host already provides major runtime-adjacent capabilities such as rendering contexts and font sources.

The host should be able to:

- register bundled standard-library `VPX`s
- register custom application `VPX`s
- enable or disable specific `VPX`s for a given run

That means hosts such as Draft2Final can decide:

- which standard modules are available by default
- which domain-specific modules are added
- whether a given environment is "standard library only" or extended

---

## 9. File-Backed and Code-Backed VPXs

`VPX`s should be installable from more than one source.

### 9.1 File-Backed

A `VPX` may live in a file and be loaded by the host.

This is the expected shape for:

- bundled standard-library modules
- reusable third-party modules
- distributable domain packages

### 9.2 Code-Backed

A host may also declare a `VPX` directly in application code.

This is the expected shape for:

- project-local customization
- application-specific behavior
- private modules not intended for distribution

The engine should not care which source the `VPX` came from, only that it satisfies the registration contract.

---

## 10. Engine-Facing Capability Surface

A `VPX` is engine-attached, which means it may require some engine-facing surface.

That surface should be constrained.

At minimum, the engine will eventually need to answer questions like:

- what placeholder is being resolved
- what props were declared
- what settled document facts are available
- whether the `VPX` is running pre-simulation or post-settlement

This document does not finalize that API. It only establishes the principle:

- a `VPX` may interact with the engine programmatically
- but only through an explicit, narrow capability surface

This keeps `VPX` powerful enough for features like TOC without turning it into unrestricted internal runtime scripting.

---

## 11. Staging

Some `VPX`s may be resolvable immediately. Others may need settled document facts.

So the architecture must allow staged realization.

Typical stages may include:

- pre-simulation
- post-settlement
- controlled replay or resettlement if the inserted content changes pagination

This document does not yet define the exact lifecycle callbacks or replay rules. It only establishes that `VPX` is allowed to live alongside the engine through the realization process rather than being limited to a one-shot pre-expansion pass.

---

## 12. Relationship to Transmuters

`VPX` does not replace transmuters. It narrows and clarifies their role.

Transmuters remain responsible for:

- parsing source formats
- lowering source syntax into VMPrint AST
- emitting template placeholders where appropriate

`VPX`s become responsible for:

- claiming placeholders
- interpreting placeholder props
- interacting with the engine through approved surfaces
- expanding placeholders into ordinary AST

So the new model is:

- transmuters mark invocation points
- `VPX`s realize higher-order constructs

---

## 13. Relationship to Standard Library Features

The VMPrint standard library may ship bundled `VPX`s.

This is the intended home for features that are:

- common enough to deserve turnkey support
- too rich or domain-specific to belong in the core AST

TOC is the first obvious example.

This does not imply that all adjacent features belong inside one giant `VPX`. Separate concerns should remain separate modules. For example:

- TOC should be one `VPX`
- List of Figures should be another supplementary component
- List of Tables should be another supplementary component

They may share conventions or helper infrastructure, but they should not be collapsed into one omnibus surface by default.

---

## 14. Minimal Conceptual Interface

Without freezing final implementation details too early, the conceptual shape looks like this:

```ts
interface Vpx {
  name: string;
  canResolve(tagName: string): boolean;
  resolve(tag: VpxElement, context: unknown): Element[];
}
```

This is not the final API. It simply captures the architectural intent:

- the `VPX` identifies itself
- it claims placeholders by name
- it resolves a placeholder to AST

Future work can refine:

- registration
- lifecycle stages
- async behavior if needed
- replay participation
- the exact shape of the context object

---

## 15. Non-Goals

This document does not yet define:

- the final registration API
- the final host loading mechanism
- the final engine capability surface
- the final staging lifecycle
- the exact unresolved-placeholder error shape
- the full public AST reference entry for `vpx`

It only establishes the core model:

- `VPX` is a host-attached extension capability
- placeholders are the invocation mechanism
- props are ordinary JSON
- a `VPX` resolves to ordinary AST blocks
- a `VPX` is not a packager
