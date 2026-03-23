# @vmprint/transmuter-mkd-mkd

Markdown to VMPrint `DocumentInput` transmuter.

Input is standard Markdown. Output is a pure object in the VMPrint engine's AST format (`DocumentInput`), ready to be serialized as JSON or fed directly into the layout engine.

## Features

- Zero file access. No `fs`, no Node-specific loading.
- No engine dependency. Types remain structurally compatible with `@vmprint/engine`.
- Built-in markdown default theme (draft2final-compatible).
- Caller-supplied theme overrides. Pass any draft2final-compatible theme YAML string.
- Configurable behavior via YAML string.
- Images via data URIs or a caller-supplied resolver callback.

## Installation

```bash
npm install @vmprint/transmuter-mkd-mkd
```

## Usage

```typescript
import { transmute } from '@vmprint/transmuter-mkd-mkd';

const markdown = `
# Hello World

A paragraph with a [link](https://example.com).
`;

const doc = transmute(markdown); // uses built-in markdown default theme
console.log(JSON.stringify(doc, null, 2));

const docWithCustomTheme = transmute(markdown, {
  theme: myThemeYamlString
});

const docWithImages = transmute(markdown, {
  theme: myThemeYamlString,
  resolveImage: (src) => {
    const buf = myFetchSync(src);
    return buf ? { data: btoa(String.fromCharCode(...buf)), mimeType: 'image/png' } : null;
  }
});
```

## Frontmatter

Frontmatter is parsed and merged into behavioral config. Theme defaults to the built-in markdown theme unless overridden by `options.theme`.

```markdown
---
links:
  mode: inline
---

# My Document
```

## Themes

Supply any theme YAML string using the same format as draft2final `themes/*.yaml`:

```yaml
layout:
  fontFamily: Georgia
  fontSize: 12
  lineHeight: 1.6
  pageSize: A4
  margins: { top: 72, right: 72, bottom: 72, left: 72 }

styles:
  heading-1:
    fontSize: 24
    color: "#1a1a1a"
  paragraph:
    textAlign: justify
```

## Config

Behavioral config follows the same schema as draft2final's markdown defaults. Pass it as a YAML string:

```typescript
transmute(md, {
  theme: myThemeYamlString,
  config: `
links:
  mode: inline
typography:
  smartQuotes: false
tables:
  zebra: false
`
});
```

## Output

The returned `DocumentInput` is a plain JSON-serializable object:

```typescript
{
  documentVersion: '1.0',
  layout: { pageSize, margins, fontFamily, fontSize, lineHeight, ... },
  styles: { 'heading-1': { ... }, 'paragraph': { ... }, ... },
  elements: [
    { type: 'heading-1', content: '', children: [{ type: 'text', content: 'Hello' }] },
    { type: 'paragraph', content: '', children: [...] }
  ]
}
```

---

Licensed under the [Apache License 2.0](LICENSE).
