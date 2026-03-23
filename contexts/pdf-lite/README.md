# @vmprint/context-pdf-lite

A lightweight PDF rendering context powered by jsPDF, designed for embeddable and browser-friendly PDF output.

## Why This Exists

The standard `@vmprint/context-pdf` uses PDFKit, which requires a substantial font processing stack and relies on node-specific buffers in some places, leading to a larger footprint. `context-pdf-lite` provides an alternative for edge and browser environments where binary font embedding is unnecessary or bundle size is highly constrained. 

When paired with `@vmprint/standard-fonts`, this creates a complete end-to-end VMPrint rendering stack weighing only a fraction of the full node-based alternative.

## Limitations

- **Less Optimal Font Subsetting**: Custom fonts (`.ttf`, `.otf`, `.woff`) *are* fully supported by this context. However, the underlying font subsetting mechanism is less optimal than the standard `@vmprint/context-pdf` stack. When heavily embedding custom fonts, you may encounter larger output file sizes or higher memory usage. (Note: this limitation does not apply if you pair the context with `@vmprint/standard-fonts`, which completely sidesteps font embedding).

## Basic Usage

```ts
import { LayoutEngine, Renderer, toLayoutConfig, createEngineRuntime } from '@vmprint/engine';
import { StandardFontManager } from '@vmprint/standard-fonts';
import { PdfLiteContext } from '@vmprint/context-pdf-lite';

// Setup engine with standard fonts
const runtime = createEngineRuntime({ fontManager: new StandardFontManager() });
// Build layout configuration from DocumentInput JSON 
const config = toLayoutConfig(documentInput);
const engine = new LayoutEngine(config, runtime);

await engine.waitForFonts();
const pages = engine.simulate(documentInput.elements);

// Setup lightweight context
const context = new PdfLiteContext({
  size: [612, 792],
  margins: { top: 0, right: 0, bottom: 0, left: 0 }
});

const renderer = new Renderer(config, false, runtime);
await renderer.render(pages, context);

// Output handling depends on implementation details of PdfLiteContext stream pipelining
```

## Browser Examples

Looking to test this in the browser quickly? See [docs/examples/ast-to-pdf](../../docs/examples/ast-to-pdf) for a self-contained static showcase using the pdf-lite stack.

---

Licensed under the [Apache License 2.0](LICENSE).