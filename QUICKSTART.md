# Quickstart

This repo is intentionally narrow. It is for developers building with the VMPrint engine directly, not for browser demos, preview tooling, or broad introductory docs.

The active pieces in this monorepo are:

| Path | Purpose |
| --- | --- |
| `engine/` | Core layout engine and regression suite |
| `cli/` | `vmprint` CLI for JSON-to-PDF batch workflows |
| `pressrun/` | Minimal bootstrap example for wiring the engine |
| `contracts/` | Shared TypeScript interfaces used internally and available for source-copy reuse |
| `guides/` | Focused authoring guides |
| `references/` | Compact reference material |

## Prerequisites

- Node.js 18+
- npm 9+

## Install

```bash
git clone https://github.com/cosmiciron/vmprint.git
cd vmprint
npm install
```

## Build

```bash
npm run build
```

This builds the internal workspace artifacts needed for the bundled CLI and packaged smoke test.

## Run from source

### `pressrun`

The smallest useful end-to-end example:

```bash
npm run pressrun -- document.json output.pdf
```

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

## Verify

```bash
npm test
```

If you only want engine coverage without the packaged smoke test:

```bash
npm run test --prefix engine
```
