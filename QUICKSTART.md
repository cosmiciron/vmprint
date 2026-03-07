# Quickstart

This monorepo contains the **VMPrint** deterministic typesetting engine, the **vmprint CLI** (JSON → bit-perfect PDF), and the **draft2final CLI** (Markdown → bit-perfect PDF).

## Prerequisites

- Node.js 18 or later
- npm 9 or later (bundled with Node.js 18+)

## 1. Clone and install

```bash
git clone https://github.com/cosmiciron/vmprint.git
cd vmprint
npm install
```

npm workspaces installs dependencies for all packages in a single pass from the root.

## 2. Build

```bash
npm run build
```

This builds all packages in dependency order: contracts → engine → contexts/pdf → font-managers/local → cli → draft2final. To build a single package: `npm run build --prefix <package-path>`.

---

## Run from source (no build required)

Both CLIs support a `dev` script that runs TypeScript directly via `tsx`. The `--conditions tsx` flag activates a custom export condition defined in every local package, so the engine, contracts, context, and font manager are all loaded from their `src/` source files. No package needs to be built first.

### vmprint CLI — JSON to PDF

```bash
# Basic render
npm run dev --prefix cli -- --input document.json --output output.pdf

# Render from a saved layout stream (skip the layout pass)
npm run dev --prefix cli -- --render-from-layout output.layout.json --output output.pdf

# Dump the canonical document IR
npm run dev --prefix cli -- --input document.json --output output.pdf --dump-ir

# Emit the annotated layout stream
npm run dev --prefix cli -- --input document.json --output output.pdf --emit-layout

# Enable layout debug boxes
npm run dev --prefix cli -- --input document.json --output output.pdf --debug

# All options
npm run dev --prefix cli -- --help
```

### draft2final CLI — Markdown to PDF

```bash
# Default markdown format
npm run dev --prefix draft2final -- build input.md -o output.pdf

# Named format
npm run dev --prefix draft2final -- build script.md -o script.pdf --format screenplay

# Format + theme
npm run dev --prefix draft2final -- build input.md -o output.pdf --format markdown --theme opensource

# Layout debug boxes
npm run dev --prefix draft2final -- build input.md -o output.pdf --debug

# Emit compiled AST as JSON instead of rendering a PDF
npm run dev --prefix draft2final -- build input.md --ast

# All options
npm run dev --prefix draft2final -- build --help
```

### Browser Examples (No Build Required)

For a browser-based workflow without Node.js overhead, see the static examples:

- Open [docs/examples/ast-to-pdf/index.html](docs/examples/ast-to-pdf/index.html) to render JSON documents to PDF entirely client-side.
- Open [docs/examples/mkd-to-ast/index.html](docs/examples/mkd-to-ast/index.html) to transmute Markdown to VMPrint's JSON AST in the browser.

### Standalone Transmuter (Markdown → AST)

The `@vmprint/transmuter-mkd` package can run anywhere (browser, Node.js, edge workers) to convert Markdown into VMPrint's `DocumentInput` without layout or rendering:

```bash
npm install @vmprint/transmuter-mkd
```

See [transmuters/mkd-mkd/README.md](transmuters/mkd-mkd/README.md) for full API documentation.

---

## Run from a build

After building, the compiled output can be invoked directly or installed globally.

### Node.js directly

```bash
node cli/dist/index.js --input document.json --output output.pdf
node draft2final/dist/cli.js build input.md -o output.pdf
```

### Global install from the local build

```bash
npm install -g ./cli
npm install -g ./draft2final
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
npm run test --prefix engine

# Individual suites
npm run test:modules --prefix engine
npm run test:flat    --prefix engine
npm run test:engine  --prefix engine

# Update layout snapshots after intentional layout changes
npm run test:update-layout-snapshots --prefix engine
```

### draft2final

```bash
# Boundary import guards + layout snapshot tests
npm run test --prefix draft2final

# Update layout snapshots
npm run test:update-layout-snapshots --prefix draft2final
```

---

## Project structure

| Path | Package | Purpose |
|---|---|---|
| `contracts/` | `@vmprint/contracts` | Shared TypeScript interfaces |
| `engine/` | `@vmprint/engine` | Deterministic typesetting core |
| `contexts/pdf/` | `@vmprint/context-pdf` | PDF rendering context |
| `contexts/pdf-lite/` | `@vmprint/context-pdf-lite` | Lightweight jsPDF PDF context |
| `font-managers/local/` | `@vmprint/local-fonts` | Local filesystem font manager |
| `font-managers/standard/` | `@vmprint/standard-fonts` | Sentinel-based standard font manager |
| `cli/` | `@vmprint/cli` | `vmprint` CLI — JSON → bit-perfect PDF |
| `draft2final/` | `@draft2final/cli` | `draft2final` CLI — Markdown → bit-perfect PDF |
| `transmuters/` | Multi-format transmuters | Source-to-DocumentInput converters |
| `transmuters/mkd-mkd/` | `@vmprint/transmuter-mkd` | Markdown → DocumentInput |
