import { createVMPrintPreview, type PreviewSession, type WebFontProgressEvent } from '@vmprint/preview';
import { transmute } from '@vmprint/mkd-mkd';

// -- Constants & Types ----------------------------------------------------

const DEFAULT_MARKDOWN = `# VMPrint: High-Fidelity Document Engineering

> Stop fighting with "Print-to-PDF" and start building professional documents.

For too long, developers have been forced to choose between impossible manual layouting with libraries like jsPDF, "fake" print-to-image workarounds, or massive components like react-pdf that lock you into a single framework. VMPrint is a professional alternative that brings desktop-publishing-grade layout directly to your application—browser, server, or edge.

### The Infinite Pain of Web-to-PDF
- **jsPDF**: Manually calculating X/Y coordinates for every line is impossible for complex documents.
- **Headless Browsers**: Puppeteer and Chromium are huge dependencies (170MB+), slow to start, and prone to "layout drift" where your PDF font spacing or page breaks never match the screen.
- **react-pdf**: Powerful but tied strictly to React, making it heavy and inflexible for modern multi-environment apps.

---

### A New Standard in Quality
Powered by a patent-pending spatial-temporal settlement approach, VMPrint ensures that what you see on this preview canvas is exactly what you get in the final PDF.

1. **Desktop Publishing Grade**: Every element respects vertical rhythm and precise baseline alignment. It produces documents that look like they were made in InDesign, not a web browser.
2. **Extreme Speed**: Render 300+ pages of complex technical manuals in under 2 seconds—even on a battery-powered laptop.
3. **JIT Font Loading**: Supply your own OpenType fonts for absolutely perfect typography and 100% brand consistency.
4. **Zero Dependencies**: No browser required. No React required. Tiny footprint (~1.7MB) allows it to run seamlessly on Edge functions.

---

### Simple to Implement

Building a high-fidelity preview like the one you see here takes only a few lines of code:

\`\`\`typescript
import { createVMPrintPreview } from '@vmprint/preview';

// Initialize the engine with your document AST
const preview = await createVMPrintPreview(docAst, { 
    onFontProgress: (e) => updateProgressbar(e)
});

// Render any page to a standard HTML5 canvas
await preview.renderPageToCanvas(0, myCanvas);
\`\`\`

You can add @vmprint/mkd-mkd to immediately render Markdown with professional styles:

\`\`\`typescript
import { transmute } from '@vmprint/mkd-mkd';

// Convert markdown to high-fidelity AST
const docAst = transmute(markdownText, { 
    styles: myStylePreset,
    layout: { pageSize: 'LETTER' }
});

// Pass this to the preview session
await preview.updateDocument(docAst);
\`\`\`

---
*Powered by @vmprint/preview*
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
