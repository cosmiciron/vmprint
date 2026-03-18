# Quickstart

This monorepo contains the VMPrint engine, the `vmprint` CLI for JSON-to-PDF workflows, and the `draft2final` CLI for Markdown-first authoring workflows.

## Prerequisites

- Node.js 18+
- npm 9+

## Install

```bash
git clone https://github.com/cosmiciron/vmprint.git
cd vmprint
npm install
```

## Build Everything

```bash
npm run build
```

## Run From Source

The repo uses `tsx` for source-mode development, so you can run both CLIs without building first.

### `vmprint` CLI

Render a document JSON file to PDF:

```bash
npm run dev --prefix cli -- --input document.json --output output.pdf
```

Render from a previously emitted layout stream:

```bash
npm run dev --prefix cli -- --render-from-layout output.layout.json --output output.pdf
```

Emit the annotated layout stream while rendering:

```bash
npm run dev --prefix cli -- --input document.json --output output.pdf --emit-layout
```

Enable layout debug boxes:

```bash
npm run dev --prefix cli -- --input document.json --output output.pdf --debug
```

### `draft2final` CLI

Render Markdown using the default Markdown transmuter:

```bash
npm run dev --prefix draft2final -- input.md
```

Render with an explicit form:

```bash
npm run dev --prefix draft2final -- input.md --as manuscript --out output.pdf
npm run dev --prefix draft2final -- input.md --as screenplay --out screenplay.pdf
```

Emit transmuted AST JSON instead of PDF:

```bash
npm run dev --prefix draft2final -- input.md --as literature --out output.json
```

Prepare an existing Markdown file with front matter and recommended boilerplate:

```bash
npm run dev --prefix draft2final -- --prepare story.md --as manuscript
```

Scaffold a starter file:

```bash
npm run dev --prefix draft2final -- --new story.md --as manuscript
```

### Repo Transmute Helper

Use the repo helper when you want raw AST JSON from a transmuter, including direct config/theme overrides:

```bash
npm run transmute -- input.md --using mkd-academic --out output.ast.json
npm run transmute -- input.md --using mkd-mkd --theme my.theme.yaml --config my.config.yaml
```

## Run From Built Output

```bash
node cli/dist/index.js --input document.json --output output.pdf
node draft2final/dist/cli.js input.md --as manuscript --out output.pdf
```

## Browser Examples

Build the static browser examples:

```bash
npm run docs:build
```

Then open:

- `docs/examples/ast-to-pdf/index.html`
- `docs/examples/mkd-to-ast/index.html`

## Verification

```bash
npm run build
npm run test --prefix engine
npm run docs:build
npm run test:packaged-integration
```

## Project Structure

| Path | Package | Purpose |
| --- | --- | --- |
| `contracts/` | `@vmprint/contracts` | Shared TypeScript interfaces |
| `engine/` | `@vmprint/engine` | Deterministic layout engine |
| `contexts/pdf/` | `@vmprint/context-pdf` | PDF output context |
| `contexts/pdf-lite/` | `@vmprint/context-pdf-lite` | Lightweight PDF output context |
| `font-managers/local/` | `@vmprint/local-fonts` | Local filesystem font manager |
| `font-managers/standard/` | `@vmprint/standard-fonts` | Standard PDF font manager |
| `cli/` | `@vmprint/cli` | `vmprint` CLI |
| `draft2final/` | `draft2final` | Markdown-first authoring CLI |
| `transmuters/` | VMPrint transmuters | Source-to-DocumentInput converters |
