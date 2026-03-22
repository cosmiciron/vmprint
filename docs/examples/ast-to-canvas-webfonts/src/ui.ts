declare const VMPrintPipeline: {
    getBuiltinFixturePresets(): Array<{ id: string; label: string; description: string }>;
    getBuiltinFixtureDocument(id: string): Promise<Record<string, unknown>>;
    SAMPLE_DOCUMENT: Record<string, unknown>;
    parseDocumentJson(jsonText: string): Record<string, unknown>;
    createCanvasPreviewSession(documentInput: Record<string, unknown>): Promise<{
        pageCount: number;
        pageSize: { width: number; height: number };
        renderPage(pageIndex: number, target: HTMLCanvasElement, scale?: number, dpi?: number): Promise<void>;
    }>;
};

type UiState = 'idle' | 'rendering' | 'success' | 'error';
type CanvasPreviewSession = Awaited<ReturnType<typeof VMPrintPipeline.createCanvasPreviewSession>>;
const uiBootStartMs = performance.now();

type WebFontProgressDetail = {
    src: string;
    resolvedSrc: string;
    loadedBytes: number;
    totalBytes?: number;
    percent?: number;
    phase: 'cache-hit' | 'downloading' | 'finalizing' | 'caching' | 'complete';
    fileName: string;
};

function byId<T extends HTMLElement>(id: string): T {
    const node = document.getElementById(id);
    if (!node) {
        throw new Error(`Missing required element: #${id}`);
    }
    return node as T;
}

function setStatus(node: HTMLElement, state: UiState, message: string): void {
    node.dataset.state = state;
    node.textContent = message;
}

function setBusy(buttons: HTMLButtonElement[], busy: boolean): void {
    for (const button of buttons) {
        button.disabled = busy;
    }
}

function prettyJson(value: unknown): string {
    return `${JSON.stringify(value, null, 2)}\n`;
}

function installUi(): void {
    const input = byId<HTMLTextAreaElement>('ast-input');
    const fixtureSelect = byId<HTMLSelectElement>('fixture-select');
    const generateButton = byId<HTMLButtonElement>('generate');
    const uploadButton = byId<HTMLButtonElement>('upload-button');
    const uploadInput = byId<HTMLInputElement>('upload-json');
    const scaleSelect = byId<HTMLSelectElement>('preview-scale');
    const dpiSelect = byId<HTMLSelectElement>('preview-dpi');
    const previewCanvas = byId<HTMLCanvasElement>('preview-canvas');
    const previousPageButton = byId<HTMLButtonElement>('previous-page');
    const nextPageButton = byId<HTMLButtonElement>('next-page');
    const currentPageNode = byId<HTMLElement>('current-page');
    const statusNode = byId<HTMLElement>('status');
    const pagesNode = byId<HTMLElement>('page-count');
    const bootNode = byId<HTMLElement>('boot-ms');
    const renderNode = byId<HTMLElement>('render-ms');
    const fixturePicker = byId<HTMLLabelElement>('fixture-picker-label');

    let fixtureLoadVersion = 0;
    let activeFontStatus = '';
    let currentSession: CanvasPreviewSession | null = null;
    let currentPageIndex = 0;

    const syncPager = () => {
        const pageCount = currentSession?.pageCount || 0;
        currentPageNode.textContent = pageCount > 0
            ? `Page ${currentPageIndex + 1} of ${pageCount}`
            : 'No pages rendered';
        previousPageButton.disabled = !currentSession || currentPageIndex <= 0;
        nextPageButton.disabled = !currentSession || currentPageIndex >= pageCount - 1;
    };

    const resetPreview = () => {
        currentSession = null;
        currentPageIndex = 0;
        const context = previewCanvas.getContext('2d');
        if (context) {
            context.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
        }
        previewCanvas.width = 1;
        previewCanvas.height = 1;
        pagesNode.textContent = '';
        syncPager();
    };

    const renderCurrentPage = async () => {
        if (!currentSession) {
            syncPager();
            return;
        }
        const scale = Number(scaleSelect.value || '1');
        const dpiValue = dpiSelect.value;
        const dpi = dpiValue === 'auto' ? undefined : Number(dpiValue);
        await currentSession.renderPage(currentPageIndex, previewCanvas, scale, dpi);
        syncPager();
    };

    const setBootMetric = () => {
        const elapsedMs = performance.now() - uiBootStartMs;
        bootNode.textContent = `${elapsedMs.toFixed(1)} ms`;
    };

    const formatBytes = (bytes: number): string => {
        if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
    };

    const setFontStatus = (detail: WebFontProgressDetail | null) => {
        if (!detail) {
            activeFontStatus = '';
            return;
        }

        if (detail.phase === 'cache-hit') {
            activeFontStatus = `Fonts: ${detail.fileName} loaded from cache`;
            return;
        }

        if (detail.phase === 'complete') {
            activeFontStatus = `Fonts: ${detail.fileName} loaded (${formatBytes(detail.loadedBytes)})`;
            return;
        }

        if (detail.phase === 'finalizing') {
            activeFontStatus = `Fonts: ${detail.fileName} downloaded, finalizing...`;
            return;
        }

        if (detail.phase === 'caching') {
            activeFontStatus = `Fonts: ${detail.fileName} saving to cache...`;
            return;
        }

        const progress = Number.isFinite(detail.percent)
            ? `${Number(detail.percent).toFixed(0)}%`
            : `${formatBytes(detail.loadedBytes)} downloaded`;
        const total = Number.isFinite(detail.totalBytes) ? ` / ${formatBytes(Number(detail.totalBytes))}` : '';
        activeFontStatus = `Fonts: downloading ${detail.fileName} (${progress}${total})`;
    };

    const setBuiltinFixture = async (fixtureId: string, announce = true) => {
        const loadVersion = ++fixtureLoadVersion;
        fixturePicker.dataset.loading = 'true';
        fixtureSelect.disabled = true;
        setBusy([generateButton, uploadButton], true);
        setStatus(statusNode, 'rendering', `Loading built-in fixture "${fixtureId}"...`);
        try {
            const fixture = await VMPrintPipeline.getBuiltinFixtureDocument(fixtureId);
            if (loadVersion !== fixtureLoadVersion) return;
            input.value = prettyJson(fixture);
            if (announce) {
                setStatus(statusNode, 'idle', `Loaded built-in fixture "${fixtureId}".`);
            }
            resetPreview();
        } catch (error) {
            if (loadVersion !== fixtureLoadVersion) return;
            setStatus(statusNode, 'error', String(error));
        } finally {
            if (loadVersion !== fixtureLoadVersion) return;
            fixturePicker.dataset.loading = 'false';
            fixtureSelect.disabled = false;
            setBusy([generateButton, uploadButton], false);
        }
    };

    const hydrateFixtureSelector = () => {
        const fixtures = VMPrintPipeline.getBuiltinFixturePresets();
        fixtureSelect.innerHTML = '';
        for (const fixture of fixtures) {
            const option = document.createElement('option');
            option.value = fixture.id;
            option.textContent = fixture.label;
            option.title = fixture.description;
            fixtureSelect.appendChild(option);
        }
        if (fixtures.length > 0) {
            fixtureSelect.value = fixtures[0].id;
        }
    };

    fixtureSelect.addEventListener('change', () => {
        if (!fixtureSelect.value) return;
        void setBuiltinFixture(fixtureSelect.value);
    });

    uploadButton.addEventListener('click', () => {
        uploadInput.click();
    });

    scaleSelect.addEventListener('change', () => {
        if (!currentSession) return;
        void renderCurrentPage().catch((error) => {
            setStatus(statusNode, 'error', String(error));
        });
    });

    dpiSelect.addEventListener('change', () => {
        if (!currentSession) return;
        void renderCurrentPage().catch((error) => {
            setStatus(statusNode, 'error', String(error));
        });
    });

    previousPageButton.addEventListener('click', () => {
        if (!currentSession || currentPageIndex <= 0) return;
        currentPageIndex -= 1;
        void renderCurrentPage().catch((error) => {
            setStatus(statusNode, 'error', String(error));
        });
    });

    nextPageButton.addEventListener('click', () => {
        if (!currentSession || currentPageIndex >= currentSession.pageCount - 1) return;
        currentPageIndex += 1;
        void renderCurrentPage().catch((error) => {
            setStatus(statusNode, 'error', String(error));
        });
    });

    window.addEventListener('vmprint:webfont-progress', (event) => {
        const customEvent = event as CustomEvent<WebFontProgressDetail>;
        if (!customEvent.detail) return;
        setFontStatus(customEvent.detail);
        if (statusNode.dataset.state === 'rendering') {
            setStatus(statusNode, 'rendering', activeFontStatus || 'Rendering pages to canvas...');
        }
    });

    uploadInput.addEventListener('change', async (event) => {
        const target = event.target as HTMLInputElement;
        const file = target.files?.[0];
        target.value = '';
        if (!file) return;

        try {
            const text = await file.text();
            input.value = `${text.trim()}\n`;
            resetPreview();
            setStatus(statusNode, 'idle', `Loaded "${file.name}".`);
        } catch (error) {
            setStatus(statusNode, 'error', `Failed to read file: ${String(error)}`);
        }
    });

    generateButton.addEventListener('click', async () => {
        setBusy([generateButton, uploadButton], true);
        activeFontStatus = '';
        setStatus(statusNode, 'rendering', 'Rendering pages to canvas...');
        resetPreview();
        const renderStartMs = performance.now();

        try {
            const documentInput = VMPrintPipeline.parseDocumentJson(input.value);
            currentSession = await VMPrintPipeline.createCanvasPreviewSession(documentInput);
            currentPageIndex = 0;
            await renderCurrentPage();
            const renderElapsedMs = performance.now() - renderStartMs;
            pagesNode.textContent = `${currentSession.pageCount} page${currentSession.pageCount === 1 ? '' : 's'}`;
            renderNode.textContent = `${renderElapsedMs.toFixed(1)} ms`;
            const fontSummary = activeFontStatus ? ` ${activeFontStatus}.` : '';
            setStatus(statusNode, 'success', `Render complete. Single-page canvas preview is ready.${fontSummary}`);
        } catch (error) {
            const renderElapsedMs = performance.now() - renderStartMs;
            renderNode.textContent = `${renderElapsedMs.toFixed(1)} ms (failed)`;
            setStatus(statusNode, 'error', String(error));
            resetPreview();
        } finally {
            setBusy([generateButton, uploadButton], false);
        }
    });

    hydrateFixtureSelector();
    syncPager();
    if (fixtureSelect.value) {
        void setBuiltinFixture(fixtureSelect.value, false).then(() => {
            setStatus(statusNode, 'idle', 'Built-in fixture loaded. You can edit the AST JSON and render.');
        });
    } else {
        input.value = prettyJson(VMPrintPipeline.SAMPLE_DOCUMENT);
        setStatus(statusNode, 'idle', 'Sample loaded. You can edit the AST JSON and render.');
    }
    setBootMetric();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', installUi);
} else {
    installUi();
}
