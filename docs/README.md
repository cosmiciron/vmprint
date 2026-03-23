# VMPrint Docs

Documentation and static examples live under this directory.

## Live Examples (GitHub Pages)

- [Examples landing page](https://cosmiciron.github.io/vmprint/examples/index.html)
- [AST → PDF](https://cosmiciron.github.io/vmprint/examples/ast-to-pdf/index.html)
- [AST → PDF with web fonts](https://cosmiciron.github.io/vmprint/examples/ast-to-pdf-webfonts/index.html)
- [AST → Canvas with web fonts](https://cosmiciron.github.io/vmprint/examples/ast-to-canvas-webfonts/index.html)
- [Markdown → AST](https://cosmiciron.github.io/vmprint/examples/mkd-to-ast/index.html)

## Source Files (Repository)

- Examples landing page: [`examples/index.html`](examples/index.html)
- AST → PDF: [`examples/ast-to-pdf/index.html`](examples/ast-to-pdf/index.html)
- AST → PDF with web fonts: [`examples/ast-to-pdf-webfonts/index.html`](examples/ast-to-pdf-webfonts/index.html)
- AST → Canvas with web fonts: [`examples/ast-to-canvas-webfonts/index.html`](examples/ast-to-canvas-webfonts/index.html)
- Markdown → AST: [`examples/mkd-to-ast/index.html`](examples/mkd-to-ast/index.html)

## What These Examples Mean

These are not toy demos. Each one is a complete VMPrint pipeline running entirely client-side — no backend, no server, no Headless Chrome:

- **AST → PDF** — `StandardFontManager + Engine + PdfLiteContext`, deterministic layout and simulation, PDF-14 font coverage, zero runtime dependencies. Runnable from `file://` or GitHub Pages.
- **AST → PDF with web fonts** — same pipeline with `@vmprint/web-fonts` for remote font loading, enabling custom typography and broad multilingual shaping in the browser.
- **AST → Canvas with web fonts** — `@vmprint/context-canvas` renders SVG-backed page scenes into a canvas target for live browser preview, combined with `@vmprint/web-fonts` for remote font loading.
- **Markdown → AST** — full Markdown transmutation pipeline producing a VMPrint `DocumentInput` in the browser.

In practice, this enables production-class document generation in browser-native products and constrained environments where server-side rendering is costly or unavailable — embedded webviews, offline apps, kiosk/edge deployments, hybrid mobile wrappers, Cloudflare Workers.

## Distribution Footprint (AST → PDF, standard fonts)

The core runtime ships at about **~182 KiB Brotli** — engine, layout simulation, PDF rendering, and standard font metrics, all in.

Download the files into a local folder, open `index.html`, and the demo runs immediately with **zero runtime dependencies**.

| Artifact | Raw | Gzip | Brotli |
|---|---:|---:|---:|
| Runtime (`index.html` + `styles.css` + `assets/*.js`) | 727,383 B (~710 KiB) | 227,878 B (~223 KiB) | 186,547 B (~182 KiB) |
| Runtime + built-in fixtures (`fixtures/*.js`) | 3,441,750 B (~3.28 MiB) | 2,242,504 B (~2.14 MiB) | 2,182,080 B (~2.08 MiB) |

## Notes

- **Why the fixture payload is larger:** `fixtures/14-flow-images-multipage.js` contains large embedded base64 image data and dominates total size.
- **Why runtime stays small:** standard-font mode avoids bundling custom font binaries and skips runtime font downloads entirely.
- **Why it feels instant:** these examples execute the full pipeline on every click — AST parse → simulation → render → PDF bytes — including computationally heavy layout cases. Nothing is hardcoded or pre-baked. If it feels instant, that is real runtime performance measured in milliseconds.
- **Font coverage trade-off:** the standard-font demo covers PDF-14 fonts only. For custom fonts and broader multilingual shaping, use `@vmprint/web-fonts` or a local font manager workflow.
