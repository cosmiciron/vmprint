# Manuscript Tags Reference

This transmuter has its own manuscript syntax layer on top of markdown parsing. Use [templates/starter.md](templates/starter.md) for a draft scaffold and [samples/demo.md](samples/demo.md) for a format-complete example.

## Cover Tags

- The first `# Title` becomes the manuscript title.
- A bullet list immediately after the title is parsed as cover metadata.

Supported metadata keys:

- `author`
- `byline`
- `email`
- `phone`
- `address`
- `word-count`
- `agent`
- `rights`

## Body Structure Tags

- `## Chapter Title`: chapter heading, usually with a page break.
- `###`, `####`, `#####`, `######`: titled scene break.
- `---`: untitled scene break using the configured symbol.
- Normal paragraphs become manuscript body paragraphs.

## Quote And Extract Tags

- `> ...`: plain block quote.
- `> [epigraph]`: epigraph block, with an optional attribution line like `-- Source`.
- `> [poem]`: poem block.
- `> [lyrics]`: lyrics block.

Fenced code blocks can also force display styles:

- ```` ```extract ````: literary extract.
- ```` ```poem ````: poem block.
- ```` ```lyrics ````: lyrics block.
- ```` ```epigraph ````: epigraph block.

## Notes

- `[^id]` and `[^id]: ...`: footnotes, emitted as endnotes by default.
- Links are stripped to plain text in manuscript mode unless config changes that behavior.
- Lists still parse, but they render as flattened manuscript paragraphs rather than visible bullet layouts.
