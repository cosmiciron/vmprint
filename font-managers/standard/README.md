# @vmprint/standard-fonts

`StandardFontManager` is a zero-asset `FontManager` that maps requested font families to the 14 standard PDF fonts and returns 5-byte sentinel buffers instead of real font data.

The engine detects each sentinel and uses built-in AFM metric tables rather than fontkit. Text measurement, line breaking, and pagination all work correctly — with no font files anywhere in the pipeline. The output PDF carries only PostScript font name references (e.g. `/Helvetica-Bold`); every conforming PDF viewer supplies the rendering for these fonts.

## Usage

```ts
import { StandardFontManager } from '@vmprint/standard-fonts';
import { createEngineRuntime } from '@vmprint/engine';

const runtime = createEngineRuntime({ fontManager: new StandardFontManager() });
```

No configuration required.

## When to use

- **Font-free PDFs** — output that uses only PDF-14 standard fonts, with no embedded binary font data
- **Bundle-size-sensitive environments** — edge functions, single-file CLIs, static HTML renderers
- **Test pipelines** — correct layout metrics without needing bundled font files

## Alias mapping

| Alias | Resolves to |
|---|---|
| Times, Times New Roman, serif | Times |
| Arial, Helvetica, sans-serif | Helvetica |
| Courier, Courier New, monospace | Courier |
| Symbol | Symbol |
| ZapfDingbats, Zapf Dingbats | ZapfDingbats |

Weight and style variants (bold, italic) resolve to the correct PostScript variant within each family.

## Limitations

- **Latin scripts only.** Coverage is Windows-1252 (Latin-1 + Western European supplement). Characters outside this range render as missing glyphs.
- **No kerning.** AFM tables do not include kern pairs.
- **No CJK or multilingual fallback.** Use `@vmprint/local-fonts` for multilingual documents.

See [`docs/reference/standard-fonts.md`](../../docs/reference/standard-fonts.md) for the full architectural specification.

---

Licensed under the [Apache License 2.0](LICENSE).

