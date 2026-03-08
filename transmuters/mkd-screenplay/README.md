# @vmprint/transmuter-mkd-screenplay

Markdown to VMPrint `DocumentInput` transmuter with built-in screenplay defaults.

This transmuter mirrors screenplay semantics from draft2final, including title-page metadata routing, scene-heading recognition, dialogue/parenthetical handling, and dual-dialogue emission.

## Features

- Zero file access. No `fs`, no Node-specific loading.
- No engine dependency. Types remain structurally compatible with `@vmprint/engine`.
- Built-in screenplay config and theme defaults.
- Caller overrides for `theme` and `config`.
- Images via data URIs or caller-supplied resolver callback.

## Installation

```bash
npm install @vmprint/transmuter-mkd-screenplay
```

## Usage

```typescript
import { transmute } from '@vmprint/transmuter-mkd-screenplay';

const doc = transmute(markdown);
```

## API

```typescript
type ScreenplayTransmuteOptions = {
  theme?: string;
  config?: string;
  resolveImage?: (src: string) => { data: string; mimeType: 'image/png' | 'image/jpeg' } | null;
};

function transmute(markdown: string, options?: ScreenplayTransmuteOptions): DocumentInput;
```