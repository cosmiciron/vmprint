#!/usr/bin/env node
/**
 * generate-fixture-pdfs.mjs
 *
 * Renders every regression fixture to a PDF and places the output in
 *   engine/tests/fixtures/regression/output/
 *
 * Usage (from workspace root):
 *   node engine/tests/fixtures/regression/generate-fixture-pdfs.mjs
 *
 * The CLI auto-picks up a same-name .overlay.mjs sidecar when present,
 * so no extra flags are needed for overlay support.
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// ── Paths ────────────────────────────────────────────────────────────────────
const WORKSPACE_ROOT  = path.resolve(__dirname, '..', '..', '..', '..');
const REGRESSION_DIR  = __dirname;
const OUTPUT_DIR      = path.join(REGRESSION_DIR, 'output');
const LOCAL_FONT_MANAGER    = path.join(WORKSPACE_ROOT, 'font-managers', 'local', 'src', 'index.ts');
const STANDARD_FONT_MANAGER = path.join(WORKSPACE_ROOT, 'font-managers', 'standard', 'src', 'index.ts');

// ── Ensure output directory exists ───────────────────────────────────────────
if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    console.log(`[generate-fixture-pdfs] Created output directory: ${OUTPUT_DIR}`);
}

// ── Collect fixtures ──────────────────────────────────────────────────────────
const fixtures = fs.readdirSync(REGRESSION_DIR)
    .filter(f => f.endsWith('.json') && !f.endsWith('.snapshot.layout.json'))
    .sort((a, b) => a.localeCompare(b));

console.log(`[generate-fixture-pdfs] Found ${fixtures.length} fixtures to render.\n`);

// ── Render each fixture ───────────────────────────────────────────────────────
let passed = 0;
let failed = 0;
const failures = [];

for (const fixture of fixtures) {
    const inputPath  = path.join(REGRESSION_DIR, fixture);
    const baseName   = fixture.replace(/\.json$/i, '');
    const outputPath = path.join(OUTPUT_DIR, `${baseName}.pdf`);

    const isStandardFontsFixture = baseName === '16-standard-fonts-pdf14';
    const fontManagerPath = isStandardFontsFixture ? STANDARD_FONT_MANAGER : LOCAL_FONT_MANAGER;

    // CLI auto-picks up <baseName>.overlay.mjs in the same directory — no extra flag needed.
    const cmd = [
        `npm run dev --workspace=cli --`,
        `--input "${inputPath}"`,
        `--output "${outputPath}"`,
        `--font-manager "${fontManagerPath}"`,
    ].join(' ');

    process.stdout.write(`  Rendering ${fixture} … `);
    try {
        execSync(cmd, { cwd: WORKSPACE_ROOT, stdio: 'pipe' });
        console.log(`OK  →  output/${baseName}.pdf`);
        passed++;
    } catch (err) {
        const msg = err.stderr?.toString().trim() || err.message || 'unknown error';
        console.log(`FAILED`);
        console.error(`    ${msg.split('\n')[0]}`);
        failed++;
        failures.push({ fixture, error: msg });
    }
}

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n[generate-fixture-pdfs] Done — ${passed} succeeded, ${failed} failed.`);
if (failures.length > 0) {
    console.error('\nFailed fixtures:');
    failures.forEach(f => console.error(`  • ${f.fixture}`));
    process.exit(1);
}
console.log(`\nPDFs written to: ${OUTPUT_DIR}`);
