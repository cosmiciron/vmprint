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
    handlerCalls: number;
    handlerMs: number;
    loadCalls: number;
    loadMs: number;
    createCalls: number;
    createMs: number;
    readyCalls: number;
    readyMs: number;
    replayRequests: number;
    replayPasses: number;
    docQueryCalls: number;
    setContentCalls: number;
    replaceCalls: number;
    insertCalls: number;
    removeCalls: number;
    messageSendCalls: number;
    messageHandlerCalls: number;
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
                handlerCalls: Number(profile?.handlerCalls || 0),
                handlerMs: round(Number(profile?.handlerMs || 0)),
                loadCalls: Number(profile?.loadCalls || 0),
                loadMs: round(Number(profile?.loadMs || 0)),
                createCalls: Number(profile?.createCalls || 0),
                createMs: round(Number(profile?.createMs || 0)),
                readyCalls: Number(profile?.readyCalls || 0),
                readyMs: round(Number(profile?.readyMs || 0)),
                replayRequests: Number(profile?.replayRequests || 0),
                replayPasses: Number(profile?.replayPasses || 0),
                docQueryCalls: Number(profile?.docQueryCalls || 0),
                setContentCalls: Number(profile?.setContentCalls || 0),
                replaceCalls: Number(profile?.replaceCalls || 0),
                insertCalls: Number(profile?.insertCalls || 0),
                removeCalls: Number(profile?.removeCalls || 0),
                messageSendCalls: Number(profile?.messageSendCalls || 0),
                messageHandlerCalls: Number(profile?.messageHandlerCalls || 0)
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
            handlerCalls: average((row) => row.handlerCalls),
            handlerMs: average((row) => row.handlerMs),
            loadCalls: average((row) => row.loadCalls),
            loadMs: average((row) => row.loadMs),
            createCalls: average((row) => row.createCalls),
            createMs: average((row) => row.createMs),
            readyCalls: average((row) => row.readyCalls),
            readyMs: average((row) => row.readyMs),
            replayRequests: average((row) => row.replayRequests),
            replayPasses: average((row) => row.replayPasses),
            docQueryCalls: average((row) => row.docQueryCalls),
            setContentCalls: average((row) => row.setContentCalls),
            replaceCalls: average((row) => row.replaceCalls),
            insertCalls: average((row) => row.insertCalls),
            removeCalls: average((row) => row.removeCalls),
            messageSendCalls: average((row) => row.messageSendCalls),
            messageHandlerCalls: average((row) => row.messageHandlerCalls)
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
