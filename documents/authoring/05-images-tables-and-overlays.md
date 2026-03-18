# 05. Images, Tables, And Overlays

This chapter covers the remaining common authoring tools.

## Images

AST `1.1` promotes image payload to a top-level field.

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

See also:

- [OVERLAY.md](c:\Users\cosmic\Projects\vmprint\documents\OVERLAY.md)
- [LAYOUT-ZONES.md](c:\Users\cosmic\Projects\vmprint\documents\LAYOUT-ZONES.md)

After this point, use the reference as needed:

- [AST-REFERENCE.md](c:\Users\cosmic\Projects\vmprint\documents\AST-REFERENCE.md)
