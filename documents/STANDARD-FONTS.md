# Standard Font Architecture

This document describes the design and rationale for VMPrint's standard font system — a mechanism for producing documents that require no font embedding, using fonts the rendering target is expected to know about.

---

## 1. The Problem

VMPrint's engine resolves fonts by loading binary font buffers (TTF/OTF), passing them to fontkit, and deriving all layout metrics (character advance widths, ascent, descent) directly from the binary data. This is exact, portable, and deterministic.

However, it creates an implicit requirement: every font used in a document must have a physical file present at render time. For some targets and use cases this is undesirable:

- **PDF output with no embedded fonts** — PDF viewers are guaranteed to have the 14 standard fonts (Helvetica, Times, Courier, Symbol, ZapfDingbats and their variants). There is no reason to embed them, but the engine currently has no way to express "use this font by name, emit no binary data."
- **Minimal distribution size** — a static HTML renderer, a CLI tool bundled as a single file, or an embedded engine in a constrained environment should not need to carry hundreds of kilobytes of font data if the rendering target already has what it needs.
- **Future native IR viewer** — if VMPrint ever defines a viewer for its own IR, that viewer can ship a canonical set of fonts (e.g. the full Noto suite) and resolve them without per-document embedding, exactly as PDF readers do for their 14.

---

## 2. Design Goals

1. **No changes to the FontManager contract.** Standard fonts are expressed entirely within the existing `loadFontBuffer()` mechanism.
2. **No changes to the layout pipeline.** Text measurement, line breaking, pagination — all existing code paths remain untouched.
3. **Fail-fast is preserved.** If a font is unknown, the engine still throws immediately.
4. **The concept is not limited to PDF's 14.** The architecture is defined in terms of VMPrint's own notion of "standard fonts." The PDF-14 are the first instantiation; the set can grow.
5. **Swappable via font manager.** Callers opt in by using `StandardFontManager` instead of `LocalFontManager`. No engine flags, no output-format switches.

---

## 3. Core Mechanism: Sentinel Buffers

A **sentinel buffer** is a minimal byte sequence that the engine recognizes as a standard font declaration rather than real binary font data.

### Sentinel Format

```
Offset  Length  Content
0       3       Magic bytes: 0x53 0x46 0x4D  ("SFM" — Standard Font Marker)
3       1       Version: 0x01
4       1       Font ID: 0x00–0x0D  (index into the 14-font canonical table)
```

Total: **5 bytes.**

This sequence cannot be mistaken for a valid TTF or OTF file. TTF files always begin with `0x00 0x01 0x00 0x00` (sfVersion) or `OTTO` (CFF-based OpenType). The `SFM` magic is unambiguous.

### Font ID Table

| ID   | Canonical Name      | Style Variants Covered                                          |
|------|---------------------|-----------------------------------------------------------------|
| 0x00 | Helvetica           | Regular                                                         |
| 0x01 | Helvetica-Bold      | Bold                                                            |
| 0x02 | Helvetica-Oblique   | Italic                                                          |
| 0x03 | Helvetica-BoldOblique | Bold Italic                                                   |
| 0x04 | Times-Roman         | Regular                                                         |
| 0x05 | Times-Bold          | Bold                                                            |
| 0x06 | Times-Italic        | Italic                                                          |
| 0x07 | Times-BoldItalic    | Bold Italic                                                     |
| 0x08 | Courier             | Regular                                                         |
| 0x09 | Courier-Bold        | Bold                                                            |
| 0x0A | Courier-Oblique     | Italic                                                          |
| 0x0B | Courier-BoldOblique | Bold Italic                                                     |
| 0x0C | Symbol              | Regular                                                         |
| 0x0D | ZapfDingbats        | Regular                                                         |

---

## 4. Engine Integration: The AFM Proxy

When `font-cache-loader.ts` receives a buffer, it checks for the `SFM` magic header before calling `fontkit.create()`. If detected, instead of parsing the buffer as a font file, it returns an **AFM font proxy** object.

The proxy implements the same interface that `text-processor.ts` uses from fontkit font objects:

```typescript
interface FontProxy {
    unitsPerEm: number;
    ascent: number;
    descent: number;
    layout(text: string): FontLayout;
}

interface FontLayout {
    glyphs: Array<{ codePoints: number[]; advanceWidth: number }>;
    positions: Array<{ xAdvance?: number; xOffset?: number; yOffset?: number }>;
}
```

The proxy reads character advance widths from a **static AFM lookup table** compiled into the engine. The layout pipeline — `measureText()`, `getFontVerticalMetrics()`, and everything that calls them — requires no modification.

### WIN_ANSI Encoding

PDF standard fonts use **Windows-1252 (Win-ANSI) encoding**, not Unicode. The AFM proxy therefore includes a `WIN_ANSI_CODE_MAP` that translates Unicode code points to Win-ANSI codes before looking up character widths in the AFM tables. Characters outside the Latin-1 + Win-ANSI supplement range (roughly U+0020–U+00FF, plus selected characters in U+2000–U+20FF such as smart quotes, em dash, and the Euro sign) fall back to the font's `defaultWidth`. This is the correct and expected behavior for PDF standard fonts — they are inherently a Latin-script encoding.

### What the AFM Proxy Does Not Provide

- **Kerning.** The Adobe AFM data included in the public PDF spec does not cover kern pairs in a form suitable for general use. Standard font output produces no kerning adjustments. This is consistent with, and no worse than, how most PDF generation libraries handle these fonts.
- **Glyph outlines.** The proxy returns stub glyphs with no vector data. This is correct: if glyphs need to be embedded (e.g. for rasterization), a real font buffer must be used.

---

## 5. StandardFontManager

`StandardFontManager` is a `FontManager` implementation that maps all requested font families to one of the 14 canonical standard fonts and returns sentinel buffers.

### Alias Mapping

The manager maps common font names to the nearest standard font:

| Requested family           | Maps to          |
|----------------------------|------------------|
| `"helvetica"`, `"arial"`, `"sans-serif"` | Helvetica family |
| `"times"`, `"times new roman"`, `"serif"` | Times family     |
| `"courier"`, `"courier new"`, `"monospace"` | Courier family  |
| `"symbol"`                 | Symbol           |
| `"zapfdingbats"`, `"zapf dingbats"` | ZapfDingbats    |

Weight and style variants (bold, italic) are resolved to the appropriate font ID within the family.

### No Physical Assets

`StandardFontManager` carries no font files. Its entire implementation is a static alias/ID table and the 5-byte sentinel buffer factory. It is appropriate for:

- Bundle-size-sensitive environments
- Server-side rendering where PDFs must be font-free
- Testing and validation scenarios that do not require visual fidelity

---

## 6. Output Context Behavior

The rendering context (e.g. `contexts/pdf`) is responsible for deciding what to write into the output format when it encounters a standard font. For the PDF context:

- If the font was loaded from a sentinel buffer, the context emits only the PostScript font name (e.g. `/Helvetica-Bold`) with no embedded font stream.
- If the font was loaded from a real buffer, the context embeds the font data as it does today.

The context determines this by inspecting a flag on the loaded font object (set by the engine's cache loader when a sentinel is detected), not by re-parsing the buffer.

---

## 7. Future Extension: Custom Standard Font Sets

The sentinel mechanism is not inherently tied to PDF's 14. The font ID byte supports up to 256 entries. A future version may define:

- **Extended standard set** — adds Noto Sans, Noto Serif, Noto Mono as well-known IDs. A native IR viewer that ships these fonts can resolve them without embedding.
- **Viewer-declared capability** — the IR viewer declares which font IDs it supports. The engine or pipeline can verify compatibility before emitting a document that relies on them.

This allows the same `StandardFontManager` pattern to scale from "PDF lite" all the way to "full multilingual, zero-embed" as viewer support matures.

---

## 8. Component Map

```
contracts/
  font-manager.ts         FontManager interface — unchanged

engine/
  font-management/
    font-cache-loader.ts  Detects SFM sentinel → returns AFM proxy instead of fontkit object
    afm-proxy.ts          AFM font proxy implementing the fontkit interface subset
    afm-tables.ts         Static character width + metrics tables for the 14 standard fonts
    sentinel.ts           Sentinel buffer factory and detection utilities

font-managers/
  standard/               StandardFontManager package
    src/
      config.ts           Alias table + font ID mappings
      index.ts            StandardFontManager implementation

contexts/pdf/
  src/
    index.ts              Checks standard-font flag on loaded font; suppresses embedding
```

---

## 9. Design Invariants

- The engine never inspects font names to decide behavior. All decisions flow from the buffer content.
- Sentinel detection is binary and unambiguous — no heuristics.
- `StandardFontManager` is a complete, independent `FontManager` implementation. It does not extend or wrap `LocalFontManager`.
- The AFM proxy is internal to the engine. Nothing outside `engine/` knows it exists.
- Fail-fast is preserved: an unknown family still throws at the registration/resolution stage, regardless of which font manager is in use.
