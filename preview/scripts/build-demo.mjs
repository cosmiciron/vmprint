import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const previewRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(previewRoot, '..');
const demoRoot = path.join(previewRoot, 'example');
const assetsDir = path.join(demoRoot, 'assets');

fs.mkdirSync(assetsDir, { recursive: true });

const aliases = {
    '@vmprint/contracts': path.join(repoRoot, 'contracts', 'src', 'index.ts'),
    '@vmprint/engine': path.join(repoRoot, 'engine', 'src', 'index.ts'),
    '@vmprint/context-canvas': path.join(repoRoot, 'contexts', 'canvas', 'src', 'index.ts'),
    '@vmprint/context-pdf-lite': path.join(repoRoot, 'contexts', 'pdf-lite', 'src', 'index.ts'),
    '@vmprint/local-fonts/config': path.join(repoRoot, 'font-managers', 'local', 'src', 'config.ts'),
    '@vmprint/web-fonts': path.join(repoRoot, 'font-managers', 'web', 'src', 'index.ts'),
    fontkit: path.join(repoRoot, 'node_modules', 'fontkit', 'dist', 'browser-module.mjs'),
    'node:perf_hooks': path.join(repoRoot, 'docs', 'examples', 'ast-to-canvas-webfonts', 'src', 'shims', 'perf-hooks.ts'),
    html2canvas: path.join(repoRoot, 'docs', 'examples', 'ast-to-canvas-webfonts', 'src', 'shims', 'html2canvas.ts'),
    canvg: path.join(repoRoot, 'docs', 'examples', 'ast-to-canvas-webfonts', 'src', 'shims', 'canvg.ts'),
    dompurify: path.join(repoRoot, 'docs', 'examples', 'ast-to-canvas-webfonts', 'src', 'shims', 'dompurify.ts')
};

await esbuild.build({
    bundle: true,
    entryPoints: [path.join(demoRoot, 'src', 'demo.ts')],
    outfile: path.join(assetsDir, 'demo.js'),
    format: 'iife',
    platform: 'browser',
    target: ['es2020'],
    sourcemap: false,
    minify: false,
    legalComments: 'none',
    logLevel: 'info',
    alias: aliases,
    loader: { '.yaml': 'text' }
});

console.log('[preview demo] Built example bundle.');
