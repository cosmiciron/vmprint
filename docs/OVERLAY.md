# Overlay Architecture

A lightweight extension layer for custom programmatic drawing in vmprint.

## Overview

The overlay architecture solves two problems:

1. Built-in debug visuals had become too broad and flag-heavy for everyday use.
2. There was no clean way to draw fixture- or scenario-specific diagnostics without changing engine code.

The implemented model is intentionally simple:

- Built-in debug overlay is minimal and always controlled by a single `debug` boolean.
- Custom drawing is injected through an `OverlayProvider` interface.
- The engine never loads overlay files directly; callers pass an overlay instance.

## Why This Design

### Keep the engine deterministic and small

The renderer only knows about interfaces, not module loading or dynamic runtime behavior.

### Avoid API drift

`OverlayContext` is a strict subset of the renderer `Context` contract. No parallel graphics API.

### Preserve coordinate intuition

Overlay coordinates are page-local points from the top-left, matching the box coordinate space.

### Keep failures loud

Overlay hooks are fail-fast. If overlay code throws, rendering fails immediately.

## Built-in Debug Overlay (Current Behavior)

The built-in debug overlay now includes only:

- Box boundary dashed rect
- Box type + coordinate/dimension label
- Page margin boundary rect
- Text baselines (subtle)

Removed from built-in debug:

- Page ruler
- Box Y markers
- Box margin lines
- Segment frames
- Reflow key labels
- Dropcap glyph bounds

Any specialized visualization should now be implemented as an overlay script.

## Core Interfaces

```typescript
// contracts/src/overlay.ts
import type { ContextTextOptions } from './context';

export interface OverlayPage {
    readonly index: number;
    readonly width: number;
    readonly height: number;
    readonly boxes: readonly OverlayBox[];
}

export interface OverlayBox {
    readonly type: string;
    readonly x: number;
    readonly y: number;
    readonly w: number;
    readonly h: number;
    readonly meta?: Readonly<Record<string, unknown>>;
    readonly properties?: Readonly<Record<string, unknown>>;
}

export interface OverlayContext {
    font(family: string, size?: number): this;
    fontSize(size: number): this;
    opacity(opacity: number): this;
    fillColor(color: string): this;
    strokeColor(color: string): this;
    lineWidth(width: number): this;
    dash(length: number, options?: { space: number }): this;
    undash(): this;
    moveTo(x: number, y: number): this;
    lineTo(x: number, y: number): this;
    bezierCurveTo(cp1x: number, cp1y: number, cp2x: number, cp2y: number, x: number, y: number): this;
    rect(x: number, y: number, w: number, h: number): this;
    roundedRect(x: number, y: number, w: number, h: number, r: number): this;
    fill(rule?: 'nonzero' | 'evenodd'): this;
    stroke(): this;
    fillAndStroke(fillColor?: string, strokeColor?: string): this;
    text(str: string, x: number, y: number, options?: ContextTextOptions): this;
    save(): void;
    restore(): void;
}

export interface OverlayProvider {
    backdrop?(page: OverlayPage, context: OverlayContext): void;
    overlay?(page: OverlayPage, context: OverlayContext): void;
}
```

## Render Lifecycle and Z-Order

Per page, the render order is:

1. Page creation/background
2. `overlay.backdrop(page, ctx)`
3. Box rendering (sorted by `zIndex`)
4. Minimal built-in debug overlay (when `debug` is true)
5. `overlay.overlay(page, ctx)`

This gives two explicit extension points:

- `backdrop` for behind-content guides
- `overlay` for top-layer annotations

No middle tier is provided between individual boxes by design.

## Renderer Integration

`Renderer` accepts an optional overlay in its constructor:

```typescript
new Renderer(config, debug, runtime, overlay?)
```

Internally:

- The engine maps internal `Page`/`Box` into readonly `OverlayPage`/`OverlayBox` views.
- The live drawing context is wrapped to expose only `OverlayContext` methods.
- Hook invocation is direct (fail-fast): no swallow/recover behavior.

## Caller Responsibilities

The engine does not import overlay files. Callers must construct and pass `OverlayProvider`.

Typical options:

- Inline object (tests/fixtures)
- Imported module from a file path (CLI/tools)

## CLI Usage

`vmprint` now supports:

- `--debug` for built-in minimal debug overlay
- `--overlay <path>` for custom overlay module
- automatic sidecar discovery for `--input` documents using `<input-base>.overlay.(mjs|js|cjs|ts)` when `--overlay` is omitted

Expected overlay module shape:

- Default export is an object
- Contains `backdrop` and/or `overlay` function

## Example Pack

Runnable samples are available under:

- `examples/overlay-samples/`

Includes:

- `base-document.json`
- `overlay-grid-backdrop.mjs`
- `overlay-highlight-paragraphs.mjs`
- `overlay-cut-marks.mjs`
- generated output PDFs

See `examples/overlay-samples/README.md` for commands.

## Summary

The overlay architecture keeps the core renderer stable while enabling flexible, fixture-specific visualization.

- Built-in debug is intentionally minimal.
- Custom diagnostics live outside the engine.
- The API stays aligned with `Context` to reduce long-term maintenance risk.
