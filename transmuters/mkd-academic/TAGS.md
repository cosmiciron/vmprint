# Academic Tags Reference

This transmuter keeps the shared markdown-core tags and adds academic-friendly defaults for citations, references, tables, and theorem-like display blocks. Start from [templates/starter.md](templates/starter.md) or inspect [samples/demo.md](samples/demo.md).

## Frontmatter

Use YAML frontmatter for config overrides.

```md
---
links:
  mode: citation
references:
  heading: References
---
```

## Core Tags

- `#`, `##`, `###`: title and section headings.
- `:: Subtitle`: paragraph marker for a subheading immediately after the first `#`.
- `> ...`: block quote.
- `---`: thematic break.
- `[^id]` and `[^id]: ...`: footnotes.
- Standard markdown lists, definition lists, tables, links, images, and inline code all work.

## Academic Display Tags

Choose the fence language to pick the display style:

- ```` ```theorem ````: theorem block.
- ```` ```lemma ````: lemma block.
- ```` ```proposition ````: proposition block.
- ```` ```corollary ````: corollary block.
- ```` ```proof ````: proof block.
- ```` ```remark ````: remark block.
- ```` ```example ````: example block.
- ```` ```text ```` or ```` ```pseudocode ````: listing-style block.

## Citation Behavior

- `[label](url)` becomes a citation marker in running text by default.
- The corresponding URL is emitted in the references section automatically.
- Images use standard markdown image syntax, and a following caption like `Figure 1 ...` matches the default caption pattern.
