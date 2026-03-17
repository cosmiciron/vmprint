import fs from 'node:fs';
import { performance } from 'node:perf_hooks';
import * as engineModule from '../src/index.ts';
import * as harnessModule from './harness/engine-harness.ts';
import { resolveDocumentPaths, toLayoutConfig } from '../src';
import { getAstFixturePath, listAstFixtureNames } from './harness/ast-fixture-harness';
import { transformAstSource } from './harness/ast-transform';

type BenchmarkMode = 'ast' | 'spatial-ir';

type FixtureMetric = {
    file: string;
    mode: BenchmarkMode;
    pages: number;
    boxes: number;
    textCalls: number;
    imageCalls: number;
    fontMs: number;
    layoutMs: number;
    renderMs: number;
    totalMs: number;
};

type FixtureComparison = {
    file: string;
    pages: number;
    astTotalMs: number;
    spatialIrTotalMs: number;
    deltaMs: number;
    deltaPct: number;
    astLayoutMs: number;
    spatialIrLayoutMs: number;
    layoutDeltaMs: number;
    layoutDeltaPct: number;
    astRenderMs: number;
    spatialIrRenderMs: number;
};

type Summary = {
    warmupCount: number;
    repeatCount: number;
    fixtureCount: number;
    modes: Record<BenchmarkMode, {
        totalLayoutMs: number;
        totalRenderMs: number;
        totalMs: number;
    }>;
    topByTotalMs: Record<BenchmarkMode, FixtureMetric[]>;
    comparisons: {
        averageDeltaMs: number;
        averageDeltaPct: number;
        fastestSpatialIrGainMs: number;
        worstSpatialIrRegressionMs: number;
        topByDeltaMs: FixtureComparison[];
    };
};

const PERF_WATCHLIST = [
    '00-all-capabilities.json',
    '03-typography-type-specimen.json',
    '07-pagination-fragments.json',
    '08-dropcap-pagination.json',
    '09-tables-spans-pagination.json',
    '14-flow-images-multipage.json',
    '15-story-multi-column.json',
    '20-block-floats-and-column-span.json'
] as const;

const engine = (engineModule as any).default ?? (engineModule as any)['module.exports'] ?? engineModule;
const harness = (harnessModule as any).default ?? (harnessModule as any)['module.exports'] ?? harnessModule;
const {
    LayoutEngine,
    Renderer,
    createEngineRuntime,
    LayoutUtils
} = engine as any;
const { MockContext, loadLocalFontManager } = harness as any;

function average(metrics: FixtureMetric[]): FixtureMetric[] {
    const byKey = new Map<string, FixtureMetric[]>();
    for (const metric of metrics) {
        const key = `${metric.mode}:${metric.file}`;
        const bucket = byKey.get(key) || [];
        bucket.push(metric);
        byKey.set(key, bucket);
    }

    return Array.from(byKey.values())
        .map((bucket) => {
            const n = bucket.length || 1;
            const sample = bucket[0];
            const sum = (selector: (item: FixtureMetric) => number) => bucket.reduce((acc, item) => acc + selector(item), 0);
            return {
                file: sample.file,
                mode: sample.mode,
                pages: sample.pages,
                boxes: sample.boxes,
                textCalls: sample.textCalls,
                imageCalls: sample.imageCalls,
                fontMs: Number((sum((item) => item.fontMs) / n).toFixed(2)),
                layoutMs: Number((sum((item) => item.layoutMs) / n).toFixed(2)),
                renderMs: Number((sum((item) => item.renderMs) / n).toFixed(2)),
                totalMs: Number((sum((item) => item.totalMs) / n).toFixed(2))
            } satisfies FixtureMetric;
        })
        .sort((left, right) => {
            if (left.mode !== right.mode) return left.mode.localeCompare(right.mode);
            return right.totalMs - left.totalMs;
        });
}

function compareModes(averaged: FixtureMetric[]): FixtureComparison[] {
    const byFile = new Map<string, Partial<Record<BenchmarkMode, FixtureMetric>>>();
    for (const metric of averaged) {
        const bucket = byFile.get(metric.file) || {};
        bucket[metric.mode] = metric;
        byFile.set(metric.file, bucket);
    }

    const comparisons: FixtureComparison[] = [];
    for (const [file, bucket] of byFile.entries()) {
        const ast = bucket['ast'];
        const spatial = bucket['spatial-ir'];
        if (!ast || !spatial) continue;
        const deltaMs = Number((spatial.totalMs - ast.totalMs).toFixed(2));
        const deltaPct = ast.totalMs === 0 ? 0 : Number((((spatial.totalMs - ast.totalMs) / ast.totalMs) * 100).toFixed(2));
        const layoutDeltaMs = Number((spatial.layoutMs - ast.layoutMs).toFixed(2));
        const layoutDeltaPct = ast.layoutMs === 0 ? 0 : Number((((spatial.layoutMs - ast.layoutMs) / ast.layoutMs) * 100).toFixed(2));
        comparisons.push({
            file,
            pages: ast.pages,
            astTotalMs: ast.totalMs,
            spatialIrTotalMs: spatial.totalMs,
            deltaMs,
            deltaPct,
            astLayoutMs: ast.layoutMs,
            spatialIrLayoutMs: spatial.layoutMs,
            layoutDeltaMs,
            layoutDeltaPct,
            astRenderMs: ast.renderMs,
            spatialIrRenderMs: spatial.renderMs
        });
    }

    return comparisons.sort((left, right) => right.deltaMs - left.deltaMs);
}

function renderFixtureResult(
    mode: BenchmarkMode,
    document: any,
    spatialDocument: any,
    engineInstance: any
): any[] {
    if (mode === 'spatial-ir') {
        return engineInstance.simulateSpatialDocument(spatialDocument);
    }
    return engineInstance.simulate(document.elements);
}

async function measureFixture(
    mode: BenchmarkMode,
    runtime: any,
    file: string,
    fixturePath: string
): Promise<FixtureMetric> {
    const rawDocument = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
    const document = resolveDocumentPaths(rawDocument, fixturePath);
    const spatialDocument = transformAstSource(rawDocument, fixturePath).spatialDocument;
    const config = toLayoutConfig(document, false);
    const engineInstance = new LayoutEngine(config, runtime);

    const t0 = performance.now();
    await engineInstance.waitForFonts();
    const t1 = performance.now();
    const pages = renderFixtureResult(mode, document, spatialDocument, engineInstance);
    const t2 = performance.now();

    const pageSize = LayoutUtils.getPageDimensions(config);
    const context = new MockContext(pageSize.width, pageSize.height);
    const renderer = new Renderer(config, false, runtime);
    await renderer.render(pages, context);
    const t3 = performance.now();

    return {
        file,
        mode,
        pages: pages.length,
        boxes: pages.reduce((acc: number, page: { boxes: unknown[] }) => acc + page.boxes.length, 0),
        textCalls: context.textCalls,
        imageCalls: context.imageCalls,
        fontMs: Number((t1 - t0).toFixed(2)),
        layoutMs: Number((t2 - t1).toFixed(2)),
        renderMs: Number((t3 - t2).toFixed(2)),
        totalMs: Number((t3 - t0).toFixed(2))
    };
}

async function run(): Promise<void> {
    const repeatArg = process.argv.find((arg) => arg.startsWith('--repeat='));
    const warmupArg = process.argv.find((arg) => arg.startsWith('--warmup='));
    const fixtureArg = process.argv.find((arg) => arg.startsWith('--fixture='));
    const modeArg = process.argv.find((arg) => arg.startsWith('--mode='));
    const presetArg = process.argv.find((arg) => arg.startsWith('--preset='));
    const repeatCount = Math.max(1, Number.parseInt((repeatArg?.split('=')[1] || '3'), 10) || 3);
    const warmupCount = Math.max(0, Number.parseInt((warmupArg?.split('=')[1] || '1'), 10) || 0);
    const fixtureFilter = (fixtureArg?.split('=')[1] || '').trim();
    const preset = (presetArg?.split('=')[1] || '').trim();
    const selectedModes = (modeArg?.split('=')[1] || 'ast,spatial-ir')
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry): entry is BenchmarkMode => entry === 'ast' || entry === 'spatial-ir');
    const modes = selectedModes.length > 0 ? Array.from(new Set(selectedModes)) : ['ast', 'spatial-ir'];

    const files = listAstFixtureNames()
        .sort((a, b) => a.localeCompare(b))
        .filter((file) => preset === 'watchlist' ? PERF_WATCHLIST.includes(file as typeof PERF_WATCHLIST[number]) : true)
        .filter((file) => !fixtureFilter || file.includes(fixtureFilter));

    if (files.length === 0) {
        throw new Error(
            fixtureFilter
                ? `No regression fixtures matched --fixture=${fixtureFilter}`
                : 'No regression fixtures found for performance benchmark'
        );
    }

    const LocalFontManager = await loadLocalFontManager();
    const rawMetrics: FixtureMetric[] = [];

    for (let runIndex = 0; runIndex < warmupCount + repeatCount; runIndex += 1) {
        const shouldRecord = runIndex >= warmupCount;
        for (const file of files) {
            const fixturePath = getAstFixturePath(file);
            for (const mode of modes) {
                const runtime = createEngineRuntime({ fontManager: new LocalFontManager() });
                const metric = await measureFixture(mode, runtime, file, fixturePath);
                if (!shouldRecord) continue;
                rawMetrics.push(metric);
            }
        }
    }

    const averaged = average(rawMetrics);
    const astRows = averaged.filter((metric) => metric.mode === 'ast').sort((left, right) => right.totalMs - left.totalMs);
    const spatialRows = averaged.filter((metric) => metric.mode === 'spatial-ir').sort((left, right) => right.totalMs - left.totalMs);
    const comparisons = compareModes(averaged);
    const avgDeltaMs = comparisons.length === 0
        ? 0
        : Number((comparisons.reduce((acc, item) => acc + item.deltaMs, 0) / comparisons.length).toFixed(2));
    const avgDeltaPct = comparisons.length === 0
        ? 0
        : Number((comparisons.reduce((acc, item) => acc + item.deltaPct, 0) / comparisons.length).toFixed(2));

    const summary: Summary = {
        warmupCount,
        repeatCount,
        fixtureCount: files.length,
        modes: {
            ast: {
                totalLayoutMs: Number(astRows.reduce((acc, item) => acc + item.layoutMs, 0).toFixed(2)),
                totalRenderMs: Number(astRows.reduce((acc, item) => acc + item.renderMs, 0).toFixed(2)),
                totalMs: Number(astRows.reduce((acc, item) => acc + item.totalMs, 0).toFixed(2))
            },
            'spatial-ir': {
                totalLayoutMs: Number(spatialRows.reduce((acc, item) => acc + item.layoutMs, 0).toFixed(2)),
                totalRenderMs: Number(spatialRows.reduce((acc, item) => acc + item.renderMs, 0).toFixed(2)),
                totalMs: Number(spatialRows.reduce((acc, item) => acc + item.totalMs, 0).toFixed(2))
            }
        },
        topByTotalMs: {
            ast: astRows.slice(0, 5),
            'spatial-ir': spatialRows.slice(0, 5)
        },
        comparisons: {
            averageDeltaMs: avgDeltaMs,
            averageDeltaPct: avgDeltaPct,
            fastestSpatialIrGainMs: Number(Math.min(0, ...comparisons.map((item) => item.deltaMs)).toFixed(2)),
            worstSpatialIrRegressionMs: Number(Math.max(0, ...comparisons.map((item) => item.deltaMs)).toFixed(2)),
            topByDeltaMs: comparisons.slice(0, 8)
        }
    };

    console.log('=== VMPrint Engine Performance Benchmark ===');
    console.log(
        `warmupCount=${warmupCount}, repeatCount=${repeatCount}, fixtures=${files.length}, modes=${modes.join(',')}` +
        (fixtureFilter ? `, filter=${fixtureFilter}` : '') +
        (preset ? `, preset=${preset}` : '')
    );
    if (astRows.length > 0) {
        console.log('--- AST Path ---');
        console.table(astRows);
    }
    if (spatialRows.length > 0) {
        console.log('--- Spatial IR Path ---');
        console.table(spatialRows);
    }
    if (comparisons.length > 0) {
        console.log('--- AST vs Spatial IR Delta ---');
        console.table(comparisons);
    }
    console.log('--- Summary ---');
    console.log(JSON.stringify(summary, null, 2));
}

run().catch((error) => {
    console.error('[performance-benchmark] FAILED', error);
    process.exit(1);
});
