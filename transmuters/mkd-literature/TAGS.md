# Literature Tags Reference

This transmuter uses the shared markdown-core syntax with literature-oriented styling for extracts, verse, notes, and inset materials. Use [templates/starter.md](templates/starter.md) as a starting point and [samples/demo.md](samples/demo.md) for a fuller specimen.

## Frontmatter

Use YAML frontmatter for notes headings, typography, and other config.

```md
---
references:
  heading: Notes
---
```

## Core Tags

- `#`, `##`, `###`: headings.
- `:: Subtitle`: subheading marker after the first title.
- `<!-- dropcap ... -->`: mark the next paragraph for a drop cap.
- `> ...`: block quote.
- `---`: thematic break.
- Standard markdown lists, definition lists, links, tables, images, inline code, and footnotes are supported.

## Literature Display Tags

Use fenced code languages to choose special display styles:

- ```` ```verse ```` / ```` ```poetry ```` / ```` ```poem ````: verse block.
- ```` ```extract ```` / ```` ```archive ````: prose extract.
- ```` ```epigraph ````: epigraph block.
- ```` ```letter ````: inset letter or correspondence.
- ```` ```marginalia ````: marginal note block.

## Notes And Captions

- Links are turned into note-style references by default.
- Footnotes still work with `[^id]` references.
- Image captions are recognized from lines such as `Plate I ...`, `Figure 1 ...`, or `Source ...` immediately after the image.
