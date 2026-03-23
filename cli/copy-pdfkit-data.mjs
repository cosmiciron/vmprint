import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sourceDir = path.resolve(__dirname, '..', 'node_modules', 'pdfkit', 'js', 'data');
const targetDir = path.join(__dirname, 'dist', 'data');

if (!fs.existsSync(sourceDir)) {
    console.error(`[copy-pdfkit-data] Missing PDFKit data directory: ${sourceDir}`);
    process.exit(1);
}

fs.mkdirSync(targetDir, { recursive: true });

for (const file of fs.readdirSync(sourceDir)) {
    if (!file.endsWith('.afm') && !file.endsWith('.icc')) {
        continue;
    }
    fs.copyFileSync(path.join(sourceDir, file), path.join(targetDir, file));
}

console.log('[copy-pdfkit-data] Copied PDFKit AFM/ICC data to dist/data.');
