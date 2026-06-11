# Markdown Tags Reference

This transmuter uses the shared `markdown-core` syntax. Use [templates/starter.md](templates/starter.md) for a blank scaffold and [samples/demo.md](samples/demo.md) for a full example.

## Frontmatter

Put YAML between leading `---` lines to override config.

```md
---
links:
  mode: inline
---
```

## Structural Tags

- `#` to `######`: headings.
- A paragraph immediately after the first `#` that starts with `::` becomes a subheading.
- `---`: thematic break.
- `> ...`: block quote.
- `<!-- dropcap ... -->`: apply a drop cap to the next paragraph.

## List And Definition Tags

- `- item`: unordered list.
- `- [ ] item` / `- [x] item`: task list.
- `1. item`: ordered list.
- `Term` followed by `: Definition`: definition list.

## Display Tags

- Fenced code blocks become `code-block` output.
- Tables use normal pipe-table markdown.
- Images use standard markdown image syntax.
- A caption paragraph immediately after an image can be picked up by config patterns such as `Figure 1 ...`.

## Inline Tags

- `[label](url)`: link.
- `![alt](src)`: image.
- `` `code` ``: inline code.
- `[^id]` plus `[^id]: ...`: footnote.
