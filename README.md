# VMPrint

*I built the layout engine so you don't have to.*

VMPrint is a layout engine. Not a PDF library. Not a renderer. A layout engine: the component that decides where every glyph goes, negotiates page breaks, resolves mutual spatial dependencies between dynamic regions, and produces a flat array of exact X/Y coordinates for every box and text run in the document.

What you do with that output is your call: render to PDF, replay on a Canvas, drive a word processor's display layer, feed it to a WebGL pipeline. The engine's job ends when the math is done.

The architecture is backed by a pending patent. The core insight: document layout is a deterministic spatiotemporal simulation, not a pipeline. Document elements are autonomous actors inhabiting a persistent world coordinate space. Pages are viewport projections over that world; they are not containers that content gets assigned into. Actors negotiate geometry with their neighbors, publish committed facts when their placement settles, and other actors observe those facts and respond, all within a single forward simulation pass. The output is captured when the world reaches equilibrium.

That is not a metaphor. It is the literal execution model. It is why things that require multiple passes in every other system, such as a table of contents that needs accurate page numbers or a dynamic region that depends on sibling geometry, resolve correctly in one pass here.

<p align="center">
  <img src="documents/assets/newsletter.png" width="48%" alt="VMPrint Quarterly: multi-column newsletter with float obstacles, drop cap, and inline elements">
  <img src="documents/assets/newsletter-debug.png" width="48%" alt="Same document with --debug: every actor boundary, margin, and box labeled">
</p>
<p align="center"><em>Left: rendered output. Right: the same document with <code>--debug</code>; every actor boundary and box labeled. The layout is fully inspectable data.</em></p>

---

## Who needs a layout engine

**Canvas and WebGL tool builders.** Teams building Figma-class apps, infinite whiteboards, or data visualization platforms have typically abandoned the DOM and render everything through Canvas, WebGL, or WebGPU. When a user types Arabic text or mixes scripts, a naive word-wrap breaks. VMPrint acts as a typographic microservice: hand it a JSON document with text, fonts, and bounding constraints; get back a flat array of exact glyph X/Y coordinates per line. You draw. VMPrint does the math.

**High-volume report generators.** FinTech, LegalTech, and MedTech platforms generating thousands of complex PDFs per day: financial audits, personalized contracts, localized dossiers. The default approach, spinning up headless Chrome via Puppeteer, requires a full browser process per worker: roughly 300 MB RAM, hundreds of milliseconds of cold-start overhead, subprocess privilege, and cost that scales linearly with concurrency. VMPrint runs inside your existing Node.js process or V8 isolate. 326 pages, warm: 718 ms. No browser. No subprocess.

<p align="center">
  <img src="documents/assets/report.png" width="48%" alt="Financial report: complex multi-column layout with large display type and tables">
  <img src="documents/assets/console.jpg" width="48%" alt="Terminal: 324-page manuscript compiled to PDF in 2.32s end-to-end">
</p>
<p align="center"><em>Left: financial report output. Right: 324-page manuscript, Markdown to PDF, end-to-end in 2.32s.</em></p>

**Print-on-demand and automated publishing.** Photobook generators, catalog compilers, automated textbook systems, and direct-mail platforms. CSS `@page` and `break-inside: avoid` remain unreliable across browsers. VMPrint is deterministic: page 42 is page 42 on every machine, every OS, every run. Pagination is a first-class physical constraint resolved by a simulation engine, not a browser heuristic.

**Word processor and document editor builders.** Teams building collaborative editors, screenwriting tools, academic paper editors, or SOP builders. `contenteditable` gives you no programmatic layout state. You cannot ask the DOM where line 3 ends without expensive range measurements. VMPrint gives you the layout as inspectable data: every line break, every page break, mathematically determined, available as a flat JSON structure you can diff, serialize, and replay. More than that, VMPrint knows where every individual glyph is and what it is. Accurate cursor placement, text selection, and hit-testing are not afterthoughts; they fall out of the layout data directly.

**Edge runtime and serverless.** Deploying to Cloudflare Workers, Deno Deploy, or Lambda@Edge where headless Chrome is impossible: no subprocess, tight bundle limits, no native binary dependency story. VMPrint is pure TypeScript with no native shaping dependency and no binary requirement. It runs in a V8 isolate.

---

## What it does that prior systems cannot

**Single-pass TOC, index, and bibliography.** A table of contents must know page numbers before it can render, but the page numbers of subsequent content depend on how much space the TOC occupies. Every prior system resolves this through a second layout pass, an approximation, or external auxiliary files. VMPrint resolves it in one pass: heading actors emit committed signals as their geometry settles; the TOC actor observes those signals within the same running simulation and assembles accurate entries. The numbers are exact. There is no second pass.

**Multi-script and bidi layout without an external shaping engine.** No HarfBuzz. No ICU. No system-level binary. Arabic, Hebrew, Thai, Devanagari, CJK, and Latin on the same line, each script segment measured against its own font metrics, bidi-reordered, baseline-aligned against the dominant line metrics, in pure JS.

<p align="center">
  <img src="documents/assets/languages.jpg" width="80%" alt="Writing Systems of the World: Latin, CJK, Arabic RTL, Thai, and dense mixed-script text all correctly laid out">
</p>

**Content-only updates that never trigger spatial resettlement.** When a page counter updates from 11 to 12, every prior layout system responds by recalculating layout, partially or fully. VMPrint classifies actor update outcomes into three tiers: no-change, content-only, and geometry-changing. A counter changing its displayed number pays the in-place redraw cost only. Nothing downstream is touched.

**Deterministic speculative layout with rollback.** Widow/orphan control, keep-with-next rules, and cohesion policies are evaluated by placing a speculative branch, scoring it against the continuity policy, and either committing or rolling back to a bit-for-bit identical kernel snapshot. The rollback is atomic and complete: active actor state, signal bus staging buffers, and world-space coordinates all revert exactly.

**Layout output as flat, traceable, serializable data.** The engine produces `Page[]` of `Box[]`: absolutely positioned primitives with semantic provenance on every box. Diff layout changes as JSON. Pre-compile and cache the layout, render it later. Feed the flat geometry directly to a GPU draw pipeline. This is the format Canvas and WebGL consumers need.

**Documents that program themselves.** VMPrint documents can carry script methods that run as first-class participants in the layout simulation, not as post-processing hooks. An `onReady()` handler fires after layout has fully settled and can query real page numbers, real element positions, and real content counts, then mutate the document structure in response. When a script mutates structure, the simulation resettles from the earliest affected point, not from scratch.

**Patent-pending microkernel architecture.** The engine's behavior, including single-pass cyclic dependency resolution, speculative pathfinding with deterministic rollback, branch-aware transactional signal isolation, three-tier update outcome classification, world-map spatial model with viewport-based pagination, and kernel-owned simulation clock, is covered by a pending patent application with reduction-to-practice evidence for the claimed mechanisms.

---

## Get started

```bash
npm install @vmprint/engine @vmprint/local-fonts @vmprint/context-pdf
```

Start paths:

- [QUICKSTART.md](QUICKSTART.md) for the repo-level orientation
- [pressrun/](pressrun/) for the smallest practical bootstrap example
- [engine/README.md](engine/README.md) for the engine package surface
- [guides/](guides/) for authored usage guides
- [references/](references/) for compact reference material

---

## Packages

All VMPrint core engine, contexts, font managers, transmuters, and preview utilities are managed collectively in this monorepo under the following workspace directories:

| Directory | Package Name | Purpose |
|---|---|---|
| [`engine/`](engine/) | `@vmprint/engine` | Core spatial-simulation layout engine |
| [`contracts/`](contracts/) | `@vmprint/contracts` | Common TypeScript interfaces and contracts |
| [`cli/`](cli/) | `@vmprint/cli` | Command Line Interface for batch document typesetting |
| [`preview/`](preview/) | `@vmprint/preview` | Browser-side preview controller, selection, and SVG/PDF exporter |
| [`contexts/`](contexts/) | | Rendering surfaces and contexts |
| &nbsp;&nbsp;&nbsp;&nbsp;`canvas/` | `@vmprint/context-canvas` | Browser rendering context backed by SVG page scenes |
| &nbsp;&nbsp;&nbsp;&nbsp;`pdf/` | `@vmprint/context-pdf` | Server/Node PDF rendering context powered by PDFKit |
| &nbsp;&nbsp;&nbsp;&nbsp;`pdf-lite/` | `@vmprint/context-pdf-lite` | Lightweight PDF rendering context powered by jsPDF |
| [`font-managers/`](font-managers/) | | Font assets and managers |
| &nbsp;&nbsp;&nbsp;&nbsp;`local/` | `@vmprint/local-fonts` | Node/filesystem font manager bundling open-source fonts |
| &nbsp;&nbsp;&nbsp;&nbsp;`standard/` | `@vmprint/standard-fonts` | Sentinel AFM proxy font manager (zero binary assets) |
| &nbsp;&nbsp;&nbsp;&nbsp;`web/` | `@vmprint/web-fonts` | Browser URL/caching font manager |
| [`transmuters/`](transmuters/) | | Content transmuters (compilers) |
| &nbsp;&nbsp;&nbsp;&nbsp;`markdown-core/` | `@vmprint/markdown-core` | Runtime-neutral Markdown compiler substrate |
| &nbsp;&nbsp;&nbsp;&nbsp;`mkd-*` | `@vmprint/mkd-*` | Concrete transmuter targets (screenplay, academic, novel, etc.) |
| [`pressrun/`](pressrun/) | `pressrun` | Smallest practical engine bootstrap example |
