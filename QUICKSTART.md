# Quickstart

This monorepo contains the VMPrint engine, the `vmprint` CLI for JSON-to-PDF workflows, and the browser preview runtime.

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

The repo uses `tsx` for source-mode development, so you can run the CLI without building first.

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



### Repo Transmute Helper

Use the standalone [Transmuters](https://github.com/cosmiciron/vmprint-transmuters) repository for raw AST generation from Markdown.

## Run From Built Output

```bash
node cli/dist/index.js --input document.json --output output.pdf
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
| `cli/` | `@vmprint/cli` | `vmprint` CLI |
| `preview/` | `@vmprint/preview` | Browser canvas preview runtime |
| (External) | `@vmprint/context-*` | PDF, SVG, Canvas output contexts |
| (External) | `@vmprint/local-fonts` | Filesystem font manager |
| (External) | `@vmprint/standard-fonts` | Standard PDF font manager |
| (External) | `@vmprint/web-fonts` | Browser font manager |
| (External) | `draft2final` | Markdown-first authoring CLI |
