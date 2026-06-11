# @vmprint/mkd-zh-manuscript

Markdown to VMPrint `DocumentInput` transmuter with Chinese manuscript defaults.

Produces publication-ready PDF output that feels native to Chinese book publishing: A4 pages, Noto Serif SC body type, 2em first-line indent on every paragraph, justified text, left-aligned chapter headings, and a clean title-page cover — without the Anglo-American manuscript conventions (double-spacing, top-third title, surname headers) that look foreign to Chinese editors and readers.

## Features

- Zero file access. No `fs`, no Node-specific loading — runs in browser, Node, or edge workers.
- No engine dependency. Types are structurally compatible with `@vmprint/engine` but do not import it.
- Built-in layout defaults targeting Chinese publishing norms (A4, 宋体/Noto Serif SC, 2em indent, 1.75× line height).
- Cover page rendered as a clean title page, not an Anglo submission form.
- Running header defaults to `书名　页码` (title + page number), right-aligned.
- Character count formatted in Chinese convention: `约12万字`.
- `{author}` and `{surname}` header tokens with CJK-aware surname extraction.
- `transmuteWithArtifacts` for access to the chapter TOC and expanding-probe AST.
- Full caller override for `theme` and `config` YAML.
- Images via data URIs or a caller-supplied resolver callback.

## Installation

```bash
npm install @vmprint/mkd-zh-manuscript
```

Requires `Noto Serif SC` fonts in the asset repo consumed by your font manager. If you use `@vmprint/local-fonts`, the JIT downloader fetches them automatically on first render.

## Quick start

```typescript
import { transmute } from '@vmprint/mkd-zh-manuscript';

const doc = transmute(markdownString);
// doc is a DocumentInput — pass it to @vmprint/engine for rendering
```

With artifact access (chapter TOC, expanding-probe state):

```typescript
import { transmuteWithArtifacts } from '@vmprint/mkd-zh-manuscript';

const { document, artifacts } = transmuteWithArtifacts(markdownString);
const chapters = artifacts.tocAst.entries; // ZhManuscriptTocEntry[]
```

## Document structure

The transmuter maps Markdown heading levels to manuscript elements:

| Markdown | Role |
|---|---|
| `# Title` | Book title + cover page |
| `## 第一章　…` | Chapter heading (page break, left-aligned) |
| `### …` / `#### …` | Scene break (centered `※` by default, or heading text) |
| `---` | Scene break |
| `> …` | Block quote |
| `> [epigraph]` | Epigraph (with optional `——attribution` on last line) |

## Cover page fields

The first `# Heading` triggers cover generation. A bullet list immediately following the title is parsed as key/value metadata:

```markdown
# 白鹤归来

- author: 陈秀兰
- email: chen.xiulan@example.com
- char-count: 85000
- agent: 北方文学代理公司
```

| Key | Purpose |
|---|---|
| `author` | Author name — used in the running header and as the display byline |
| `byline` | Display name if different from `author` |
| `email` / `phone` / `address` | Contact info (small type, below byline) |
| `char-count` / `字数` | Character count — formatted as `约12万字` |
| `agent` / `rights` | Pushed to the bottom of a separate cover page |

## Config reference

Override via frontmatter or the `config` option:

```yaml
manuscript:
  coverPage:
    mode: first-page-cover       # none | first-page-cover | separate-cover-page
  runningHeader:
    enabled: true
    format: "{shortTitle}　{n}" # tokens: {shortTitle} {author} {surname} {n}
  chapter:
    pageBreakBefore: true
  sceneBreak:
    symbol: "※"                  # ◇ ✦ * or any string
  footnotes:
    mode: endnotes
    heading: 注释
```

## Theme customization

Pass a YAML string as the `theme` option. The full default theme is exported as `DEFAULT_ZH_MANUSCRIPT_THEME_YAML`. Common overrides:

```yaml
layout:
  fontFamily: Noto Serif SC   # any family registered in your font manager
  fontSize: 11                # pt
  lineHeight: 1.75
  pageSize: A4                # A4 | LETTER | A5 | B5 | …
  margins:
    top: 85
    right: 90
    bottom: 85
    left: 90

styles:
  chapter-heading:
    fontSize: 20
    marginTop: 72
```

## API

```typescript
type ZhManuscriptTransmuteOptions = {
  theme?: string;   // YAML string — merged over defaults
  config?: string;  // YAML string — merged over defaults
  resolveImage?: (src: string) => { data: string; mimeType: 'image/png' | 'image/jpeg' } | null;
};

// Returns DocumentInput directly
function transmute(markdown: string, options?: ZhManuscriptTransmuteOptions): DocumentInput;

// Returns DocumentInput + chapter TOC + expanding-probe AST
function transmuteWithArtifacts(markdown: string, options?: ZhManuscriptTransmuteOptions): ZhManuscriptTransmuteResult;

// Default YAML strings — import to extend rather than replace
export const DEFAULT_ZH_MANUSCRIPT_CONFIG_YAML: string;
export const DEFAULT_ZH_MANUSCRIPT_THEME_YAML: string;
```

## Packaging

Dual CJS + ESM with bundled types. Both builds externalize `@vmprint/markdown-core` and `@vmprint/contracts` — they are peer-style runtime dependencies that must be resolvable by the consuming application.

```
dist/
  index.js    — CommonJS
  index.mjs   — ES module
  index.d.ts  — bundled type declarations
```

---

Licensed under the [Apache License 2.0](LICENSE).
