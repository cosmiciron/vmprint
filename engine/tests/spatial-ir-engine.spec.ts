import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { LayoutEngine } from '../src/engine/layout-engine';
import { resolveDocumentPaths, toLayoutConfig, type DocumentIR } from '@vmprint/source-transformer-ast';
import type { SpatialDocument } from '../src/engine/spatial-document';
import { HARNESS_REGRESSION_CASES_DIR, loadLocalFontManager, snapshotPages } from './harness/engine-harness';
import { createEngineRuntime, setDefaultEngineRuntime } from '../src/engine/runtime';
import { getAstFixturePath } from '../../source-transformers/ast/tests/harness/ast-fixture-harness';

function logStep(message: string): void {
    console.log(`[spatial-ir-engine.spec] ${message}`);
}

function resolveSpatialIrPath(fixtureName: string): string {
    return path.join(
        HARNESS_REGRESSION_CASES_DIR,
        fixtureName.slice(0, fixtureName.length - '.json'.length) + '.spatial-ir.json'
    );
}

function resolveSnapshotPath(fixtureName: string): string {
    return path.join(
        HARNESS_REGRESSION_CASES_DIR,
        fixtureName.slice(0, fixtureName.length - '.json'.length) + '.snapshot.layout.json'
    );
}

async function run(): Promise<void> {
    logStep('Scenario: selected Spatial IR fixtures can be adapted into the engine and match stored layout snapshots');

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
        '20-block-floats-and-column-span.json'
    ];

    for (const fixtureName of selectedFixtures) {
        logStep(`Fixture: ${fixtureName}`);
        const fixturePath = getAstFixturePath(fixtureName);
        const spatialIrPath = resolveSpatialIrPath(fixtureName);
        const snapshotPath = resolveSnapshotPath(fixtureName);

        const sourceDocument = resolveDocumentPaths(
            JSON.parse(fs.readFileSync(fixturePath, 'utf8')),
            fixturePath
        ) as DocumentIR;
        const spatialDocument = JSON.parse(fs.readFileSync(spatialIrPath, 'utf8')) as SpatialDocument;
        const expected = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));

        // Keep fixture adaptation checks isolated from cross-document runtime caches.
        const runtime = createEngineRuntime({ fontManager: new LocalFontManager() });
        setDefaultEngineRuntime(runtime);
        const engine = new LayoutEngine(toLayoutConfig(sourceDocument, false), runtime);
        const pages = await engine.page(spatialDocument);

        assert.deepEqual(
            snapshotPages(pages),
            expected,
            `${fixtureName}: Spatial IR engine path layout snapshot mismatch (${snapshotPath})`
        );
    }

    logStep(`OK (${selectedFixtures.length} fixtures)`);
}

run().catch((err) => {
    console.error('[spatial-ir-engine.spec] FAILED', err);
    process.exitCode = 1;
});
