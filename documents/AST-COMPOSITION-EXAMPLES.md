# AST Composition Primitive Examples

This document pressure-tests the proposed `strip` primitive by rewriting a few
real authored patterns that currently use table-shaped hacks.

The goal is not implementation. The goal is to answer a simpler question:

> Does `strip` read more honestly than the current workaround?

If the answer is no, the primitive should not proceed.

Related:

- [AST-COMPOSITION-PRIMITIVE.md](c:\Users\cosmic\Projects\vmprint\documents\AST-COMPOSITION-PRIMITIVE.md)
- [newsletter-layout.json](c:\Users\cosmic\Projects\vmprint\documents\readme-assets\newsletter-layout.json)
- [17-header-footer-test.json](c:\Users\cosmic\Projects\vmprint\engine\tests\fixtures\regression\17-header-footer-test.json)

---

## 1. Newsletter Byline Band

### Current authored workaround

Today this is expressed as a two-column table:

```json
{
  "type": "table",
  "content": "",
  "properties": {
    "style": { "marginBottom": 3 },
    "table": {
      "columnGap": 0,
      "columns": [
        { "mode": "flex", "fr": 1 },
        { "mode": "flex", "fr": 1 }
      ]
    }
  },
  "children": [{
    "type": "table-row",
    "content": "",
    "children": [
      {
        "type": "table-cell",
        "content": "By Uzo Z.T. (aka cosmiciron)",
        "properties": { "style": { "fontFamily": "Cousine", "fontSize": 6.5 } }
      },
      {
        "type": "table-cell",
        "content": "MARCH 2026 · ENGINE V2.4",
        "properties": { "style": { "fontFamily": "Cousine", "fontSize": 6.5, "textAlign": "right" } }
      }
    ]
  }]
}
```

### Proposed `strip`

```json
{
  "type": "strip",
  "content": "",
  "properties": {
    "style": { "marginBottom": 3 },
    "strip": {
      "tracks": [
        { "mode": "flex", "fr": 1 },
        { "mode": "flex", "fr": 1 }
      ],
      "gap": 0
    }
  },
  "slots": [
    {
      "id": "left",
      "elements": [
        {
          "type": "byline-left",
          "content": "By Uzo Z.T. (aka cosmiciron)"
        }
      ]
    },
    {
      "id": "right",
      "elements": [
        {
          "type": "byline-right",
          "content": "MARCH 2026 · ENGINE V2.4"
        }
      ]
    }
  ]
}
```

### Why this appears better

- says "composition band", not "data table"
- no fake `table-row`
- no fake `table-cell`
- no implication of tabular semantics or repeated headers

---

## 2. Newsletter Footer Band

### Current authored workaround

Today this is a three-column footer table:

```json
{
  "type": "table",
  "content": "",
  "properties": {
    "style": { "borderTopWidth": 0.5, "borderTopColor": "#9aacbf" },
    "table": {
      "columnGap": 0,
      "columns": [
        { "mode": "flex", "fr": 1 },
        { "mode": "fixed", "value": 36 },
        { "mode": "flex", "fr": 1 }
      ]
    }
  },
  "children": [{
    "type": "table-row",
    "content": "",
    "children": [
      { "type": "table-cell", "content": "VMPRINT QUARTERLY · LAYOUT SHOWCASE" },
      { "type": "table-cell", "content": "{pageNumber}" },
      { "type": "table-cell", "content": "ENGINE V2.4 · vmprint.dev" }
    ]
  }]
}
```

### Proposed `strip`

```json
{
  "type": "strip",
  "content": "",
  "properties": {
    "style": { "borderTopWidth": 0.5, "borderTopColor": "#9aacbf" },
    "strip": {
      "tracks": [
        { "mode": "flex", "fr": 1 },
        { "mode": "fixed", "value": 36 },
        { "mode": "flex", "fr": 1 }
      ],
      "gap": 0
    }
  },
  "slots": [
    {
      "id": "left",
      "elements": [
        { "type": "footer-left", "content": "VMPRINT QUARTERLY · LAYOUT SHOWCASE" }
      ]
    },
    {
      "id": "center",
      "elements": [
        { "type": "footer-page", "content": "{pageNumber}" }
      ]
    },
    {
      "id": "right",
      "elements": [
        { "type": "footer-right", "content": "ENGINE V2.4 · vmprint.dev" }
      ]
    }
  ]
}
```

### Why this appears better

- expresses a footer band directly
- center folio is obvious
- author intent is visible without reading cell padding and row wrappers

---

## 3. Header/Footer Fixture Folio Strip

### Current authored workaround

The footer in
[17-header-footer-test.json](c:\Users\cosmic\Projects\vmprint\engine\tests\fixtures\regression\17-header-footer-test.json)
uses a three-column table in both odd and even variants.

### Proposed `strip`

Odd-page footer:

```json
{
  "type": "strip",
  "content": "",
  "properties": {
    "strip": {
      "tracks": [
        { "mode": "flex", "fr": 1 },
        { "mode": "fixed", "value": 32 },
        { "mode": "flex", "fr": 1 }
      ],
      "gap": 8
    }
  },
  "slots": [
    {
      "id": "left",
      "elements": [
        { "type": "folio-left", "content": "A Study in Page Regions" }
      ]
    },
    {
      "id": "center",
      "elements": [
        { "type": "folio-center", "content": "{pageNumber}" }
      ]
    },
    {
      "id": "right",
      "elements": [
        { "type": "folio-right", "content": "I · The Problem of Regions" }
      ]
    }
  ]
}
```

Even-page footer simply swaps left and right content emphasis in the same
authored shape.

### Why this appears better

- reads like a folio line, not like data rows
- odd/even variants remain simple content swaps
- no temptation to use table semantics for a non-table problem

---

## 4. Evaluation Questions

`strip` only deserves to move forward if the answers are mostly "yes":

1. Does the authored intent become clearer immediately?
2. Is the shape shorter or at least cognitively lighter than the table hack?
3. Does it stay obviously distinct from both `table` and `zone-map`?
4. Can it remain narrow without quickly demanding row spans, nested bands, or
   larger free-form layout powers?
5. Would an author encountering it for the first time guess roughly what it
   does without reading engine internals?

If the answer to any of these trends toward "no", the primitive should be
rethought or dropped.
