import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { transformAstSource } from '@vmprint/source-transformer-ast';
import { HARNESS_REGRESSION_CASES_DIR } from './harness/engine-harness';
import { loadAstJsonDocumentFixtures } from '../../source-transformers/ast/tests/harness/ast-fixture-harness';

const UPDATE_SPATIAL_IR_SNAPSHOTS =
    process.argv.includes('--update-spatial-ir-snapshots') || process.env.VMPRINT_UPDATE_SPATIAL_IR_SNAPSHOTS === '1';

function logStep(message: string): void {
    console.log(`[spatial-ir-regression.spec] ${message}`);
}

function resolveSpatialIrSnapshotPath(fixtureName: string): string {
    return path.join(
        HARNESS_REGRESSION_CASES_DIR,
        fixtureName.slice(0, fixtureName.length - '.json'.length) + '.spatial-ir.json'
    );
}

function assertSpatialIrSnapshot(fixtureName: string, actual: unknown): void {
    const snapshotPath = resolveSpatialIrSnapshotPath(fixtureName);
    const serialized = `${JSON.stringify(actual, null, 2)}\n`;

    if (!fs.existsSync(snapshotPath)) {
        if (!UPDATE_SPATIAL_IR_SNAPSHOTS) {
            throw new Error(
                `${fixtureName}: Spatial IR snapshot missing at ${snapshotPath}. Re-run with --update-spatial-ir-snapshots or set VMPRINT_UPDATE_SPATIAL_IR_SNAPSHOTS=1.`
            );
        }
        fs.writeFileSync(snapshotPath, serialized, 'utf8');
        return;
    }

    if (UPDATE_SPATIAL_IR_SNAPSHOTS) {
        fs.writeFileSync(snapshotPath, serialized, 'utf8');
        return;
    }

    const expected = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
    assert.deepEqual(actual, expected, `${fixtureName}: Spatial IR snapshot mismatch (${snapshotPath})`);
}

function run(): void {
    logStep('Scenario: AST fixtures deterministically normalize into stored Spatial IR snapshots');
    const fixtures = loadAstJsonDocumentFixtures();
    assert.ok(fixtures.length > 0, 'no AST regression fixtures found');

    for (const fixture of fixtures) {
        logStep(`Fixture: ${fixture.name}`);
        const rawDocument = JSON.parse(fs.readFileSync(fixture.filePath, 'utf8'));
        const actualA = transformAstSource(rawDocument, fixture.filePath).spatialDocument;
        const actualB = transformAstSource(rawDocument, fixture.filePath).spatialDocument;

        assert.deepEqual(actualA, actualB, `${fixture.name}: repeated Spatial IR normalization drift`);
        assertSpatialIrSnapshot(fixture.name, actualA);
    }

    logStep(`OK (${fixtures.length} fixtures)`);
}

run();
