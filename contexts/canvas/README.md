# @vmprint/context-canvas

Browser display context for vmprint.

`ContextCanvas` is a first-class screen-rendering context. It builds page scenes and exposes helpers to paint those pages onto HTML canvas or OffscreenCanvas targets. This keeps the browser product centered on screen display and interaction without exposing the scene format as part of the public API.

## What It Solves

- print preview without a PDF viewer
- embeddable page display inside product UI
- canvas-based page presentation and thumbnails
- a foundation for future interactive writing surfaces

## Rendering Model

- `textRenderMode: 'text'` keeps text as text and embeds the required fonts for faithful page preview
- `textRenderMode: 'glyph-path'` converts all text to Fontkit glyph outlines for the fastest and most robust heavy-document preview path
- canvas rendering paints vmprint page scenes rather than relying on `fillText()`

## Usage

```ts
import { CanvasContext } from '@vmprint/context-canvas';

const context = new CanvasContext({
  size: 'LETTER',
  margins: { top: 0, right: 0, bottom: 0, left: 0 },
  autoFirstPage: false,
  bufferPages: false,
  textRenderMode: 'glyph-path'
});

// render with vmprint's engine/renderer...

await context.renderPageToCanvas(0, canvasElement, {
  scale: 1,
  dpi: 144
});
```

## Notes

- `pipe()` is a no-op. This context manages page scenes internally.
- The first implementation is browser-oriented and expects DOM canvas/image APIs for rasterization helpers.
- The public product is canvas display. You can still inspect serialized page scenes with `toSvgString()` and `toSvgPages()` when needed.
- `renderPageToCanvas()` accepts `dpi` so the canvas backing bitmap can be sharper than the displayed page size.
- Recommended mode guidance:
  - `text`: simpler Latin or single-script documents
  - `glyph-path`: multilingual fidelity and lowest perceived first-view latency on heavy documents
