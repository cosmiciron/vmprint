import {
    createVMPrintPreview,
    type PreviewLayoutSnapshotPage,
    type PreviewSession,
    type WebFontProgressEvent
} from '@vmprint/preview';
import {
    type VmprintInteractionSelectionPoint,
    type VmprintInteractionSelectionState
} from '@vmprint/engine';
import { transmute } from '@vmprint/mkd-mkd';

type ResolvedImage = {
    data: string;
    mimeType: 'image/png' | 'image/jpeg';
};

// -- Constants & Types ----------------------------------------------------

const DEFAULT_MARKDOWN = `# VMPrint Preview

> You are reading this document inside a live layout engine. Every word, every page break, every justified line—rendered in real-time by the same engine that produces your final PDF.

## Why Another PDF Library?

The honest answer: because every existing option forces you to make a painful trade-off.

| Library | The Problem |
|---|---|
| jsPDF | Manually place every element at X/Y coordinates. Impossible to maintain. |
| Puppeteer | Ships a 170MB headless Chromium. Cold starts take seconds. Page breaks drift unpredictably. |
| react-pdf | React-only. JSX-only. No server rendering without a React tree. Doesn't compose with your stack. |
| WeasyPrint | Python dependency. Docker required. No browser preview. |

VMPrint was designed from the ground up to eliminate all of these trade-offs. It is a **self-contained layout engine**—no browser, no framework, no server—that produces publication-quality documents.

---

## What You Get

The preview you see on the right is powered by **@vmprint/preview**, a thin wrapper around the VMPrint engine that renders directly to an HTML5 canvas. Every control here is a live demonstration of the API:

1. **Page navigation** — \`preview.getPageCount()\`, \`renderPageToCanvas(index, canvas)\`
2. **PDF export** — \`preview.exportPdf()\` returns a \`Uint8Array\`, fully in-browser, no upload required
3. **SVG export** — \`preview.exportSvgPage(index, { textMode: 'text' })\` for selectable text
4. **Live re-render** — \`preview.updateDocument(newAst)\` replaces the document with zero flicker

Try switching the **Style Preset** dropdown. The same markdown instantly reflows into a completely different document—different page size, font, column count, margins—without touching a single word.

### Under The Hood

![VMPrint simulation blueprint](https://github.com/cosmiciron/vmprint/blob/main/documents/readme-assets/blueprint-2.png)

The illustration here is a real engine artifact: actor placement, float settlement, drop-cap resolution, and mixed-script baseline alignment captured from an actual document simulation pass.

### Setting Up the Preview

\`\`\`typescript
import { createVMPrintPreview } from '@vmprint/preview';
import { transmute } from '@vmprint/mkd-mkd';

// Step 1: convert markdown to a DocumentInput AST
const docAst = transmute(markdownSource);

// Step 2: create a preview session
const preview = await createVMPrintPreview(docAst, {
  onFontProgress: (e) => updateProgressBar(e.percent)
});

// Step 3: render a page to any canvas element
await preview.renderPageToCanvas(0, myCanvas, {
  scale: 2,         // retina sharpness
  dpi: 144,
  backgroundColor: '#ffffff'
});
\`\`\`

The engine handles fonts asynchronously—OpenType files are fetched on demand, cached, and re-settled into the layout automatically. The \`onFontProgress\` callback lets you show a progress indicator while it happens (you can see ours in the footer bar below).

---

## The Architecture: Transmuters

Here is where VMPrint diverges from every other library.

Most document tools mix two concerns: *what the document contains* and *how to render it*. VMPrint separates them entirely. The engine speaks one language: a JSON structure called **DocumentInput**. It does not understand Markdown, nor HTML, nor any other source format. It understands only layout.

**Transmuters** are the bridge. A transmuter is a pure function:

\`\`\`typescript
type Transmuter = (source: string, options?: Options) => DocumentInput
\`\`\`

That is the entire contract. No I/O, no side effects, no framework imports. This means a transmuter runs identically in a browser, a Node.js server, a Cloudflare Worker, or a build-time Vite plugin.

### What You Are Looking At Right Now

This document—the one you are reading—is not a static string embedded in the application. It is a Markdown file being processed live by the **@vmprint/mkd-mkd** transmuter. Every time you edit the source in the left panel, this happens:

\`\`\`
Your Markdown → @vmprint/mkd-mkd → DocumentInput AST → Layout Engine → Canvas
\`\`\`

Click the **{}** button to open the AST drawer. You will see the full DocumentInput JSON that the transmuter produced from this markdown. The engine has no knowledge that the source was Markdown—it only sees a list of typed elements with style properties.

---

## Styling With YAML Themes

The default transmuters accept a **theme** as a YAML string. A theme is a complete description of your document's visual identity: page size, fonts, margins, line height, and a named style for every semantic element.

\`\`\`yaml
layout:
  pageSize: LETTER
  fontFamily: Caladea
  fontSize: 11.5
  lineHeight: 1.52
  margins: { top: 76, right: 80, bottom: 76, left: 80 }
  hyphenation: soft
  justifyEngine: advanced

footer:
  default:
    elements:
      - type: paragraph
        content: "{pageNumber}"
        properties:
          style: { textAlign: center, fontSize: 9, color: "#999" }

styles:
  heading-1:
    fontSize: 22
    fontWeight: bold
    color: "#1a1a2e"
    marginTop: 32
    marginBottom: 16
    keepWithNext: true
  paragraph:
    marginBottom: 10
    textAlign: justify
  blockquote:
    borderLeftWidth: 3
    borderLeftColor: "#10b981"
    paddingLeft: 14
    fontStyle: italic
  code-block:
    fontFamily: JetBrains Mono
    fontSize: 9.5
    backgroundColor: "#f4f4f8"
    padding: 10
\`\`\`

Pass this YAML directly into the transmuter—no JavaScript object transformation, no build step:

\`\`\`typescript
import { transmute } from '@vmprint/mkd-mkd';
import themeYaml from './my-brand.theme.yaml?raw';

const docAst = transmute(markdownSource, { theme: themeYaml });
\`\`\`

Your designers can own the theme file. Your engineers never need to touch it.

---

## Specialized Transmuters

The **@vmprint/mkd-mkd** transmuter is the general-purpose default. But the transmuter ecosystem includes formats built for specific document types:

| Package | What It Does |
|---|---|
| @vmprint/mkd-academic | Academic papers with footnotes, citations, and reference lists |
| @vmprint/mkd-literature | Literary prose with soft paragraph indents and chapter styling |
| @vmprint/mkd-manuscript | Novel and memoir formatting with automatic table-of-contents generation |
| @vmprint/mkd-screenplay | Fountain-style screenplay syntax with proper scene headings and action lines |

Switching a document between transmuters is a one-line change. The markdown source stays the same; only the interpretation changes.

---

## Building Your Own Transmuter

This is the capability that has no equivalent elsewhere.

Because the engine's input is a plain data structure—just a JSON object—you can write a transmuter for absolutely any source format. The only requirement is that your function returns a valid **DocumentInput**.

\`\`\`typescript
import type { DocumentInput } from '@vmprint/engine';

export function transmute(source: string, options?: MyOptions): DocumentInput {
  // Parse your format however you like
  const parsed = parseMyFormat(source);

  // Build layout and styles from your theme or defaults
  return {
    documentVersion: '1.1',
    layout: {
      pageSize: 'A4',
      fontFamily: 'Arimo',
      fontSize: 11,
      lineHeight: 1.5,
      margins: { top: 72, right: 72, bottom: 72, left: 72 }
    },
    styles: {
      'heading-1': { fontSize: 24, fontWeight: 'bold', marginBottom: 16 },
      'paragraph': { marginBottom: 10 }
    },
    elements: parsed.sections.map(section => ({
      type: 'paragraph',
      children: [{ type: 'text', content: section.text }]
    }))
  };
}
\`\`\`

No dependencies. No framework. Pass this to \`createVMPrintPreview\` and you have a live, paginated, exportable preview of your custom format—indistinguishable from anything built with the official transmuters.

### What This Actually Means

Consider what you can build:

- A **contract generation system** where a YAML data file and a template produce a fully-formatted legal document
- A **report builder** where a JSON export from your database flows through a transmuter and becomes a boardroom-ready PDF in milliseconds
- A **book publishing pipeline** where a single markdown manuscript is transmuted into a print-ready PDF, an e-reader EPUB, and a web preview—all from the same source
- A **custom DSL** for your domain—medical records, architectural specifications, academic transcripts—with layout rules baked into the transmuter, invisible to the author

react-pdf can produce beautiful PDFs. But it requires a React tree, JSX syntax, and a developer to maintain the layout code forever. A VMPrint transmuter is a pure function that any developer can understand in an afternoon—and a YAML theme that a designer can own entirely.

---

## The draft2final CLI

For document workflows outside the browser, **draft2final** is a command-line tool that wraps all transmuters into a single interface:

\`\`\`bash
# Render a markdown file to PDF using the default transmuter
draft2final report.md

# Use a specialized transmuter
draft2final story.md --as manuscript

# Apply a custom theme
draft2final report.md --style my-brand.yaml

# Output the DocumentInput AST as JSON instead of rendering
draft2final report.md --output report.ast.json

# Scaffold a new document with the recommended frontmatter boilerplate
draft2final --new screenplay.md --as screenplay
\`\`\`

The frontmatter in your markdown can declare the transmuter directly, so the command stays simple:

\`\`\`markdown
---
as: academic
style: ieee-conference
author: Dr. Ada Lovelace
---

# On the Analytical Engine

## Abstract

This paper presents...
\`\`\`

\`\`\`bash
draft2final lovelace-paper.md   # automatically uses mkd-academic + ieee-conference theme
\`\`\`

---

## What This Preview Is Showing You

Before you close this tab, consider what is happening in this browser window:

A markdown document is being parsed, semantically analyzed, flowed through a full desktop-publishing layout engine with optical margin alignment, advanced justification, JIT font loading, and multi-pass pagination—then rasterized to a retina-quality canvas—in **under a second**, with **no server**, **no plugin**, and **~1.7MB** of JavaScript.

The same code that runs here runs on a Cloudflare Worker. The same code runs in a CI pipeline. The same code runs in a VS Code extension. The document you export is not a screenshot of a web page—it is a geometrically precise, font-embedded, fully archival PDF.

That is what VMPrint is for.

---

*Edit this document in the left panel. Flip through the pages. Export to PDF. Open the AST drawer. Then imagine what you would build with it.*
`;

// undefined = use the transmuter's built-in default theme
const THEMES: Record<string, string | undefined> = {
    'tech-manual': undefined,

    'annual-report': `
layout:
  fontFamily: Carlito
  fontSize: 11.2
  lineHeight: 1.64
  pageSize: A4
  pageBackground: "#fcfbf7"
  margins:
    top: 80
    right: 74
    bottom: 82
    left: 74
  hyphenation: soft
  justifyEngine: advanced
  justifyStrategy: auto
footer:
  default:
    elements:
      - type: paragraph
        content: "VMPRINT REPORT / {pageNumber}"
        properties:
          style:
            textAlign: center
            fontFamily: Carlito
            fontSize: 8.6
            color: "#7a8694"
            letterSpacing: 1.4
            marginTop: 24
styles:
  heading-1:
    fontFamily: Caladea
    fontSize: 30
    lineHeight: 1.12
    color: "#1f2430"
    textAlign: center
    hyphenation: "off"
    marginTop: 20
    marginBottom: 10
    keepWithNext: true
  subheading:
    fontFamily: Carlito
    fontSize: 9.5
    lineHeight: 1.3
    color: "#6f8090"
    letterSpacing: 1.7
    textAlign: center
    marginTop: -2
    marginBottom: 26
    keepWithNext: true
  heading-2:
    fontFamily: Carlito
    fontSize: 13
    fontWeight: 700
    color: "#1f4b6e"
    hyphenation: "off"
    borderBottomWidth: 0.8
    borderBottomColor: "#cfd6de"
    paddingBottom: 2.5
    marginTop: 18
    marginBottom: 11
    keepWithNext: true
  heading-3:
    fontFamily: Carlito
    fontSize: 11.1
    fontWeight: 700
    color: "#7d6750"
    hyphenation: "off"
    letterSpacing: 0.2
    marginTop: 10
    marginBottom: 7
    keepWithNext: true
  paragraph:
    textAlign: left
    hyphenation: soft
    lineHeight: 1.68
    color: "#2b313c"
    marginBottom: 11.5
  unordered-list:
    color: "#2b313c"
  ordered-list:
    color: "#2b313c"
  list-item:
    color: "#2b313c"
  inline-code:
    fontFamily: Cousine
    fontSize: 9.6
    color: "#214664"
    backgroundColor: "#edf3f7"
    borderRadius: 2
  code-block:
    fontFamily: Cousine
    fontSize: 9.5
    lineHeight: 1.38
    allowLineSplit: true
    overflowPolicy: clip
    color: "#22303f"
    backgroundColor: "#f4f7fa"
    borderWidth: 0.8
    borderColor: "#d7dee6"
    borderRadius: 3
    paddingTop: 8
    paddingBottom: 8
    paddingLeft: 11
    paddingRight: 11
    marginTop: 2
    marginBottom: 14
  blockquote:
    textAlign: left
    hyphenation: "off"
    fontFamily: Caladea
    fontStyle: italic
    fontSize: 12.5
    lineHeight: 1.55
    color: "#233244"
    backgroundColor: "#f5f7f8"
    borderLeftWidth: 2.2
    borderLeftColor: "#b79a6a"
    paddingLeft: 16
    paddingRight: 14
    paddingTop: 7
    paddingBottom: 7
    marginTop: 4
    marginBottom: 16
  blockquote-attribution:
    textAlign: right
    fontFamily: Carlito
    fontSize: 9.4
    color: "#7c8791"
    marginTop: 3
    marginBottom: 8
  thematic-break:
    width: 148
    marginLeft: 0
    borderTopWidth: 0.75
    borderTopColor: "#c7b697"
    marginTop: 18
    marginBottom: 22
  definition-term:
    fontWeight: 700
    color: "#1f4b6e"
    keepWithNext: true
    marginTop: 0
    marginBottom: 2
  definition-desc:
    paddingLeft: 15
    marginBottom: 9
  table-cell:
    fontFamily: Carlito
    paddingTop: 5.5
    paddingBottom: 5.5
    paddingLeft: 6
    paddingRight: 6
    borderWidth: 0.6
    borderColor: "#c7d0d9"
`,

    'blueprint': `
layout:
  fontFamily: Carlito
  fontSize: 11.2
  lineHeight: 1.66
  pageSize: A4
  pageBackground: "#f5efdf"
  margins:
    top: 82
    right: 72
    bottom: 84
    left: 72
  hyphenation: soft
  justifyEngine: advanced
  justifyStrategy: auto
footer:
  default:
    elements:
      - type: paragraph
        content: "{pageNumber}"
        properties:
          style:
            textAlign: center
            fontFamily: Carlito
            fontSize: 8.8
            color: "#907a61"
            letterSpacing: 1.6
            marginTop: 24
styles:
  heading-1:
    fontFamily: Caladea
    fontSize: 29
    lineHeight: 1.14
    color: "#2b221b"
    textAlign: center
    hyphenation: "off"
    marginTop: 18
    marginBottom: 10
    keepWithNext: true
  subheading:
    fontFamily: Carlito
    fontSize: 9.6
    lineHeight: 1.3
    color: "#6e8392"
    letterSpacing: 1.8
    textAlign: center
    marginTop: -2
    marginBottom: 28
    keepWithNext: true
  heading-2:
    fontFamily: Carlito
    fontSize: 12.2
    fontWeight: 700
    color: "#47657b"
    hyphenation: "off"
    letterSpacing: 0.8
    marginTop: 16
    marginBottom: 9
    keepWithNext: true
  heading-3:
    fontFamily: Caladea
    fontSize: 12
    fontStyle: italic
    color: "#7b5a3d"
    hyphenation: "off"
    marginTop: 10
    marginBottom: 6
    keepWithNext: true
  paragraph:
    textAlign: justify
    hyphenation: soft
    lineHeight: 1.68
    color: "#33281f"
    marginBottom: 11.5
  unordered-list:
    color: "#33281f"
  ordered-list:
    color: "#33281f"
  list-item:
    color: "#33281f"
  inline-code:
    fontFamily: Cousine
    fontSize: 9.6
    color: "#1f485c"
    backgroundColor: "#e7edf0"
    borderRadius: 2
  code-block:
    fontFamily: Cousine
    fontSize: 9.5
    lineHeight: 1.38
    allowLineSplit: true
    overflowPolicy: clip
    color: "#203341"
    backgroundColor: "#edf1f2"
    borderWidth: 0.8
    borderColor: "#c6d0d5"
    borderRadius: 3
    paddingTop: 8
    paddingBottom: 8
    paddingLeft: 11
    paddingRight: 11
    marginTop: 2
    marginBottom: 14
  blockquote:
    textAlign: left
    hyphenation: "off"
    fontFamily: Caladea
    fontStyle: italic
    fontSize: 12.3
    lineHeight: 1.54
    color: "#2e261f"
    backgroundColor: "#fbf7ee"
    borderLeftWidth: 2
    borderLeftColor: "#9eb4c2"
    paddingLeft: 16
    paddingRight: 14
    paddingTop: 7
    paddingBottom: 7
    marginTop: 4
    marginBottom: 16
  blockquote-attribution:
    textAlign: right
    fontFamily: Carlito
    fontSize: 9.4
    color: "#7f7566"
    marginTop: 3
    marginBottom: 8
  thematic-break:
    width: 160
    marginLeft: 0
    borderTopWidth: 0.7
    borderTopColor: "#c7b69a"
    marginTop: 18
    marginBottom: 22
  definition-term:
    fontWeight: 700
    color: "#47657b"
    keepWithNext: true
    marginTop: 0
    marginBottom: 2
  definition-desc:
    paddingLeft: 15
    marginBottom: 9
  table-cell:
    fontFamily: Carlito
    paddingTop: 5
    paddingBottom: 5
    paddingLeft: 6
    paddingRight: 6
    borderWidth: 0.55
    borderColor: "#c2b59f"
`,

    'open-source': `
layout:
  fontFamily: Carlito
  fontSize: 11.1
  lineHeight: 1.68
  pageSize: A4
  margins:
    top: 84
    right: 76
    bottom: 86
    left: 76
  hyphenation: soft
  justifyEngine: advanced
  justifyStrategy: auto
styles:
  heading-1:
    fontFamily: Caladea
    fontSize: 27
    lineHeight: 1.2
    color: "#101622"
    marginTop: 26.2
    marginBottom: 22
    hyphenation: "off"
    textAlign: center
    keepWithNext: true
  subheading:
    fontFamily: Carlito
    fontSize: 10.2
    lineHeight: 1.36
    color: "#6f7785"
    letterSpacing: 0.9
    textAlign: center
    marginTop: -8
    marginBottom: 28
    keepWithNext: true
  heading-2:
    fontFamily: Carlito
    fontSize: 12
    fontWeight: 700
    color: "#2f3d52"
    marginTop: 18.2
    marginBottom: 12
    hyphenation: "off"
    textAlign: left
  heading-3:
    fontFamily: Carlito
    fontSize: 10.8
    fontWeight: 700
    color: "#506079"
    marginTop: 8.2
    marginBottom: 8
    hyphenation: "off"
    textAlign: left
  paragraph:
    textAlign: left
    hyphenation: soft
    lineHeight: 1.7
    marginBottom: 11.8
  inline-code:
    fontFamily: Cousine
    fontSize: 9.6
    color: "#1f3550"
    backgroundColor: "#f0f3f8"
    borderRadius: 2
  code-block:
    fontFamily: Cousine
    fontSize: 9.7
    lineHeight: 1.36
    allowLineSplit: true
    overflowPolicy: clip
    color: "#1f2937"
    backgroundColor: "#f8fafc"
    borderWidth: 0.8
    borderColor: "#d7deea"
    borderRadius: 4
    paddingTop: 8
    paddingBottom: 8
    paddingLeft: 11
    paddingRight: 11
    marginTop: 0
    marginBottom: 14
  blockquote:
    textAlign: left
    hyphenation: "off"
    fontFamily: Caladea
    fontStyle: italic
    fontSize: 12
    lineHeight: 1.56
    color: "#2a3344"
    paddingLeft: 18
    paddingRight: 18
    borderLeftWidth: 0
    backgroundColor: "#ffffff"
    marginTop: 2.2
    marginBottom: 16
  blockquote-attribution:
    textAlign: right
    fontStyle: normal
    fontFamily: Carlito
    fontSize: 9.8
    color: "#677185"
    marginTop: 3
    marginBottom: 10
  thematic-break:
    width: 132
    marginLeft: 0
    borderTopWidth: 0.45
    borderTopColor: "#aeb9ca"
    opacity: 0.9
    marginTop: 16.2
    marginBottom: 24
  definition-term:
    fontWeight: 700
    color: "#2f3d52"
    keepWithNext: true
    marginTop: 0
    marginBottom: 2
  definition-desc:
    paddingLeft: 14
    marginBottom: 8
  table-cell:
    fontFamily: Carlito
    paddingTop: 5
    paddingBottom: 5
    paddingLeft: 6
    paddingRight: 6
    borderWidth: 0.6
    borderColor: "#bfc9d8"
`,

    'novel': `
layout:
  fontFamily: Caladea
  fontSize: 11.8
  lineHeight: 1.5
  pageSize:
    width: 432
    height: 648
  margins:
    top: 72
    right: 64
    bottom: 68
    left: 64
  hyphenation: auto
  justifyEngine: advanced
  justifyStrategy: auto
footer:
  default:
    elements:
      - type: paragraph
        content: "\\u2014 {pageNumber} \\u2014"
        properties:
          style:
            textAlign: center
            fontSize: 9
            color: "#8a7d6e"
            fontFamily: Caladea
            marginTop: 31
styles:
  heading-1:
    fontSize: 22
    lineHeight: 1.25
    textAlign: center
    fontStyle: italic
    hyphenation: "off"
    marginTop: 54
    marginBottom: 34
    letterSpacing: 0.4
    keepWithNext: true
  heading-2:
    fontSize: 10.4
    lineHeight: 1.3
    textAlign: center
    fontWeight: 400
    hyphenation: "off"
    letterSpacing: 2.4
    marginTop: 22
    marginBottom: 18
    keepWithNext: true
  heading-3:
    fontSize: 11.8
    fontStyle: italic
    textAlign: left
    hyphenation: "off"
    marginTop: 12
    marginBottom: 6
    keepWithNext: true
  paragraph:
    textAlign: justify
    hyphenation: auto
    lineHeight: 1.5
    textIndent: 18
    marginBottom: 0
  inline-code:
    fontFamily: Caladea
    fontStyle: italic
    color: "#2a2218"
    backgroundColor: "#ffffff"
  code-block:
    fontFamily: Cousine
    fontSize: 9.6
    lineHeight: 1.42
    color: "#2a2218"
    backgroundColor: "#f8f5ef"
    borderWidth: 0
    borderRadius: 0
    paddingTop: 10
    paddingBottom: 10
    paddingLeft: 14
    paddingRight: 14
    marginTop: 10
    marginBottom: 10
  blockquote:
    textAlign: left
    hyphenation: "off"
    fontStyle: italic
    fontSize: 11
    lineHeight: 1.52
    color: "#2e2618"
    paddingLeft: 30
    paddingRight: 30
    borderLeftWidth: 0
    marginTop: 12
    marginBottom: 12
  blockquote-attribution:
    textAlign: right
    fontStyle: normal
    fontSize: 9.4
    color: "#7a6e5e"
    marginTop: 3
    marginBottom: 10
  thematic-break:
    width: 48
    marginLeft: 128
    borderTopWidth: 0.5
    borderTopColor: "#c0b09a"
    marginTop: 18
    marginBottom: 18
  table-cell:
    paddingTop: 5
    paddingBottom: 5
    paddingLeft: 6
    paddingRight: 6
    borderWidth: 0.45
    borderColor: "#b0a08a"
`,

    'tutorial': `
layout:
  fontFamily: Carlito
  fontSize: 11.4
  lineHeight: 1.7
  pageSize: A4
  margins:
    top: 86
    right: 74
    bottom: 88
    left: 74
  hyphenation: soft
  justifyEngine: advanced
  justifyStrategy: auto
footer:
  default:
    elements:
      - type: paragraph
        content: "Page {pageNumber}"
        properties:
          style:
            textAlign: center
            fontFamily: Carlito
            fontSize: 8.7
            color: "#8a93a1"
            marginTop: 26
styles:
  heading-1:
    fontFamily: Caladea
    fontSize: 27
    lineHeight: 1.18
    color: "#1c2430"
    textAlign: center
    hyphenation: "off"
    marginTop: 18
    marginBottom: 22
    letterSpacing: 0.2
    keepWithNext: true
  heading-2:
    fontFamily: Carlito
    fontSize: 13.6
    fontWeight: 700
    color: "#1f3f68"
    hyphenation: "off"
    borderBottomWidth: 0.7
    borderBottomColor: "#cad5e5"
    paddingBottom: 2
    marginTop: 20
    marginBottom: 10.5
    keepWithNext: true
  heading-3:
    fontFamily: Carlito
    fontSize: 11.6
    fontWeight: 700
    color: "#2f547f"
    hyphenation: "off"
    marginTop: 9
    marginBottom: 7.5
    keepWithNext: true
  paragraph:
    textAlign: left
    hyphenation: soft
    lineHeight: 1.74
    marginBottom: 11.8
  blockquote:
    textAlign: left
    hyphenation: "off"
    fontFamily: Caladea
    fontStyle: italic
    fontSize: 12.2
    lineHeight: 1.58
    color: "#2a3240"
    backgroundColor: "#f6f8fc"
    borderLeftWidth: 2.2
    borderLeftColor: "#9eacc4"
    paddingLeft: 15
    paddingRight: 11
    paddingTop: 7
    paddingBottom: 7
    marginTop: 4.5
    marginBottom: 15
  blockquote-attribution:
    textAlign: right
    fontFamily: Carlito
    fontSize: 9.6
    color: "#677488"
    marginTop: 2
    marginBottom: 8
  inline-code:
    fontFamily: Cousine
    fontSize: 9.7
    color: "#173657"
    backgroundColor: "#eef3f8"
    borderRadius: 2
  code-block:
    fontFamily: Cousine
    fontSize: 9.9
    lineHeight: 1.39
    allowLineSplit: true
    overflowPolicy: clip
    color: "#172133"
    backgroundColor: "#f2f6fb"
    borderWidth: 1
    borderColor: "#c7d2e3"
    borderRadius: 5
    paddingTop: 10
    paddingBottom: 10
    paddingLeft: 12
    paddingRight: 12
    marginTop: 2
    marginBottom: 15
  table-cell:
    fontFamily: Carlito
    paddingTop: 5.5
    paddingBottom: 5.5
    paddingLeft: 6
    paddingRight: 6
    borderWidth: 0.6
    borderColor: "#c6d0df"
  thematic-break:
    width: 154
    borderTopWidth: 0.8
    borderTopColor: "#9eabc0"
    marginTop: 17
    marginBottom: 21
`,
};

const DEMO_CONFIG = `
images:
  blockStyle:
    marginTop: 4
    marginBottom: 18
  frame:
    mode: "off"

captions:
  style:
    marginTop: 3
    marginBottom: 14
`;

// -- DOM Elements ---------------------------------------------------------

const byId = <T extends HTMLElement>(id: string): T => {
    const el = document.getElementById(id);
    if (!el) throw new Error(`Missing #${id}`);
    return el as T;
};

const markdownInput = byId<HTMLTextAreaElement>('markdown-input');
const styleSelect = byId<HTMLSelectElement>('style-preset');
const pdfButton = byId<HTMLButtonElement>('pdf-button');
const svgButton = byId<HTMLButtonElement>('svg-button');
const copyMarkdownButton = byId<HTMLButtonElement>('copy-markdown-button');
const prevButton = byId<HTMLButtonElement>('prev-button');
const nextButton = byId<HTMLButtonElement>('next-button');
const pagerText = byId<HTMLElement>('pager-text');
const zoomInBtn = byId<HTMLButtonElement>('zoom-in');
const zoomOutBtn = byId<HTMLButtonElement>('zoom-out');
const zoomFitBtn = byId<HTMLButtonElement>('zoom-fit');
const interactionModeBtn = byId<HTMLButtonElement>('interaction-mode');
const zoomText = byId<HTMLElement>('zoom-text');
const statusNode = byId<HTMLElement>('status-bar');
const previewCanvas = byId<HTMLCanvasElement>('preview-canvas');
const renderViewport = byId<HTMLElement>('render-viewport');
const astOutput = byId<HTMLElement>('ast-output');
const fontProgressBar = byId<HTMLElement>('font-progress-bar');
const fontProgressContainer = byId<HTMLElement>('font-progress-container');
const toggleAstBtn = byId<HTMLButtonElement>('toggle-ast-btn');
const closeAstBtn = byId<HTMLButtonElement>('toggle-ast');
const astDrawer = byId<HTMLElement>('ast-drawer');
const saveStatus = byId<HTMLElement>('save-status');
const loader = byId<HTMLElement>('rendering-loader');
previewCanvas.classList.add('canvas-pending');
previewCanvas.style.width = '0px';
previewCanvas.style.height = '0px';

// -- State ----------------------------------------------------------------

let preview: PreviewSession | null = null;
let currentPageIndex = 0;
let zoomLevel = 1.0;
let renderTimer: any = null;
let currentDocumentAst: any = null;
let currentSnapshotPage: PreviewLayoutSnapshotPage | null = null;
const imageCache = new Map<string, ResolvedImage | null>();

// Double Buffering: Off-screen canvas to eliminate flickering
const offscreenCanvas = document.createElement('canvas');

// Dragging state
let isDragging = false;
let startX = 0;
let startY = 0;
let scrollLeftTop = { left: 0, top: 0 };
let interactionMode: 'pan' | 'select' = 'pan';
let selectedSourceId: string | null = null;
let selectedTargetId: string | null = null;
let activeTextSelection: VmprintInteractionSelectionState | null = null;
let dragAnchor: VmprintInteractionSelectionPoint | null = null;
let isSelecting = false;

// -- Render Pipeline ------------------------------------------------------

const MARKDOWN_IMAGE_PATTERN = /!\[[^\]]*?\]\(([^)\s]+)(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\)/g;

const toBase64 = (blob: Blob): Promise<string> =>
    new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const result = typeof reader.result === 'string' ? reader.result : '';
            const comma = result.indexOf(',');
            resolve(comma >= 0 ? result.slice(comma + 1) : result);
        };
        reader.onerror = () => reject(reader.error ?? new Error('Failed to read image blob.'));
        reader.readAsDataURL(blob);
    });

const normalizeImageSrc = (src: string): string => {
    const trimmed = src.trim().replace(/^<|>$/g, '');
    if (!trimmed) return trimmed;
    try {
        const resolved = new URL(trimmed, window.location.href);
        if (resolved.hostname === 'github.com' && resolved.pathname.includes('/blob/')) {
            const parts = resolved.pathname.split('/').filter(Boolean);
            if (parts.length >= 5 && parts[2] === 'blob') {
                const [owner, repo, , branch, ...rest] = parts;
                return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${rest.join('/')}`;
            }
        }
        return resolved.href;
    } catch {
        return trimmed;
    }
};

const extractMarkdownImageSources = (markdown: string): string[] => {
    const out = new Set<string>();
    let match: RegExpExecArray | null;
    while ((match = MARKDOWN_IMAGE_PATTERN.exec(markdown))) {
        const normalized = normalizeImageSrc(match[1] || '');
        if (!normalized || /^data:/i.test(normalized)) continue;
        out.add(normalized);
    }
    return [...out];
};

const fetchResolvedImage = async (src: string): Promise<ResolvedImage | null> => {
    try {
        const response = await fetch(src);
        if (!response.ok) return null;
        const blob = await response.blob();
        const mimeType = blob.type === 'image/png'
            ? 'image/png'
            : blob.type === 'image/jpeg'
                ? 'image/jpeg'
                : null;
        if (!mimeType) return null;
        return {
            data: await toBase64(blob),
            mimeType
        };
    } catch {
        return null;
    }
};

const primeImageCache = async (markdown: string): Promise<void> => {
    const sources = extractMarkdownImageSources(markdown);
    await Promise.all(sources.map(async (src) => {
        if (imageCache.has(src)) return;
        imageCache.set(src, await fetchResolvedImage(src));
    }));
};

const resolveImageFromCache = (src: string): ResolvedImage | null => {
    const normalized = normalizeImageSrc(src);
    return imageCache.get(normalized) ?? null;
};

const onFontProgress = (event: WebFontProgressEvent): void => {
    if (event.phase === 'complete') {
        fontProgressContainer.classList.add('hidden');
    } else {
        fontProgressContainer.classList.remove('hidden');
        if (event.percent) {
            fontProgressBar.style.width = `${event.percent}%`;
        }
    }
    statusNode.textContent = `Syncing fonts: ${event.phase}...`;
};

const updateUI = (): void => {
    if (!preview) return;
    const pageCount = preview.getPageCount();
    const { width, height } = preview.getPageSize();
    pagerText.textContent = `Page ${currentPageIndex + 1} of ${pageCount}`;
    prevButton.disabled = currentPageIndex <= 0;
    nextButton.disabled = currentPageIndex >= pageCount - 1;
    zoomText.textContent = `${Math.round(zoomLevel * 100)}%`;
    
    previewCanvas.style.width = `${width * zoomLevel}px`;
    previewCanvas.style.height = `${height * zoomLevel}px`;
};

const normalizeSelectedSourceId = (value: string | null | undefined): string | null => {
    const normalized = String(value || '').replace(/^gen:/, '').replace(/^author:/, '');
    return normalized || null;
};

const paintVisibleCanvas = (): void => {
    const ctx = previewCanvas.getContext('2d');
    if (!ctx) return;
    if (previewCanvas.width !== offscreenCanvas.width || previewCanvas.height !== offscreenCanvas.height) {
        previewCanvas.width = offscreenCanvas.width;
        previewCanvas.height = offscreenCanvas.height;
    }
    ctx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
    ctx.drawImage(offscreenCanvas, 0, 0);
    if (interactionMode === 'select' && currentSnapshotPage && preview) {
        const scale = (previewCanvas.width || 1) / Math.max(1, currentSnapshotPage.width);
        const overlay = preview.buildPageInteractionOverlay(currentPageIndex, activeTextSelection, selectedTargetId);
        if (overlay) {
            ctx.save();
            ctx.setTransform(scale, 0, 0, scale, 0, 0);
            ctx.strokeStyle = '#60a5fa';
            ctx.lineWidth = 3;
            ctx.strokeRect(overlay.frameRect.x - 2, overlay.frameRect.y - 2, overlay.frameRect.w + 4, overlay.frameRect.h + 4);
            ctx.setLineDash([6, 4]);
            ctx.strokeStyle = '#c084fc';
            ctx.lineWidth = 1.5;
            ctx.strokeRect(overlay.frameRect.x - 5, overlay.frameRect.y - 5, overlay.frameRect.w + 10, overlay.frameRect.h + 10);

            if (overlay.selectionRects.length > 0) {
                ctx.fillStyle = 'rgba(96, 165, 250, 0.24)';
                for (const rect of overlay.selectionRects) {
                    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
                }
            }

            if (overlay.caretRect) {
                ctx.setLineDash([]);
                ctx.strokeStyle = '#f8fafc';
                ctx.lineWidth = 1.5;
                ctx.beginPath();
                ctx.moveTo(overlay.caretRect.x, overlay.caretRect.y0);
                ctx.lineTo(overlay.caretRect.x, overlay.caretRect.y1);
                ctx.stroke();
            }
            ctx.restore();
        }
    }
};

const updateInteractionButton = (): void => {
    interactionModeBtn.textContent = interactionMode === 'pan' ? 'Pan' : 'Select';
};

const copyCurrentSelectionAsMarkdown = async (): Promise<boolean> => {
    if (!preview || !activeTextSelection) return false;
    const selectedMarkdown = preview.getPageInteractionSelectionMarkdown(currentPageIndex, activeTextSelection);
    if (!selectedMarkdown) return false;
    try {
        await navigator.clipboard.writeText(selectedMarkdown);
        statusNode.textContent = `Copied ${selectedMarkdown.length} markdown characters from the current selection.`;
        return true;
    } catch (error) {
        console.error(error);
        statusNode.textContent = 'Markdown copy failed. Clipboard access was denied.';
        return false;
    }
};

const eventToPagePoint = (event: MouseEvent): { x: number; y: number } => {
    const rect = previewCanvas.getBoundingClientRect();
    const canvasX = ((event.clientX - rect.left) / Math.max(1, rect.width)) * previewCanvas.width;
    const canvasY = ((event.clientY - rect.top) / Math.max(1, rect.height)) * previewCanvas.height;
    return {
        x: (canvasX / Math.max(1, previewCanvas.width)) * (currentSnapshotPage?.width || 1),
        y: (canvasY / Math.max(1, previewCanvas.height)) * (currentSnapshotPage?.height || 1)
    };
};

const renderCurrentPage = async (): Promise<void> => {
    if (!preview) return;
    loader.classList.remove('hidden');
    try {
        currentSnapshotPage = preview.getLayoutSnapshotPages()[currentPageIndex] || null;
        await preview.renderPageToCanvas(currentPageIndex, offscreenCanvas, {
            scale: 2, 
            dpi: 144,
            clear: true,
            backgroundColor: '#ffffff'
        });

        requestAnimationFrame(() => {
            updateUI();
            
            if (previewCanvas.width !== offscreenCanvas.width || previewCanvas.height !== offscreenCanvas.height) {
                previewCanvas.width = offscreenCanvas.width;
                previewCanvas.height = offscreenCanvas.height;
            }

            paintVisibleCanvas();

            previewCanvas.classList.remove('canvas-pending');
        });
    } finally {
        loader.classList.add('hidden');
    }
};

const processRender = async (resetZoom = false): Promise<void> => {
    saveStatus.textContent = 'Updating...';
    try {
        const markdown = markdownInput.value;
        const themeKey = styleSelect.value;
        const theme = THEMES[themeKey];

        await primeImageCache(markdown);

        const docAst = transmute(markdown, {
            theme,
            config: DEMO_CONFIG,
            resolveImage: resolveImageFromCache
        });
        
        currentDocumentAst = docAst;
        selectedSourceId = null;
        selectedTargetId = null;
        activeTextSelection = null;
        dragAnchor = null;
        astOutput.textContent = JSON.stringify(docAst, null, 2);

        if (!preview) {
          preview = await createVMPrintPreview(docAst, { onFontProgress });
        } else {
          await preview.updateDocument(docAst);
        }

        const maxPage = preview.getPageCount() - 1;
        if (currentPageIndex > maxPage) currentPageIndex = maxPage;

        if (resetZoom) {
            handleFitZoom();
        }

        await renderCurrentPage();
        saveStatus.textContent = 'Rendered';
        statusNode.textContent = `Document settled across ${preview.getPageCount()} pages.`;
    } catch (err) {
        console.error(err);
        saveStatus.textContent = 'Error';
        statusNode.textContent = `Render failed: ${String(err)}`;
    }
};

const scheduleRender = (): void => {
    saveStatus.textContent = 'Typing...';
    if (renderTimer) clearTimeout(renderTimer);
    renderTimer = setTimeout(processRender, 600);
};

// -- Interaction Handlers -------------------------------------------------

const handleFitZoom = (): void => {
    if (!preview) return;
    const { width: pageWidth, height: pageHeight } = preview.getPageSize();
    
    const viewportStyle = window.getComputedStyle(renderViewport);
    const px = parseFloat(viewportStyle.paddingLeft) + parseFloat(viewportStyle.paddingRight);
    const py = parseFloat(viewportStyle.paddingTop) + parseFloat(viewportStyle.paddingBottom);
    
    const usableW = renderViewport.clientWidth - px;
    const usableH = renderViewport.clientHeight - py;
    
    if (usableW <= 0 || usableH <= 0) return;

    zoomLevel = Math.min(usableW / pageWidth, usableH / pageHeight) * 0.99;
    updateUI();
    
    requestAnimationFrame(() => {
        renderViewport.scrollTop = 0;
        renderViewport.scrollLeft = (renderViewport.scrollWidth - renderViewport.clientWidth) / 2;
    });
};

markdownInput.addEventListener('input', scheduleRender);
styleSelect.addEventListener('change', () => void processRender(true));

prevButton.addEventListener('click', () => {
    if (currentPageIndex > 0) {
        currentPageIndex--;
        void renderCurrentPage();
    }
});

nextButton.addEventListener('click', () => {
    if (preview && currentPageIndex < preview.getPageCount() - 1) {
        currentPageIndex++;
        void renderCurrentPage();
    }
});

zoomInBtn.addEventListener('click', () => {
    zoomLevel = Math.min(4.0, zoomLevel + 0.1);
    updateUI();
});

zoomOutBtn.addEventListener('click', () => {
    zoomLevel = Math.max(0.1, zoomLevel - 0.1);
    updateUI();
});

zoomFitBtn.addEventListener('click', handleFitZoom);

pdfButton.addEventListener('click', async () => {
    if (!preview) return;
    const bytes = await preview.exportPdf();
    const blob = new Blob([bytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
    statusNode.textContent = 'PDF export complete.';
});

svgButton.addEventListener('click', async () => {
    if (!preview) return;
    const svg = await preview.exportSvgPage(currentPageIndex, { textMode: 'text' });
    const blob = new Blob([svg], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
    statusNode.textContent = 'SVG export complete.';
});

copyMarkdownButton.addEventListener('click', () => {
    void copyCurrentSelectionAsMarkdown();
});

toggleAstBtn.addEventListener('click', () => astDrawer.classList.toggle('collapsed'));
closeAstBtn.addEventListener('click', () => astDrawer.classList.add('collapsed'));

interactionModeBtn.addEventListener('click', () => {
    interactionMode = interactionMode === 'pan' ? 'select' : 'pan';
    isDragging = false;
    isSelecting = false;
    dragAnchor = null;
    renderViewport.classList.toggle('grab-cursor', interactionMode === 'pan');
    previewCanvas.style.cursor = interactionMode === 'pan' ? 'grab' : 'default';
    updateInteractionButton();
    paintVisibleCanvas();
    statusNode.textContent = interactionMode === 'pan'
        ? 'Pan mode enabled.'
        : 'Selection mode enabled. Click or drag across text.';
});

previewCanvas.addEventListener('mousemove', (event) => {
    if (interactionMode !== 'select' || !preview) return;
    const point = eventToPagePoint(event);
    const hit = preview.hitTestPageInteraction(currentPageIndex, point.x, point.y);
    previewCanvas.style.cursor = hit ? (hit.selectableText ? 'text' : 'pointer') : 'default';

    if (!isSelecting || !dragAnchor) return;
    activeTextSelection = preview.resolvePageSelection(
        currentPageIndex,
        dragAnchor,
        point,
        event.altKey ? 'spatial' : 'continuous'
    );
    paintVisibleCanvas();
});

previewCanvas.addEventListener('mousedown', (event) => {
    if (event.button !== 0 || interactionMode !== 'select' || !preview) return;
    const point = eventToPagePoint(event);
    const target = preview.hitTestPageInteraction(currentPageIndex, point.x, point.y);
    isSelecting = true;
    selectedSourceId = normalizeSelectedSourceId(target?.sourceId || '');
    selectedTargetId = target?.targetId || null;
    if (target) {
        dragAnchor = preview.createPageSelectionPoint(currentPageIndex, point.x, point.y);
        activeTextSelection = dragAnchor
            ? preview.resolvePageSelection(currentPageIndex, dragAnchor, point, 'continuous')
            : null;
        statusNode.textContent = `Selected ${target.sourceId}.`;
    } else {
        dragAnchor = null;
        activeTextSelection = null;
    }
    paintVisibleCanvas();
});

// -- Panning (Drag to Scroll) -------------------------------------------

renderViewport.addEventListener('mousedown', (e) => {
    if (e.button !== 0 || interactionMode !== 'pan') return;
    isDragging = true;
    startX = e.pageX - renderViewport.offsetLeft;
    startY = e.pageY - renderViewport.offsetTop;
    scrollLeftTop = { 
        left: renderViewport.scrollLeft, 
        top: renderViewport.scrollTop 
    };
});

window.addEventListener('mousemove', (e) => {
    if (interactionMode !== 'pan') return;
    if (!isDragging) return;
    e.preventDefault();
    const x = e.pageX - renderViewport.offsetLeft;
    const y = e.pageY - renderViewport.offsetTop;
    const walkX = (x - startX) * 1.5; 
    const walkY = (y - startY) * 1.5;
    renderViewport.scrollLeft = scrollLeftTop.left - walkX;
    renderViewport.scrollTop = scrollLeftTop.top - walkY;
});

window.addEventListener('mouseup', () => {
    isDragging = false;
    isSelecting = false;
    dragAnchor = null;
});

window.addEventListener('keydown', async (event) => {
    const isMarkdownCopyShortcut = (event.ctrlKey || event.metaKey) && event.shiftKey && !event.altKey && event.key.toLowerCase() === 'c';
    if (isMarkdownCopyShortcut) {
        event.preventDefault();
        await copyCurrentSelectionAsMarkdown();
        return;
    }

    const isCopyShortcut = (event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'c';
    if (!isCopyShortcut || !preview || !activeTextSelection) return;

    const selectedText = preview.getPageInteractionSelectionText(currentPageIndex, activeTextSelection);
    const selectedMarkdown = preview.getPageInteractionSelectionMarkdown(currentPageIndex, activeTextSelection);
    if (!selectedText) return;

    event.preventDefault();
    try {
        if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
            try {
                const item = new ClipboardItem({
                    'text/plain': new Blob([selectedText], { type: 'text/plain' }),
                    'text/markdown': new Blob([selectedMarkdown || selectedText], { type: 'text/markdown' })
                });
                await navigator.clipboard.write([item]);
            } catch {
                await navigator.clipboard.writeText(selectedText);
            }
        } else {
            await navigator.clipboard.writeText(selectedText);
        }
        statusNode.textContent = `Copied ${selectedText.length} characters from the current selection.`;
    } catch (error) {
        console.error(error);
        statusNode.textContent = 'Copy failed. Clipboard access was denied.';
    }
});

// -- Init -----------------------------------------------------------------

markdownInput.value = DEFAULT_MARKDOWN;
updateInteractionButton();
void processRender(true);
window.addEventListener('resize', handleFitZoom);
