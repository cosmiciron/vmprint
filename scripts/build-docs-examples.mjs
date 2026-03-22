import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';

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
        name: 'mkd-to-ast',
        root: path.join(repoRoot, 'docs', 'examples', 'mkd-to-ast')
    }
];

const aliases = {
    '@vmprint/contracts': path.join(repoRoot, 'contracts', 'src', 'index.ts'),
    '@vmprint/engine': path.join(repoRoot, 'engine', 'src', 'index.ts'),
    '@vmprint/markdown-core': path.join(repoRoot, 'transmuters', 'markdown-core', 'src', 'index.ts'),
    '@vmprint/standard-fonts': path.join(repoRoot, 'font-managers', 'standard', 'src', 'index.ts'),
    '@vmprint/web-fonts': path.join(repoRoot, 'font-managers', 'web', 'src', 'index.ts'),
    '@vmprint/context-pdf-lite': path.join(repoRoot, 'contexts', 'pdf-lite', 'src', 'index.ts'),
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
    await buildAstLikeExample(exampleRoot, {
        entryPoints: [path.join(exampleRoot, 'src', 'entries', 'vmprint-web-fonts-browser.ts')],
        outfile: path.join(exampleRoot, 'assets', 'vmprint-web-fonts.js'),
        globalName: 'VMPrintWebFonts',
        alias: {
            ...aliases,
            fontkit: path.join(repoRoot, 'node_modules', 'fontkit', 'dist', 'browser-module.mjs')
        }
    });
}

async function buildMkdToAstExample(exampleRoot) {
    const transmutterRoot = path.join(repoRoot, 'transmuters', 'mkd-mkd');
    const srcDir = path.join(exampleRoot, 'src');
    const assetsDir = path.join(exampleRoot, 'assets');
    fs.mkdirSync(assetsDir, { recursive: true });

    const transmutterAliases = {
        '@vmprint/transmuter-mkd-mkd': path.join(transmutterRoot, 'src', 'index.ts')
    };

    await buildBrowserBundleSet([
        {
            entryPoints: [path.join(srcDir, 'entries', 'vmprint-transmuter.ts')],
            outfile: path.join(assetsDir, 'vmprint-transmuter.js'),
            globalName: 'VMPrintTransmuter',
            alias: { ...aliases, ...transmutterAliases }
        },
        {
            entryPoints: [path.join(srcDir, 'pipeline.ts')],
            outfile: path.join(assetsDir, 'pipeline.js'),
            globalName: 'MkdToAstPipeline',
            alias: { ...aliases, ...transmutterAliases }
        },
        {
            entryPoints: [path.join(srcDir, 'ui.ts')],
            outfile: path.join(assetsDir, 'ui.js'),
            alias: { ...aliases, ...transmutterAliases }
        }
    ]);
}

async function main() {
    for (const example of examples) {
        if (example.name === 'ast-to-pdf') {
            await buildAstToPdfExample(example.root);
        } else if (example.name === 'ast-to-pdf-webfonts') {
            await buildAstToPdfWebfontsExample(example.root);
        } else if (example.name === 'mkd-to-ast') {
            await buildMkdToAstExample(example.root);
        }
    }
    console.log('[docs:build] Built docs examples.');
}

main().catch((error) => {
    console.error('[docs:build] Failed:', error);
    process.exit(1);
});
