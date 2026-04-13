# @vmprint/engine

The deterministic layout engine at the center of VMPrint.

This package is for developers who already know why they want a layout engine: they want authored structure in, positioned boxes out, and no browser screenshot pipeline pretending to be typesetting.

## Primary API

The main surface is `VMPrintEngine`.

```ts
import { VMPrintEngine, loadDocument } from '@vmprint/engine';
import { StandardFontManager } from '@vmprint/standard-fonts';
import { PdfLiteContext } from '@vmprint/context-pdf-lite';

const document = loadDocument(sourceTextOrObject, 'document.json');
const engine = new VMPrintEngine(document, new StandardFontManager());

const { width, height } = engine.info.pageSize;
const context = new PdfLiteContext({
  size: [width, height],
  margins: { top: 0, right: 0, bottom: 0, left: 0 },
  autoFirstPage: false,
  bufferPages: false
});

await engine.render(context);
const pdf: Uint8Array = context.getOutput();
```

If you want the positioned pages before rendering, call `await engine.layout()` first. The resulting `Page[]` is cached and reused by `render()`.

`VMPrintEngine` is the preferred API going forward, but it is not a hard break with the past. The older low-level bootstrap path built around `LayoutEngine`, `Renderer`, `createPrintEngineRuntime`, and `toLayoutConfig` is still supported for advanced integrations that want finer control over layout and rendering stages.

## What the engine owns

- Document validation and normalization via `loadDocument`
- Font-aware layout through a `FontManager`
- Pagination and box generation
- Rendering orchestration into any `Context`

## What stays outside

- Font acquisition and embedding policy
- Output transport and file I/O
- Source-format conversion
- Overlay logic and tooling concerns

Those seams are described by the engine's exported contract types.

## Lower-level surface

The package still exports lower-level pieces such as `LayoutEngine`, `Renderer`, `SimulationLoop`, spatial helpers, and document serialization utilities. They remain supported for tooling, tests, and engine-adjacent integrations, but they are no longer the primary entry point.

## Recommended stacks

- Smallest Node bootstrap: `@vmprint/local-fonts` + `@vmprint/context-pdf`
- Zero-embedded standard-font PDFs: `@vmprint/standard-fonts` + `@vmprint/context-pdf-lite`
- Custom environments: bring your own `FontManager` and `Context`

## Related material

- [Quickstart](https://github.com/cosmiciron/vmprint/blob/main/QUICKSTART.md)
- [Architecture](https://github.com/cosmiciron/vmprint/blob/main/documents/ARCHITECTURE.md)
- [Engine Internals](https://github.com/cosmiciron/vmprint/blob/main/documents/ENGINE-INTERNALS.md)
- [Pressrun](https://github.com/cosmiciron/vmprint/tree/main/pressrun)
