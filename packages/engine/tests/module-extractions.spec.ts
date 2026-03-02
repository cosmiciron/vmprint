import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { StyleSignatureCache, appendSegmentToLine } from '../src/engine/layout/text-wrap-utils';
import { parseEmbeddedImagePayloadCached } from '../src/engine/image-data';
import {
    isCJKChar,
    isThaiChar,
    hasRtlScript,
    splitByScriptType,
    getScriptClass,
    segmentTextByFont,
} from '../src/engine/layout/text-script-segmentation';
import { applyAdvancedJustification } from '../src/engine/layout/text-justification';
import { tryHyphenateSegmentToFit } from '../src/engine/layout/text-hyphenation';
import { getRichSegments } from '../src/engine/layout/rich-text-extractor';
import { TextSegment } from '../src/engine/types';
import {
    CURRENT_DOCUMENT_VERSION,
    CURRENT_IR_VERSION,
    resolveDocumentPaths,
    toLayoutConfig,
} from '../src/engine/document';
import { LayoutUtils } from '../src/engine/layout/layout-utils';
import { solveTrackSizing } from '../src/engine/layout/track-sizing';
import { createEngineRuntime } from '../src/engine/runtime';
import { loadLocalFontManager } from './harness/engine-harness';
import { FontConfig, getFontsByFamily, registerFont, resolveFontFamilyAlias } from '../src/font-management/ops';

let LocalFontManager: any;

function logStep(message: string): void {
    console.log(`[module-extractions.spec] ${message}`);
}

function check(description: string, expected: string, assertion: () => void): void {
    logStep(`CHECK: ${description}`);
    logStep(`EXPECT: ${expected}`);
    assertion();
    logStep(`PASS: ${description}`);
}

function assertNear(actual: number, expected: number, epsilon: number = 0.001): void {
    assert.ok(Math.abs(actual - expected) <= epsilon, `expected ${actual} ~= ${expected} (±${epsilon})`);
}

function testStyleSignatureCache(): void {
    const cache = new StyleSignatureCache();
    const styleA = { fontSize: 12, fontWeight: 700, nested: { a: 1, b: 2 } };
    const styleB = { nested: { b: 2, a: 1 }, fontWeight: 700, fontSize: 12 };

    check('style signature normalization', 'equivalent style objects with different key order compare equal', () => {
        assert.equal(cache.areStylesEquivalent(styleA, styleB), true);
    });
}

function testAppendSegmentMerge(): void {
    const cache = new StyleSignatureCache();
    const line: TextSegment[] = [
        {
            text: 'Hel',
            fontFamily: 'Arimo',
            style: { fontSize: 12 },
            width: 10,
            glyphs: [{ char: 'H', x: 0, y: 0 }],
        },
    ];

    const next: TextSegment = {
        text: 'lo',
        fontFamily: 'Arimo',
        style: { fontSize: 12 },
        width: 5,
        glyphs: [
            { char: 'l', x: 0, y: 0 },
            { char: 'o', x: 3, y: 0 },
        ],
    };

    check('segment line merge', 'compatible adjacent segments are merged into one segment', () => {
        const merged = appendSegmentToLine(line, next, 5, true, (left, right) =>
            cache.areStylesEquivalent(left, right),
        );
        assert.equal(merged.length, 1);
        assert.equal(merged[0].text, 'Hello');
        assert.equal(merged[0].width, 15);
        assert.ok((merged[0].glyphs || []).length >= 3);
    });
}

function testScriptSegmentationHelpers(): void {
    check('script char helpers', 'CJK/Thai/RTL detector helpers classify representative code points', () => {
        assert.equal(isCJKChar('漢'.codePointAt(0) || 0), true);
        assert.equal(isThaiChar('ก'.codePointAt(0) || 0), true);
        assert.equal(hasRtlScript('hello שלום'), true);
        assert.equal(hasRtlScript('hello world'), false);
    });

    check('splitByScriptType', 'mixed CJK/Latin text splits into at least two script runs', () => {
        const runs = splitByScriptType(
            'Hello世界',
            (text) => Array.from(text),
            (cp) => isCJKChar(cp),
        );
        assert.ok(runs.length >= 2);
        assert.equal(
            runs.some((r) => r.isCJK),
            true,
        );
        assert.equal(
            runs.some((r) => !r.isCJK),
            true,
        );
    });

    check('getScriptClass', 'dominant-script classifier reports cjk for CJK-leading text', () => {
        const klass = getScriptClass('漢字 sample', (cp) => isCJKChar(cp), 'latin');
        assert.equal(klass, 'cjk');
    });

    check(
        'locale-aware fallback preference',
        'Japanese locale prioritizes JP fallback for Han text when multiple CJK fallbacks support the glyph',
        () => {
            const supportByFamily = new Map<string, boolean>([
                ['Arimo', false],
                ['Noto Sans SC', true],
                ['Noto Sans JP', true],
                ['Noto Sans Thai', false],
            ]);

            const segments = segmentTextByFont({
                text: '漢',
                preferredLocale: 'ja-JP',
                baseFontFamily: 'Arimo',
                fallbackFamilies: ['Noto Sans SC', 'Noto Sans JP', 'Noto Sans Thai'],
                getGraphemeClusters: (value) => Array.from(value),
                resolveLoadedFamilyFont: (familyName: string) => familyName,
                fontSupportsCluster: (font: string) => supportByFamily.get(font) === true,
            });

            assert.equal(segments.length, 1);
            assert.equal(segments[0].fontName, 'Noto Sans JP');
        },
    );
}

function testAdvancedJustification(): void {
    const lines: TextSegment[][] = [
        [
            { text: 'word ', width: 20, style: {} },
            { text: 'word', width: 20, style: {} },
        ],
        [{ text: 'last line', width: 20, style: {} }],
    ];

    check(
        'advanced justification spacing',
        'non-final lines receive positive justifyAfter while final line remains unchanged',
        () => {
            const out = applyAdvancedJustification({
                lines,
                maxWidth: 60,
                textIndent: 0,
                baseStyle: { justifyStrategy: 'space' },
                layoutJustifyStrategy: 'space',
                isCjkOrThaiCluster: () => false,
            });
            assert.ok((out[0][0].justifyAfter || 0) > 0);
            assert.equal(out[1][0].justifyAfter || 0, 0);
        },
    );
}

function testAdvancedJustificationSkipsForcedBreakLines(): void {
    const lines: TextSegment[][] = [
        [
            { text: 'forced ', width: 20, style: {} },
            { text: 'break', width: 20, style: {}, forcedBreakAfter: true },
        ],
        [{ text: 'last line', width: 20, style: {} }],
    ];

    check(
        'advanced justification ignores forced hard-break lines',
        'line marked with forcedBreakAfter does not receive expansion metadata',
        () => {
            const out = applyAdvancedJustification({
                lines,
                maxWidth: 60,
                textIndent: 0,
                baseStyle: { justifyStrategy: 'space' },
                layoutJustifyStrategy: 'space',
                isCjkOrThaiCluster: () => false,
            });
            assert.equal(out[0][0].justifyAfter || 0, 0);
            assert.equal(out[0][1].justifyAfter || 0, 0);
        },
    );
}

function testHyphenationSoftBreak(): void {
    const measured: Record<string, number> = {
        'trans-': 18,
        form: 12,
    };

    const segment: TextSegment = { text: 'trans\u00ADform', style: {} };

    check('hyphenation soft break', 'soft hyphen point is selected when head fits available width', () => {
        const result = tryHyphenateSegmentToFit({
            seg: segment,
            font: {},
            fontSize: 12,
            letterSpacing: 0,
            availableWidth: 20,
            style: {},
            resolveHyphenationSettings: () => ({
                mode: 'soft',
                hyphenateCaps: false,
                minWordLength: 4,
                minPrefix: 2,
                minSuffix: 2,
                lang: 'en',
            }),
            getGraphemeClusters: (text) => Array.from(text),
            cloneMeasuredSegment: (base, text) => ({
                seg: { ...base, text },
                width: measured[text] ?? 999,
            }),
        });
        assert.ok(result);
        assert.equal(result?.head.text, 'trans-');
        assert.equal(result?.tail.text, 'form');
    });
}

function testDocumentContractNormalization(): void {
    check(
        'document contract normalization',
        'fonts.regular-only documents are accepted and layout.fontFamily is canonicalized',
        () => {
            const resolved = resolveDocumentPaths(
                {
                    documentVersion: CURRENT_DOCUMENT_VERSION,
                    layout: {
                        pageSize: 'A4',
                        margins: { top: 20, right: 20, bottom: 20, left: 20 },
                        fontFamily: '' as any,
                        fontSize: 12,
                        lineHeight: 1.2,
                    },
                    fonts: {
                        regular: ' Arimo ',
                    },
                    styles: {},
                    elements: [],
                } as any,
                'inline-doc',
            );

            assert.equal(resolved.layout.fontFamily, 'Arimo');
            assert.equal(resolved.fonts?.regular, 'Arimo');
            assert.equal(resolved.documentVersion, CURRENT_DOCUMENT_VERSION);
            assert.equal(resolved.irVersion, CURRENT_IR_VERSION);

            const config = toLayoutConfig(resolved, false);
            assert.equal(config.layout.fontFamily, 'Arimo');
            assert.equal(config.fonts.regular, 'Arimo');
        },
    );

    check('document contract validation', 'documents without layout.fontFamily and fonts.regular are rejected', () => {
        assert.throws(
            () =>
                resolveDocumentPaths(
                    {
                        documentVersion: CURRENT_DOCUMENT_VERSION,
                        layout: {
                            pageSize: 'A4',
                            margins: { top: 20, right: 20, bottom: 20, left: 20 },
                            fontFamily: '' as any,
                            fontSize: 12,
                            lineHeight: 1.2,
                        },
                        styles: {},
                        elements: [],
                    } as any,
                    'inline-doc',
                ),
            /must define "layout\.fontFamily" or "fonts\.regular"/,
        );
    });

    check('document version validation', 'documents with unsupported documentVersion are rejected', () => {
        assert.throws(
            () =>
                resolveDocumentPaths(
                    {
                        documentVersion: '0.9' as any,
                        layout: {
                            pageSize: 'A4',
                            margins: { top: 20, right: 20, bottom: 20, left: 20 },
                            fontFamily: 'Arimo',
                            fontSize: 12,
                            lineHeight: 1.2,
                        },
                        styles: {},
                        elements: [],
                    } as any,
                    'inline-doc',
                ),
            /must set "documentVersion" to "1\.0"/,
        );
    });

    check('strict layout key validation', 'legacy/unknown layout keys are rejected with a precise error', () => {
        assert.throws(
            () =>
                resolveDocumentPaths(
                    {
                        documentVersion: CURRENT_DOCUMENT_VERSION,
                        layout: {
                            pageSize: 'A4',
                            margins: { top: 20, right: 20, bottom: 20, left: 20 },
                            fontFamily: 'Arimo',
                            baseFont: 'Arimo' as any,
                            fontSize: 12,
                            lineHeight: 1.2,
                        },
                        styles: {},
                        elements: [],
                    } as any,
                    'inline-doc',
                ),
            /unexpected key "baseFont"/,
        );
    });

    check('strict style key validation', 'legacy/unknown style keys are rejected with a precise error', () => {
        assert.throws(
            () =>
                resolveDocumentPaths(
                    {
                        documentVersion: CURRENT_DOCUMENT_VERSION,
                        layout: {
                            pageSize: 'A4',
                            margins: { top: 20, right: 20, bottom: 20, left: 20 },
                            fontFamily: 'Arimo',
                            fontSize: 12,
                            lineHeight: 1.2,
                        },
                        styles: {
                            p: {
                                spacingBefore: 4 as any,
                            },
                        },
                        elements: [],
                    } as any,
                    'inline-doc',
                ),
            /unexpected key "spacingBefore"/,
        );
    });

    check(
        'strict element properties key validation',
        'domain-specific or unknown element properties are rejected with a precise error',
        () => {
            assert.throws(
                () =>
                    resolveDocumentPaths(
                        {
                            documentVersion: CURRENT_DOCUMENT_VERSION,
                            layout: {
                                pageSize: 'A4',
                                margins: { top: 20, right: 20, bottom: 20, left: 20 },
                                fontFamily: 'Arimo',
                                fontSize: 12,
                                lineHeight: 1.2,
                            },
                            styles: {},
                            elements: [
                                {
                                    type: 'p',
                                    content: 'hello',
                                    properties: {
                                        screenplay: { dual: true } as any,
                                    },
                                },
                            ],
                        } as any,
                        'inline-doc',
                    ),
                /unexpected key "screenplay"/,
            );
        },
    );
}

function testRichTextStyleInheritance(): void {
    check(
        'rich text style inheritance',
        'nested text leaves inherit parent heading style unless explicitly overridden',
        () => {
            const element: any = {
                type: 'd2f_heading_1',
                content: '',
                children: [{ type: 'text', content: 'Heading title' }],
            };

            const segments = getRichSegments(
                element,
                {},
                {
                    transformContent: (text) => text,
                    resolveStyleForType: (type: string) => {
                        if (type === 'd2f_heading_1') return { fontSize: 25.5, fontWeight: 700 };
                        if (type === 'text') return { fontSize: 11.2 };
                        return {};
                    },
                },
            );

            assert.equal(segments.length, 1);
            assert.equal(segments[0].text, 'Heading title');
            assert.equal((segments[0].style as any)?.fontSize, 25.5);
            assert.equal((segments[0].style as any)?.fontWeight, 700);
        },
    );
}

function testOrientationDimensions(): void {
    check('orientation dimension resolution', 'landscape swaps width/height for named and custom page sizes', () => {
        const baseConfig = {
            margins: { top: 20, right: 20, bottom: 20, left: 20 },
            fontFamily: 'Arimo',
            fontSize: 12,
            lineHeight: 1.2,
        };

        const letterLandscape = LayoutUtils.getPageDimensions({
            layout: { ...baseConfig, pageSize: 'LETTER', orientation: 'landscape' },
            fonts: { regular: 'Arimo' },
            styles: {},
        } as any);
        assert.equal(letterLandscape.width, 792);
        assert.equal(letterLandscape.height, 612);

        const customLandscape = LayoutUtils.getPageDimensions({
            layout: { ...baseConfig, pageSize: { width: 500, height: 300 }, orientation: 'landscape' },
            fonts: { regular: 'Arimo' },
            styles: {},
        } as any);
        assert.equal(customLandscape.width, 300);
        assert.equal(customLandscape.height, 500);

        const customPortrait = LayoutUtils.getPageDimensions({
            layout: { ...baseConfig, pageSize: { width: 500, height: 300 }, orientation: 'portrait' },
            fonts: { regular: 'Arimo' },
            styles: {},
        } as any);
        assert.equal(customPortrait.width, 500);
        assert.equal(customPortrait.height, 300);
    });
}

function testTrackSizingFoundation(): void {
    check(
        'track sizing fixed + flex growth',
        'remaining width is distributed by flex weight after fixed track allocation',
        () => {
            const solved = solveTrackSizing({
                containerWidth: 300,
                gap: 10,
                tracks: [
                    { mode: 'fixed', value: 60 },
                    { mode: 'flex', fr: 1, min: 40, basis: 40 },
                    { mode: 'flex', fr: 2, min: 40, basis: 40 },
                ],
            });

            assert.equal(solved.sizes.length, 3);
            assertNear(solved.sizes[0], 60);
            assertNear(solved.sizes[1], 86.666667);
            assertNear(solved.sizes[2], 133.333333);
            assertNear(solved.contentWidth, 280);
            assertNear(solved.usedWidth, 300);
            assertNear(solved.remainingContentSpace, 0);
            assertNear(solved.overflowContent, 0);
        },
    );

    check(
        'track sizing shrink to minima',
        'overflowing basis widths shrink proportionally while respecting per-track min',
        () => {
            const solved = solveTrackSizing({
                containerWidth: 120,
                gap: 10,
                tracks: [
                    { mode: 'auto', min: 40, basis: 80, max: 160 },
                    { mode: 'auto', min: 30, basis: 70, max: 160 },
                ],
            });

            assertNear(solved.availableContentWidth, 110);
            assertNear(solved.sizes[0], 60);
            assertNear(solved.sizes[1], 50);
            assertNear(solved.contentWidth, 110);
            assertNear(solved.overflowContent, 0);
        },
    );

    check(
        'track sizing auto-content cap + flex spillover',
        'auto tracks grow to content caps first, then remaining space goes to flex tracks',
        () => {
            const solved = solveTrackSizing({
                containerWidth: 420,
                gap: 8,
                tracks: [
                    { mode: 'auto', minContent: 60, maxContent: 90, basis: 70 },
                    { mode: 'auto', minContent: 50, maxContent: 80, basis: 60 },
                    { mode: 'flex', fr: 1, min: 40, basis: 40 },
                ],
            });

            assertNear(solved.availableContentWidth, 404);
            assertNear(solved.sizes[0], 90);
            assertNear(solved.sizes[1], 80);
            assertNear(solved.sizes[2], 234);
            assertNear(solved.contentWidth, 404);
            assertNear(solved.usedWidth, 420);
        },
    );

    check(
        'track sizing flex max cap',
        'max-capped flex track stops growing and surplus flows to uncapped flex siblings',
        () => {
            const solved = solveTrackSizing({
                containerWidth: 300,
                tracks: [
                    { mode: 'flex', fr: 1, min: 20, basis: 20, max: 60 },
                    { mode: 'flex', fr: 1, min: 20, basis: 20 },
                ],
            });

            assertNear(solved.sizes[0], 60);
            assertNear(solved.sizes[1], 240);
            assertNear(solved.contentWidth, 300);
            assertNear(solved.remainingContentSpace, 0);
        },
    );
}

function testFontWeightMatching(): void {
    const runtime = createEngineRuntime({ fontManager: new LocalFontManager() });
    check(
        'numeric font weight nearest matching',
        'weights resolve through Arimo variable ranges with style preservation',
        () => {
            const normal500 = LayoutUtils.resolveFontMatch(
                'Arimo',
                500,
                'normal',
                runtime.fontRegistry,
                runtime.fontManager,
            );
            assert.equal(normal500.config.style, 'normal');
            assert.equal(normal500.resolvedWeight, 500);
            assert.equal(
                LayoutUtils.getFontId('Arimo', 500, 'normal', runtime.fontRegistry, runtime.fontManager),
                'Arimo-W500',
            );

            const normal600 = LayoutUtils.resolveFontMatch(
                'Arimo',
                600,
                'normal',
                runtime.fontRegistry,
                runtime.fontManager,
            );
            assert.equal(normal600.config.style, 'normal');
            assert.equal(normal600.resolvedWeight, 600);
            assert.equal(
                LayoutUtils.getFontId('Arimo', 600, 'normal', runtime.fontRegistry, runtime.fontManager),
                'Arimo-W600',
            );

            const italic500 = LayoutUtils.resolveFontMatch(
                'Arimo',
                500,
                'italic',
                runtime.fontRegistry,
                runtime.fontManager,
            );
            assert.equal(italic500.config.style, 'italic');
            assert.equal(italic500.resolvedWeight, 500);
            assert.equal(
                LayoutUtils.getFontId('Arimo', 500, 'italic', runtime.fontRegistry, runtime.fontManager),
                'Arimo-ItalicW500',
            );
        },
    );

    check(
        'variable range font id resolution',
        'variable-range entries keep requested stepped weight in resolved match/id',
        () => {
            const variableRegistry: FontConfig[] = [
                {
                    name: 'Var Sans',
                    family: 'Var Sans',
                    weight: 400,
                    weightRange: { min: 100, max: 900 },
                    style: 'normal',
                    src: 'runtime://var-sans.ttf',
                    enabled: true,
                    fallback: false,
                },
            ];
            const variableManager = new LocalFontManager({ fonts: variableRegistry });

            const match = LayoutUtils.resolveFontMatch('Var Sans', 500, 'normal', variableRegistry, variableManager);
            assert.equal(match.resolvedWeight, 500);
            assert.equal(match.usedVariableWeightRange, true);
            assert.equal(
                LayoutUtils.getFontId('Var Sans', 500, 'normal', variableRegistry, variableManager),
                'Var Sans-W500',
            );
        },
    );
}

function testEmbeddedImageContract(): void {
    const onePixelPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO9Wl9kAAAAASUVORK5CYII=';

    check(
        'embedded image contract acceptance',
        'type=image with properties.image payload is accepted by strict contract validation',
        () => {
            const resolved = resolveDocumentPaths(
                {
                    documentVersion: CURRENT_DOCUMENT_VERSION,
                    layout: {
                        pageSize: 'A4',
                        margins: { top: 20, right: 20, bottom: 20, left: 20 },
                        fontFamily: 'Arimo',
                        fontSize: 12,
                        lineHeight: 1.2,
                    },
                    styles: {
                        image: { width: 40 },
                    },
                    elements: [
                        {
                            type: 'image',
                            content: '',
                            properties: {
                                image: {
                                    data: onePixelPng,
                                    mimeType: 'image/png',
                                    fit: 'contain',
                                },
                            },
                        },
                    ],
                } as any,
                'inline-doc',
            );

            const image = resolved.elements[0].properties?.image as any;
            assert.equal(typeof image?.data, 'string');
            assert.equal(image?.mimeType, 'image/png');
            assert.equal(image?.fit, 'contain');
        },
    );

    check('embedded image required for image element', 'type=image without properties.image is rejected', () => {
        assert.throws(
            () =>
                resolveDocumentPaths(
                    {
                        documentVersion: CURRENT_DOCUMENT_VERSION,
                        layout: {
                            pageSize: 'A4',
                            margins: { top: 20, right: 20, bottom: 20, left: 20 },
                            fontFamily: 'Arimo',
                            fontSize: 12,
                            lineHeight: 1.2,
                        },
                        styles: {},
                        elements: [{ type: 'image', content: '' }],
                    } as any,
                    'inline-doc',
                ),
            /properties\.image/,
        );
    });

    check('embedded image fit validation', 'unsupported fit values are rejected with a precise error', () => {
        assert.throws(
            () =>
                resolveDocumentPaths(
                    {
                        documentVersion: CURRENT_DOCUMENT_VERSION,
                        layout: {
                            pageSize: 'A4',
                            margins: { top: 20, right: 20, bottom: 20, left: 20 },
                            fontFamily: 'Arimo',
                            fontSize: 12,
                            lineHeight: 1.2,
                        },
                        styles: {},
                        elements: [
                            {
                                type: 'image',
                                content: '',
                                properties: {
                                    image: {
                                        data: onePixelPng,
                                        mimeType: 'image/png',
                                        fit: 'cover' as any,
                                    },
                                },
                            },
                        ],
                    } as any,
                    'inline-doc',
                ),
            /expected one of: contain, fill/,
        );
    });
}

function testTableLayoutContract(): void {
    check(
        'table layout contract acceptance',
        'element.properties.table with track definitions is accepted by strict contract validation',
        () => {
            const resolved = resolveDocumentPaths(
                {
                    documentVersion: CURRENT_DOCUMENT_VERSION,
                    layout: {
                        pageSize: 'A4',
                        margins: { top: 20, right: 20, bottom: 20, left: 20 },
                        fontFamily: 'Arimo',
                        fontSize: 12,
                        lineHeight: 1.2,
                    },
                    styles: {},
                    elements: [
                        {
                            type: 'table',
                            content: '',
                            properties: {
                                table: {
                                    headerRows: 1,
                                    repeatHeader: true,
                                    columnGap: 2,
                                    rowGap: 1,
                                    columns: [
                                        { mode: 'fixed', value: 120 },
                                        { mode: 'flex', fr: 1, min: 80 },
                                    ],
                                },
                            },
                            children: [
                                {
                                    type: 'table-row',
                                    content: '',
                                    children: [
                                        { type: 'table-cell', content: 'A', properties: { colSpan: 2, rowSpan: 1 } },
                                        { type: 'table-cell', content: 'B' },
                                    ],
                                },
                            ],
                        },
                    ],
                } as any,
                'inline-doc',
            );

            const table = resolved.elements[0].properties?.table as any;
            const firstCell = resolved.elements[0]?.children?.[0]?.children?.[0] as any;
            assert.equal(table.headerRows, 1);
            assert.equal(table.columns.length, 2);
            assert.equal(firstCell?.properties?.colSpan, 2);
            assert.equal(firstCell?.properties?.rowSpan, 1);
        },
    );

    check('table layout contract validation', 'invalid table column mode is rejected with a precise error', () => {
        assert.throws(
            () =>
                resolveDocumentPaths(
                    {
                        documentVersion: CURRENT_DOCUMENT_VERSION,
                        layout: {
                            pageSize: 'A4',
                            margins: { top: 20, right: 20, bottom: 20, left: 20 },
                            fontFamily: 'Arimo',
                            fontSize: 12,
                            lineHeight: 1.2,
                        },
                        styles: {},
                        elements: [
                            {
                                type: 'table',
                                content: '',
                                properties: {
                                    table: {
                                        columns: [{ mode: 'elastic' as any, value: 100 }],
                                    },
                                },
                            },
                        ],
                    } as any,
                    'inline-doc',
                ),
            /expected one of: fixed, auto, flex/,
        );
    });
}

function testRuntimeIsolation(): void {
    check('runtime state isolation', 'font registry writes in one runtime do not leak into another runtime', () => {
        const runtimeA = createEngineRuntime({ fontManager: new LocalFontManager() });
        const runtimeB = createEngineRuntime({ fontManager: new LocalFontManager() });

        registerFont(
            {
                name: 'RuntimeOnly Regular',
                family: 'RuntimeOnly',
                weight: 400,
                style: 'normal',
                src: 'runtime://runtime-only-regular.ttf',
                enabled: true,
                fallback: false,
            },
            runtimeA.fontRegistry,
            runtimeA.fontManager,
        );

        assert.equal(getFontsByFamily('RuntimeOnly', runtimeA.fontRegistry, runtimeA.fontManager).length, 1);
        assert.equal(getFontsByFamily('RuntimeOnly', runtimeB.fontRegistry, runtimeB.fontManager).length, 0);
    });
}

function testEmbeddedImageCacheCollisionSafety(): void {
    check(
        'embedded image cache collision safety',
        'distinct payloads that share the compact sampled cache key do not alias to the same parsed object',
        () => {
            const bytes = new Uint8Array(512);
            bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
            // PNG IHDR width/height bytes used by parser (width=100, height=50).
            bytes.set([0x00, 0x00, 0x00, 0x64, 0x00, 0x00, 0x00, 0x32], 16);

            const baseA = Buffer.from(bytes).toString('base64');
            const dataA = `data:image/png;base64,${baseA}`;
            const step = Math.max(1, Math.floor(dataA.length / 64));

            // Mutate an unsampled character near the end so signature/dimension bytes stay intact.
            let mutateIndex = dataA.length - 10;
            while (mutateIndex > 32 && mutateIndex % step === 0) mutateIndex -= 1;
            const originalChar = dataA[mutateIndex];
            const replacementChar = originalChar === 'A' ? 'B' : 'A';
            const dataB = dataA.slice(0, mutateIndex) + replacementChar + dataA.slice(mutateIndex + 1);

            const payloadA = { data: dataA, mimeType: 'image/png', fit: 'contain' as const };
            const payloadB = { data: dataB, mimeType: 'image/png', fit: 'contain' as const };

            const parsedA = parseEmbeddedImagePayloadCached(payloadA as any);
            const parsedB = parseEmbeddedImagePayloadCached(payloadB as any);

            assert.notEqual(payloadA.data, payloadB.data, 'payloads must differ');
            assert.notEqual(parsedA, parsedB, 'cache must not alias colliding compact keys');
            assert.equal(parsedA.base64Data, baseA, 'first payload should preserve its own base64');
            assert.equal(
                parsedB.base64Data,
                dataB.replace(/^data:[^,]+,/, ''),
                'second payload should preserve its own base64',
            );
        },
    );
}

function testLocalFontManagerOverride(): void {
    check('local font manager override', 'runtime font manager can be overridden with a custom local manager', () => {
        const customStore = new LocalFontManager({
            fonts: [
                {
                    name: 'Demo Sans Regular',
                    family: 'Demo Sans',
                    weight: 400,
                    style: 'normal',
                    src: 'demo://demo-sans-regular.ttf',
                    unicodeRange: 'U+0000-00FF',
                    enabled: true,
                    fallback: false,
                },
            ],
            aliases: {
                'sans-serif': 'Demo Sans',
            },
        });

        const runtime = createEngineRuntime({ fontManager: customStore });
        assert.equal(resolveFontFamilyAlias('sans-serif', runtime.fontManager), 'Demo Sans');
        assert.equal(getFontsByFamily('sans-serif', runtime.fontRegistry, runtime.fontManager).length, 1);
        assert.equal(getFontsByFamily('Demo Sans', runtime.fontRegistry, runtime.fontManager).length, 1);
    });
}

function testEngineCoreDomainAgnosticBoundary(): void {
    check(
        'engine core boundary guard',
        'non-test engine source files do not contain screenplay/domain-specific vocabulary',
        () => {
            const root = path.resolve(process.cwd(), 'src');
            const scanRoots = [
                path.join(root, 'layout'),
                path.join(root, 'renderer'),
                path.join(root, 'document.ts'),
                path.join(root, 'types.ts'),
                path.join(root, 'index.ts'),
            ];

            const forbidden = [
                /\bscreenplay\b/i,
                /\bslugline\b/i,
                /\bfinal draft\b/i,
                /\bfountain\b/i,
                /\bscene heading\b/i,
                /\(cont'?d\)/i,
                /\(more\)/i,
            ];

            const files: string[] = [];
            const walk = (target: string) => {
                if (!fs.existsSync(target)) return;
                const stat = fs.statSync(target);
                if (stat.isFile()) {
                    if (target.endsWith('.ts')) files.push(target);
                    return;
                }
                for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
                    if (entry.name === 'tests') continue;
                    walk(path.join(target, entry.name));
                }
            };

            for (const target of scanRoots) walk(target);

            const violations: Array<{ file: string; pattern: string }> = [];
            for (const file of files) {
                const content = fs.readFileSync(file, 'utf8');
                for (const pattern of forbidden) {
                    if (pattern.test(content)) {
                        violations.push({ file: path.relative(process.cwd(), file), pattern: String(pattern) });
                    }
                }
            }

            assert.equal(
                violations.length,
                0,
                `engine domain-boundary violation(s): ${JSON.stringify(violations, null, 2)}`,
            );
        },
    );
}

async function run() {
    LocalFontManager = await loadLocalFontManager();
    logStep('Scenario: extracted text layout modules preserve core behavior');
    testStyleSignatureCache();
    testAppendSegmentMerge();
    testRichTextStyleInheritance();
    testScriptSegmentationHelpers();
    testAdvancedJustification();
    testAdvancedJustificationSkipsForcedBreakLines();
    testHyphenationSoftBreak();
    testDocumentContractNormalization();
    testEmbeddedImageContract();
    testTableLayoutContract();
    testOrientationDimensions();
    testTrackSizingFoundation();
    testFontWeightMatching();
    testRuntimeIsolation();
    testEmbeddedImageCacheCollisionSafety();
    testLocalFontManagerOverride();
    testEngineCoreDomainAgnosticBoundary();
    logStep('OK');
}

run().catch((err) => {
    console.error('[module-extractions.spec] FAILED', err);
    process.exit(1);
});
