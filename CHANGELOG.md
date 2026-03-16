# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [0.3.3] - 2026-03-16

### Added

#### Zone Map (`type: "zone-map"`)
- New block element type `zone-map` that divides a horizontal strip of the page into independent layout regions (zones).
- Each zone runs its own non-paginating layout pass ("stripped march"): content flows top-to-bottom within the zone's bounded column without pagination or split negotiation.
- Column widths are configured via `properties.zones.columns` using the same `TableColumnSizing` track definitions (`fixed`, `auto`, `flex`/`fr`) already used by tables.
- `properties.zones.gap` controls the gap between columns in points.
- Zone regions are declared in `element.zones[]` (`ZoneDefinition[]`): each entry carries an optional `id` and an `elements[]` array.
- The `zone-map` height in the document flow equals the tallest zone (max of all zone heights).
- V1 semantics: the `zone-map` always moves as a unit to the next page if it cannot fit — it is always `isUnbreakable = true`.
- Text inside zones correctly wraps at the zone column width, not the full page width.
- New fixture: `engine/tests/fixtures/regression/21-zone-map-sidebar.json` — demonstrates a 70/30 flex split and an equal three-column strip.

### Documentation
- `documents/AST-REFERENCE.md`: added §11a (Zone Map) with full API reference; added `"zone-map"` to the reserved structural type table.
- `documents/LAYOUT-SKILL.md`: added §10a (Zone Map) with examples and guidance; added `"zone-map"` to the structural type table in §5.

---

## [0.3.2] - 2026-03-16

### Added

#### Block-Level Floats
- Any block element inside a `story` can now be floated with `properties.layout: { mode: "float" }` — not just image elements.
- Non-image block floats require explicit `properties.style.width` and `properties.style.height`. If either is absent the element falls through to normal block layout (safe degradation).
- The 1×1 placeholder PNG workaround for pull-quote / sidebar obstacles is no longer necessary.

#### Column Spans in Multi-Column Stories
- Any child of a multi-column `story` can span the full story width by setting `properties.columnSpan: "all"` (or a number ≥ 2).
- The spanning element is laid out at full story width; column flow resets to column 1 below it.
- Works with any block element type: headings, tables, nested stories, styled boxes.

#### Regression Coverage
- New fixture `engine/tests/fixtures/regression/20-block-floats-and-column-span.json` exercises both features in a 3-column LETTER layout with left/right block floats and a full-width column span.

### Documentation
- `documents/AST-REFERENCE.md`: added `columnSpan` to `ElementProperties` reference; expanded §13 (Story Layout Directives) with block float eligibility rules; added §13a (Column Span).
- `documents/LAYOUT-SKILL.md`: updated §8 (Floats) to document block floats alongside image floats; added §8a (Column Spans); updated §15 gotcha to replace the obsolete "float requires image" restriction.
- `documents/ADVANCED-LAYOUT-ROADMAP.md`: Features 2 and 3 marked as completed with implementation notes.

---

## [0.3.1] - 2026-03-12

### Fixed

#### RTL Auto-Direction and Mixed-Script Line Stability
- Paragraph-level `direction: auto` resolution was hardened so mixed LTR/RTL lines consistently use the paragraph base direction instead of drifting line-by-line.
- Improved bidi run handling for neutral segments (especially spaces and punctuation) to prevent Arabic/Hebrew phrase fragmentation in mixed-language paragraphs.
- Neutral whitespace now inherits the active script/font run during segmentation, reducing incorrect LTR space splits inside RTL phrases and improving render order stability.
- Added and expanded regression coverage for auto-direction and mixed bidi rendering (`engine/tests/auto-direction.spec.ts`, module extraction assertions).

#### Regression Baseline Updates
- Refreshed engine regression layout snapshots to reflect deterministic output after the bidi/segmentation fixes.

#### Fixture PDF Generation
- Fixed `engine/tests/fixtures/regression/generate-fixture-pdfs.mjs` so `16-standard-fonts-pdf14.json` uses `StandardFontManager` instead of `LocalFontManager`.
- Resolved fixture generation failure: `[FontProcessor] Requested font family not registered: Symbol`.

### Changed

#### Release Versions
- Bumped monorepo version to `0.3.1`.
- Bumped `draft2final` package version to `1.0.2`.

## [0.3.0] - 2026-03-09

### Added

#### Global JIT Typesetting
- Draft2Final and the vmprint CLI now selectively auto-download massive CJK and complex script fonts from the jsDelivr CDN, caching them persistently in the user's `~/.vmprint/fonts` directory.
- Added extensive language mappings in `LocalFontManager` for global fallback support (Hebrew, Bengali, Tamil, Telugu, Malayalam, Gujarati, Kannada, Gurmukhi, Khmer, Lao, Sinhala, Arabic, and Indic scripts).

#### Standalone Zero-Dependency CLI
- The `draft2final` orchestrator is now distributed as a single 4.4MB compiled executable via `tsup`, drastically improving global installation speed, execution startup time, and cross-platform reliability.
- **Smart Asset Bundling**: The essential Latin Pack fonts (Caladea, Cousine, Arimo, Tinos, Courier Prime) and core PDF metrics are bundled directly in the `@draft2final/cli` distribution for instant out-of-the-box offline support.

#### CLI Polish
- **Interactive Scaffolding**: Added `draft2final --init <project>` command to instantly generate new Markdown, Config, and Theme boilerplate.
- **Progress Tracking**: Concurrent background downloads for global fonts now display a smooth, unified terminal progress indicator using the Web Streams API.
- Added `-v` / `--version` flags and improved stage timing logs.

### Changed

#### Selective Font Pruning
- The core CLI and Draft2Final both deeply scan the Document AST prior to layout to extract literal used characters. The engine instantly prunes and disables unused fallback fonts to prevent unnecessary network downloads.
- Extracted heavy 50MB+ CJK font binaries (Noto Sans JP, KR, SC) to an orphan `assets` Git branch to keep the core developer repository lean and extremely fast to clone.

### Fixed
- Stopped standard English punctuation (like the em-dash) from erroneously triggering heavy Chinese/Japanese fallback font downloads by removing overlapping general punctuation blocks from the CJK Unicode ranges.
- Prevented terminal flickering and layout overlaps during concurrent multi-font JIT downloads.

## [0.2.0] - 2026-03-08

### Added

#### Tutorial Experience for `draft2final`
- Added a new follow-along user tutorial at `draft2final/TUTORIAL.md` covering technical manual, screenplay, manuscript, and format remix workflows
- Added a dedicated `tutorial` theme for `mkd-mkd` at `draft2final/themes/mkd-mkd/tutorial.yaml` with guidebook-oriented typography and spacing
- Added tutorial sample outputs under `samples/tutorial/` including generated PDF/AST artifacts

### Changed

#### Markdown and Transmuter Architecture
- Extracted shared Markdown compilation logic into the new `@vmprint/markdown-core` workspace
- Refactored `@vmprint/transmuter-mkd-mkd` into a thinner wrapper around shared markdown-core functionality
- Standardized transmuter contracts by moving shared types into `@vmprint/contracts`
- Updated docs example assets and configuration flow to keep theme YAML ownership explicit

#### `draft2final` Tutorial and CLI Guidance
- Updated tutorial command style for end users to prefer `draft2final ...` examples over dev-only invocation patterns
- Added document-level tutorial frontmatter config for typography/drop-cap behavior without changing global defaults

#### Markdown Core Formatting
- Added opening-paragraph drop-cap support in markdown-core via document config (`dropCap.openingParagraph`)

### Fixed

#### Standard Font Encoding Consistency
- Fixed a rendering/measurement mismatch so standard-font text measurement and PDF output now use the same encoding path

### Documentation

- Removed deprecated `showPageNumbers` usage from AST-to-PDF docs fixtures
- Refreshed docs to align with the markdown-core extraction and updated transmuter structure

## [0.1.3] - 2026-03-07

### Added

#### AST Reference Guide
- New comprehensive documentation at `documents/AST-REFERENCE.md` covering the complete VMPrint document input format
- Detailed reference for every supported node type, property, style field, and configuration option
- Examples for `DocumentInput`, `LayoutConfig`, elements, and page regions

#### Full Unicode Bidirectional Algorithm Support
- Complete implementation of Unicode Bidirectional Algorithm (UAX #9) for proper RTL/LTR text handling
- New `bidi-js` dependency added to engine for embedding level calculation
- New `splitByBidiDirection()` function in `text-script-segmentation.ts` for BIDI run segmentation
- Intelligent neutral character handling — spaces and punctuation between LTR/RTL runs are now properly assigned based on neighboring strong characters
- New engine test fixture: `18-multilingual-arabic` with comprehensive Arabic and mixed bidi layout coverage

### Fixed

#### RTL and Mixed Bidi Rendering
- RTL text now renders with full UAX #9 compliance
- Mixed LTR/RTL text within paragraphs now displays with correct visual ordering
- Arabic text shaping correctly applies contextual forms (initial, medial, final, isolated) with proper glyph connection
- Embedded LTR runs within RTL paragraphs (and vice versa) now render in the correct visual order
- Fixed item-order reversal for LTR runs within RTL lines to ensure proper visual placement

### Changed

#### Engine Bidirectional Text Processing
- `reorderItemsForRtl()` now respects pre-computed BIDI direction from layout engine instead of re-sniffing text
- Text processor measurement cache keys now include direction and script class for context-aware caching
- Font shaping integration improved — script tags (`arab`, `deva`, `thai`, etc.) and direction (`ltr`/`rtl`) now properly passed to fontkit
- RTL runs now use explicit OpenType feature list for consistent shaping across measurement and rendering
- All layout snapshot fixtures regenerated to reflect the improved bidi handling

#### Documentation
- README updated to remove note about partial RTL/bidi support — full support is now implemented
- All language showcase images regenerated with improved bidi rendering

## [0.1.2] - 2026-03-07

### Added

#### `@vmprint/context-pdf-lite`
A lightweight PDF rendering context powered by jsPDF for embeddable and browser-friendly PDF output.

- New `contexts/pdf-lite` package
- Packaged integration coverage for the built engine + standard fonts + pdf-lite stack
- Root build now includes the pdf-lite workspace

#### Browser Documentation Examples
- New self-contained static AST-to-PDF showcase under `docs/examples/ast-to-pdf/`
- New self-contained static Markdown-to-AST showcase under `docs/examples/mkd-to-ast/`
- Example bundling/build pipeline added under `scripts/build-docs-examples.mjs`
- `docs/README.md` and example landing pages expanded to cover the static demos

#### Markdown Transmuter
- New `@vmprint/transmuter-mkd-mkd` package for converting Markdown into VMPrint `DocumentInput`
- Theme-aware transmutation with bundled default, novel, and opensource themes
- New transmuter documentation under `transmuters/README.md` and `transmuters/mkd-mkd/README.md`

#### Header and Footer Page Regions
- New top-level `header` / `footer` document regions with `default`, `firstPage`, `odd`, and `even` selectors
- New per-element `pageOverrides` for page-local header/footer replacement or suppression
- New physical/logical page-number token substitution in region content
- New engine regression fixture and design docs for page-region behavior

#### Markdown Novel Theme
- New `novel` theme for `draft2final` markdown output
- Matching bundled `novel` theme for the Markdown transmuter
- New layout snapshot coverage for the markdown novel sample

### Changed

#### Engine Rendering and Layout
- Rich inline baseline alignment and rendering metrics were tightened engine-wide
- Renderer and debug drawing paths were updated to match the new rich-line metrics flow
- Header/footer geometry now lives inside page margins rather than spanning the full page width
- Region content is laid out under a region-local, non-paginating context and clipped to the available margin box

#### `draft2final`
- Theme loading now supports document-level `header` / `footer` definitions in addition to layout and styles
- Markdown themes were updated to use page-region-driven folios instead of the old flat page-number settings
- Test fixtures and layout snapshots were expanded for the new region model

### Fixed

- `@vmprint/transmuter-mkd-mkd` build breakage in the bundled `novel` theme source
- Packaged integration flow after a clean root build by ensuring pdf-lite artifacts are generated
- Header/footer regression fixtures and assertions so they validate the intended margin-bounded region model

## [0.1.1] - 2026-03-05

### Added

#### StandardFontManager (`@vmprint/standard-fonts`)
A zero-asset `FontManager` that supports all 14 PDF standard fonts without requiring any font files to be installed or bundled.

- New `@vmprint/font-managers/standard` package with `StandardFontManager`
- Alias table covering all 14 standard fonts plus metric-compatible families: Arimo, Tinos, Cousine, Carlito, Caladea, Noto Sans, and Courier Prime
- Engine: sentinel detection in the font cache loader; `AfmFontProxy` backed by static AFM metric tables (generated from PDFKit's `.afm` files); per-glyph advance widths and bounding boxes
- AFM tables keyed by Unicode codepoint (not Adobe Standard Encoding) so extended characters — en-dash, em-dash, smart quotes, etc. — resolve correctly
- `contexts/pdf`: suppresses font embedding for standard fonts and passes the PostScript name directly to PDFKit using WinAnsiEncoding
- `font-managers/local`: added Symbol and ZapfDingbats aliases pointing to Noto Sans Symbols 2
- Architecture documentation: `documents/STANDARD-FONTS.md`

#### Multi-Column Layouts
- Story packager extended with full multi-column layout support
- Column count, gutter width, and per-column flow are driven by the existing engine document model
- New engine regression test and fixture: `15-story-multi-column`

#### Manuscript Format (`draft2final`)
- New industry-compliant `manuscript` format for `draft2final` with two themes: **default** and **classic**
- Smart quotes and smart dashes applied automatically within manuscript documents
- Manuscript format includes its own config defaults, validator, and theme YAML files
- New layout snapshot fixtures: `manuscript-layout-sample` and `manuscript-classic-layout-sample`
- `draft2final/MANUSCRIPT.md` — authoring and format reference

#### `VmprintOutputStream` contract
- New `VmprintOutputStream` interface in `@vmprint/contracts`: a portable `write` / `end` / `waitForFinish` abstraction that callers implement against their own I/O transport
- `Context` contract now requires a `pipe(stream: VmprintOutputStream): void` method; no-op implementations are explicitly allowed for contexts that manage their own output
- `NodeWriteStreamAdapter` added in CLI and `draft2final` to bridge Node.js `fs.WriteStream` into `VmprintOutputStream`, keeping filesystem I/O in the caller

### Changed

#### draft2final Architecture Overhaul
The `draft2final` package was substantially restructured to make creating new formats straightforward and reduce per-format boilerplate.

- **"Flavor" renamed to "Theme"** throughout the codebase — themes are now the canonical term for format variants
- Each format (`academic`, `literature`, `markdown`, `screenplay`) was extracted from a monolithic index file into a dedicated `format.ts` module with a `config.defaults.yaml` and a `themes/` directory containing per-theme YAML
- New shared compiler infrastructure under `draft2final/src/formats/compiler/`:
  - `compile.ts` — orchestrates format compilation
  - `config-resolver.ts` — resolves layered configuration (defaults → theme → user overrides)
  - `format-context.ts` — shared format rendering context
  - `format-handler.ts` — base handler interface
  - `inline.ts` — shared inline element compilation
  - `image.ts` — image handling utilities
  - `numbering.ts` — numbering utilities
  - `theme-loader.ts` — theme YAML loading
  - `markdown-base-format.ts` — shared base for Markdown-derived formats
  - `rule-based-handler.ts` — declarative rule-based element dispatcher
- `build.ts` and `cli.ts` updated to use the new format registry
- `format-loader.ts` (previously `flavor-loader.ts`) removed in favour of the new `formats/index.ts` registry

#### Additive Margins
Margin behaviour changed from **collapsing** to **additive** across the engine and all `draft2final` formats.

- Adjacent block margins now sum rather than collapse, matching standard typesetting conventions
- All `draft2final` format themes (academic, literature, markdown, screenplay) updated with recalibrated margin values
- All layout snapshot fixtures regenerated to reflect the new behaviour
- Engine: `execute-simulation-march.ts` updated with the new margin accumulation logic

#### Removed Variable Font Support
Variable font (`.wdf` / `wght`-axis) support has been removed from the engine and context to simplify font handling and make writing new contexts easier.

- Engine: variable-font axis resolution removed from `layout-utils.ts`, `text-processor.ts`, and `font-registration.ts`
- `contexts/pdf`: variable font subsetting code removed; `fontkit.d.ts` shim removed; `pdfkit-fontkit` dependency dropped
- `font-managers/local`: variable font assets (ArimoVariable) replaced with four static TTF files (Regular, Bold, Italic, BoldItalic)
- `contracts`: `FontManager` interface simplified — variable-font fields removed
- Engine font-management ops simplified accordingly

#### CLI: Removed `--context` flag
The `--context` flag has been removed from the CLI.

- The flag's pluggability was illusory: the undocumented two-argument constructor made third-party contexts non-functional
- The CLI is now an honest PDF tool; `PdfContext` is used directly
- `PdfContext` constructor simplified to `(options: ContextFactoryOptions)` only; `pipe()` now bridges via PDFKit's `data`/`end` events into `VmprintOutputStream` instead of accepting a Node.js stream directly
- CLI's `--font-manager` flag resolution fixed: bare package names are resolved via `require.resolve`; file paths via `path.resolve`

### Fixed

- Superscript rendering in the engine (`engine/src/engine/layout/text-wrap-core.ts`, `rich-line-draw.ts`)
- AFM proxy `glyphForCodePoint` now does a direct Unicode lookup, removing the intermediate WIN_ANSI_CODE_MAP that caused extended characters to resolve incorrectly

### Reorganized

- `samples/` directory restructured for discoverability:
  - `samples/draft2final/source/` — source documents grouped by format
  - `samples/engine/tests/` — all engine regression PDFs
  - `samples/overlay/` — overlay pipeline outputs
- `documents/readme-assets/` — README images and hero assets moved out of `documents/readme/`
- Removed stale `documents/ROADMAP.md` and `documents/PERFORMANCE_OPTIMIZATION_LOG.md`
