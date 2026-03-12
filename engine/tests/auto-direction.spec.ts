import assert from 'node:assert/strict';
import { ContextTextOptions } from '@vmprint/contracts';
import { Renderer } from '../src/engine/renderer';
import { LayoutConfig, Page } from '../src/engine/types';
import { createEngineRuntime, setDefaultEngineRuntime } from '../src/engine/runtime';
import { loadLocalFontManager } from './harness/engine-harness';

class MockContext {
    public pagesAdded = 0;
    public textCalls = 0;
    public calls: Array<{ str: string; x: number; y: number }> = [];

    addPage(): void { this.pagesAdded += 1; }
    end(): void { }
    async registerFont(_id: string, _buffer: Uint8Array): Promise<void> { }
    font(_family: string, _size?: number): this { return this; }
    fontSize(_size: number): this { return this; }
    save(): void { }
    restore(): void { }
    translate(_x: number, _y: number): this { return this; }
    rotate(_angle: number, _originX?: number, _originY?: number): this { return this; }
    opacity(_opacity: number): this { return this; }
    fillColor(_color: string): this { return this; }
    strokeColor(_color: string): this { return this; }
    lineWidth(_width: number): this { return this; }
    dash(_length: number, _options?: { space: number }): this { return this; }
    undash(): this { return this; }
    moveTo(_x: number, _y: number): this { return this; }
    lineTo(_x: number, _y: number): this { return this; }
    bezierCurveTo(_cp1x: number, _cp1y: number, _cp2x: number, _cp2y: number, _x: number, _y: number): this { return this; }
    rect(_x: number, _y: number, _w: number, _h: number): this { return this; }
    roundedRect(_x: number, _y: number, _w: number, _h: number, _r: number): this { return this; }
    fill(_rule?: 'nonzero' | 'evenodd'): this { return this; }
    stroke(): this { return this; }
    fillAndStroke(_fillColor?: string, _strokeColor?: string): this { return this; }
    text(str: string, x: number, y: number, _options?: ContextTextOptions): this {
        this.textCalls += 1;
        this.calls.push({ str, x, y });
        return this;
    }
    image(_source: string | Uint8Array, _x: number, _y: number, _options?: any): this { return this; }
    getSize(): { width: number; height: number } {
        return { width: 320, height: 220 };
    }
}

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
    const renderer = new Renderer(config, false);
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
    const neutral = context.calls.find((c) => c.str === '(123)');
    const arabic = context.calls.find((c) => c.str === 'مرحبا');
    assert.ok(neutral && arabic, 'expected both lines to render');

    const midpoint = paragraphX + (paragraphW / 2);
    assert.ok(neutral.x > midpoint, `expected neutral line to align from RTL side; x=${neutral.x}, midpoint=${midpoint}`);
    assert.ok(arabic.x > midpoint, `expected arabic line to align from RTL side; x=${arabic.x}, midpoint=${midpoint}`);
}

async function testMixedRtlRunReordersInsideLtrParagraph() {
    const config = buildConfig();
    const renderer = new Renderer(config, false);
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
    const fi = context.calls.find((c) => c.str === 'في');
    const albidaya = context.calls.find((c) => c.str === 'البداية');
    assert.ok(fi && albidaya, 'expected mixed bidi line to render Arabic segments');
    assert.ok(albidaya.x < fi.x, `expected RTL run to be visually reversed inside LTR paragraph; البداية.x=${albidaya.x}, في.x=${fi.x}`);
}

async function run() {
    const LocalFontManager = await loadLocalFontManager();
    setDefaultEngineRuntime(createEngineRuntime({ fontManager: new LocalFontManager() }));
    await testAutoDirectionUsesParagraphBaseForNeutralLeadingLines();
    await testMixedRtlRunReordersInsideLtrParagraph();
    console.log('[auto-direction.spec] OK');
}

run().catch((err) => {
    console.error('[auto-direction.spec] FAILED', err);
    process.exit(1);
});
