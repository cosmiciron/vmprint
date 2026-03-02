# vmprint CLI — Quickstart

## Install

```bash
npm install -g @vmprint/cli
```

## Run from source

Requires the vmprint monorepo. Use `pnpm --filter @vmprint/cli run dev` in place of `vmprint`:

```bash
pnpm --filter @vmprint/cli run dev -- --input document.json --output out.pdf
pnpm --filter @vmprint/cli run dev -- --help
```

## Basic usage

```bash
vmprint --input document.json --output out.pdf
```

## Inspect the pipeline

```bash
# Dump the document IR (pre-layout, normalized and path-resolved)
vmprint --input document.json --output out.pdf --dump-ir
# → writes out.ir.json

# Emit the annotated layout stream (post-layout, pre-render)
vmprint --input document.json --output out.pdf --emit-layout
# → writes out.layout.json

# Render directly from a saved layout stream (skips layout)
vmprint --render-from-layout out.layout.json --output out.pdf
```

## Layout stream options

```bash
# Omit per-glyph positioning data (smaller output)
vmprint --input document.json --output out.pdf --emit-layout --omit-glyphs

# Quantize coordinates to 3 decimal places (stable diffs)
vmprint --input document.json --output out.pdf --emit-layout --quantize
```

## Custom context and font manager

```bash
vmprint --input document.json --output out.pdf --context ./my-context.js
vmprint --input document.json --output out.pdf --font-manager ./my-font-manager.js
```

The module must export the class as the default export and implement the interface from `@vmprint/contracts`:

```js
// my-context.js
import { MyBackend } from 'my-backend';

export default class MyContext {
    addPage() {
        /* ... */
    }
    end() {
        /* ... */
    }
    async registerFont(id, buffer) {
        /* ... */
    }
    // implement the full Context interface from @vmprint/contracts
}
```

## Overlay

```bash
# Explicit overlay script
vmprint --input document.json --output out.pdf --overlay ./watermark.js

# Sidecar auto-detection: if document.overlay.mjs exists alongside document.json, it loads automatically
vmprint --input document.json --output out.pdf
```

## Debug and profiling

```bash
# Embed layout debug boxes in the output
vmprint --input document.json --output out.pdf --debug

# Measure and print layout pipeline duration
vmprint --input document.json --output out.pdf --profile-layout
```

## All options

| Flag                          | Description                                                          |
| ----------------------------- | -------------------------------------------------------------------- |
| `-i, --input <path>`          | Input document JSON                                                  |
| `-o, --output <path>`         | Output PDF path                                                      |
| `--context <path>`            | JS module exporting a custom `Context` class                         |
| `--font-manager <path>`       | JS module exporting a custom `FontManager` class                     |
| `--dump-ir [path]`            | Write canonical document IR JSON (default: `<output>.ir.json`)       |
| `--emit-layout [path]`        | Write annotated layout stream JSON (default: `<output>.layout.json`) |
| `--render-from-layout <path>` | Render from a saved layout stream, bypassing layout                  |
| `--omit-glyphs`               | Exclude glyph positioning data from the layout stream                |
| `--quantize`                  | Quantize layout stream coordinates to 3 decimal places               |
| `-d, --debug`                 | Embed layout debug boxes in the output                               |
| `--overlay <path>`            | JS module exporting a custom `OverlayProvider` object                |
| `--profile-layout`            | Print layout pipeline duration                                       |
