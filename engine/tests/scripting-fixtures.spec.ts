import assert from 'node:assert/strict';

import { toLayoutConfig } from '../src';
import { LayoutEngine } from '../src/engine/layout-engine';
import { createEngineRuntime, setDefaultEngineRuntime } from '../src/engine/runtime';
import { loadLocalFontManager } from './harness/engine-harness';
import { loadScriptingFixtures } from './harness/scripting-fixture-harness';
import { logStep, check, checkAsync } from './harness/test-utils';

const TEST_PREFIX = 'scripting-fixtures.spec';
const log = (msg: string) => logStep(TEST_PREFIX, msg);
const _check = (desc: string, exp: string, fn: () => void) => check(TEST_PREFIX, desc, exp, fn);
const _checkAsync = (desc: string, exp: string, fn: () => Promise<void>) => checkAsync(TEST_PREFIX, desc, exp, fn);

function extractRenderedText(pages: any[]): string {
    return pages
        .flatMap((page) => page.boxes || [])
        .flatMap((box) => box.lines || [])
        .map((line: any[]) => line.map((segment: any) => String(segment?.text || '')).join(''))
        .join('\n');
}

function findSourceNode(nodes: any[], sourceId: string): any | null {
    const stack = [...nodes];
    while (stack.length > 0) {
        const node = stack.shift();
        if (!node) continue;
        const nodeName = String(node?.name || node?.properties?.name || node?.properties?.sourceId || '');
        if (nodeName === sourceId) {
            return node;
        }
        if (Array.isArray(node.children)) stack.unshift(...node.children);
        if (Array.isArray(node.zones)) {
            for (const zone of node.zones) {
                if (Array.isArray(zone?.elements)) stack.unshift(...zone.elements);
            }
        }
        if (Array.isArray(node.slots)) {
            for (const slot of node.slots) {
                if (Array.isArray(slot?.elements)) stack.unshift(...slot.elements);
            }
        }
    }
    return null;
}

async function run(): Promise<void> {
    const LocalFontManager = await loadLocalFontManager();
    setDefaultEngineRuntime(createEngineRuntime({ fontManager: new LocalFontManager() }));

    const fixtures = loadScriptingFixtures();
    for (const fixture of fixtures) {
        log(`Scenario: scripting fixture ${fixture.name}`);
        const engine = new LayoutEngine(toLayoutConfig(fixture.document, false));
        await engine.waitForFonts();
        const pages = engine.simulate(fixture.document.elements);
        const renderedText = extractRenderedText(pages);
        const reader = engine.getLastSimulationReportReader();

        _check(
            `${fixture.name}: expected rendered text markers`,
            'rendered pages include the fixture-specific scripted output',
            () => {
                for (const expectedText of fixture.expectation.expectedTextIncludes || []) {
                    assert.ok(
                        renderedText.includes(expectedText),
                        `${fixture.name}: expected rendered text to include "${expectedText}"`
                    );
                }
            }
        );

        _check(
            `${fixture.name}: caller-owned JSON stays unchanged`,
            'scripted layout does not mutate the fixture source document object',
            () => {
                for (const expectation of fixture.expectation.originalTextUnchanged || []) {
                    const node = findSourceNode(fixture.rawDocument.elements || [], expectation.sourceId);
                    assert.ok(node, `${fixture.name}: missing source node ${expectation.sourceId}`);
                    assert.equal(
                        node.content,
                        expectation.content,
                        `${fixture.name}: original fixture source should remain unchanged for ${expectation.sourceId}`
                    );
                }
            }
        );

        _check(
            `${fixture.name}: script profile exact counters`,
            'profile preserves important exact script counters for replay-sensitive fixtures',
            () => {
                const profile = reader.profile || {};
                for (const [metric, expected] of Object.entries(fixture.expectation.profileEquals || {})) {
                    assert.equal(
                        Number((profile as any)[metric] || 0),
                        expected,
                        `${fixture.name}: expected profile.${metric} === ${expected}`
                    );
                }
            }
        );

        _check(
            `${fixture.name}: script profile lower bounds`,
            'profile records at least the expected handler/query/mutation activity',
            () => {
                const profile = reader.profile || {};
                for (const [metric, expected] of Object.entries(fixture.expectation.profileAtLeast || {})) {
                    assert.ok(
                        Number((profile as any)[metric] || 0) >= expected,
                        `${fixture.name}: expected profile.${metric} >= ${expected}, got ${Number((profile as any)[metric] || 0)}`
                    );
                }
            }
        );

        await _checkAsync(
            `${fixture.name}: report profile is present`,
            'simulation report exposes profile data for scripting fixtures',
            async () => {
                assert.ok(reader.profile, `${fixture.name}: expected simulation report profile`);
            }
        );
    }

    log('OK');
}

run().catch((error) => {
    console.error(`[${TEST_PREFIX}] FAILED`, error);
    process.exit(1);
});
