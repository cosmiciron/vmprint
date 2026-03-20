# Authoring Experience Phase

*Phase document, March 2026.*

This document defines the formal authoring experience phase for VMPrint.

It is the counterpart to the engine overhaul that preceded it.

The engine overhaul formalized the runtime, solidified the actor model, and
built the communication and simulation infrastructure. That work is complete.
This phase turns toward the author. Its organizing insight, and the principle
that drives every decision in it, is explained below.

---

## 1. The Three-Layer Model

VMPrint's stack has three layers. Understanding their relationship is the key
to understanding why this phase is structured the way it is.

**Layer 1 — Spatial IR (assembly)**

The engine's internal normalized form. Nobody writes this directly. It is what
the engine executes. It should never be shaped by authoring ergonomics.

**Layer 2 — JSON AST (C)**

The direct engine contract. Precise, honest, close to the machine. This is
where you engage the engine without a shield between you and it. It maps
clearly to what the engine actually does. It should stay exactly this way —
no ergonomic abstractions smuggled in, no convenience hacks hardened into the
spec. The AST is the compile target. It is not the primary authoring surface
for most users, but it must be a *clean* compile target so that everything
built above it is built on solid ground.

**Layer 3 — Macros (the standard library)**

Compile-time, parameterized patterns that expand into valid AST before the
engine ever sees the document. The engine receives only expanded AST. The macro
system is purely a preprocessing concern — it does not change the AST spec, it
does not touch the engine, it adds no runtime overhead.

This is the missing layer. This is what makes the engine genuinely accessible
to the developer integrating a backend for an insurance company, to the
designer building a newsletter template, to anyone who must engage with the
engine directly but should not have to re-solve the same structural problems
from scratch every time.

**Draft2Final already demonstrates this at the upper end.** It takes Markdown
and expands it into AST through a fixed expansion. A document that would take
an expert hours to express in raw AST takes minutes in Draft2Final. The macro
layer is the same idea made general: user-defined, parameterizable, composable,
domain-specific, without requiring a full high-level language.

---

## 2. The Core Principle

**Clean before you expand.**

The AST must be a clean compile target before the macro layer is built on top
of it. If the macro expansion produces cluttered AST, the clutter is invisible
to the author but still wrong — it produces unpredictable layout, it is hard
to debug, and it hardens the wrong shape.

The right order is:

1. Tighten the AST into a clean, honest compile target
2. Discover the right macro vocabulary through real documents
3. Build the standard macro library, one domain at a time
4. Expose new engine capabilities through macros, not raw AST additions

---

## 3. What This Phase Is Not

- Not an AST redesign. Existing authored shapes that work remain valid.
  Legacy documents should continue to produce identical output.
- Not a new layout language above the AST.
- Not exposing engine internals as public API.
- Not backward-compatibility work. The AST is young enough that cleanup takes
  priority over migration paths. A conversion tool can be offered; the old
  surface should not be preserved at the cost of the new one.

---

## 4. Sequence

### Phase A — Tighten the AST

The goal is an AST that is a genuinely clean compile target: honest, free of
structural fields buried where they do not belong, with every primitive earning
its place.

**A1. Properties Cleanup** ✓ *Complete*

Promoted six structural fields out of `properties` to first-class `Element`
fields. All legacy AST 1.0 backward compatibility removed. Engine now requires
`documentVersion: "1.1"`.

| Field | Was | Now |
|---|---|---|
| `properties.image` | buried in property bag | `image?: EmbeddedImagePayload` |
| `properties.table` | buried in property bag | `table?: TableLayoutOptions` |
| `properties.zones` | buried in property bag | `zoneLayout?: ZoneLayoutOptions` |
| `properties.strip` | buried in property bag | `stripLayout?: StripLayoutOptions` |
| `properties.dropCap` | buried in property bag | `dropCap?: DropCapSpec` |
| `properties.columnSpan` | buried in property bag | `columnSpan?: number \| "all"` |

**A2. Placement Semantics** ✓ *Complete*

Promoted `properties.layout` story-placement directive to first-class
`placement?: StoryLayoutDirective` on `Element`. An element's spatial role
in a story is now declared explicitly, not hidden inside a generic property bag.

| Field | Was | Now |
|---|---|---|
| `properties.layout` | hidden in property bag | `placement?: StoryLayoutDirective` |

**A3. Strip Already Landed**

`strip` is implemented and validated.
See `AST-COMPOSITION-PRIMITIVE.md` for rationale and constraints.
The `stripLayout` promotion (A1) will complete its surface cleanup.

**A4. Authoring Guide — AST Reference Pass**

The guide currently covers five chapters but each is thin. This pass brings
every chapter to a level where a capable author can follow it against the
cleaned AST without supplementary knowledge.

Chapters that need depth:

- `03-stories-strips-and-zones.md` — the most complex spatial tools; needs
  worked examples, not just shape descriptions
- `04-headers-footers-and-page-control.md` — page regions and running content
  are not obvious from the current text
- `05-images-tables-and-overlays.md` — overlays and placement need proper
  walkthrough

The guide should also gain:

- A chapter on placement semantics once A2 is settled
- An appendix mapping every AST construct to its spatial meaning

Note: the guide at this stage documents the AST directly. The macro-oriented
guide comes in Phase C.

---

### Phase B — Discover the Macro Vocabulary

Macro libraries cannot be designed in the abstract. They are discovered by
authoring real documents and observing where the same structural patterns
recur, where authors reach for the same combinations repeatedly, and where
raw AST forces them to remember things the tool should remember for them.

**Canonical document set**

A small set of representative documents should be authored in raw AST,
maintained, and used as the vocabulary discovery surface:

| Document | What it reveals |
|---|---|
| Letter / Report | Baseline single-flow patterns; typography defaults |
| Newsletter | Column grids, byline bands, pull quotes, editorial strips |
| Technical Manual | Tables, code blocks, continuation, cross-references |
| Form | Repeated field patterns, precise alignment, data regions |
| Magazine Spread | Full-bleed images, non-contiguous zones, feature layouts |

These documents are not just test fixtures. They are the raw material from
which macro vocabularies are extracted. Every time authoring one of these
requires the same cluster of AST nodes written the same way, that cluster is a
macro candidate.

These documents also serve as regression anchors. If output changes
unexpectedly, something broke.

Phase B and Phase A overlap. Awkwardness discovered while authoring feeds back
into A1 and A2 before it hardens.

---

### Phase C — Build the Standard Macro Library

With a clean AST and a discovered vocabulary, the macro library is built one
domain at a time.

**How macros work**

A macro is a named, parameterized pattern that expands into valid AST at
preprocessing time. The engine receives only expanded AST. The preprocessor
is the only new component introduced — no engine changes, no AST spec changes.

A macro invocation looks like an AST node from the author's perspective:

```json
{ "type": "byline", "author": "Jane Smith", "date": "March 2026" }
```

The preprocessor expands it into whatever AST structure the `byline` macro
defines — a strip with two slots, specific styles, appropriate track sizing —
before the engine sees the document. The author never writes the strip
directly. The macro remembers it for them.

Macros can be parameterized, composed from other macros, and published as
domain-specific libraries. The same mechanism that expands a `byline` in a
newsletter library expands a `form-field` in an insurance form library.

**Standard library domains (initial)**

The standard library is not one library. It is a set of domain libraries, each
with its own vocabulary:

- **Typography** — heading hierarchies, pull quotes, drop caps, callouts,
  footnotes; the patterns any text-heavy document needs
- **Editorial** — bylines, mastheads, column strips, jump lines, issue folios;
  the patterns a newsletter or magazine needs
- **Forms** — labeled fields, checkboxes, signature lines, data rows; the
  patterns a structured data document needs
- **Technical** — code blocks with captions, figure references, admonition
  boxes, specification tables; the patterns a manual or spec needs

The authoring guide at this stage is reorganized around macro libraries rather
than raw AST constructs. An author working in the editorial domain reads the
editorial macro guide, not the raw strip and zone-map specification.

**New engine capabilities enter through macros**

New engine capabilities — TOC, reactive running heads, named flows — get their
authored surface as macros, not as raw AST additions.

A TOC is not a new AST node the author must understand. It is a macro that
expands into the AST structure the engine needs to build the TOC reactively.
The author writes:

```json
{ "type": "table-of-contents", "depth": 2 }
```

The macro handles the signal subscription, the observer geometry, the
collector pattern. The author understands the intent. The engine understands
the AST. The macro is the translation layer.

Priority order for new capability macros:

1. **TOC** — clearest demonstration of the engine's reactive geometry
2. **Reactive running heads** — content-driven headers and footers
3. **Named flows / linked frames** — overflow continuation across non-contiguous zones

---

## 5. Exit Condition

This phase is complete when:

> A capable author can produce any document in the canonical set — from a
> simple report to a form to a newsletter with a live TOC — using only the
> domain macro library and its guide, without reading raw AST documentation
> or consulting engine internals.

---

## 6. Design Constraints That Apply Throughout

- **The AST is a compile target, not a user surface.** Nothing in the macro
  layer should leak back into the AST spec. The engine stays clean.

- **Macros expand, they do not wrap.** A macro is not a runtime component with
  lifecycle and state. It is a compile-time pattern that disappears before the
  engine runs. This distinction must be preserved.

- **Vocabulary is discovered, not invented.** Macro names and parameters come
  from real authoring patterns observed in real documents, not from API design
  exercises. Phase B is not optional.

- **Use familiarity where it genuinely helps.** Tables staying tables is
  correct. `story` staying `story` is correct. Macros named after familiar
  document concepts (`byline`, `chapter`, `form-field`) are better than macros
  named after layout mechanisms.

- **The guide is the proof.** If a macro cannot be explained clearly in one
  short guide entry, its parameters are probably wrong.

---

## 7. Related Documents

| Document | Role |
|---|---|
| `AST-REDESIGN-CANDIDATES.md` | Pressure points and redesign priorities |
| `AST-1.1-PROPERTIES-CLEANUP.md` | Properties promotion candidates |
| `AST-SPATIAL-ALIGNMENT.md` | Spatial authoring design rules |
| `AST-COMPOSITION-PRIMITIVE.md` | Strip rationale and constraints |
| `AST-COMPOSITION-EXAMPLES.md` | Strip authored examples |
| `AST-REFERENCE.md` | Full AST contract |
| `documents/authoring/` | The authoring guide (living artifact of this phase) |
| `SIMULATION-RUNTIME.md` | Engine capabilities that Phase C will surface |
| `ADVANCED-LAYOUT-ROADMAP.md` | Feature status for completed engine-side work |
