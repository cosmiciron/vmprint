import assert from 'node:assert/strict';
import { ContextTextOptions } from '@vmprint/contracts';
import { ContextRenderer } from '../src/engine/context-renderer';
import { LayoutConfig, Page } from '../src/engine/types';
import { setDefaultEngineRuntime } from '../src/engine/runtime';
import { createPrintEngineRuntime } from '../src/font-management/runtime';
import { loadLocalFontManager, MockContext } from './harness/engine-harness';
import { logStep } from './harness/test-utils';

const TEST_PREFIX = 'auto-direction.spec';
const log = (msg: string) => logStep(TEST_PREFIX, msg);

function buildConfig(): LayoutConfig {
    return {
        layout: {
            pageSize: { width: 320, height: 220 },
            margins: { top: 20, right: 20, bottom: 20, left: 20 },
            fontFamily: 'Arimo',
            fontSize: 12,
            lineHeight: 1.2,
            direction: 'auto'
        },
        fonts: { regular: 'Arimo' },
        styles: { p: { marginBottom: 8 } }
    };
}

async function testAutoDirectionUsesParagraphBaseForNeutralLeadingLines() {
    const config = buildConfig();
    const renderer = new ContextRenderer(config, false);
    const context = new MockContext();
    const paragraphX = 20;
    const paragraphW = 200;

    const pages: Page[] = [{
        index: 0,
        width: 320,
        height: 220,
        boxes: [{
            type: 'p',
            x: paragraphX,
            y: 20,
            w: paragraphW,
            h: 48,
            style: { direction: 'auto' },
            lines: ['(123)', 'مرحبا'] as any,
            properties: {}
        }]
    }];

    await renderer.render(pages, context as any);
    const neutral = context.textTrace.find((c) => c.str === '(123)');
    const arabic = context.textTrace.find((c) => c.str === 'مرحبا');
    assert.ok(neutral && arabic, 'expected both lines to render');

    const midpoint = paragraphX + (paragraphW / 2);
    assert.ok(neutral.x > midpoint, `expected neutral line to align from RTL side; x=${neutral.x}, midpoint=${midpoint}`);
    assert.ok(arabic.x > midpoint, `expected arabic line to align from RTL side; x=${arabic.x}, midpoint=${midpoint}`);
}

async function testMixedRtlRunReordersInsideLtrParagraph() {
    const config = buildConfig();
    const renderer = new ContextRenderer(config, false);
    const context = new MockContext();

    const pages: Page[] = [{
        index: 0,
        width: 320,
        height: 220,
        boxes: [{
            type: 'p',
            x: 20,
            y: 20,
            w: 260,
            h: 48,
            style: { direction: 'auto' },
            lines: [[
                { text: 'ENG', width: 30, ascent: 800, descent: 200, style: {} },
                { text: ' ', width: 8, ascent: 800, descent: 200, style: {} },
                { text: 'في', width: 20, ascent: 800, descent: 200, style: {}, direction: 'rtl' },
                // Simulate problematic upstream segmentation where spaces are tagged LTR.
                { text: ' ', width: 8, ascent: 800, descent: 200, style: {}, direction: 'ltr' },
                { text: 'البداية', width: 48, ascent: 800, descent: 200, style: {}, direction: 'rtl' }
            ]] as any,
            properties: {}
        }]
    }];

    await renderer.render(pages, context as any);
    const fi = context.textTrace.find((c) => c.str === 'في');
    const albidaya = context.textTrace.find((c) => c.str === 'البداية');
    assert.ok(fi && albidaya, 'expected mixed bidi line to render Arabic segments');
    assert.ok(albidaya.x < fi.x, `expected RTL run to be visually reversed inside LTR paragraph; البداية.x=${albidaya.x}, في.x=${fi.x}`);
}

async function run() {
    const LocalFontManager = await loadLocalFontManager();
    setDefaultEngineRuntime(createPrintEngineRuntime({ fontManager: new LocalFontManager() }));
    await testAutoDirectionUsesParagraphBaseForNeutralLeadingLines();
    await testMixedRtlRunReordersInsideLtrParagraph();
    log('OK');
}

run().catch((err) => {
    console.error(`[${TEST_PREFIX}] FAILED`, err);
    process.exit(1);
});
