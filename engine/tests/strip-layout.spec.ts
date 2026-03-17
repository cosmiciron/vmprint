import assert from 'node:assert/strict';
import { CURRENT_DOCUMENT_VERSION, LayoutEngine, resolveDocumentPaths, toLayoutConfig, type DocumentInput } from '../src';
import { createEngineRuntime } from '../src/engine/runtime';
import { loadLocalFontManager, snapshotPages } from './harness/engine-harness';

function logStep(message: string): void {
    console.log(`[strip-layout.spec] ${message}`);
}

function check(description: string, expected: string, assertion: () => void): void {
    logStep(`CHECK: ${description}`);
    logStep(`EXPECT: ${expected}`);
    assertion();
    logStep(`PASS: ${description}`);
}

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

    check(
        'strip lowers to zone-map during normalization',
        'top-level strip and footer strip normalize into zone-map elements',
        () => {
            assert.equal(resolvedStrip.elements[1]?.type, 'zone-map');
            assert.equal(resolvedStrip.footer?.default?.elements?.[0]?.type, 'zone-map');
        }
    );

    check(
        'normalized strip structure matches authored zone-map structure',
        'strip lowering produces the same normalized geometry-facing AST as a direct zone-map',
        () => {
            assert.deepEqual(resolvedStrip.elements[1], resolvedZoneMap.elements[1]);
            assert.deepEqual(resolvedStrip.footer?.default?.elements?.[0], resolvedZoneMap.footer?.default?.elements?.[0]);
        }
    );

    const stripEngine = new LayoutEngine(toLayoutConfig(resolvedStrip, false), runtime);
    const zoneEngine = new LayoutEngine(toLayoutConfig(resolvedZoneMap, false), runtime);
    await stripEngine.waitForFonts();
    await zoneEngine.waitForFonts();

    const stripPages = stripEngine.simulate(resolvedStrip.elements);
    const zonePages = zoneEngine.simulate(resolvedZoneMap.elements);

    check(
        'strip and equivalent zone-map render identically',
        'page snapshots are exactly equal',
        () => {
            assert.deepEqual(snapshotPages(stripPages), snapshotPages(zonePages));
        }
    );
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
