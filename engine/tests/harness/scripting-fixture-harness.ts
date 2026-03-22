import fs from 'node:fs';
import path from 'node:path';

import { parseDocumentSourceText, resolveDocumentSourceText, type DocumentIR } from '../../src';
import { HARNESS_SCRIPTING_CASES_DIR } from './engine-harness';

export type ScriptingFixtureExpectation = {
    expectedTextIncludes?: string[];
    expectedTextExcludes?: string[];
    originalTextUnchanged?: Array<{
        sourceId: string;
        content: string;
    }>;
    profileEquals?: Record<string, number>;
    profileAtLeast?: Record<string, number>;
};

export const SCRIPTING_FIXTURES_DIR = HARNESS_SCRIPTING_CASES_DIR;
export const SCRIPTING_FIXTURES_OUTPUT_DIR = path.join(SCRIPTING_FIXTURES_DIR, 'output');

export function listScriptingFixtureNames(casesDir: string = SCRIPTING_FIXTURES_DIR): string[] {
    return fs.readdirSync(casesDir)
        .filter((file) => file.toLowerCase().endsWith('.json'))
        .filter((file) => !file.endsWith('.expected.json'))
        .sort((a, b) => a.localeCompare(b));
}

export function getScriptingFixturePath(fixtureName: string, casesDir: string = SCRIPTING_FIXTURES_DIR): string {
    return path.join(casesDir, fixtureName);
}

export function getScriptingExpectationPath(fixtureName: string, casesDir: string = SCRIPTING_FIXTURES_DIR): string {
    return path.join(casesDir, fixtureName.replace(/\.json$/i, '.expected.json'));
}

export function loadScriptingFixtures(
    casesDir: string = SCRIPTING_FIXTURES_DIR
): Array<{
    name: string;
    filePath: string;
    document: DocumentIR;
    rawDocument: any;
    expectation: ScriptingFixtureExpectation;
}> {
    return listScriptingFixtureNames(casesDir).map((name) => {
        const filePath = getScriptingFixturePath(name, casesDir);
        const sourceText = fs.readFileSync(filePath, 'utf-8');
        const rawDocument = parseDocumentSourceText(sourceText, filePath);
        const expectationPath = getScriptingExpectationPath(name, casesDir);
        const expectation = fs.existsSync(expectationPath)
            ? JSON.parse(fs.readFileSync(expectationPath, 'utf-8')) as ScriptingFixtureExpectation
            : {};

        return {
            name,
            filePath,
            rawDocument,
            document: resolveDocumentSourceText(sourceText, filePath),
            expectation
        };
    });
}
