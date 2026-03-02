/**
 * Copies compiled context and font-manager implementations into dist/bundled/
 * so the CLI can load them as defaults at runtime without compile-time coupling.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cliRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(cliRoot, '..', '..');

const destinations = [
    {
        src: path.join(repoRoot, 'packages', 'context-pdf', 'dist'),
        dest: path.join(cliRoot, 'dist', 'bundled', 'contexts', 'pdf'),
        label: 'context-pdf',
    },
    {
        src: path.join(repoRoot, 'packages', 'local-fonts', 'dist'),
        dest: path.join(cliRoot, 'dist', 'bundled', 'font-managers', 'local'),
        label: 'local-fonts',
    },
    {
        src: path.join(repoRoot, 'packages', 'local-fonts', 'assets'),
        dest: path.join(cliRoot, 'dist', 'bundled', 'font-managers', 'assets'),
        label: 'local-fonts assets',
    },
];

for (const { src, dest, label } of destinations) {
    if (!fs.existsSync(src)) {
        console.error(`[bundle-implementations] Missing compiled output for ${label}: ${src}`);
        console.error(`  Run the build in that package first.`);
        process.exit(1);
    }
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.cpSync(src, dest, { recursive: true });
    console.log(`[bundle-implementations] Copied ${label} → dist/bundled`);
}
