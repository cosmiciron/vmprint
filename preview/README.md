# @vmprint/preview

Browser preview controller for VMPrint.

`@vmprint/preview` is the thin browser-facing layer over the VMPrint layout engine. You give it a normal VMPrint document object, it runs layout in the browser, and then lets your UI render, inspect, select, and export the result without inventing a second rendering system.

This repo is now the standalone home of that preview package.

## Why This Instead Of `react-pdf`

If your problem is "I want to describe pages by writing React components," then `react-pdf` is a coherent tool.

If your problem is "I need a real layout engine, a real browser preview, real pagination behavior, and exports that come from the same layout result," this is a much better fit.

That is the central pitch of this repo.

`@vmprint/preview` is not trying to turn document layout into JSX. It is trying to expose a document engine cleanly in the browser.

In practice, that means:

- you are not forced to model documents as a React component tree
- you are not locked into React as the authoring surface
- the preview is not a separate approximation layer from the exported result
- selection, hit-testing, overlays, and export all sit on top of the same engine output
- you can feed it documents produced by transmuters, pipelines, CMSs, editors, or your own source format without rebuilding your app around React rendering

For the kind of workflow VMPrint is aimed at, that is not a small improvement over `react-pdf`. It is a fundamentally better architecture.

## What It Does

With one preview session, you can:

- render any page to a canvas you own
- export that same layout to PDF
- export pages to SVG
- inspect layout snapshots for custom UI overlays
- inspect interaction snapshots for hit-testing and text selection
- build your own selection/highlight experience on top of the engine's interaction model

The important part is that all of those outputs come from the same layout pass. The browser preview is not a visual approximation of the final document. It is another view over the same engine result.

Another way to say it: this package is for teams who want document layout to behave like infrastructure, not like a React-only rendering trick.

## Install

```bash
npm install @vmprint/preview
```

## Quick Start

```ts
import { createVMPrintPreview } from '@vmprint/preview';

const preview = await createVMPrintPreview(documentInput);

await preview.renderPageToCanvas(0, canvas, {
  dpi: 144,
  backgroundColor: '#ffffff'
});
```

The `documentInput` value is a normal VMPrint document object. Internally the preview boots through the engine's `loadDocument(...)` path, so the preview stays aligned with the current engine document-loading surface.

## Typical Usage

```ts
import { createVMPrintPreview } from '@vmprint/preview';

const preview = await createVMPrintPreview(documentInput, {
  onFontProgress(event) {
    console.log(event.phase, event.percent);
  }
});

const pageCount = preview.getPageCount();
const { width, height } = preview.getPageSize();

await preview.renderPageToCanvas(0, canvas, {
  scale: 2,
  dpi: 144,
  clear: true,
  backgroundColor: '#ffffff'
});

const pdfBytes = await preview.exportPdf();
const svg = await preview.exportSvgPage(0, { textMode: 'text' });
```

## Deferred Boot

If your app wants to create the controller before it has a document ready:

```ts
const preview = await createVMPrintPreview();

await preview.updateDocument(documentInput);
await preview.renderPageToCanvas(0, canvas);
```

Calling render or export methods before `updateDocument(...)` throws.

## Interaction And Selection

The preview surface is not limited to raster output. The session also exposes interaction data for building richer browser tooling.

Useful methods include:

- `getLayoutSnapshotPages()`
- `getInteractionSnapshotPages()`
- `hitTestPageInteraction(pageIndex, x, y)`
- `createPageSelectionPoint(pageIndex, x, y)`
- `resolvePageSelection(pageIndex, anchor, focusPoint, mode?)`
- `buildPageInteractionOverlay(pageIndex, selection, selectedTargetId?)`
- `getPageInteractionSelectionText(pageIndex, selection)`
- `getPageInteractionSelectionMarkdown(pageIndex, selection)`

That means the package can support things like:

- clickable document regions
- text selection overlays
- copy-as-text
- copy-as-markdown
- custom annotation or review UI

## Public API

```ts
createVMPrintPreview(documentInput?: unknown, options?: PreviewOptions): Promise<PreviewSession>
```

Core session methods:

- `getPageCount()`
- `getPageSize()`
- `renderPageToCanvas(pageIndex, target, options?)`
- `exportPdf()`
- `exportSvgPage(pageIndex, options?)`
- `exportSvgPages(options?)`
- `updateDocument(nextDocumentInput)`
- `destroy()`

## Fonts

By default the preview uses the VMPrint web font manager plus the VMPrint local font catalog metadata. You can override font loading with `options.fonts`, including:

- `repositoryBaseUrl`
- `catalogUrl`
- `aliases`
- `fonts`
- `cache`

`onFontProgress` receives download and cache events so you can wire a proper progress indicator into your UI.

## Repository Layout

The repo is intentionally small and focused:

- [src](C:/Users/cosmic/Projects/vmprint-preview/src) contains the preview package source
- [playground](C:/Users/cosmic/Projects/vmprint-preview/playground) contains the standalone browser demo
- [scripts](C:/Users/cosmic/Projects/vmprint-preview/scripts) contains the package build script and the tiny local playground server

## Playground

The playground is included as a no-build local example for developing the preview package itself.

It is intentionally separate from the published package output:

- it is not included in the npm tarball
- it uses a browser-ready local bundle so it stays in sync with the repo source
- it is meant to exercise the richer local preview surface, including interaction and selection behavior

If you want to run it locally:

```bash
node scripts/playground-server.cjs
```

Then open:

```text
http://127.0.0.1:4173/
```

## Build And Package

Build the package:

```bash
npm run build
```

Dry-run the published tarball:

```bash
npm pack --dry-run
```

The published package is intentionally lean and currently ships only:

- `dist/index.cjs`
- `dist/index.mjs`
- `dist/types/index.d.ts`
- `README.md`
- `LICENSE`

## Notes

- This repo should not depend on sibling directories or sibling repos.
- The old monorepo-era dashboard and demo build flow are gone.
- The preview package is meant to stay small at the API layer, even when the local playground demonstrates richer behavior.

## License

Apache-2.0
