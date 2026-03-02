# draft2final — Quickstart

Converts Markdown to PDF using the vmprint layout engine.

## Install

```bash
npm install -g @draft2final/cli
```

## Run from source

Requires the vmprint monorepo. Run from the repo root:

```bash
pnpm d2f build input.md -o output.pdf
pnpm d2f build script.md -o script.pdf --format screenplay
pnpm d2f --help
```

## Usage

```bash
draft2final build input.md -o output.pdf
```

### Formats and themes

```bash
# Named format
draft2final build script.md -o script.pdf --format screenplay

# Format + theme
draft2final build input.md -o output.pdf --format markdown --theme opensource
```

Pass `?` to list available options:

```bash
draft2final build input.md -o output.pdf --format ?   # list formats
draft2final build input.md -o output.pdf --theme ?    # list themes for active format
```

## Options

| Flag                  | Description                                |
| --------------------- | ------------------------------------------ |
| `<input.md>`          | Path to the input Markdown file            |
| `-o, --output <path>` | Output PDF path (must end in `.pdf`)       |
| `--format <name>`     | Document format (default: `markdown`)      |
| `--theme <name>`      | Format theme / style variant               |
| `--debug`             | Embed layout debug boxes in the output PDF |

## Exit codes

| Code | Meaning                              |
| ---- | ------------------------------------ |
| `0`  | Success                              |
| `1`  | Unexpected internal error            |
| `2`  | Bad arguments or usage error         |
| `3`  | Input file could not be read         |
| `4`  | Render failed (vmprint engine error) |
| `5`  | Output file could not be written     |

## Input format

Standard CommonMark + GFM (tables, strikethrough, task lists). Optional YAML front matter:

```markdown
---
title: My Document
author: Jane Smith
---

# Heading

Body text...
```

See `docs/draft2final-v0.1-spec.md` for the full specification.
