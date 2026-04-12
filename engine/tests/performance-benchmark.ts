import fs from 'node:fs';
import { performance } from 'node:perf_hooks';
import * as engineModule from '../src/index.ts';
import * as harnessModule from './harness/engine-harness.ts';
import { parseDocumentSourceText, resolveDocumentPaths, toLayoutConfig } from '../src';
import { getAstFixturePath, listAstFixtureNames } from './harness/ast-fixture-harness';
import { transformAstSource } from './harness/ast-transform';

type BenchmarkMode = 'ast' | 'spatial-ir';
type RuntimeMode = 'cold' | 'warm';
type ProfileMode = 'off' | 'hot';
type HotProfileMetricKey =
    | 'flowMaterializeMs'
    | 'flowResolveLinesMs'
    | 'flowBuildTokensMs'
    | 'flowWrapStreamMs'
    | 'actorMeasurementMs'
    | 'actorPreparedDispatchMs'
    | 'keepWithNextPlanMs';

type HotProfileSummary = Record<HotProfileMetricKey, number> & {
    flowResolveSignatureCalls: number;
    flowResolveSignatureRepeatedCalls: number;
    flowResolveSignatureRepeatPct: number;
    topActorMeasurementKinds: Array<{ kind: string; calls: number; ms: number }>;
    topKeepWithNextPrepareKinds: Array<{ kind: string; calls: number; ms: number }>;
};

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
    hotProfile?: HotProfileSummary;
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
    runtimeMode: RuntimeMode;
    profileMode: ProfileMode;
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
    hotProfiles?: Record<BenchmarkMode, Array<FixtureMetric & { hotProfile: HotProfileSummary }>>;
};

const PERF_WATCHLIST = [
    '00-all-capabilities.json',
    '03-typography-type-specimen.json',
    '07-pagination-fragments.json',
    '08-dropcap-pagination.json',
    '09-tables-spans-pagination.json',
    '10-packager-split-scenarios.json',
    '14-flow-images-multipage.json',
    '15-story-multi-column.json',
    '20-block-floats-and-column-span.json',
    '22-story-nested-table-continuation.json'
] as const;

const HOT_PROFILE_KEYS: HotProfileMetricKey[] = [
    'flowMaterializeMs',
    'flowResolveLinesMs',
    'flowBuildTokensMs',
    'flowWrapStreamMs',
    'actorMeasurementMs',
    'actorPreparedDispatchMs',
    'keepWithNextPlanMs'
];

const engine = (engineModule as any).default ?? (engineModule as any)['module.exports'] ?? engineModule;
const harness = (harnessModule as any).default ?? (harnessModule as any)['module.exports'] ?? harnessModule;
const {
    LayoutEngine,
    Renderer,
    createPrintEngineRuntime,
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
                totalMs: Number((sum((item) => item.totalMs) / n).toFixed(2)),
                hotProfile: sample.hotProfile
                    ? summarizeHotProfile(
                        Object.fromEntries(
                            HOT_PROFILE_KEYS.map((key) => [
                                key,
                                Number((sum((item) => item.hotProfile?.[key] ?? 0) / n).toFixed(2))
                            ])
                        ) as Record<HotProfileMetricKey, number>,
                        Number((sum((item) => item.hotProfile?.flowResolveSignatureCalls ?? 0) / n).toFixed(2)),
                        Number((sum((item) => item.hotProfile?.flowResolveSignatureRepeatedCalls ?? 0) / n).toFixed(2)),
                        Object.fromEntries(
                            (sample.hotProfile.topActorMeasurementKinds || []).map((entry) => [
                                entry.kind,
                                { calls: entry.calls, ms: entry.ms }
                            ])
                        ),
                        Object.fromEntries(
                            (sample.hotProfile.topKeepWithNextPrepareKinds || []).map((entry) => [
                                entry.kind,
                                { calls: entry.calls, ms: entry.ms }
                            ])
                        )
                    )
                    : undefined
            } satisfies FixtureMetric;
        })
        .sort((left, right) => {
            if (left.mode !== right.mode) return left.mode.localeCompare(right.mode);
            return right.totalMs - left.totalMs;
        });
}

function summarizeHotProfile(
    values: Record<HotProfileMetricKey, number>,
    flowResolveSignatureCalls: number,
    flowResolveSignatureRepeatedCalls: number,
    actorMeasurementByKind?: Record<string, { calls: number; ms: number }>,
    keepWithNextPrepareByKind?: Record<string, { calls: number; ms: number }>
): HotProfileSummary {
    const totalCalls = Number(flowResolveSignatureCalls.toFixed(2));
    const repeatedCalls = Number(flowResolveSignatureRepeatedCalls.toFixed(2));
    const repeatPct = totalCalls <= 0
        ? 0
        : Number(((repeatedCalls / totalCalls) * 100).toFixed(2));
    return {
        ...values,
        flowResolveSignatureCalls: totalCalls,
        flowResolveSignatureRepeatedCalls: repeatedCalls,
        flowResolveSignatureRepeatPct: repeatPct,
        topActorMeasurementKinds: summarizeTopKinds(actorMeasurementByKind),
        topKeepWithNextPrepareKinds: summarizeTopKinds(keepWithNextPrepareByKind)
    };
}

function summarizeTopKinds(
    source?: Record<string, { calls: number; ms: number }>
): Array<{ kind: string; calls: number; ms: number }> {
    if (!source) return [];
    return Object.entries(source)
        .map(([kind, entry]) => ({
            kind,
            calls: Number(Number(entry?.calls || 0).toFixed(2)),
            ms: Number(Number(entry?.ms || 0).toFixed(2))
        }))
        .sort((left, right) => right.ms - left.ms)
        .slice(0, 3);
}

function toDisplayMetric(metric: FixtureMetric): Omit<FixtureMetric, 'hotProfile'> {
    const { hotProfile: _hotProfile, ...display } = metric;
    return display;
}

function getHotProfile(profile: Record<string, any> | undefined, profileMode: ProfileMode): HotProfileSummary | undefined {
    if (profileMode !== 'hot' || !profile) return undefined;
    return summarizeHotProfile(
        Object.fromEntries(
            HOT_PROFILE_KEYS.map((key) => [key, Number(Number(profile[key] || 0).toFixed(2))])
        ) as Record<HotProfileMetricKey, number>,
        Number(Number(profile.flowResolveSignatureCalls || 0).toFixed(2)),
        Number(Number(profile.flowResolveSignatureRepeatedCalls || 0).toFixed(2)),
        profile.actorMeasurementByKind,
        profile.keepWithNextPrepareByKind
    );
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
    fixturePath: string,
    profileMode: ProfileMode
): Promise<FixtureMetric> {
    const rawDocument = parseDocumentSourceText(fs.readFileSync(fixturePath, 'utf8'), fixturePath);
    const document = resolveDocumentPaths(rawDocument, fixturePath);
    const spatialDocument = transformAstSource(rawDocument, fixturePath).spatialDocument;
    const config = toLayoutConfig(document, false);
    const engineInstance = new LayoutEngine(config, runtime);

    const t0 = performance.now();
    await engineInstance.waitForFonts();
    const t1 = performance.now();
    const pages = renderFixtureResult(mode, document, spatialDocument, engineInstance);
    const t2 = performance.now();
    const profile = engineInstance.getLastSimulationReportReader().profile;

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
        totalMs: Number((t3 - t0).toFixed(2)),
        hotProfile: getHotProfile(profile, profileMode)
    };
}

async function run(): Promise<void> {
    const repeatArg = process.argv.find((arg) => arg.startsWith('--repeat='));
    const warmupArg = process.argv.find((arg) => arg.startsWith('--warmup='));
    const fixtureArg = process.argv.find((arg) => arg.startsWith('--fixture='));
    const modeArg = process.argv.find((arg) => arg.startsWith('--mode='));
    const presetArg = process.argv.find((arg) => arg.startsWith('--preset='));
    const runtimeArg = process.argv.find((arg) => arg.startsWith('--runtime='));
    const profileArg = process.argv.find((arg) => arg.startsWith('--profile='));
    const repeatCount = Math.max(1, Number.parseInt((repeatArg?.split('=')[1] || '3'), 10) || 3);
    const warmupCount = Math.max(0, Number.parseInt((warmupArg?.split('=')[1] || '1'), 10) || 0);
    const fixtureFilter = (fixtureArg?.split('=')[1] || '').trim();
    const preset = (presetArg?.split('=')[1] || '').trim();
    const runtimeMode = ((runtimeArg?.split('=')[1] || 'cold').trim().toLowerCase() || 'cold');
    const profileMode = ((profileArg?.split('=')[1] || 'off').trim().toLowerCase() || 'off');
    const selectedModes = (modeArg?.split('=')[1] || 'ast,spatial-ir')
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry): entry is BenchmarkMode => entry === 'ast' || entry === 'spatial-ir');
    const modes = selectedModes.length > 0 ? Array.from(new Set(selectedModes)) : ['ast', 'spatial-ir'];
    if (runtimeMode !== 'cold' && runtimeMode !== 'warm') {
        throw new Error(`Invalid --runtime=${runtimeMode}. Expected "cold" or "warm".`);
    }
    if (profileMode !== 'off' && profileMode !== 'hot') {
        throw new Error(`Invalid --profile=${profileMode}. Expected "off" or "hot".`);
    }

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
        const sharedRuntime = runtimeMode === 'warm'
            ? createPrintEngineRuntime({ fontManager: new LocalFontManager() })
            : null;
        for (const file of files) {
            const fixturePath = getAstFixturePath(file);
            for (const mode of modes) {
                const runtime = sharedRuntime ?? createPrintEngineRuntime({ fontManager: new LocalFontManager() });
                const metric = await measureFixture(mode, runtime, file, fixturePath, profileMode);
                if (!shouldRecord) continue;
                rawMetrics.push(metric);
            }
        }
    }

    const averaged = average(rawMetrics);
    const astRows = averaged.filter((metric) => metric.mode === 'ast').sort((left, right) => right.totalMs - left.totalMs);
    const spatialRows = averaged.filter((metric) => metric.mode === 'spatial-ir').sort((left, right) => right.totalMs - left.totalMs);
    const comparisons = compareModes(averaged);
    const hotProfileRows = profileMode === 'hot'
        ? {
            ast: averaged
                .filter((metric): metric is FixtureMetric & { hotProfile: HotProfileSummary } => metric.mode === 'ast' && !!metric.hotProfile)
                .sort((left, right) => (right.hotProfile.flowResolveLinesMs + right.hotProfile.actorMeasurementMs) - (left.hotProfile.flowResolveLinesMs + left.hotProfile.actorMeasurementMs))
                .slice(0, 5),
            'spatial-ir': averaged
                .filter((metric): metric is FixtureMetric & { hotProfile: HotProfileSummary } => metric.mode === 'spatial-ir' && !!metric.hotProfile)
                .sort((left, right) => (right.hotProfile.flowResolveLinesMs + right.hotProfile.actorMeasurementMs) - (left.hotProfile.flowResolveLinesMs + left.hotProfile.actorMeasurementMs))
                .slice(0, 5)
        }
        : undefined;
    const avgDeltaMs = comparisons.length === 0
        ? 0
        : Number((comparisons.reduce((acc, item) => acc + item.deltaMs, 0) / comparisons.length).toFixed(2));
    const avgDeltaPct = comparisons.length === 0
        ? 0
        : Number((comparisons.reduce((acc, item) => acc + item.deltaPct, 0) / comparisons.length).toFixed(2));

    const summary: Summary = {
        runtimeMode,
        profileMode,
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
        },
        hotProfiles: hotProfileRows
    };

    console.log('=== VMPrint Engine Performance Benchmark ===');
    console.log(
        `runtimeMode=${runtimeMode}, profileMode=${profileMode}, warmupCount=${warmupCount}, repeatCount=${repeatCount}, fixtures=${files.length}, modes=${modes.join(',')}` +
        (fixtureFilter ? `, filter=${fixtureFilter}` : '') +
        (preset ? `, preset=${preset}` : '')
    );
    if (astRows.length > 0) {
        console.log('--- AST Path ---');
        console.table(astRows.map((metric) => toDisplayMetric(metric)));
    }
    if (spatialRows.length > 0) {
        console.log('--- Spatial IR Path ---');
        console.table(spatialRows.map((metric) => toDisplayMetric(metric)));
    }
    if (comparisons.length > 0) {
        console.log('--- AST vs Spatial IR Delta ---');
        console.table(comparisons);
    }
    if (hotProfileRows?.ast?.length) {
        console.log('--- AST Hot Profile Counters ---');
        console.table(hotProfileRows.ast.map((metric) => ({
            file: metric.file,
            layoutMs: metric.layoutMs,
            flowMaterializeMs: metric.hotProfile.flowMaterializeMs,
            flowResolveLinesMs: metric.hotProfile.flowResolveLinesMs,
            flowBuildTokensMs: metric.hotProfile.flowBuildTokensMs,
            flowWrapStreamMs: metric.hotProfile.flowWrapStreamMs,
            actorMeasurementMs: metric.hotProfile.actorMeasurementMs,
            actorPreparedDispatchMs: metric.hotProfile.actorPreparedDispatchMs,
            keepWithNextPlanMs: metric.hotProfile.keepWithNextPlanMs,
            flowResolveSignatureCalls: metric.hotProfile.flowResolveSignatureCalls,
            flowResolveSignatureRepeatedCalls: metric.hotProfile.flowResolveSignatureRepeatedCalls,
            flowResolveSignatureRepeatPct: metric.hotProfile.flowResolveSignatureRepeatPct
        })));
        console.log('--- AST Hot Actor Kinds ---');
        console.table(hotProfileRows.ast.flatMap((metric) => metric.hotProfile.topActorMeasurementKinds.map((entry) => ({
            file: metric.file,
            kind: entry.kind,
            calls: entry.calls,
            actorMeasurementMs: entry.ms
        }))));
        console.log('--- AST Hot Keep-With-Next Prepare Kinds ---');
        console.table(hotProfileRows.ast.flatMap((metric) => metric.hotProfile.topKeepWithNextPrepareKinds.map((entry) => ({
            file: metric.file,
            kind: entry.kind,
            calls: entry.calls,
            keepWithNextPrepareMs: entry.ms
        }))));
    }
    if (hotProfileRows?.['spatial-ir']?.length) {
        console.log('--- Spatial IR Hot Profile Counters ---');
        console.table(hotProfileRows['spatial-ir'].map((metric) => ({
            file: metric.file,
            layoutMs: metric.layoutMs,
            flowMaterializeMs: metric.hotProfile.flowMaterializeMs,
            flowResolveLinesMs: metric.hotProfile.flowResolveLinesMs,
            flowBuildTokensMs: metric.hotProfile.flowBuildTokensMs,
            flowWrapStreamMs: metric.hotProfile.flowWrapStreamMs,
            actorMeasurementMs: metric.hotProfile.actorMeasurementMs,
            actorPreparedDispatchMs: metric.hotProfile.actorPreparedDispatchMs,
            keepWithNextPlanMs: metric.hotProfile.keepWithNextPlanMs,
            flowResolveSignatureCalls: metric.hotProfile.flowResolveSignatureCalls,
            flowResolveSignatureRepeatedCalls: metric.hotProfile.flowResolveSignatureRepeatedCalls,
            flowResolveSignatureRepeatPct: metric.hotProfile.flowResolveSignatureRepeatPct
        })));
        console.log('--- Spatial IR Hot Actor Kinds ---');
        console.table(hotProfileRows['spatial-ir'].flatMap((metric) => metric.hotProfile.topActorMeasurementKinds.map((entry) => ({
            file: metric.file,
            kind: entry.kind,
            calls: entry.calls,
            actorMeasurementMs: entry.ms
        }))));
        console.log('--- Spatial IR Hot Keep-With-Next Prepare Kinds ---');
        console.table(hotProfileRows['spatial-ir'].flatMap((metric) => metric.hotProfile.topKeepWithNextPrepareKinds.map((entry) => ({
            file: metric.file,
            kind: entry.kind,
            calls: entry.calls,
            keepWithNextPrepareMs: entry.ms
        }))));
    }
    console.log('--- Summary ---');
    console.log(JSON.stringify(summary, null, 2));
}

run().catch((error) => {
    console.error('[performance-benchmark] FAILED', error);
    process.exit(1);
});
