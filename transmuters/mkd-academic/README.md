# @vmprint/transmuter-mkd-academic

Markdown to VMPrint `DocumentInput` transmuter with built-in academic defaults.

Input is standard Markdown. Output is a pure object in VMPrint's AST format (`DocumentInput`), ready for JSON serialization or direct layout/rendering.

## Features

- Zero file access. No `fs`, no Node-specific loading.
- No engine dependency. Types remain structurally compatible with `@vmprint/engine`.
- Built-in academic config and theme defaults.
- Caller overrides for `theme` and `config`.
- Images via data URIs or a caller-supplied resolver callback.

## Installation

```bash
npm install @vmprint/transmuter-mkd-academic
```

## Usage

```typescript
import { transmute } from '@vmprint/transmuter-mkd-academic';

const doc = transmute('# Title\n\nBody text.');

const customized = transmute('# Title', {
  config: `references:\n  heading: Works Cited\n`,
  theme: `styles:\n  paragraph:\n    textAlign: justify\n`
});
```

## API

```typescript
type AcademicTransmuteOptions = {
  theme?: string;
  config?: string;
  resolveImage?: (src: string) => { data: string; mimeType: 'image/png' | 'image/jpeg' } | null;
};

function transmute(markdown: string, options?: AcademicTransmuteOptions): DocumentInput;
```