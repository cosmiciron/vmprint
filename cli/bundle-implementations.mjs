/**
 * Copies compiled context and font-manager implementations into dist/bundled/
 * so the CLI can load them as defaults at runtime without compile-time coupling.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cliRoot = __dirname;
const repoRoot = path.resolve(__dirname, '..');

const destinations = [
    {
        src: path.join(repoRoot, 'contexts', 'pdf', 'dist'),
        dest: path.join(cliRoot, 'dist', 'bundled', 'contexts', 'pdf'),
        label: 'contexts/pdf'
    },
    {
        src: path.join(repoRoot, 'font-managers', 'local', 'dist'),
        dest: path.join(cliRoot, 'dist', 'bundled', 'font-managers', 'local'),
        label: 'font-managers/local'
    },
    {
        src: path.join(repoRoot, 'font-managers', 'local', 'assets'),
        dest: path.join(cliRoot, 'dist', 'bundled', 'font-managers', 'assets'),
        label: 'font-managers/local assets'
    }
];

for (const { src, dest, label } of destinations) {
    if (!fs.existsSync(src)) {
        console.error(`[bundle-implementations] Missing compiled output for ${label}: ${src}`);
        console.error(`  Run the build in that package first.`);
        process.exit(1);
    }
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.cpSync(src, dest, { recursive: true });
    // Write a CJS marker so Node treats these bundled files as CommonJS even
    // when the CLI package itself declares "type": "module".
    fs.writeFileSync(path.join(dest, 'package.json'), JSON.stringify({ type: 'commonjs' }, null, 2));
    console.log(`[bundle-implementations] Copied ${label} → dist/bundled`);
}
