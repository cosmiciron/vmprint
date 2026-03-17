import fs from 'node:fs';
import path from 'node:path';

import { resolveDocumentPaths, type DocumentIR } from '../../src';
import { HARNESS_REGRESSION_CASES_DIR } from './engine-harness';

export const AST_FIXTURES_DIR = HARNESS_REGRESSION_CASES_DIR;

export function listAstFixtureNames(casesDir: string = AST_FIXTURES_DIR): string[] {
    return fs.readdirSync(casesDir)
        .filter((file) => file.toLowerCase().endsWith('.json'))
        .filter((file) => !file.endsWith('.snapshot.layout.json'))
        .filter((file) => !file.endsWith('.spatial-ir.json'))
        .sort((a, b) => a.localeCompare(b));
}

export function getAstFixturePath(fixtureName: string, casesDir: string = AST_FIXTURES_DIR): string {
    return path.join(casesDir, fixtureName);
}

export function loadAstJsonDocumentFixtures(casesDir: string = AST_FIXTURES_DIR): Array<{ name: string; document: DocumentIR; filePath: string }> {
    return listAstFixtureNames(casesDir).map((name) => {
        const filePath = getAstFixturePath(name, casesDir);
        return {
            name,
            filePath,
            document: resolveDocumentPaths(JSON.parse(fs.readFileSync(filePath, 'utf-8')), filePath)
        };
    });
}
