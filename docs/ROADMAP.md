# VMPrint Engine Roadmap & Typography Standards

VMPrint is designed to be a strict, deterministic, and high-performance layout VM. To achieve our ~100ms render speeds and lightweight footprint, the v1.0 engine prioritizes pragmatic, predictable block-stacking and spatial layout over 100% compliance with every historical typography specification.

This document outlines our current capabilities, known limitations, and the aspirational roadmap for future engine versions. It draws on industry standards including Unicode (UAX #9, #14, #29), OpenType, and CSS Text Level 3.

## 1. Current Capabilities (The v1.0 Foundation)

The current engine is ready for practical OSS use in standard reporting and technical handbook workflows. Screenplay generation support exists, but remains under active hardening against the v1 checklist bar.

**Reliability & Integration:**

- Deterministic pagination and layout on repeated runs.
- Input immutability (engine does not mutate the source document tree).
- Strict renderer contracts (one `addPage` per layout page, stable painter order, z-index ordering).

**Text & Pagination Layout:**

- Unicode grapheme-safe segmentation and greedy line breaking (with overflow clamp fallback).
- Fully functional automatic hyphenation with language dictionary selection.
- Standard justification quality with proper handling of non-final lines.
- Reliable overflow pagination, including `keep-with-next` chaining, `page-break-before`, and tested orphan/widow handling in baseline scenarios.
- Mixed rich text runs (family/size/weight/style) align coherently on a shared baseline.

**Advanced Tables:**

- Row-boundary pagination for multi-page tables (tables will not split mid-row).
- Automatic header repeating on continuation pages.
- Stable `colspan` and `rowspan` execution.

**International Coverage (Current State):**

- Pragmatic multilingual support for common LTR/CJK/Indic scenarios.
- Arabic/Hebrew are currently partial-support paths and are documented as such for v1 OSS launch.

## 2. v1 OSS Release Gate

Open-source launch is gated by reliability and clarity, not spec completeness.

- All checklist baseline gates marked "Covered."
- No known crashers or infinite-loop scenarios in baseline fixtures.
- README clearly documents supported features, current partial areas, and explicit non-goals.
- No new non-essential typography feature work unless it directly reduces baseline launch risk.

## 3. Short-Term Roadmap (v1.x Enhancements)

These are features currently marked as `[PARTIAL]` or `[MISSING]` that we aim to stabilize in upcoming minor releases.

- **Advanced Font Metrics:** Implementing extraction of cap height, x-height, and italic angles for superior inline object alignment.
- **Enhanced Shaping:** Full cursive attachment positions for Arabic/Hebrew and deeper ligature support (`dlig`).
- **Bidi Completeness:** Upgrading from partial bidi support to full Unicode Bidirectional Algorithm (UAX #9) compliance, including mirror characters and visual-order recomputing on wrapped lines.
- **Table Flexibility:** Proportional (flex) columns and max-content auto-width column resolution.
- **Margin Semantics:** Formalizing the contract for margin collapsing (or explicit lack thereof) at page boundaries.

**Definition of Done for v1.x items:**

- Feature behavior is documented.
- Fixture coverage is added for nominal and edge cases.
- Renderer-contract interactions are verified where applicable.

**Known Risk Areas (Active Watchlist):**

- Bidi + line wrapping (visual reordering per line).
- Keep-constraint conflict handling (`keep-with-next`, orphans/widows, explicit breaks).
- Page-boundary margin semantics and first-fragment behavior.
- Table width overflow/clip policy consistency.

## 4. Long-Term Typography Vision (v2.0+)

These features represent the pinnacle of digital typesetting but are currently deferred to maintain engine speed and simplicity for v1.0.

- **Optimal Line Breaking:** Upgrading from greedy (first-fit) breaking to Knuth-Plass (TeX-style) optimal paragraph breaking.
- **Optical Margin Alignment:** Hanging punctuation and glyph protrusion.
- **Complex Internationalization:** Vertical writing modes (Japanese tate-gumi) and Ruby annotations.
- **Advanced OpenType:** Stylistic sets, swashes, and historical forms.
- **Accessibility Pipelines:** Tagged PDF output and logical reading order annotations.

## 5. Explicit Non-Goals

To keep VMPrint fast and predictable, we intentionally diverge from some standard web layout behaviors:

- **CSS Margin Collapsing:** VMPrint prefers deterministic, additive block margins for predictable DTP-style layout. Full CSS margin-collapse semantics are not a primary goal.
- **DOM Emulation:** We are a layout VM, not a headless browser. We do not support HTML/CSS input directly.
