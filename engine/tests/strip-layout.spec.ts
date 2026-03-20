import assert from 'node:assert/strict';
import { CURRENT_DOCUMENT_VERSION, LayoutEngine, resolveDocumentPaths, toLayoutConfig, type DocumentInput } from '../src';
import { createEngineRuntime } from '../src/engine/runtime';
import { normalizeZoneMapElement } from '../src/engine/layout/packagers/zone-packager';
import { loadLocalFontManager, snapshotPages } from './harness/engine-harness';

import { logStep, check } from './harness/test-utils';
const TEST_PREFIX = 'strip-layout.spec';
const log = (msg: string) => logStep(TEST_PREFIX, msg);
const _check = (desc: string, exp: string, fn: () => void) => check(TEST_PREFIX, desc, exp, fn);

async function main() {
    const LocalFontManager = await loadLocalFontManager();
    const runtime = createEngineRuntime({
        fontManager: new LocalFontManager()
    });

    const baseDoc: Omit<DocumentInput, 'elements' | 'footer'> = {
        documentVersion: CURRENT_DOCUMENT_VERSION,
        layout: {
            pageSize: { width: 320, height: 220 },
            margins: { top: 20, right: 20, bottom: 28, left: 20 },
            fontFamily: 'Arimo',
            fontSize: 11,
            lineHeight: 1.25
        },
        fonts: { regular: 'Arimo' },
        styles: {
            p: { marginBottom: 8, allowLineSplit: true, orphans: 2, widows: 2 },
            bandLeft: { fontFamily: 'Arimo', fontSize: 9, marginBottom: 0 },
            bandCenter: { fontFamily: 'Arimo', fontSize: 9, textAlign: 'center', marginBottom: 0 },
            bandRight: { fontFamily: 'Arimo', fontSize: 9, textAlign: 'right', marginBottom: 0 }
        }
    };

    const stripDoc: DocumentInput = {
        ...baseDoc,
        elements: [
            { type: 'p', content: 'Lead paragraph before the composition strip.' },
            {
                type: 'strip',
                content: '',
                stripLayout: {
                    tracks: [
                        { mode: 'flex', fr: 1 },
                        { mode: 'fixed', value: 44 },
                        { mode: 'flex', fr: 1 }
                    ],
                    gap: 8
                },
                properties: {
                    style: { marginBottom: 6 }
                },
                slots: [
                    { id: 'left', elements: [{ type: 'bandLeft', content: 'By Cosmic' }] },
                    { id: 'center', elements: [{ type: 'bandCenter', content: 'No. 12' }] },
                    { id: 'right', elements: [{ type: 'bandRight', content: 'March 2026' }] }
                ]
            },
            { type: 'p', content: 'Body paragraph after the composition strip.' }
        ],
        footer: {
            default: {
                elements: [
                    {
                        type: 'strip',
                        content: '',
                        stripLayout: {
                            tracks: [
                                { mode: 'flex', fr: 1 },
                                { mode: 'fixed', value: 28 },
                                { mode: 'flex', fr: 1 }
                            ],
                            gap: 6
                        },
                        slots: [
                            { id: 'left', elements: [{ type: 'bandLeft', content: 'VMPrint' }] },
                            { id: 'center', elements: [{ type: 'bandCenter', content: '12' }] },
                            { id: 'right', elements: [{ type: 'bandRight', content: 'vmprint.dev' }] }
                        ]
                    }
                ]
            }
        }
    };

    const zoneMapDoc: DocumentInput = {
        ...baseDoc,
        elements: [
            { type: 'p', content: 'Lead paragraph before the composition strip.' },
            {
                type: 'zone-map',
                content: '',
                zoneLayout: {
                    columns: [
                        { mode: 'flex', fr: 1 },
                        { mode: 'fixed', value: 44 },
                        { mode: 'flex', fr: 1 }
                    ],
                    gap: 8
                },
                properties: {
                    style: { marginBottom: 6 }
                },
                zones: [
                    { id: 'left', elements: [{ type: 'bandLeft', content: 'By Cosmic' }] },
                    { id: 'center', elements: [{ type: 'bandCenter', content: 'No. 12' }] },
                    { id: 'right', elements: [{ type: 'bandRight', content: 'March 2026' }] }
                ]
            },
            { type: 'p', content: 'Body paragraph after the composition strip.' }
        ],
        footer: {
            default: {
                elements: [
                    {
                        type: 'zone-map',
                        content: '',
                        zoneLayout: {
                            columns: [
                                { mode: 'flex', fr: 1 },
                                { mode: 'fixed', value: 28 },
                                { mode: 'flex', fr: 1 }
                            ],
                            gap: 6
                        },
                        zones: [
                            { id: 'left', elements: [{ type: 'bandLeft', content: 'VMPrint' }] },
                            { id: 'center', elements: [{ type: 'bandCenter', content: '12' }] },
                            { id: 'right', elements: [{ type: 'bandRight', content: 'vmprint.dev' }] }
                        ]
                    }
                ]
            }
        }
    };

    const resolvedStrip = resolveDocumentPaths(stripDoc, 'strip-doc.json');
    const resolvedZoneMap = resolveDocumentPaths(zoneMapDoc, 'zone-map-doc.json');

    _check(
        'strip lowers to zone-map during normalization',
        'top-level strip and footer strip normalize into zone-map elements',
        () => {
            assert.equal(resolvedStrip.elements[1]?.type, 'zone-map');
            assert.equal(resolvedStrip.footer?.default?.elements?.[0]?.type, 'zone-map');
        }
    );

    _check(
        'normalized strip structure matches authored zone-map structure',
        'strip lowering produces the same normalized geometry-facing AST as a direct zone-map',
        () => {
            assert.deepEqual(resolvedStrip.elements[1], resolvedZoneMap.elements[1]);
            assert.deepEqual(resolvedStrip.footer?.default?.elements?.[0], resolvedZoneMap.footer?.default?.elements?.[0]);
        }
    );

    _check(
        'zone-map normalization emits explicit region rectangles',
        'strip-lowered and authored zone-map structures normalize into region rects with x, y, and width',
        () => {
            const normalized = normalizeZoneMapElement(resolvedZoneMap.elements[1], 280);
            assert.equal(normalized.zones.length, 3);
            assert.deepEqual(normalized.zones.map((zone) => ({
                id: zone.id,
                x: zone.rect.x,
                y: zone.rect.y,
                width: zone.rect.width
            })), [
                { id: 'left', x: 0, y: 0, width: 110 },
                { id: 'center', x: 118, y: 0, width: 44 },
                { id: 'right', x: 170, y: 0, width: 110 }
            ]);
        }
    );

    const stripEngine = new LayoutEngine(toLayoutConfig(resolvedStrip, false), runtime);
    const zoneEngine = new LayoutEngine(toLayoutConfig(resolvedZoneMap, false), runtime);
    await stripEngine.waitForFonts();
    await zoneEngine.waitForFonts();

    const stripPages = stripEngine.simulate(resolvedStrip.elements);
    const zonePages = zoneEngine.simulate(resolvedZoneMap.elements);

    _check(
        'strip and equivalent zone-map render identically',
        'page snapshots are exactly equal',
        () => {
            assert.deepEqual(snapshotPages(stripPages), snapshotPages(zonePages));
        }
    );

    const explicitRegionDoc: DocumentInput = {
        ...baseDoc,
        elements: [
            {
                type: 'zone-map',
                content: '',
                properties: {
                    style: { marginBottom: 6 }
                },
                zones: [
                    {
                        id: 'main',
                        region: { x: 0, y: 0, width: 170 },
                        elements: [{ type: 'bandLeft', content: 'Main Region', properties: { sourceId: 'main-region' } }]
                    },
                    {
                        id: 'side',
                        region: { x: 188, y: 26, width: 92 },
                        elements: [{ type: 'bandRight', content: 'Side Region', properties: { sourceId: 'side-region' } }]
                    }
                ]
            }
        ]
    };

    const resolvedExplicitRegion = resolveDocumentPaths(explicitRegionDoc, 'zone-map-explicit-region.json');

    _check(
        'zone-map preserves authored explicit region geometry',
        'authored region rectangles survive normalization and become the zone field geometry',
        () => {
            assert.deepEqual(resolvedExplicitRegion.elements[0].zones?.map((zone: any) => ({
                id: zone.id,
                region: zone.region
            })), [
                { id: 'main', region: { x: 0, y: 0, width: 170 } },
                { id: 'side', region: { x: 188, y: 26, width: 92 } }
            ]);

            const normalized = normalizeZoneMapElement(resolvedExplicitRegion.elements[0], 280);
            assert.deepEqual(normalized.zones.map((zone) => ({
                id: zone.id,
                rect: zone.rect
            })), [
                { id: 'main', rect: { x: 0, y: 0, width: 170 } },
                { id: 'side', rect: { x: 188, y: 26, width: 92 } }
            ]);
        }
    );

    const explicitRegionEngine = new LayoutEngine(toLayoutConfig(resolvedExplicitRegion, false), runtime);
    await explicitRegionEngine.waitForFonts();
    const explicitRegionPages = explicitRegionEngine.simulate(resolvedExplicitRegion.elements);

    _check(
        'zone-map explicit regions affect rendered placement',
        'content in a later region renders to the right and below content in an earlier region when authored that way',
        () => {
            const page = explicitRegionPages[0];
            const mainBoxes = (page.boxes || []).filter((box: any) => {
                const actual = String(box.meta?.sourceId || '');
                return actual === 'main-region' || actual.endsWith(':main-region');
            });
            const sideBoxes = (page.boxes || []).filter((box: any) => {
                const actual = String(box.meta?.sourceId || '');
                return actual === 'side-region' || actual.endsWith(':side-region');
            });

            assert.ok(mainBoxes.length > 0, 'expected main region boxes');
            assert.ok(sideBoxes.length > 0, 'expected side region boxes');

            const mainLeft = Math.min(...mainBoxes.map((box: any) => Number(box.x || 0)));
            const mainTop = Math.min(...mainBoxes.map((box: any) => Number(box.y || 0)));
            const sideLeft = Math.min(...sideBoxes.map((box: any) => Number(box.x || 0)));
            const sideTop = Math.min(...sideBoxes.map((box: any) => Number(box.y || 0)));

            assert.ok(sideLeft > mainLeft + 150, `expected side region x (${sideLeft}) to sit right of main region x (${mainLeft})`);
            assert.ok(sideTop > mainTop + 20, `expected side region y (${sideTop}) to sit below main region y (${mainTop})`);
        }
    );

    _check(
        'zone-map publishes page-level debug regions',
        'finalized pages expose subtle debug overlay geometry for authored zones',
        () => {
            const page = explicitRegionPages[0];
            assert.ok(Array.isArray(page.debugZones), 'expected debugZones on finalized page');
            assert.deepEqual(
                page.debugZones?.map((zone: any) => ({
                    zoneId: zone.zoneId,
                    x: zone.x,
                    y: zone.y,
                    w: zone.w
                })),
                [
                    { zoneId: 'main', x: 20, y: 0, w: 170 },
                    { zoneId: 'side', x: 208, y: 26, w: 92 }
                ]
            );
        }
    );
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
