# Quickstart

## Render a document

```bash
npm install @vmprint/engine @vmprint/local-fonts @vmprint/context-pdf
```

```ts
import { VMPrintEngine, loadDocument } from '@vmprint/engine';
import LocalFontManager from '@vmprint/local-fonts';
import { PdfContext } from '@vmprint/context-pdf';
import { createWriteStream } from 'fs';

const doc = loadDocument(JSON.parse(await fs.readFile('document.json', 'utf8')));
const engine = new VMPrintEngine(doc, new LocalFontManager());

const stream = createWriteStream('output.pdf');
const context = new PdfContext(stream);
await engine.render(context);
await context.waitForFinish();
```

`render()` runs layout and renders in one call. To inspect pages before rendering:

```ts
const pages = await engine.layout();
console.log(`${pages.length} pages, ${engine.info.pageSize.width}×${engine.info.pageSize.height}pt`);
await engine.render(context);
```

For a prefix preview or an incremental flow tool, limit layout to a page prefix:

```ts
const firstTwoPages = await engine.layout({ stopAtPage: 1 });
```

`stopAtPage` is zero-based and inclusive.

## Document shape

Documents are JSON objects conforming to AST version `1.1`:

```json
{
  "documentVersion": "1.1",
  "layout": {
    "pageSize": "A4",
    "margins": { "top": 72, "right": 72, "bottom": 72, "left": 72 },
    "fontFamily": "Tinos",
    "fontSize": 12,
    "lineHeight": 1.4
  },
  "elements": [
    { "type": "story", "content": "Hello, world." }
  ]
}
```

Use `layout.pageTemplates` when individual pages need different dimensions or
margins. The engine resolves those templates before measuring each page, and PDF
rendering preserves the resulting per-page media size.

Built-in font families (`Arimo`, `Tinos`, `Cousine`, `Caladea`, `Carlito`, and Noto variants for CJK/Arabic/Thai/Devanagari) require no `fonts` block. For custom font files, add a role map:

```json
"fonts": {
  "regular":    "fonts/MyFont-Regular.ttf",
  "bold":       "fonts/MyFont-Bold.ttf",
  "italic":     "fonts/MyFont-Italic.ttf",
  "bolditalic": "fonts/MyFont-BoldItalic.ttf"
}
```

See [guides/](guides/) for the full element reference and layout options.

## CLI

For batch JSON-to-PDF workflows, use the `vmprint` CLI:

```bash
npm install -g @vmprint/cli
vmprint --input document.json --output output.pdf
```

See [cli/QUICKSTART.md](cli/QUICKSTART.md) for all flags.
