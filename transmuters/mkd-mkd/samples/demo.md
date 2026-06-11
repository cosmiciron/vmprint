---
as: mkd
links:
  mode: inline
references:
  heading: References
footnotes:
  heading: Footnotes
dropCap:
  openingParagraph:
    enabled: true
    lines: 3
    characters: 1
    gap: 2
typography:
  smartQuotes: true
---

# VMPrint Markdown Demo

:: A compact sample that exercises the shared markdown-core tags

This opening paragraph uses a [regular inline link](https://example.com/docs) and a footnote.[^intro]

<!-- dropcap lines=3 chars=1 gap=2 -->
The explicit `dropcap` comment tag also works when you want to mark a specific paragraph instead of relying on config.

## Lists

- Plain unordered item
- [ ] Task item
- [x] Completed task

1. Ordered item
2. Ordered item

## Definition List

Term One
: The first definition description.

Term Two
: The second definition description.

## Quote And Code

> Block quotes render as display text in the shared markdown transmuters.

```text
Plain code fences become code-block elements.
```

## Table

| Name | Role | Status |
| --- | --- | --- |
| Aster | Editor | Ready |
| Rowan | Designer | Drafting |

## Image

![Tiny demo figure](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+yF9sAAAAASUVORK5CYII=)

Figure 1 Minimal embedded image caption.

---

## Closing

Another paragraph with a reference-style link [VMPrint site](https://example.com/vmprint).

[^intro]: Footnotes are collected at the end of the document.
