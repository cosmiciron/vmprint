# VMPrint Docs

Documentation and static examples live under this directory.

## Live Examples (GitHub Pages)

- Examples landing page (live): <https://cosmiciron.github.io/vmprint/examples/index.html>
- AST JSON -> PDF demo (live): <https://cosmiciron.github.io/vmprint/examples/ast-to-pdf/index.html>
- Markdown -> AST demo (live): <https://cosmiciron.github.io/vmprint/examples/mkd-to-ast/index.html>

## Source Files (Repository)

- Examples landing page source: [`examples/index.html`](examples/index.html)
- AST JSON -> PDF source: [`examples/ast-to-pdf/index.html`](examples/ast-to-pdf/index.html)
- Markdown -> AST source: [`examples/mkd-to-ast/index.html`](examples/mkd-to-ast/index.html)

## What These Examples Mean

These are not toy demos. They show a full VMPrint pipeline running entirely client-side:

- `StandardFontManager + Engine + PdfLiteContext`
- deterministic layout + pagination
- no backend runtime at usage time
- runnable from `file://` and GitHub Pages

In practice, this enables production-class document generation in browser-native products and constrained environments where server-side rendering is costly or unavailable (embedded webviews, offline apps, kiosk/edge deployments, hybrid mobile wrappers).

## Distribution Footprint (AST -> PDF Demo, 2026-03-06)

**Attention point:** the core runtime ships at about **~182 KiB Brotli** (`index.html` + `styles.css` + `assets/*.js`).

If you download these files into a local folder, you can open `index.html` and run the demo immediately with **zero runtime dependencies** (no Node.js process, no server, no external service).

| Artifact | Raw | Gzip | Brotli |
|---|---:|---:|---:|
| Runtime (`index.html` + `styles.css` + `assets/*.js`) | 727,383 B (~710 KiB) | 227,878 B (~223 KiB) | 186,547 B (~182 KiB) |
| Runtime + built-in fixtures (`fixtures/*.js`) | 3,441,750 B (~3.28 MiB) | 2,242,504 B (~2.14 MiB) | 2,182,080 B (~2.08 MiB) |

## Demystification

- Why the fixture payload is larger:
  `fixtures/14-flow-images-multipage.js` contains large embedded base64 image data and dominates total size.
- Why runtime stays small:
  standard-font mode avoids bundling custom font binaries and avoids runtime font download.
- Why it feels instant:
  these examples still execute the full pipeline (AST parse -> pagination -> render -> PDF bytes) on every click, including computationally heavy layout cases. **Nothing is hardcoded or pre-baked at click time; if it feels instant, that is real runtime performance measured in milliseconds**.
- What you trade off:
  PDF-14 font coverage only in this mode. For custom fonts and broader multilingual shaping, use a font-binary workflow (`LocalFontManager` or another font manager).
