# 02. Styles And Text

VMPrint’s default authoring model is still simple document flow.

## Styles

`styles` is a named table keyed by element `type`.

```json
{
  "styles": {
    "headline": {
      "fontFamily": "Tinos",
      "fontSize": 30,
      "fontWeight": "bold",
      "lineHeight": 1.08,
      "marginBottom": 8
    },
    "deck": {
      "fontFamily": "Tinos",
      "fontSize": 12,
      "fontStyle": "italic",
      "lineHeight": 1.4,
      "marginBottom": 10
    },
    "body": {
      "fontSize": 10,
      "lineHeight": 1.45,
      "textAlign": "justify",
      "allowLineSplit": true,
      "orphans": 2,
      "widows": 2,
      "marginBottom": 10
    }
  }
}
```

Then author elements against those style names:

```json
[
  { "type": "headline", "content": "A Better Authored Surface" },
  { "type": "deck", "content": "Keep the source simple. Let the engine do the heavy spatial work." },
  { "type": "body", "content": "Paragraph one..." },
  { "type": "body", "content": "Paragraph two..." }
]
```

## Rich text

Use nested `children` when you need inline emphasis or mixed inline objects.

```json
{
  "type": "body",
  "children": [
    { "type": "text", "content": "VMPrint supports " },
    { "type": "text", "content": "rich inline text", "properties": { "style": { "fontWeight": "bold" } } },
    { "type": "text", "content": " without making the whole AST DOM-like." }
  ]
}
```

## Drop caps

AST `1.1` promotes drop-cap structure to a first-class field.

```json
{
  "type": "body",
  "content": "Every element in a VMPrint document is measured with sub-point precision...",
  "dropCap": {
    "enabled": true,
    "lines": 3,
    "gap": 8,
    "style": {
      "fontFamily": "Tinos",
      "fontSize": 44,
      "fontWeight": "bold"
    }
  }
}
```

Use plain flow as long as you can. Reach for spatial constructs only when flow stops matching the page’s intent.

Next:

- [03-stories-strips-and-zones.md](c:\Users\cosmic\Projects\vmprint\documents\authoring\03-stories-strips-and-zones.md)
