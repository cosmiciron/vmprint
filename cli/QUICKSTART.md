# vmprint CLI — Quickstart

## Install

```bash
npm install -g vmprint
```

## Run from source

Requires the vmprint monorepo. Use `npm run dev --prefix cli` in place of `vmprint`:

```bash
npm run dev --prefix cli -- --input document.json --output out.pdf
npm run dev --prefix cli -- --help
```

## Basic usage

```bash
vmprint --input document.json --output out.pdf
```

If you are authoring AST `1.1` documents from scratch, use the guide first:

- [VMPrint Authoring Guide](c:\Users\cosmic\Projects\vmprint\documents\authoring\README.md)

## Inspect the pipeline

```bash
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

## Custom font manager

```bash
vmprint --input document.json --output out.pdf --font-manager ./my-font-manager.js
```

The module must export the class as the default export and implement the `FontManager` interface from `@vmprint/contracts`. See [`font-managers/`](../font-managers/README.md) for the interface contract and implementation guide.

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

| Flag | Description |
|---|---|
| `-i, --input <path>` | Input document JSON |
| `-o, --output <path>` | Output PDF path |
| `--font-manager <path>` | JS module exporting a custom `FontManager` class |
| `--emit-layout [path]` | Write annotated layout stream JSON (default: `<output>.layout.json`) |
| `--render-from-layout <path>` | Render from a saved layout stream, bypassing layout |
| `--omit-glyphs` | Exclude glyph positioning data from the layout stream |
| `--quantize` | Quantize layout stream coordinates to 3 decimal places |
| `-d, --debug` | Embed layout debug boxes in the output |
| `--overlay <path>` | JS module exporting a custom `OverlayProvider` object |
| `--profile-layout` | Print layout pipeline duration |
