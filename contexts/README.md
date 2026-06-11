# VMPrint Contexts

Standard rendering contexts for the [VMPrint](https://github.com/cosmiciron/vmprint) layout engine.

Rendering contexts are the output surface for VMPrint. The engine produces a `Page[]` — a stream of absolute layout data — and a context is what those pages are painted onto. This architecture ensures that the same document can be rendered to PDF, SVG, or an HTML Canvas with identical typesetting.

## Context Packages

| Package | Purpose | Technology |
|---|---|---|
| [`@vmprint/context-pdf`](pdf/) | **Production PDF** | [PDFKit](https://pdfkit.org) |
| [`@vmprint/context-canvas`](canvas/) | **Browser Preview** | SVG-backed Canvas |
| [`@vmprint/context-pdf-lite`](pdf-lite/) | **Lightweight PDF** | [jsPDF](https://github.com/parallax/jsPDF) |

## Development

This repository is a monorepo using npm workspaces.

### Installation

```bash
npm install
```

### Building

Build all contexts in dual-mode (ESM and CJS):

```bash
npm run build
```

The output artifacts will be placed in the `dist/` directory of each package.

### Architecture

Every context implements the standard `Context` interface defined in `@vmprint/contracts`. A context should contain **zero layout logic**; its only responsibility is to execute drawing commands (lines, shapes, text, images) against its target medium.

### Standard PDF Fonts

The `@vmprint/context-pdf` implementation includes built-in metrics and encoding logic for the 14 standard PDF fonts (Helvetica, Times, Courier, etc.), making it fully independent of external font managers for standard text rendering.

## License

Apache-2.0
