import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { LayoutEngine } from '../src/engine/layout-engine';
import { resolveDocumentPaths, toLayoutConfig } from '../src/engine/document';
import { createEngineRuntime, setDefaultEngineRuntime } from '../src/engine/runtime';
import { HARNESS_REGRESSION_CASES_DIR, loadLocalFontManager, snapshotPages } from './harness/engine-harness';

function logStep(message: string): void {
    console.log(`[shared-runtime-font-leak.spec] ${message}`);
}

function loadFixtureDocument(fixtureName: string) {
    const fixturePath = path.join(HARNESS_REGRESSION_CASES_DIR, fixtureName);
    return resolveDocumentPaths(
        JSON.parse(fs.readFileSync(fixturePath, 'utf8')),
        fixturePath
    );
}

function getFirstDropCapFamily(pages: any[]): string | null {
    const dropCap = pages
        .flatMap((page) => page.boxes || [])
        .find((box) => box.type === 'dropcap');
    const family = dropCap?.lines?.[0]?.[0]?.fontFamily;
    return typeof family === 'string' && family.trim().length > 0 ? family : null;
}

async function renderFixtureWithRuntime(document: any, runtime: any): Promise<any[]> {
    setDefaultEngineRuntime(runtime);
    const engine = new LayoutEngine(toLayoutConfig(document, false), runtime);
    await engine.waitForFonts();
    return snapshotPages(engine.simulate(document.elements));
}

async function run(): Promise<void> {
    logStep('Scenario: shared EngineRuntime state currently leaks font selection across documents');

    const LocalFontManager = await loadLocalFontManager();
    const fixtureSequence = [
        '01-text-flow-core.json',
        '21-zone-map-sidebar.json',
        '09-tables-spans-pagination.json',
        '15-story-multi-column.json'
    ];
    const documents = fixtureSequence.map((fixtureName) => loadFixtureDocument(fixtureName));
    const targetDocument = documents[documents.length - 1];

    const isolatedRuntime = createEngineRuntime({ fontManager: new LocalFontManager() });
    const isolatedPages = await renderFixtureWithRuntime(targetDocument, isolatedRuntime);
    const isolatedFamily = getFirstDropCapFamily(isolatedPages);
    assert.equal(
        isolatedFamily,
        'Times New Roman',
        'Isolated render should preserve the expected drop cap font family for 15-story-multi-column'
    );

    const sharedRuntime = createEngineRuntime({ fontManager: new LocalFontManager() });
    let sharedPages: any[] = [];
    for (const document of documents) {
        sharedPages = await renderFixtureWithRuntime(document, sharedRuntime);
    }
    const sharedFamily = getFirstDropCapFamily(sharedPages);

    assert.notEqual(
        sharedFamily,
        isolatedFamily,
        'Shared runtime render is expected to reproduce the current cross-document font leak'
    );

    logStep(`Observed isolated family=${isolatedFamily}, shared family=${sharedFamily}`);
}

run().catch((err) => {
    console.error('[shared-runtime-font-leak.spec] FAILED', err);
    process.exitCode = 1;
});
