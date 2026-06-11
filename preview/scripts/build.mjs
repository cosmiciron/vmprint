import path from 'node:path';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';
import { execSync } from 'node:child_process';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const previewRoot = path.resolve(__dirname, '..');
const distDir = path.join(previewRoot, 'dist');
const externalPackages = [
    '@vmprint/context-canvas',
    '@vmprint/context-pdf-lite',
    '@vmprint/engine',
    '@vmprint/local-fonts',
    '@vmprint/local-fonts/config',
    '@vmprint/web-fonts'
];

if (fs.existsSync(distDir)) {
    fs.rmSync(distDir, { recursive: true, force: true });
}
fs.mkdirSync(distDir, { recursive: true });

async function build() {
    console.log('[preview] Bundling @vmprint/preview...');

    for (const [format, outfile] of [
        ['esm', path.join(distDir, 'index.mjs')],
        ['cjs', path.join(distDir, 'index.cjs')]
    ]) {
        await esbuild.build({
            bundle: true,
            entryPoints: [path.join(previewRoot, 'src', 'index.ts')],
            outfile,
            format,
            platform: 'browser',
            target: ['es2020'],
            sourcemap: true,
            minify: true,
            external: externalPackages
        });
    }

    console.log('[preview] Bundle complete.');

    console.log('[preview] Generating types...');
    execSync('npx tsc --project tsconfig.json --emitDeclarationOnly --declaration --outDir dist/types', {
        cwd: previewRoot,
        stdio: 'inherit'
    });
}

build().catch((err) => {
    console.error(err);
    process.exit(1);
});
