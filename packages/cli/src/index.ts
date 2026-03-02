import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { OverlayProvider } from '@vmprint/contracts';
import { LayoutEngine } from '@vmprint/engine';
import { Renderer } from '@vmprint/engine';
import { LayoutUtils } from '@vmprint/engine';
import { resolveDocumentPaths, serializeDocumentIR, toLayoutConfig } from '@vmprint/engine';
import { createEngineRuntime } from '@vmprint/engine';
import { AnnotatedLayoutStream, DocumentIR, LayoutConfig, Page } from '@vmprint/engine';
import { performance } from 'perf_hooks';

type CliOptions = {
    input?: string;
    output?: string;
    context?: string;
    fontManager?: string;
    dumpIr?: boolean | string;
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

function resolveBuiltin(bundledRelPath: string, packageName: string): string {
    const bundledPath = path.join(__dirname, 'bundled', bundledRelPath);
    if (fs.existsSync(bundledPath)) return bundledPath;
    // Dev mode (tsx src/): bundled dir not present, resolve from workspace package
    return require.resolve(packageName);
}

async function loadImplementation<T>(modulePath: string | undefined, builtinPath: string): Promise<T> {
    const resolvedPath = modulePath ? path.resolve(modulePath) : builtinPath;
    const mod = await import(pathToFileURL(resolvedPath).href);
    // When importing a TS-compiled CJS module via dynamic import(), Node wraps
    // module.exports as mod.default, so mod.default.default holds the actual export.
    return mod?.default?.default ?? mod?.default ?? mod;
}

function resolveAutoOverlayPath(inputPath: string): string | undefined {
    const absoluteInputPath = path.resolve(inputPath);
    const parsed = path.parse(absoluteInputPath);
    const candidatePrefix = path.join(parsed.dir, `${parsed.name}.overlay`);

    for (const ext of OVERLAY_EXTENSIONS) {
        const candidate = `${candidatePrefix}${ext}`;
        if (fs.existsSync(candidate)) {
            return candidate;
        }
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
        .option('--context <path>', 'Path to a JS module exporting a Context class (default: bundled PdfContext)')
        .option(
            '--font-manager <path>',
            'Path to a JS module exporting a FontManager class (default: bundled LocalFontManager)',
        )
        .option('--dump-ir [path]', 'Write canonical document IR JSON (default: <output>.ir.json)')
        .option('--emit-layout [path]', 'Output annotated layout stream JSON (default: <output>.layout.json)')
        .option('--render-from-layout <path>', 'Bypass layout engine and render directly from a layout JSON stream')
        .option('--omit-glyphs', 'Exclude precise character glyph positioning bounds when emitting layout stream')
        .option('--quantize', 'Quantize geometry coordinates to 3 decimal places when emitting layout stream')
        .option('-d, --debug', 'Show layout debug boxes', false)
        .option('--overlay <path>', 'Path to a JS module exporting an OverlayProvider object')
        .option('--profile-layout', 'Measure and report layout pipeline duration', false)
        .parse(process.argv);

    const options = program.opts<CliOptions>();
    const outputPath = resolveOutputPath(options);
    if (!options.input && !options.renderFromLayout) {
        throw new Error('You must specify either --input <path> or --render-from-layout <path>');
    }

    const builtinFontManager = resolveBuiltin('font-managers/local/index.js', '@vmprint/local-fonts');
    const builtinContext = resolveBuiltin('contexts/pdf/index.js', '@vmprint/context-pdf');

    const FontManagerClass = await loadImplementation<new (...args: any[]) => any>(
        options.fontManager,
        builtinFontManager,
    );
    const ContextClass = await loadImplementation<new (...args: any[]) => any>(options.context, builtinContext);

    const runtime = createEngineRuntime({ fontManager: new FontManagerClass() });

    let config: LayoutConfig;
    let pages: Page[];
    let document: DocumentIR | undefined;
    let overlayPath: string | undefined;

    if (options.renderFromLayout) {
        const layoutContent = fs.readFileSync(path.resolve(options.renderFromLayout), 'utf8');
        const stream: AnnotatedLayoutStream = JSON.parse(layoutContent);
        pages = stream.pages;
        config = { ...stream.config, debug: !!options.debug };
        console.log(`[vmprint] Bypassing layout engine, loaded ${pages.length} pages from ${options.renderFromLayout}`);
    } else {
        if (!options.input) {
            throw new Error('You must specify --input <path> when not using --render-from-layout.');
        }
        const inputPath = path.resolve(options.input);
        if (!options.overlay) {
            overlayPath = resolveAutoOverlayPath(inputPath);
            if (overlayPath) {
                console.log(`[vmprint] Auto-loaded overlay script: ${overlayPath}`);
            }
        }
        const inputRaw = fs.readFileSync(inputPath, 'utf-8');
        document = resolveDocumentPaths(JSON.parse(inputRaw), inputPath);
        config = toLayoutConfig(document, !!options.debug);
        const engine = new LayoutEngine(config, runtime);
        const t0 = options.profileLayout ? performance.now() : 0;
        await engine.waitForFonts();
        const t1 = options.profileLayout ? performance.now() : 0;
        pages = engine.paginate(document.elements);
        if (options.profileLayout) {
            const t2 = performance.now();
            const coldFontMs = t1 - t0;
            const coldLayoutMs = t2 - t1;

            const WARM_REPEATS = 2;
            let warmFontSum = 0,
                warmLayoutSum = 0;
            for (let i = 0; i < WARM_REPEATS; i++) {
                const warmEngine = new LayoutEngine(config, runtime);
                const wt0 = performance.now();
                await warmEngine.waitForFonts();
                const wt1 = performance.now();
                warmEngine.paginate(document.elements);
                const wt2 = performance.now();
                warmFontSum += wt1 - wt0;
                warmLayoutSum += wt2 - wt1;
            }
            const avgWarmFontMs = warmFontSum / WARM_REPEATS;
            const avgWarmLayoutMs = warmLayoutSum / WARM_REPEATS;

            console.log(
                `[vmprint] cold  fontMs: ${coldFontMs.toFixed(2)} | layoutMs: ${coldLayoutMs.toFixed(2)} | total: ${(coldFontMs + coldLayoutMs).toFixed(2)} (${pages.length} pages)`,
            );
            console.log(
                `[vmprint] warm  fontMs: ${avgWarmFontMs.toFixed(2)} | layoutMs: ${avgWarmLayoutMs.toFixed(2)} | total: ${(avgWarmFontMs + avgWarmLayoutMs).toFixed(2)} (avg ×${WARM_REPEATS})`,
            );
        }
    }

    if (options.overlay) {
        overlayPath = path.resolve(options.overlay);
    }

    const overlay = overlayPath
        ? ensureOverlayProvider(await loadImplementation<OverlayProvider>(overlayPath, overlayPath), overlayPath)
        : undefined;

    if (options.emitLayout !== undefined) {
        const layoutPath =
            options.emitLayout === true
                ? outputPath
                    ? outputPath.replace(/\.pdf$/i, '.layout.json')
                    : 'output.layout.json'
                : path.resolve(String(options.emitLayout));

        const { debug: _debug, ...exportedConfig } = config;
        const streamExport: AnnotatedLayoutStream = {
            streamVersion: '1.0',
            config: exportedConfig,
            pages,
        };

        const stringifyObj =
            options.omitGlyphs || options.quantize
                ? JSON.stringify(streamExport, (key, value) => {
                      if (key.startsWith('_')) return undefined;
                      if (options.omitGlyphs && key === 'glyphs') return undefined;
                      if (options.quantize && typeof value === 'number') {
                          if (Number.isInteger(value)) return value;
                          return Number(value.toFixed(3));
                      }
                      return value;
                  })
                : JSON.stringify(streamExport, (key, value) => (key.startsWith('_') ? undefined : value));

        fs.writeFileSync(layoutPath, stringifyObj, 'utf8');
    }

    const { width, height } = LayoutUtils.getPageDimensions(config);
    const renderer = new Renderer(config, !!options.debug, runtime, overlay);

    const outputStream = fs.createWriteStream(outputPath);
    const context = new ContextClass(outputStream, {
        size: [width, height],
        margins: { top: 0, left: 0, right: 0, bottom: 0 },
        autoFirstPage: false,
        bufferPages: false,
    });
    await renderer.render(pages, context);
    if (typeof context.waitForFinish === 'function') {
        await context.waitForFinish();
    }
    if (options.dumpIr !== undefined && document) {
        const irPath =
            options.dumpIr === true ? outputPath.replace(/\.pdf$/i, '.ir.json') : path.resolve(String(options.dumpIr));
        fs.writeFileSync(irPath, serializeDocumentIR(document), 'utf8');
    }
}

run().catch((error) => {
    console.error('[vmprint] Failed:', error);
    process.exit(1);
});
