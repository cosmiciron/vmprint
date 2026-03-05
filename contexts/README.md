# contexts

Rendering contexts are the output surface for vmprint's layout engine. The engine produces a `Page[]` — a stream of pages, each containing absolutely-positioned boxes with their text, images, shapes, and drawing instructions. A context is what those boxes are painted onto.

## Why This Exists

The vmprint layout pipeline is split in two: layout, then rendering. The split is the whole point.

Layout — line wrapping, pagination, glyph measurement, widow and orphan control — happens entirely in the engine. It produces a `Page[]` of absolute positions. Every glyph, every border, every image is already placed. The rendering step just paints what the layout step decided.

Because rendering is separate, the *target* can change without the layout changing. A PDF context and an SVG context, given the same `Page[]`, would place every glyph at the exact same coordinates. The ink medium changes; the typesetting doesn't.

This is the same conviction that drove Display PostScript on NeXT workstations: a device-independent imaging model, available uniformly to every application, producing consistent output regardless of the output device. Every vmprint context implements the same drawing interface. Any output medium that implements that interface gets the full layout engine for free.

## The Interface

```ts
interface Context {
  // Document lifecycle
  addPage(): void;
  end(): void;

  // Output streaming
  // Called by the host (e.g. CLI) before rendering begins. The context writes
  // rendered output into the stream as pages are produced. Implement as a no-op
  // if the context manages its own output internally.
  pipe(stream: VmprintOutputStream): void;

  // Font registration and selection
  registerFont(id: string, buffer: Uint8Array, options?: { standardFontPostScriptName?: string }): Promise<void>;
  font(family: string, size?: number): this;
  fontSize(size: number): this;

  // Graphics state
  save(): void;
  restore(): void;
  translate(x: number, y: number): this;
  rotate(angle: number, originX?: number, originY?: number): this;
  opacity(opacity: number): this;

  // Style
  fillColor(color: string): this;
  strokeColor(color: string): this;
  lineWidth(width: number): this;
  dash(length: number, options?: { space: number }): this;
  undash(): this;

  // Shapes
  moveTo(x: number, y: number): this;
  lineTo(x: number, y: number): this;
  rect(x: number, y: number, w: number, h: number): this;
  roundedRect(x: number, y: number, w: number, h: number, r: number): this;
  fill(rule?: 'nonzero' | 'evenodd'): this;
  stroke(): this;
  fillAndStroke(fillColor?: string, strokeColor?: string): this;

  // Content
  text(str: string, x: number, y: number, options?: ContextTextOptions): this;
  image(source: string | Uint8Array, x: number, y: number, options?: ContextImageOptions): this;

  // Geometry
  getSize(): { width: number; height: number };
}
```

This is a deliberately minimal 2D drawing API. No layout logic. No text measurement. No line wrapping. The engine has already done all of that — the context's only job is to execute drawing commands against an output medium. Any implementation that satisfies this interface plugs in immediately.

## Packages

| Package | Description |
|---|---|
| [`@vmprint/context-pdf`](pdf/) | PDF output via PDFKit. The production context. |

## Writing a Custom Context

A context is the right extension point when you want vmprint's layout output painted somewhere other than a PDF file.

### What's Possible

**SVG** — Vector output suitable for web embedding, archiving, and indexing. Every element from the `Page[]` maps naturally to SVG primitives. The output is searchable, scalable, and renderable in any browser without a viewer.

**Canvas (browser)** — Paint the layout to an HTML `<canvas>` for in-browser rendering — previews, print dialogs, client-side document viewers. The layout has already happened server-side; the browser just executes the drawing commands.

**Test spy** — A context that records drawing calls as structured data instead of producing any output. Useful for unit-testing format modules and overlay hooks: assert that specific `text()` or `rect()` calls were made, at specific positions, without touching the filesystem. vmprint's own regression tests use a snapshot approach on the `Page[]` output directly, but a spy context is valuable for integration tests that need to verify rendered output rather than layout output.

**Editable writing surface** — Because the layout pass produces absolute glyph positions, a DOM-backed context has enough information to render an editor that shows document-accurate layout. Each text run has a position, a font, a size, and source provenance from the input document. A context that maps these to positioned DOM nodes — `contenteditable` spans, overlaid input regions — could produce a WYSIWYG surface where the layout is computed by the engine and the editing happens in the DOM. The cursor position, text selection, and line geometry are all derivable from the `Page[]` without re-implementing a layout engine.

**Print production** — A context wrapper that adds crop marks, registration marks, bleed areas, and color bars around the primary output. The inner context produces the document; the wrapper adds the production marks around it.

**Accessibility tree** — Walk the `Page[]` and produce an ordered sequence of text runs with position and structure metadata, suitable for building an accessibility layer or a plain-text extraction pipeline.

### The Minimal Implementation

```ts
import { Context, ContextTextOptions, ContextImageOptions } from '@vmprint/contracts';

class MyContext implements Context {
  addPage(): void { /* start a new page */ }
  end(): void { /* finalize output */ }

  // No-op: this context manages its own output internally
  pipe(_stream: VmprintOutputStream): void {}

  async registerFont(id: string, buffer: Uint8Array, options?: { standardFontPostScriptName?: string }): Promise<void> {
    /* load the font into your rendering surface */
  }

  font(family: string, size?: number): this {
    /* set active font */ return this;
  }

  fontSize(size: number): this { return this; }

  save(): void { /* push graphics state */ }
  restore(): void { /* pop graphics state */ }

  translate(x: number, y: number): this { return this; }
  rotate(angle: number, originX?: number, originY?: number): this { return this; }
  opacity(opacity: number): this { return this; }

  fillColor(color: string): this { return this; }
  strokeColor(color: string): this { return this; }
  lineWidth(width: number): this { return this; }
  dash(length: number, options?: { space: number }): this { return this; }
  undash(): this { return this; }

  moveTo(x: number, y: number): this { return this; }
  lineTo(x: number, y: number): this { return this; }
  rect(x: number, y: number, w: number, h: number): this { return this; }
  roundedRect(x: number, y: number, w: number, h: number, r: number): this { return this; }
  fill(rule?: 'nonzero' | 'evenodd'): this { return this; }
  stroke(): this { return this; }
  fillAndStroke(fillColor?: string, strokeColor?: string): this { return this; }

  text(str: string, x: number, y: number, options?: ContextTextOptions): this { return this; }
  image(source: string | Uint8Array, x: number, y: number, options?: ContextImageOptions): this { return this; }

  getSize(): { width: number; height: number } { return { width: 612, height: 792 }; }
}
```

---

## `@vmprint/context-pdf` — The Production Context

`PdfContext` wraps [PDFKit](https://pdfkit.org) and implements the full `Context` interface for PDF output. It is the production context used by `draft2final` and the `vmprint` CLI.

### Output stream

`PdfContext` is constructed with `ContextFactoryOptions` only. Output is delivered by calling `pipe()` with a `VmprintOutputStream` before rendering begins. The context bridges PDFKit's internal streaming into the abstract stream interface — the caller owns the stream and waits on it after rendering is complete:

```ts
const context = new PdfContext({ size: 'LETTER', margins: ..., autoFirstPage: false, bufferPages: false });
context.pipe(myOutputStream); // call before renderer.render()
```

The `VmprintOutputStream` interface is defined in `@vmprint/contracts`. Callers are responsible for implementing it against their specific I/O mechanism (Node.js file stream, in-memory buffer, browser response, etc.).

### Font registration

`PdfContext` registers font buffers directly with PDFKit using the resolved font id from the engine.

### Baseline alignment

Text positions from the layout engine are expressed relative to the baseline. `PdfContext` converts the engine's normalized ascent value (0–1000 units) to the pixel offset PDFKit expects, so glyphs land exactly where the engine placed them.

### Browser compatibility

`PdfContext` works in browser environments. Font loading falls back to `fetch()`, and the output stream interface is compatible with `blob-stream` and similar browser writable stream implementations. The same context code runs in Node.js and the browser without modification.
