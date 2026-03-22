# 04. Headers, Footers, And Page Control

VMPrint supports running page regions and a few important pagination controls.

## Header and footer

`header` and `footer` are page regions, not ordinary body flow.

Use `strip` for most running-head and folio compositions. It is a better fit than `table` for logo-plus-title headers or `page x of y` footers.

```json
{
  "header": {
    "firstPage": null,
    "default": {
      "elements": [
        {
          "type": "strip",
          "stripLayout": {
            "tracks": [
              { "mode": "fixed", "value": 18 },
              { "mode": "flex", "fr": 1 }
            ],
            "gap": 8
          },
          "slots": [
            {
              "elements": [
                {
                  "type": "image",
                  "image": {
                    "mimeType": "image/png",
                    "fit": "contain",
                    "data": "data:image/png;base64,..."
                  },
                  "properties": { "style": { "width": 14, "height": 14 } }
                }
              ]
            },
            { "elements": [{ "type": "header-title", "content": "Acme Corp - Quarterly Report" }] }
          ]
        }
      ]
    }
  },
  "footer": {
    "default": {
      "elements": [
        {
          "type": "strip",
          "stripLayout": {
            "tracks": [
              { "mode": "flex", "fr": 1 },
              { "mode": "fixed", "value": 40 },
              { "mode": "flex", "fr": 1 }
            ],
            "gap": 8
          },
          "slots": [
            { "elements": [{ "type": "footer-left", "content": "VMPRINT QUARTERLY" }] },
            { "elements": [{ "type": "footer-page", "content": "Page {pageNumber} of {totalPages}" }] },
            { "elements": [{ "type": "footer-right", "content": "vmprint.dev" }] }
          ]
        }
      ]
    }
  }
}
```

## Keep-with-next

Use `keepWithNext` when a heading should not be stranded away from its first paragraph.

```json
{
  "type": "section-head",
  "content": "Observation 01",
  "properties": {
    "keepWithNext": true
  }
}
```

## Page breaks

Use `pageBreakBefore` sparingly when a new section truly needs a fresh page.

```json
{
  "type": "chapter-head",
  "content": "Part Two",
  "properties": {
    "pageBreakBefore": true
  }
}
```

## Page numbering

In headers and footers, token replacement happens automatically for values like:

- `{pageNumber}`
- `{physicalPageNumber}`
- `{totalPages}`

Use page regions for repeated composition; keep ordinary document content in `elements`.

Next:

- [05-images-tables-and-overlays.md](c:\Users\cosmic\Projects\vmprint\documents\authoring\05-images-tables-and-overlays.md)
