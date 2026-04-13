# VMPrint contracts

The shared interface layer for the VMPrint engine and its collaborators.

## What This Is

These files define the TypeScript interfaces that the engine, rendering contexts, font managers, overlays, and transmuters speak across. They are intentionally small and dependency-free.

The module has zero meaningful runtime behavior. After compilation, the value is in the declarations; TypeScript erases the interfaces themselves.

## Why It Exists Separately

The conventional approach is to put shared types inside the main package and re-export them. The problem is that anyone who wants to implement one of the interfaces, such as a custom font manager or a rendering context for a new target, then has to drag in the main engine package just to get types.

Keeping the contracts isolated breaks that coupling. In this repository they still build as a workspace artifact because the engine and CLI need a concrete module target, but the intended consumption model for advanced integrators is now simple source reuse: copy the files you need into your own project, keep the interfaces local, and adapt them as your integration demands.

## Interfaces

### `FontManager`

The contract for font loading and registry management. Implement this to provide fonts from any source, such as a CDN, object storage, a pre-loaded in-memory buffer, or an OS font directory.

### `VmprintOutputStream`

A portable output stream interface. Callers implement this against their own I/O mechanism and pass it to a context via `pipe()`.

### `Context`

The rendering surface contract. Implement this to paint VMPrint layout output to any target: PDF, SVG, canvas, a DOM surface, or a test spy.

### `OverlayProvider`

A hook for drawing before and after page content without modifying layout.

### `Transmuter`

The contract for source conversion into VMPrint `DocumentInput`.

## Usage

Inside this monorepo, consumers import the workspace package:

```ts
import type { FontManager, Context, OverlayProvider, Transmuter } from '@vmprint/contracts';
```

Outside this monorepo, the preferred model is to copy the contract source files you need from [`src/`](src) into your own project and treat them as local interfaces. That keeps your integration explicit and avoids turning these contracts into a pseudo-public package surface.

## Source Files

| File | Role |
| --- | --- |
| `src/context.ts` | Drawing and output contracts |
| `src/font-manager.ts` | Font registry and loading contracts |
| `src/overlay.ts` | Overlay page and drawing contracts |
| `src/text-delegate.ts` | Text shaping and measuring contracts |
| `src/transmuter.ts` | Source conversion contracts |
