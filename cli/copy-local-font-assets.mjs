import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sourceDir = path.resolve(__dirname, '..', 'font-managers', 'local', 'assets');
const targetDir = path.join(__dirname, 'dist', 'assets');

if (!fs.existsSync(sourceDir)) {
    console.error(`[copy-local-font-assets] Missing local font assets: ${sourceDir}`);
    process.exit(1);
}

fs.mkdirSync(path.dirname(targetDir), { recursive: true });
fs.rmSync(targetDir, { recursive: true, force: true });
fs.cpSync(sourceDir, targetDir, { recursive: true });

console.log('[copy-local-font-assets] Copied local font assets to dist/assets.');
