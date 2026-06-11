---
as: manuscript
style: default
manuscript:
  coverPage:
    mode: separate-cover-page
  runningHeader:
    enabled: true
    format: "{surname} / {shortTitle} / {n}"
  chapter:
    pageBreakBefore: true
  sceneBreak:
    symbol: "#"
  footnotes:
    mode: endnotes
    heading: Notes
typography:
  smartQuotes: true
---

# The Orchard Wake

- author: Mira Sol
- byline: Mira Sol
- email: mira.sol@example.com
- phone: 555-0107
- word-count: 72000
- agent: Northline Literary

## Chapter One

> [epigraph]
> Every inheritance arrives with weather.
> -- Packing-shed notebook

The train came in under rain and smoke.[^orchard]

Mara stood on the platform with one suitcase and a letter she had not yet opened.

### Three Days Later

A titled scene break can come from any heading level below the chapter.

---

An untitled scene break uses the configured scene-break symbol.

> A plain block quote remains a regular indented quotation.

> [poem]
> The orchard kept its frost-lit vow,
> and would not tell its secret now.

> [lyrics]
> Come home before the branches wake,
> before the roots remember.

```extract
The packing shed smelled of apples, copper, and rainwater.
```

```poem
Snow on the latch,
light on the wire,
the gate remembers every hand.
```

```lyrics
Leave the lamp,
leave the key,
leave the old refrain for me.
```

1. Ordered list items are flattened into manuscript paragraphs.
2. They still help authors sketch structure in draft form.

- Bulleted notes also render as paragraphs.
- They are useful in front-end drafting tools.

[^orchard]: Footnotes become endnotes in the manuscript formats.
