# @vmprint/context-canvas

Browser display context for vmprint.

`ContextCanvas` is a first-class screen-rendering context. Internally it builds each page as an SVG scene, then exposes helpers to paint those pages onto HTML canvas or OffscreenCanvas targets. This keeps the browser product centered on screen display and interaction, while still using SVG as the internal scene format.

## What It Solves

- print preview without a PDF viewer
- embeddable page display inside product UI
- canvas-based page presentation and thumbnails
- a foundation for future interactive writing surfaces

## Rendering Model

- standard text is emitted as SVG text with embedded `@font-face` rules
- `showShapedGlyphs()` uses Fontkit glyph outlines and writes SVG `<path>` geometry directly
- canvas rendering rasterizes the generated SVG page rather than relying on `fillText()`

## Usage

```ts
import { CanvasContext } from '@vmprint/context-canvas';

const context = new CanvasContext({
  size: 'LETTER',
  margins: { top: 0, right: 0, bottom: 0, left: 0 },
  autoFirstPage: false,
  bufferPages: false
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
- The public product is canvas display. SVG is an internal scene representation and can also be inspected via `toSvgString()` and `toSvgPages()`.
- `renderPageToCanvas()` accepts `dpi` so the canvas backing bitmap can be sharper than the displayed page size.
