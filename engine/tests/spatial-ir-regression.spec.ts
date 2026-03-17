import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { loadJsonDocumentFixtures } from './harness/engine-harness';
import { createSpatialFixture } from './fixtures/regression/generate-spatial-ir-fixtures';

const UPDATE_SPATIAL_IR_SNAPSHOTS =
    process.argv.includes('--update-spatial-ir-snapshots') || process.env.VMPRINT_UPDATE_SPATIAL_IR_SNAPSHOTS === '1';

function logStep(message: string): void {
    console.log(`[spatial-ir-regression.spec] ${message}`);
}

function resolveSpatialIrSnapshotPath(fixturePath: string): string {
    const ext = path.extname(fixturePath);
    return fixturePath.slice(0, fixturePath.length - ext.length) + '.spatial-ir.json';
}

function assertSpatialIrSnapshot(fixtureName: string, fixturePath: string, actual: unknown): void {
    const snapshotPath = resolveSpatialIrSnapshotPath(fixturePath);
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
    const fixtures = loadJsonDocumentFixtures();
    assert.ok(fixtures.length > 0, 'no AST regression fixtures found');

    for (const fixture of fixtures) {
        logStep(`Fixture: ${fixture.name}`);
        const actualA = createSpatialFixture(fixture.document, fixture.name);
        const actualB = createSpatialFixture(fixture.document, fixture.name);

        assert.deepEqual(actualA, actualB, `${fixture.name}: repeated Spatial IR normalization drift`);
        assertSpatialIrSnapshot(fixture.name, fixture.filePath, actualA);
    }

    logStep(`OK (${fixtures.length} fixtures)`);
}

run();
