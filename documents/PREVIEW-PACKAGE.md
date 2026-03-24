# VMPrint Preview Package Design

This document defines the proposed architecture for a standalone browser preview package tentatively named `@vmprint/preview`.

The goal is simple:

- accept a VMPrint AST document
- expose a script-first browser API
- render onto caller-provided canvases
- hide font-manager complexity by default
- support export without forcing users into a UI component abstraction

## Product Position

`@vmprint/preview` is not a viewer UI kit.

It is a browser-oriented rendering controller that lets application code:

- load a VMPrint document
- inspect page count and page size
- render pages to any `HTMLCanvasElement`
- export PDF
- export SVG when full-font rendering is active

Consumers own the DOM, the layout, the thumbnail strategy, and the user interface.

## Why Script-First

This package should be script-first rather than Web-Component-first.

Reasons:

- callers may want one canvas, many canvases, or a virtualized thumbnail strip
- callers may already have React, Vue, Svelte, or plain DOM UI
- the open-source surface should stay low-opinion and composable
- the rendering core is more valuable than a bundled shell

Nothing in this design prevents later wrappers such as a Web Component or framework adapters, but those are not the foundation.

## Core Architecture

`@vmprint/preview` presents one native preview strategy behind a simple public API.

### Preview Mode

Uses:

- `WebFontManager`
- `CanvasContext`

Pipeline:

1. resolve document
2. load real font binaries through `WebFontManager`
3. layout with actual font data
4. render to `CanvasContext`
5. paint SVG-backed page scenes into caller-supplied canvases

Purpose:

- VMPrint-native preview
- default hosted fallback font repository for quick starts
- caller-hosted font repositories and catalogs
- advanced explicit font registration
- SVG export

### Unified PDF Export

PDF export should be available through `PdfLiteContext` alongside the preview path.

That means:

- preview uses `CanvasContext`
- PDF export uses `PdfLiteContext`

This is acceptable even though PDF-lite is not perfect for bidi-heavy documents. It is still good enough as the package-wide PDF export baseline, while SVG remains the high-fidelity sidecar export path.

## Mode Selection

The package supports two public mode values:

- `auto`
- `full`

Recommended default: `auto`

`auto` selection rule:

- `auto` should resolve to the native preview pipeline
- the default hosted fallback font repo should provide first-run gratification
- callers can override the font source story when they need more control

## Public API

The main entry point should be a factory function:

```ts
const preview = await createPreview(documentInput, options);
```

### Document Input

Accept:

- AST object
- JSON string

The package should normalize internally and reject invalid top-level shapes with clear errors.

### Proposed Options

```ts
type PreviewMode = 'auto' | 'full';

type PreviewOptions = {
  mode?: PreviewMode;
  textRenderMode?: 'text' | 'glyph-path';
  fonts?: {
    repositoryBaseUrl?: string;
    catalogUrl?: string;
    cache?: boolean;
    aliases?: Record<string, string>;
    fonts?: Array<{
      name: string;
      family: string;
      weight?: number;
      style?: 'normal' | 'italic';
      src: string;
      enabled?: boolean;
      fallback?: boolean;
      unicodeRange?: string;
    }>;
  };
  onFontProgress?: (event: unknown) => void;
};
```

Notes:

- `textRenderMode` applies to the preview scene
- no raw `fontManager` injection in v1; the package owns that complexity
- the default fallback path should use VMPrint's hosted font repository

If an escape hatch is needed later, it can be added deliberately.

### Preview Session Interface

```ts
type PreviewSession = {
  getMode(): 'full';
  getPageCount(): number;
  getPageSize(pageIndex?: number): { width: number; height: number };
  isDestroyed(): boolean;
  renderPageToCanvas(
    pageIndex: number,
    target: HTMLCanvasElement,
    options?: { scale?: number; dpi?: number; clear?: boolean; backgroundColor?: string }
  ): Promise<void>;
  exportPdf(): Promise<Uint8Array>;
  exportSvgPage(pageIndex: number): Promise<string>;
  exportSvgPages(): Promise<string[]>;
  updateDocument(nextDocumentInput: unknown): Promise<void>;
  destroy(): void;
};
```

Behavior notes:

- after `destroy()`, all public methods except `isDestroyed()` throw a clear lifecycle error
- `renderPageToCanvas()` uses the native preview path
- `updateDocument()` rebuilds the active internal pipeline
- `destroy()` releases caches and event listeners

### Lifecycle Safety

`destroy()` is easy for consumers to forget and hard to debug when misuse becomes a no-op.

So the session should be explicitly stateful:

- `destroy()` is idempotent
- `isDestroyed()` returns the current lifecycle state
- calling `renderPageToCanvas()`, `updateDocument()`, `exportPdf()`, or SVG export methods after destroy throws a clear error
- the error message should include that the session has already been destroyed and recommend creating a new preview session

Recommended error shape:

```ts
throw new Error('[VMPrintPreview] renderPageToCanvas() called after destroy(). Create a new preview session.');
```

This is intentionally loud. Silent failure here would be much harder to diagnose.

If we later want softer lifecycle aids, an optional development-only warning mechanism can be added, but the baseline v1 behavior should still be a hard failure on use-after-destroy.

## Multi-Canvas and Thumbnail Ergonomics

The package should not own thumbnail UI, but it must make it easy.

This is achieved by:

- allowing repeated `renderPageToCanvas()` calls against any caller-created canvases
- keeping session/page state reusable across renders
- avoiding any built-in coupling to a single canvas

Example:

```ts
const preview = await createPreview(doc);

await preview.renderPageToCanvas(0, mainCanvas, { scale: 1 });
await preview.renderPageToCanvas(0, thumbnailCanvas, { scale: 0.2 });
```

This is the core ergonomic win over a component-owned canvas.

## Internal Structure

Suggested internal modules:

- `src/index.ts`
- `src/create-preview.ts`
- `src/types.ts`
- `src/normalize-document.ts`
- `src/preview-session.ts`
- `src/renderers/preview-renderer.ts`
- `src/export/pdf-export.ts`
- `src/export/svg-export.ts`

Renderer contracts can stay private in v1.

## Renderer Responsibilities

### Preview Renderer

Owns:

- `WebFontManager`
- engine runtime creation for real-font documents
- `CanvasContext` rendering
- SVG page extraction
- page painting into canvases
- optional font progress wiring
- PDF export through a parallel `PdfLiteContext` render

## Export Guarantees

### Always Available

- `renderPageToCanvas()`
- `exportPdf()`
- `exportSvgPage()`
- `exportSvgPages()`

## Error Model

Errors should be explicit and mode-aware.

Examples:

- invalid AST input
- requested page index out of range
- full mode requested without usable font sources after all configured sources fail

When possible, errors should state:

- which mode was active
- which stage failed
- what the caller can do next

## Events and Progress

The package should expose font progress as a callback, not a second object.

```ts
const preview = await createPreview(doc, {
  mode: 'full',
  onFontProgress(event) {
    console.log(event);
  }
});
```

This keeps font management hidden while still giving apps visibility.

Additional event emitter infrastructure is not required in v1.

## Non-Goals for V1

- built-in DOM viewer UI
- built-in toolbar
- built-in thumbnail strip
- annotation system
- text selection
- accessibility overlays
- virtualization helpers
- framework-specific wrappers
- custom element shipping as the primary product

These can be built later on top of the script-first surface.

## Recommended V1 Scope

Ship:

- `createPreview()`
- `mode: auto | full`
- native canvas page rendering
- PDF export
- SVG export
- document update support
- font progress callback

Defer:

- wrapper components
- convenience DOM helpers
- advanced cache controls
- custom renderer injection

## Summary

`@vmprint/preview` should present one simple browser API over one native preview strategy:

- preview: `WebFontManager + CanvasContext`
- PDF export: `PdfLiteContext`

This gives VMPrint a preview package that is:

- easy to adopt
- open-source friendly
- script-first
- export-capable
- practical today with a hosted fallback font repo and a clear path to caller-managed fonts
