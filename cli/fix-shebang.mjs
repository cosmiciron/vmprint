import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const targetPath = path.join(__dirname, 'dist', 'index.js');
const shebang = '#!/usr/bin/env node';

if (!fs.existsSync(targetPath)) {
    console.error(`[fix-shebang] Missing CLI bundle: ${targetPath}`);
    process.exit(1);
}

const original = fs.readFileSync(targetPath, 'utf8');
const withoutLeadingShebangs = original.replace(/^(#!.*\r?\n)+/, '');
const normalized = `${shebang}\n${withoutLeadingShebangs}`;

if (normalized !== original) {
    fs.writeFileSync(targetPath, normalized);
    console.log('[fix-shebang] Normalized CLI shebang.');
} else {
    console.log('[fix-shebang] CLI shebang already correct.');
}
