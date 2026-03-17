# @vmprint/contracts

The shared interface layer for the vmprint ecosystem.

## What This Is

`@vmprint/contracts` defines the TypeScript interfaces that every piece of vmprint speaks across. The engine, rendering contexts, font managers, and overlay providers all talk to each other through these contracts — not through concrete implementations.

The package has **zero dependencies**. It contains no runtime code. After compilation, the `dist/` is type declaration files and structurally empty JavaScript modules — interfaces are erased by TypeScript. The install footprint is negligible.

## Why It Exists Separately

The conventional approach is to put shared types inside the main package and re-export them. The problem with that is anyone who wants to implement one of the interfaces — a custom font manager, a rendering context for a new target — has to take the whole engine as a dependency to get the types.

The engine has real weight. Its dependency tree includes fontkit (~1.1 MiB packed) for glyph metric parsing. That's appropriate for the engine. It's not appropriate for a rendering context that just needs to know the shape of `Context`, or a font manager that just needs to know the shape of `FontManager`.

`@vmprint/contracts` breaks that coupling. You depend on contracts. You implement the interface. You publish your package. The engine is not in your dependency tree unless you actually need the engine.

```
@vmprint/contracts    (no dependencies)
       │
       ├── @vmprint/engine          (depends on contracts)
       ├── @vmprint/context-pdf     (depends on contracts)
       └── @vmprint/local-fonts     (depends on contracts + engine)
```

## Interfaces

### `FontManager`

The contract for font loading and registry management. Implement this to provide fonts from any source — a CDN, object storage, a pre-loaded in-memory buffer, an OS font directory — without the engine caring where they came from.

```ts
interface FontManager {
  getFontRegistrySnapshot(): FontConfig[];
  resolveFamilyAlias(family: string): string;
  getAllFonts(registry: FontConfig[]): FontConfig[];
  getEnabledFallbackFonts(registry: FontConfig[]): FallbackFontSource[];
  getFontsByFamily(family: string, registry: FontConfig[]): FontConfig[];
  getFallbackFamilies(registry: FontConfig[]): string[];
  registerFont(config: FontConfig, registry: FontConfig[]): void;
  loadFontBuffer(src: string): Promise<ArrayBuffer>;
}
```

See [`font-managers/`](../font-managers/README.md) for the reference implementation and a guide to writing custom font managers.

### `VmprintOutputStream`

A portable output stream interface. Callers (e.g. the CLI) implement this against their specific I/O mechanism — a file write stream, an in-memory buffer, a web response — and pass it to a context via `pipe()`. This keeps Node.js and platform I/O concerns out of both the context contract and any context implementation.

```ts
interface VmprintOutputStream {
  write(chunk: Uint8Array | string): void;
  end(): void;
  waitForFinish(): Promise<void>;
}
```

### `Context`

The rendering surface contract. Implement this to paint vmprint's layout output to any target: PDF, SVG, canvas, a DOM surface, a test spy.

```ts
interface Context {
  addPage(): void;
  end(): void;
  pipe(stream: VmprintOutputStream): void;  // no-op if output streaming is not supported
  registerFont(id: string, buffer: Uint8Array, options?: { standardFontPostScriptName?: string }): Promise<void>;
  font(family: string, size?: number): this;
  fontSize(size: number): this;
  save(): void;
  restore(): void;
  translate(x: number, y: number): this;
  rotate(angle: number, originX?: number, originY?: number): this;
  opacity(opacity: number): this;
  fillColor(color: string): this;
  strokeColor(color: string): this;
  lineWidth(width: number): this;
  dash(length: number, options?: { space: number }): this;
  undash(): this;
  moveTo(x: number, y: number): this;
  lineTo(x: number, y: number): this;
  rect(x: number, y: number, w: number, h: number): this;
  roundedRect(x: number, y: number, w: number, h: number, r: number): this;
  fill(rule?: 'nonzero' | 'evenodd'): this;
  stroke(): this;
  fillAndStroke(fillColor?: string, strokeColor?: string): this;
  text(str: string, x: number, y: number, options?: ContextTextOptions): this;
  image(source: string | Uint8Array, x: number, y: number, options?: ContextImageOptions): this;
  getSize(): { width: number; height: number };
}
```

`pipe()` is required on the interface but may be a no-op. Contexts that manage their own output (e.g. accumulate bytes in memory and expose them through their own API) simply implement it as `pipe(_stream) {}`. Contexts that support streaming — like `PdfContext` — write rendered output into the stream as pages are produced. The caller owns the stream and calls `waitForFinish()` on it after rendering is complete.

See [`contexts/`](../contexts/README.md) for the reference implementation and a guide to writing custom contexts.

### `OverlayProvider`

A hook for drawing before and after page content without modifying the layout. Used for watermarks, debug grids, crop marks, confidentiality banners, and print production marks.

```ts
interface OverlayProvider {
  backdrop?(page: OverlayPage, context: OverlayContext): void;
  overlay?(page: OverlayPage, context: OverlayContext): void;
}
```

- `backdrop` — called before the page content is painted. Draws appear behind all page elements.
- `overlay` — called after the page content is painted. Draws appear on top.

Both methods receive `OverlayPage`, which carries the page dimensions and the full box tree from the layout pass. This means overlays can make layout-aware decisions — position a watermark relative to the text area, draw margin rules at the exact margin coordinates, highlight specific box types for debugging.

`OverlayContext` is a drawing-only subset of `Context`: the full shape and styling API, without the document lifecycle methods (`addPage`, `end`) or font registration. The rendering context handles those; the overlay just draws.

```ts
interface OverlayPage {
  readonly index: number;
  readonly width: number;
  readonly height: number;
  readonly boxes: readonly OverlayBox[];
}
```

A minimal watermark example:

```ts
import { OverlayProvider, OverlayPage, OverlayContext } from '@vmprint/contracts';

class DraftWatermark implements OverlayProvider {
  overlay(page: OverlayPage, ctx: OverlayContext): void {
    ctx.save();
    ctx.opacity(0.08);
    ctx.fillColor('#000000');
    ctx.font('Helvetica', 72);
    ctx.translate(page.width / 2, page.height / 2);
    ctx.rotate(-45);
    ctx.text('DRAFT', -120, -36);
    ctx.restore();
  }
}
```

### `Transmuter`

The contract for author-facing source conversion. Implement this to convert specific source formats (like Markdown) into VMPrint's `DocumentInput` AST.

```ts
interface Transmuter<Input = string, Output = unknown, Options = TransmuterOptions> {
  transmute(input: Input, options?: Options): Output;
  getBoilerplate?(): string;
}
```

- `transmute` — converts input source into typeset boxes or a document IR.
- `getBoilerplate` — (Optional) returns a recommended configuration block (e.g., YAML) to assist users in setting up a new document for this transmuter's format.

This decoupling allows tools like `draft2final` to orchestrate multiple input formats and default configurations without being coupled to the internal logic of any specific format.

### `SourceTransformer`

The contract for engine-facing source preparation. Implement this to take a source model such as `DocumentInput` and transform it into the engine-ready representation used by a particular runtime path.

```ts
interface SourceTransformer<Input = unknown, Output = unknown> {
  transform(input: Input): Output;
}
```

This sits downstream of transmuters:

- transmuters are author-facing and choose how source is expressed
- source transformers are engine-facing and choose how that source is prepared for a runtime

In the current workspace, `@vmprint/source-transformer-ast` is the compatibility implementation that takes the legacy AST-shaped `DocumentInput` and produces the normalized document/config/Spatial IR artifacts used by the refactor path.

## Usage

```bash
npm install @vmprint/contracts
```

```ts
import type { FontManager, Context, OverlayProvider, SourceTransformer } from '@vmprint/contracts';
```

Because all exports are TypeScript interfaces, the import adds no runtime weight — types are fully erased at compile time. Importing `@vmprint/contracts` in a production build costs exactly zero bytes.
