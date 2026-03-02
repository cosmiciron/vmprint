# @vmprint/local-fonts

The default font manager for vmprint. Bundles a curated set of open-source fonts covering Western scripts, CJK, and several additional writing systems, and handles font loading from the local filesystem, URLs, and data URIs.

## Role in the System

`LocalFontManager` is what the vmprint CLI and draft2final use out of the box. When you run either tool without passing `--font-manager`, this is what loads and serves fonts to the layout engine.

It is also the **reference implementation** of the `FontManager` interface from `@vmprint/contracts`. If you are building a custom font manager — for a CDN, an edge runtime, a pre-warmed serverless function — the source of this package is the correct starting point. It demonstrates every part of the contract: registry management, alias resolution, fallback enumeration, and environment-aware font loading. See [`font-managers/`](../README.md) for the interface documentation and a minimal implementation skeleton.

## Architecture

The package has two source files and a bundled asset directory.

**`src/config.ts`** — The font registry and alias map. `LOCAL_FONT_REGISTRY` is an array of `FontConfig` objects, one per font variant, each declaring its family, weight, style, unicode range, fallback status, and the relative path to its font file. `LOCAL_FONT_ALIASES` maps common system font names — `"Arial"`, `"Times New Roman"`, `"Calibri"` — to their bundled equivalents.

**`src/index.ts`** — The `LocalFontManager` class. Implements all eight methods of the `FontManager` interface. The only method with meaningful complexity is `loadFontBuffer`, which resolves a `src` string to an `ArrayBuffer` using a multi-strategy resolution chain described below.

**`assets/fonts/`** — The bundled font files, organized by family. These are shipped in the npm package (`"files": ["dist", "assets"]`) and are available at runtime in both built and unbuilt layouts.

## Font Loading

`loadFontBuffer(src)` resolves font sources in this order:

1. **HTTP / HTTPS URL** — fetched via `fetch()`. Works in any environment that provides it.
2. **Data URI** — decoded in-memory, no I/O.
3. **Browser context** (non-Node.js) — fetched via `fetch()` regardless of URL scheme.
4. **Filesystem (Node.js)** — attempts a sequence of candidate paths: absolute path, package root, `dist/` subdirectory, `src/` prefix variants, and `process.cwd()` — in both built and unbuilt layouts. This is what makes the bundled fonts work reliably whether the package is imported from its source tree during development or from `dist/` after a build.

## Bundled Fonts and Why

Every font in the bundle was chosen against the same criteria: **open-source license** (SIL Open Font License), **metric compatibility** with common system fonts where applicable, and **genuine coverage** of the scripts that vmprint is designed to handle.

### Primary Families

These are the fonts a document would specify directly. They cover the Western script range for which the engine was designed to produce typographically precise output.

**Courier Prime** — The non-negotiable inclusion. WGA-compliant screenplay format requires Courier at 12pt, and Courier Prime is the modern, professionally hinted version designed specifically for script writing. It is what `draft2final`'s screenplay format uses, and it is why the output looks correct.

**Arimo** — A variable font (wght axis 400–700, regular and italic files) metric-compatible with Arial and Helvetica. Documents that specify `"Arial"` or `"Helvetica"` resolve here. The variable format means a single file covers the full weight range without requiring separate bold files, and the declared `weightRange` allows the engine to select precise intermediate weights.

**Noto Sans** — The baseline sans-serif family with broad Latin + extended Unicode coverage. This is the anchor for the sans-serif fallback chain — when a run of text contains characters that fall outside the primary font's unicode range and no more specific fallback applies, Noto Sans is the catch-all for Latin and extended Latin scripts.

**Tinos** — Metric-compatible with Times New Roman. Documents that specify `"Times"`, `"Times New Roman"`, or `"serif"` resolve here. Tinos is designed by the same team as Arimo and Cousine, with the same metric-compatibility objective.

**Caladea** — Metric-compatible with Cambria. Used in the `markdown` format's academic and literature flavors, where Cambria is a common document serif.

**Carlito** — Metric-compatible with Calibri and Segoe UI. Calibri has been the default Microsoft Office body font since 2007, so any document authored in that environment that specifies its fonts by name will resolve to Carlito without line-break drift or reflow.

**Cousine** — Metric-compatible with Courier New. Distinct from Courier Prime: Cousine is the general-purpose `"Courier New"` / `"monospace"` substitute; Courier Prime is for professional screenplay output. Both are present because they serve different roles.

### Fallback Families

Fallback fonts are engaged automatically by the engine when a run of text contains characters outside the primary font's declared unicode range. They are not specified in documents directly — the engine selects them by matching each character's codepoint against the declared ranges.

**Noto Sans SC, JP, KR** — Simplified Chinese, Japanese (Hiragana, Katakana, CJK), and Korean (Hangul). The Noto CJK family was designed explicitly for this use case: consistent design language across all three, comprehensive coverage of their respective scripts, and open licensing that permits bundling. A document in any of these languages — or a multilingual document mixing Latin prose with CJK annotations — gets correct rendering without any configuration.

**Noto Sans Thai** — Thai script (U+0E00–U+0E7F). Thai text requires a font that handles the stacked diacritic marks above and below the baseline correctly. Noto Sans Thai does.

**Noto Sans Arabic** — Arabic and Arabic Extended blocks (U+0600–U+06FF, U+0750–U+077F, U+08A0–U+08FF, and the presentation forms ranges). Arabic is right-to-left with complex joining behavior; having the correct font in the fallback chain means Arabic text in otherwise Latin documents renders with the right glyphs.

**Noto Sans Devanagari** — Hindi, Sanskrit, and other Devanagari scripts (U+0900–U+097F). Devanagari requires grapheme-level measurement — combining vowel marks, dependent consonants, and conjuncts must be treated as single units. The engine handles this at the segmentation level; Noto Sans Devanagari provides the glyphs.

**Noto Sans Symbols 2** — Mathematical, technical, and miscellaneous symbols (U+2000–U+2BFF, U+FB00–U+FFFF). Catches box-drawing characters, mathematical operators, arrows, and other symbol ranges that appear in technical documents.

### The Noto Philosophy

The Noto family's name comes from "no tofu" — the colloquial term for the □ replacement character that appears when a font has no glyph for a codepoint. The selection of Noto families as the fallback chain is intentional: given a document that contains any combination of the world's writing systems, the bundled fallbacks collectively ensure that no character renders as a missing-glyph box. Characters may not be rendered in the most aesthetically optimal font, but they will be rendered.

## Usage

```ts
import { LocalFontManager } from '@vmprint/local-fonts';
import { createEngineRuntime } from '@vmprint/engine';

const runtime = createEngineRuntime({ fontManager: new LocalFontManager() });
```

### Extending the Registry

`LOCAL_FONT_REGISTRY` and `LOCAL_FONT_ALIASES` are exported. Pass additional fonts or aliases to the constructor:

```ts
import { LocalFontManager, LOCAL_FONT_REGISTRY, LOCAL_FONT_ALIASES } from '@vmprint/local-fonts';
import type { FontConfig } from '@vmprint/contracts';

const extraFont: FontConfig = {
    name: 'MyFont Regular',
    family: 'MyFont',
    weight: 400,
    style: 'normal',
    src: '/absolute/path/to/MyFont-Regular.ttf',
    enabled: true,
    fallback: false,
};

const manager = new LocalFontManager({
    fonts: [...LOCAL_FONT_REGISTRY, extraFont],
    aliases: { ...LOCAL_FONT_ALIASES, 'my font': 'MyFont' },
});
```

Fonts added this way participate in the same resolution, alias, and fallback logic as the bundled fonts. Set `fallback: true` and declare a `unicodeRange` to add a script-specific fallback that the engine will engage automatically.
