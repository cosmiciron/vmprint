# @vmprint/engine

**The deterministic spatial simulation core of VMPrint.**

This package contains the layout algorithms, the actor-based simulation runtime, and the logic that transforms a semantic element tree into a flat list of positioned, renderable boxes — ready for any output target.

---

## Why a Pure-Math Kernel?

Most layout engines bundle everything: font loading, file I/O, PDF generation. That makes them fast to start with but hard to run anywhere except a Node.js server.

`@vmprint/engine` draws a strict boundary between *calculating* a layout and *rendering* it:

- **Zero I/O, zero dependencies.** The engine has no knowledge of the filesystem, the network, or the operating system. It consumes a JSON element tree and produces a JSON page list.
- **Contract-based design.** The engine coordinates two pluggable interfaces — a `FontManager` that provides glyph metrics and a `Context` that receives drawing commands. It has no opinions about where fonts come from or how pixels reach the screen.
- **Absolute determinism.** The same input always produces identical layout coordinates, to the sub-point, in every environment from a Cloudflare Worker to a headless browser.

This separation means you can swap a PDF context for a canvas context, a server-side font manager for a browser one, and the layout math stays untouched.

---

## Architecture

```
Your document (JSON / Markdown / etc.)
          │
          ▼
   ┌─────────────┐
   │  Transmuter │  Converts your source into the engine's Element[] AST
   └──────┬──────┘
          │ Element[]
          ▼
   ┌──────────────┐     ┌─────────────┐
   │ LayoutEngine │────▶│ FontManager │  Provides glyph metrics + font buffers
   └──────┬───────┘     └─────────────┘
          │ Page[]  (positioned Box objects)
          ▼
   ┌──────────────┐     ┌─────────────┐
   │   Renderer   │────▶│   Context   │  Receives draw commands (rect, line, text…)
   └──────────────┘     └─────────────┘
                                │
                          PDF / Canvas / SVG / …
```

The three interfaces — `Transmuter`, `FontManager`, and `Context` — are defined in `@vmprint/contracts`. The engine package ships a fourth collaborator, `Renderer`, which walks the `Page[]` output and drives a `Context` to produce the final document.

---

## Quick Start

```typescript
import { LayoutEngine, Renderer, createEngineRuntime, toLayoutConfig } from '@vmprint/engine';
import { StandardFontManager } from '@vmprint/standard-fonts';
import { PdfLiteContext } from '@vmprint/context-pdf-lite';

// 1. Build the runtime (font manager only — no I/O wired in)
const runtime = createEngineRuntime({
  fontManager: new StandardFontManager()
});

// 2. Parse your document input into a LayoutConfig + Element[]
const config = toLayoutConfig(myDocumentInput);
const engine = new LayoutEngine(config, runtime);

// 3. Load fonts (resolves metrics; no file reads with StandardFontManager)
await engine.waitForFonts();

// 4. Simulate layout — returns a flat Page[] of positioned Box objects
const pages = engine.simulate(myDocumentInput.elements);

// 5. Render to PDF
const context = new PdfLiteContext({ size: 'LETTER' });
const renderer = new Renderer(config, /* debug */ false, runtime);
await renderer.render(pages, context);

// 6. Collect output
const pdf: Uint8Array = context.getOutput();
```

---

## The Portable Pair: Standard Fonts + PDF Lite

When bundle size or cold-start latency matters — Edge functions, Lambda, the browser — the recommended stack is `@vmprint/standard-fonts` paired with `@vmprint/context-pdf-lite`. Together they produce a PDF **with zero font files in the pipeline**.

### `@vmprint/standard-fonts` — StandardFontManager

Every PDF viewer in existence ships with 14 built-in fonts. They are never embedded; the viewer already has them. `StandardFontManager` exploits this by serving the engine glyph metrics for those fonts without ever loading a binary file.

**The 14 fonts:**

| Family | Variants |
|--------|----------|
| Helvetica | Regular, Bold, Oblique, Bold Oblique |
| Times | Roman, Bold, Italic, Bold Italic |
| Courier | Regular, Bold, Oblique, Bold Oblique |
| Symbol | (Greek and mathematical symbols) |
| ZapfDingbats | (Ornaments, arrows, checkmarks) |

Common aliases are resolved automatically — `Arial → Helvetica`, `Times New Roman → Times`, `sans-serif → Helvetica`, etc.

Instead of returning actual font binaries, `loadFontBuffer()` returns a 5-byte **sentinel buffer** (a magic marker + the font ID). The renderer and context recognise the sentinel and switch to built-in font paths, so no binary data ever travels through the pipeline.

**Strengths:**
- Instantaneous font resolution — no async loading, no file reads, no network requests.
- No font bytes in your bundle or your payload.
- Metrics are exact: each font's full glyph-width table is baked into the package.
- Works identically in Node, the browser, Deno, and edge runtimes.

**Limitations:**
- **Latin-1 text only.** Helvetica, Times, and Courier use Win-ANSI encoding, which covers ASCII plus the extended Latin range (accented characters, typographic punctuation like curly quotes and em-dashes, currency signs). It does *not* support Arabic, Hebrew, CJK, Devanagari, or any other complex script.
- **No kerning.** Metrics come from AFM tables — glyph widths are correct, but pair kerning is not applied.
- **No font fallback.** The manager has no mechanism for substituting a glyph from a second font when the primary font can't represent it. Characters outside the encoding silently drop.

If your documents are Latin-script only, this is the right choice. For multilingual or RTL content, pair the engine with a full OpenType font manager and `@vmprint/context-pdf` instead.

---

### `@vmprint/context-pdf-lite` — PdfLiteContext

`PdfLiteContext` is a thin rendering layer built on **jsPDF**. Because jsPDF is browser-native and has no dependency on Node's `Buffer` or `fs`, it deploys everywhere the engine does.

When paired with `StandardFontManager`, it maps the sentinel buffers to jsPDF's internal built-in font registry. No font data is registered, no subsetting happens, and the output PDF is minimal in size.

**Strengths:**
- Browser-native: no Node.js APIs required.
- Zero font data when used with `StandardFontManager` — the entire PDF is just page geometry and text commands.
- Can also accept custom OpenType fonts (registered via base64 with jsPDF's Identity-H encoder) when you need a typeface beyond the standard 14.
- Full support for filled/stroked shapes, rounded rectangles, dashed lines, opacity, transforms, and SVG paths.

**Limitations:**
- **Buffered, not streaming.** jsPDF builds the entire PDF in memory and emits it as a single `Uint8Array` at the end. It cannot stream page-by-page. For very long documents this means the full document lives in RAM simultaneously.
- **No shaped-glyph fidelity for complex scripts.** The `Context` interface defines a `showShapedGlyphs()` call that carries pre-shaped fontkit glyph IDs for correct contextual rendering (Arabic ligatures, Indic conjuncts, etc.). `PdfLiteContext` cannot honour those glyph IDs — it reconstructs a Unicode string from code points and delegates to jsPDF's built-in RTL processor. For most Latin text this is transparent, but for Arabic or Indic scripts the output may be missing contextual forms.
- **No `rotate()` implementation.** The method exists in the interface but is not implemented in this context; rotated elements will not render.
- **Limited color syntax.** Accepts `#RRGGBB`, `#RGB`, and a small set of named colors (`black`, `white`, `red`, `green`, `blue`, `gray`, `silver`).

For full streaming output, correct shaped-glyph rendering, and the widest color/transform support, use `@vmprint/context-pdf` (backed by pdf-lib) instead.

---

## Engine Capabilities

A few features worth knowing about as you build with the engine:

- **Deterministic pagination** with configurable orphan/widow control, keep-together groups, and overflow policies (`clip`, `move-whole`, `error`).
- **Zone maps** (`type: "zone-map"`): declare a row of independent layout regions — each column runs its own non-paginating flow pass and is composited into page space. Column widths support fixed, auto, and flex (`fr`) tracks via the same solver used for tables.
- **Tables**: full grid layout with row/column sizing, spanning cells, header repetition, and per-cell styling.
- **Multi-column stories**, drop-caps, floats, absolute positioning, and full-width column spans. Column-spanning elements support `keepWithNext: true` to prevent a section banner from being stranded at the bottom of a page without its following column content.
- **Page regions**: headers and footers with per-page content overrides and spatial constraints.
- **Scripting hooks**: `onBeforeLayout`, `onAfterSettle`, `onCreate`, `onResolve` — element-level message passing and up to three bounded replay passes.
- **Debug mode**: pass `true` as the second argument to `Renderer` to overlay page margins, zone boundaries, and per-box labels onto the output.

---

## Further Reading

**Part of the [VMPrint Ecosystem](https://github.com/cosmiciron/vmprint)**

- [System Architecture](https://github.com/cosmiciron/vmprint/blob/main/documents/ARCHITECTURE.md)
- [Engine Internals](https://github.com/cosmiciron/vmprint/blob/main/documents/ENGINE-INTERNALS.md)
- [Contributing](https://github.com/cosmiciron/vmprint/blob/main/CONTRIBUTING.md)

Licensed under the [Apache License 2.0](LICENSE).
