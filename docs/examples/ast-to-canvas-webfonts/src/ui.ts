declare const VMPrintPipeline: {
    getBuiltinFixturePresets(): Array<{ id: string; label: string; description: string }>;
    getBuiltinFixtureDocument(id: string): Promise<Record<string, unknown>>;
    SAMPLE_DOCUMENT: Record<string, unknown>;
    parseDocumentJson(jsonText: string): Record<string, unknown>;
    createCanvasPreviewSession(
        documentInput: Record<string, unknown>,
        options?: { textRenderMode?: 'text' | 'glyph-path' }
    ): Promise<{
        pageCount: number;
        pageSize: { width: number; height: number };
        layoutMs: number;
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
    if (!node) throw new Error(`Missing required element: #${id}`);
    return node as T;
}

function setStatus(node: HTMLElement, state: UiState, message: string): void {
    node.dataset.state = state;
    node.textContent = message;
}

function setBusy(buttons: HTMLButtonElement[], busy: boolean): void {
    for (const button of buttons) button.disabled = busy;
}

function prettyJson(value: unknown): string {
    return `${JSON.stringify(value, null, 2)}\n`;
}

function installUi(): void {
    const input = byId<HTMLTextAreaElement>('ast-input');
    const fixtureSelect = byId<HTMLSelectElement>('fixture-select');
    const rerenderButton = byId<HTMLButtonElement>('rerender');
    const uploadButton = byId<HTMLButtonElement>('upload-button');
    const copyButton = byId<HTMLButtonElement>('copy-json');
    const uploadInput = byId<HTMLInputElement>('upload-json');
    const scaleSelect = byId<HTMLSelectElement>('preview-scale');
    const dpiSelect = byId<HTMLSelectElement>('preview-dpi');
    const textRenderModeSelect = byId<HTMLSelectElement>('text-render-mode');
    const previewCanvas = byId<HTMLCanvasElement>('preview-canvas');
    const previousPageButton = byId<HTMLButtonElement>('previous-page');
    const nextPageButton = byId<HTMLButtonElement>('next-page');
    const currentPageNode = byId<HTMLElement>('current-page');
    const statusNode = byId<HTMLElement>('status');
    const pagesNode = byId<HTMLElement>('page-count');
    const bootNode = byId<HTMLElement>('boot-ms');
    const layoutNode = byId<HTMLElement>('layout-ms');
    const renderNode = byId<HTMLElement>('render-ms');
    const fixturePicker = byId<HTMLLabelElement>('fixture-picker-label');
    const inlineError = byId<HTMLElement>('inline-error');
    const dispatchCallout = byId<HTMLElement>('dispatch-callout');

    let fixtureLoadVersion = 0;
    let activeFontStatus = '';
    let currentSession: CanvasPreviewSession | null = null;
    let currentPageIndex = 0;
    let isRendering = false;
    let editDebounceTimer: ReturnType<typeof setTimeout> | null = null;

    // --- Helpers ---

    const showInlineError = (msg: string | null) => {
        inlineError.textContent = msg ?? '';
        inlineError.hidden = !msg;
    };

    const updateDispatchCallout = () => {
        dispatchCallout.hidden = fixtureSelect.value !== 'daily-dispatch';
    };

    const syncPager = () => {
        const pageCount = currentSession?.pageCount ?? 0;
        currentPageNode.textContent = pageCount > 0
            ? `Page ${currentPageIndex + 1} of ${pageCount}`
            : 'No pages rendered';
        previousPageButton.disabled = !currentSession || currentPageIndex <= 0;
        nextPageButton.disabled = !currentSession || currentPageIndex >= pageCount - 1;
    };

    const resetPreview = () => {
        currentSession = null;
        currentPageIndex = 0;
        const ctx = previewCanvas.getContext('2d');
        if (ctx) ctx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
        previewCanvas.width = 1;
        previewCanvas.height = 1;
        pagesNode.textContent = '';
        layoutNode.textContent = '-';
        syncPager();
    };

    const renderCurrentPage = async () => {
        if (!currentSession) { syncPager(); return; }
        const scale = Number(scaleSelect.value || '1');
        const dpiValue = dpiSelect.value;
        const dpi = dpiValue === 'auto' ? undefined : Number(dpiValue);
        await currentSession.renderPage(currentPageIndex, previewCanvas, scale, dpi);
        syncPager();
    };

    const setBootMetric = () => {
        bootNode.textContent = `${(performance.now() - uiBootStartMs).toFixed(1)} ms`;
    };

    const formatBytes = (bytes: number): string => {
        if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
    };

    const setFontStatus = (detail: WebFontProgressDetail | null) => {
        if (!detail) { activeFontStatus = ''; return; }
        if (detail.phase === 'cache-hit') { activeFontStatus = `Fonts: ${detail.fileName} loaded from cache`; return; }
        if (detail.phase === 'complete') { activeFontStatus = `Fonts: ${detail.fileName} loaded (${formatBytes(detail.loadedBytes)})`; return; }
        if (detail.phase === 'finalizing') { activeFontStatus = `Fonts: ${detail.fileName} downloaded, finalizing...`; return; }
        if (detail.phase === 'caching') { activeFontStatus = `Fonts: ${detail.fileName} saving to cache...`; return; }
        const progress = Number.isFinite(detail.percent)
            ? `${Number(detail.percent).toFixed(0)}%`
            : `${formatBytes(detail.loadedBytes)} downloaded`;
        const total = Number.isFinite(detail.totalBytes) ? ` / ${formatBytes(Number(detail.totalBytes))}` : '';
        activeFontStatus = `Fonts: downloading ${detail.fileName} (${progress}${total})`;
    };

    // --- Render ---
    //
    // quiet=true: debounced background render — no status flash, no canvas wipe,
    //   parse errors shown only as a soft inline hint, last good render preserved on failure.
    // quiet=false: explicit render — full status lifecycle, canvas cleared first.

    const performRender = async (quiet = false) => {
        if (isRendering) return;

        let documentInput: Record<string, unknown>;
        try {
            documentInput = VMPrintPipeline.parseDocumentJson(input.value);
        } catch {
            if (!quiet) {
                showInlineError('JSON syntax error \u2014 check the document structure.');
                setStatus(statusNode, 'error', 'JSON parse error. Fix the syntax and try again.');
            }
            // In quiet mode (debounce): user may still be mid-edit, stay silent.
            return;
        }

        showInlineError(null);
        isRendering = true;

        if (!quiet) {
            setBusy([rerenderButton, uploadButton], true);
            setStatus(statusNode, 'rendering', 'Rendering pages to canvas\u2026');
            resetPreview();
        }

        activeFontStatus = '';
        const renderStartMs = performance.now();

        try {
            const newSession = await VMPrintPipeline.createCanvasPreviewSession(documentInput, {
                textRenderMode: textRenderModeSelect.value as 'text' | 'glyph-path'
            });
            // Only replace the session once we have a valid result.
            currentSession = newSession;
            currentPageIndex = 0;
            await renderCurrentPage();
            const renderElapsedMs = performance.now() - renderStartMs;
            pagesNode.textContent = `${currentSession.pageCount} page${currentSession.pageCount === 1 ? '' : 's'}`;
            layoutNode.textContent = `${currentSession.layoutMs.toFixed(1)} ms`;
            renderNode.textContent = `${renderElapsedMs.toFixed(1)} ms`;
            const fontSummary = activeFontStatus ? ` ${activeFontStatus}.` : '';
            setStatus(statusNode, 'success', `Render complete. Single-page canvas preview is ready.${fontSummary}`);
        } catch (error) {
            const renderElapsedMs = performance.now() - renderStartMs;
            renderNode.textContent = `${renderElapsedMs.toFixed(1)} ms (failed)`;
            const msg = String(error);
            showInlineError(`Render error: ${msg}`);
            if (!quiet) {
                setStatus(statusNode, 'error', msg);
                resetPreview();
            } else {
                // Keep last good render; note error in status bar.
                setStatus(statusNode, 'error', `Re-render failed: ${msg}`);
            }
        } finally {
            isRendering = false;
            if (!quiet) {
                setBusy([rerenderButton, uploadButton], false);
            }
        }
    };

    // --- Custom fixture option ---

    const setCustomFixtureOption = (label: string) => {
        let customOption = fixtureSelect.querySelector<HTMLOptionElement>('option[value="custom"]');
        if (!customOption) {
            customOption = document.createElement('option');
            customOption.value = 'custom';
            fixtureSelect.insertBefore(customOption, fixtureSelect.firstChild);
        }
        customOption.textContent = label;
        fixtureSelect.value = 'custom';
        updateDispatchCallout();
    };

    const removeCustomFixtureOption = () => {
        fixtureSelect.querySelector<HTMLOptionElement>('option[value="custom"]')?.remove();
    };

    // --- Fixture loading ---

    const setBuiltinFixture = async (fixtureId: string) => {
        const loadVersion = ++fixtureLoadVersion;
        fixturePicker.dataset.loading = 'true';
        fixtureSelect.disabled = true;
        setBusy([rerenderButton, uploadButton], true);
        setStatus(statusNode, 'rendering', `Loading \u201c${fixtureId}\u201d\u2026`);
        removeCustomFixtureOption();
        try {
            const fixture = await VMPrintPipeline.getBuiltinFixtureDocument(fixtureId);
            if (loadVersion !== fixtureLoadVersion) return;
            input.value = prettyJson(fixture);
            showInlineError(null);
            updateDispatchCallout();
            resetPreview();
        } catch (error) {
            if (loadVersion !== fixtureLoadVersion) return;
            setStatus(statusNode, 'error', String(error));
            return;
        } finally {
            if (loadVersion !== fixtureLoadVersion) return;
            fixturePicker.dataset.loading = 'false';
            fixtureSelect.disabled = false;
            setBusy([rerenderButton, uploadButton], false);
        }
        await performRender(false);
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
        if (fixtures.length > 0) fixtureSelect.value = fixtures[0].id;
    };

    // --- Event listeners ---

    fixtureSelect.addEventListener('change', () => {
        const val = fixtureSelect.value;
        if (!val || val === 'custom') return;
        void setBuiltinFixture(val);
    });

    uploadButton.addEventListener('click', () => uploadInput.click());

    rerenderButton.addEventListener('click', () => {
        void performRender(false);
    });

    scaleSelect.addEventListener('change', () => {
        if (!currentSession) return;
        void renderCurrentPage().catch((err) => setStatus(statusNode, 'error', String(err)));
    });

    dpiSelect.addEventListener('change', () => {
        if (!currentSession) return;
        void renderCurrentPage().catch((err) => setStatus(statusNode, 'error', String(err)));
    });

    textRenderModeSelect.addEventListener('change', () => {
        resetPreview();
        void performRender(false);
    });

    previousPageButton.addEventListener('click', () => {
        if (!currentSession || currentPageIndex <= 0) return;
        currentPageIndex -= 1;
        void renderCurrentPage().catch((err) => setStatus(statusNode, 'error', String(err)));
    });

    nextPageButton.addEventListener('click', () => {
        if (!currentSession || currentPageIndex >= currentSession.pageCount - 1) return;
        currentPageIndex += 1;
        void renderCurrentPage().catch((err) => setStatus(statusNode, 'error', String(err)));
    });

    window.addEventListener('vmprint:webfont-progress', (event) => {
        const customEvent = event as CustomEvent<WebFontProgressDetail>;
        if (!customEvent.detail) return;
        setFontStatus(customEvent.detail);
        if (statusNode.dataset.state === 'rendering') {
            setStatus(statusNode, 'rendering', activeFontStatus || 'Rendering pages to canvas\u2026');
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
            showInlineError(null);
            setCustomFixtureOption(`\u2191 ${file.name}`);
            resetPreview();
            await performRender(false);
        } catch (error) {
            setStatus(statusNode, 'error', `Failed to read file: ${String(error)}`);
        }
    });

    // When the user pastes new content, mark as custom.
    input.addEventListener('paste', () => {
        setTimeout(() => {
            setCustomFixtureOption('\u2191 Custom (pasted)');
        }, 0);
    });

    // Debounced auto-render on edit: fires 1.5 s after the user stops typing.
    // Uses quiet mode so parse errors are silent until the JSON is valid again.
    input.addEventListener('input', () => {
        if (editDebounceTimer !== null) clearTimeout(editDebounceTimer);
        editDebounceTimer = setTimeout(() => {
            editDebounceTimer = null;
            void performRender(true);
        }, 1500);
    });

    copyButton.addEventListener('click', async () => {
        const original = copyButton.textContent ?? 'Copy JSON';
        try {
            await navigator.clipboard.writeText(input.value);
            copyButton.textContent = 'Copied!';
        } catch {
            copyButton.textContent = 'Failed';
        }
        setTimeout(() => { copyButton.textContent = original; }, 1800);
    });

    // --- Init ---

    hydrateFixtureSelector();
    syncPager();
    updateDispatchCallout();

    if (fixtureSelect.value) {
        void setBuiltinFixture(fixtureSelect.value);
    } else {
        input.value = prettyJson(VMPrintPipeline.SAMPLE_DOCUMENT);
        setStatus(statusNode, 'idle', 'Sample loaded. Edit the AST JSON above to render.');
    }

    setBootMetric();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', installUi);
} else {
    installUi();
}
