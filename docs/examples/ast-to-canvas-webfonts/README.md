# AST JSON to Canvas with Web Fonts (Static Browser Example)

This example demonstrates a browser-only VMPrint screen rendering pipeline:

- `@vmprint/engine`
- `@vmprint/web-fonts`
- `@vmprint/context-canvas`

Input is AST JSON, output is a live per-page canvas preview. No server runtime is required.

## Build

From repository root:

```bash
npm run docs:build
```

This emits browser-ready scripts to:

- `docs/examples/ast-to-canvas-webfonts/assets/vmprint-engine.js`
- `docs/examples/ast-to-canvas-webfonts/assets/vmprint-web-fonts.js`
- `docs/examples/ast-to-canvas-webfonts/assets/vmprint-context-canvas.js`
- `docs/examples/ast-to-canvas-webfonts/assets/pipeline.js`
- `docs/examples/ast-to-canvas-webfonts/assets/ui.js`
- `docs/examples/ast-to-canvas-webfonts/fixtures/*.js`

## Run Locally

Open `docs/examples/ast-to-canvas-webfonts/index.html` in a browser.

## Notes

- The demo uses `WebFontManager` with remote font loading and browser-side caching.
- `CanvasContext` renders pages to canvas while using an internal SVG scene representation.
- This is meant for browser display workflows such as preview surfaces and embedded UI rendering.
