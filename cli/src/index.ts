import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { performance } from 'perf_hooks';
import type { OverlayProvider } from '@vmprint/contracts';
import {
    LayoutEngine,
    VMPrintEngine,
    createPrintEngineRuntime,
    loadDocument,
    renderLayout,
    type LayoutConfig,
    type AnnotatedLayoutStream,
    type DocumentIR
} from '@vmprint/engine';

type CliOptions = {
    input?: string;
    output?: string;
    fontManager?: string;
    emitLayout?: boolean | string;
    renderFromLayout?: string;
    omitGlyphs?: boolean;
    quantize?: boolean;
    debug?: boolean;
    overlay?: string;
    profileLayout?: boolean;
};

const OVERLAY_EXTENSIONS = ['.mjs', '.js', '.cjs', '.ts'] as const;

function resolveOutputPath(options: CliOptions): string {
    const outputPath: string = options.output ? String(options.output) : '';
    if (outputPath) {
        const ext = path.extname(outputPath).toLowerCase();
        if (ext === '.pdf') return outputPath;
        throw new Error(`Unsupported output extension "${ext || '(none)'}". Use .pdf.`);
    }
    return 'output.pdf';
}

function resolveModulePath(modulePath: string): string {
    const isPackageName = modulePath.startsWith('@') || (!modulePath.startsWith('.') && !path.isAbsolute(modulePath));
    if (isPackageName) return require.resolve(modulePath);
    return path.resolve(modulePath);
}

async function loadImplementation<T>(modulePath: string | undefined, builtinPath: string): Promise<T> {
    const resolvedPath = modulePath ? resolveModulePath(modulePath) : builtinPath;
    const mod = await import(pathToFileURL(resolvedPath).href);
    return mod?.default?.default ?? mod?.default ?? mod;
}

function resolveAutoOverlayPath(inputPath: string): string | undefined {
    const absoluteInputPath = path.resolve(inputPath);
    const parsed = path.parse(absoluteInputPath);
    const candidatePrefix = path.join(parsed.dir, `${parsed.name}.overlay`);
    for (const ext of OVERLAY_EXTENSIONS) {
        const candidate = `${candidatePrefix}${ext}`;
        if (fs.existsSync(candidate)) return candidate;
    }
    return undefined;
}

function ensureOverlayProvider(candidate: unknown, modulePath: string): OverlayProvider {
    if (!candidate || typeof candidate !== 'object') {
        throw new Error(`Overlay module "${modulePath}" must export an object.`);
    }
    const overlay = candidate as OverlayProvider;
    if (overlay.backdrop !== undefined && typeof overlay.backdrop !== 'function') {
        throw new Error(`Overlay module "${modulePath}" has invalid backdrop export (expected function).`);
    }
    if (overlay.overlay !== undefined && typeof overlay.overlay !== 'function') {
        throw new Error(`Overlay module "${modulePath}" has invalid overlay export (expected function).`);
    }
    if (!overlay.backdrop && !overlay.overlay) {
        throw new Error(`Overlay module "${modulePath}" must export backdrop() and/or overlay() function.`);
    }
    return overlay;
}

async function run() {
    const cliVersion = process.env.npm_package_version || '0.1.0';
    const program = new Command();

    program
        .name('vmprint')
        .description('Layout and render a vmprint document to PDF.')
        .version(cliVersion)
        .option('-i, --input <path>', 'Input document JSON file')
        .option('-o, --output <path>', 'Output file (.pdf)')
        .option('--font-manager <path>', 'Path to a JS module exporting a FontManager class (default: bundled LocalFontManager)')
        .option('--emit-layout [path]', 'Output annotated layout stream JSON (default: <output>.layout.json)')
        .option('--render-from-layout <path>', 'Bypass layout and render directly from a saved layout JSON')
        .option('--omit-glyphs', 'Exclude glyph positioning data from emitted layout stream')
        .option('--quantize', 'Quantize geometry coordinates to 3 decimal places in emitted layout stream')
        .option('-d, --debug', 'Draw layout debug regions in the output PDF', false)
        .option('--overlay <path>', 'Path to a JS module exporting an OverlayProvider object')
        .option('--profile-layout', 'Measure and report layout pipeline duration', false)
        .parse(process.argv);

    const options = program.opts<CliOptions>();
    const outputPath = resolveOutputPath(options);

    if (!options.input && !options.renderFromLayout) {
        throw new Error('You must specify either --input <path> or --render-from-layout <path>');
    }

    const FontManagerClass = options.fontManager
        ? await loadImplementation<new (...args: any[]) => any>(options.fontManager, '')
        : await loadImplementation<new (...args: any[]) => any>('@vmprint/local-fonts', '');

    const PdfContextClass = await loadImplementation<new (...args: any[]) => any>('@vmprint/context-pdf', '');

    // --- Render from saved layout stream (bypass layout engine) --------------

    if (options.renderFromLayout) {
        const stream: AnnotatedLayoutStream = JSON.parse(
            fs.readFileSync(path.resolve(options.renderFromLayout), 'utf8')
        );
        console.log(`[vmprint] Bypassing layout, loaded ${stream.pages.length} pages from ${options.renderFromLayout}`);

        const { width, height } = stream.config.layout.pageSize as any;
        const context = new PdfContextClass({
            size: typeof stream.config.layout.pageSize === 'object'
                ? [stream.config.layout.pageSize.width, stream.config.layout.pageSize.height]
                : stream.config.layout.pageSize,
            margins: { top: 0, left: 0, right: 0, bottom: 0 },
            autoFirstPage: false,
            bufferPages: false
        });
        context.pipe(fs.createWriteStream(outputPath));
        await renderLayout(stream, new FontManagerClass(), context, { debug: !!options.debug });
        return;
    }

    // --- Normal path: load document, create engine, render -------------------

    const inputPath = path.resolve(options.input!);
    let overlayPath: string | undefined;

    if (!options.overlay) {
        overlayPath = resolveAutoOverlayPath(inputPath);
        if (overlayPath) console.log(`[vmprint] Auto-loaded overlay: ${overlayPath}`);
    }

    const document: DocumentIR = loadDocument(fs.readFileSync(inputPath, 'utf-8'), inputPath);
    const engine = new VMPrintEngine(document, new FontManagerClass());

    // Profile layout timing if requested.
    if (options.profileLayout) {
        const t0 = performance.now();
        await engine.layout();
        const coldMs = (performance.now() - t0).toFixed(2);

        // Keep warm profiling comparable to the historical CLI behavior:
        // reuse one runtime/font-manager so the number reflects warmed layout
        // work rather than repeated font-manager cold start overhead.
        const profileConfig: LayoutConfig = { ...engine.config, debug: false };
        const profileRuntime = createPrintEngineRuntime({ fontManager: new FontManagerClass() });
        const warmPrime = new LayoutEngine(profileConfig, profileRuntime);
        await warmPrime.waitForFonts();
        warmPrime.simulate(document.elements);

        const WARM_REPEATS = 2;
        let warmSum = 0;
        for (let i = 0; i < WARM_REPEATS; i++) {
            const warmEngine = new LayoutEngine(profileConfig, profileRuntime);
            const wt0 = performance.now();
            await warmEngine.waitForFonts();
            warmEngine.simulate(document.elements);
            warmSum += performance.now() - wt0;
        }
        console.log(`[vmprint] cold  layoutMs: ${coldMs} (${engine.info.pageCount} pages)`);
        console.log(`[vmprint] warm  layoutMs: ${(warmSum / WARM_REPEATS).toFixed(2)} (avg x${WARM_REPEATS})`);
    }

    // Emit layout stream if requested.
    if (options.emitLayout !== undefined) {
        const pages = await engine.layout();
        const layoutPath = options.emitLayout === true
            ? outputPath.replace(/\.pdf$/i, '.layout.json')
            : path.resolve(String(options.emitLayout));

        const stream: AnnotatedLayoutStream = {
            streamVersion: '1.0',
            config: engine.config,
            pages
        };
        const stringified = JSON.stringify(stream, (key, value) => {
            if (key.startsWith('_')) return undefined;
            if (options.omitGlyphs && key === 'glyphs') return undefined;
            if (options.quantize && typeof value === 'number') {
                return Number.isInteger(value) ? value : Number(value.toFixed(3));
            }
            return value;
        });
        fs.writeFileSync(layoutPath, stringified, 'utf8');
    }

    if (options.overlay) overlayPath = path.resolve(options.overlay);
    const overlay = overlayPath
        ? ensureOverlayProvider(
            await loadImplementation<OverlayProvider>(overlayPath, overlayPath),
            overlayPath
        )
        : undefined;

    const { pageSize: { width, height } } = engine.info;
    const context = new PdfContextClass({
        size: [width, height],
        margins: { top: 0, left: 0, right: 0, bottom: 0 },
        autoFirstPage: false,
        bufferPages: false
    });
    context.pipe(fs.createWriteStream(outputPath));
    await engine.render(context, { debug: !!options.debug, overlay });
}

run().catch((error) => {
    console.error('[vmprint] Failed:', error);
    process.exit(1);
});
