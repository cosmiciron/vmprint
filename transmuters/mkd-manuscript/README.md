# @vmprint/transmuter-mkd-manuscript

Markdown to VMPrint `DocumentInput` transmuter with built-in manuscript defaults.

This transmuter mirrors manuscript semantics from draft2final, including cover-page handling, chapter/scene rules, manuscript paragraph behavior, and running-header derivation.

## Features

- Zero file access. No `fs`, no Node-specific loading.
- No engine dependency. Types remain structurally compatible with `@vmprint/engine`.
- Built-in manuscript config and default theme.
- Additional bundled classic manuscript theme export.
- Caller overrides for `theme` and `config`.
- Images via data URIs or caller-supplied resolver callback.

## Installation

```bash
npm install @vmprint/transmuter-mkd-manuscript
```

## Usage

```typescript
import {
  transmute,
  CLASSIC_MANUSCRIPT_THEME_YAML
} from '@vmprint/transmuter-mkd-manuscript';

const doc = transmute(markdown);

const classic = transmute(markdown, {
  theme: CLASSIC_MANUSCRIPT_THEME_YAML
});
```

## API

```typescript
type ManuscriptTransmuteOptions = {
  theme?: string;
  config?: string;
  resolveImage?: (src: string) => { data: string; mimeType: 'image/png' | 'image/jpeg' } | null;
};

function transmute(markdown: string, options?: ManuscriptTransmuteOptions): DocumentInput;
```

---

Licensed under the [Apache License 2.0](LICENSE).