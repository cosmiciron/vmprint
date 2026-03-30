import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const previewRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(previewRoot, '..');
const playgroundRoot = path.join(previewRoot, 'playground');
const dashboardRoot = path.join(previewRoot, 'dashboard');

const aliases = {
    '@vmprint/preview': path.join(previewRoot, 'src', 'index.ts'),
    '@proof/reactive-collector-pages': path.join(repoRoot, 'engine', 'tests', 'output', 'proofs', 'reactive-collector-board.pages.json'),
    '@proof/reactive-collector-timeline': path.join(repoRoot, 'engine', 'tests', 'output', 'proofs', 'reactive-collector-board.timeline.json'),
    '@proof/reactive-geometry-pages': path.join(repoRoot, 'engine', 'tests', 'output', 'proofs', 'reactive-geometry-board.pages.json'),
    '@proof/reactive-geometry-timeline': path.join(repoRoot, 'engine', 'tests', 'output', 'proofs', 'reactive-geometry-board.timeline.json'),
    '@proof/async-thought-pages': path.join(repoRoot, 'engine', 'tests', 'output', 'proofs', 'async-thought-board.pages.json'),
    '@proof/async-thought-timeline': path.join(repoRoot, 'engine', 'tests', 'output', 'proofs', 'async-thought-board.timeline.json'),
    '@proof/streaming-thought-pages': path.join(repoRoot, 'engine', 'tests', 'output', 'proofs', 'streaming-thought-board.pages.json'),
    '@proof/streaming-thought-timeline': path.join(repoRoot, 'engine', 'tests', 'output', 'proofs', 'streaming-thought-board.timeline.json'),
    '@proof/saucer-pages': path.join(repoRoot, 'engine', 'tests', 'output', 'proofs', 'saucer-flipbook.pages.json'),
    '@proof/saucer-timeline': path.join(repoRoot, 'engine', 'tests', 'output', 'proofs', 'saucer-flipbook.timeline.json'),
    fontkit: path.join(repoRoot, 'node_modules', 'fontkit', 'dist', 'browser-module.mjs'),
    perf_hooks: path.join(repoRoot, 'docs', 'examples', 'ast-to-canvas-webfonts', 'src', 'shims', 'perf-hooks.ts'),
    'node:perf_hooks': path.join(repoRoot, 'docs', 'examples', 'ast-to-canvas-webfonts', 'src', 'shims', 'perf-hooks.ts'),
    html2canvas: path.join(repoRoot, 'docs', 'examples', 'ast-to-canvas-webfonts', 'src', 'shims', 'html2canvas.ts'),
    canvg: path.join(repoRoot, 'docs', 'examples', 'ast-to-canvas-webfonts', 'src', 'shims', 'canvg.ts'),
    dompurify: path.join(repoRoot, 'docs', 'examples', 'ast-to-canvas-webfonts', 'src', 'shims', 'dompurify.ts')
};

const builds = [
    {
        name: 'playground',
        entry: path.join(playgroundRoot, 'src', 'demo.ts'),
        outfile: path.join(playgroundRoot, 'assets', 'demo.js')
    },
    {
        name: 'dashboard',
        entry: path.join(dashboardRoot, 'src', 'dashboard.ts'),
        outfile: path.join(dashboardRoot, 'assets', 'dashboard.js')
    }
];

for (const build of builds) {
    fs.mkdirSync(path.dirname(build.outfile), { recursive: true });
    await esbuild.build({
        bundle: true,
        entryPoints: [build.entry],
        outfile: build.outfile,
        format: 'iife',
        platform: 'browser',
        target: ['es2020'],
        sourcemap: false,
        minify: false,
        legalComments: 'none',
        logLevel: 'info',
        alias: aliases,
        loader: {
            '.json': 'json',
            '.yaml': 'text'
        }
    });
    console.log(`[preview demo] Built ${build.name} bundle.`);
}
