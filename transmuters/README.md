# VMPrint Transmuters

> 🚀 **Part of the [VMPrint Ecosystem](https://github.com/cosmiciron/vmprint)**

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
| `markdown-core/` | `@vmprint/markdown-core` | Shared Markdown → `DocumentInput` compiler core |
| `mkd-mkd/` | `@vmprint/mkd-mkd` | Markdown → `DocumentInput` |
| `mkd-academic/` | `@vmprint/mkd-academic` | Markdown → `DocumentInput` (academic defaults) |
| `mkd-literature/` | `@vmprint/mkd-literature` | Markdown → `DocumentInput` (literature defaults) |
| `mkd-manuscript/` | `@vmprint/mkd-manuscript` | Markdown → `DocumentInput` (manuscript defaults) |
| `mkd-screenplay/` | `@vmprint/mkd-screenplay` | Markdown → `DocumentInput` (screenplay defaults) |

## Relationship to draft2final

`draft2final` is now a thin, transmuter-first orchestrator. It selects a transmuter, loads user-editable config defaults, resolves optional themes, and then renders either PDF or AST JSON output.

Transmuters remain the lower-level primitives: `source text` in, `DocumentInput` AST out. They are where source-format semantics and default conventions live. This keeps heavy regression coverage at the transmuter level while the CLI stays lightweight.

## Local dev loop

For rapid local testing of a transmuter plus theme/config YAML, use the workspace dev CLI:

```bash
npm run dev:transmute -- sample.md --as mkd-mkd --theme ./theme.yaml --out ./sample.pdf
```

Or point directly at a transmuter source module:

```bash
npm run dev:transmute -- sample.md --transmuter ./mkd-mkd/src/index.ts --out ./sample.json
```

## Adding a new transmuter

Shared transmuter contract types live in [`@vmprint/contracts`](https://www.npmjs.com/package/@vmprint/contracts).

A transmuter should satisfy the shared `Transmuter<Input, Output, Options>` contract and may also export a convenience function:

```typescript
interface Transmuter<Input, Output, Options> {
  transmute(source: Input, options?: Options): Output;
}
```

It should have no runtime dependency on `@vmprint/engine` and no file-system access. Themes and config are passed as strings or plain objects by the caller.
