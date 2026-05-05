# VMPrint Documentation

VMPrint is a deterministic spatial simulation engine for document generation. It has no knowledge of browsers or the DOM - pages are bounded arenas, elements are autonomous actors, and layout is the process of reaching a stable world state. The same input always produces the exact same output, to the sub-point, across every runtime: Node.js, Cloudflare Workers, Lambda, and the browser.

---

## API Reference

Complete type-level documentation for all public packages, generated from source:

**[API Reference ->](./api/)**

Covers `@vmprint/engine`, `@vmprint/contracts`, all contexts, all font managers, and all transmuters - every class, interface, and type, cross-linked between packages.

---

## Guides

A progressive six-chapter authoring guide, from first document to scripting:

| Chapter | Topic |
|---------|-------|
| [Introduction](./guides/) | Overview and reading path |
| [01 - Your First Document](./guides/01-your-first-document.html) | Document structure, layout config, a minimal working example |
| [02 - Styles and Text](./guides/02-styles-and-text.html) | The style system, typography, inline formatting |
| [03 - Stories, Strips, and Zones](./guides/03-stories-strips-and-zones.html) | Multi-column layout, strips, zone maps |
| [04 - Headers, Footers, and Page Control](./guides/04-headers-footers-and-page-control.html) | Running regions, page numbering, odd-sized pages, partial simulation |
| [05 - Images, Tables, and Overlays](./guides/05-images-tables-and-overlays.html) | Embedded images, table layout, overlay system |
| [06 - Scripting](./guides/06-scripting.html) | Document and element lifecycle hooks, messaging, mutations |

---

## Reference

Detailed specifications for the document format and runtime APIs:

| Document | Contents |
|----------|----------|
| [AST Reference](./reference/ast.html) | Complete `DocumentInput` schema - layout config, page templates, all element types, style properties |
| [Scripting API](./reference/scripting.html) | All lifecycle methods, element addressing, messaging, mutation API |
| [Overlay System](./reference/overlay.html) | `OverlayProvider` interface, render lifecycle, backdrop and overlay hooks |
| [Standard Fonts](./reference/standard-fonts.html) | The 14 built-in PDF fonts, Win-ANSI encoding, sentinel buffer mechanism |
| [CLI Reference](./reference/cli.html) | `vmprint` CLI - flags, layout stream, mixed page sizes, render-from-layout, overlay sidecar |

---

## Live Examples

Each example is a complete VMPrint pipeline running entirely client-side - no backend, no server, no headless browser. Download the folder, open `index.html`, and it works immediately from `file://`.

| Example | Description |
|---------|-------------|
| [AST -> PDF](./examples/ast-to-pdf/) | `StandardFontManager` + `PdfLiteContext`. Zero font files in the pipeline. ~182 KiB Brotli for the full runtime. |
| [AST -> PDF with web fonts](./examples/ast-to-pdf-webfonts/) | Same pipeline with `@vmprint/web-fonts` for remote font loading, enabling custom typography and broad multilingual shaping. |
| [AST -> Canvas with web fonts](./examples/ast-to-canvas-webfonts/) | `@vmprint/context-canvas` renders SVG-backed page scenes into a live browser canvas - the basis for document preview UIs. |
| [Preview Package](./examples/preview/) | Full canvas preview, PDF export, and SVG export via the standalone `@vmprint/preview` bundle. |
| [Markdown -> AST](./examples/mkd-to-ast/) | Full Markdown transmutation in the browser, producing a VMPrint `DocumentInput` you can inspect. |

---

## Packages

| Package | Purpose |
|---------|---------|
| `@vmprint/engine` | Core layout engine: `LayoutEngine`, `ContextRenderer`, element AST, layout config, simulation output types |
| `@vmprint/contracts` | Interface definitions: `Context`, `FontManager`, `Transmuter`, `OverlayProvider` |
| `@vmprint/standard-fonts` | The 14 built-in PDF fonts with zero binary data - Win-ANSI metrics served from AFM tables |
| `@vmprint/context-pdf-lite` | jsPDF-backed PDF output, browser-native, zero Node.js dependencies |
| `@vmprint/context-pdf` | pdf-lib-backed PDF output with full streaming, shaped-glyph fidelity, and image embedding |
| `@vmprint/context-canvas` | Canvas/SVG rendering context for live browser preview |
| `@vmprint/web-fonts` | Font manager for remote OpenType loading in the browser |
| `@vmprint/preview` | Standalone browser controller: layout engine + canvas preview + PDF/SVG export in one bundle |
| `@vmprint/local-fonts` | Font manager for local `.ttf`/`.otf` files in Node.js |

---

## Further Reading

- [System Architecture](https://github.com/cosmiciron/vmprint/blob/main/documents/ARCHITECTURE.md) - how the engine, contexts, and font managers fit together
- [Engine Internals](https://github.com/cosmiciron/vmprint/blob/main/documents/ENGINE-INTERNALS.md) - actor simulation, pagination, scripting replay
- [Quickstart](https://github.com/cosmiciron/vmprint/blob/main/QUICKSTART.md) - get a PDF out in under five minutes
- [GitHub Repository](https://github.com/cosmiciron/vmprint)

---

Licensed under the [Apache License 2.0](https://github.com/cosmiciron/vmprint/blob/main/LICENSE).
