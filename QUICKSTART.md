# Quickstart

This monorepo contains the **VMPrint** deterministic typesetting engine, the **vmprint CLI** (JSON → bit-perfect PDF), and the **draft2final CLI** (transmuter-first source → bit-perfect PDF or AST JSON).

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

This builds all packages in dependency order. To build a single package: `npm run build --prefix <package-path>`.

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

### draft2final CLI — Transmuter-First

```bash
npm run dev --prefix draft2final -- input.md --using mkd-mkd

# Explicit output + transmuter
npm run dev --prefix draft2final -- input.md --using mkd-screenplay --out screenplay.pdf

# Emit transmuted AST JSON
npm run dev --prefix draft2final -- input.md --using mkd-screenplay --out screenplay.ast.json

# Optional user override files
npm run dev --prefix draft2final -- input.md --using mkd-manuscript --config my.manuscript.config.yaml --theme my.theme.yaml

# Frontmatter auto-detection (using/transmuter/format keys)
npm run dev --prefix draft2final -- input.md --out output.pdf
```

Follow-along tutorial:

- [draft2final/TUTORIAL.md](draft2final/TUTORIAL.md)

### Browser Examples (No Build Required)

For a browser-based workflow without Node.js overhead, see the static examples:

- Open [docs/examples/ast-to-pdf/index.html](docs/examples/ast-to-pdf/index.html) to render JSON documents to PDF entirely client-side.
- Open [docs/examples/mkd-to-ast/index.html](docs/examples/mkd-to-ast/index.html) to transmute Markdown to VMPrint's JSON AST in the browser.

### Standalone Transmuter (Markdown → AST)

The transmuter packages can run anywhere (browser, Node.js, edge workers) to convert Markdown into VMPrint's `DocumentInput` without layout or rendering:

```bash
npm install @vmprint/transmuter-mkd-mkd @vmprint/transmuter-mkd-academic @vmprint/transmuter-mkd-literature @vmprint/transmuter-mkd-manuscript @vmprint/transmuter-mkd-screenplay
```

See [transmuters/mkd-mkd/README.md](transmuters/mkd-mkd/README.md), [transmuters/mkd-academic/README.md](transmuters/mkd-academic/README.md), [transmuters/mkd-literature/README.md](transmuters/mkd-literature/README.md), [transmuters/mkd-manuscript/README.md](transmuters/mkd-manuscript/README.md), and [transmuters/mkd-screenplay/README.md](transmuters/mkd-screenplay/README.md) for API documentation.

### Transmuter CLI (Smoke Testing)

Use the repo-level helper CLI to transmute Markdown files into VMPrint AST JSON:

```bash
# Write AST JSON to a file
npm run transmute -- input.md --using mkd-academic --out output.ast.json

# Print AST JSON to stdout
npm run transmute -- input.md --using mkd-literature

# Override defaults with explicit YAML files
npm run transmute -- input.md --using mkd-mkd --theme my.theme.yaml --config my.config.yaml
```

---

## Run from a build

After building, the compiled output can be invoked directly or installed globally.

### Node.js directly

```bash
node cli/dist/index.js --input document.json --output output.pdf
node draft2final/dist/cli.js input.md --using mkd-mkd --out output.pdf
```

### Global install from the local build

```bash
npm install -g ./cli
npm install -g ./draft2final
```

```bash
vmprint --input document.json --output output.pdf
draft2final input.md --using mkd-mkd --out output.pdf
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

### draft2final (thin orchestration)

```bash
# Heavy regression coverage belongs to transmuters + engine.
# Keep draft2final tests as smoke/integration checks only.
npm run build --workspace=draft2final
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
| `draft2final/` | `@draft2final/cli` | Transmuter-first source → bit-perfect PDF or AST CLI |
| `transmuters/` | Multi-format transmuters | Source-to-DocumentInput converters |
| `transmuters/mkd-mkd/` | `@vmprint/transmuter-mkd-mkd` | Markdown → DocumentInput |
| `transmuters/mkd-academic/` | `@vmprint/transmuter-mkd-academic` | Markdown → DocumentInput (academic defaults) |
| `transmuters/mkd-literature/` | `@vmprint/transmuter-mkd-literature` | Markdown → DocumentInput (literature defaults) |
| `transmuters/mkd-manuscript/` | `@vmprint/transmuter-mkd-manuscript` | Markdown → DocumentInput (manuscript defaults) |
| `transmuters/mkd-screenplay/` | `@vmprint/transmuter-mkd-screenplay` | Markdown → DocumentInput (screenplay defaults) |

