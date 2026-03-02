# Quickstart

This monorepo contains the **VMPrint** deterministic typesetting engine, the **vmprint CLI** (JSON → bit-perfect PDF), and the **draft2final CLI** (Markdown → bit-perfect PDF).

## Prerequisites

- Node.js 18 or later
- pnpm 9 or later

## 1. Clone and install

```bash
git clone https://github.com/cosmiciron/vmprint.git
cd vmprint
pnpm install
```

pnpm workspaces installs dependencies for all packages in a single pass from the root.

## 2. Build

```bash
pnpm build
```

This builds all packages in dependency order via Turborepo: contracts → engine → context-pdf + local-fonts (parallel) → cli + draft2final (parallel). To build a single package: `pnpm --filter <package-name> run build`.

---

## Run from source (no build required)

Both CLIs have root-level shortcut scripts that run TypeScript directly via `tsx`. The `--conditions tsx` flag activates a custom export condition defined in every local package, so the engine, contracts, context, and font manager are all loaded from their `src/` source files. No package needs to be built first.

### vmprint CLI — JSON to PDF

```bash
# Basic render
pnpm cli -i document.json -o output.pdf

# Render from a saved layout stream (skip the layout pass)
pnpm cli --render-from-layout output.layout.json -o output.pdf

# Dump the canonical document IR
pnpm cli -i document.json -o output.pdf --dump-ir

# Emit the annotated layout stream
pnpm cli -i document.json -o output.pdf --emit-layout

# Enable layout debug boxes
pnpm cli -i document.json -o output.pdf --debug

# All options
pnpm cli --help
```

### draft2final CLI — Markdown to PDF

```bash
# Default markdown format
pnpm d2f build input.md -o output.pdf

# Named format
pnpm d2f build script.md -o script.pdf --format screenplay

# Format + theme
pnpm d2f build input.md -o output.pdf --format markdown --theme academic

# Layout debug boxes
pnpm d2f build input.md -o output.pdf --debug

# All options
pnpm d2f --help
```

### Watch mode (hot reload)

For development with automatic re-execution on file changes:

```bash
pnpm dev:cli    # watches and re-runs vmprint CLI
pnpm dev:d2f    # watches and re-runs draft2final CLI
```

Or start all packages in watch mode simultaneously:

```bash
pnpm dev        # turbo dev — all packages in parallel
```

---

## Run from a build

After building, the compiled output can be invoked directly or installed globally.

### Node.js directly

```bash
node packages/cli/dist/index.js --input document.json --output output.pdf
node packages/draft2final/dist/cli.js build input.md -o output.pdf
```

### Global install from the local build

```bash
pnpm --filter @vmprint/cli pack
pnpm --filter @draft2final/cli pack
```

```bash
vmprint --input document.json --output output.pdf
draft2final build input.md -o output.pdf
```

---

## Tests

### Engine

```bash
# Run all engine tests
pnpm test:engine

# Individual suites
pnpm test:modules        # module extractions
pnpm test:flat           # flat pipeline invariants
pnpm test:regression     # regression suite

# Performance benchmarks
pnpm test:perf

# Update layout snapshots after intentional layout changes
pnpm test:update-snapshots
```

### draft2final

```bash
# Boundary import guards + layout snapshot tests
pnpm test:d2f

# Update layout snapshots
pnpm test:update-snapshots
```

---

## Project structure

| Path                    | Package                | Purpose                                        |
| ----------------------- | ---------------------- | ---------------------------------------------- |
| `packages/contracts/`   | `@vmprint/contracts`   | Shared TypeScript interfaces                   |
| `packages/engine/`      | `@vmprint/engine`      | Deterministic typesetting core                 |
| `packages/context-pdf/` | `@vmprint/context-pdf` | PDF rendering context                          |
| `packages/local-fonts/` | `@vmprint/local-fonts` | Local filesystem font manager                  |
| `packages/cli/`         | `@vmprint/cli`         | `vmprint` CLI — JSON → bit-perfect PDF         |
| `packages/draft2final/` | `@draft2final/cli`     | `draft2final` CLI — Markdown → bit-perfect PDF |
