# Layout Zones

**Status: Shipped** — `zone-map` element implemented and released in engine v0.3.3. See `documents/LAYOUT-SKILL.md` §10a and `documents/AST-REFERENCE.md` §11a for usage.

This document captures the architectural concept of Layout Zones — the game-engine-native answer to the problem of independent, side-by-side content regions on a page.

It exists to record *why* we arrived at this model so that future decisions stay grounded in the same reasoning.

---

## 1. The Problem in Game Terms

Traditional typesetting asks: *how do we make a container element hold multiple independent columns?*

That framing leads to tree nesting: `grid > grid-cell > content`. Each cell is a child of the grid, which is a child of the page flow. The content hierarchy mirrors the layout hierarchy.

This is wrong for a game engine.

In a 2D RPG, when a dungeon has a main room and a side room, neither room is a *child* of the other. They are both **regions of the same map** — independent spaces that share a world coordinate system. Each room has its own:

- Bounded area (width, height, position in world space)
- Internal coordinate origin (content is positioned relative to the room's own origin)
- Independent entity list (the room's content runs its own logic)
- Rendering pass (the room is rendered separately and composited onto the map)

The map does not care what is inside the rooms. The rooms do not know about each other. The compositor assembles the final frame by placing each room's rendered output at its world-space offset.

That is the model.

---

## 2. The Core Principle

> The page is a map. Layout Zones are regions on that map. Content flows are assigned to zones, not nested inside containers.

A Layout Zone is not a block-level element in the document flow. It is a **named, positioned layout context** — a bounded rectangle in page space that runs an independent layout session. The zone knows its `(x, y, width, height)`. The layout engine runs the full block-layout machinery inside it, clipped to its bounds. The compositor offsets the zone's output boxes by `(x, y)` when writing to the page.

Zones are **parallel**, not hierarchical. They are peers on the map, not parent-child nodes in a tree.

---

## 3. Why This Is Better Than a Grid Container

The grid container approach (`grid > grid-cell`) is a local solution: it solves side-by-side columns at the element level. Layout Zones are a general spatial primitive that solves a much wider class of problems with the same mechanism:

| Use case | Grid container | Layout Zones |
|---|---|---|
| Side-by-side columns | Yes, but only inline | Yes — any zones at same Y |
| Sidebar at arbitrary page position | No | Yes — zone at explicit `(x, y)` |
| Content that continues in a non-adjacent region | No | Yes — zone B is the continuation of zone A's overflow |
| Overlapping regions | No | Yes — zones are composited, so overlap is legal |
| Different column counts in different zones | No | Yes — each zone runs independent layout |

Features 1 (Macro Grids), 4 (Linked Frames), and future free-form page geometry all reduce to the same primitive: **a zone with an `(x, y, width, height)` and an independent content flow**.

---

## 4. The AST Shape (Shipped — engine v0.3.3)

A `zone-map` element defines zones and assigns content flows to them. It is a block-level element that occupies a region of the page.

```json
{
  "type": "zone-map",
  "properties": {
    "zones": {
      "columns": [
        { "mode": "flex", "fr": 2 },
        { "mode": "flex", "fr": 1 }
      ],
      "gap": 12
    },
    "style": { "marginBottom": 16 }
  },
  "zones": [
    {
      "id": "main",
      "elements": [ ]
    },
    {
      "id": "sidebar",
      "elements": [ ]
    }
  ]
}
```

Key naming distinctions from the draft:
- Column widths live at `properties.zones.columns` (not `properties.columns`).
- Gap lives at `properties.zones.gap` (not `properties.gap`).
- Zone content is in `elements[]` (not `children[]`) to distinguish zones from DOM children.

Column widths are resolved using `solveTrackSizing` (the same solver tables use) against the containing flow width minus gaps. The resulting widths and `x` offsets are assigned to zones in order.

V1: height always auto — zone sizes to its tallest content element. The `zone-map` element's height in the main flow equals the maximum zone height. Overflow-to and explicit height are deferred to V2.

---

## 5. Implementation Model

Each zone runs as an **independent sub-session** of the main layout engine:

1. **Width resolution** — `solveTrackSizing` resolves column widths from the `properties.zones.columns` definition and the available flow width.
2. **Per-zone layout pass** — for each zone, run a full layout pass over the zone's `elements` using the existing block-layout machinery (packager loop, story handling, floats, etc.), constrained to `width = zone.resolvedWidth`.
3. **Height settlement** — if `height: "auto"`, the zone's height = the tallest output box bottom. If fixed, clip.
4. **Box offset** — all boxes produced by the zone are offset by `(zone.x, zone.y)` relative to the `zone-map`'s own position in the main flow.
5. **zone-map height** — the `zone-map` element's height in the main flow = the maximum settled zone height (i.e., the height of the tallest column).

This is exactly how a game engine composites independent room renders onto the world map.

---

## 6. Relationship to Existing Architecture

Layout Zones do not replace or conflict with any existing engine primitive:

- **`story`** remains the right tool for a single continuous multi-column text flow (text that snakes from column to column). If you want the *same* content to flow across columns, use `story`. If you want *independent* content in each column, use a `zone-map`.
- **`table`** remains the right tool for tabular data with shared row heights, repeating headers, and cell-level text layout. Tables are data structures. Zones are layout structures.
- **Block floats and column spans** (Features 2 and 3) operate within a zone's independent layout pass exactly as they do in the main flow — no special handling needed.
- **Feature 4 (Linked Frames)** becomes `overflowTo` on a zone — the overflow of zone A is routed as the input flow of zone B. The zone mechanism provides the spatial plumbing; the flow routing is a property.

---

## 7. Open Questions

These should be resolved before implementation begins:

1. **Pagination** — **Resolved: `move-whole` for V1.** The entire `zone-map` moves to the next page if it doesn't fit. Splitting parallel independent sub-sessions across a page break is a fundamentally different orchestration problem — the two passes are no longer synchronized at the split boundary. Per-zone splitting is deferred to a future version once the core zone mechanism is stable.

2. **Zone height alignment** — should all zones in a row stretch to the height of the tallest zone (like CSS `align-items: stretch`)? Or does each zone have its own independent height? Default: each zone is its own height; background/border painting uses each zone's natural height. Stretch alignment can be added as an opt-in `align: "stretch"` property on the `zone-map`.

3. **Explicit `(x, y)` zones** — the draft uses `columns` to auto-compute `x` positions. Allowing fully explicit `x`, `y`, `width`, `height` per zone is the **endgame**: it is the InDesign absolute-positioned text frame model expressed natively in a JSON AST. With explicit coordinates, the engine becomes a full free-form page geometry system — zones can overlap, straddle the margin, or occupy any sub-rectangle of the page. This is the right long-term direction. V1 implements column-auto mode; explicit coordinates are the natural V2 extension of the same primitive.

4. **Nested zone-maps** — can a zone's `children` contain another `zone-map`? There is no architectural reason to forbid it, but we should confirm the recursive layout pass handles this cleanly. The expectation is that it works by default once the sub-session model is in place, since the sub-session runs the full block-layout machinery which already dispatches to all packager types.
