# font-managers

Font managers are the bridge between the vmprint layout engine and the environment where it runs. This is where the environment-specific work of finding, loading, and serving font data lives — leaving the engine itself free of any dependency on the filesystem, the browser, or any particular runtime.

## Why This Exists

vmprint's layout engine is pure TypeScript with no runtime environment dependencies. It doesn't call `fs`. It doesn't touch `fetch`. It doesn't assume `Buffer` exists. This is what allows the same engine to produce identical layout output whether it runs in Node.js, a browser, a Cloudflare Worker, or a Lambda function.

But the engine needs fonts — real font files, loaded and parsed as `ArrayBuffer`s, before it can measure a single glyph. That work has to happen somewhere, and that somewhere is the `FontManager`.

A `FontManager` is injected into the engine at construction time. The engine calls into it to resolve font names, retrieve font data, and enumerate fallbacks. It never cares where those fonts came from — local disk, a CDN, R2, S3, an IndexedDB cache, or a pre-bundled binary. The implementation decides.

## The Interface

```ts
interface FontManager {
  // Returns the initial font registry — called once at engine startup
  getFontRegistrySnapshot(): FontConfig[];

  // Maps aliases ("Times New Roman" → "Tinos", "Arial" → "Arimo")
  resolveFamilyAlias(family: string): string;

  // Returns all enabled fonts in the registry
  getAllFonts(registry: FontConfig[]): FontConfig[];

  // Returns enabled fallback fonts (with unicode ranges) for script coverage
  getEnabledFallbackFonts(registry: FontConfig[]): FallbackFontSource[];

  // Returns enabled fonts for a given family
  getFontsByFamily(family: string, registry: FontConfig[]): FontConfig[];

  // Returns the list of families designated as fallbacks
  getFallbackFamilies(registry: FontConfig[]): string[];

  // Registers an additional font into the registry at runtime
  registerFont(config: FontConfig, registry: FontConfig[]): void;

  // Loads a font's binary data — this is where environment differences live
  loadFontBuffer(src: string): Promise<ArrayBuffer>;
}
```

Most of the interface is registry management — bookkeeping that any implementation can handle the same way. The one method that meaningfully differs between environments is `loadFontBuffer`. It receives a `src` string from a `FontConfig` and must return the font's binary data as an `ArrayBuffer`. Everything else the engine needs follows from that.

## Packages

| Package | Description |
|---|---|
| [`@vmprint/local-fonts`](local/) | Filesystem font manager with a bundled multilingual font set. The reference implementation. |
| [`@vmprint/web-fonts`](web/) | Browser-first font manager for URL/data-URI/catalog-backed fonts, with lazy loading and optional IndexedDB caching. |
| [`@vmprint/standard-fonts`](standard/) | Zero-asset font manager that emits standard-font sentinels (no embedded font binaries). |

## Writing a Custom Font Manager

A custom font manager is the right choice when:

- **Edge / serverless environments** — no filesystem access, or cold-start cost makes filesystem reads unacceptable. Fonts can be fetched from R2, Cloudflare KV, S3, or a CDN, and optionally cached in memory across requests.
- **Browser** — fonts come from your server or CDN, or are already in memory from a prior fetch. `loadFontBuffer` becomes a `fetch()` call against your asset pipeline.
- **Custom font registries** — your organization has proprietary typefaces, or you want a controlled subset of fonts without bundling the full Noto multilingual set.
- **Pre-warmed pipelines** — fonts are loaded once at startup and held in an `ArrayBuffer` cache. `loadFontBuffer` returns immediately from cache rather than hitting I/O on every render.

The minimal implementation:

```ts
import { FontManager, FontConfig, FallbackFontSource } from '@vmprint/contracts';

class MyFontManager implements FontManager {
  private readonly registry: FontConfig[];

  constructor(fonts: FontConfig[]) {
    this.registry = fonts;
  }

  getFontRegistrySnapshot(): FontConfig[] {
    return [...this.registry];
  }

  resolveFamilyAlias(family: string): string {
    return family; // add alias map as needed
  }

  getAllFonts(registry: FontConfig[]): FontConfig[] {
    return registry.filter(f => f.enabled);
  }

  getEnabledFallbackFonts(registry: FontConfig[]): FallbackFontSource[] {
    return registry
      .filter(f => f.fallback && f.enabled)
      .map(f => ({ src: f.src, name: f.name, unicodeRange: f.unicodeRange }));
  }

  getFontsByFamily(family: string, registry: FontConfig[]): FontConfig[] {
    return registry.filter(f => f.family === family && f.enabled);
  }

  getFallbackFamilies(registry: FontConfig[]): string[] {
    return [...new Set(registry.filter(f => f.fallback && f.enabled).map(f => f.family))];
  }

  registerFont(config: FontConfig, registry: FontConfig[]): void {
    registry.push(config);
  }

  async loadFontBuffer(src: string): Promise<ArrayBuffer> {
    // fetch from CDN, R2, S3, local cache — whatever makes sense here
    const response = await fetch(src);
    return response.arrayBuffer();
  }
}
```

For a complete, tested reference, see `local/`.

---

## `@vmprint/standard-fonts` — Zero-Asset Standard Fonts

`StandardFontManager` maps all requested font families to one of the 14 standard PDF fonts and returns a 5-byte sentinel buffer instead of real font data. The engine detects the sentinel and uses built-in AFM metric tables rather than fontkit — so text measurement, line breaking, and pagination all work correctly, with no font files anywhere in the pipeline.

The resulting PDF carries only PostScript font name references (e.g. `/Helvetica-Bold`). Every conforming PDF viewer is required to supply rendering for these fonts, so no font data is embedded.

### When to use it

- **Font-free PDFs** — output that relies solely on the PDF-14 standard fonts, with no embedded binary font data
- **Bundle-size-sensitive environments** — a static HTML renderer, a CLI bundled as a single file, or an edge function where font assets would dominate the payload
- **Test and validation pipelines** — scenarios that need correct layout metrics but don't need visual font fidelity

### Alias mapping

`StandardFontManager` maps common family names to the nearest standard font:

| Alias | Resolves to |
|---|---|
| Times, Times New Roman, serif | Times |
| Arial, Helvetica, sans-serif | Helvetica |
| Courier, Courier New, monospace | Courier |
| Symbol | Symbol |
| ZapfDingbats, Zapf Dingbats | ZapfDingbats |

Weight and style variants (bold, italic) are resolved to the correct PostScript variant within each family.

### Usage

```ts
import { StandardFontManager } from '@vmprint/standard-fonts';
import { createEngineRuntime } from '@vmprint/engine';

const runtime = createEngineRuntime({ fontManager: new StandardFontManager() });
```

No configuration required. `StandardFontManager` carries no font assets and accepts no constructor options.

### Limitations

- **Latin scripts only.** The PDF-14 fonts cover Windows-1252 (Latin-1 + Western European supplement). Characters outside this range fall back to the font's default advance width and render as missing glyphs.
- **No kerning.** AFM metric tables do not include kern pairs. Text layout is correct but unkerned.
- **No CJK or multilingual fallback.** For multilingual documents, use `LocalFontManager`.

See [`docs/reference/standard-fonts.md`](../docs/reference/standard-fonts.md) for the full architectural specification.

---

## `@vmprint/local-fonts` — The Reference Implementation

`LocalFontManager` is the default font manager for Node.js and CLI use. It ships a curated set of open-source fonts and handles all the common source types a `src` field might contain.

### Bundled fonts

**Primary families** — covering Western scripts, used as document fonts:

| Family | Style | Notes |
|---|---|---|
| Courier Prime | monospace | Required for WGA-compliant screenplay output |
| Arimo | sans-serif | Static Regular/Bold/Italic/BoldItalic; metric-compatible with Arial/Helvetica |
| Noto Sans | sans-serif | Broad Latin + extended Unicode coverage |
| Tinos | serif | Metric-compatible with Times New Roman |
| Caladea | serif | Metric-compatible with Cambria |
| Carlito | sans-serif | Metric-compatible with Calibri |
| Cousine | monospace | Metric-compatible with Courier New |

**Fallback families** — engaged automatically for characters outside the primary font's unicode range:

| Family | Scripts covered |
|---|---|
| Noto Sans SC | Simplified Chinese (CJK Unified Ideographs) |
| Noto Sans JP | Japanese (Hiragana, Katakana, CJK) |
| Noto Sans KR | Korean (Hangul) |
| Noto Sans Thai | Thai |
| Noto Sans Arabic | Arabic and Arabic Extended |
| Noto Sans Devanagari | Hindi, Sanskrit, and other Devanagari scripts |
| Noto Sans Symbols 2 | Mathematical, technical, and miscellaneous symbols |

Fallback fonts are selected by unicode range. When a run of text contains characters outside the primary font's declared range, the engine picks the appropriate fallback automatically — so a document mixing Latin prose with Japanese annotations, Arabic quotations, or Hindi names just works.

### Alias resolution

`LocalFontManager` maps common system font names to their bundled open-source equivalents, so document configs that reference system fonts render correctly without modification:

| Alias | Resolves to |
|---|---|
| Times, Times New Roman | Tinos |
| Arial, Helvetica, Helvetica Neue | Arimo |
| Courier, Courier New | Cousine |
| Calibri, Segoe UI | Carlito |
| Cambria | Caladea |
| sans-serif | Noto Sans |
| serif | Tinos |
| monospace | Cousine |

CJK system font names (Microsoft YaHei, SimHei, Hiragino Sans, Malgun Gothic, and variants) are also mapped to the appropriate Noto families.

### Font loading

`loadFontBuffer` resolves `src` values in this order:

1. **HTTP / HTTPS URLs** — fetched via `fetch()`, works in any environment that has it
2. **Data URIs** — decoded in-memory, no I/O
3. **Browser context** (non-Node) — fetched via `fetch()`
4. **Filesystem path** (Node.js) — resolved against the package root, dist directory, and `process.cwd()`, with several candidate paths tried to handle both built and unbuilt layouts

Variable fonts are not supported. Arimo is bundled as static Regular/Bold/Italic/BoldItalic instances.

### Extending the registry

The full font registry (`LOCAL_FONT_REGISTRY`) and alias map (`LOCAL_FONT_ALIASES`) are exported. You can construct a `LocalFontManager` with additional fonts or a custom alias map:

```ts
import { LocalFontManager, LOCAL_FONT_REGISTRY, LOCAL_FONT_ALIASES } from '@vmprint/local-fonts';

const manager = new LocalFontManager({
  fonts: [
    ...LOCAL_FONT_REGISTRY,
    {
      name: 'MyFont Regular',
      family: 'MyFont',
      weight: 400,
      style: 'normal',
      src: '/absolute/path/to/MyFont-Regular.ttf',
      enabled: true,
      fallback: false
    }
  ],
  aliases: {
    ...LOCAL_FONT_ALIASES,
    'my font': 'MyFont'
  }
});
```
