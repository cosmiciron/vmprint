import assert from 'node:assert/strict';
import { LayoutEngine } from '../src/engine/layout-engine';
import { Renderer } from '../src/engine/renderer';
import { Context, ContextImageOptions, ContextTextOptions } from '@vmprint/contracts';
import { Element, LayoutConfig, Page } from '../src/engine/types';
import { createEngineRuntime, setDefaultEngineRuntime } from '../src/engine/runtime';
import { loadLocalFontManager, snapshotPages } from './harness/engine-harness';

function logStep(message: string): void {
    console.log(`[flat-pipeline.spec] ${message}`);
}

function check(description: string, expected: string, assertion: () => void): void {
    logStep(`CHECK: ${description}`);
    logStep(`EXPECT: ${expected}`);
    assertion();
    logStep(`PASS: ${description}`);
}

async function checkAsync(description: string, expected: string, assertion: () => Promise<void>): Promise<void> {
    logStep(`CHECK: ${description}`);
    logStep(`EXPECT: ${expected}`);
    await assertion();
    logStep(`PASS: ${description}`);
}

class MockContext implements Context {
    public pagesAdded = 0;
    public textCalls = 0;
    public imageCalls = 0;

    addPage(): void {
        this.pagesAdded += 1;
    }
    end(): void {}
    async registerFont(_id: string, _buffer: Uint8Array): Promise<void> {}
    font(_family: string, _size?: number): this {
        return this;
    }
    fontSize(_size: number): this {
        return this;
    }
    save(): void {}
    restore(): void {}
    translate(_x: number, _y: number): this {
        return this;
    }
    rotate(_angle: number, _originX?: number, _originY?: number): this {
        return this;
    }
    opacity(_opacity: number): this {
        return this;
    }
    fillColor(_color: string): this {
        return this;
    }
    strokeColor(_color: string): this {
        return this;
    }
    lineWidth(_width: number): this {
        return this;
    }
    dash(_length: number, _options?: { space: number }): this {
        return this;
    }
    undash(): this {
        return this;
    }
    moveTo(_x: number, _y: number): this {
        return this;
    }
    lineTo(_x: number, _y: number): this {
        return this;
    }
    bezierCurveTo(_cp1x: number, _cp1y: number, _cp2x: number, _cp2y: number, _x: number, _y: number): this {
        return this;
    }
    rect(_x: number, _y: number, _w: number, _h: number): this {
        return this;
    }
    roundedRect(_x: number, _y: number, _w: number, _h: number, _r: number): this {
        return this;
    }
    fill(_rule?: 'nonzero' | 'evenodd'): this {
        return this;
    }
    stroke(): this {
        return this;
    }
    fillAndStroke(_fillColor?: string, _strokeColor?: string): this {
        return this;
    }
    text(_str: string, _x: number, _y: number, _options?: ContextTextOptions): this {
        this.textCalls += 1;
        return this;
    }
    image(_source: string | Uint8Array, _x: number, _y: number, _options?: ContextImageOptions): this {
        this.imageCalls += 1;
        return this;
    }
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
            showPageNumbers: true,
        },
        fonts: {
            regular: 'Arimo',
        },
        styles: {
            filler: { height: 70, marginBottom: 0 },
            hero: { height: 70, marginBottom: 0, keepWithNext: true },
            body: { marginBottom: 8, allowLineSplit: true, orphans: 2, widows: 2 },
            p: { marginBottom: 8, allowLineSplit: true, orphans: 2, widows: 2 },
        },
    };
}

function assertNoBoxMutation(elements: Element[]) {
    const visit = (node: Element) => {
        assert.equal(node.properties?._box, undefined, 'input element was mutated with _box');
        if (node.children) {
            node.children.forEach(visit);
        }
    };
    elements.forEach(visit);
}

function collectMeasuredSegments(pages: Page[]) {
    const segments: any[] = [];
    for (const page of pages) {
        for (const box of page.boxes) {
            if (box.type === 'page_number') continue;
            if (!box.lines) continue;
            for (const line of box.lines) {
                for (const seg of line) {
                    segments.push(seg);
                }
            }
        }
    }
    return segments;
}

function assertMatrixOnlyMeasurements(pages: Page[]) {
    const segments = collectMeasuredSegments(pages);
    assert.ok(segments.length > 0, 'expected measured text segments');

    for (const seg of segments) {
        assert.equal(typeof seg.width, 'number', `segment width must be precomputed for "${seg.text}"`);
        assert.equal(typeof seg.ascent, 'number', `segment ascent must be precomputed for "${seg.text}"`);
        assert.equal(typeof seg.descent, 'number', `segment descent must be precomputed for "${seg.text}"`);
    }
}

async function testFlatPipeline() {
    logStep('Scenario: keepWithNext + paragraph split + renderer matrix-only guards');
    const config = buildConfig();
    const engine = new LayoutEngine(config);
    await engine.waitForFonts();

    const longText =
        'This paragraph is intentionally long to force line wrapping and line splitting across pages. '.repeat(24);

    const elements: Element[] = [
        { type: 'filler', content: 'filler' },
        { type: 'hero', content: 'hero heading', properties: { keepWithNext: true } },
        { type: 'body', content: longText, properties: { sourceId: 'body-main' } },
    ];

    const pages = engine.paginate(elements);
    check('paginate returns a pages array', 'an array with at least two pages', () => {
        assert.ok(Array.isArray(pages), 'paginate must return pages');
        assert.ok(pages.length >= 2, 'expected multiple pages');
    });

    const firstPageTypes = pages[0].boxes.map((b) => b.type);
    check(
        'keepWithNext sequence placement',
        'hero stays with a split body fragment instead of leaving page 1 underfilled',
        () => {
            const firstPageContentTypes = firstPageTypes.filter((t) => t !== 'page_number');
            assert.ok(firstPageContentTypes.includes('hero'), 'expected keepWithNext leader to remain on page 1');
            assert.ok(firstPageContentTypes.includes('body'), 'expected body to split and start on page 1');
        },
    );

    const bodyBoxes = pages.flatMap((p) => p.boxes.filter((b) => b.type === 'body'));
    check('long paragraph fragmentation', 'body content is split into multiple flow fragments across pages', () => {
        assert.ok(bodyBoxes.length >= 2, 'long paragraph should split across pages');
        assert.ok(
            bodyBoxes.some((b) => b.properties?._isLastLine === false),
            'expected a non-final split fragment',
        );
        assert.ok(
            bodyBoxes.some((b) => b.properties?._isFirstLine === false),
            'expected a non-initial split fragment',
        );
        assert.ok(
            bodyBoxes.every((b) => b.meta?.sourceId === 'author:body-main'),
            'expected stable author sourceId on all fragments',
        );
        assert.ok(
            bodyBoxes.every((b) => b.meta?.engineKey === bodyBoxes[0].meta?.engineKey),
            'expected stable engineKey on all fragments',
        );

        const fragmentIndices = bodyBoxes.map((b) => b.meta?.fragmentIndex);
        assert.deepEqual(
            fragmentIndices,
            Array.from({ length: bodyBoxes.length }, (_, idx) => idx),
            'expected contiguous fragmentIndex sequence',
        );

        assert.equal(bodyBoxes[0].meta?.isContinuation, false, 'initial fragment should not be marked as continuation');
        bodyBoxes.slice(1).forEach((box, idx) => {
            assert.equal(box.meta?.isContinuation, true, `fragment ${idx + 1} should be marked as continuation`);
        });
    });

    check('page index metadata', 'every box carries pageIndex metadata matching the page that contains it', () => {
        pages.forEach((page, pageIdx) => {
            page.boxes.forEach((box, boxIdx) => {
                assert.equal(
                    box.meta?.pageIndex,
                    pageIdx,
                    `expected pageIndex=${pageIdx} for box ${boxIdx} on page ${pageIdx}`,
                );
            });
        });
    });

    check(
        'flat box structure and precomputed segment metrics',
        'no nested layout containers and all segments provide width/ascent/descent',
        () => {
            pages.forEach((page) => {
                page.boxes.forEach((box: any) => {
                    assert.equal(box.children, undefined, 'flat boxes must not carry child layout containers');
                });
            });
            assertMatrixOnlyMeasurements(pages);
        },
    );

    check('input immutability', 'source elements remain unchanged after paginate', () => {
        assertNoBoxMutation(elements);
    });

    const renderer = new Renderer(config, false, engine.getRuntime());
    const context = new MockContext();
    await renderer.render(pages, context);
    check(
        'renderer consumes paginated output',
        'page count and text draw calls match expected non-empty render',
        () => {
            assert.equal(context.pagesAdded, pages.length, 'renderer should consume pages of flat boxes');
            assert.ok(context.textCalls > 0, 'renderer should draw text for boxes');
        },
    );

    const brokenPages = JSON.parse(JSON.stringify(pages)) as Page[];
    const brokenSegment = collectMeasuredSegments(brokenPages)[0];
    if (brokenSegment) {
        delete brokenSegment.width;
        await checkAsync(
            'renderer guardrail for missing matrix width',
            'rendering rejects mutated segments that have no precomputed width',
            async () => {
                await assert.rejects(
                    async () => renderer.render(brokenPages, new MockContext()),
                    /Missing precomputed width/,
                    'renderer must reject missing widths instead of estimating',
                );
            },
        );
    }
}

async function testEmbeddedImageFlowAndRender() {
    logStep('Scenario: embedded base64 image is laid out and rendered in flow order');
    const config = buildConfig();
    config.layout.showPageNumbers = false;

    const engine = new LayoutEngine(config);
    await engine.waitForFonts();

    const onePixelPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO9Wl9kAAAAASUVORK5CYII=';
    const elements: Element[] = [
        {
            type: 'image',
            content: '',
            properties: {
                style: {
                    width: 80,
                    marginBottom: 8,
                },
                image: {
                    data: onePixelPng,
                    mimeType: 'image/png',
                    fit: 'contain',
                },
            },
        },
        {
            type: 'p',
            content: 'Image follow-up text block to verify flow continuity after image placement.',
        },
    ];

    const pages = engine.paginate(elements);
    const imageBoxes = pages.flatMap((p) => p.boxes.filter((b) => b.type === 'image'));
    check(
        'embedded image flow layout',
        'image element produces a box with intrinsic-ratio-derived height when width is explicit',
        () => {
            assert.equal(imageBoxes.length, 1, 'expected one image box');
            assert.equal(Number(imageBoxes[0].w.toFixed(2)), 80);
            assert.equal(Number(imageBoxes[0].h.toFixed(2)), 80);
            assert.equal(imageBoxes[0].image?.mimeType, 'image/png');
        },
    );

    const renderer = new Renderer(config, false, engine.getRuntime());
    const context = new MockContext();
    await renderer.render(pages, context);
    check('embedded image render path', 'renderer emits at least one image draw call for image boxes', () => {
        assert.ok(context.imageCalls > 0, 'expected image draw calls');
    });
}

async function testInlineObjectsInsideRichTextFlow() {
    logStep('Scenario: inline image and inline box behave as in-run rich-text segments');
    const config = buildConfig();
    config.layout.showPageNumbers = false;

    const engine = new LayoutEngine(config);
    await engine.waitForFonts();

    const onePixelPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO9Wl9kAAAAASUVORK5CYII=';
    const elements: Element[] = [
        {
            type: 'p',
            content: '',
            properties: { style: { lineHeight: 1.25 } },
            children: [
                { type: 'text', content: 'Inline prefix ' },
                {
                    type: 'image',
                    content: '',
                    properties: {
                        style: {
                            width: 18,
                            height: 18,
                            verticalAlign: 'middle',
                            baselineShift: -1,
                            inlineOpticalInsetTop: 1,
                            inlineOpticalInsetBottom: 2,
                            inlineMarginLeft: 1,
                            inlineMarginRight: 2,
                        },
                        image: { data: onePixelPng, mimeType: 'image/png', fit: 'contain' },
                    },
                },
                { type: 'text', content: ' and ' },
                {
                    type: 'inline-box',
                    content: 'TAG',
                    properties: {
                        style: {
                            paddingLeft: 3,
                            paddingRight: 3,
                            paddingTop: 1,
                            paddingBottom: 1,
                            borderWidth: 1,
                            borderColor: '#888',
                            backgroundColor: '#f3f4f6',
                            fontSize: 10,
                            verticalAlign: 'text-bottom',
                            baselineShift: 0.5,
                            inlineMarginLeft: 2,
                            inlineMarginRight: 3,
                        },
                    },
                },
                { type: 'text', content: ' suffix.' },
            ],
        },
    ];

    const pages = engine.paginate(elements);
    const firstPara = pages.flatMap((p) => p.boxes).find((b) => b.type === 'p');
    const segments = (firstPara?.lines || []).flat();

    check(
        'inline rich object extraction + layout',
        'paragraph lines include inline image and inline box segments with measured dimensions',
        () => {
            assert.ok(firstPara, 'expected paragraph box');
            assert.ok(
                segments.some((seg: any) => seg.inlineObject?.kind === 'image'),
                'expected inline image segment',
            );
            assert.ok(
                segments.some((seg: any) => seg.inlineObject?.kind === 'box'),
                'expected inline box segment',
            );
            const inlineSegments = segments.filter((seg: any) => !!seg.inlineObject);
            assert.ok(
                inlineSegments.every((seg: any) => typeof seg.width === 'number' && seg.width > 0),
                'expected measured inline widths',
            );
            assert.ok(
                inlineSegments.every((seg: any) => typeof seg.ascent === 'number' && seg.ascent > 0),
                'expected inline ascent metrics',
            );
            assert.ok(
                inlineSegments.every((seg: any) => !!seg.inlineMetrics),
                'expected inline metrics payload',
            );
            const inlineImage = inlineSegments.find((seg: any) => seg.inlineObject?.kind === 'image');
            const inlineBox = inlineSegments.find((seg: any) => seg.inlineObject?.kind === 'box');
            assert.equal(inlineImage?.inlineMetrics?.verticalAlign, 'middle');
            assert.equal(inlineBox?.inlineMetrics?.verticalAlign, 'text-bottom');
            assert.ok((inlineImage?.inlineMetrics?.marginLeft || 0) > 0, 'expected inline image leading margin');
            assert.ok((inlineBox?.inlineMetrics?.marginRight || 0) > 0, 'expected inline box trailing margin');
            assert.ok(
                Number(inlineImage?.inlineMetrics?.opticalHeight || 0) <
                    Number(inlineImage?.inlineMetrics?.contentHeight || 0),
                'expected optical inline height to be trimmed by insets',
            );
            assert.ok(
                Number(inlineImage?.inlineMetrics?.opticalInsetTop || 0) > 0,
                'expected optical top inset to be captured',
            );
            assert.ok(
                Number(inlineImage?.width || 0) > Number(inlineImage?.inlineMetrics?.contentWidth || 0),
                'expected total inline width to include margins',
            );
        },
    );

    const renderer = new Renderer(config, false, engine.getRuntime());
    const context = new MockContext();
    await renderer.render(pages, context);
    check(
        'inline rich object render path',
        'renderer emits at least one image draw call while still drawing text',
        () => {
            assert.ok(context.textCalls > 0, 'expected text draw calls');
            assert.ok(context.imageCalls > 0, 'expected inline image draw calls');
        },
    );
}

async function testMultilingualMatrixOnlyRegression() {
    logStep('Scenario: deterministic multilingual measurement stability');
    const config = buildConfig();
    config.layout.pageSize = { width: 300, height: 240 };
    config.layout.margins = { top: 20, right: 20, bottom: 20, left: 20 };

    const engine = new LayoutEngine(config);
    await engine.waitForFonts();

    const mixed =
        'Latin words wrapping with ä¸­æ–‡å­—ç¬¦ and à¸ à¸²à¸©à¸²à¹„à¸—à¸¢ plus í•œêµ­ì–´ ë¬¸ìž¥ for matrix-only measurement stability. '.repeat(
            8,
        );
    const elements: Element[] = [{ type: 'p', content: mixed }];

    const pagesA = engine.paginate(elements);
    const pagesB = engine.paginate(elements);

    check(
        'multilingual pagination emits pages with measured segments',
        'at least one page and all segments include matrix-only metrics',
        () => {
            assert.ok(pagesA.length >= 1, 'expected multilingual pagination output');
            assertMatrixOnlyMeasurements(pagesA);
        },
    );

    const widthsA = collectMeasuredSegments(pagesA).map((s) => Number(s.width).toFixed(6));
    const widthsB = collectMeasuredSegments(pagesB).map((s) => Number(s.width).toFixed(6));
    check(
        'deterministic widths across repeated paginate runs',
        'identical multilingual input yields identical segment widths',
        () => {
            assert.deepEqual(
                widthsA,
                widthsB,
                'wrapping/measurement should be stable for identical multilingual input',
            );
        },
    );
}

async function testWidowOrphanEnforcement() {
    logStep('Scenario: widow/orphan thresholds gate line splitting');
    const config = buildConfig();
    config.layout.showPageNumbers = false;
    config.layout.pageSize = { width: 300, height: 180 };
    config.layout.margins = { top: 20, right: 20, bottom: 20, left: 20 };

    const engine = new LayoutEngine(config);
    await engine.waitForFonts();

    const longText = 'Widow orphan enforcement text forcing wraps and pagination boundaries. '.repeat(36);

    const splitAllowed: Element[] = [
        {
            type: 'p',
            content: longText,
            properties: { style: { allowLineSplit: true, orphans: 2, widows: 2 } },
        },
    ];

    const splitBlocked: Element[] = [
        {
            type: 'p',
            content: longText,
            properties: { style: { allowLineSplit: true, orphans: 2, widows: 999 } },
        },
    ];

    const pagesAllowed = engine.paginate(splitAllowed);
    const pagesBlocked = engine.paginate(splitBlocked);

    const allowedBoxes = pagesAllowed.flatMap((p) => p.boxes.filter((b) => b.type === 'p'));
    const blockedBoxes = pagesBlocked.flatMap((p) => p.boxes.filter((b) => b.type === 'p'));

    check(
        'widow/orphan allows split with default thresholds',
        'paragraph emits multiple flow fragments when widow/orphan thresholds are satisfiable',
        () => {
            assert.ok(allowedBoxes.length >= 2, 'expected split into multiple paragraph fragments');
            assert.ok(
                allowedBoxes.some((b) => b.properties?._isLastLine === false),
                'expected non-final split fragment',
            );
            assert.ok(
                allowedBoxes.some((b) => b.properties?._isFirstLine === false),
                'expected non-initial split fragment',
            );
        },
    );

    check(
        'widow threshold blocks split when unsatisfiable',
        'paragraph remains a single oversized box when widow requirement cannot be met',
        () => {
            assert.equal(blockedBoxes.length, 1, 'split should be blocked by unsatisfiable widow threshold');
            const contentAreaHeight = 180 - 20 - 20;
            assert.ok(blockedBoxes[0].h > contentAreaHeight, 'blocked paragraph should remain oversized on the page');
        },
    );
}

async function testWidowOrphanBackletterSpacingAndMultilingual() {
    logStep('Scenario: widow/orphan backtracking and multilingual splitting constraints');
    const config = buildConfig();
    config.layout.showPageNumbers = false;
    config.layout.pageSize = { width: 300, height: 220 };
    config.layout.margins = { top: 20, right: 20, bottom: 20, left: 20 };

    const engine = new LayoutEngine(config);
    await engine.waitForFonts();

    const orphans = 2;
    const widows = 4;
    const element: Element = {
        type: 'p',
        content:
            'Widow orphan backtracking enforcement text designed to produce many wrapped lines for split-point selection. '.repeat(
                26,
            ),
        properties: { style: { allowLineSplit: true, orphans, widows } },
    };

    const paraPages = engine.paginate([element]);
    const paraBoxes = paraPages.flatMap((p) => p.boxes.filter((b) => b.type === 'p'));

    check(
        'paragraph splits across pages with orphans/widows configured',
        'long paragraph with allowLineSplit produces at least two fragments',
        () => {
            assert.ok(paraBoxes.length >= 2, 'expected paragraph to split into multiple fragments');
        },
    );

    check(
        'all continuation fragments satisfy widow minimum',
        'every continuation fragment carries at least widows lines, proving backtracking fires when needed',
        () => {
            const continuations = paraBoxes.filter((b) => b.meta?.isContinuation === true);
            assert.ok(continuations.length >= 1, 'expected at least one continuation fragment');
            continuations.forEach((box, idx) => {
                const lineCount = (box.lines || []).length;
                assert.ok(
                    lineCount >= widows,
                    `continuation fragment ${idx} has ${lineCount} lines, expected >= widows=${widows}`,
                );
            });
        },
    );

    check('first fragment satisfies orphan minimum', 'first paragraph fragment carries at least orphans lines', () => {
        if (paraBoxes.length >= 2) {
            const lineCount = (paraBoxes[0].lines || []).length;
            assert.ok(lineCount >= orphans, `first fragment has ${lineCount} lines, expected >= orphans=${orphans}`);
        }
    });

    const multilingual: Element[] = [
        {
            type: 'p',
            content:
                'Latin with ä¸­æ–‡å­—ç¬¦ and à¸ à¸²à¸©à¸²à¹„à¸—à¸¢ plus í•œêµ­ì–´ ë¬¸ìž¥ and Ø§Ù„Ø¹Ø±Ø¨ÙŠØ© words to verify multilingual widow/orphan-safe splitting. '.repeat(
                    18,
                ),
            properties: { style: { allowLineSplit: true, orphans: 3, widows: 3 } },
        },
    ];

    const multiPages = engine.paginate(multilingual);
    const multiBoxes = multiPages.flatMap((p) => p.boxes.filter((b) => b.type === 'p'));

    check(
        'multilingual content respects widow/orphan control',
        'mixed-script paragraph splits across pages while preserving first/last fragment flags',
        () => {
            assert.ok(multiBoxes.length >= 2, 'expected multilingual paragraph to split across pages');
            assert.ok(
                multiBoxes.some((b) => b.properties?._isLastLine === false),
                'expected non-final multilingual fragment',
            );
            assert.ok(
                multiBoxes.some((b) => b.properties?._isFirstLine === false),
                'expected non-initial multilingual fragment',
            );
        },
    );
}

async function testPerBoxOverflowPolicy() {
    logStep('Scenario: explicit per-box overflowPolicy controls split fallback behavior');
    const config = buildConfig();
    config.layout.showPageNumbers = false;
    config.layout.pageSize = { width: 300, height: 180 };
    config.layout.margins = { top: 20, right: 20, bottom: 20, left: 20 };

    const engine = new LayoutEngine(config);
    await engine.waitForFonts();

    const text =
        'Overflow policy paragraph designed to exceed one page and trigger split or clipping behavior. '.repeat(34);

    const defaultPolicyPages = engine.paginate([
        {
            type: 'p',
            content: text,
            properties: { style: { allowLineSplit: true, orphans: 2, widows: 2 } },
        },
    ]);

    const moveWholePages = engine.paginate([
        {
            type: 'p',
            content: text,
            properties: { style: { allowLineSplit: true, orphans: 2, widows: 2, overflowPolicy: 'move-whole' } },
        },
    ]);

    const defaultBoxes = defaultPolicyPages.flatMap((p) => p.boxes.filter((b) => b.type === 'p'));
    const moveWholeBoxes = moveWholePages.flatMap((p) => p.boxes.filter((b) => b.type === 'p'));

    check(
        'unspecified overflowPolicy keeps existing split behavior',
        'long paragraph splits into multiple fragments under default clip behavior',
        () => {
            assert.ok(defaultBoxes.length >= 2, 'expected default behavior to split long paragraph');
            assert.ok(
                defaultBoxes.some((b) => b.properties?._isLastLine === false),
                'expected non-final split fragment for default policy',
            );
        },
    );

    check(
        'move-whole is honored when explicitly set on the box',
        'same paragraph remains a single clipped box instead of splitting',
        () => {
            assert.equal(moveWholeBoxes.length, 1, 'move-whole should prevent splitting for oversized box');
            const contentAreaHeight = 180 - 20 - 20;
            assert.ok(
                moveWholeBoxes[0].h > contentAreaHeight,
                'move-whole fallback should keep oversized single fragment',
            );
        },
    );

    await checkAsync(
        'invalid overflowPolicy value is rejected',
        'paginate throws a clear validation error for unsupported policy strings',
        async () => {
            assert.throws(
                () => {
                    engine.paginate([
                        {
                            type: 'p',
                            content: 'bad overflowPolicy',
                            properties: { style: { overflowPolicy: 'invalid-policy' } },
                        },
                    ]);
                },
                /Invalid overflowPolicy/,
                'expected invalid overflowPolicy to throw',
            );
        },
    );
}

async function testPaginationContinuationMarkers() {
    logStep('Scenario: split boxes can inject continuation markers before/after page break');
    const config = buildConfig();
    config.layout.showPageNumbers = false;
    config.layout.pageSize = { width: 300, height: 180 };
    config.layout.margins = { top: 20, right: 20, bottom: 20, left: 20 };
    config.styles.cue = { fontWeight: 700, marginTop: 0, marginBottom: 0, keepWithNext: true };
    config.styles.dialogue = { marginTop: 0, marginBottom: 6, allowLineSplit: true, orphans: 2, widows: 2 };
    config.styles.more = { marginTop: 0, marginBottom: 0, textAlign: 'center' };

    const engine = new LayoutEngine(config);
    await engine.waitForFonts();

    const longDialogue = 'Continuation marker validation text that should wrap and split across pages. '.repeat(32);
    const elements: Element[] = [
        { type: 'cue', content: 'MAYA', properties: { keepWithNext: true } },
        {
            type: 'dialogue',
            content: longDialogue,
            properties: {
                sourceId: 'dialogue-main',
                paginationContinuation: {
                    enabled: true,
                    markerAfterSplit: {
                        type: 'more',
                        content: '(MORE)',
                    },
                    markerBeforeContinuation: {
                        type: 'cue',
                        content: "MAYA (CONT'D)",
                        properties: { keepWithNext: true },
                    },
                },
            },
        },
    ];

    const pages = engine.paginate(elements);
    const allTypes = pages.flatMap((p) => p.boxes.map((b) => b.type));

    check(
        'continuation markers are emitted around split dialogue',
        'split pagination yields at least one trailing "more" box and at least one continued cue',
        () => {
            assert.ok(pages.length >= 2, 'expected multiple pages for long dialogue');
            assert.ok(allTypes.includes('more'), 'expected a post-split "(MORE)" marker box');
            const cueBoxes = pages.flatMap((p) => p.boxes.filter((b) => b.type === 'cue'));
            assert.ok(cueBoxes.length >= 2, 'expected original and continued cue boxes');
        },
    );

    check(
        'continuation marker identity metadata',
        'generated marker boxes carry generated/continuation metadata linked to dialogue sourceId',
        () => {
            const markerBoxes = pages
                .flatMap((p) => p.boxes)
                .filter((b) => b.type === 'more' || b.type === 'cue')
                .filter((b) => b.properties?._generatedContinuation === true);

            assert.ok(markerBoxes.length >= 2, 'expected generated continuation markers');
            markerBoxes.forEach((box) => {
                assert.equal(box.meta?.generated, true, 'expected generated marker metadata flag');
                assert.equal(
                    box.meta?.isContinuation,
                    true,
                    'expected continuation marker to be flagged as continuation',
                );
                assert.equal(
                    box.meta?.originSourceId,
                    'author:dialogue-main',
                    'expected continuation marker to link back to origin sourceId',
                );
                assert.ok(
                    (box.meta?.sourceId || '').startsWith('gen:author:dialogue-main:marker-'),
                    'expected generated sourceId prefix',
                );
            });

            const dialogueBoxes = pages.flatMap((p) => p.boxes.filter((b) => b.type === 'dialogue'));
            assert.ok(dialogueBoxes.length >= 2, 'expected split dialogue fragments');
            assert.ok(
                dialogueBoxes.every((b) => b.meta?.sourceId === 'author:dialogue-main'),
                'expected stable dialogue sourceId across split fragments',
            );
        },
    );

    check(
        'continued cue leads continuation page',
        'first non-page-number box on the continuation page is cue before resumed dialogue',
        () => {
            const getBoxText = (box: Page['boxes'][number]): string => {
                if (typeof box.content === 'string' && box.content.length > 0) return box.content;
                if (!box.lines || box.lines.length === 0) return '';
                return box.lines[0].map((seg: any) => seg?.text || '').join('');
            };

            const continuationPage = pages.find((page) =>
                page.boxes.some((box) => box.type === 'cue' && getBoxText(box).includes("CONT'D")),
            );
            assert.ok(continuationPage, "expected a continuation page with CONT'D cue");

            const firstType = continuationPage!.boxes.find((b) => b.type !== 'page_number')?.type;
            assert.equal(firstType, 'cue', 'expected continuation page to begin with cue marker');
        },
    );
}

async function testKeepWithNextChainMidPageSplitsTailUnit() {
    logStep('Scenario: keepWithNext chain mid-page splits tail unit instead of forcing full-sequence push');
    const config = buildConfig();
    config.layout.showPageNumbers = false;
    config.layout.pageSize = { width: 300, height: 180 };
    config.layout.margins = { top: 20, right: 20, bottom: 20, left: 20 };
    config.styles.filler = { height: 70, marginBottom: 0 };
    config.styles.lead = { marginTop: 6, marginBottom: 0, keepWithNext: true };
    config.styles.note = { marginTop: 0, marginBottom: 0, keepWithNext: true };
    config.styles.body = { marginTop: 0, marginBottom: 6, allowLineSplit: true, orphans: 2, widows: 2 };

    const engine = new LayoutEngine(config);
    await engine.waitForFonts();

    const longText =
        'Mid-page keepWithNext chain should split this tail paragraph across pages while preserving prefix adjacency. '.repeat(
            28,
        );
    const elements: Element[] = [
        { type: 'filler', content: 'filler' },
        { type: 'lead', content: 'LEAD', properties: { keepWithNext: true } },
        { type: 'note', content: '(note)', properties: { keepWithNext: true } },
        { type: 'body', content: longText },
    ];

    const pages = engine.paginate(elements);
    const firstPageTypes = pages[0].boxes.map((b) => b.type);
    const bodyBoxes = pages.flatMap((p) => p.boxes.filter((b) => b.type === 'body'));

    check(
        'mid-page keepWithNext splitting',
        'page 1 includes lead/note/body instead of leaving only filler before the break',
        () => {
            assert.ok(pages.length >= 2, 'expected pagination across multiple pages');
            assert.deepEqual(
                firstPageTypes,
                ['filler', 'lead', 'note', 'body'],
                'expected keep chain prefix and split body fragment on page 1',
            );
            assert.ok(bodyBoxes.length >= 2, 'expected tail body to split across pages');
        },
    );
}

async function testKeepWithNextChainAtPageTopDoesNotStrandPrefixes() {
    logStep('Scenario: keepWithNext chain at page top splits dialogue instead of stranding cue/parenthetical');
    const config = buildConfig();
    config.layout.showPageNumbers = false;
    config.layout.pageSize = { width: 300, height: 200 };
    config.layout.margins = { top: 20, right: 20, bottom: 20, left: 20 };
    config.styles.cue = { fontWeight: 700, marginTop: 0, marginBottom: 0, keepWithNext: true };
    config.styles.parenthetical = { fontStyle: 'italic', marginTop: 0, marginBottom: 0, keepWithNext: true };
    config.styles.dialogue = { marginTop: 0, marginBottom: 6, allowLineSplit: true, orphans: 1, widows: 1 };
    config.styles.more = { marginTop: 0, marginBottom: 0, textAlign: 'center' };

    const engine = new LayoutEngine(config);
    await engine.waitForFonts();

    const longDialogue = 'word '.repeat(300);
    const elements: Element[] = [
        { type: 'cue', content: 'DR. MIRA QUELL', properties: { keepWithNext: true } },
        { type: 'parenthetical', content: '(adjusting her headset)', properties: { keepWithNext: true } },
        {
            type: 'dialogue',
            content: longDialogue,
        },
    ];

    const pages = engine.paginate(elements);
    const nonPageTypesByPage = pages.map((page) =>
        page.boxes.filter((b) => b.type !== 'page_number').map((b) => b.type),
    );

    check(
        'keepWithNext prefix chain is preserved at page top',
        'no page contains only a stranded cue or only a stranded parenthetical',
        () => {
            const strandedCuePage = nonPageTypesByPage.find((types) => types.length === 1 && types[0] === 'cue');
            const strandedParentheticalPage = nonPageTypesByPage.find(
                (types) => types.length === 1 && types[0] === 'parenthetical',
            );
            assert.equal(strandedCuePage, undefined, 'cue should not be stranded alone on a page');
            assert.equal(strandedParentheticalPage, undefined, 'parenthetical should not be stranded alone on a page');
        },
    );
}

async function testAdvancedJustifyAndHyphenation() {
    logStep('Scenario: advanced justify engine and hyphenation precompute segment spacing/splits');
    const config = buildConfig();
    config.layout.showPageNumbers = false;
    config.layout.pageSize = { width: 280, height: 260 };
    config.layout.margins = { top: 20, right: 20, bottom: 20, left: 20 };
    config.layout.justifyEngine = 'advanced';

    const engine = new LayoutEngine(config);
    await engine.waitForFonts();

    const justifyElements: Element[] = [
        {
            type: 'p',
            content:
                'Advanced justification should distribute expansion across multiple legal boundaries in mixed scripts with English words and ä¸­æ–‡ç‰‡æ®µ to verify line-level spacing metadata.',
            properties: {
                style: {
                    width: 200,
                    textAlign: 'justify',
                    justifyEngine: 'advanced',
                },
            },
        },
    ];

    const justifyPages = engine.paginate(justifyElements);
    const justifyBox = justifyPages.flatMap((p) => p.boxes).find((b) => b.type === 'p');
    assert.ok(
        justifyBox?.lines && justifyBox.lines.length > 1,
        'expected wrapped lines for advanced justification test',
    );

    const nonLastLines = justifyBox!.lines!.slice(0, -1);
    const hasExpandedBoundary = nonLastLines.some((line) => line.some((seg) => (seg.justifyAfter || 0) > 0));
    const lastLineExpanded = justifyBox!.lines![justifyBox!.lines!.length - 1].some(
        (seg) => (seg.justifyAfter || 0) > 0,
    );

    check(
        'advanced justification precomputes per-boundary spacing',
        'non-final lines carry positive justifyAfter spacing while final line remains unexpanded',
        () => {
            assert.equal(hasExpandedBoundary, true, 'expected at least one non-final line boundary expansion');
            assert.equal(lastLineExpanded, false, 'expected no expansion on the final justified line');
        },
    );

    const hardBreakElements: Element[] = [
        {
            type: 'p',
            content: 'forced break line\nsecond line',
            properties: {
                style: {
                    width: 200,
                    textAlign: 'justify',
                    justifyEngine: 'advanced',
                },
            },
        },
    ];

    const hardBreakPages = engine.paginate(hardBreakElements);
    const hardBreakBox = hardBreakPages.flatMap((p) => p.boxes).find((b) => b.type === 'p');
    assert.ok(hardBreakBox?.lines && hardBreakBox.lines.length >= 2, 'expected multiple lines for hard break test');

    check(
        'hard line breaks are tagged to suppress justification expansion',
        'line ended by explicit break carries forcedBreakAfter marker and no justifyAfter expansion',
        () => {
            const firstLine = hardBreakBox!.lines![0];
            const lastSeg = firstLine[firstLine.length - 1];
            assert.equal(!!lastSeg?.forcedBreakAfter, true, 'expected forcedBreakAfter marker on explicit-break line');
            assert.equal(
                firstLine.some((seg) => (seg.justifyAfter || 0) > 0),
                false,
                'forced-break line must not be expanded',
            );
        },
    );

    const hyphenElements: Element[] = [
        {
            type: 'p',
            content: 'extraordinaryarchitectures extraordinaryarchitectures',
            properties: {
                style: {
                    width: 120,
                    hyphenation: 'auto',
                    hyphenMinWordLength: 6,
                    hyphenMinPrefix: 3,
                    hyphenMinSuffix: 3,
                },
            },
        },
    ];

    const hyphenPages = engine.paginate(hyphenElements);
    const hyphenBox = hyphenPages.flatMap((p) => p.boxes).find((b) => b.type === 'p');
    assert.ok(hyphenBox?.lines && hyphenBox.lines.length > 1, 'expected wrapped lines for hyphenation test');

    const lineTexts = hyphenBox!.lines!.map((line) => line.map((seg) => seg.text).join(''));
    const hasVisibleHyphenBreak = lineTexts.slice(0, -1).some((text) => text.endsWith('-'));

    check(
        'auto hyphenation inserts discretionary break hyphen for long words',
        'at least one non-final wrapped line ends with a visible hyphen',
        () => {
            assert.equal(
                hasVisibleHyphenBreak,
                true,
                `expected hyphenated break; got lines: ${JSON.stringify(lineTexts)}`,
            );
        },
    );

    const softHyphenElements: Element[] = [
        {
            type: 'p',
            content: 'extra\u00ADordinaryarchitectures',
            properties: {
                style: {
                    width: 80,
                    hyphenation: 'soft',
                },
            },
        },
    ];

    const softPages = engine.paginate(softHyphenElements);
    const softBox = softPages.flatMap((p) => p.boxes).find((b) => b.type === 'p');
    assert.ok(softBox?.lines && softBox.lines.length > 1, 'expected wrapped lines for soft hyphen test');
    const softLineTexts = softBox!.lines!.map((line) => line.map((seg) => seg.text).join(''));
    const hasSoftBreak = softLineTexts.slice(0, -1).some((text) => text.endsWith('-'));

    check(
        'soft hyphen mode respects discretionary break points',
        'lines break on supplied soft-hyphen points with visible trailing hyphen',
        () => {
            assert.equal(hasSoftBreak, true, `expected soft-hyphen break; got lines: ${JSON.stringify(softLineTexts)}`);
        },
    );
}

async function testRendererRtlFlow() {
    logStep('Scenario: renderer draws RTL lines from rtl origin');
    const config = buildConfig();
    config.layout.showPageNumbers = false;
    config.layout.direction = 'rtl';

    class RecordingContext extends MockContext {
        calls: Array<{ str: string; x: number; y: number }> = [];
        override text(str: string, x: number, y: number, _options?: ContextTextOptions): this {
            this.textCalls += 1;
            this.calls.push({ str, x, y });
            return this;
        }
    }

    const renderer = new Renderer(config, false);
    const context = new RecordingContext();
    const pages: Page[] = [
        {
            index: 0,
            width: 320,
            height: 220,
            boxes: [
                {
                    type: 'p',
                    x: 20,
                    y: 20,
                    w: 200,
                    h: 24,
                    style: { direction: 'rtl' },
                    lines: [
                        [
                            { text: 'ONE', width: 40, ascent: 800, descent: 200, style: {} },
                            { text: 'TWO', width: 30, ascent: 800, descent: 200, style: {} },
                        ],
                    ],
                    properties: {},
                },
            ],
        },
    ];

    await renderer.render(pages, context);
    const one = context.calls.find((c) => c.str === 'ONE');
    const two = context.calls.find((c) => c.str === 'TWO');
    assert.ok(one && two, 'expected RTL renderer test to draw both segments');

    check('rtl draw order uses rtl x progression', 'the second segment is drawn at a smaller x than the first', () => {
        assert.ok(two!.x < one!.x, `expected rtl x progression; ONE.x=${one!.x}, TWO.x=${two!.x}`);
    });
}

async function testOrientationPageDimensions() {
    logStep('Scenario: page orientation is reflected in paginated page dimensions');

    const config = buildConfig();
    config.layout.showPageNumbers = false;
    config.layout.pageSize = 'LETTER';
    config.layout.orientation = 'landscape';

    const engine = new LayoutEngine(config);
    await engine.waitForFonts();

    const pages = engine.paginate([{ type: 'p', content: 'orientation test paragraph' }]);

    check(
        'landscape orientation swaps letter dimensions',
        'paginated page reports width=792 and height=612 for LETTER landscape',
        () => {
            assert.ok(pages.length >= 1, 'expected at least one page');
            assert.equal(pages[0].width, 792);
            assert.equal(pages[0].height, 612);
        },
    );
}

async function testHyphenatedContinuationPreservesBoundaryWord() {
    logStep('Scenario: hyphenated continuation preserves boundary word at page break');
    const config = buildConfig();
    config.layout.showPageNumbers = false;
    config.layout.pageSize = { width: 320, height: 220 };
    config.layout.margins = { top: 20, right: 20, bottom: 20, left: 20 };
    config.styles.p = {
        marginBottom: 0,
        lineHeight: 1.2,
        hyphenation: 'auto',
    } as any;

    const engine = new LayoutEngine(config);
    await engine.waitForFonts();

    const flowText =
        'This demo forces a continuation onto page two while testing hyphenation boundaries across the split. '.repeat(
            12,
        );
    const pages = engine.paginate([{ type: 'p', content: flowText }]);

    const pageTwoFlow = pages.find((page) => page.index === 1)?.boxes.find((box) => box.type === 'p');
    const firstLine = pageTwoFlow?.lines?.[0]?.map((seg) => seg.text || '').join('') || '';

    check(
        'hyphenated continuation keeps first boundary character',
        'first continuation line retains intact boundary token (no dropped leading character)',
        () => {
            assert.ok(pageTwoFlow, 'expected continuation flow on page 2');
            assert.ok(firstLine.length > 0, 'expected first continuation line text');
            assert.equal(
                firstLine.startsWith('esting'),
                false,
                `unexpected dropped leading char in first continuation line; got "${firstLine}"`,
            );
            const intactBoundaryPrefix = firstLine.startsWith('testing') || firstLine.startsWith('This');
            assert.equal(
                intactBoundaryPrefix,
                true,
                `expected intact boundary token prefix on first continuation line; got "${firstLine}"`,
            );
        },
    );
}

async function testRendererZIndexOrdering() {
    logStep('Scenario: renderer draw order respects per-box zIndex');

    class ZOrderContext extends MockContext {
        drawOrder: string[] = [];
        override text(str: string, _x: number, _y: number, _options?: ContextTextOptions): this {
            this.drawOrder.push(str);
            this.textCalls += 1;
            return this;
        }
    }

    const config = buildConfig();
    config.layout.showPageNumbers = false;
    const renderer = new Renderer(config, false);
    const context = new ZOrderContext();

    const makeLine = (text: string) => [
        {
            text,
            width: 20,
            ascent: 800,
            descent: 200,
            style: {},
        },
    ];

    const pages: Page[] = [
        {
            index: 0,
            width: 320,
            height: 220,
            boxes: [
                {
                    type: 'p',
                    x: 20,
                    y: 20,
                    w: 200,
                    h: 20,
                    style: { zIndex: 5 },
                    lines: [makeLine('TOP')],
                    properties: {},
                },
                {
                    type: 'p',
                    x: 20,
                    y: 20,
                    w: 200,
                    h: 20,
                    style: { zIndex: 1 },
                    lines: [makeLine('BOTTOM')],
                    properties: {},
                },
            ],
        },
    ];

    await renderer.render(pages, context);

    check(
        'higher zIndex draws later',
        'lower-z box text is emitted before higher-z box text even when listed first in input',
        () => {
            const bottomIdx = context.drawOrder.indexOf('BOTTOM');
            const topIdx = context.drawOrder.indexOf('TOP');
            assert.ok(bottomIdx >= 0 && topIdx >= 0, 'expected both labels to be drawn');
            assert.ok(bottomIdx < topIdx, `expected BOTTOM before TOP; order=${JSON.stringify(context.drawOrder)}`);
        },
    );
}

async function testTablePaginationRepeatsHeaderRows() {
    logStep('Scenario: table primitive paginates by rows and repeats headers on continuation pages');
    const config = buildConfig();
    config.layout.showPageNumbers = false;
    config.layout.pageSize = { width: 320, height: 220 };
    config.layout.margins = { top: 20, right: 20, bottom: 20, left: 20 };
    config.styles.table = { marginTop: 0, marginBottom: 8, padding: 0 };
    config.styles['table-cell'] = { fontSize: 11, lineHeight: 1.2 };

    const engine = new LayoutEngine(config);
    await engine.waitForFonts();

    const rows: Element[] = [
        {
            type: 'table-row',
            content: '',
            properties: { semanticRole: 'header' },
            children: [
                { type: 'table-cell', content: 'ID' },
                { type: 'table-cell', content: 'Description' },
            ],
        },
    ];

    for (let idx = 1; idx <= 14; idx++) {
        rows.push({
            type: 'table-row',
            content: '',
            children: [
                { type: 'table-cell', content: `R${idx}` },
                {
                    type: 'table-cell',
                    content: `Row ${idx} content that intentionally wraps a little to stress table row height consistency.`,
                },
            ],
        });
    }

    const elements: Element[] = [
        {
            type: 'table',
            content: '',
            properties: {
                table: {
                    headerRows: 1,
                    repeatHeader: true,
                    columnGap: 0,
                    rowGap: 0,
                    columns: [
                        { mode: 'fixed', value: 52 },
                        { mode: 'flex', fr: 1 },
                    ],
                },
            },
            children: rows,
        },
    ];

    const pages = engine.paginate(elements);
    const headerRowIndex = 0;
    const rowIndexesByPage = pages.map((page) =>
        page.boxes
            .filter((box) => box.type === 'table_cell')
            .map((box) => Number(box.properties?._tableRowIndex))
            .filter((value) => Number.isFinite(value)),
    );

    check(
        'table row pagination emits multiple pages',
        'single table spans at least two pages and produces table_cell boxes',
        () => {
            assert.ok(pages.length >= 2, `expected table to paginate; pages=${pages.length}`);
            assert.ok(rowIndexesByPage[0].length > 0, 'expected table_cell boxes on page 1');
            assert.ok(rowIndexesByPage[1].length > 0, 'expected table_cell boxes on page 2');
        },
    );

    check(
        'table continuation repeats header rows',
        'header row index appears on page 1 and also on continuation page',
        () => {
            assert.ok(rowIndexesByPage[0].includes(headerRowIndex), 'expected header row index on first page');
            assert.ok(
                rowIndexesByPage[1].includes(headerRowIndex),
                'expected repeated header row index on continuation page',
            );
        },
    );

    check(
        'table body rows continue after repeated header',
        'continuation page includes both repeated header row and at least one non-header row',
        () => {
            const continuationRows = rowIndexesByPage[1];
            assert.ok(
                continuationRows.some((idx) => idx !== headerRowIndex),
                'expected body rows after repeated header',
            );
        },
    );
}

async function testTableColSpanMaterializesSpanWidth() {
    logStep('Scenario: table cell colSpan expands rendered table_cell width across adjacent tracks');
    const config = buildConfig();
    config.layout.showPageNumbers = false;
    config.layout.pageSize = { width: 320, height: 220 };
    config.layout.margins = { top: 20, right: 20, bottom: 20, left: 20 };
    config.styles.table = { marginTop: 0, marginBottom: 8, padding: 0 };
    config.styles['table-cell'] = { fontSize: 11, lineHeight: 1.2 };

    const engine = new LayoutEngine(config);
    await engine.waitForFonts();

    const elements: Element[] = [
        {
            type: 'table',
            content: '',
            properties: {
                table: {
                    headerRows: 1,
                    repeatHeader: true,
                    columnGap: 6,
                    rowGap: 0,
                    columns: [
                        { mode: 'fixed', value: 60 },
                        { mode: 'fixed', value: 90 },
                        { mode: 'fixed', value: 70 },
                    ],
                },
            },
            children: [
                {
                    type: 'table-row',
                    content: '',
                    properties: { semanticRole: 'header' },
                    children: [
                        { type: 'table-cell', content: 'H1' },
                        { type: 'table-cell', content: 'H2' },
                        { type: 'table-cell', content: 'H3' },
                    ],
                },
                {
                    type: 'table-row',
                    content: '',
                    children: [
                        { type: 'table-cell', content: 'Spans first two columns', properties: { colSpan: 2 } },
                        { type: 'table-cell', content: 'Tail' },
                    ],
                },
            ],
        },
    ];

    const pages = engine.paginate(elements);
    const spanCell = pages
        .flatMap((page) => page.boxes)
        .find(
            (box) =>
                box.type === 'table_cell' &&
                Number(box.properties?._tableRowIndex) === 1 &&
                Number(box.properties?._tableColStart) === 0 &&
                Number(box.properties?._tableColSpan) === 2,
        );

    const expectedSpanWidth = 60 + 90 + 6;
    check(
        'table colSpan width mapping',
        'colSpan=2 cell width equals two track widths plus one inter-column gap',
        () => {
            assert.ok(spanCell, 'expected to find colSpan=2 table_cell');
            assert.equal(Number(spanCell?.properties?._tableColIndex), 0);
            assert.equal(Number(spanCell?.properties?._tableColSpan), 2);
            assert.equal(Number((spanCell?.w || 0).toFixed(3)), Number(expectedSpanWidth.toFixed(3)));
        },
    );
}

async function testTableRowSpanStacksAcrossRows() {
    logStep('Scenario: table rowSpan expands cell height across stacked rows without duplicate covered-column cells');
    const config = buildConfig();
    config.layout.showPageNumbers = false;
    config.layout.pageSize = { width: 320, height: 220 };
    config.layout.margins = { top: 20, right: 20, bottom: 20, left: 20 };
    config.styles.table = { marginTop: 0, marginBottom: 8, padding: 0 };
    config.styles['table-cell'] = { fontSize: 11, lineHeight: 1.2 };

    const rowGap = 4;
    const engine = new LayoutEngine(config);
    await engine.waitForFonts();

    const elements: Element[] = [
        {
            type: 'table',
            content: '',
            properties: {
                table: {
                    headerRows: 0,
                    repeatHeader: false,
                    columnGap: 0,
                    rowGap,
                    columns: [
                        { mode: 'fixed', value: 70 },
                        { mode: 'fixed', value: 170 },
                    ],
                },
            },
            children: [
                {
                    type: 'table-row',
                    content: '',
                    children: [
                        { type: 'table-cell', content: 'Span', properties: { rowSpan: 2 } },
                        { type: 'table-cell', content: 'Top row content' },
                    ],
                },
                {
                    type: 'table-row',
                    content: '',
                    children: [{ type: 'table-cell', content: 'Bottom row content' }],
                },
            ],
        },
    ];

    const pages = engine.paginate(elements);
    const cells = pages.flatMap((page) => page.boxes).filter((box) => box.type === 'table_cell');
    const rowSpanCell = cells.find(
        (box) =>
            Number(box.properties?._tableRowIndex) === 0 &&
            Number(box.properties?._tableColStart) === 0 &&
            Number(box.properties?._tableRowSpan) === 2,
    );
    const row0Tail = cells.find(
        (box) => Number(box.properties?._tableRowIndex) === 0 && Number(box.properties?._tableColStart) === 1,
    );
    const row1Tail = cells.find(
        (box) => Number(box.properties?._tableRowIndex) === 1 && Number(box.properties?._tableColStart) === 1,
    );
    const row1CoveredColCell = cells.find(
        (box) => Number(box.properties?._tableRowIndex) === 1 && Number(box.properties?._tableColStart) === 0,
    );

    check(
        'table rowSpan height + occupancy mapping',
        'rowSpan=2 cell covers both row heights plus rowGap, and covered column is not duplicated on next row',
        () => {
            assert.ok(rowSpanCell, 'expected rowSpan=2 table_cell');
            assert.ok(row0Tail, 'expected row 0 tail cell');
            assert.ok(row1Tail, 'expected row 1 tail cell');
            assert.equal(row1CoveredColCell, undefined, 'covered column should not emit duplicate row1 cell');
            const expectedHeight = Number(row0Tail?.h || 0) + rowGap + Number(row1Tail?.h || 0);
            const actualHeight = Number(rowSpanCell?.h || 0);
            assert.ok(
                Math.abs(actualHeight - expectedHeight) <= 0.01,
                `expected span height ${actualHeight} ~= ${expectedHeight}`,
            );
        },
    );
}

async function testTableCellSourceIdIntegrity() {
    logStep('Scenario: table cells preserve their semantic sourceId without mangling');
    const config = buildConfig();
    config.layout.showPageNumbers = false;
    config.layout.pageSize = { width: 320, height: 220 };
    config.layout.margins = { top: 20, right: 20, bottom: 20, left: 20 };
    config.styles.table = { marginTop: 0, marginBottom: 8, padding: 0 };
    config.styles['table-cell'] = { fontSize: 11, lineHeight: 1.2 };

    const engine = new LayoutEngine(config);
    await engine.waitForFonts();

    const elements: Element[] = [
        {
            type: 'table',
            content: '',
            properties: {
                table: {
                    headerRows: 0,
                    repeatHeader: false,
                    columnGap: 0,
                    rowGap: 0,
                    columns: [
                        { mode: 'fixed', value: 80 },
                        { mode: 'fixed', value: 160 },
                    ],
                },
            },
            children: [
                {
                    type: 'table-row',
                    content: '',
                    children: [
                        { type: 'table-cell', content: 'A1', properties: { sourceId: 'cell-a1' } },
                        { type: 'table-cell', content: 'B1', properties: { sourceId: 'cell-b1' } },
                    ],
                },
            ],
        },
    ];

    const pages = engine.paginate(elements);
    const cells = pages.flatMap((page) => page.boxes).filter((box) => box.type === 'table_cell');
    const cellA = cells.find((box) => Number(box.properties?._tableColStart) === 0);
    const cellB = cells.find((box) => Number(box.properties?._tableColStart) === 1);

    check(
        'table cell meta.sourceId is not mangled',
        'cell sourceId equals author-provided id and does not encode row/col coordinates',
        () => {
            assert.ok(cellA && cellB, 'expected table_cell boxes');
            assert.equal(cellA?.meta?.sourceId, 'author:cell-a1');
            assert.equal(cellB?.meta?.sourceId, 'author:cell-b1');
            assert.ok(
                !String(cellA?.meta?.sourceId || '').includes(':r'),
                'expected no row/col suffix in cell sourceId',
            );
            assert.ok(
                !String(cellB?.meta?.sourceId || '').includes(':r'),
                'expected no row/col suffix in cell sourceId',
            );
        },
    );

    check(
        'table cell engineKey remains unique',
        'each table_cell box has a unique engineKey for client-side addressing',
        () => {
            const keys = cells.map((box) => box.meta?.engineKey).filter((value): value is string => !!value);
            const uniqueCount = new Set(keys).size;
            assert.equal(uniqueCount, keys.length, `expected unique engineKey values; keys=${JSON.stringify(keys)}`);
        },
    );
}

async function testSuppressPageNumberSkipsCoverAndCountsScriptPages() {
    logStep('Scenario: suppressed cover page is excluded from visible page-number sequence');
    const config = buildConfig();
    config.layout.pageSize = { width: 300, height: 180 };
    config.layout.margins = { top: 20, right: 20, bottom: 20, left: 20 };
    config.layout.pageNumberStartPage = 2;
    config.layout.pageNumberFormat = '{n}';
    config.layout.pageNumberPosition = 'top';
    config.layout.pageNumberAlignment = 'right';

    const engine = new LayoutEngine(config);
    await engine.waitForFonts();

    const elements: Element[] = [
        {
            type: 'filler',
            content: 'COVER PAGE',
            properties: {
                layoutDirectives: {
                    suppressPageNumber: true,
                },
            },
        },
        {
            type: 'p',
            content: 'SCRIPT PAGE ONE',
            properties: {
                style: { pageBreakBefore: true },
            },
        },
        {
            type: 'p',
            content: 'SCRIPT PAGE TWO',
            properties: {
                style: { pageBreakBefore: true },
            },
        },
    ];

    const pages = engine.paginate(elements);
    const pageNumberBoxes = pages.map((page) => page.boxes.find((box) => box.type === 'page_number'));
    const pageNumberTexts = pageNumberBoxes.map((box) => {
        if (!box?.lines?.[0]) return '';
        return box.lines[0].map((seg) => seg.text || '').join('');
    });

    check(
        'cover suppression with screenplay-like numbering',
        'cover has no page number, first script page omitted, second script page shows 2',
        () => {
            assert.equal(pages.length, 3, 'expected cover + two script pages');
            assert.equal(pageNumberTexts[0], '', 'cover page should not be numbered');
            assert.equal(pageNumberTexts[1], '', 'first script page should be omitted by startPage=2');
            assert.equal(pageNumberTexts[2], '2', 'second script page should display page number 2');
        },
    );
}

async function testInlineObjectJustificationIsolation() {
    logStep('Scenario: justification does not distribute spacing into inline object segments');
    const config = buildConfig();
    config.layout.showPageNumbers = false;

    const engine = new LayoutEngine(config);
    await engine.waitForFonts();

    const onePixelPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO9Wl9kAAAAASUVORK5CYII=';
    const elements: Element[] = [
        {
            type: 'p',
            content: '',
            properties: { style: { width: 200, textAlign: 'justify', justifyEngine: 'advanced' } },
            children: [
                {
                    type: 'text',
                    content:
                        'Opening text run with several words so that lines wrap and justification fires on non-final lines. ',
                },
                {
                    type: 'image',
                    content: '',
                    properties: {
                        style: { width: 18, height: 18, verticalAlign: 'middle' },
                        image: { data: onePixelPng, mimeType: 'image/png', fit: 'contain' },
                    },
                },
                {
                    type: 'text',
                    content:
                        ' More trailing text to ensure the line containing the inline image is not the final line and is eligible for justification.',
                },
            ],
        },
    ];

    const pages = engine.paginate(elements);
    const paraBox = pages.flatMap((p) => p.boxes).find((b) => b.type === 'p');
    const allSegs = (paraBox?.lines || []).flat() as any[];

    check(
        'justified paragraph emits justifyAfter on at least one text segment',
        'non-final wrapped lines carry positive justifyAfter spacing metadata',
        () => {
            assert.ok(paraBox, 'expected paragraph box');
            assert.ok((paraBox!.lines || []).length > 1, 'expected wrapped lines');
            const hasJustifyAfter = allSegs.some((seg) => !seg.inlineObject && Number(seg.justifyAfter || 0) > 0);
            assert.equal(hasJustifyAfter, true, 'expected justifyAfter spacing on at least one text segment');
        },
    );

    check(
        'inline object segments never carry justifyAfter spacing',
        'justification distributes space only to text boundaries, not around inline objects',
        () => {
            const inlineObjectSegs = allSegs.filter((seg) => !!seg.inlineObject);
            assert.ok(inlineObjectSegs.length > 0, 'expected inline object segment in justified paragraph');
            inlineObjectSegs.forEach((seg, idx) => {
                assert.ok(
                    !(Number(seg.justifyAfter || 0) > 0),
                    `inline object segment ${idx} must not carry justifyAfter spacing`,
                );
            });
        },
    );
}

async function testWidowOrphanKeepWithNextComposition() {
    logStep('Scenario: widow/orphan constraints and keepWithNext compose without either being silently dropped');
    const config = buildConfig();
    config.layout.showPageNumbers = false;
    config.layout.pageSize = { width: 300, height: 180 };
    config.layout.margins = { top: 20, right: 20, bottom: 20, left: 20 };
    config.styles.section = { marginTop: 0, marginBottom: 4, keepWithNext: true };
    config.styles.body = { marginTop: 0, marginBottom: 6, allowLineSplit: true, orphans: 2, widows: 4 };

    const engine = new LayoutEngine(config);
    await engine.waitForFonts();

    const widows = 4;
    const orphans = 2;
    const elements: Element[] = [
        {
            type: 'p',
            content: 'Filler text to consume page space and push the section heading near the page boundary. '.repeat(
                6,
            ),
        },
        { type: 'section', content: 'Section Heading', properties: { keepWithNext: true } },
        { type: 'body', content: 'Body text for keep-with-next and widow/orphan composition test. '.repeat(30) },
    ];

    const pages = engine.paginate(elements);
    const sectionEntries = pages.flatMap((p, pi) =>
        p.boxes.filter((b) => b.type === 'section').map((b) => ({ b, pi })),
    );
    const bodyEntries = pages.flatMap((p, pi) => p.boxes.filter((b) => b.type === 'body').map((b) => ({ b, pi })));

    check(
        'keepWithNext: section heading stays with first body fragment',
        'section and first body fragment appear on the same page',
        () => {
            assert.ok(sectionEntries.length >= 1, 'expected section box');
            assert.ok(bodyEntries.length >= 1, 'expected body box');
            assert.equal(
                sectionEntries[0].pi,
                bodyEntries[0].pi,
                'section must be on the same page as the first body fragment',
            );
        },
    );

    check(
        'widow constraint honored on all body continuation fragments',
        'every continuation body fragment carries at least widows lines',
        () => {
            const continuations = bodyEntries.filter((e) => e.b.meta?.isContinuation === true);
            assert.ok(continuations.length >= 1, 'expected body to split into continuation fragments');
            continuations.forEach((e, idx) => {
                const lineCount = (e.b.lines || []).length;
                assert.ok(
                    lineCount >= widows,
                    `body continuation ${idx} has ${lineCount} lines, expected >= widows=${widows}`,
                );
            });
        },
    );

    check(
        'orphan constraint: first body fragment has at least orphans lines',
        'first body fragment satisfies orphan minimum even with preceding keepWithNext heading',
        () => {
            if (bodyEntries.length >= 2) {
                const lineCount = (bodyEntries[0].b.lines || []).length;
                assert.ok(
                    lineCount >= orphans,
                    `first body fragment has ${lineCount} lines, expected >= orphans=${orphans}`,
                );
            }
        },
    );
}

async function testGlobalStateIsolation() {
    logStep(
        'Scenario: laying out document A does not affect the layout of document B run on a separate engine instance',
    );
    const configA = buildConfig();
    configA.layout.showPageNumbers = false;
    const configB = buildConfig();
    configB.layout.showPageNumbers = false;
    configB.layout.pageSize = { width: 300, height: 200 };
    configB.layout.margins = { top: 20, right: 20, bottom: 20, left: 20 };

    const engineA = new LayoutEngine(configA);
    const engineB1 = new LayoutEngine(configB);
    const engineB2 = new LayoutEngine(configB);
    await Promise.all([engineA.waitForFonts(), engineB1.waitForFonts(), engineB2.waitForFonts()]);

    const elementsA: Element[] = [
        { type: 'filler', content: 'Document A content' },
        { type: 'p', content: 'Document A paragraph text for state isolation test. '.repeat(20) },
    ];
    const elementsB: Element[] = [
        { type: 'p', content: 'Document B isolation verification paragraph text. '.repeat(25) },
    ];

    engineA.paginate(elementsA);
    const pagesB_afterA = engineB1.paginate(elementsB);
    const pagesB_isolated = engineB2.paginate(elementsB);

    check(
        'no residual state leaks between engine instances',
        'layout of document B after running A equals layout of B run in isolation',
        () => {
            assert.deepEqual(
                snapshotPages(pagesB_afterA),
                snapshotPages(pagesB_isolated),
                'engine instance layout must be fully isolated from prior runs on other instances',
            );
        },
    );
}

async function testBackgroundFillPaintersOrder() {
    logStep('Scenario: background fill is drawn before the text it underlies (painter order)');

    class PaintOrderContext extends MockContext {
        events: Array<{ op: string; str?: string }> = [];
        private _pendingFill = false;

        override rect(_x: number, _y: number, _w: number, _h: number): this {
            this._pendingFill = true;
            return this;
        }
        override roundedRect(_x: number, _y: number, _w: number, _h: number, _r: number): this {
            this._pendingFill = true;
            return this;
        }
        override fill(_rule?: 'nonzero' | 'evenodd'): this {
            if (this._pendingFill) {
                this.events.push({ op: 'fill' });
                this._pendingFill = false;
            }
            return this;
        }
        override fillAndStroke(_fillColor?: string, _strokeColor?: string): this {
            if (this._pendingFill) {
                this.events.push({ op: 'fill' });
                this._pendingFill = false;
            }
            return this;
        }
        override text(str: string, x: number, y: number, opts?: ContextTextOptions): this {
            super.text(str, x, y, opts);
            this.events.push({ op: 'text', str });
            return this;
        }
    }

    const config = buildConfig();
    config.layout.showPageNumbers = false;

    const engine = new LayoutEngine(config);
    await engine.waitForFonts();

    const elements: Element[] = [
        {
            type: 'p',
            content: '',
            children: [
                { type: 'text', content: 'Before ' },
                {
                    type: 'inline-box',
                    content: 'BADGE',
                    properties: {
                        style: {
                            paddingLeft: 4,
                            paddingRight: 4,
                            paddingTop: 2,
                            paddingBottom: 2,
                            backgroundColor: '#e2e8f0',
                            fontSize: 10,
                        },
                    },
                },
                { type: 'text', content: ' after' },
            ],
        },
    ];

    const pages = engine.paginate(elements);
    const renderer = new Renderer(config, false, engine.getRuntime());
    const context = new PaintOrderContext();
    await renderer.render(pages, context);

    check(
        'background fill precedes inline-box text in draw order',
        'a fill event appears before the BADGE text draw call in the renderer output stream',
        () => {
            const fillIdx = context.events.findIndex((e) => e.op === 'fill');
            const badgeIdx = context.events.findIndex((e) => e.op === 'text' && e.str === 'BADGE');
            assert.ok(fillIdx >= 0, 'expected at least one fill event (background was drawn)');
            assert.ok(badgeIdx >= 0, 'expected BADGE text draw call');
            assert.ok(fillIdx < badgeIdx, `fill (idx=${fillIdx}) must precede BADGE text draw (idx=${badgeIdx})`);
        },
    );
}

async function run() {
    const LocalFontManager = await loadLocalFontManager();
    setDefaultEngineRuntime(createEngineRuntime({ fontManager: new LocalFontManager() }));

    await testFlatPipeline();
    await testEmbeddedImageFlowAndRender();
    await testInlineObjectsInsideRichTextFlow();
    await testMultilingualMatrixOnlyRegression();
    await testWidowOrphanEnforcement();
    await testWidowOrphanBackletterSpacingAndMultilingual();
    await testPerBoxOverflowPolicy();
    await testPaginationContinuationMarkers();
    await testKeepWithNextChainMidPageSplitsTailUnit();
    await testKeepWithNextChainAtPageTopDoesNotStrandPrefixes();
    await testAdvancedJustifyAndHyphenation();
    await testRendererRtlFlow();
    await testOrientationPageDimensions();
    await testHyphenatedContinuationPreservesBoundaryWord();
    await testRendererZIndexOrdering();
    await testTablePaginationRepeatsHeaderRows();
    await testTableColSpanMaterializesSpanWidth();
    await testTableRowSpanStacksAcrossRows();
    await testTableCellSourceIdIntegrity();
    await testSuppressPageNumberSkipsCoverAndCountsScriptPages();
    await testInlineObjectJustificationIsolation();
    await testWidowOrphanKeepWithNextComposition();
    await testGlobalStateIsolation();
    await testBackgroundFillPaintersOrder();
    console.log('[flat-pipeline.spec] OK');
}

run().catch((err) => {
    console.error('[flat-pipeline.spec] FAILED', err);
    process.exit(1);
});
