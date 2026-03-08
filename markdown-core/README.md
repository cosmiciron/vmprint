# Markdown Core

`markdown-core` is the shared Markdown compiler layer used by VMPrint's Markdown-based pipelines.

It exists to keep the core Markdown transformation logic in one place while allowing different consumers to own their own runtime-specific behavior and public APIs.

## Contains

- Markdown parsing and semantic normalization
- Inline and block compilation into VMPrint `DocumentInput`
- Shared numbering and theme/config parsing helpers
- Runtime-neutral markdown transmutation logic

## Does Not Contain

- File-system loading
- Theme discovery
- CLI behavior
- Browser/demo-specific wiring
- Format-specific pipeline concerns outside the shared Markdown compiler

## Consumers

- [`draft2final`](../draft2final/) uses `markdown-core` as the shared Markdown compiler layer inside its larger PDF-oriented authoring pipeline.
- [`transmuters/mkd-mkd`](../transmuters/mkd-mkd/) uses it as the runtime-neutral Markdown transmutation engine behind its package API.
