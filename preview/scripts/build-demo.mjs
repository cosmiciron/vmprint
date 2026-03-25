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
    // Only keep shims needed for browser environments.
    // We let esbuild resolve @vmprint/preview from its own dist/ folder or node_modules.
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
