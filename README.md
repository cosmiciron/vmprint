# VMPrint

VMPrint is a deterministic typesetting engine for programmable document layout. It shapes source content into a flat, inspectable `Page[]` model and renders that model through interchangeable output contexts such as PDF.

It is not a browser wrapper. There is no HTML, no CSS layout engine, and no hidden DOM pass underneath the API. VMPrint owns layout directly: shaping, pagination, float avoidance, split behavior, provenance metadata, and rendering handoff.

## What It Does

- Deterministic pagination with reproducible `Page[]` output
- Multi-column story flow, floats, tables, drop caps, and continuation markers
- Bidirectional and mixed-script layout without a browser dependency
- Swappable font managers and rendering contexts
- JSON-native intermediate output for regression testing and precompilation
- Overlay hooks for diagnostics, print marks, and instrumentation

## Monorepo Packages

| Package | Purpose |
| --- | --- |
| `@vmprint/contracts` | Shared interfaces for contexts, font managers, overlays, and streams |
| `@vmprint/engine` | Core layout, shaping, pagination, and rendering pipeline |
| `@vmprint/context-pdf` | PDFKit-backed PDF output context |
| `@vmprint/context-pdf-lite` | Lightweight jsPDF-backed PDF output context for browser demos |
| `@vmprint/local-fonts` | Local filesystem font manager with bundled fonts |
| `@vmprint/standard-fonts` | Standard PDF font manager with no embedded font binaries |
| `@vmprint/cli` | `vmprint` CLI for JSON-to-PDF workflows |
| `draft2final` | Markdown-first authoring CLI built on VMPrint |
| `@vmprint/transmuter-mkd-mkd` | Markdown to DocumentInput |
| `@vmprint/transmuter-mkd-academic` | Academic-flavored Markdown to DocumentInput |
| `@vmprint/transmuter-mkd-literature` | Literature-flavored Markdown to DocumentInput |
| `@vmprint/transmuter-mkd-manuscript` | Manuscript-flavored Markdown to DocumentInput |
| `@vmprint/transmuter-mkd-screenplay` | Screenplay-flavored Markdown to DocumentInput |

## Getting Started

Prerequisites:

- Node.js 18+
- npm 9+

```bash
git clone https://github.com/cosmiciron/vmprint.git
cd vmprint
npm install
npm run build
```

Render a JSON document to PDF with the repo CLI:

```bash
npm run dev --prefix cli -- --input engine/tests/fixtures/regression/00-all-capabilities.json --output out.pdf
```

Render Markdown to PDF with `draft2final`:

```bash
npm run dev --prefix draft2final -- samples/draft2final/source/manuscript/manuscript-sample.md --as manuscript --out manuscript.pdf
```

## Engine API

```ts
import fs from 'node:fs';
import {
  LayoutEngine,
  Renderer,
  createEngineRuntime,
  resolveDocumentPaths,
  toLayoutConfig
} from '@vmprint/engine';
import PdfContext from '@vmprint/context-pdf';
import LocalFontManager from '@vmprint/local-fonts';

const source = JSON.parse(fs.readFileSync('document.json', 'utf8'));
const documentInput = resolveDocumentPaths(source, 'document.json');

const runtime = createEngineRuntime({ fontManager: new LocalFontManager() });
const config = toLayoutConfig(documentInput, false);
const engine = new LayoutEngine(config, runtime);

await engine.waitForFonts();
const pages = engine.simulate(documentInput.elements);

const context = new PdfContext({
  size: [612, 792],
  margins: { top: 0, right: 0, bottom: 0, left: 0 },
  autoFirstPage: false,
  bufferPages: false
});

const fileStream = fs.createWriteStream('output.pdf');
context.pipe({
  write(chunk) { fileStream.write(chunk); },
  end() { fileStream.end(); },
  waitForFinish() {
    return new Promise((resolve, reject) => {
      fileStream.once('finish', resolve);
      fileStream.once('error', reject);
    });
  }
});

const renderer = new Renderer(config, false, runtime);
await renderer.render(pages, context);
```

Use standard PDF fonts only:

```ts
import { createEngineRuntime } from '@vmprint/engine';
import StandardFontManager from '@vmprint/standard-fonts';

const runtime = createEngineRuntime({ fontManager: new StandardFontManager() });
```

## Verification

These are the repo-level commands that should stay green for a release:

```bash
npm run build
npm run test --prefix engine
npm run docs:build
npm run test:packaged-integration
```

## Documentation

- [Quickstart](QUICKSTART.md)
- [Architecture](documents/ARCHITECTURE.md)
- [Testing](documents/TESTING.md)
- [Docs Index](docs/README.md)
- [Authoring Guide](documents/authoring/README.md)

## License

Apache-2.0. See [LICENSE](LICENSE).
