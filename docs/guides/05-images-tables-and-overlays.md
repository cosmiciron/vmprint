# 05. Images, Tables, And Overlays

This chapter covers the remaining common authoring tools.

## Images

```json
{
  "type": "image",
  "image": {
    "mimeType": "image/png",
    "data": "data:image/png;base64,...",
    "fit": "contain"
  },
  "properties": {
    "style": {
      "width": 180,
      "height": 120,
      "marginBottom": 8
    }
  }
}
```

## Tables

Tables remain intentionally familiar.

```json
{
  "type": "table",
  "table": {
    "columns": [
      { "mode": "fixed", "value": 120 },
      { "mode": "flex", "fr": 1 }
    ],
    "repeatHeader": true,
    "headerRows": 1
  },
  "children": [
    {
      "type": "table-row",
      "children": [
        { "type": "table-cell", "content": "Feature" },
        { "type": "table-cell", "content": "Meaning" }
      ]
    },
    {
      "type": "table-row",
      "children": [
        { "type": "table-cell", "content": "strip" },
        { "type": "table-cell", "content": "One-row aligned composition band" }
      ]
    }
  ]
}
```

Use tables for tables. Use `strip` for aligned bands. Use `zone-map` for independent regions.

A practical comparison:

- use `table` when the rows and columns express data
- use `strip` when the layout is one aligned band
- use `zone-map` when a main body, note field, sidebar, or inset should behave as separate regions

If you find yourself trying to use a table just to hold a sidebar next to article text, that is usually a sign that `zone-map` is the better fit.

## Overlays

Overlays are debug and inspection tools, not authored content.

If `document.json` sits next to `document.overlay.mjs`, the CLI will auto-load it:

```bash
vmprint --input document.json --output out.pdf
```

Good overlay uses:

- draw content frames
- highlight zone footprints
- annotate gutters and reserved areas
- inspect page-local terrain and actor occupancy

The built-in debug overlay is especially useful now for `zone-map` work because it can show authored zone regions directly. That makes it much easier to see whether your field geometry matches your intent before you tune typography inside it.

See also:

- [Overlay System](../reference/overlay.html)

Next:

- [06-scripting](06-scripting.html)

After this point, use the references as needed:

- [AST Reference](../reference/ast.html)
- [Scripting API](../reference/scripting.html)
