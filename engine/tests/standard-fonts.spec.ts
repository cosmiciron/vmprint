import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ContextFontRegistrationOptions } from '@vmprint/contracts';
import { LayoutEngine } from '../src/engine/layout-engine';
import { Renderer } from '../src/engine/renderer';
import { toLayoutConfig, resolveDocumentPaths } from '../src/engine/document';
import { LayoutUtils } from '../src/engine/layout/layout-utils';
import { createEngineRuntime } from '../src/engine/runtime';
import { encodeStandardFontText } from '../src/font-management/standard-font-encoding';
import { getStandardFontMetadata, parseStandardFontSentinelBuffer } from '../src/font-management/sentinel';
import {
    assertFlatPipelineInvariants,
    HARNESS_REGRESSION_CASES_DIR,
    loadStandardFontManager,
    MockContext
} from './harness/engine-harness';

const FIXTURE_NAME = '16-standard-fonts-pdf14.json';
const EXPECTED_STANDARD_POSTSCRIPT_NAMES = [
    'Courier',
    'Courier-Bold',
    'Courier-BoldOblique',
    'Courier-Oblique',
    'Helvetica',
    'Helvetica-Bold',
    'Helvetica-BoldOblique',
    'Helvetica-Oblique',
    'Symbol',
    'Times-Bold',
    'Times-BoldItalic',
    'Times-Italic',
    'Times-Roman',
    'ZapfDingbats'
].sort();

type FontRegistrationCapture = {
    id: string;
    byteLength: number;
    standardFontPostScriptName?: string;
};

class StandardCaptureContext extends MockContext {
    public readonly registrations: FontRegistrationCapture[] = [];

    override async registerFont(
        id: string,
        buffer: Uint8Array,
        options?: ContextFontRegistrationOptions
    ): Promise<void> {
        this.registrations.push({
            id,
            byteLength: buffer.byteLength,
            standardFontPostScriptName: options?.standardFontPostScriptName
        });
    }
}

function logStep(message: string): void {
    console.log(`[standard-fonts.spec] ${message}`);
}

function check(description: string, expected: string, assertion: () => void): void {
    logStep(`CHECK: ${description}`);
    logStep(`EXPECT: ${expected}`);
    assertion();
    logStep(`PASS: ${description}`);
}

async function run() {
    const fixturePath = path.join(HARNESS_REGRESSION_CASES_DIR, FIXTURE_NAME);
    const fixture = resolveDocumentPaths(
        JSON.parse(fs.readFileSync(fixturePath, 'utf-8')),
        fixturePath
    );
    const config = toLayoutConfig(fixture, false);
    const StandardFontManager = await loadStandardFontManager();
    const runtime = createEngineRuntime({ fontManager: new StandardFontManager() });
    const engine = new LayoutEngine(config, runtime);

    await engine.waitForFonts();

    check(
        'standard-font encoder collapses unsupported Unicode to one fallback glyph per code point',
        'astral Unicode produces one default-width glyph instead of two UTF-16 surrogate glyphs',
        () => {
            const run = encodeStandardFontText('Helvetica', '🙂A');
            assert.equal(run.glyphs.length, 2, 'expected one glyph per Unicode code point');
            assert.equal(run.glyphs[0].supported, false, 'emoji should be unsupported in Helvetica');
            assert.equal(run.glyphs[0].advanceWidth, 278, 'unsupported glyph should use Helvetica default width');
            assert.equal(run.glyphs[0].encodedByte, 0x20, 'unsupported glyph should emit a stable-width fallback byte');
            assert.equal(run.glyphs[0].nominalWidth, 278, 'unsupported glyph should keep nominal width aligned with measurement');
            assert.equal(run.glyphs[1].supported, true, 'ASCII glyph should remain supported');
            assert.equal(run.glyphs[1].encodedByte, 0x41, 'ASCII A should remain WinAnsi byte 0x41');
        }
    );

    check(
        'standard-font encoder preserves WinAnsi extension characters',
        'characters like em dash and euro map to single-byte WinAnsi codes used by PDF standard fonts',
        () => {
            const run = encodeStandardFontText('Helvetica', '—€');
            assert.deepEqual(
                run.glyphs.map((glyph) => glyph.encodedByte),
                [0x97, 0x80],
                'unexpected WinAnsi bytes for em dash / euro'
            );
            assert.ok(run.glyphs.every((glyph) => glyph.supported), 'expected WinAnsi extension glyphs to stay supported');
        }
    );

    check(
        'all 14 standard fonts are loaded via sentinel buffers',
        'font cache contains exactly 14 standard font entries and each buffer is a 5-byte sentinel',
        () => {
            const cachedFontEntries = Object.entries(runtime.fontCache);
            const standardMetadata = cachedFontEntries
                .map(([, font]) => getStandardFontMetadata(font))
                .filter((value): value is NonNullable<typeof value> => !!value);
            const names = Array.from(new Set(standardMetadata.map((value) => value.postscriptName))).sort();
            assert.equal(standardMetadata.length, 14, `expected 14 standard font entries, got ${standardMetadata.length}`);
            assert.deepEqual(names, EXPECTED_STANDARD_POSTSCRIPT_NAMES, 'unexpected standard font set in cache');

            const cachedBuffers = Object.values(runtime.bufferCache);
            assert.equal(cachedBuffers.length, 14, `expected 14 font buffers, got ${cachedBuffers.length}`);
            cachedBuffers.forEach((buffer, index) => {
                assert.equal(buffer.byteLength, 5, `buffer[${index}] must be 5-byte sentinel`);
                assert.ok(parseStandardFontSentinelBuffer(buffer), `buffer[${index}] must parse as standard sentinel`);
            });
        }
    );

    const pages = engine.paginate(fixture.elements);
    check(
        'fixture paginates under StandardFontManager',
        'flat-pipeline invariants hold for the standard font specimen document',
        () => {
            assertFlatPipelineInvariants(pages, FIXTURE_NAME);
            assert.ok(pages.length > 0, 'expected at least one page');
        }
    );

    const { width, height } = LayoutUtils.getPageDimensions(config);
    const context = new StandardCaptureContext(width, height);
    const renderer = new Renderer(config, false, runtime);
    await renderer.render(pages, context);

    check(
        'renderer registers all standard fonts with metadata',
        '14 registrations use sentinel-size buffers and include standard PostScript names',
        () => {
            assert.equal(context.registrations.length, 14, `expected 14 registrations, got ${context.registrations.length}`);
            const names = Array.from(
                new Set(context.registrations.map((entry) => String(entry.standardFontPostScriptName || '')))
            ).sort();
            assert.deepEqual(names, EXPECTED_STANDARD_POSTSCRIPT_NAMES, 'unexpected registered standard PostScript names');

            context.registrations.forEach((entry, index) => {
                assert.equal(entry.byteLength, 5, `registration[${index}] should carry 5-byte sentinel buffer`);
                assert.ok(entry.standardFontPostScriptName, `registration[${index}] missing standard font metadata`);
            });
            assert.ok(context.textCalls > 0, 'expected renderer text draw calls');
        }
    );

    logStep('OK');
}

run().catch((err) => {
    console.error('[standard-fonts.spec] FAILED', err);
    process.exit(1);
});

