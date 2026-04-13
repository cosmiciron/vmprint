# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [Unreleased]

---

## [1.2.0] - 2026-04-13

### Added
- **`pressrun` Bootstrap Example**: Added a minimal, non-packaged bootstrap program under `pressrun/` to serve as the simplest practical engine integration example.

### Changed
- **Repository Contraction and Repositioning**: Removed the in-repo preview package, static docs site, generated API docs, and related build scripts so the repository now centers on the engine, the CLI, focused guides/references, and the small `pressrun` bootstrap.
- **Engine-First Public Surface**: Introduced the simplified `VMPrintEngine` / `loadDocument` surface and rewired the CLI to use that higher-level API for its normal render path, while keeping the older `LayoutEngine` bootstrap path available as a supported advanced surface.
- **Developer-Facing Documentation Refresh**: Reworked the quickstart and package-facing docs to match the narrower audience and current structure, with `pressrun` positioned as the hello-world example and the CLI positioned as the operational tool rather than the canonical bootstrap.
- **Contracts Positioning Update**: Reframed `contracts/` as a workspace-local and source-copy contract layer instead of a repo surface actively positioned as a public package for extension authors.

### Fixed
- **CLI Warm Profiling Semantics**: Restored `vmprint --profile-layout` warm timing to the historical warmed-runtime behavior by reusing and priming a shared profiling runtime, avoiding misleading regressions caused by rebuilding a fresh engine and font manager for each warm sample.
- **Root Test Workflow**: Updated the packaged integration smoke test path so root `npm test` builds the required workspace artifacts before checking packaged output.
- **Workspace Lockfile Hygiene**: Removed stale preview workspace metadata from `package-lock.json` after the repo split.

---

## [1.1.0] - 2026-03-25

### Added
- **Standalone Package Infrastructure**: Successfully decoupled the repository into a set of independent, publishable npm packages for contexts, font managers, and transmuters.
- **Local Theme Assets**: Added self-contained YAML themes to `docs/examples/mkd-to-ast` to ensure the browser demonstration is fully functional without external repository dependencies.
- **Zero-Config Browser Preview**: Introduced a standalone browser preview example in `docs/examples/preview` that demonstrates the complete `@vmprint/preview` workflow.

### Changed
- **Repository Cleanup**: Removed obsolete local directories (`contexts/`, `font-managers/`, `transmuters/`) that are now published as independent packages in the `@vmprint` organization.
- **Standardized Documentation Examples**: Updated all examples in `docs/examples/` to resolve dependencies from `node_modules` instead of internal source aliases, matching real-world usage patterns.
- **Dual-Mode Package Updates**: Updated `@vmprint/preview` (v1.0.1) and other core packages for robust dual-mode (ESM and CommonJS) support.
- **Externalized Contracts**: Standardized `@vmprint/contracts` as a shared external dependency across the bundling pipeline to prevent code duplication in browser environments.
- **Streamlined Build Process**: Simplified `scripts/build-docs-examples.mjs` and `preview/scripts/build-demo.mjs` by removing complex workspace workarounds in favor of standard npm resolution.

### Fixed
- **Doc Build Resolution**: Resolved a build failure in the Markdown-to-AST example caused by missing external theme references.
- **Static Examples Archive**: Fixed the `vmprint-static-examples.zip` build process to correctly include all required assets for the new decoupled architecture.

---

## [1.0.0] - 2026-03-23

### Added

#### Simulation Runtime and Collaborator Architecture
- Rebuilt the engine around an explicit simulation kernel, session world, placement runtime, collision runtime, physics runtime, transition runtime, and lifecycle/event dispatch infrastructure instead of a paginator-centered control loop.
- Introduced the collaborator model for engine-owned coordination concerns such as keep-with-next planning, continuation artifacts, page reservations/exclusions, page regions, heading telemetry, transform capabilities, script runtime integration, and debug overlays.
- Added simulation reports and report readers so benchmarks, diagnostics, and downstream tooling can consume post-layout facts without reaching into layout-session internals.
- Added restore-point and snapshot machinery that makes speculative layout, rollback, and deterministic replay first-class engine behavior.

#### Scripting Series 1
- Added a post-settlement scripting runtime with document and element lifecycle hooks, direct messaging, receiver-oriented mutation, and structural replacement, insertion, and deletion flows.
- Added script-focused packagers and fixtures covering ready/refresh timing, live replacement, insertion, deletion, and cross-actor interactions.
- Added a dedicated `documents/SCRIPTING-API.md` reference and expanded authoring documentation for runtime document behavior.

#### Spatial Layout Features
- Added block-level floats for non-image content inside stories when explicit dimensions are provided.
- Added story column spanning via `properties.columnSpan`, including full-width spans inside multi-column stories.
- Added `zone-map` as a first-class layout primitive for bounded side-by-side regions with independent strip layout.
- Added strip-layout and zone continuation coverage, plus new regression fixtures for nested-table continuation, nested-story continuation, live TOC reactivity, and total-pages footer scenarios.

#### AST 1.1 and Authoring Surface
- Upgraded the document model to AST 1.1 and refreshed engine fixtures plus transmuters to emit and consume the newer shape consistently.
- Formalized blueprint preprocessing so `onLoad` and `onCreate` run as a distinct preprocessing phase before layout settlement.
- Kept AST-driven authoring first-class while aligning the engine internals with the new simulation runtime.

#### Browser and Platform Support
- Added `@vmprint/context-canvas`, which builds SVG-backed page scenes and renders them into canvas targets for live browser preview.
- Added `@vmprint/web-fonts`, a browser-first font manager with remote font loading and optional persistent caching.
- Added browser demos for AST-to-canvas and AST-to-pdf web-font workflows, and expanded the docs examples index to showcase them.

### Changed

#### Engine Internals
- Made actor formation, splitting, continuation ownership, and placement negotiation explicit in the substrate instead of inferred late in pagination.
- Moved geometry authority toward the spatial subsystem and session runtime, reducing special-case orchestration in packagers.
- Unified flow, table, drop-cap, and continuation behavior around shared fragment-state and session-managed artifact generation.
- Reworked text, image, and table layout paths to cooperate with the simulation runtime while preserving deterministic output.

#### Documentation and Positioning
- Rewrote the README around the simulation model, scripting surface, browser story, and architecture direction for the 1.0 release.
- Added `documents/ENGINE-INTERNALS.md`, a multi-part authoring guide under `documents/authoring/`, and broader architecture/API refreshes across the docs set.
- Updated examples, fixtures, and authoring references to match AST 1.1, zone maps, column spans, scripting, canvas rendering, and web fonts.

#### Release Versions
- Promoted the workspace packages, including `@vmprint/engine`, to `1.0.0`.
- Corrected `draft2final` from an accidental rollback to `1.0.0` on 2026-03-18 and released it as `1.0.3`.

### Fixed

#### Release and Packaging Hygiene
- Restored the intended `draft2final` version progression after the cleanup-pass regression from `1.0.2` to `1.0.0`.
- Fixed transmuter compatibility with AST 1.1 and resolved the mkd-to-ast version mismatch in the browser demo pipeline.
- Optimized static-demo payloads and canvas/browser packaging so the browser examples are viable release artifacts rather than experimental leftovers.

#### Layout Stability
- Fixed long-document snapshot handling during the simulation overhaul.
- Fixed `finalizePagesWithCallbacks` during the late 1.0 cleanup cycle.
- Preserved deterministic regression coverage across the architecture rewrite with expanded engine, scripting, strip-layout, spatial-IR, and browser-facing test assets.

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
- Intelligent neutral character handling - spaces and punctuation between LTR/RTL runs are now properly assigned based on neighboring strong characters
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
- Font shaping integration improved - script tags (`arab`, `deva`, `thai`, etc.) and direction (`ltr`/`rtl`) now properly passed to fontkit
- RTL runs now use explicit OpenType feature list for consistent shaping across measurement and rendering
- All layout snapshot fixtures regenerated to reflect the improved bidi handling

#### Documentation
- README updated to remove note about partial RTL/bidi support - full support is now implemented
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
- AFM tables keyed by Unicode codepoint (not Adobe Standard Encoding) so extended characters - en-dash, em-dash, smart quotes, etc. - resolve correctly
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
- `draft2final/MANUSCRIPT.md` - authoring and format reference

#### `VmprintOutputStream` contract
- New `VmprintOutputStream` interface in `@vmprint/contracts`: a portable `write` / `end` / `waitForFinish` abstraction that callers implement against their own I/O transport
- `Context` contract now requires a `pipe(stream: VmprintOutputStream): void` method; no-op implementations are explicitly allowed for contexts that manage their own output
- `NodeWriteStreamAdapter` added in CLI and `draft2final` to bridge Node.js `fs.WriteStream` into `VmprintOutputStream`, keeping filesystem I/O in the caller

### Changed

#### draft2final Architecture Overhaul
The `draft2final` package was substantially restructured to make creating new formats straightforward and reduce per-format boilerplate.

- **"Flavor" renamed to "Theme"** throughout the codebase - themes are now the canonical term for format variants
- Each format (`academic`, `literature`, `markdown`, `screenplay`) was extracted from a monolithic index file into a dedicated `format.ts` module with a `config.defaults.yaml` and a `themes/` directory containing per-theme YAML
- New shared compiler infrastructure under `draft2final/src/formats/compiler/`:
  - `compile.ts` - orchestrates format compilation
  - `config-resolver.ts` - resolves layered configuration (defaults -> theme -> user overrides)
  - `format-context.ts` - shared format rendering context
  - `format-handler.ts` - base handler interface
  - `inline.ts` - shared inline element compilation
  - `image.ts` - image handling utilities
  - `numbering.ts` - numbering utilities
  - `theme-loader.ts` - theme YAML loading
  - `markdown-base-format.ts` - shared base for Markdown-derived formats
  - `rule-based-handler.ts` - declarative rule-based element dispatcher
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
- `contracts`: `FontManager` interface simplified - variable-font fields removed
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
  - `samples/draft2final/source/` - source documents grouped by format
  - `samples/engine/tests/` - all engine regression PDFs
  - `samples/overlay/` - overlay pipeline outputs
- `documents/readme-assets/` - README images and hero assets moved out of `documents/readme/`
- Removed stale `documents/ROADMAP.md` and `documents/PERFORMANCE_OPTIMIZATION_LOG.md`
