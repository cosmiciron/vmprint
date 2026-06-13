import fs from 'node:fs';
import path from 'node:path';

import {
    LayoutEngine,
    loadDocument,
    setDefaultEngineRuntime,
    toLayoutConfig,
    type DocumentInput
} from '../../src';
import { createPrintEngineRuntime } from '../../src/font-management/runtime';
import { loadLocalFontManager } from '../harness/engine-harness';

const blockText = 'Visible viewport authority should publish only boxes in the requested browser world region while keeping world geometry stable. ';

const document: DocumentInput = {
    documentVersion: '1.1',
    layout: {
        pageSize: 'LETTER',
        margins: { top: 72, right: 72, bottom: 72, left: 72 },
        fontFamily: 'Arimo',
        fontSize: 13,
        lineHeight: 1.35,
        publicationMode: 'continuous',
        printBreakPolicy: 'ignore'
    },
    fonts: { regular: 'Arimo' },
    styles: {
        p: { marginBottom: 10, allowLineSplit: true, orphans: 2, widows: 2 }
    },
    elements: Array.from({ length: 180 }, (_, index) => ({
        type: 'p',
        name: `visibleProof${index + 1}`,
        content: `${index + 1}. ${blockText.repeat(2)}`
    }))
};

async function main(): Promise<void> {
    const LocalFontManager = await loadLocalFontManager();
    setDefaultEngineRuntime(createPrintEngineRuntime({ fontManager: new LocalFontManager() }));

    const ir = loadDocument(document, 'visible-world-viewport-proof');
    const engine = new LayoutEngine(toLayoutConfig(ir, false));
    await engine.waitForFonts();
    const pages = engine.simulate(ir.elements);
    const page = pages[0];
    const targetBox = page.boxes.find((box: any) => Number(box.y || 0) > 1600)
        ?? page.boxes[Math.floor(page.boxes.length / 2)];
    const request = {
        worldX: 0,
        worldY: Math.max(0, Number(targetBox.y || 0) - 32),
        width: page.width,
        height: Math.max(240, Number(targetBox.h || 0) + 96)
    };
    const events: any[] = [];
    const unlisten = engine.listen('layout.visibleWorldViewport', (event: any) => events.push(event));
    const ordinary = engine.send('layout.worldViewport', request) as any;
    const visible = engine.send('layout.visibleWorldViewport', request) as any;
    unlisten();

    const ordinaryBytes = Buffer.byteLength(JSON.stringify(ordinary));
    const visibleBytes = Buffer.byteLength(JSON.stringify(visible));
    const summary = {
        generatedAt: new Date().toISOString(),
        status: visible?.kind === 'world' && visible?.segments?.length === 1 && events.length === 1 ? 'pass' : 'gap',
        request,
        pageCount: pages.length,
        continuousPageHeight: page.height,
        ordinary: {
            segmentCount: ordinary?.segments?.length ?? 0,
            boxCount: ordinary?.segments?.[0]?.page?.boxes?.length ?? 0,
            payloadBytes: ordinaryBytes
        },
        visible: {
            segmentCount: visible?.segments?.length ?? 0,
            boxCount: visible?.segments?.[0]?.page?.boxes?.length ?? 0,
            payloadBytes: visibleBytes,
            payloadRatio: Number((visibleBytes / ordinaryBytes).toFixed(4)),
            sourceRect: visible?.segments?.[0]?.sourceRect ?? null,
            destinationRect: visible?.segments?.[0]?.destinationRect ?? null,
            eventMatches: events[0]?.payload?.sourceSignature === visible?.sourceSignature
        }
    };
    const out = path.resolve('tests/output/proofs/visible-world-viewport-summary.json');
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, `${JSON.stringify(summary, null, 2)}\n`);
    console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
