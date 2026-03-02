# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

VMPrint is a deterministic typesetting engine for the programmable web. Pure TypeScript, zero browser dependencies, produces bit-perfect PDF output across any JS runtime. Pre-1.0 software (v0.1.0).

## Monorepo Structure (pnpm workspaces + Turborepo)

```
vmprint/
├── packages/
│   ├── contracts/       @vmprint/contracts    — Shared TypeScript interfaces
│   ├── engine/          @vmprint/engine       — Core layout engine
│   ├── context-pdf/     @vmprint/context-pdf  — PDF rendering context (wraps PDFKit)
│   ├── local-fonts/     @vmprint/local-fonts  — Local filesystem font manager
│   ├── cli/             @vmprint/cli          — vmprint CLI: JSON → PDF
│   └── draft2final/     @draft2final/cli      — draft2final CLI: Markdown → PDF
├── docs/                Architecture, testing, overlay, roadmap docs
├── examples/            Overlay samples, draft2final samples
└── root configs         turbo.json, tsconfig.base.json, eslint, prettier, etc.
```

## Common Commands

### Quick Run (single execution, cwd = repo root)

```bash
pnpm cli -i packages/engine/tests/fixtures/regression/00-all-capabilities.json -o out.pdf
pnpm cli -i doc.json -o out.pdf --debug --profile-layout
pnpm d2f build input.md -o output.pdf --format screenplay
pnpm d2f build input.md -o output.pdf --format markdown --flavor academic
```

### Watch Mode (hot reload on source change)

```bash
pnpm dev                                    # all packages: tsc --watch + tsx watch
pnpm dev:cli -- -i doc.json -o out.pdf      # only cli watch
pnpm dev:d2f -- build input.md -o out.pdf   # only draft2final watch
```

### Build

```bash
pnpm build           # all packages via Turborepo (cached, parallel)
pnpm clean           # clean all dist/
```

### Test

```bash
pnpm test            # all tests via Turborepo
pnpm test:engine     # engine — all three suites
pnpm test:modules    # engine — API surface / module exports
pnpm test:flat       # engine — flat pipeline invariants
pnpm test:regression # engine — fixture regression tests
pnpm test:perf       # engine — performance benchmarks
pnpm test:d2f        # draft2final — all tests
pnpm test:update-snapshots   # update all layout snapshots
```

### Quality

```bash
pnpm lint            # ESLint all packages
pnpm lint:fix        # ESLint with auto-fix
pnpm typecheck       # tsc --noEmit all packages
pnpm format          # Prettier write
pnpm format:check    # Prettier check only
```

### Release

```bash
pnpm changeset              # create a changeset
pnpm version-packages       # bump versions from changesets
pnpm release                # build + publish
```

Tests use `tsx --conditions tsx` to run TypeScript directly without building.

## Architecture: Three-Stage Pipeline

```
Markdown/JSON  →  DocumentInput (IR)  →  Page[] of Box[]  →  PDF
   (source)        (validated JSON)      (flat layout)      (render)
```

### Stage 1 — Source to IR

`draft2final` converts Markdown → `SemanticDocument` (via remark) → `DocumentInput` (via format modules in `packages/draft2final/src/formats/`). The engine also accepts `DocumentInput` JSON directly.

### Stage 2 — Layout (engine core)

`LayoutEngine` takes `DocumentInput` and produces `Page[]` — each page is a flat array of absolutely-positioned `Box` objects. Key internals:

- **`layout-core.ts`** (`LayoutProcessor`): element shaping and materialization
- **`text-processor.ts`**: line breaking, hyphenation, justification
- **`packagers/`**: pagination units (`FlowBoxPackager`, `TablePackager`, `StoryPackager`, `DropCapPackager`) — each element type has its own packager implementing `PackagerUnit` interface
- **`paginate-packagers.ts`**: pagination loop that drives all packagers

### Stage 3 — Rendering

`Renderer` walks flat `Page[]` and paints boxes to a `Context` interface. Layout and rendering are fully decoupled.

## Key Design Principles

- **Deterministic**: identical input + fonts = identical output, always
- **Input immutability**: engine never mutates the source document
- **Flat box model**: no nesting — all layout output is absolutely-positioned boxes
- **Context-independent**: layout has zero runtime environment deps (no Node APIs, no DOM)
- **`tsx` export condition**: packages use a `tsx` export condition to load TypeScript source directly during development

## Engine Test Fixtures

Regression fixtures live in `packages/engine/tests/fixtures/regression/`. Fixture `00-all-capabilities` is the "god fixture" exercising all features (8 pages). Fixtures `01`–`14` test specific capabilities. Layout snapshots are JSON files diffed for regression detection.

## draft2final Formats & Themes

Format scripts (`packages/draft2final/src/formats/`) map SemanticDocument → DocumentInput. Theme YAML files define styling (fonts, margins, spacing). Available formats: `markdown`, `screenplay`.
