type VmprintDocument = Record<string, unknown>;
type FixturePreset = {
    id: string;
    label: string;
    description: string;
    scriptFile: string;
};

type EngineBundle = {
    LayoutEngine: new (config: any, runtime: any) => {
        waitForFonts(): Promise<void>;
        simulate(elements: any[]): any[];
    };
    Renderer: new (config: any, debug: boolean, runtime: any) => {
        render(pages: any[], context: any): Promise<void>;
    };
    createEngineRuntime(options: { fontManager: unknown }): unknown;
    resolveDocumentPaths(document: VmprintDocument, documentPath: string): any;
    toLayoutConfig(document: any, debug: boolean): any;
    LayoutUtils: {
        getPageDimensions(config: any): { width: number; height: number };
    };
};

type StandardFontsBundle = {
    StandardFontManager: new () => unknown;
};

type PdfLiteBundle = {
    PdfLiteContext: new (options: any) => {
        pipe(stream: BrowserMemoryOutputStream): void;
    };
};

declare global {
    interface Window {
        VMPrintEngine: EngineBundle;
        VMPrintStandardFonts: StandardFontsBundle;
        VMPrintPdfLiteContext: PdfLiteBundle;
        VMPrintFixtureStore?: Record<string, VmprintDocument>;
    }
}

class BrowserMemoryOutputStream {
    private readonly chunks: Uint8Array[] = [];
    private readonly finishPromise: Promise<void>;
    private resolveFinish: (() => void) | null = null;
    private finished = false;

    constructor() {
        this.finishPromise = new Promise<void>((resolve) => {
            this.resolveFinish = resolve;
        });
    }

    write(chunk: Uint8Array | string): void {
        if (typeof chunk === 'string') {
            this.chunks.push(new TextEncoder().encode(chunk));
            return;
        }
        this.chunks.push(chunk);
    }

    end(): void {
        if (this.finished) return;
        this.finished = true;
        if (this.resolveFinish) this.resolveFinish();
    }

    waitForFinish(): Promise<void> {
        return this.finishPromise;
    }

    toUint8Array(): Uint8Array {
        const total = this.chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
        const merged = new Uint8Array(total);
        let offset = 0;
        for (const chunk of this.chunks) {
            merged.set(chunk, offset);
            offset += chunk.byteLength;
        }
        return merged;
    }
}

const BUILTIN_FIXTURES: FixturePreset[] = [
    {
        id: '16-standard-fonts-pdf14',
        label: '16: Standard Fonts PDF-14',
        description: 'Canonical standard-font rendering fixture.',
        scriptFile: '16-standard-fonts-pdf14.js'
    },
    {
        id: '08-dropcap-pagination',
        label: '08: Dropcap + Pagination',
        description: 'Typography-heavy fixture with drop cap and paging behavior.',
        scriptFile: '08-dropcap-pagination.js'
    },
    {
        id: '11-story-image-floats',
        label: '11: Story Flow + Image Floats',
        description: 'Story wrapping around float obstacles across pages.',
        scriptFile: '11-story-image-floats.js'
    },
    {
        id: '14-flow-images-multipage',
        label: '14: Flow Images Multipage',
        description: 'Multipage flow with embedded images.',
        scriptFile: '14-flow-images-multipage.js'
    },
    {
        id: '15-story-multi-column',
        label: '15: Story Multi-Column',
        description: 'Multi-column story composition and flow behaviors.',
        scriptFile: '15-story-multi-column.js'
    },
    {
        id: '09-tables-spans-pagination',
        label: '09: Tables Spans Pagination',
        description: 'Complex table spanning and pagination stress test.',
        scriptFile: '09-tables-spans-pagination.js'
    }
];

const SAMPLE_DOCUMENT: VmprintDocument = {
    documentVersion: '1.0',
    elements: []
};
const fixtureLoadPromises = new Map<string, Promise<void>>();

const cloneDocument = (document: VmprintDocument): VmprintDocument =>
    JSON.parse(JSON.stringify(document)) as VmprintDocument;

function getFixtureScriptUrl(scriptFile: string): string {
    return new URL(`./fixtures/${scriptFile}`, document.baseURI).toString();
}

function ensureFixtureLoaded(fixture: FixturePreset): Promise<void> {
    if (window.VMPrintFixtureStore?.[fixture.id]) {
        return Promise.resolve();
    }

    const existingPromise = fixtureLoadPromises.get(fixture.id);
    if (existingPromise) {
        return existingPromise;
    }

    const loadPromise = new Promise<void>((resolve, reject) => {
        const script = document.createElement('script');
        script.src = getFixtureScriptUrl(fixture.scriptFile);
        script.async = true;

        script.onload = () => {
            if (window.VMPrintFixtureStore?.[fixture.id]) {
                resolve();
                return;
            }
            reject(new Error(`Fixture script "${fixture.id}" loaded but no document was registered.`));
        };

        script.onerror = () => {
            reject(new Error(`Failed to load built-in fixture "${fixture.id}".`));
        };

        document.head.appendChild(script);
    }).finally(() => {
        fixtureLoadPromises.delete(fixture.id);
    });

    fixtureLoadPromises.set(fixture.id, loadPromise);
    return loadPromise;
}

function getBuiltinFixturePresets(): Array<Pick<FixturePreset, 'id' | 'label' | 'description'>> {
    return BUILTIN_FIXTURES.map((fixture) => ({
        id: fixture.id,
        label: fixture.label,
        description: fixture.description
    }));
}

async function getBuiltinFixtureDocument(id: string): Promise<VmprintDocument> {
    const fixture = BUILTIN_FIXTURES.find((entry) => entry.id === id);
    if (!fixture) {
        throw new Error(`Unknown built-in fixture "${id}".`);
    }
    await ensureFixtureLoaded(fixture);
    const loadedDocument = window.VMPrintFixtureStore?.[fixture.id];
    if (!loadedDocument) {
        throw new Error(`Built-in fixture "${id}" is unavailable after loading.`);
    }
    return cloneDocument(loadedDocument);
}

function parseDocumentJson(jsonText: string): VmprintDocument {
    const parsed = JSON.parse(jsonText);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Expected a JSON object as VMPrint document input.');
    }
    return parsed as VmprintDocument;
}

async function renderDocumentToPdfBytes(documentInput: VmprintDocument): Promise<{ pdfBytes: Uint8Array; pageCount: number }> {
    if (!window.VMPrintEngine || !window.VMPrintStandardFonts || !window.VMPrintPdfLiteContext) {
        throw new Error('VMPrint browser bundles are missing. Rebuild docs assets and reload.');
    }

    const engineApi = window.VMPrintEngine;
    const fontsApi = window.VMPrintStandardFonts;
    const contextApi = window.VMPrintPdfLiteContext;

    const runtime = engineApi.createEngineRuntime({
        fontManager: new fontsApi.StandardFontManager()
    });

    const documentIr = engineApi.resolveDocumentPaths(documentInput, 'browser-input.json');
    const config = engineApi.toLayoutConfig(documentIr, false);

    const engine = new engineApi.LayoutEngine(config, runtime);
    await engine.waitForFonts();
    const pages = engine.simulate(documentIr.elements);

    const { width, height } = engineApi.LayoutUtils.getPageDimensions(config);
    const context = new contextApi.PdfLiteContext({
        size: [width, height],
        margins: { top: 0, right: 0, bottom: 0, left: 0 },
        autoFirstPage: false,
        bufferPages: false
    });

    const outputStream = new BrowserMemoryOutputStream();
    context.pipe(outputStream);

    const renderer = new engineApi.Renderer(config, false, runtime);
    await renderer.render(pages, context as unknown as any);
    await outputStream.waitForFinish();

    return { pdfBytes: outputStream.toUint8Array(), pageCount: pages.length };
}

function createDownloadUrl(pdfBytes: Uint8Array): string {
    const blob = new Blob([pdfBytes], { type: 'application/pdf' });
    return URL.createObjectURL(blob);
}

function revokeDownloadUrl(url: string): void {
    URL.revokeObjectURL(url);
}

export {
    BUILTIN_FIXTURES,
    SAMPLE_DOCUMENT,
    createDownloadUrl,
    getBuiltinFixtureDocument,
    getBuiltinFixturePresets,
    parseDocumentJson,
    renderDocumentToPdfBytes,
    revokeDownloadUrl
};
