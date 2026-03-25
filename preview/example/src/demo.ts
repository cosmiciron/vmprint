import { createVMPrintPreview, type PreviewSession, type WebFontProgressEvent } from '@vmprint/preview';

const SAMPLE_DOCUMENT = {
    documentVersion: '1.1',
    layout: {
        pageSize: 'LETTER',
        margins: { top: 54, right: 54, bottom: 54, left: 54 },
        fontFamily: 'Arimo',
        fontSize: 11,
        lineHeight: 1.4
    },
    fonts: {
        regular: 'Arimo'
    },
    styles: {
        title: {
            fontSize: 26,
            fontWeight: 'bold',
            marginBottom: 16,
            keepWithNext: true
        },
        dek: {
            fontSize: 13,
            marginBottom: 18
        },
        body: {
            marginBottom: 12,
            textAlign: 'justify'
        }
    },
    elements: [
        {
            type: 'title',
            content: 'VMPrint Preview'
        },
        {
            type: 'dek',
            content: 'This standalone sample lives inside the preview package and uses the VMPrint-native preview pipeline with a hosted fallback font registry.'
        },
        {
            type: 'body',
            content: 'The point of this example is to keep the surface small. Paste VMPrint AST JSON into the editor, click Render, and the package will create a preview session that paints into the canvas you provided.'
        },
        {
            type: 'body',
            content: 'Because this sample uses the built-in preview font aliases and hosted fallback repo, auto mode renders immediately without forcing you to manage a second font object.'
        },
        {
            type: 'body',
            content: 'If you later want tighter control, you can point the preview session at your own font catalog, your own repository, or explicit font URLs and data URIs.'
        }
    ]
};

const byId = <T extends HTMLElement>(id: string): T => {
    const element = document.getElementById(id);
    if (!element) {
        throw new Error(`Missing required element: #${id}`);
    }
    return element as T;
};

const prettyJson = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

const astInput = byId<HTMLTextAreaElement>('ast-input');
const renderButton = byId<HTMLButtonElement>('render-button');
const pdfButton = byId<HTMLButtonElement>('pdf-button');
const svgButton = byId<HTMLButtonElement>('svg-button');
const prevButton = byId<HTMLButtonElement>('prev-button');
const nextButton = byId<HTMLButtonElement>('next-button');
const statusNode = byId<HTMLElement>('status');
const pagerNode = byId<HTMLElement>('pager');
const previewCanvas = byId<HTMLCanvasElement>('preview-canvas');

astInput.value = prettyJson(SAMPLE_DOCUMENT);

let preview: PreviewSession | null = null;
let currentPageIndex = 0;

// -- Font progress tracking -----------------------------------------------

interface FontTrack {
    phase: WebFontProgressEvent['phase'];
    loadedBytes: number;
    totalBytes?: number;
    name: string;
    fromCache: boolean;
}

const fontTracks = new Map<string, FontTrack>();
let fontStatusDirty = false;

const shortFontName = (src: string): string => {
    try { return new URL(src).pathname.split('/').pop() ?? src; } catch { return src.split('/').pop() ?? src; }
};

const updateFontStatus = (): void => {
    const tracks = Array.from(fontTracks.values());
    const total = tracks.length;
    const cacheHits = tracks.filter((t) => t.fromCache).length;
    const done = tracks.filter((t) => t.phase === 'complete' || t.phase === 'cache-hit').length;
    const active = tracks.filter((t) => t.phase === 'downloading' || t.phase === 'finalizing' || t.phase === 'caching');

    if (active.length > 0) {
        const names = active.slice(0, 2).map((t) => t.name).join(', ');
        const cached = cacheHits > 0 ? `, ${cacheHits} from cache` : '';
        setStatus(`Fonts: ${done}/${total} done${cached} — downloading ${names}…`);
    } else if (done < total) {
        setStatus(`Fonts: ${done}/${total} loaded…`);
    }
};

const onFontProgress = (event: WebFontProgressEvent): void => {
    const name = shortFontName(event.src);
    const fromCache = event.phase === 'cache-hit' || (fontTracks.get(event.resolvedSrc)?.fromCache ?? false);
    fontTracks.set(event.resolvedSrc, { phase: event.phase, loadedBytes: event.loadedBytes, totalBytes: event.totalBytes, name, fromCache });
    if (!fontStatusDirty) {
        fontStatusDirty = true;
        requestAnimationFrame(() => {
            fontStatusDirty = false;
            updateFontStatus();
        });
    }
};

const updatePager = (): void => {
    if (!preview) {
        pagerNode.textContent = 'No pages rendered';
        prevButton.disabled = true;
        nextButton.disabled = true;
        return;
    }

    const pageCount = preview.getPageCount();
    pagerNode.textContent = `Page ${currentPageIndex + 1} of ${pageCount}`;
    prevButton.disabled = currentPageIndex <= 0;
    nextButton.disabled = currentPageIndex >= pageCount - 1;
};

const parseDocument = (): Record<string, unknown> => {
    const parsed = JSON.parse(astInput.value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Expected a JSON object.');
    }
    return parsed as Record<string, unknown>;
};

const renderCurrentPage = async (): Promise<void> => {
    if (!preview) return;
    await preview.renderPageToCanvas(currentPageIndex, previewCanvas, {
        scale: 1,
        dpi: 144,
        clear: true,
        backgroundColor: '#ffffff'
    });
    updatePager();
};

const setStatus = (message: string): void => {
    statusNode.textContent = message;
};

const fontSummary = (): string => {
    const tracks = Array.from(fontTracks.values());
    if (tracks.length === 0) return '';
    const cacheHits = tracks.filter((t) => t.fromCache).length;
    const fresh = tracks.length - cacheHits;
    const parts: string[] = [];
    if (cacheHits > 0) parts.push(`${cacheHits} from IndexedDB cache`);
    if (fresh > 0) parts.push(`${fresh} downloaded`);
    return ` — ${tracks.length} font${tracks.length !== 1 ? 's' : ''} (${parts.join(', ')})`;
};

const loadPreview = async (): Promise<void> => {
    setStatus('Rendering preview…');
    fontTracks.clear();
    const documentInput = parseDocument();

    preview?.destroy();
    preview = await createVMPrintPreview(documentInput, { onFontProgress });
    currentPageIndex = 0;
    await renderCurrentPage();
    setStatus(`Render complete${fontSummary()}.`);
};

renderButton.addEventListener('click', () => {
    void loadPreview().catch((error) => {
        setStatus(`Render failed: ${String(error)}`);
    });
});

pdfButton.addEventListener('click', () => {
    void (async () => {
        if (!preview) {
            setStatus('Render a document before exporting PDF.');
            return;
        }
        const pdfBytes = await preview.exportPdf();
        const blob = new Blob([pdfBytes.buffer as ArrayBuffer], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        window.open(url, '_blank', 'noopener');
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
    })().catch((error) => {
        setStatus(`PDF export failed: ${String(error)}`);
    });
});

svgButton.addEventListener('click', () => {
    void (async () => {
        if (!preview) {
            setStatus('Render a document before exporting SVG.');
            return;
        }
        const svg = await preview.exportSvgPage(currentPageIndex);
        const blob = new Blob([svg], { type: 'image/svg+xml' });
        const url = URL.createObjectURL(blob);
        window.open(url, '_blank', 'noopener');
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
    })().catch((error) => {
        setStatus(`SVG export failed: ${String(error)}`);
    });
});

prevButton.addEventListener('click', () => {
    if (!preview || currentPageIndex <= 0) return;
    currentPageIndex -= 1;
    void renderCurrentPage().catch((error) => setStatus(`Render failed: ${String(error)}`));
});

nextButton.addEventListener('click', () => {
    if (!preview || currentPageIndex >= preview.getPageCount() - 1) return;
    currentPageIndex += 1;
    void renderCurrentPage().catch((error) => setStatus(`Render failed: ${String(error)}`));
});

void loadPreview().catch((error) => {
    setStatus(`Render failed: ${String(error)}`);
});
