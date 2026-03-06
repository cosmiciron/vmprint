declare global {
    interface Window {
        VMPrintTransmuter: {
            transmute(markdown: string, options?: { theme?: string }): Record<string, unknown>;
            themes: Record<string, string>;
        };
        MkdToAstPipeline: typeof pipeline;
    }
}

export const SAMPLE_MARKDOWN = `\
# Getting Started with VMPrint

VMPrint is a **deterministic** document layout engine. You write Markdown, and it produces
a bit-perfect document — identical on every run.

## Core Concepts

The pipeline has three stages:

1. **Source** — Markdown with optional YAML frontmatter
2. **IR** — \`DocumentInput\`: a typed JSON structure the engine understands
3. **Output** — Paginated PDF via the layout engine

## Syntax Support

Tables are flattened into typed element trees:

| Element      | Role in AST                   |
|--------------|-------------------------------|
| Heading      | \`heading-1\` … \`heading-6\` |
| Paragraph    | \`paragraph\`                 |
| Code fence   | \`code-block\`                |
| Blockquote   | \`blockquote\`                |

Blockquotes and attributions are first-class:

> VMPrint is designed around a single invariant: given the same input, you always get the same output.
> — Design Notes

---

Links become citation markers in the AST.[^1]

[^1]: Footnotes are collected and emitted as a numbered list at document end.
`;

export const THEME_NAMES = ['default', 'opensource', 'novel'];

export type TransmuteResult = {
    json: string;
    elementCount: number;
    ms: number;
};

export function runTransmute(markdown: string, themeName: string): TransmuteResult {
    const api = window.VMPrintTransmuter;
    const themeYaml = api.themes[themeName] ?? api.themes['default'];
    const t0 = performance.now();
    const result = api.transmute(markdown, { theme: themeYaml });
    const ms = performance.now() - t0;
    const elementCount = Array.isArray((result as any).elements) ? (result as any).elements.length : 0;
    return { json: JSON.stringify(result, null, 2), elementCount, ms };
}

const pipeline = { SAMPLE_MARKDOWN, THEME_NAMES, runTransmute };
export { pipeline };
