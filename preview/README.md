# @vmprint/preview

**Canvas preview + PDF export + SVG export — in one compact, dependency-light browser package.**

Most browser document tools only do one thing: jsPDF and pdfmake generate PDFs but have no preview — if you want to show the document to the user before downloading, you are on your own. The only mainstream option that does both is React-PDF, which achieves preview by bundling PDF.js, a full PDF interpreter. That gets you React as a hard dependency, a large bundle, and a rendering model locked to whatever PDF.js can parse.

`@vmprint/preview` is a thin browser controller over the [VMPrint](https://github.com/cosmiciron/vmprint) layout engine — the same engine that drives server-side PDF generation. Layout runs once, natively; canvas preview, PDF, and SVG are all produced from the same layout result, with no PDF.js, no React, and no server round-trip. Behind that simple API sits a full professional typesetting stack: multi-column layouts, zone maps, table flow, drop caps, widow/orphan control, header/footer strips, and precise OpenType glyph rendering.

```bash
npm install @vmprint/preview
```

## What you get

- **Canvas rendering** — draw any page to an `HTMLCanvasElement`, `OffscreenCanvas`, or a raw 2D context you own
- **PDF export** — `Uint8Array` ready to save or upload, prepared in parallel with the initial render
- **SVG export** — portable glyph-path SVG, or searchable `<text>`-mode SVG with embedded fonts
- **Full layout engine** — multi-column, tables, zone maps, images, floats, scripts — not a toy renderer
- **Zero-config fonts** — downloads from the VMPrint CDN, caches in IndexedDB automatically; bring your own CDN or register fonts inline
- **Unicode fallback coverage** — the font manager selects and loads only the Noto fallback subsets your document actually uses
- **Framework-agnostic** — plain async/await, no React or framework dependency required

## Quick start

```ts
import { createVMPrintPreview } from '@vmprint/preview';

const preview = await createVMPrintPreview(documentAst);
await preview.renderPageToCanvas(0, canvas);
```

`documentAst` is a VMPrint document object (`documentVersion: '1.1'`, `layout`, `elements`, …).

## Rendering multiple pages

```ts
const pageCount = preview.getPageCount();
const { width, height } = preview.getPageSize(); // in points

for (let i = 0; i < pageCount; i++) {
    await preview.renderPageToCanvas(i, canvases[i]);
}
```

`renderPageToCanvas` accepts an optional third argument for scaling and background:

```ts
await preview.renderPageToCanvas(0, canvas, {
    scale: 2,              // physical pixel multiplier, default 1
    dpi: 144,              // alternative to scale — sets DPI relative to 72pt baseline
    clear: true,           // clear the canvas before drawing, default true
    backgroundColor: '#fff'
});
```

## PDF export

```ts
const pdfBytes = await preview.exportPdf(); // Uint8Array
```

PDF preparation starts in the background as soon as the document is loaded, so by the time the user clicks "Download" it is usually already done.

## SVG export

By default SVG is exported as glyph outlines — fully portable, no fonts required:

```ts
const svg = await preview.exportSvgPage(0);      // single page
const svgs = await preview.exportSvgPages();      // all pages
```

Pass `textMode: 'text'` to produce real `<text>` elements with embedded fonts — searchable and copy-pasteable:

```ts
const svg = await preview.exportSvgPage(0, { textMode: 'text' });
const svgs = await preview.exportSvgPages({ textMode: 'text' });
```

## Deferred document load

Create the session upfront and supply the document later — useful when you want to initialize early and load content on demand:

```ts
const preview = await createVMPrintPreview();

// later —
await preview.updateDocument(documentAst);
await preview.renderPageToCanvas(0, canvas);
```

`updateDocument` fully re-lays-out the document; subsequent calls swap in the new content without creating a new session.

Calling any render or export method before `updateDocument` throws `"requires a document. Call updateDocument() first."`.

## Font loading

Fonts are downloaded from the VMPrint CDN and cached in IndexedDB automatically — no configuration needed. Pass `onFontProgress` to show live download status in your UI:

```ts
const preview = await createVMPrintPreview(documentAst, {
    onFontProgress(event) {
        // event.phase: 'cache-hit' | 'downloading' | 'finalizing' | 'caching' | 'complete'
        // event.src, event.loadedBytes, event.totalBytes (optional), event.percent (optional)
        updateProgressBar(event.percent ?? 0);
    }
});
```

On repeat visits the same fonts return immediately with `phase: 'cache-hit'` from IndexedDB — no network request.

### Custom font CDN

Point the session at your own font repository:

```ts
const preview = await createVMPrintPreview(documentAst, {
    fonts: {
        repositoryBaseUrl: 'https://your-cdn.example.com/fonts/',
        cache: true
    }
});
```

### Register fonts inline

```ts
const preview = await createVMPrintPreview(documentAst, {
    fonts: {
        fonts: [
            {
                name: 'MyFont Regular',
                family: 'MyFont',
                weight: 400,
                style: 'normal',
                src: 'https://your-cdn.example.com/fonts/MyFont-Regular.ttf',
                enabled: true
            }
        ]
    }
});
```

### Fine-grained cache control

```ts
fonts: {
    cache: {
        persistent: true,
        dbName: 'my-app-fonts',
        storeName: 'font-blobs',
        namespace: 'v2'
    }
}
```

## Lifecycle

```ts
preview.isDestroyed(); // false
preview.destroy();     // releases all internal state
```

`destroy()` is idempotent. All public methods throw after it is called. Create a new session if you need to render again.

## API reference

```ts
createVMPrintPreview(documentAst?: unknown, options?: PreviewOptions): Promise<PreviewSession>

type PreviewOptions = {
    fonts?: {
        catalogUrl?: string;
        repositoryBaseUrl?: string;
        cache?: boolean | { persistent?: boolean; dbName?: string; storeName?: string; namespace?: string };
        aliases?: Record<string, string>;
        fonts?: PreviewFontSource[];
    };
    onFontProgress?: (event: WebFontProgressEvent) => void;
};

type RenderPageToCanvasOptions = {
    scale?: number;
    dpi?: number;
    clear?: boolean;
    backgroundColor?: string;
};

type SvgExportOptions = {
    textMode?: 'glyph-path' | 'text'; // default: 'glyph-path'
};

type PreviewSession = {
    getPageCount(): number;
    getPageSize(): { width: number; height: number };
    isDestroyed(): boolean;
    renderPageToCanvas(pageIndex: number, target: CanvasTarget, options?: RenderPageToCanvasOptions): Promise<void>;
    exportPdf(): Promise<Uint8Array>;
    exportSvgPage(pageIndex: number, options?: SvgExportOptions): Promise<string>;
    exportSvgPages(options?: SvgExportOptions): Promise<string[]>;
    updateDocument(nextDocumentInput: unknown): Promise<void>;
    destroy(): void;
};

// target can be any of:
type CanvasTarget =
    | HTMLCanvasElement
    | OffscreenCanvas
    | CanvasRenderingContext2D
    | OffscreenCanvasRenderingContext2D;
```

## Live example

A live interactive example is hosted at:
**https://cosmiciron.github.io/vmprint/examples/preview/**

Paste any VMPrint document AST, hit Render, then export to PDF or SVG — all in the browser.

## Running the example locally

The same example can be run from source:

```bash
npm run demo:build --workspace=preview
npm run demo:serve --workspace=preview
# → http://127.0.0.1:4173/
```

Or build it and open `preview/example/index.html` directly from disk — no dev server required.

## License

Apache-2.0
