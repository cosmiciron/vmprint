# AST JSON to PDF (Static Browser Example)

This example demonstrates the VMPrint pipeline running entirely in-browser:

- `@vmprint/engine`
- `@vmprint/standard-fonts`
- `@vmprint/context-pdf-lite`

Input is AST JSON, output is a downloadable PDF blob. No server runtime is required.

## Build

From repository root:

```bash
npm run docs:build
```

This emits browser-ready scripts to:

- `docs/examples/ast-to-pdf/assets/vmprint-engine.js`
- `docs/examples/ast-to-pdf/assets/vmprint-standard-fonts.js`
- `docs/examples/ast-to-pdf/assets/vmprint-context-pdf-lite.js`
- `docs/examples/ast-to-pdf/assets/pipeline.js`
- `docs/examples/ast-to-pdf/assets/ui.js`
- `docs/examples/ast-to-pdf/fixtures/*.js` (built-in AST fixtures, loaded on demand)

## Run Locally (no web server)

Open `docs/examples/ast-to-pdf/index.html` directly in a browser (`file://`).

## Run on GitHub Pages

Serve the `docs/` folder with GitHub Pages and visit:

- `/examples/index.html`
- `/examples/ast-to-pdf/index.html`

## Notes

- This example uses `StandardFontManager`, so font coverage is limited to standard PDF fonts.
- Scripts are split by pipeline component to keep embedding modular and explicit.

## Size Snapshot (2026-03-06)

Measured from the built, deployable files (`index.html`, `styles.css`, `assets/*.js`, `fixtures/*.js`):

- Runtime only (`index.html` + `styles.css` + `assets/*.js`): `727,383 B` raw, `227,878 B` gzip, `186,547 B` brotli.
- Runtime + built-in fixtures: `3,441,750 B` raw, `2,242,504 B` gzip, `2,182,080 B` brotli.

Most of the fixture weight is in `fixtures/14-flow-images-multipage.js` (embedded base64 image payload).
