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

The engine test suite lives in `packages/engine/tests/`. It is structured as three suites that can be run individually or together.

```
pnpm test:engine      # all three suites
pnpm test:modules     # module extractions only
pnpm test:flat        # flat pipeline invariants only
pnpm test:regression  # regression suite only
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

Fixtures live in `packages/engine/tests/fixtures/regression/`. Each is a `DocumentInput` JSON file named by a zero-padded index and a description.

| Fixture                         | What it exercises                                                                                                                                                                          |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `00-all-capabilities`           | The god fixture. Full engine surface in one document: 8 pages, tables with colspan/rowspan, drop caps, story zones with floats, multilingual scripts, inline images, continuation markers. |
| `01-text-flow-core`             | Paragraph flow, headings, basic line wrapping                                                                                                                                              |
| `02-text-layout-advanced`       | Justification (advanced mode), soft-hyphen rendering, RTL text, bidirectional runs                                                                                                         |
| `03-typography-type-specimen`   | Font weight and style variants, font size scaling                                                                                                                                          |
| `04-multilingual-scripts`       | Mixed-script runs: Latin, CJK, Arabic, Devanagari, Thai                                                                                                                                    |
| `05-page-size-letter-landscape` | Letter landscape orientation                                                                                                                                                               |
| `06-page-size-custom-landscape` | Custom page dimensions                                                                                                                                                                     |
| `07-pagination-fragments`       | Block splitting, keepWithNext, orphan/widow controls                                                                                                                                       |
| `08-dropcap-pagination`         | Drop cap sizing, drop cap pagination, no-repeat on continuation                                                                                                                            |
| `09-tables-spans-pagination`    | colspan, rowspan, row splitting, repeated header rows, span boundary correctness                                                                                                           |
| `10-packager-split-scenarios`   | keepWithNext, mid-page table, page-top overflow splits                                                                                                                                     |
| `11-story-image-floats`         | Story zones, image floats, non-uniform line widths, optical underhang                                                                                                                      |
| `12-inline-baseline-alignment`  | All verticalAlign variants, baseline shift, optical inset metrics                                                                                                                          |
| `13-inline-rich-objects`        | Inline images on text baselines, multi-page continuation                                                                                                                                   |
| `14-flow-images-multipage`      | Flow-positioned images, multi-page image pagination                                                                                                                                        |

Many fixtures have a sidecar `.overlay.mjs` file that draws debug annotations — margin rules, box outlines, grid lines — when the fixture is rendered to a PDF using the `generate-fixture-pdfs.mjs` script. These are purely for visual inspection during development; they play no role in the tests.

Rendered PDFs live in `tests/fixtures/regression/output/`. They are visual reference artifacts, not test outputs, and are not verified by the test suite.

### Layout Snapshots

The engine regression suite maintains a single layout snapshot: `00-all-capabilities.snapshot.layout.json`. Only the god fixture is snapshotted because it exercises the complete engine surface, and per-fixture structural assertions provide stronger, more specific guarantees for the other fixtures than a full snapshot comparison would.

The snapshot is checked after the determinism assertion passes. If the snapshot is missing and `--update-layout-snapshots` is not set, the test fails with instructions.

**To update the snapshot** after an intentional layout change:

```bash
pnpm test:update-snapshots
# or for engine only:
VMPRINT_UPDATE_LAYOUT_SNAPSHOTS=1 pnpm test:engine
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

The draft2final test suite lives in `packages/draft2final/tests/`. It covers format compilation, IR structure, layout snapshot coverage, and end-to-end CLI invocation.

```
pnpm test:d2f                                                  # all tests
pnpm test:update-snapshots                                     # update all snapshots
pnpm --filter @draft2final/cli run test:boundaries             # boundary guards only
```

### Boundary Guards

`tests/boundary-guards.ts` (also callable as `pnpm --filter @draft2final/cli run test:boundaries` from the root) verifies that draft2final does not import from engine internals it should not depend on. This enforces the package boundary and catches accidental coupling before it becomes load-bearing.

### Format Compilation Tests

`tests/run-tests.ts` contains approximately 30 unit tests covering the full compilation pipeline from Markdown to `DocumentInput`. Tests are plain Node.js `assert` calls, no testing framework. They run in a single sequential async function.

The tests cover:

**Semantic mapping** — Verifies that remark's AST is correctly normalized to the `SemanticDocument` shape: headings, paragraphs, lists, blockquotes, code blocks, horizontal rules, and tables are all present.

**Format compilation** — Verifies that `compileMarkdownToVmprint` produces a correctly shaped `DocumentInput` for both the markdown and screenplay formats, including all required style roles.

**Inline styling** — Verifies that bold, italic, and code inline markup survives through blockquotes and screenplay dialogue without style resets or loss.

**Theme selection and geometry** — Verifies that different themes produce different layout configurations. Verifies WGA-standard screenplay geometry numerically: character name margins, dialogue margins, parenthetical margins, page number format and offset.

**Continuation metadata** — Verifies that the `paginationContinuation` block on dialogue elements carries `(MORE)` and `CONT'D` markers, and that parentheticals present on the opening cue also appear in the continuation's `markersBeforeContinuation`.

**Dual dialogue** — Verifies that consecutive blockquotes with the `^` flag produce `character-dual-left`, `dialogue-dual-left`, and their right-column counterparts.

**Production theme** — Verifies scene number prefixes/suffixes and locked-page revision labels in the page number format via the `production` theme for the screenplay format.

**Image handling** — Local file images are embedded as base64 in the IR. Data URI images pass through. Remote HTTP/HTTPS URLs throw a typed `Draft2FinalError` with `stage: 'format'`. Missing local files throw with a clear path error.

**CLI integration** — Three tests shell out to `tsx src/cli.ts` directly using `execFileSync`, write to a temp directory, and verify the output PDF is non-empty. This is the only end-to-end test in the suite: it confirms that the full pipeline — Markdown → compile → layout → render → PDF — produces a non-zero-byte file.

**Golden continuation signature** — One test runs the screenplay sample through the full layout engine (not just compilation) and asserts that `(MORE)` appears on the expected split page, followed by `CHARACTER NAME (CONT'D)` and the original parenthetical on the next page in the correct vertical order.

### Layout Snapshots

`tests/layout-snapshots.ts` runs every registered format+theme combination through the full pipeline — compile, resolve, paginate — and compares the resulting `Page[]` snapshot against a stored file.

The snapshot shape is the same as the engine's: box type, position rounded to 6 decimal places, line text, and segment metrics.

An important safety check runs first: the suite verifies that every supported format+theme pair has a test case. Adding a new theme to a format without adding a snapshot case is a test failure.

Each snapshot case also verifies determinism independently: `paginate()` is called twice and the results are compared before touching the snapshot file.

Snapshots are stored as `.snapshot.layout.json` files alongside their fixture Markdown files in `tests/fixtures/`.

**To update snapshots** after an intentional layout change:

```bash
pnpm test:update-snapshots
# or for draft2final only:
DRAFT2FINAL_UPDATE_LAYOUT_SNAPSHOTS=1 pnpm test:d2f
```

---

## When to Update Snapshots

Update snapshots when you have made an intentional change to layout behavior — a bug fix, a new feature, a typography adjustment — and you have verified by visual inspection that the new output is correct. The snapshot update workflow is:

1. Make the change.
2. Run the tests. The snapshot assertion fails, showing which fixture diverged.
3. Inspect the rendered PDF in `packages/engine/tests/fixtures/regression/output/` or by running `node packages/engine/tests/fixtures/regression/generate-fixture-pdfs.mjs`.
4. Verify the output looks correct.
5. Run with `--update-layout-snapshots` to accept the new baseline.
6. Commit the updated snapshot file alongside the code change.

Never update snapshots without first visually verifying the output. The snapshot is not a correctness oracle — it is a stability oracle. It tells you whether something changed; it does not tell you whether the change is right.
