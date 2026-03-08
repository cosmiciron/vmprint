# @vmprint/transmuter-mkd-literature

Markdown to VMPrint `DocumentInput` transmuter with built-in literature defaults.

Input is standard Markdown. Output is a pure object in VMPrint's AST format (`DocumentInput`), ready for JSON serialization or direct layout/rendering.

## Features

- Zero file access. No `fs`, no Node-specific loading.
- No engine dependency. Types remain structurally compatible with `@vmprint/engine`.
- Built-in literature config and theme defaults.
- Caller overrides for `theme` and `config`.
- Images via data URIs or a caller-supplied resolver callback.

## Installation

```bash
npm install @vmprint/transmuter-mkd-literature
```

## Usage

```typescript
import { transmute } from '@vmprint/transmuter-mkd-literature';

const doc = transmute('# Chapter One\n\nBody text.');

const customized = transmute('# Chapter One', {
  config: `references:\n  heading: Endnotes\n`,
  theme: `styles:\n  paragraph:\n    lineHeight: 1.6\n`
});
```

## API

```typescript
type LiteratureTransmuteOptions = {
  theme?: string;
  config?: string;
  resolveImage?: (src: string) => { data: string; mimeType: 'image/png' | 'image/jpeg' } | null;
};

function transmute(markdown: string, options?: LiteratureTransmuteOptions): DocumentInput;
```