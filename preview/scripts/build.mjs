import path from 'node:path';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';
import { execSync } from 'node:child_process';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const previewRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(previewRoot, '..');

const distDir = path.join(previewRoot, 'dist');
if (fs.existsSync(distDir)) {
    fs.rmSync(distDir, { recursive: true });
}
fs.mkdirSync(distDir, { recursive: true });

const aliases = {
    '@vmprint/contracts': path.join(repoRoot, 'contracts', 'src', 'index.ts'),
    '@vmprint/engine': path.join(repoRoot, 'engine', 'src', 'index.ts'),
    'node:perf_hooks': path.join(repoRoot, 'docs', 'examples', 'ast-to-canvas-webfonts', 'src', 'shims', 'perf-hooks.ts'),
    'fontkit': path.join(repoRoot, 'node_modules', 'fontkit', 'dist', 'browser-module.mjs'),
};

async function build() {
    console.log('[preview] Bundling @vmprint/preview...');

    // Build ESM
    await esbuild.build({
        bundle: true,
        entryPoints: [path.join(previewRoot, 'src', 'index.ts')],
        outfile: path.join(distDir, 'index.mjs'),
        format: 'esm',
        platform: 'browser',
        target: ['es2020'],
        sourcemap: true,
        minify: true,
        alias: aliases,
        external: ['@vmprint/contracts'],
    });

    // Build CJS
    await esbuild.build({
        bundle: true,
        entryPoints: [path.join(previewRoot, 'src', 'index.ts')],
        outfile: path.join(distDir, 'index.cjs'),
        format: 'cjs',
        platform: 'browser',
        target: ['es2020'],
        sourcemap: true,
        minify: true,
        alias: aliases,
        external: ['@vmprint/contracts'],
    });

    console.log('[preview] Bundle complete.');

    console.log('[preview] Generating types...');
    try {
        execSync('npx tsc --emitDeclarationOnly --declaration --outDir dist/types', {
            cwd: previewRoot,
            stdio: 'inherit'
        });
        
        // This generates a tree of types. For a truly standalone package, we might want to bundle them.
        // But for now, let's at least have them.
        // To make them "standalone", we'd need a dts bundler.
    } catch (e) {
        console.error('[preview] Type generation failed:', e.message);
    }
}

build().catch((err) => {
    console.error(err);
    process.exit(1);
});
