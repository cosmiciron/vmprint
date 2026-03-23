---
---

# 01. Your First Document

This is the smallest useful VMPrint document in AST `1.1`.

```json
{
  "documentVersion": "1.1",
  "layout": {
    "pageSize": "A4",
    "margins": { "top": 48, "right": 48, "bottom": 48, "left": 48 },
    "fontFamily": "Arimo",
    "fontSize": 11,
    "lineHeight": 1.4
  },
  "fonts": {
    "regular": "Arimo"
  },
  "styles": {
    "title": {
      "fontSize": 28,
      "fontWeight": "bold",
      "marginBottom": 10
    },
    "body": {
      "marginBottom": 10,
      "textAlign": "justify",
      "allowLineSplit": true,
      "orphans": 2,
      "widows": 2
    }
  },
  "elements": [
    {
      "type": "title",
      "content": "Hello, VMPrint"
    },
    {
      "type": "body",
      "content": "This is a simple AST 1.1 document. The engine will normalize it internally and paginate it into positioned page boxes."
    }
  ]
}
```

Run it:

```bash
vmprint --input document.json --output out.pdf
```

What matters most:

- `documentVersion: "1.1"` is the current and only supported version
- `layout` defines the page and default typography
- `styles` are named style presets keyed by `type`
- `elements` are the authored content tree

Rules of thumb:

- start with normal flow first
- use styles heavily
- only introduce spatial constructs when the page really needs them

Next:

- [02-styles-and-text](02-styles-and-text.html)
