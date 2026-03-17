import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { LayoutEngine } from '../src/engine/layout-engine';
import { resolveDocumentPaths, toLayoutConfig } from '../src/engine/document';
import type { DocumentIR } from '../src/engine/types';
import type { SpatialDocument, SpatialSourceRecoveryError } from '../src/engine/spatial-document';
import { HARNESS_REGRESSION_CASES_DIR, loadLocalFontManager, snapshotPages } from './harness/engine-harness';
import { createEngineRuntime, setDefaultEngineRuntime } from '../src/engine/runtime';

function logStep(message: string): void {
    console.log(`[spatial-ir-strict.spec] ${message}`);
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
    logStep('Scenario: strict Spatial IR mode forbids AST/source recovery during fixture adaptation');

    const LocalFontManager = await loadLocalFontManager();
    const fixtureNames = fs.readdirSync(HARNESS_REGRESSION_CASES_DIR)
        .filter((file) => file.endsWith('.json') && !file.endsWith('.snapshot.layout.json') && !file.endsWith('.spatial-ir.json'))
        .sort((a, b) => a.localeCompare(b));

    const failures: Array<{ fixture: string; kind: 'source-recovery' | 'snapshot-mismatch' | 'unexpected-error'; message: string }> = [];
    const passes: string[] = [];

    for (const fixtureName of fixtureNames) {
        logStep(`Fixture: ${fixtureName}`);
        const fixturePath = path.join(HARNESS_REGRESSION_CASES_DIR, fixtureName);
        const spatialIrPath = resolveSpatialIrPath(fixtureName);
        const snapshotPath = resolveSnapshotPath(fixtureName);

        const sourceDocument = resolveDocumentPaths(
            JSON.parse(fs.readFileSync(fixturePath, 'utf8')),
            fixturePath
        ) as DocumentIR;
        const spatialDocument = JSON.parse(fs.readFileSync(spatialIrPath, 'utf8')) as SpatialDocument;
        const expected = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));

        const runtime = createEngineRuntime({ fontManager: new LocalFontManager() });
        setDefaultEngineRuntime(runtime);
        const engine = new LayoutEngine(toLayoutConfig(sourceDocument, false), runtime);
        await engine.waitForFonts();

        try {
            const pages = engine.simulateSpatialDocumentStrict(spatialDocument);
            assert.deepEqual(
                snapshotPages(pages),
                expected,
                `${fixtureName}: strict Spatial IR layout snapshot mismatch (${snapshotPath})`
            );
            passes.push(fixtureName);
        } catch (error) {
            if (error && typeof error === 'object' && (error as Error).name === 'SpatialSourceRecoveryError') {
                const recoveryError = error as SpatialSourceRecoveryError;
                failures.push({
                    fixture: fixtureName,
                    kind: 'source-recovery',
                    message: recoveryError.message
                });
                continue;
            }
            if (error instanceof assert.AssertionError) {
                failures.push({
                    fixture: fixtureName,
                    kind: 'snapshot-mismatch',
                    message: error.message
                });
                continue;
            }
            failures.push({
                fixture: fixtureName,
                kind: 'unexpected-error',
                message: error instanceof Error ? `${error.name}: ${error.message}` : String(error)
            });
        }
    }

    logStep(`Strict Spatial IR passes: ${passes.length}/${fixtureNames.length}`);
    if (passes.length > 0) {
        logStep(`Passing fixtures: ${passes.join(', ')}`);
    }
    if (failures.length > 0) {
        logStep('Strict Spatial IR failures:');
        for (const failure of failures) {
            logStep(`- ${failure.fixture} [${failure.kind}] ${failure.message}`);
        }
    }

    assert.equal(
        failures.length,
        0,
        `Strict Spatial IR still depends on AST/source recovery for ${failures.length} fixture(s).`
    );
}

run().catch((err) => {
    console.error('[spatial-ir-strict.spec] FAILED', err);
    process.exitCode = 1;
});
