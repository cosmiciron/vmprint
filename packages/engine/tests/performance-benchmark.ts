import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import * as engineModule from '../src/index.ts';
import * as harnessModule from './harness/engine-harness.ts';

type FixtureMetric = {
    file: string;
    pages: number;
    boxes: number;
    textCalls: number;
    imageCalls: number;
    fontMs: number;
    layoutMs: number;
    renderMs: number;
    totalMs: number;
};

type Summary = {
    repeatCount: number;
    fixtureCount: number;
    totalLayoutMs: number;
    totalRenderMs: number;
    totalMs: number;
    topByTotalMs: FixtureMetric[];
};

const engine = (engineModule as any).default ?? (engineModule as any)['module.exports'] ?? engineModule;
const harness = (harnessModule as any).default ?? (harnessModule as any)['module.exports'] ?? harnessModule;
const { LayoutEngine, Renderer, createEngineRuntime, toLayoutConfig, resolveDocumentPaths, LayoutUtils } =
    engine as any;
const { MockContext, loadLocalFontManager } = harness as any;

function average(metrics: FixtureMetric[]): FixtureMetric[] {
    const byFile = new Map<string, FixtureMetric[]>();
    for (const metric of metrics) {
        const bucket = byFile.get(metric.file) || [];
        bucket.push(metric);
        byFile.set(metric.file, bucket);
    }

    return Array.from(byFile.entries())
        .map(([file, bucket]) => {
            const n = bucket.length || 1;
            const sum = (selector: (item: FixtureMetric) => number) =>
                bucket.reduce((acc, item) => acc + selector(item), 0);
            const sample = bucket[0];
            return {
                file,
                pages: sample.pages,
                boxes: sample.boxes,
                textCalls: sample.textCalls,
                imageCalls: sample.imageCalls,
                fontMs: Number((sum((item) => item.fontMs) / n).toFixed(2)),
                layoutMs: Number((sum((item) => item.layoutMs) / n).toFixed(2)),
                renderMs: Number((sum((item) => item.renderMs) / n).toFixed(2)),
                totalMs: Number((sum((item) => item.totalMs) / n).toFixed(2)),
            };
        })
        .sort((left, right) => right.totalMs - left.totalMs);
}

async function run(): Promise<void> {
    const repeatArg = process.argv.find((arg) => arg.startsWith('--repeat='));
    const repeatCount = Math.max(1, Number.parseInt(repeatArg?.split('=')[1] || '3', 10) || 3);

    const fixturesDir = path.resolve(__dirname, 'fixtures', 'regression');
    const files = fs
        .readdirSync(fixturesDir)
        .filter((file) => file.endsWith('.json') && !file.endsWith('.snapshot.layout.json'))
        .sort((a, b) => a.localeCompare(b));

    const LocalFontManager = await loadLocalFontManager();
    const runtime = createEngineRuntime({ fontManager: new LocalFontManager() });

    const rawMetrics: FixtureMetric[] = [];

    for (let runIndex = 0; runIndex < repeatCount; runIndex += 1) {
        for (const file of files) {
            const fixturePath = path.join(fixturesDir, file);
            const document = resolveDocumentPaths(JSON.parse(fs.readFileSync(fixturePath, 'utf8')), fixturePath);
            const config = toLayoutConfig(document, false);
            const engineInstance = new LayoutEngine(config, runtime);

            const t0 = performance.now();
            await engineInstance.waitForFonts();
            const t1 = performance.now();
            const pages = engineInstance.paginate(document.elements);
            const t2 = performance.now();

            const pageSize = LayoutUtils.getPageDimensions(config);
            const context = new MockContext(pageSize.width, pageSize.height);
            const renderer = new Renderer(config, false, runtime);
            await renderer.render(pages, context);
            const t3 = performance.now();

            rawMetrics.push({
                file,
                pages: pages.length,
                boxes: pages.reduce((acc: number, page: { boxes: unknown[] }) => acc + page.boxes.length, 0),
                textCalls: context.textCalls,
                imageCalls: context.imageCalls,
                fontMs: Number((t1 - t0).toFixed(2)),
                layoutMs: Number((t2 - t1).toFixed(2)),
                renderMs: Number((t3 - t2).toFixed(2)),
                totalMs: Number((t3 - t0).toFixed(2)),
            });
        }
    }

    const averaged = average(rawMetrics);
    const summary: Summary = {
        repeatCount,
        fixtureCount: files.length,
        totalLayoutMs: Number(averaged.reduce((acc, item) => acc + item.layoutMs, 0).toFixed(2)),
        totalRenderMs: Number(averaged.reduce((acc, item) => acc + item.renderMs, 0).toFixed(2)),
        totalMs: Number(averaged.reduce((acc, item) => acc + item.totalMs, 0).toFixed(2)),
        topByTotalMs: averaged.slice(0, 5),
    };

    console.log('=== VMPrint Engine Performance Benchmark ===');
    console.log(`repeatCount=${repeatCount}, fixtures=${files.length}`);
    console.table(averaged);
    console.log('--- Summary ---');
    console.log(JSON.stringify(summary, null, 2));
}

run().catch((error) => {
    console.error('[performance-benchmark] FAILED', error);
    process.exit(1);
});
