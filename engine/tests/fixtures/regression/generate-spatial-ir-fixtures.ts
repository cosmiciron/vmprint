#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    transformAstSource,
    type DocumentInput,
    type SpatialDocumentFixture
} from '../../harness/ast-transform';
import {
    AST_FIXTURES_DIR,
    getAstFixturePath,
    listAstFixtureNames
} from '../../harness/ast-fixture-harness';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REGRESSION_DIR = __dirname;

export function readDocumentFixture(fixturePath: string): DocumentInput {
    const raw = JSON.parse(fs.readFileSync(fixturePath, 'utf8')) as DocumentInput;
    return raw;
}

export function createSpatialFixture(document: DocumentInput, fixturePath: string): SpatialDocumentFixture {
    return transformAstSource(document, fixturePath).spatialDocument;
}

function getFixtureNamesFromArgs(): string[] {
    const args = process.argv.slice(2).filter((entry) => entry.trim().length > 0);
    if (args.length === 0) {
        return listAstFixtureNames(AST_FIXTURES_DIR);
    }
    return args.map((entry) => entry.endsWith('.json') ? entry : `${entry}.json`);
}

export function writeFixtureOutput(fixtureName: string, spatialFixture: SpatialDocumentFixture): void {
    const outputPath = path.join(REGRESSION_DIR, fixtureName.replace(/\.json$/i, '.spatial-ir.json'));
    fs.writeFileSync(outputPath, `${JSON.stringify(spatialFixture, null, 2)}\n`, 'utf8');
}

export function run(): void {
    const fixtureNames = getFixtureNamesFromArgs();
    let written = 0;

    for (const fixtureName of fixtureNames) {
        const fixturePath = getAstFixturePath(fixtureName, AST_FIXTURES_DIR);
        if (!fs.existsSync(fixturePath)) {
            throw new Error(`[generate-spatial-ir-fixtures] Fixture not found: ${fixtureName}`);
        }

        const document = readDocumentFixture(fixturePath);
        const spatialFixture = createSpatialFixture(document, fixturePath);
        writeFixtureOutput(fixtureName, spatialFixture);
        console.log(`[generate-spatial-ir-fixtures] Wrote ${fixtureName.replace(/\.json$/i, '.spatial-ir.json')}`);
        written += 1;
    }

    console.log(`[generate-spatial-ir-fixtures] Done (${written} fixtures).`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
    run();
}
