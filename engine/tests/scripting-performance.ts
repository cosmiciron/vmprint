import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

import { toLayoutConfig } from '../src';
import { LayoutEngine } from '../src/engine/layout-engine';
import { Renderer } from '../src/engine/renderer';
import { createEngineRuntime, setDefaultEngineRuntime } from '../src/engine/runtime';
import { loadLocalFontManager, MockContext } from './harness/engine-harness';
import {
    loadScriptingFixtures,
    SCRIPTING_FIXTURES_OUTPUT_DIR
} from './harness/scripting-fixture-harness';

type ScriptingPerfRow = {
    fixture: string;
    pages: number;
    simulateMs: number;
    renderMs: number;
    totalMs: number;
    scriptHandlerCalls: number;
    scriptHandlerMs: number;
    scriptBeforeLayoutCalls: number;
    scriptBeforeLayoutMs: number;
    scriptResolveCalls: number;
    scriptResolveMs: number;
    scriptAfterSettleCalls: number;
    scriptAfterSettleMs: number;
    scriptReplayRequests: number;
    scriptReplayPasses: number;
    scriptDocQueryCalls: number;
    scriptSetContentCalls: number;
    scriptReplaceCalls: number;
};

function round(value: number): number {
    return Number(value.toFixed(2));
}

async function run(): Promise<void> {
    const repeatArg = process.argv.find((arg) => arg.startsWith('--repeat='));
    const fixtureArg = process.argv.find((arg) => arg.startsWith('--fixture='));
    const writeOutput = process.argv.includes('--write-output');
    const repeatCount = Math.max(1, Number.parseInt((repeatArg?.split('=')[1] || '3'), 10) || 3);
    const fixtureFilter = (fixtureArg?.split('=')[1] || '').trim();

    const LocalFontManager = await loadLocalFontManager();
    setDefaultEngineRuntime(createEngineRuntime({ fontManager: new LocalFontManager() }));

    const fixtures = loadScriptingFixtures()
        .filter((fixture) => !fixtureFilter || fixture.name.includes(fixtureFilter));
    if (fixtures.length === 0) {
        throw new Error(
            fixtureFilter
                ? `No scripting fixtures matched --fixture=${fixtureFilter}`
                : 'No scripting fixtures found'
        );
    }

    const rows: ScriptingPerfRow[] = [];
    for (const fixture of fixtures) {
        const samples: ScriptingPerfRow[] = [];
        for (let runIndex = 0; runIndex < repeatCount; runIndex += 1) {
            const runtime = createEngineRuntime({ fontManager: new LocalFontManager() });
            const engine = new LayoutEngine(toLayoutConfig(fixture.document, false), runtime);
            await engine.waitForFonts();

            const t0 = performance.now();
            const pages = engine.simulate(fixture.document.elements);
            const t1 = performance.now();

            const renderer = new Renderer(toLayoutConfig(fixture.document, false), false, runtime);
            const context = new MockContext();
            await renderer.render(pages, context);
            const t2 = performance.now();

            const profile = engine.getLastSimulationReportReader().profile;
            samples.push({
                fixture: fixture.name,
                pages: pages.length,
                simulateMs: round(t1 - t0),
                renderMs: round(t2 - t1),
                totalMs: round(t2 - t0),
                scriptHandlerCalls: Number(profile?.scriptHandlerCalls || 0),
                scriptHandlerMs: round(Number(profile?.scriptHandlerMs || 0)),
                scriptBeforeLayoutCalls: Number(profile?.scriptBeforeLayoutCalls || 0),
                scriptBeforeLayoutMs: round(Number(profile?.scriptBeforeLayoutMs || 0)),
                scriptResolveCalls: Number(profile?.scriptResolveCalls || 0),
                scriptResolveMs: round(Number(profile?.scriptResolveMs || 0)),
                scriptAfterSettleCalls: Number(profile?.scriptAfterSettleCalls || 0),
                scriptAfterSettleMs: round(Number(profile?.scriptAfterSettleMs || 0)),
                scriptReplayRequests: Number(profile?.scriptReplayRequests || 0),
                scriptReplayPasses: Number(profile?.scriptReplayPasses || 0),
                scriptDocQueryCalls: Number(profile?.scriptDocQueryCalls || 0),
                scriptSetContentCalls: Number(profile?.scriptSetContentCalls || 0),
                scriptReplaceCalls: Number(profile?.scriptReplaceCalls || 0)
            });
        }

        const average = (selector: (row: ScriptingPerfRow) => number): number =>
            round(samples.reduce((sum, row) => sum + selector(row), 0) / samples.length);
        rows.push({
            fixture: fixture.name,
            pages: samples[0].pages,
            simulateMs: average((row) => row.simulateMs),
            renderMs: average((row) => row.renderMs),
            totalMs: average((row) => row.totalMs),
            scriptHandlerCalls: average((row) => row.scriptHandlerCalls),
            scriptHandlerMs: average((row) => row.scriptHandlerMs),
            scriptBeforeLayoutCalls: average((row) => row.scriptBeforeLayoutCalls),
            scriptBeforeLayoutMs: average((row) => row.scriptBeforeLayoutMs),
            scriptResolveCalls: average((row) => row.scriptResolveCalls),
            scriptResolveMs: average((row) => row.scriptResolveMs),
            scriptAfterSettleCalls: average((row) => row.scriptAfterSettleCalls),
            scriptAfterSettleMs: average((row) => row.scriptAfterSettleMs),
            scriptReplayRequests: average((row) => row.scriptReplayRequests),
            scriptReplayPasses: average((row) => row.scriptReplayPasses),
            scriptDocQueryCalls: average((row) => row.scriptDocQueryCalls),
            scriptSetContentCalls: average((row) => row.scriptSetContentCalls),
            scriptReplaceCalls: average((row) => row.scriptReplaceCalls)
        });
    }

    if (writeOutput) {
        fs.mkdirSync(SCRIPTING_FIXTURES_OUTPUT_DIR, { recursive: true });
        for (const row of rows) {
            const outputPath = path.join(
                SCRIPTING_FIXTURES_OUTPUT_DIR,
                row.fixture.replace(/\.json$/i, '.profile.json')
            );
            fs.writeFileSync(outputPath, `${JSON.stringify(row, null, 2)}\n`, 'utf-8');
        }
        fs.writeFileSync(
            path.join(SCRIPTING_FIXTURES_OUTPUT_DIR, 'summary.profile.json'),
            `${JSON.stringify(rows, null, 2)}\n`,
            'utf-8'
        );
    }

    console.log('=== VMPrint Scripting Performance ===');
    console.log(`repeatCount=${repeatCount}${fixtureFilter ? `, filter=${fixtureFilter}` : ''}`);
    console.table(rows);
}

run().catch((error) => {
    console.error('[scripting-performance] FAILED', error);
    process.exit(1);
});
