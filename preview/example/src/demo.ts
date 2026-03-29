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

const PRESETS: Record<string, any> = {
    financial: {
        layout: {
            pageSize: 'LETTER',
            margins: { top: 72, right: 72, bottom: 72, left: 72 },
            fontFamily: 'Arimo',
            fontSize: 11,
            lineHeight: 1.4
        },
        styles: {
            'heading-1': { fontSize: 26, fontWeight: 'bold', marginBottom: 16, color: '#10b981' },
            'heading-2': { fontSize: 18, fontWeight: 'bold', marginTop: 20, marginBottom: 12, borderBottomWidth: 1, borderBottomColor: '#d1d5db' },
            'paragraph': { marginBottom: 12, textAlign: 'justify' },
            'blockquote': { borderLeftWidth: 4, borderLeftColor: '#10b981', paddingLeft: 16, fontStyle: 'italic', marginBottom: 16 }
        }
    },
    manuscript: {
        layout: {
            pageSize: 'A5',
            margins: { top: 80, right: 80, bottom: 80, left: 80 },
            fontFamily: 'Tinos',
            fontSize: 12,
            lineHeight: 1.6
        },
        styles: {
            'heading-1': { fontSize: 32, textAlign: 'center', marginTop: 100, marginBottom: 60 },
            'heading-2': { fontSize: 18, textAlign: 'center', marginTop: 40, marginBottom: 20 },
            'paragraph': { textIndent: 20, marginBottom: 0 }
        }
    },
    newsletter: {
        layout: {
            pageSize: 'LETTER',
            columnCount: 2,
            columnGutter: 24,
            margins: { top: 54, right: 54, bottom: 54, left: 54 },
            fontFamily: 'Arimo',
            fontSize: 10,
            lineHeight: 1.3
        },
        styles: {
            'heading-1': { fontSize: 36, fontWeight: 800, color: '#0f172a', marginBottom: 24, columns: 1 },
            'heading-2': { fontSize: 14, fontWeight: 700, textTransform: 'uppercase', color: '#10b981', marginTop: 12, marginBottom: 8 },
            'paragraph': { marginBottom: 8, textAlign: 'left' }
        }
    },
    minimal: {
        layout: {
            pageSize: 'A4',
            margins: { top: 120, right: 120, bottom: 120, left: 120 },
            fontFamily: 'Inter',
            fontSize: 11,
            lineHeight: 1.5
        },
        styles: {
            'heading-1': { fontSize: 24, fontWeight: 400, color: '#000', marginBottom: 40 },
            'paragraph': { marginBottom: 20, color: '#444' }
        }
    }
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
        const presetKey = styleSelect.value;
        const preset = PRESETS[presetKey] || PRESETS.financial;
        
        const docAst = transmute(markdown, {
            styles: preset.styles,
            layout: preset.layout
        });
        
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
