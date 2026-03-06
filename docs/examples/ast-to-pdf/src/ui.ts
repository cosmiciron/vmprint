declare const VMPrintPipeline: {
    getBuiltinFixturePresets(): Array<{ id: string; label: string; description: string }>;
    getBuiltinFixtureDocument(id: string): Promise<Record<string, unknown>>;
    SAMPLE_DOCUMENT: Record<string, unknown>;
    parseDocumentJson(jsonText: string): Record<string, unknown>;
    renderDocumentToPdfBytes(documentInput: Record<string, unknown>): Promise<{ pdfBytes: Uint8Array; pageCount: number }>;
    createDownloadUrl(pdfBytes: Uint8Array): string;
    revokeDownloadUrl(url: string): void;
};

type UiState = 'idle' | 'rendering' | 'success' | 'error';
const uiBootStartMs = performance.now();

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
    const downloadLink = byId<HTMLAnchorElement>('download-link');
    const statusNode = byId<HTMLElement>('status');
    const pagesNode = byId<HTMLElement>('page-count');
    const bootNode = byId<HTMLElement>('boot-ms');
    const renderNode = byId<HTMLElement>('render-ms');
    const fixturePicker = byId<HTMLLabelElement>('fixture-picker-label');

    let currentDownloadUrl: string | null = null;
    let fixtureLoadVersion = 0;

    const resetDownload = () => {
        if (currentDownloadUrl) {
            VMPrintPipeline.revokeDownloadUrl(currentDownloadUrl);
            currentDownloadUrl = null;
        }
        downloadLink.removeAttribute('href');
        downloadLink.setAttribute('aria-disabled', 'true');
        downloadLink.textContent = 'Download PDF';
        pagesNode.textContent = '';
    };

    const setBootMetric = () => {
        const elapsedMs = performance.now() - uiBootStartMs;
        bootNode.textContent = `${elapsedMs.toFixed(1)} ms`;
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
            resetDownload();
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

    uploadInput.addEventListener('change', async (event) => {
        const target = event.target as HTMLInputElement;
        const file = target.files?.[0];
        target.value = '';
        if (!file) return;

        try {
            const text = await file.text();
            input.value = `${text.trim()}\n`;
            resetDownload();
            setStatus(statusNode, 'idle', `Loaded "${file.name}".`);
        } catch (error) {
            setStatus(statusNode, 'error', `Failed to read file: ${String(error)}`);
        }
    });

    generateButton.addEventListener('click', async () => {
        setBusy([generateButton, uploadButton], true);
        setStatus(statusNode, 'rendering', 'Rendering PDF...');
        resetDownload();
        const renderStartMs = performance.now();

        try {
            const documentInput = VMPrintPipeline.parseDocumentJson(input.value);
            const { pdfBytes, pageCount } = await VMPrintPipeline.renderDocumentToPdfBytes(documentInput);
            const renderElapsedMs = performance.now() - renderStartMs;
            const url = VMPrintPipeline.createDownloadUrl(pdfBytes);
            currentDownloadUrl = url;
            downloadLink.href = url;
            downloadLink.setAttribute('aria-disabled', 'false');
            downloadLink.textContent = 'Download PDF';
            pagesNode.textContent = `${pageCount} page${pageCount === 1 ? '' : 's'}`;
            renderNode.textContent = `${renderElapsedMs.toFixed(1)} ms`;
            setStatus(statusNode, 'success', 'Render complete. Download your PDF.');
        } catch (error) {
            const renderElapsedMs = performance.now() - renderStartMs;
            renderNode.textContent = `${renderElapsedMs.toFixed(1)} ms (failed)`;
            setStatus(statusNode, 'error', String(error));
        } finally {
            setBusy([generateButton, uploadButton], false);
        }
    });

    hydrateFixtureSelector();
    if (fixtureSelect.value) {
        void setBuiltinFixture(fixtureSelect.value, false).then(() => {
            setStatus(statusNode, 'idle', 'Built-in fixture loaded. You can edit the AST JSON and generate.');
        });
    } else {
        input.value = prettyJson(VMPrintPipeline.SAMPLE_DOCUMENT);
        setStatus(statusNode, 'idle', 'Sample loaded. You can edit the AST JSON and generate.');
    }
    setBootMetric();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', installUi);
} else {
    installUi();
}
