# AST 1.1 Properties Cleanup Examples

This document pressure-tests the proposed AST 1.1 cleanup against real
authored documents.

The goal is simple:

- if the new surface reads more honestly on real fixtures, it is probably good
- if it feels more awkward than the current AST, we should stop and revise it

This document does not change the runtime. It only rewrites representative
snippets into the proposed cleaned-up authored shape.

Related:

- [AST-1.1-PROPERTIES-CLEANUP.md](c:\Users\cosmic\Projects\vmprint\documents\AST-1.1-PROPERTIES-CLEANUP.md)
- [11-story-image-floats.json](c:\Users\cosmic\Projects\vmprint\engine\tests\fixtures\regression\11-story-image-floats.json)
- [20-block-floats-and-column-span.json](c:\Users\cosmic\Projects\vmprint\engine\tests\fixtures\regression\20-block-floats-and-column-span.json)
- [21-zone-map-sidebar.json](c:\Users\cosmic\Projects\vmprint\engine\tests\fixtures\regression\21-zone-map-sidebar.json)
- [newsletter-layout.json](c:\Users\cosmic\Projects\vmprint\documents\readme-assets\newsletter-layout.json)

---

## 1. Proposed AST 1.1 Surface

The following shape is what these examples are testing:

```typescript
interface Element {
    type: string;
    content: string;
    children?: Element[];
    slots?: StripSlot[];
    zones?: ZoneDefinition[];

    columns?: number;
    gutter?: number;
    balance?: boolean;

    image?: EmbeddedImagePayload;
    table?: TableLayoutOptions;
    zoneLayout?: ZoneLayoutOptions;
    stripLayout?: StripLayoutOptions;
    dropCap?: DropCapSpec;
    columnSpan?: 'all' | number;

    properties?: ElementProperties;
}
```

Working rule:

- promote clearly structural fields
- keep `properties` for overrides, metadata, and cross-cutting behavior

The exact names being pressure-tested here are:

- `image`
- `table`
- `zoneLayout`
- `stripLayout`
- `dropCap`
- `columnSpan`

---

## 2. Story Image Float

Source:
[11-story-image-floats.json](c:\Users\cosmic\Projects\vmprint\engine\tests\fixtures\regression\11-story-image-floats.json)

### Current AST

```json
{
  "type": "image",
  "content": "",
  "properties": {
    "layout": {
      "mode": "float",
      "align": "right",
      "wrap": "around",
      "gap": 8
    },
    "style": {
      "width": 100,
      "height": 150
    },
    "image": {
      "mimeType": "image/png",
      "fit": "fill",
      "data": "<base64>"
    }
  }
}
```

### Proposed AST 1.1

```json
{
  "type": "image",
  "content": "",
  "image": {
    "mimeType": "image/png",
    "fit": "fill",
    "data": "<base64>"
  },
  "properties": {
    "layout": {
      "mode": "float",
      "align": "right",
      "wrap": "around",
      "gap": 8
    },
    "style": {
      "width": 100,
      "height": 150
    }
  }
}
```

### Verdict

Better.

Why:

- the node now visibly contains an image
- payload and layout behavior are no longer mixed together
- `properties.layout` still remains awkward, but the content identity is much
  clearer

---

## 3. Story Column Span

Source:
[20-block-floats-and-column-span.json](c:\Users\cosmic\Projects\vmprint\engine\tests\fixtures\regression\20-block-floats-and-column-span.json)

### Current AST

```json
{
  "type": "section-break",
  "content": "Column Span",
  "properties": {
    "sourceId": "section-span",
    "columnSpan": "all"
  }
}
```

### Proposed AST 1.1

```json
{
  "type": "section-break",
  "content": "Column Span",
  "columnSpan": "all",
  "properties": {
    "sourceId": "section-span"
  }
}
```

### Verdict

Much better.

Why:

- `columnSpan` is clearly a first-class authored layout directive
- it is easier to notice in reviews
- it no longer hides among unrelated metadata

---

## 4. Drop Cap

Source:
[newsletter-layout.json](c:\Users\cosmic\Projects\vmprint\documents\readme-assets\newsletter-layout.json)

### Current AST

```json
{
  "type": "body",
  "content": "Every element in a VMPrint document...",
  "properties": {
    "dropCap": {
      "enabled": true,
      "lines": 3,
      "gap": 5,
      "characterStyle": {
        "fontFamily": "Tinos",
        "fontWeight": "bold",
        "color": "#1a3a5c"
      }
    }
  }
}
```

### Proposed AST 1.1

```json
{
  "type": "body",
  "content": "Every element in a VMPrint document...",
  "dropCap": {
    "enabled": true,
    "lines": 3,
    "gap": 5,
    "characterStyle": {
      "fontFamily": "Tinos",
      "fontWeight": "bold",
      "color": "#1a3a5c"
    }
  }
}
```

### Verdict

Better.

Why:

- this reads like a meaningful authored feature, not a tucked-away tweak
- it matches how prominent drop-cap behavior really is

---

## 5. Zone Map

Source:
[21-zone-map-sidebar.json](c:\Users\cosmic\Projects\vmprint\engine\tests\fixtures\regression\21-zone-map-sidebar.json)

### Current AST

```json
{
  "type": "zone-map",
  "properties": {
    "zones": {
      "columns": [
        { "mode": "flex", "fr": 2 },
        { "mode": "flex", "fr": 1 }
      ],
      "gap": 16
    },
    "style": {
      "marginTop": 12,
      "marginBottom": 12
    }
  },
  "zones": [
    { "id": "main", "elements": [/* ... */] },
    { "id": "sidebar", "elements": [/* ... */] }
  ]
}
```

### Proposed AST 1.1

```json
{
  "type": "zone-map",
  "zoneLayout": {
    "columns": [
      { "mode": "flex", "fr": 2 },
      { "mode": "flex", "fr": 1 }
    ],
    "gap": 16
  },
  "properties": {
    "style": {
      "marginTop": 12,
      "marginBottom": 12
    }
  },
  "zones": [
    { "id": "main", "elements": [/* ... */] },
    { "id": "sidebar", "elements": [/* ... */] }
  ]
}
```

### Verdict

Slightly better.

Why:

- the region descriptors and the region layout model now sit side-by-side
- the node becomes more structurally honest

Naming note:

- `zoneLayout` reads better than promoting this field as just `zones`, because
  `zones` is already taken by the region descriptors themselves

---

## 6. Strip

Source:
[newsletter-layout.json](c:\Users\cosmic\Projects\vmprint\documents\readme-assets\newsletter-layout.json)

### Current AST

```json
{
  "type": "strip",
  "properties": {
    "style": { "marginBottom": 3 },
    "strip": {
      "gap": 0,
      "tracks": [
        { "mode": "flex", "fr": 1 },
        { "mode": "flex", "fr": 1 }
      ]
    }
  },
  "slots": [
    { "id": "left", "elements": [/* ... */] },
    { "id": "right", "elements": [/* ... */] }
  ]
}
```

### Proposed AST 1.1

```json
{
  "type": "strip",
  "stripLayout": {
    "gap": 0,
    "tracks": [
      { "mode": "flex", "fr": 1 },
      { "mode": "flex", "fr": 1 }
    ]
  },
  "properties": {
    "style": { "marginBottom": 3 }
  },
  "slots": [
    { "id": "left", "elements": [/* ... */] },
    { "id": "right", "elements": [/* ... */] }
  ]
}
```

### Verdict

Better.

Why:

- `slots` and `stripLayout` clearly belong together
- `properties` stops carrying authored structure for the node

Naming note:

- `stripLayout` feels clearer than a generic `strip` field on the element
  because it signals that this is the track model, not the strip content
  itself

---

## 7. Table

Source:
many fixtures, especially
[09-tables-spans-pagination.json](c:\Users\cosmic\Projects\vmprint\engine\tests\fixtures\regression\09-tables-spans-pagination.json)

### Current AST

```json
{
  "type": "table",
  "content": "",
  "properties": {
    "table": {
      "headerRows": 1,
      "repeatHeader": true,
      "columns": [
        { "mode": "flex", "fr": 2 },
        { "mode": "flex", "fr": 1 }
      ]
    }
  },
  "children": [/* rows */]
}
```

### Proposed AST 1.1

```json
{
  "type": "table",
  "content": "",
  "table": {
    "headerRows": 1,
    "repeatHeader": true,
    "columns": [
      { "mode": "flex", "fr": 2 },
      { "mode": "flex", "fr": 1 }
    ]
  },
  "children": [/* rows */]
}
```

### Verdict

Better, but less dramatically than the others.

Why:

- it is more honest structurally
- but tables were already fairly readable because of user familiarity

This feels worth doing, but it is not the most emotionally compelling part of
the cleanup.

---

## 8. What These Examples Suggest

### Strong promotions

These felt clearly better in real snippets:

- `image`
- `columnSpan`
- `dropCap`
- `stripLayout`

### Good but less dramatic

- `table`
- `zoneLayout`

These still seem worth promoting, but mainly for coherence and long-term
cleanliness rather than immediate authored delight.

### Still unresolved

- `properties.layout`

The examples make the current problem even clearer:

- once the other structural fields are promoted out, `layout` stands out more
  sharply as a buried spatial directive

That confirms the earlier decision:

- do not freeze `layout` as the final shape
- but do not rush its redesign into AST 1.1 either

---

## 9. Recommendation

These pressure tests support the AST 1.1 cleanup direction.

Best current naming set:

- `image`
- `table`
- `zoneLayout`
- `stripLayout`
- `dropCap`
- `columnSpan`

And the most important conclusion is this:

- the proposed promotions make real authored AST look cleaner immediately
- they do so without inventing any new concepts
- which means this is cleanup, not over-design
