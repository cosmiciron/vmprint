#!/usr/bin/env node
/**
 * Renders every scripting fixture to a PDF and places the output in
 *   engine/tests/fixtures/scripting/output/
 *
 * Usage (from workspace root):
 *   node engine/tests/fixtures/scripting/generate-fixture-pdfs.mjs
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const WORKSPACE_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const FIXTURES_DIR = __dirname;
const OUTPUT_DIR = path.join(FIXTURES_DIR, 'output');
const LOCAL_FONT_MANAGER = path.join(WORKSPACE_ROOT, 'font-managers', 'local', 'src', 'index.ts');

fs.mkdirSync(OUTPUT_DIR, { recursive: true });

const fixtures = fs.readdirSync(FIXTURES_DIR)
    .filter((file) => file.endsWith('.json'))
    .filter((file) => !file.endsWith('.expected.json'))
    .sort((a, b) => a.localeCompare(b));

let passed = 0;
let failed = 0;

for (const fixture of fixtures) {
    const inputPath = path.join(FIXTURES_DIR, fixture);
    const outputPath = path.join(OUTPUT_DIR, fixture.replace(/\.json$/i, '.pdf'));
    const cmd = [
        'npm run dev --workspace=cli --',
        `--input "${inputPath}"`,
        `--output "${outputPath}"`,
        `--font-manager "${LOCAL_FONT_MANAGER}"`
    ].join(' ');

    process.stdout.write(`  Rendering ${fixture} ... `);
    try {
        execSync(cmd, { cwd: WORKSPACE_ROOT, stdio: 'pipe' });
        console.log('OK');
        passed += 1;
    } catch (error) {
        console.log('FAILED');
        console.error(String(error?.stderr || error?.message || error));
        failed += 1;
    }
}

console.log(`\n[scripting generate-fixture-pdfs] Done - ${passed} succeeded, ${failed} failed.`);
if (failed > 0) {
    process.exit(1);
}
