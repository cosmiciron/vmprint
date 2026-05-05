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

## Odd-sized pages

Use `layout.pageTemplates` when a document needs pages with different physical
dimensions or margins. Templates are matched per page before layout, so the
engine measures body flow, headers, footers, overlays, and debug geometry
against the active page size.

```json
{
  "layout": {
    "pageSize": { "width": 460, "height": 360 },
    "margins": { "top": 32, "right": 32, "bottom": 32, "left": 32 },
    "pageTemplates": [
      {
        "pageIndex": 1,
        "pageSize": { "width": 280, "height": 420 },
        "margins": { "top": 34, "right": 22, "bottom": 34, "left": 22 }
      },
      {
        "pageIndex": 2,
        "pageSize": { "width": 420, "height": 230 },
        "margins": { "top": 20, "right": 44, "bottom": 20, "left": 44 }
      }
    ]
  }
}
```

`pageIndex` is zero-based: `1` means the second physical page. You can also use
selectors such as `"first"`, `"odd"`, `"even"`, and `"all"` for broader rules;
later templates refine earlier matches.

## Page numbering

In headers and footers, token replacement happens automatically for values like:

- `{pageNumber}`
- `{physicalPageNumber}`
- `{totalPages}`

Use page regions for repeated composition; keep ordinary document content in `elements`.

## Partial simulation

The engine can stop layout after a requested page. This is useful for previews,
incremental flow APIs, and tools that only need to inspect the first part of a
document.

```ts
const pages = await engine.layout({ stopAtPage: 1 });
```

`stopAtPage` is also zero-based and inclusive, so `1` produces pages `0` and `1`
when the document reaches that far. The simulation report records the stop as
`"page-limit"`; this distinguishes an intentional prefix run from a complete
document.

Next:

- [05-images-tables-and-overlays](05-images-tables-and-overlays.html)
