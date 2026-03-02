# vmprint CLI

_The JSON → PDF command-line interface for vmprint._

The CLI is more than a convenience wrapper. It serves four distinct roles, and understanding them clarifies what the tool is actually for.

## Development companion

When working on the layout engine — adding a feature, fixing a rendering bug, tuning typography — you need to run real documents through the pipeline and see the result immediately. The CLI gives you that loop without any build step:

```bash
pnpm --filter @vmprint/cli run dev -- --input document.json --output out.pdf
```

Change engine code. Re-run. Inspect the PDF. The `--conditions tsx` dev mode loads everything — engine, context, font manager — from TypeScript source directly. `--profile-layout` measures and prints the layout pipeline duration, which is useful when evaluating the performance impact of engine changes.

## Experiment bench

The `--context` and `--font-manager` flags accept any JS module that exports a default class implementing the relevant interface. Testing a new rendering context or font manager against real documents requires exactly one flag — no integration scaffolding, no test harness:

```bash
vmprint --input document.json --output out.pdf --context ./my-context.js
vmprint --input document.json --output out.pdf --font-manager ./my-font-manager.js
```

The module is loaded with `import()` at runtime. You can develop and iterate on a context or font manager entirely through the CLI before integrating it anywhere else.

## Reference design

The CLI is approximately 225 lines of TypeScript. It demonstrates the complete, correct pattern for integrating vmprint: load a document, resolve paths, configure the engine runtime, wait for fonts, paginate, render, handle the output stream. If you're embedding vmprint into a larger application, the CLI source is the clearest available example of how to do it.

## Production batch processing

The CLI works as a production pipeline. Write a driver script that generates `DocumentInput` JSON and shells out to `vmprint`, or use the `--render-from-layout` flag to separate the layout and rendering passes across processes or machines:

- Run layout on CPU-bound infrastructure and save the layout stream.
- Render from the saved stream on separate workers — in parallel, or with different contexts.
- Cache layout results and re-render without re-running the layout pass when only the output format changes.

---

## Key Capabilities

### IR dump — the document before layout

```bash
vmprint --input document.json --output out.pdf --dump-ir
# Writes: out.ir.json
```

`--dump-ir` writes the canonical `DocumentIR` — the resolved, normalized document representation — before any layout occurs. Font references are resolved to actual file paths. Relative image paths are made absolute. Configuration is normalized.

This is the pre-layout checkpoint. If a document renders incorrectly, inspecting the IR is the right first step: verify that the document parsed and resolved the way you expected before the layout engine ever touches it. It is also the right artifact for tooling that needs to inspect or transform documents before layout — the IR is stable, typed, and fully self-contained.

### Layout stream — the output of layout, before rendering

```bash
vmprint --input document.json --output out.pdf --emit-layout
# Writes: out.layout.json
```

`--emit-layout` writes the full `Page[]` as annotated JSON after layout completes and before rendering begins. Each page contains every box, its absolute position, its type, its text content, and glyph-level positioning data.

The layout stream is serializable, diffable, and re-renderable. It is the basis of vmprint's own regression test infrastructure — snapshot it, change something, diff it. `--omit-glyphs` drops per-character positioning data for smaller output; `--quantize` rounds coordinates to three decimal places for stable diffs.

### Render from layout — skip the layout pass entirely

```bash
vmprint --render-from-layout out.layout.json --output out.pdf
```

`--render-from-layout` bypasses the layout engine and renders directly from a saved layout stream. This separates the two pipeline stages physically: layout once, render many times; cache layout results server-side and re-render on demand; move rendering to a different process, machine, or runtime.

### Overlay system

```bash
vmprint --input document.json --output out.pdf --overlay ./watermark.js
```

The overlay system lets you draw before and after page content without touching the document. If `--overlay` is omitted, the CLI looks for a sidecar file automatically: if the input is `document.json`, it checks for `document.overlay.mjs`, `.js`, `.cjs`, or `.ts` alongside the input and loads it silently if found.

The overlay module exports an object with a `backdrop()` method, an `overlay()` method, or both. Both receive the page geometry and the full box tree from the layout pass.

```js
// document.overlay.mjs — loaded automatically alongside document.json
export default {
    overlay(page, ctx) {
        ctx.save();
        ctx.opacity(0.07);
        ctx.fillColor('#000000');
        ctx.font('Helvetica', 64);
        ctx.translate(page.width / 2, page.height / 2);
        ctx.rotate(-45);
        ctx.text('DRAFT', -100, -32);
        ctx.restore();
    },
};
```

---

## What Ships Bundled

The CLI ships with `PdfContext` and `LocalFontManager` as defaults. Both can be replaced via `--context` and `--font-manager` without rebuilding or forking anything.

Custom context and font manager classes must be the default export of their module and implement the interfaces from `@vmprint/contracts`. See the `@vmprint/contracts` package for the interface contracts and implementation guides.

---

See [QUICKSTART.md](QUICKSTART.md) for install instructions and the full options reference.
