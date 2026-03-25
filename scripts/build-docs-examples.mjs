import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';
import { zipSync, strToU8 } from 'fflate';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const examples = [
    {
        name: 'ast-to-pdf',
        root: path.join(repoRoot, 'docs', 'examples', 'ast-to-pdf')
    },
    {
        name: 'ast-to-pdf-webfonts',
        root: path.join(repoRoot, 'docs', 'examples', 'ast-to-pdf-webfonts')
    },
    {
        name: 'ast-to-canvas-webfonts',
        root: path.join(repoRoot, 'docs', 'examples', 'ast-to-canvas-webfonts')
    },
    {
        name: 'mkd-to-ast',
        root: path.join(repoRoot, 'docs', 'examples', 'mkd-to-ast')
    },
    {
        name: 'preview',
        root: path.join(repoRoot, 'docs', 'examples', 'preview')
    }
];

const exampleArchiveName = 'vmprint-static-examples.zip';
const exampleArchiveRoot = 'vmprint-static-examples';

// Only alias the packages that remain as local workspaces in this repo.
// All others (contexts, font-managers, transmuters) are published npm packages
// and will be resolved naturally from node_modules.
const aliases = {
    '@vmprint/contracts': path.join(repoRoot, 'contracts', 'src', 'index.ts'),
    '@vmprint/engine': path.join(repoRoot, 'engine', 'src', 'index.ts'),
    fontkit: path.join(repoRoot, 'docs', 'examples', 'ast-to-pdf', 'src', 'shims', 'fontkit.ts'),
    'node:perf_hooks': path.join(repoRoot, 'docs', 'examples', 'ast-to-pdf', 'src', 'shims', 'perf-hooks.ts'),
    html2canvas: path.join(repoRoot, 'docs', 'examples', 'ast-to-pdf', 'src', 'shims', 'html2canvas.ts'),
    canvg: path.join(repoRoot, 'docs', 'examples', 'ast-to-pdf', 'src', 'shims', 'canvg.ts'),
    dompurify: path.join(repoRoot, 'docs', 'examples', 'ast-to-pdf', 'src', 'shims', 'dompurify.ts')
};

function emitFixtureScripts(srcDir, outDir) {
    fs.rmSync(outDir, { recursive: true, force: true });
    fs.mkdirSync(outDir, { recursive: true });

    const fixtureFiles = fs
        .readdirSync(srcDir)
        .filter((fileName) => fileName.endsWith('.json'))
        .sort();

    for (const fixtureFile of fixtureFiles) {
        const fixturePath = path.join(srcDir, fixtureFile);
        const fixtureId = path.basename(fixtureFile, '.json');
        const fixtureScriptPath = path.join(outDir, `${fixtureId}.js`);
        const fixtureJson = JSON.stringify(JSON.parse(fs.readFileSync(fixturePath, 'utf8')));
        const fixtureScript = [
            'window.VMPrintFixtureStore = window.VMPrintFixtureStore || Object.create(null);',
            `window.VMPrintFixtureStore[${JSON.stringify(fixtureId)}] = ${fixtureJson};`,
            ''
        ].join('\n');
        fs.writeFileSync(fixtureScriptPath, fixtureScript, 'utf8');
    }
}

async function buildBrowserBundleSet(builds) {
    for (const config of builds) {
        await esbuild.build({
            bundle: true,
            entryPoints: config.entryPoints,
            outfile: config.outfile,
            format: 'iife',
            globalName: config.globalName,
            platform: 'browser',
            target: ['es2020'],
            minify: true,
            legalComments: 'none',
            logLevel: 'info',
            alias: config.alias ?? aliases,
            loader: { '.yaml': 'text' }
        });
    }
}

async function buildAstLikeExample(exampleRoot, fontBundle) {
    const srcDir = path.join(exampleRoot, 'src');
    const assetsDir = path.join(exampleRoot, 'assets');
    fs.rmSync(assetsDir, { recursive: true, force: true });
    fs.mkdirSync(assetsDir, { recursive: true });
    emitFixtureScripts(path.join(srcDir, 'fixtures'), path.join(exampleRoot, 'fixtures'));

    await buildBrowserBundleSet([
        {
            entryPoints: [path.join(srcDir, 'entries', 'vmprint-engine.ts')],
            outfile: path.join(assetsDir, 'vmprint-engine.js'),
            globalName: 'VMPrintEngine',
            alias: fontBundle.alias ?? aliases
        },
        fontBundle,
        {
            entryPoints: [path.join(srcDir, 'entries', 'vmprint-context-pdf-lite.ts')],
            outfile: path.join(assetsDir, 'vmprint-context-pdf-lite.js'),
            globalName: 'VMPrintPdfLiteContext'
        },
        {
            entryPoints: [path.join(srcDir, 'pipeline.ts')],
            outfile: path.join(assetsDir, 'pipeline.js'),
            globalName: 'VMPrintPipeline'
        },
        {
            entryPoints: [path.join(srcDir, 'ui.ts')],
            outfile: path.join(assetsDir, 'ui.js')
        }
    ]);
}

async function buildAstToPdfExample(exampleRoot) {
    await buildAstLikeExample(exampleRoot, {
        entryPoints: [path.join(exampleRoot, 'src', 'entries', 'vmprint-standard-fonts-browser.ts')],
        outfile: path.join(exampleRoot, 'assets', 'vmprint-standard-fonts.js'),
        globalName: 'VMPrintStandardFonts'
    });
}

async function buildAstToPdfWebfontsExample(exampleRoot) {
    const webfontsAliases = {
        ...aliases,
        fontkit: path.join(exampleRoot, 'src', 'shims', 'fontkit.ts')
    };

    await buildAstLikeExample(exampleRoot, {
        entryPoints: [path.join(exampleRoot, 'src', 'entries', 'vmprint-web-fonts-browser.ts')],
        outfile: path.join(exampleRoot, 'assets', 'vmprint-web-fonts.js'),
        globalName: 'VMPrintWebFonts',
        alias: webfontsAliases
    });
    await esbuild.build({
        bundle: true,
        entryPoints: [path.join(exampleRoot, 'src', 'entries', 'vmprint-fontkit.ts')],
        outfile: path.join(exampleRoot, 'assets', 'vmprint-fontkit.js'),
        format: 'iife',
        globalName: 'VMPrintFontkit',
        platform: 'browser',
        target: ['es2020'],
        minify: true,
        legalComments: 'none',
        logLevel: 'info',
        alias: {
            ...aliases,
            fontkit: path.join(repoRoot, 'node_modules', 'fontkit', 'dist', 'browser-module.mjs')
        },
        loader: { '.yaml': 'text' }
    });
}

async function buildAstToCanvasWebfontsExample(exampleRoot) {
    const srcDir = path.join(exampleRoot, 'src');
    const assetsDir = path.join(exampleRoot, 'assets');
    fs.rmSync(assetsDir, { recursive: true, force: true });
    fs.mkdirSync(assetsDir, { recursive: true });
    emitFixtureScripts(path.join(srcDir, 'fixtures'), path.join(exampleRoot, 'fixtures'));

    const canvasAliases = {
        ...aliases,
        fontkit: path.join(exampleRoot, 'src', 'shims', 'fontkit.ts')
    };

    await buildBrowserBundleSet([
        {
            entryPoints: [path.join(srcDir, 'entries', 'vmprint-fontkit.ts')],
            outfile: path.join(assetsDir, 'vmprint-fontkit.js'),
            globalName: 'VMPrintFontkit',
            alias: {
                ...aliases,
                fontkit: path.join(repoRoot, 'node_modules', 'fontkit', 'dist', 'browser-module.mjs')
            }
        },
        {
            entryPoints: [path.join(srcDir, 'entries', 'vmprint-engine.ts')],
            outfile: path.join(assetsDir, 'vmprint-engine.js'),
            globalName: 'VMPrintEngine',
            alias: canvasAliases
        },
        {
            entryPoints: [path.join(srcDir, 'entries', 'vmprint-web-fonts-browser.ts')],
            outfile: path.join(assetsDir, 'vmprint-web-fonts.js'),
            globalName: 'VMPrintWebFonts',
            alias: canvasAliases
        },
        {
            entryPoints: [path.join(srcDir, 'entries', 'vmprint-context-canvas.ts')],
            outfile: path.join(assetsDir, 'vmprint-context-canvas.js'),
            globalName: 'VMPrintCanvasContext',
            alias: canvasAliases
        },
        {
            entryPoints: [path.join(srcDir, 'pipeline.ts')],
            outfile: path.join(assetsDir, 'pipeline.js'),
            globalName: 'VMPrintPipeline',
            alias: canvasAliases
        },
        {
            entryPoints: [path.join(srcDir, 'ui.ts')],
            outfile: path.join(assetsDir, 'ui.js'),
            alias: canvasAliases
        }
    ]);
}

async function buildPreviewExample(exampleRoot) {
    const previewPackageRoot = path.join(repoRoot, 'preview');
    const sourceDemoRoot = path.join(previewPackageRoot, 'example');

    fs.rmSync(exampleRoot, { recursive: true, force: true });
    fs.mkdirSync(path.join(exampleRoot, 'assets'), { recursive: true });

    // Copy static files from preview/example/
    fs.copyFileSync(path.join(sourceDemoRoot, 'index.html'), path.join(exampleRoot, 'index.html'));
    fs.copyFileSync(path.join(sourceDemoRoot, 'styles.css'), path.join(exampleRoot, 'styles.css'));
    fs.copyFileSync(path.join(sourceDemoRoot, 'assets', 'pdf.worker.mjs'), path.join(exampleRoot, 'assets', 'pdf.worker.mjs'));

    const previewAliases = {
        '@vmprint/preview': path.join(previewPackageRoot, 'src', 'index.ts'),
        '@vmprint/contracts': path.join(repoRoot, 'contracts', 'src', 'index.ts'),
        '@vmprint/engine': path.join(repoRoot, 'engine', 'src', 'index.ts'),
        fontkit: path.join(repoRoot, 'node_modules', 'fontkit', 'dist', 'browser-module.mjs'),
        'node:perf_hooks': path.join(repoRoot, 'docs', 'examples', 'ast-to-canvas-webfonts', 'src', 'shims', 'perf-hooks.ts'),
        html2canvas: path.join(repoRoot, 'docs', 'examples', 'ast-to-canvas-webfonts', 'src', 'shims', 'html2canvas.ts'),
        canvg: path.join(repoRoot, 'docs', 'examples', 'ast-to-canvas-webfonts', 'src', 'shims', 'canvg.ts'),
        dompurify: path.join(repoRoot, 'docs', 'examples', 'ast-to-canvas-webfonts', 'src', 'shims', 'dompurify.ts')
    };

    await esbuild.build({
        bundle: true,
        entryPoints: [path.join(sourceDemoRoot, 'src', 'demo.ts')],
        outfile: path.join(exampleRoot, 'assets', 'demo.js'),
        format: 'iife',
        platform: 'browser',
        target: ['es2020'],
        minify: true,
        legalComments: 'none',
        logLevel: 'info',
        alias: previewAliases,
        loader: { '.yaml': 'text' }
    });
}

async function buildMkdToAstExample(exampleRoot) {
    const srcDir = path.join(exampleRoot, 'src');
    const assetsDir = path.join(exampleRoot, 'assets');
    fs.rmSync(assetsDir, { recursive: true, force: true });
    fs.mkdirSync(assetsDir, { recursive: true });

    await buildBrowserBundleSet([
        {
            entryPoints: [path.join(srcDir, 'entries', 'vmprint-transmuter.ts')],
            outfile: path.join(assetsDir, 'vmprint-transmuter.js'),
            globalName: 'VMPrintTransmuter',
            alias: aliases
        },
        {
            entryPoints: [path.join(srcDir, 'pipeline.ts')],
            outfile: path.join(assetsDir, 'pipeline.js'),
            globalName: 'MkdToAstPipeline',
            alias: aliases
        },
        {
            entryPoints: [path.join(srcDir, 'ui.ts')],
            outfile: path.join(assetsDir, 'ui.js'),
            alias: aliases
        }
    ]);
}

function addDirectoryToArchive(entries, sourceDir, archiveDir, options = {}) {
    const { exclude = new Set() } = options;
    const items = fs.readdirSync(sourceDir, { withFileTypes: true });

    for (const item of items) {
        if (exclude.has(item.name)) {
            continue;
        }

        const sourcePath = path.join(sourceDir, item.name);
        const archivePath = `${archiveDir}/${item.name}`;

        if (item.isDirectory()) {
            addDirectoryToArchive(entries, sourcePath, archivePath, options);
            continue;
        }

        entries[archivePath] = fs.readFileSync(sourcePath);
    }
}

function buildExamplesArchive() {
    const archiveEntries = {
        [`${exampleArchiveRoot}/index.html`]: strToU8(
            fs.readFileSync(path.join(repoRoot, 'docs', 'examples', 'index.html'), 'utf8')
        )
    };

    for (const example of examples) {
        addDirectoryToArchive(
            archiveEntries,
            example.root,
            `${exampleArchiveRoot}/${example.name}`,
            { exclude: new Set(['src']) }
        );
    }

    const zipBytes = zipSync(archiveEntries, { level: 9 });
    fs.writeFileSync(path.join(repoRoot, 'docs', 'examples', exampleArchiveName), zipBytes);
}

async function main() {
    for (const example of examples) {
        if (example.name === 'ast-to-pdf') {
            await buildAstToPdfExample(example.root);
        } else if (example.name === 'ast-to-pdf-webfonts') {
            await buildAstToPdfWebfontsExample(example.root);
        } else if (example.name === 'ast-to-canvas-webfonts') {
            await buildAstToCanvasWebfontsExample(example.root);
        } else if (example.name === 'mkd-to-ast') {
            await buildMkdToAstExample(example.root);
        } else if (example.name === 'preview') {
            await buildPreviewExample(example.root);
        }
    }
    buildExamplesArchive();
    console.log('[docs:build] Built docs examples.');
}

main().catch((error) => {
    console.error('[docs:build] Failed:', error);
    process.exit(1);
});
