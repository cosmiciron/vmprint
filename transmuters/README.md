# VMPrint Transmuters

A transmuter converts a source format into VMPrint's native intermediate representation — `DocumentInput` — without touching the layout engine.

## Why transmuters exist

The VMPrint engine speaks exactly one language: `DocumentInput` JSON. This is intentional. The engine has no knowledge of Markdown, DOCX, LaTeX, or any other authoring format. That separation keeps the layout core deterministic and format-agnostic.

Transmuters are the bridge. Each one takes a human-authored source and produces a `DocumentInput` object the engine can ingest directly. They are deliberately kept thin:

- **No file access.** No `fs`, no I/O. Input and output are plain in-memory values.
- **No engine dependency.** Transmuters do not import `@vmprint/engine`. Types are declared locally and kept structurally compatible.
- **Embeddable anywhere.** Browser, Node.js, edge worker, build plugin — the same package works in all of them.

## Naming convention

Directories follow `{source}-{target}` where both sides use short format identifiers:

| Identifier | Meaning |
|---|---|
| `mkd` | Markdown (CommonMark + GFM extensions) |

So `mkd-mkd` is the Markdown → `DocumentInput` transmuter. The second `mkd` here refers not to a different Markdown dialect but to the vmprint IR whose semantic elements (`heading-1`, `paragraph`, `blockquote`, …) mirror the block-level vocabulary of Markdown — it is the natural structural target for markdown source.

## Transmuters in this repo

| Directory | Package | Source |
|---|---|---|
| `mkd-mkd/` | `@vmprint/transmuter-mkd` | Markdown → `DocumentInput` |

## Relationship to draft2final

[draft2final](../draft2final/) is a higher-level authoring pipeline that internally uses transmuters as one step in a larger compilation process (frontmatter resolution, format-specific semantic rules, multi-pass config). Transmuters used standalone are the lower-level primitive: source in, `DocumentInput` out, nothing else.

## Adding a new transmuter

A transmuter is any module that exports a function with the signature:

```typescript
transmute(source: SourceType, options?: TransmuteOptions): DocumentInput
```

It should have no runtime dependency on `@vmprint/engine` and no file-system access. Themes and config are passed as strings or plain objects by the caller.
