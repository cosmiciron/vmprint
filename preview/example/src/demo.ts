import { createVMPrintPreview, type PreviewSession, type WebFontProgressEvent } from '@vmprint/preview';
import { transmute } from '@vmprint/mkd-mkd';

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
const prevButton = byId<HTMLButtonElement>('prev-button');
const nextButton = byId<HTMLButtonElement>('next-button');
const pagerText = byId<HTMLElement>('pager-text');
const zoomInBtn = byId<HTMLButtonElement>('zoom-in');
const zoomOutBtn = byId<HTMLButtonElement>('zoom-out');
const zoomFitBtn = byId<HTMLButtonElement>('zoom-fit');
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

// -- State ----------------------------------------------------------------

let preview: PreviewSession | null = null;
let currentPageIndex = 0;
let zoomLevel = 1.0;
let renderTimer: any = null;
let currentDocumentAst: any = null;

// Double Buffering: Off-screen canvas to eliminate flickering
const offscreenCanvas = document.createElement('canvas');

// Dragging state
let isDragging = false;
let startX = 0;
let startY = 0;
let scrollLeftTop = { left: 0, top: 0 };

// -- Render Pipeline ------------------------------------------------------

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

const renderCurrentPage = async (): Promise<void> => {
    if (!preview) return;
    loader.classList.remove('hidden');
    try {
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
            
            const ctx = previewCanvas.getContext('2d');
            if (ctx) {
                ctx.drawImage(offscreenCanvas, 0, 0);
            }
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

        const docAst = transmute(markdown, { theme });
        
        currentDocumentAst = docAst;
        astOutput.textContent = JSON.stringify(docAst, null, 2);

        if (!preview) {
          preview = await createVMPrintPreview(docAst, { onFontProgress });
        } else {
          await preview.updateDocument(docAst);
        }

        const maxPage = preview.getPageCount() - 1;
        if (currentPageIndex > maxPage) currentPageIndex = maxPage;
        
        await renderCurrentPage();
        if (resetZoom) {
            handleFitZoom();
        }
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

    zoomLevel = Math.min(usableW / pageWidth, usableH / pageHeight) * 0.96;
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

toggleAstBtn.addEventListener('click', () => astDrawer.classList.toggle('collapsed'));
closeAstBtn.addEventListener('click', () => astDrawer.classList.add('collapsed'));

// -- Panning (Drag to Scroll) -------------------------------------------

renderViewport.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    isDragging = true;
    startX = e.pageX - renderViewport.offsetLeft;
    startY = e.pageY - renderViewport.offsetTop;
    scrollLeftTop = { 
        left: renderViewport.scrollLeft, 
        top: renderViewport.scrollTop 
    };
});

window.addEventListener('mousemove', (e) => {
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
});

// -- Init -----------------------------------------------------------------

markdownInput.value = DEFAULT_MARKDOWN;
void processRender(true);
window.addEventListener('resize', handleFitZoom);
