import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { LayoutEngine } from '../src/engine/layout-engine';
import { parseDocumentSourceText, resolveDocumentPaths, toLayoutConfig, type DocumentIR } from '../src';
import { HARNESS_REGRESSION_CASES_DIR, loadLocalFontManager, snapshotPages } from './harness/engine-harness';
import { setDefaultEngineRuntime } from '../src/engine/runtime';
import { createPrintEngineRuntime } from '../src/font-management/runtime';
import { getAstFixturePath } from './harness/ast-fixture-harness';
import { transformAstSource } from './harness/ast-transform';
import { logStep } from './harness/test-utils';

const TEST_PREFIX = 'spatial-ir-engine.spec';
const log = (msg: string) => logStep(TEST_PREFIX, msg);

function resolveSnapshotPath(fixtureName: string): string {
    return path.join(
        HARNESS_REGRESSION_CASES_DIR,
        fixtureName.slice(0, fixtureName.length - '.json'.length) + '.snapshot.layout.json'
    );
}

async function run(): Promise<void> {
    log('Scenario: AST-normalized Spatial IR can be adapted into the engine and match stored layout snapshots');

    const LocalFontManager = await loadLocalFontManager();

    const selectedFixtures = [
        '00-all-capabilities.json',
        '01-text-flow-core.json',
        '02-text-layout-advanced.json',
        '03-typography-type-specimen.json',
        '04-multilingual-scripts.json',
        '05-page-size-letter-landscape.json',
        '06-page-size-custom-landscape.json',
        '07-pagination-fragments.json',
        '08-dropcap-pagination.json',
        '10-packager-split-scenarios.json',
        '11-story-image-floats.json',
        '12-inline-baseline-alignment.json',
        '13-inline-rich-objects.json',
        '14-flow-images-multipage.json',
        '16-standard-fonts-pdf14.json',
        '18-multilingual-arabic.json',
        '19-accepted-split-branching.json',
        '21-zone-map-sidebar.json',
        '09-tables-spans-pagination.json',
        '15-story-multi-column.json',
        '17-header-footer-test.json',
        '20-block-floats-and-column-span.json',
        '22-story-nested-table-continuation.json',
        '23-story-nested-story-continuation.json'
    ];

    for (const fixtureName of selectedFixtures) {
        log(`Fixture: ${fixtureName}`);
        const fixturePath = getAstFixturePath(fixtureName);
        const snapshotPath = resolveSnapshotPath(fixtureName);

        const rawDocument = parseDocumentSourceText(fs.readFileSync(fixturePath, 'utf8'), fixturePath);
        const sourceDocument = resolveDocumentPaths(
            rawDocument,
            fixturePath
        ) as DocumentIR;
        const spatialDocument = transformAstSource(rawDocument, fixturePath).spatialDocument;
        const expected = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));

        // Keep fixture adaptation checks isolated from cross-document runtime caches.
        const runtime = createPrintEngineRuntime({ fontManager: new LocalFontManager() });
        setDefaultEngineRuntime(runtime);
        const engine = new LayoutEngine(toLayoutConfig(sourceDocument, false), runtime);
        await engine.waitForFonts();
        const pages = engine.simulateSpatialDocument(spatialDocument);

        assert.deepEqual(
            snapshotPages(pages),
            expected,
            `${fixtureName}: Spatial IR engine path layout snapshot mismatch (${snapshotPath})`
        );
    }

    log(`OK (${selectedFixtures.length} fixtures)`);
}

run().catch((err) => {
    console.error('[spatial-ir-engine.spec] FAILED', err);
    process.exitCode = 1;
});
