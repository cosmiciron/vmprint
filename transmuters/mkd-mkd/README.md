# @vmprint/transmuter-mkd

Markdown → VMPrint `DocumentInput` transmuter.

Input is standard Markdown. Output is a pure object in the VMPrint engine's AST format (`DocumentInput`), ready to be serialized as JSON or fed directly into the layout engine.

## Features

- **Zero file access** — no `fs`, no Node.js I/O. Fully embeddable in any runtime (browser, edge, worker).
- **No engine dependency** — does not import from `@vmprint/engine`. Types are declared locally and structurally compatible.
- **Themeable** — accepts any draft2final-compatible theme as a YAML string. Three themes are bundled.
- **Configurable** — behavioral config (links, footnotes, tables, typography) via YAML string or object.
- **Images** — data URIs resolved inline. Arbitrary sources supported via a user-supplied resolver callback.

## Installation

```bash
npm install @vmprint/transmuter-mkd
```

## Usage

```typescript
import { transmute, themes } from '@vmprint/transmuter-mkd';

const markdown = `
# Hello World

A paragraph with a [link](https://example.com).
`;

// Basic — uses the bundled 'default' theme
const doc = transmute(markdown);
console.log(JSON.stringify(doc, null, 2));

// With a specific bundled theme
const doc2 = transmute(markdown, { theme: themes.novel });

// With an external theme YAML string (e.g. loaded from a database or bundle)
const doc3 = transmute(markdown, { theme: myThemeYamlString });

// With a custom image resolver (e.g. for a bundler or fetch-based env)
const doc4 = transmute(markdown, {
  resolveImage: (src) => {
    const buf = myFetchSync(src); // your implementation
    return buf ? { data: btoa(String.fromCharCode(...buf)), mimeType: 'image/png' } : null;
  }
});
```

## Frontmatter

Frontmatter is parsed and applied automatically. The `theme` key selects a bundled theme by name:

```markdown
---
theme: novel
links:
  mode: inline
---

# My Document
```

## Themes

All bundled themes are interchangeable with draft2final themes at the YAML level.

| Key | Description |
|---|---|
| `default` | General markdown, Caladea/Cousine, LETTER |
| `opensource` | Open-source docs style, Carlito/Caladea, A4 |
| `novel` | Trade novel proportions (6×9"), Caladea, auto-hyphenation |

Pass any theme by importing `themes`:

```typescript
import { themes } from '@vmprint/transmuter-mkd';
// themes.default, themes.opensource, themes.novel
```

Or supply your own theme YAML string (same format as draft2final `themes/*.yaml`):

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

Behavioral config follows the same schema as draft2final's `config.defaults.yaml`. Pass as a YAML string or plain object:

```typescript
transmute(md, {
  config: {
    links: { mode: 'inline' },
    typography: { smartQuotes: false },
    tables: { zebra: false }
  }
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
    { type: 'paragraph', content: '', children: [...] },
    ...
  ]
}
```

Feed it directly into `@vmprint/engine`:

```typescript
import { transmute } from '@vmprint/transmuter-mkd';
import { LayoutEngine, createEngineRuntime } from '@vmprint/engine';

const doc = transmute(markdown);
const runtime = createEngineRuntime({ fontManager });
const engine = new LayoutEngine(toLayoutConfig(doc), runtime);
await engine.waitForFonts();
const pages = engine.paginate(doc.elements);
```
