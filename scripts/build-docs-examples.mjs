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
    }
];

const aliases = {
    '@vmprint/contracts': path.join(repoRoot, 'contracts', 'src', 'index.ts'),
    '@vmprint/engine': path.join(repoRoot, 'engine', 'src', 'index.ts'),
    '@vmprint/standard-fonts': path.join(repoRoot, 'font-managers', 'standard', 'src', 'index.ts'),
    '@vmprint/context-pdf-lite': path.join(repoRoot, 'contexts', 'pdf-lite', 'src', 'index.ts'),
    fontkit: path.join(repoRoot, 'docs', 'examples', 'ast-to-pdf', 'src', 'shims', 'fontkit.ts'),
    html2canvas: path.join(repoRoot, 'docs', 'examples', 'ast-to-pdf', 'src', 'shims', 'html2canvas.ts'),
    canvg: path.join(repoRoot, 'docs', 'examples', 'ast-to-pdf', 'src', 'shims', 'canvg.ts'),
    dompurify: path.join(repoRoot, 'docs', 'examples', 'ast-to-pdf', 'src', 'shims', 'dompurify.ts')
};

async function buildAstToPdfExample(exampleRoot) {
    const srcDir = path.join(exampleRoot, 'src');
    const assetsDir = path.join(exampleRoot, 'assets');
    const fixtureSrcDir = path.join(srcDir, 'fixtures');
    const fixtureOutDir = path.join(exampleRoot, 'fixtures');
    fs.mkdirSync(assetsDir, { recursive: true });
    fs.rmSync(fixtureOutDir, { recursive: true, force: true });
    fs.mkdirSync(fixtureOutDir, { recursive: true });

    const fixtureFiles = fs
        .readdirSync(fixtureSrcDir)
        .filter((fileName) => fileName.endsWith('.json'))
        .sort();

    for (const fixtureFile of fixtureFiles) {
        const fixturePath = path.join(fixtureSrcDir, fixtureFile);
        const fixtureId = path.basename(fixtureFile, '.json');
        const fixtureScriptPath = path.join(fixtureOutDir, `${fixtureId}.js`);
        const fixtureJson = JSON.stringify(JSON.parse(fs.readFileSync(fixturePath, 'utf8')));
        const fixtureScript = [
            'window.VMPrintFixtureStore = window.VMPrintFixtureStore || Object.create(null);',
            `window.VMPrintFixtureStore[${JSON.stringify(fixtureId)}] = ${fixtureJson};`,
            ''
        ].join('\n');
        fs.writeFileSync(fixtureScriptPath, fixtureScript, 'utf8');
    }

    const builds = [
        {
            entryPoints: [path.join(srcDir, 'entries', 'vmprint-engine.ts')],
            outfile: path.join(assetsDir, 'vmprint-engine.js'),
            globalName: 'VMPrintEngine'
        },
        {
            entryPoints: [path.join(srcDir, 'entries', 'vmprint-standard-fonts-browser.ts')],
            outfile: path.join(assetsDir, 'vmprint-standard-fonts.js'),
            globalName: 'VMPrintStandardFonts'
        },
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
    ];

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
            alias: aliases
        });
    }
}

async function main() {
    for (const example of examples) {
        if (example.name === 'ast-to-pdf') {
            await buildAstToPdfExample(example.root);
        }
    }
    console.log('[docs:build] Built docs examples.');
}

main().catch((error) => {
    console.error('[docs:build] Failed:', error);
    process.exit(1);
});
