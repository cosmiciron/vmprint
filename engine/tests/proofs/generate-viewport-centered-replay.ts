import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

import {
    LayoutEngine,
    loadDocument,
    setDefaultEngineRuntime,
    toLayoutConfig
} from '../../src';
import { createPrintEngineRuntime } from '../../src/font-management/runtime';
import { loadLocalFontManager } from '../harness/engine-harness';

const LONG_DOC_PATH = '/Users/cosmiciron/Projects/layoutmaster/demos/assets/html-atlas-big-326-pages.json';
const TARGET_NAME = 'viewportReplayTarget';

function cloneJson<T>(value: T): T {
    return JSON.parse(JSON.stringify(value));
}

function roundMs(value: number): number {
    return Number(Number(value || 0).toFixed(3));
}

function countBoxes(pages: any[]): number {
    return pages.reduce((total, page) => total + (Array.isArray(page?.boxes) ? page.boxes.length : 0), 0);
}

function pageHeights(pages: any[]): number[] {
    return pages.map((page) => Number(page?.height || 0)).filter((height) => Number.isFinite(height));
}

function textContent(element: any): string {
    let value = typeof element?.content === 'string' ? element.content : '';
    for (const child of element?.children || []) value += textContent(child);
    return value;
}

function loadAtlasDocument(): any {
    const document = JSON.parse(fs.readFileSync(LONG_DOC_PATH, 'utf8'));
    const targetIndex = document.elements.findIndex((element: any) =>
        textContent(element).length > 160
        && /paragraph|p/.test(String(element.type || ''))
    );
    if (targetIndex < 0) {
        throw new Error(`Unable to find a long paragraph target in ${LONG_DOC_PATH}`);
    }
    document.layout = {
        ...document.layout,
        publicationMode: 'continuous',
        printBreakPolicy: 'ignore',
        progression: {
            policy: 'fixed-tick-count',
            maxTicks: 4200,
            tickRateHz: 120
        }
    };
    document.elements[targetIndex] = {
        ...document.elements[targetIndex],
        name: TARGET_NAME
    };
    return document;
}

function summarizeResult(result: any): Record<string, unknown> {
    const pages = Array.isArray(result?.pages) ? result.pages : [];
    return {
        changed: result?.changed ?? null,
        kind: result?.kind ?? null,
        sourceId: result?.sourceId ?? null,
        actorId: result?.actorId ?? null,
        pageCount: pages.length,
        boxCount: countBoxes(pages),
        pageIndexes: Array.isArray(result?.pageIndexes) ? result.pageIndexes : [],
        addedPageIndexes: Array.isArray(result?.update?.addedPageIndexes) ? result.update.addedPageIndexes : [],
        removedPageIndexes: Array.isArray(result?.update?.removedPageIndexes) ? result.update.removedPageIndexes : [],
        replay: {
            completion: result?.replay?.completion ?? null,
            pending: result?.replay?.pending ?? null,
            replayId: result?.replay?.replayId ?? null,
            requested: result?.replay?.continueUntil?.requested ?? null,
            stopped: result?.replay?.continueUntil?.stopped ?? null,
            stopReason: result?.replay?.continueUntil?.reason ?? null
        },
        replayFrontier: result?.update?.replayFrontier ?? null,
        leakedReplaySession: result && Object.prototype.hasOwnProperty.call(result, 'replaySession')
    };
}

async function main(): Promise<void> {
    const LocalFontManager = await loadLocalFontManager();
    setDefaultEngineRuntime(createPrintEngineRuntime({ fontManager: new LocalFontManager() }));

    const document = loadAtlasDocument();
    const ir = loadDocument(document, 'viewport-centered-replay-proof');
    const config = toLayoutConfig(ir, false);
    const engine = new LayoutEngine(config);
    await engine.waitForFonts();

    const pageSize = config.layout?.pageSize || {};
    const pageHeight = Math.max(1, Number(pageSize.height || 792));
    const initialStopY = pageHeight * 48;
    const viewportRequest = {
        y: pageHeight * 18,
        height: pageHeight * 2,
        overscanY: pageHeight
    };
    const continuationViewportRequest = {
        y: pageHeight * 56,
        height: pageHeight * 2,
        overscanY: pageHeight
    };

    const initialStarted = performance.now();
    const initialPages = engine.simulate(ir.elements, { stopAtWorldY: initialStopY });
    const initialMs = roundMs(performance.now() - initialStarted);

    const events: any[] = [];
    const unlistenStart = engine.listen('layout.startReplayAroundViewport', (event: any) => events.push(event));
    const unlistenContinue = engine.listen('layout.continueReplay', (event: any) => events.push(event));
    const unlistenProgress = engine.listen('layout.replayProgress', (event: any) => events.push(event));

    const startStarted = performance.now();
    const startReplayResult = engine.send('layout.startReplayAroundViewport', {
        elements: ir.elements,
        viewport: viewportRequest,
        intent: {
            kind: 'formatting',
            target: { sourceId: TARGET_NAME },
            patch: {
                fontSize: 18,
                lineHeight: 1.45,
                marginBottom: 18,
                backgroundColor: '#FFE9A8',
                borderColor: '#D89B00'
            }
        }
    }) as any;
    const startReplayMs = roundMs(performance.now() - startStarted);

    const replayId = String(startReplayResult?.replay?.replayId || '').trim();
    const continueStarted = performance.now();
    const continuationResult = engine.send('layout.continueReplay', {
        replayId,
        viewport: continuationViewportRequest
    }) as any;
    const continuationMs = roundMs(performance.now() - continueStarted);

    unlistenStart();
    unlistenContinue();
    unlistenProgress();

    const startPages = Array.isArray(startReplayResult?.pages) ? startReplayResult.pages : [];
    const continuationPages = Array.isArray(continuationResult?.pages) ? continuationResult.pages : [];
    const fullIr = loadDocument(cloneJson(document), 'viewport-centered-replay-proof:full-baseline');
    const fullEngine = new LayoutEngine(toLayoutConfig(fullIr, false));
    await fullEngine.waitForFonts();
    const fullStarted = performance.now();
    const fullPages = fullEngine.simulate(fullIr.elements);
    const fullMs = roundMs(performance.now() - fullStarted);
    const fullBoxCount = countBoxes(fullPages);
    const fullHeight = Math.max(...pageHeights(fullPages));
    const eventSummaries = events.map((event) => ({
        name: event?.name ?? null,
        requestName: event?.requestName ?? null,
        replayId: event?.payload?.replay?.replayId ?? null,
        completion: event?.payload?.replay?.completion ?? null,
        pending: event?.payload?.replay?.pending ?? null,
        pageCount: Array.isArray(event?.payload?.pages) ? event.payload.pages.length : null,
        boxCount: Array.isArray(event?.payload?.pages) ? countBoxes(event.payload.pages) : null
    }));
    const startEvent = events.find((event) => event?.name === 'layout.startReplayAroundViewport');
    const continueEvent = events.find((event) => event?.name === 'layout.continueReplay');
    const startEventMatches = !!startEvent
        && startEvent.payload?.replay?.replayId === replayId
        && countBoxes(startEvent.payload?.pages || []) === countBoxes(startPages);
    const continueEventMatches = !!continueEvent
        && continueEvent.payload?.replay?.replayId === replayId
        && countBoxes(continueEvent.payload?.pages || []) === countBoxes(continuationPages);
    const startBounded = startReplayResult?.replay?.completion === 'partial'
        && startReplayResult?.replay?.pending === true
        && Math.max(...pageHeights(startPages)) <= viewportRequest.y + viewportRequest.height + viewportRequest.overscanY + pageHeight;
    const continuationAdvanced = continuationResult?.replay?.completion === 'partial'
        && continuationResult?.replay?.pending === true
        && Math.max(...pageHeights(continuationPages)) > Math.max(...pageHeights(startPages));
    const initialBounded = countBoxes(initialPages) < fullBoxCount
        && Math.max(...pageHeights(initialPages)) < fullHeight
        && Math.max(...pageHeights(initialPages)) >= initialStopY;
    const noReplaySessionLeak = !Object.prototype.hasOwnProperty.call(startReplayResult || {}, 'replaySession')
        && !Object.prototype.hasOwnProperty.call(continuationResult || {}, 'replaySession');
    const protocolEventsMatch = startEventMatches && continueEventMatches
        && events.filter((event) => event?.name === 'layout.replayProgress').length === 2;

    const status = initialBounded
        && startBounded
        && continuationAdvanced
        && noReplaySessionLeak
        && protocolEventsMatch
        ? 'pass'
        : startReplayResult
            ? 'gap'
            : 'fail';

    const summary = {
        generatedAt: new Date().toISOString(),
        status,
        document: {
            path: LONG_DOC_PATH,
            publicationMode: config.layout?.publicationMode ?? null,
            printBreakPolicy: config.layout?.printBreakPolicy ?? null,
            targetName: TARGET_NAME
        },
        requests: {
            initialStopY,
            viewportRequest,
            continuationViewportRequest
        },
        timing: {
            initialMs,
            startReplayMs,
            continuationMs,
            fullMs
        },
        initial: {
            pageCount: initialPages.length,
            boxCount: countBoxes(initialPages),
            heights: pageHeights(initialPages)
        },
        full: {
            pageCount: fullPages.length,
            boxCount: fullBoxCount,
            heights: pageHeights(fullPages)
        },
        assertions: {
            initialBounded,
            startBounded,
            continuationAdvanced,
            noReplaySessionLeak,
            protocolEventsMatch
        },
        startReplay: summarizeResult(startReplayResult),
        continuation: summarizeResult(continuationResult),
        events: eventSummaries
    };
    const out = path.resolve('tests/output/proofs/viewport-centered-replay-summary.json');
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, `${JSON.stringify(summary, null, 2)}\n`);
    console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
