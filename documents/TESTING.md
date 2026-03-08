# Testing

VMPrint's test suite is built around one conviction: layout must be deterministic. Same document, same fonts, same configuration — identical output, down to the sub-point position of every glyph, every time. Everything else in the test design follows from that.

## Philosophy

A layout engine that produces different output on consecutive runs is broken in the most fundamental way. Determinism is therefore not one property among many — it's the load-bearing invariant that all other correctness properties rest on. If output drifts between runs, snapshot comparisons are meaningless, regression detection is unreliable, and the serializable `Page[]` intermediate loses its value.

From that foundation, the tests pursue four further guarantees:

**Geometry is finite and correct.** Every box must have finite x, y, w, h coordinates. No box may have negative dimensions. No box may escape the page. Every measured line must fit within its box's content width, within a small epsilon for floating-point accumulation.

**Grapheme boundaries are respected.** Line breaks and segment boundaries must never split a grapheme cluster. A combining mark, a variation selector, or a multi-codepoint emoji may not be separated across segments or wrapped lines.

**Input is never mutated.** The engine must not attach internal state (e.g. layout annotations) to the input elements it receives. The same `DocumentInput` must be safely reusable across multiple paginate calls without accumulating side effects.

**Structural invariants hold for complex content.** Row-spanned table cells must not split across page boundaries. Drop caps must not repeat on continuation fragments. Continuation markers (MORE / CONT'D) must appear at the correct positions. Floated images must produce non-uniform line widths in the surrounding text. These are verified explicitly, not left to visual inspection.

---

## Engine Tests

The engine test suite lives in `engine/tests/`. It is structured as three suites that can be run individually or together.

```
npm run test --prefix engine              # all three suites
npm run test:modules --prefix engine      # module extractions only
npm run test:flat    --prefix engine      # flat pipeline invariants only
npm run test:engine  --prefix engine      # regression suite only
```

### Suites

**`module-extractions.spec.ts`** — Verifies that the engine's public API surface is importable and exports the expected symbols. Guards against accidental removal of public exports.

**`flat-pipeline.spec.ts`** — Runs the full layout pipeline on each regression fixture and checks the universal invariants without any fixture-specific logic: finite geometry, box metadata completeness, line width fitting within bounds, and grapheme boundary safety across segments and wrapped lines.

**`engine-regression.spec.ts`** — The main regression suite. For each fixture it:
1. Loads the fixture twice and verifies the canonical IR is identical across loads.
2. Runs `engine.paginate(elements)` twice and deep-compares the results. If pagination is not deterministic, the test fails immediately.
3. Applies fixture-specific structural assertions (described below).
4. Checks the god fixture against its stored snapshot.
5. Renders the pages through a `MockContext` and verifies draw call counts and, for selected fixtures, specific rendering signals.
6. Verifies input immutability after pagination.

### The Harness

`tests/harness/engine-harness.ts` provides shared utilities used across all three suites:

**`MockContext`** — A complete implementation of the `Context` interface that records all draw calls instead of producing any output. No file I/O, no external dependencies. Tracks `pagesAdded`, `textCalls`, `imageCalls`, and the full text and image traces for assertions. This is how the renderer is exercised in tests: run it against `MockContext`, then assert on what it drew.

**`snapshotPages(pages)`** — Converts a `Page[]` into a stable, serializable form for snapshot comparison: box type, position rounded to 6 decimal places, line text, and per-segment metrics (width, ascent, descent, fontFamily). Intentionally excludes volatile internal fields and glyph-level data.

**`assertFlatPipelineInvariants(pages, fixtureName)`** — Checks finite geometry, box metadata presence, line width fitting, and grapheme boundary safety across all boxes in all pages.

**`loadJsonDocumentFixtures(dir?)`** — Discovers and loads all `.json` files from the regression fixtures directory (excluding snapshot files), sorted alphabetically.

### Regression Fixtures

Fixtures live in `engine/tests/fixtures/regression/`. Each is a `DocumentInput` JSON file named by a zero-padded index and a description.

| Fixture | What it exercises |
|---|---|
| `00-all-capabilities` | The god fixture. Full engine surface in one document: 8 pages, tables with colspan/rowspan, drop caps, story zones with floats, multilingual scripts, inline images, continuation markers. |
| `01-text-flow-core` | Paragraph flow, headings, basic line wrapping |
| `02-text-layout-advanced` | Justification (advanced mode), soft-hyphen rendering, RTL text, bidirectional runs |
| `03-typography-type-specimen` | Font weight and style variants, font size scaling |
| `04-multilingual-scripts` | Mixed-script runs: Latin, CJK, Arabic, Devanagari, Thai |
| `05-page-size-letter-landscape` | Letter landscape orientation |
| `06-page-size-custom-landscape` | Custom page dimensions |
| `07-pagination-fragments` | Block splitting, keepWithNext, orphan/widow controls |
| `08-dropcap-pagination` | Drop cap sizing, drop cap pagination, no-repeat on continuation |
| `09-tables-spans-pagination` | colspan, rowspan, row splitting, repeated header rows, span boundary correctness |
| `10-packager-split-scenarios` | keepWithNext, mid-page table, page-top overflow splits |
| `11-story-image-floats` | Story zones, image floats, non-uniform line widths, optical underhang |
| `12-inline-baseline-alignment` | All verticalAlign variants, baseline shift, optical inset metrics |
| `13-inline-rich-objects` | Inline images on text baselines, multi-page continuation |
| `14-flow-images-multipage` | Flow-positioned images, multi-page image pagination |

Many fixtures have a sidecar `.overlay.mjs` file that draws debug annotations — margin rules, box outlines, grid lines — when the fixture is rendered to a PDF using the `generate-fixture-pdfs.mjs` script. These are purely for visual inspection during development; they play no role in the tests.

Rendered PDFs live in `tests/fixtures/regression/output/`. They are visual reference artifacts, not test outputs, and are not verified by the test suite.

### Layout Snapshots

The engine regression suite maintains a single layout snapshot: `00-all-capabilities.snapshot.layout.json`. Only the god fixture is snapshotted because it exercises the complete engine surface, and per-fixture structural assertions provide stronger, more specific guarantees for the other fixtures than a full snapshot comparison would.

The snapshot is checked after the determinism assertion passes. If the snapshot is missing and `--update-layout-snapshots` is not set, the test fails with instructions.

**To update the snapshot** after an intentional layout change:

```bash
npm run test:update-layout-snapshots --prefix engine
# or:
VMPRINT_UPDATE_LAYOUT_SNAPSHOTS=1 npm run test --prefix engine
```

### Per-Fixture Structural Assertions

Several fixtures trigger additional checks beyond the universal invariants. These are written against the layout output directly — no pixels, no rendering, just the `Page[]` structure:

- **`02-text-layout-advanced`**: Verifies that advanced-mode justified lines carry `justifyAfter` spacing. Verifies that soft-hyphen breaks produce visible hyphens but no literal `\u00AD` characters in rendered output. Verifies RTL drawing progression (x coordinate decreases across consecutive RTL segments on the same line).
- **`09-tables-spans-pagination`**: Verifies colspan and rowspan cells are present. Verifies no rowSpan cell is split across a page boundary. Verifies the header row repeats on each continuation page.
- **`10-packager-split-scenarios`**: Verifies the `keep-split` element spans pages and that its keepWithNext lead stays on the first page. Verifies the mid-page table starts after other content. Verifies the page-top overflow element starts at the top of its page.
- **`08-dropcap-pagination`**: Verifies the dropcap box appears only on the first fragment page, not on continuation pages.
- **`11-story-image-floats`**: Verifies multi-page output with at least six image boxes. Verifies text boxes adjacent to floated images have non-uniform line widths. Verifies optical underhang: lines resume full width once clear of the float obstacle.
- **`12-inline-baseline-alignment`**: Verifies all five `verticalAlign` modes are present in the output. Verifies `baselineShift` metrics are numeric. Verifies total inline width includes margins.
- **`14-flow-images-multipage`**: Verifies exactly three flow image boxes across at least two pages.

---

## draft2final Tests

`draft2final` is intentionally thin orchestration. Heavy regression coverage belongs in transmuters (semantic/source behavior) and engine (layout/render determinism).

For the orchestrator itself, keep only smoke-level checks:

- CLI argument parsing and failure modes.
- Frontmatter transmuter auto-detection (`using`, `transmuter`, `format`).
- Output mode routing by extension (`--out *.pdf` vs `--out *.json`).
- Config/theme resolution behavior, including theme-name shortcuts.
- End-to-end invocation that proves non-empty outputs are produced.

The orchestrator implementation lives at `draft2final/`.

```bash
npm run build --workspace=draft2final
npm run dev --prefix draft2final -- ../samples/draft2final/source/markdown/markdown-sample.md --using mkd-mkd --out ../.tmp/smoke.pdf
npm run dev --prefix draft2final -- ../samples/draft2final/source/markdown/markdown-sample.md --using mkd-mkd --out ../.tmp/smoke.json
```

Avoid duplicating transmuter-level regression tests in this layer.

---

## When to Update Snapshots

Update snapshots when you have made an intentional change to layout behavior — a bug fix, a new feature, a typography adjustment — and you have verified by visual inspection that the new output is correct. The snapshot update workflow is:

1. Make the change.
2. Run the tests. The snapshot assertion fails, showing which fixture diverged.
3. Inspect the rendered PDF in `engine/tests/fixtures/regression/output/` or by running `node engine/tests/fixtures/regression/generate-fixture-pdfs.mjs`.
4. Verify the output looks correct.
5. Run with `--update-layout-snapshots` to accept the new baseline.
6. Commit the updated snapshot file alongside the code change.

Never update snapshots without first visually verifying the output. The snapshot is not a correctness oracle — it is a stability oracle. It tells you whether something changed; it does not tell you whether the change is right.


