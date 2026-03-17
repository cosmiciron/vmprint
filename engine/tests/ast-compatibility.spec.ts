import assert from 'node:assert/strict';

import { LayoutEngine, createEngineRuntime, resolveDocumentPaths, setDefaultEngineRuntime, toLayoutConfig, type DocumentInput, type DocumentIR, type Element, type PageRegionContent } from '../src';
import { loadAstJsonDocumentFixtures } from './harness/ast-fixture-harness';
import { loadLocalFontManager, snapshotPages } from './harness/engine-harness';

function logStep(message: string): void {
    console.log(`[ast-compatibility.spec] ${message}`);
}

function checkAsync(description: string, expected: string, assertion: () => Promise<void>): Promise<void> {
    logStep(`CHECK: ${description}`);
    logStep(`EXPECT: ${expected}`);
    return assertion().then(() => logStep(`PASS: ${description}`));
}

function clone<T>(value: T): T {
    return JSON.parse(JSON.stringify(value));
}

function isObject(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function downgradeElementToAst10(element: Element): Element {
    const next = clone(element) as Element;
    const properties = isObject(next.properties) ? { ...(next.properties as Record<string, unknown>) } : {};

    if (next.image !== undefined) {
        properties.image = next.image;
        delete (next as Partial<Element>).image;
    }
    if (next.table !== undefined) {
        properties.table = next.table;
        delete (next as Partial<Element>).table;
    }
    if (next.zoneLayout !== undefined) {
        properties.zones = next.zoneLayout;
        delete (next as Partial<Element>).zoneLayout;
    }
    if (next.stripLayout !== undefined) {
        properties.strip = next.stripLayout;
        delete (next as Partial<Element>).stripLayout;
    }
    if (next.dropCap !== undefined) {
        properties.dropCap = next.dropCap;
        delete (next as Partial<Element>).dropCap;
    }
    if (next.columnSpan !== undefined) {
        properties.columnSpan = next.columnSpan;
        delete (next as Partial<Element>).columnSpan;
    }

    if (Array.isArray(next.children)) {
        next.children = next.children.map((child) => downgradeElementToAst10(child));
    }
    if (Array.isArray(next.zones)) {
        next.zones = next.zones.map((zone) => ({
            ...zone,
            elements: Array.isArray(zone?.elements) ? zone.elements.map((child) => downgradeElementToAst10(child)) : []
        }));
    }
    if (Array.isArray(next.slots)) {
        next.slots = next.slots.map((slot) => ({
            ...slot,
            elements: Array.isArray(slot?.elements) ? slot.elements.map((child) => downgradeElementToAst10(child)) : []
        }));
    }

    if (Object.keys(properties).length > 0) {
        next.properties = properties as Element['properties'];
    } else {
        delete (next as Partial<Element>).properties;
    }

    return next;
}

function downgradeRegionToAst10(region?: PageRegionContent | null): PageRegionContent | null | undefined {
    if (!region || !Array.isArray(region.elements)) return region;
    return {
        ...clone(region),
        elements: region.elements.map((element) => downgradeElementToAst10(element))
    };
}

function downgradeDocumentToAst10(document: DocumentInput | DocumentIR): DocumentInput {
    return {
        ...(clone(document) as DocumentInput),
        documentVersion: '1.0',
        elements: document.elements.map((element) => downgradeElementToAst10(element)),
        header: downgradeRegionToAst10(document.header),
        footer: downgradeRegionToAst10(document.footer)
    };
}

async function renderSnapshot(document: DocumentInput | DocumentIR): Promise<unknown> {
    const prepared = isObject(document) && typeof (document as DocumentIR).irVersion === 'string'
        ? (clone(document) as DocumentIR)
        : resolveDocumentPaths(clone(document), '<compat>');
    const config = toLayoutConfig(prepared as DocumentIR);
    const engine = new LayoutEngine(config);
    await engine.waitForFonts();
    return snapshotPages(engine.simulate(prepared.elements));
}

async function run(): Promise<void> {
    const LocalFontManager = await loadLocalFontManager();
    setDefaultEngineRuntime(createEngineRuntime({ fontManager: new LocalFontManager() }));

    const allFixtures = loadAstJsonDocumentFixtures();
    const selectedFixtures = [
        '08-dropcap-pagination.json',
        '09-tables-spans-pagination.json',
        '14-flow-images-multipage.json',
        '20-block-floats-and-column-span.json',
        '21-zone-map-sidebar.json'
    ];

    for (const fixtureName of selectedFixtures) {
        const fixture = allFixtures.find((entry) => entry.name === fixtureName);
        assert.ok(fixture, `missing fixture ${fixtureName}`);

        await checkAsync(
            `AST 1.0 compatibility parity for ${fixtureName}`,
            'downgraded AST 1.0 and canonical AST 1.1 render identical snapshots',
            async () => {
                const ast11 = clone(fixture.document) as DocumentInput;
                ast11.documentVersion = '1.1';
                const ast10 = downgradeDocumentToAst10(ast11);

                const ast11Snapshot = await renderSnapshot(ast11);
                const ast10Snapshot = await renderSnapshot(ast10);

                assert.deepEqual(ast10Snapshot, ast11Snapshot);
            }
        );
    }

    await checkAsync(
        'AST 1.0 compatibility parity for strip',
        'legacy properties.strip and AST 1.1 stripLayout render identically',
        async () => {
            const base: DocumentInput = {
                documentVersion: '1.1',
                layout: {
                    pageSize: { width: 360, height: 240 },
                    margins: { top: 24, right: 24, bottom: 24, left: 24 },
                    fontFamily: 'Arimo',
                    fontSize: 10,
                    lineHeight: 1.2
                },
                fonts: { regular: 'Arimo' },
                styles: {
                    'folio-left': { fontSize: 9 },
                    'folio-center': { fontSize: 9, textAlign: 'center' },
                    'folio-right': { fontSize: 9, textAlign: 'right' }
                },
                elements: [
                    {
                        type: 'strip',
                        content: '',
                        stripLayout: {
                            tracks: [
                                { mode: 'flex', fr: 1 },
                                { mode: 'fixed', value: 24 },
                                { mode: 'flex', fr: 1 }
                            ],
                            gap: 8
                        },
                        slots: [
                            { id: 'left', elements: [{ type: 'folio-left', content: 'VMPRINT' }] },
                            { id: 'center', elements: [{ type: 'folio-center', content: '{pageNumber}' }] },
                            { id: 'right', elements: [{ type: 'folio-right', content: 'ISSUE 12' }] }
                        ]
                    }
                ]
            };

            const ast10 = downgradeDocumentToAst10(base);
            const ast11Snapshot = await renderSnapshot(base);
            const ast10Snapshot = await renderSnapshot(ast10);
            assert.deepEqual(ast10Snapshot, ast11Snapshot);
        }
    );

    logStep('OK');
}

run().catch((err) => {
    console.error('[ast-compatibility.spec] FAILED', err);
    process.exit(1);
});
