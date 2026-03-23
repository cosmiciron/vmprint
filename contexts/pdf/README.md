# @vmprint/context-pdf

**The production PDF rendering context for VMPrint, powered by [PDFKit](https://pdfkit.org).**

This is the full-capability context used by the `vmprint` CLI and `draft2final`. It streams output incrementally, renders shaped glyphs with full OpenType fidelity (Arabic ligatures, Indic conjuncts, GPOS mark positioning), and supports the complete drawing API including transforms and rotation.

## When to Use This vs `@vmprint/context-pdf-lite`

| Capability | `@vmprint/context-pdf` | `@vmprint/context-pdf-lite` |
|---|---|---|
| Output model | **Streaming** — pages emitted as rendered | Buffered — full PDF in memory at `end()` |
| Shaped glyphs (RTL/CTL) | **Full fidelity** — fontkit glyph IDs, GPOS offsets | Lossy fallback — Unicode string reconstruction |
| `rotate()` | Fully implemented | Not implemented |
| Color syntax | Full PDFKit color support | `#RRGGBB`, `#RGB`, and six named colors |
| Standard PDF fonts | Supported via PostScript name aliases | Supported |
| Custom OpenType fonts | Full subsetting with ToUnicode mapping | Full subsetting with Identity-H encoding |
| Node.js | Yes | Yes |
| Browser | Yes (requires `buffer` polyfill, included) | Yes (no polyfills needed) |
| Bundle size | Larger (PDFKit + fontkit) | Smaller (jsPDF only) |

Use `@vmprint/context-pdf` when you need correct multilingual output, rotation, streaming to a file or HTTP response, or the largest possible color and graphics fidelity. Use `@vmprint/context-pdf-lite` when bundle size is the constraint and your content is Latin-script only.

## Usage

```typescript
import { LayoutEngine, Renderer, toLayoutConfig, createEngineRuntime } from '@vmprint/engine';
import { LocalFontManager } from '@vmprint/local-fonts';
import { PdfContext } from '@vmprint/context-pdf';
import fs from 'fs';

const runtime = createEngineRuntime({ fontManager: new LocalFontManager() });
const config = toLayoutConfig(myDocumentInput);
const engine = new LayoutEngine(config, runtime);

await engine.waitForFonts();
const pages = engine.simulate(myDocumentInput.elements);

// Create an output stream before rendering
const output = fs.createWriteStream('output.pdf');

const context = new PdfContext({
  size: 'LETTER',
  autoFirstPage: false,
  bufferPages: false
});

// Pipe before calling render — PDFKit begins streaming immediately
context.pipe(outputStream);

const renderer = new Renderer(config, false, runtime);
await renderer.render(pages, context);

await outputStream.waitForFinish();
```

## Constructor

```typescript
new PdfContext(options: ContextFactoryOptions)
```

`ContextFactoryOptions` is defined in `@vmprint/contracts`:

| Option | Type | Description |
|--------|------|-------------|
| `size` | `string \| [number, number]` | Page size — `'LETTER'`, `'A4'`, or `[width, height]` in points |
| `margins` | `{ top, right, bottom, left }` | Page margins in points (passed to PDFKit) |
| `autoFirstPage` | `boolean` | Whether PDFKit should auto-create the first page. Pass `false` — the engine calls `addPage()` itself. |
| `bufferPages` | `boolean` | Whether PDFKit buffers all pages in memory. Pass `false` for streaming output. |

## Streaming Model

`PdfContext` bridges PDFKit's native readable stream to VMPrint's `VmprintOutputStream` interface. PDFKit emits `data` chunks as each page is rendered and an `end` event when the document is complete. This means:

- Output arrives incrementally — you can pipe it directly to a file stream or HTTP response without waiting for the full document.
- `pipe()` must be called **before** `renderer.render()`. PDFKit begins emitting data immediately when the first page is added.
- The caller is responsible for implementing `VmprintOutputStream` for their I/O target and calling `waitForFinish()` after rendering completes.

## Font Handling

**Standard PDF fonts** (Helvetica, Times, Courier, Symbol, ZapfDingbats): When `registerFont()` receives a standard font sentinel buffer, it stores the PostScript name alias instead of registering any binary data. PDFKit resolves these to its built-in standard font references automatically, producing zero font bytes in the output.

**Custom OpenType fonts**: Buffers are registered directly with PDFKit. PDFKit subsets the font — only the glyphs used in the document are embedded — and generates a full ToUnicode mapping so text is searchable and copy-pasteable in the resulting PDF.

## Shaped Glyph Rendering

`showShapedGlyphs()` is fully implemented. The engine's layout pass uses fontkit to shape text runs for complex scripts (Arabic, Hebrew, Devanagari, Thai, etc.), producing a sequence of glyph IDs with exact advance widths and GPOS offsets. `PdfContext` maps these glyph IDs directly into PDFKit's subset registry and emits them as a PDF `TJ` operator stream — bypassing PDFKit's own text layout entirely to preserve the pre-shaped contextual forms.

This means Arabic ligatures, Indic conjuncts, and mark positioning are rendered exactly as fontkit shaped them. No Unicode reconstruction, no loss of contextual forms.

If a font is not loaded or does not support the subsetting API (e.g. a non-OpenType fallback), the context falls back to a Unicode string reconstruction path, which handles basic LTR scripts correctly.

## Browser Compatibility

`PdfContext` works in browser environments. The `buffer` polyfill is included as a dependency and handles `Buffer.from()` for image data. Font loading uses the runtime's `loadFontBuffer()`, which can be backed by `fetch()` in the browser. The `VmprintOutputStream` interface is compatible with `blob-stream` and similar browser writable stream implementations.

---

**Part of the [VMPrint Ecosystem](https://github.com/cosmiciron/vmprint)**
[API Reference](https://cosmiciron.github.io/vmprint/api/) | [Contexts Overview](../README.md) | [context-pdf-lite](../pdf-lite/README.md)

Licensed under the [Apache License 2.0](LICENSE).
