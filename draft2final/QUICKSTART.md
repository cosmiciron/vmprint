# draft2final — Quickstart

Converts Markdown to PDF using the vmprint layout engine.

## Install

```bash
npm install -g @draft2final/cli
```

## Run from source

Requires the vmprint monorepo. Use `npm run dev` in place of `draft2final`:

```bash
npm run dev -- build input.md -o output.pdf
npm run dev -- build script.md -o script.pdf --format screenplay
npm run dev -- --help
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

List what's available:

```bash
draft2final build --help
```

## Options

| Flag | Description |
|---|
| `<input.md>` | Path to the input Markdown file |
| `-o, --output <path>` | Output PDF path (must end in `.pdf`) |
| `--format <name>` | Document format (default: `markdown`) |
| `--theme <name>` | Format theme / style variant |
| `--cover-page <mode>` | Manuscript cover mode (`first`, `separate`, `none`) |
| `--overlay <path>` | Overlay module for visual guides (margin/grid/header debug) |
| `--debug` | Embed layout debug boxes in the output PDF |

## Exit codes

| Code | Meaning |
|---|---|
| `0` | Success |
| `1` | Unexpected internal error |
| `2` | Bad arguments or usage error |
| `3` | Input file could not be read |
| `4` | Render failed (vmprint engine error) |
| `5` | Output file could not be written |

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

### Headers and Footers

You can specify headers and footers globally at the theme/document level using the frontmatter or predefined styles. See [Header and Footer Architecture](../documents/HEADER-FOOTER.md) for detailed guidelines on regions, selectors, and content blocks.

See `README.md` for format semantics and `../documents/ARCHITECTURE.md` for system architecture.

For manuscript-specific writing workflows, see [MANUSCRIPT.md](MANUSCRIPT.md).
