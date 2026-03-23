import assert from 'node:assert/strict';
import fs from 'node:fs';

import { transformAstSource } from './harness/ast-transform';
import { loadAstJsonDocumentFixtures } from './harness/ast-fixture-harness';

import { logStep } from './harness/test-utils';

const TEST_PREFIX = 'spatial-ir-regression.spec';
const log = (msg: string) => logStep(TEST_PREFIX, msg);

function run(): void {
    log('Scenario: AST fixtures deterministically normalize into Spatial IR in memory');
    const fixtures = loadAstJsonDocumentFixtures();
    assert.ok(fixtures.length > 0, 'no AST regression fixtures found');

    for (const fixture of fixtures) {
        log(`Fixture: ${fixture.name}`);
        const rawDocument = JSON.parse(fs.readFileSync(fixture.filePath, 'utf8'));
        const actualA = transformAstSource(rawDocument, fixture.filePath).spatialDocument;
        const actualB = transformAstSource(rawDocument, fixture.filePath).spatialDocument;

        assert.deepEqual(actualA, actualB, `${fixture.name}: repeated Spatial IR normalization drift`);
        assert.equal(typeof actualA, 'object', `${fixture.name}: transformAstSource should return a Spatial IR object`);
        assert.ok(actualA !== null, `${fixture.name}: Spatial IR should not be null`);
    }

    log(`OK (${fixtures.length} fixtures)`);
}

run();
