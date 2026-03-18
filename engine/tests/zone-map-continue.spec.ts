import assert from 'node:assert/strict';
import {
    CURRENT_DOCUMENT_VERSION,
    LayoutEngine,
    resolveDocumentPaths,
    toLayoutConfig,
    type DocumentInput
} from '../src';
import { createEngineRuntime } from '../src/engine/runtime';
import { buildPackagerForElement } from '../src/engine/layout/packagers/create-packagers';
import { loadLocalFontManager } from './harness/engine-harness';

function logStep(message: string): void {
    console.log(`[zone-map-continue.spec] ${message}`);
}

function check(description: string, expected: string, assertion: () => void): void {
    logStep(`CHECK: ${description}`);
    logStep(`EXPECT: ${expected}`);
    assertion();
    logStep(`PASS: ${description}`);
}

function buildZoneContinuationDoc(
    frameOverflow: 'move-whole' | 'continue',
    worldBehavior?: 'fixed' | 'spanning' | 'expandable'
): DocumentInput {
    return {
        documentVersion: CURRENT_DOCUMENT_VERSION,
        layout: {
            pageSize: { width: 360, height: 360 },
            margins: { top: 24, right: 24, bottom: 24, left: 24 },
            fontFamily: 'Arimo',
            fontSize: 12,
            lineHeight: 1.25
        },
        fonts: { regular: 'Arimo' },
        styles: {
            p: { marginBottom: 10, allowLineSplit: true, orphans: 2, widows: 2 },
            h1: { fontSize: 36, lineHeight: 1.05, marginBottom: 14 },
            sidebarLabel: { fontSize: 10, marginBottom: 8, letterSpacing: 2 },
            sidebarNote: { fontSize: 11, lineHeight: 1.3, marginBottom: 10 }
        },
        elements: [
            {
                type: 'h1',
                content: 'Zone Continuation Probe',
                properties: {
                    sourceId: 'hero-title'
                }
            },
            {
                type: 'p',
                content: 'Top matter takes enough space that the regional body cannot fit as one move-whole block on the first page.',
                properties: {
                    sourceId: 'hero-deck'
                }
            },
            {
                type: 'zone-map',
                content: '',
                properties: {
                    sourceId: 'zone-body'
                },
                zoneLayout: {
                    columns: [
                        { mode: 'flex', fr: 2 },
                        { mode: 'flex', fr: 1 }
                    ],
                    gap: 14,
                    frameOverflow,
                    ...(worldBehavior ? { worldBehavior } : {})
                },
                zones: [
                    {
                        id: 'main',
                        elements: [
                            {
                                type: 'p',
                                content: 'Main zone opening paragraph. This should appear on the first page only when zone continuation is enabled. '.repeat(3),
                                properties: {
                                    sourceId: 'main-zone-open'
                                }
                            },
                            {
                                type: 'p',
                                content: 'Main zone middle paragraph. It keeps the regional simulation going across the next frame. '.repeat(5),
                                properties: {
                                    sourceId: 'main-zone-middle'
                                }
                            },
                            {
                                type: 'p',
                                content: 'Main zone tail paragraph. This should survive into the continuation frame if the first one fills up. '.repeat(4),
                                properties: {
                                    sourceId: 'main-zone-tail'
                                }
                            }
                        ]
                    },
                    {
                        id: 'side',
                        elements: [
                            {
                                type: 'sidebarLabel',
                                content: 'Sidebar Zone',
                                properties: {
                                    sourceId: 'side-zone-label'
                                }
                            },
                            {
                                type: 'sidebarNote',
                                content: 'A persistent side rail should be able to keep filling its own regional frame independently. '.repeat(5),
                                properties: {
                                    sourceId: 'side-zone-note'
                                }
                            }
                        ]
                    }
                ]
            },
            {
                type: 'p',
                content: 'Normal document flow resumes after the zone-map body.',
                properties: {
                    sourceId: 'post-zone-flow'
                }
            }
        ]
    };
}

function findPagesForSource(pages: any[], sourceId: string): number[] {
    const indices = new Set<number>();
    pages.forEach((page, pageIndex) => {
        (page.boxes || []).forEach((box: any) => {
            const actual = String(box.meta?.sourceId || '');
            if (actual === sourceId || actual.endsWith(`:${sourceId}`)) {
                indices.add(pageIndex);
            }
        });
    });
    return Array.from(indices.values()).sort((a, b) => a - b);
}

async function main() {
    const LocalFontManager = await loadLocalFontManager();
    const runtime = createEngineRuntime({
        fontManager: new LocalFontManager()
    });

    const moveWholeResolved = resolveDocumentPaths(buildZoneContinuationDoc('move-whole'), 'zone-move-whole.json');
    const fixedContinueResolved = resolveDocumentPaths(buildZoneContinuationDoc('continue', 'fixed'), 'zone-continue-fixed.json');
    const continueResolved = resolveDocumentPaths(buildZoneContinuationDoc('continue', 'expandable'), 'zone-continue.json');

    const moveWholeEngine = new LayoutEngine(toLayoutConfig(moveWholeResolved, false), runtime);
    const fixedContinueEngine = new LayoutEngine(toLayoutConfig(fixedContinueResolved, false), runtime);
    const continueEngine = new LayoutEngine(toLayoutConfig(continueResolved, false), runtime);
    await moveWholeEngine.waitForFonts();
    await fixedContinueEngine.waitForFonts();
    await continueEngine.waitForFonts();

    const moveWholePages = moveWholeEngine.simulate(moveWholeResolved.elements);
    const fixedContinuePages = fixedContinueEngine.simulate(fixedContinueResolved.elements);
    const continuePages = continueEngine.simulate(continueResolved.elements);

    check(
        'zone packagers carry authored frame and world modes',
        'move-whole defaults to fixed, while explicit continue/expandable survives onto the runtime packager surface',
        () => {
            const moveWholePackager = buildPackagerForElement(moveWholeResolved.elements[2], 2, moveWholeEngine) as any;
            const fixedContinuePackager = buildPackagerForElement(fixedContinueResolved.elements[2], 2, fixedContinueEngine) as any;
            const continuePackager = buildPackagerForElement(continueResolved.elements[2], 2, continueEngine) as any;

            assert.equal(moveWholePackager.frameOverflowMode, 'move-whole');
            assert.equal(moveWholePackager.worldBehaviorMode, 'fixed');
            assert.equal(fixedContinuePackager.frameOverflowMode, 'continue');
            assert.equal(fixedContinuePackager.worldBehaviorMode, 'fixed');
            assert.equal(continuePackager.frameOverflowMode, 'continue');
            assert.equal(continuePackager.worldBehaviorMode, 'expandable');
        }
    );

    check(
        'move-whole zone-map defers the regional body to the next page',
        'zone content begins only on page 2 when frameOverflow is move-whole',
        () => {
            assert.deepEqual(findPagesForSource(moveWholePages, 'main-zone-open'), [1]);
            assert.deepEqual(findPagesForSource(moveWholePages, 'side-zone-label'), [1]);
        }
    );

    check(
        'fixed world behavior stays conservative even when frameOverflow is continue',
        'non-expandable fields do not gain mid-page continuation semantics yet',
        () => {
            assert.deepEqual(findPagesForSource(fixedContinuePages, 'main-zone-open'), [1]);
            assert.deepEqual(findPagesForSource(fixedContinuePages, 'side-zone-label'), [1]);
        }
    );

    check(
        'continue zone-map fills the current page frame before overflowing',
        'zone content starts on page 1 and continues onto page 2 when frameOverflow is continue and worldBehavior is expandable',
        () => {
            const mainOpenPages = findPagesForSource(continuePages, 'main-zone-open');
            const sidePages = findPagesForSource(continuePages, 'side-zone-label');
            assert.ok(mainOpenPages.includes(0), 'main zone should start on page 1');
            assert.ok(sidePages.includes(0), 'sidebar zone should start on page 1');
            assert.ok(findPagesForSource(continuePages, 'main-zone-tail').some((pageIndex) => pageIndex >= 1), 'tail content should continue beyond page 1');
        }
    );

    check(
        'continue mode preserves downstream document flow',
        'post-zone ordinary flow still appears after the regional continuation finishes',
        () => {
            const postFlowPages = findPagesForSource(continuePages, 'post-zone-flow');
            assert.ok(postFlowPages.length > 0, 'post-zone flow should still render');
            assert.ok(postFlowPages[0] >= 1, 'post-zone flow should come after the zone continuation pages');
        }
    );

    check(
        'expandable continued zones keep nested story column-span content below prior column occupancy',
        'a full-width columnSpan element inside a continued regional story should either start below the tallest occupied column on the same page or defer together with its post-span content',
        () => {
            const doc: DocumentInput = {
                documentVersion: CURRENT_DOCUMENT_VERSION,
                layout: {
                    pageSize: { width: 420, height: 420 },
                    margins: { top: 24, right: 24, bottom: 24, left: 24 },
                    fontFamily: 'Arimo',
                    fontSize: 12,
                    lineHeight: 1.3
                },
                fonts: { regular: 'Arimo' },
                styles: {
                    body: { marginBottom: 10, allowLineSplit: true, orphans: 2, widows: 2, textAlign: 'justify' },
                    marker: { fontSize: 11, marginBottom: 6, letterSpacing: 2, keepWithNext: true }
                },
                elements: [
                    { type: 'body', content: 'Hero matter '.repeat(60), properties: { sourceId: 'hero' } },
                    {
                        type: 'zone-map',
                        zoneLayout: {
                            columns: [{ mode: 'flex', fr: 1 }],
                            gap: 0,
                            frameOverflow: 'continue',
                            worldBehavior: 'expandable'
                        },
                        zones: [
                            {
                                id: 'main',
                                elements: [
                                    {
                                        type: 'story',
                                        columns: 2,
                                        gutter: 12,
                                        children: [
                                            { type: 'body', content: 'Column one opening copy '.repeat(90), properties: { sourceId: 'story-body-a' } },
                                            { type: 'body', content: 'Column two continuing copy '.repeat(75), properties: { sourceId: 'story-body-b' } },
                                            { type: 'marker', content: 'FULL WIDTH RESET', columnSpan: 'all', properties: { sourceId: 'story-span' } },
                                            { type: 'body', content: 'Post-span copy '.repeat(50), properties: { sourceId: 'story-body-c' } }
                                        ]
                                    }
                                ]
                            }
                        ]
                    }
                ]
            };

            const resolved = resolveDocumentPaths(doc, 'zone-continue-story-span.json');
            const engine = new LayoutEngine(toLayoutConfig(resolved, false), runtime);
            const pages = engine.simulate(resolved.elements);
            const pageOne = pages[0];
            const firstPageBoxes = pageOne.boxes || [];
            const preSpan = firstPageBoxes.filter((box: any) => {
                const actual = String(box.meta?.sourceId || '');
                return actual === 'story-body-a' || actual.endsWith(':story-body-a') ||
                    actual === 'story-body-b' || actual.endsWith(':story-body-b');
            });
            const spanBoxes = firstPageBoxes.filter((box: any) => {
                const actual = String(box.meta?.sourceId || '');
                return actual === 'story-span' || actual.endsWith(':story-span');
            });
            const postSpanPageOne = firstPageBoxes.filter((box: any) => {
                const actual = String(box.meta?.sourceId || '');
                return actual === 'story-body-c' || actual.endsWith(':story-body-c');
            });
            const spanPages = pages.flatMap((page: any, pageIndex: number) =>
                (page.boxes || []).some((box: any) => {
                    const actual = String(box.meta?.sourceId || '');
                    return actual === 'story-span' || actual.endsWith(':story-span');
                }) ? [pageIndex] : []
            );

            assert.ok(preSpan.length > 0, 'expected pre-span story content on page 1');
            assert.ok(spanPages.length > 0, 'expected the full-width span marker somewhere in the continued field');

            if (spanBoxes.length > 0) {
                const highestPreSpanBottom = Math.max(...preSpan.map((box: any) => Number(box.y || 0) + Number(box.h || 0)));
                const spanTop = Math.min(...spanBoxes.map((box: any) => Number(box.y || 0)));
                assert.ok(
                    spanTop >= highestPreSpanBottom - 0.1,
                    `expected span top (${spanTop}) to start below prior column occupancy (${highestPreSpanBottom})`
                );

                if (postSpanPageOne.length > 0) {
                    const spanBottom = Math.max(...spanBoxes.map((box: any) => Number(box.y || 0) + Number(box.h || 0)));
                    const postSpanTop = Math.min(...postSpanPageOne.map((box: any) => Number(box.y || 0)));
                    assert.ok(
                        postSpanTop >= spanBottom - 0.1,
                        `expected post-span content (${postSpanTop}) to start below the span frontier (${spanBottom})`
                    );
                }
            } else {
                assert.equal(postSpanPageOne.length, 0, 'post-span content should not appear on page 1 before the span is materialized');
                assert.ok(spanPages[0] >= 1, 'if the span does not fit page 1, it should be deferred to a later page');
            }
        }
    );
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
