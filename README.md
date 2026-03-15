# VMPrint

**What if text isn't text?**

For decades, displaying and laying out text has been one of the hardest problems in software. Hard enough that when browsers came along and offered a ready-made solution, nearly everyone climbed aboard and stopped asking whether there was another way. Today, "generate a document" means "run a browser." Layout means DOM. Pagination means fighting a rendering engine designed for the web, not for pages.

But what if the reason text layout has always been hard is that we've been solving it at the wrong level of abstraction?

A drop cap isn't a character. It's an actor with a geometry, a presence, a set of rules about how the world around it must respond. A table isn't a grid. It's a formation that holds together across page boundaries, splits under constraint, and reconstructs itself on the other side. A Table of Contents isn't a list. It's an observer — one that watches the rest of the document settle into place and then updates itself accordingly.

Once you see it this way, something clicks. Text layout isn't a typography problem. It's a spatial simulation problem. And spatial simulation is something the games industry has been solving — with extraordinary sophistication — for the past forty years.

VMPrint is what happens when you stop treating text as text and start treating it as actors navigating a world.

---

## A different kind of engine

VMPrint is a deterministic spatial simulation engine. Pages are bounded arenas. Document elements are autonomous actors with physical geometries. Layout is the process of reaching equilibrium.

There is no DOM underneath. No browser. No HTML. No CSS box model. The engine doesn't know what a browser is. It knows what a constraint field is. It knows what a collision is. It knows what a snapshot is, and what a rollback is, and what it means for a world to settle.

This isn't a metaphor. It is the literal architecture.

The drop cap is an actor. The paragraph is an actor. The table is an actor. The TOC is an actor — one that listens to signals from heading actors as they commit to the layout, and grows accordingly, and when it grows it displaces what comes after it, and when everything settles the TOC knows its own page numbers and the document knows its own shape. All of this in a single pass. No second pass. No auxiliary files. No external processes.

What this makes possible is a category shift — not just in what documents can do, but in what you can build with this as your foundation.

A programmable editor that doesn't need a browser. A document runtime that runs identically on a Cloudflare Worker, a mobile device, a desktop app, and a terminal. A UI framework where the layout engine is inspectable, participatory, and deterministic down to the sub-point position of every glyph. A new generation of tools that the web made people forget was possible.

VMPrint doesn't build those things for you. It gives you the substrate they require.

---

## Anti-blackbox by architecture

Every layout system you have used before is a black box. Not because the source isn't published. Because the architecture doesn't give you meaningful points of entry. You hand it input. It gives you back output. What happened in between is not your concern.

VMPrint was deliberately architected to be the opposite.

The actor contract means you can introduce your own actors into the simulation. They run the same physics, the same lifecycle, the same collision detection as every native actor. They are not guests. They are citizens of the same world.

The event bus means your code can publish signals and observe committed signals the same way actors communicate with each other. You are not monitoring the simulation from outside. You are participating in it from inside.

The overlay provider means you can see exactly what the engine sees at any moment — every box, every boundary, every collision — and draw on top of it, instrument it, or redirect it.

The snapshot and rollback mechanism means world state is inspectable and reproducible at every checkpoint. Layout bugs become reproducible facts. "It looked different on Windows" becomes impossible by construction.

The output is a flat array of absolute coordinates — every character, every box, every fragment — with full semantic provenance attached:

```ts
{ sourceId: 'ast-node-10', fragmentIndex: 2, transformKind: 'split', isContinuation: true }
```

You can trace any pixel in the final output back to its source. You can snapshot the entire layout as JSON and diff it character by character between versions. You can replay any simulation deterministically. The engine is transparent all the way down — not because the code is published, but because transparency was designed in from the first commit.

---

## In practice

<!-- [IMAGE: Terminal screenshot — npx draft2final "Thus_Spoke_the_Khan's_Grand_Advisor.md" showing 325 pages, 2.36s] -->

**325 pages. 80,000 words. Markdown to publication-standard PDF. 2.36 seconds. Surface Pro 11 tablet. Running on battery.**

No browser. No second pass. No auxiliary files.

<!-- [IMAGE: The two-page manuscript spread — Chapter 1, Pang Ban on the boulder] -->

<!-- [IMAGE: The mixed-script paragraph — Latin, Chinese, Arabic, Sanskrit, Thai — one paragraph, perfect vertical rhythm] -->

Full bidirectional text. Five writing systems. No HarfBuzz. No external shaping engine. Every script at its native baseline. Every line at the same distance from the next.

<!-- [IMAGE: The multilingual two-page spread with debug overlay — Writing Systems of the World] -->

<!-- [IMAGE: Multi-column layout page if available] -->

**Full torture suite — 19 regression fixtures, 120 complex pages:**

| Scenario | Layout | Render | Total |
|---|---|---|---|
| Warmed (shared runtime) | ~420 ms | ~32 ms | ~452 ms |

**Footprint:**

| | |
|---|---|
| VMPrint full dependency tree | ~2 MiB packed |
| Headless Chromium | ~170 MB |

The engine runs identically in Cloudflare Workers, AWS Lambda, Bun, Deno, Node.js, and directly in the browser. Same input. Same fonts. Same config. Identical output — down to the sub-point position of every glyph.

---

## draft2final

`draft2final` is a thin CLI built entirely on the VMPrint API. One command from source to publication-ready PDF:

```bash
npx draft2final "manuscript.md"
npx draft2final "screenplay.md" --as screenplay
npx draft2final "paper.md" --as academic --style minimal
```

Supports `--as manuscript / screenplay / academic / literature` and `--style classic / modern / minimal`.

---

## Getting started

Prerequisites: Node.js 18+, npm 9+

```bash
git clone https://github.com/cosmiciron/vmprint.git
cd vmprint
npm install
```

Render a JSON document to PDF:

```bash
npm run dev --prefix cli -- --input engine/tests/fixtures/regression/00-all-capabilities.json --output out.pdf
```

Source-to-PDF via draft2final:

```bash
npm run dev --prefix draft2final -- samples/draft2final/source/screenplay/screenplay-sample.md --as screenplay --out screenplay.pdf
```

---

## API

```ts
import fs from 'fs';
import { LayoutEngine, Renderer, toLayoutConfig, createEngineRuntime } from '@vmprint/engine';
import { PdfContext } from '@vmprint/context-pdf';
import { LocalFontManager } from '@vmprint/local-fonts';

const runtime = createEngineRuntime({ fontManager: new LocalFontManager() });
const config = toLayoutConfig(documentInput);
const engine = new LayoutEngine(config, runtime);

await engine.waitForFonts();
const pages = engine.simulate(documentInput.elements);

const context = new PdfContext({
  size: [612, 792],
  margins: { top: 0, right: 0, bottom: 0, left: 0 },
  autoFirstPage: false,
  bufferPages: false
});

const fileStream = fs.createWriteStream('output.pdf');
context.pipe({
  write(chunk) { fileStream.write(chunk); },
  end()        { fileStream.end(); },
  waitForFinish() {
    return new Promise((resolve, reject) => {
      fileStream.once('finish', resolve);
      fileStream.once('error', reject);
    });
  }
});

const renderer = new Renderer(config, false, runtime);
await renderer.render(pages, context);
```

To use only the 14 standard PDF fonts — no embedded font binaries, zero extra bytes:

```ts
import { StandardFontManager } from '@vmprint/standard-fonts';
const runtime = createEngineRuntime({ fontManager: new StandardFontManager() });
```

---

## What it can do

**Simulation and layout**
- DTP-style multi-column story regions with adjustable gutters
- Mixed-layout pages — full-width headers flowing into three-column articles
- `keepWithNext`, `pageBreakBefore`, orphan and widow controls
- Tables spanning pages: `colspan`, `rowspan`, row splitting, repeated header rows
- Drop caps and continuation markers when content splits across pages
- Text wrapping around complex floating obstacles across column boundaries
- Inline images and rich objects on text baselines
- Native single-pass Tables of Contents, Indexes, Bibliographies, and Endnotes

**Typography and multilingual**
- Grapheme-accurate line breaking via `Intl.Segmenter`
- Full bidirectional text support without external shaping engines
- CJK text breaks correctly between characters without spaces
- Indic scripts measured and broken as grapheme units, not codepoints
- Language-aware hyphenation per text segment
- Mixed-script runs sharing the same baseline across font boundaries
- Optical scaling for mixed-script inline runs
- Space-based and inter-character justification modes

**Architecture**
- Pure TypeScript, zero runtime environment dependencies
- Identical layout output across browser, Node.js, serverless, and edge runtimes
- Swappable font managers and rendering contexts via clean interfaces
- Deterministic state snapshots and rollback for speculative layout pathfinding
- Transactional inter-actor communication bus with branch-aware signal isolation
- Targeted dirty-frontier resimulation with precision restore-point targeting
- JSON-serializable `Page[]` output for regression testing and pre-compilation
- Overlay hooks for instrumentation, debug grids, watermarks, and print marks

---

## Packages

| Package | Purpose |
|---|---|
| `@vmprint/contracts` | Shared interfaces |
| `@vmprint/engine` | Deterministic layout simulation core |
| `@vmprint/context-pdf` | PDF output context |
| `@vmprint/context-pdf-lite` | Lightweight jsPDF-based PDF context |
| `@vmprint/local-fonts` | Filesystem font loading |
| `@vmprint/standard-fonts` | Standard font manager (no font assets) |
| `@vmprint/transmuter-mkd-mkd` | Markdown → DocumentInput |
| `@vmprint/transmuter-mkd-academic` | Markdown → DocumentInput (academic defaults) |
| `@vmprint/transmuter-mkd-literature` | Markdown → DocumentInput (literature defaults) |
| `@vmprint/transmuter-mkd-manuscript` | Markdown → DocumentInput (manuscript defaults) |
| `@vmprint/transmuter-mkd-screenplay` | Markdown → DocumentInput (screenplay defaults) |
| `@vmprint/cli` | `vmprint` JSON → PDF CLI |
| `@draft2final/cli` | Source → PDF or AST CLI |

---

## Footprint

| Package | Tarball | Unpacked |
|---|---:|---:|
| `@vmprint/engine` | 136,449 B (~133 KiB) | 713,077 B (~697 KiB) |
| `@vmprint/context-pdf-lite` | 5,101 B | 20,001 B |
| `@vmprint/standard-fonts` | 3,553 B | 11,232 B |

Full dependency tree including fontkit: **~2 MiB packed / ~8.7 MiB unpacked.**

Static standard-font browser bundle: **~710 KiB raw / ~182 KiB brotli.**

---

## Contributing

**Engine** (`engine/`): Layout algorithms, simulation, text shaping, the packager system. This is where the hard problems live. Regression snapshot tests verify that changes haven't broken existing behavior.

**Contexts and font managers** (`contexts/`, `font-managers/`): Concrete implementations of well-defined interfaces. A new context for canvas or SVG. A font manager that loads from a CDN. The contracts are clear, the surface area is contained.

**Transmuters** (`transmuters/`): Source semantics live here. Each transmuter maps source text to `DocumentInput`. Testable and portable across browser, Node.js, and edge runtimes.

```bash
npm run test --prefix engine
npm run test:update-layout-snapshots --prefix engine
npm run build --workspace=draft2final
npm run test:packaged-integration
```

---

## Status

The core layout pipeline is working and covered by regression fixtures. PDF output is the production-ready path. Full bidirectional text support shipped without external shaping dependencies. A provisional patent application has been filed covering the spatiotemporal simulation architecture.

The API may evolve. The fundamentals will not.

---

[Architecture](documents/ARCHITECTURE.md) · [Quickstart](QUICKSTART.md) · [Contributing](CONTRIBUTING.md) · [Testing](documents/TESTING.md) · [Examples](docs/examples/index.html) · [Substack](https://substack.com/@cosmiciron)

## License

Apache 2.0. See [LICENSE](LICENSE).
