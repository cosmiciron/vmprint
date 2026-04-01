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
import { StoryPackager } from '../src/engine/layout/packagers/story-packager';
import type { PackagerContext, PackagerSplitResult, PackagerUnit } from '../src/engine/layout/packagers/packager-types';
import { loadLocalFontManager } from './harness/engine-harness';

import { logStep, check } from './harness/test-utils';
const TEST_PREFIX = 'zone-map-continue.spec';
const log = (msg: string) => logStep(TEST_PREFIX, msg);
const _check = (desc: string, exp: string, fn: () => void) => check(TEST_PREFIX, desc, exp, fn);

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

function findBoxesForSource(pages: any[], sourceId: string): any[] {
    return pages.flatMap((page) =>
        (page.boxes || []).filter((box: any) => {
            const actual = String(box.meta?.sourceId || '');
            return actual === sourceId || actual.endsWith(`:${sourceId}`);
        })
    );
}

function registeredActorsIncludeSource(actors: readonly PackagerUnit[], sourceId: string): boolean {
    return actors.some((actor) => {
        const actual = String(actor.sourceId || '');
        return actual === sourceId || actual.endsWith(`:${sourceId}`);
    });
}

async function main() {
    const LocalFontManager = await loadLocalFontManager();
    const runtime = createEngineRuntime({
        fontManager: new LocalFontManager()
    });
    const onePixelPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO9Wl9kAAAAASUVORK5CYII=';

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

    _check(
        'zone children register as real runtime actors',
        'zone-hosted participants should appear in the session actor registry instead of staying invisible to the runtime',
        () => {
            const registered = continueEngine.getCurrentLayoutSession()?.getRegisteredActors() ?? [];

            assert.ok(registeredActorsIncludeSource(registered, 'zone-body'), 'expected zone host to stay registered');
            assert.ok(registeredActorsIncludeSource(registered, 'main-zone-open'), 'expected main zone child to be registered');
            assert.ok(registeredActorsIncludeSource(registered, 'main-zone-middle'), 'expected continued main-zone child to be registered');
            assert.ok(registeredActorsIncludeSource(registered, 'side-zone-label'), 'expected sidebar zone child to be registered');
        }
    );

    _check(
        'zone child boxes preserve child actor identity',
        'zone-hosted emitted boxes should carry the hosted child actorId so observer/update paths can see them',
        () => {
            const boxes = findBoxesForSource(continuePages, 'main-zone-open');
            assert.ok(boxes.length > 0, 'expected main-zone-open boxes');
            assert.ok(boxes.every((box) => typeof box.meta?.actorId === 'string' && box.meta.actorId.length > 0), 'expected hosted zone boxes to carry actorId metadata');
        }
    );

    _check(
        'worldPlain inherits runtime actor participation from the zone bridge',
        'worldPlain children should register as real runtime actors once the underlying zone host proxies them into the session',
        () => {
            const doc: DocumentInput = {
                documentVersion: CURRENT_DOCUMENT_VERSION,
                layout: {
                    pageSize: { width: 360, height: 360 },
                    margins: { top: 24, right: 24, bottom: 24, left: 24 },
                    fontFamily: 'Arimo',
                    fontSize: 12,
                    lineHeight: 1.25,
                    worldPlain: {
                        style: { backgroundColor: '#f8fbff' }
                    }
                },
                fonts: { regular: 'Arimo' },
                styles: {
                    label: { marginBottom: 10 }
                },
                elements: [
                    {
                        type: 'field-actor',
                        content: '',
                        properties: {
                            sourceId: 'plain-rock',
                            style: { width: 72, height: 72, backgroundColor: '#0f8b8d' },
                            spatialField: { kind: 'exclude', x: 120, y: 64 }
                        }
                    },
                    {
                        type: 'label',
                        content: 'World actors should now be visible to the session runtime.',
                        properties: {
                            sourceId: 'plain-label'
                        }
                    }
                ]
            };

            const resolved = resolveDocumentPaths(doc, 'world-plain-runtime-registration.json');
            const engine = new LayoutEngine(toLayoutConfig(resolved, false), runtime);
            const pages = engine.simulate(resolved.elements);
            const registered = engine.getCurrentLayoutSession()?.getRegisteredActors() ?? [];

            assert.ok(registeredActorsIncludeSource(registered, 'plain-rock'), 'expected worldPlain field actor to be registered');
            assert.ok(registeredActorsIncludeSource(registered, 'plain-label'), 'expected worldPlain ordinary child to be registered');
            assert.ok(findBoxesForSource(pages, 'plain-label').every((box) => typeof box.meta?.actorId === 'string' && box.meta.actorId.length > 0), 'expected worldPlain child boxes to carry actorId metadata');
        }
    );

    _check(
        'story children register as real runtime actors',
        'story-hosted participants should appear in the session actor registry instead of remaining private to story layout',
        () => {
            const doc: DocumentInput = {
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
                    body: { marginBottom: 10 }
                },
                elements: [
                    {
                        type: 'story',
                        properties: { sourceId: 'story-host' },
                        children: [
                            {
                                type: 'body',
                                content: 'Story child one should be a real runtime participant.',
                                properties: { sourceId: 'story-child-one' }
                            },
                            {
                                type: 'body',
                                content: 'Story child two should also register honestly with the session runtime.',
                                properties: { sourceId: 'story-child-two' }
                            }
                        ]
                    }
                ]
            };

            const resolved = resolveDocumentPaths(doc, 'story-runtime-registration.json');
            const engine = new LayoutEngine(toLayoutConfig(resolved, false), runtime);
            const pages = engine.simulate(resolved.elements);
            const registered = engine.getCurrentLayoutSession()?.getRegisteredActors() ?? [];

            assert.ok(pages.length > 0, 'expected story participation probe to paginate');
            assert.ok(registeredActorsIncludeSource(registered, 'story-host'), 'expected story host to stay registered');
            assert.ok(registeredActorsIncludeSource(registered, 'story-child-one'), 'expected first story child to be registered');
            assert.ok(registeredActorsIncludeSource(registered, 'story-child-two'), 'expected second story child to be registered');
        }
    );

    _check(
        'story child boxes preserve child actor identity',
        'story-hosted emitted boxes should carry the hosted child actorId so observer/update paths can see them',
        () => {
            const doc: DocumentInput = {
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
                    body: { marginBottom: 10 }
                },
                elements: [
                    {
                        type: 'story',
                        properties: { sourceId: 'story-identity-host' },
                        children: [
                            {
                                type: 'body',
                                content: 'Identity-bearing story child box.',
                                properties: { sourceId: 'story-identity-child' }
                            }
                        ]
                    }
                ]
            };

            const resolved = resolveDocumentPaths(doc, 'story-child-identity.json');
            const engine = new LayoutEngine(toLayoutConfig(resolved, false), runtime);
            const pages = engine.simulate(resolved.elements);
            const boxes = findBoxesForSource(pages, 'story-identity-child');

            assert.ok(boxes.length > 0, 'expected story identity child boxes');
            assert.ok(
                boxes.every((box) => typeof box.meta?.actorId === 'string' && box.meta.actorId.length > 0),
                'expected story child boxes to carry actorId metadata'
            );
        }
    );

    _check(
        'worldPlain publishes world-native debug identity',
        'worldPlain debug regions should preserve world-plain sourceKind instead of leaking zone-map host identity',
        () => {
            const doc: DocumentInput = {
                documentVersion: CURRENT_DOCUMENT_VERSION,
                layout: {
                    pageSize: { width: 360, height: 360 },
                    margins: { top: 24, right: 24, bottom: 24, left: 24 },
                    fontFamily: 'Arimo',
                    fontSize: 12,
                    lineHeight: 1.25,
                    worldPlain: {
                        style: { marginTop: 10, marginBottom: 10 }
                    }
                },
                fonts: { regular: 'Arimo' },
                styles: {},
                elements: [
                    {
                        type: 'p',
                        content: 'World plain identity proof.',
                        properties: {
                            sourceId: 'plain-label'
                        }
                    }
                ]
            };

            const resolved = resolveDocumentPaths(doc, 'world-plain-debug-identity.json');
            const engine = new LayoutEngine(toLayoutConfig(resolved, false), runtime);
            const worldPlainPackager = buildPackagerForElement(resolved.elements[0], 0, engine) as any;
            const context: PackagerContext = {
                processor: engine,
                pageIndex: 0,
                cursorY: 0,
                margins: { left: 24, right: 24, top: 24, bottom: 24 },
                pageWidth: 360,
                pageHeight: 360,
                publishActorSignal: () => ({ pageIndex: 0, sequence: -1 } as any),
                readActorSignals: () => []
            };

            worldPlainPackager.prepare(312, 312, context);
            const emittedBoxes = worldPlainPackager.emitBoxes(312, 312, context) as any[];
            const debugTags = emittedBoxes
                .map((box) => box.properties?.__vmprintZoneDebugPage)
                .filter(Boolean);

            assert.equal(worldPlainPackager.actorKind, 'world-plain');
            assert.ok(debugTags.length > 0, 'expected worldPlain debug tags');
            assert.ok(debugTags.every((tag: any) => tag.sourceKind === 'world-plain'), 'expected worldPlain debug region sourceKind');
        }
    );

    _check(
        'worldPlain defaults to expandable continuation semantics',
        'a world-plain host should continue through the current page frame by default instead of moving whole like a conservative zone-map',
        () => {
            const continuingWorldBody =
                'This second world paragraph should continue onto a later page without the whole host deferring first.' +
                ' World plain continuation text keeps expanding through the live frame and onto later pages.'.repeat(25);
            const doc: DocumentInput = {
                documentVersion: CURRENT_DOCUMENT_VERSION,
                layout: {
                    pageSize: { width: 320, height: 220 },
                    margins: { top: 20, right: 20, bottom: 20, left: 20 },
                    fontFamily: 'Arimo',
                    fontSize: 12,
                    lineHeight: 1.3,
                    worldPlain: {
                        style: { marginTop: 8, marginBottom: 8 }
                    }
                },
                fonts: { regular: 'Arimo' },
                styles: {
                    body: { marginBottom: 10 }
                },
                elements: [
                    {
                        type: 'body',
                        content: 'World plain starts on page one and should keep flowing through the current frame before continuing later.',
                        properties: { sourceId: 'plain-start' }
                    },
                    {
                        type: 'body',
                        content: continuingWorldBody,
                        properties: { sourceId: 'plain-later' }
                    },
                    {
                        type: 'body',
                        content: 'Tail after world continuation.',
                        properties: { sourceId: 'plain-tail' }
                    }
                ]
            };

            const resolved = resolveDocumentPaths(doc, 'world-plain-default-continuation.json');
            const engine = new LayoutEngine(toLayoutConfig(resolved, false), runtime);
            const pages = engine.simulate(resolved.elements);
            const worldPlainPackager = buildPackagerForElement(resolved.elements[0], 0, engine) as any;

            assert.equal(worldPlainPackager.actorKind, 'world-plain');
            assert.equal(worldPlainPackager.frameOverflowMode, 'continue');
            assert.equal(worldPlainPackager.worldBehaviorMode, 'expandable');
            assert.deepEqual(findPagesForSource(pages, 'plain-start'), [0]);
            assert.ok(findPagesForSource(pages, 'plain-later').some((pageIndex) => pageIndex >= 1), 'expected later world content to continue onto a later page');
        }
    );

    _check(
        'worldPlain authored options can stay conservative',
        'worldPlain should still honor explicit move-whole/fixed settings when authored that way',
        () => {
            const doc: DocumentInput = {
                documentVersion: CURRENT_DOCUMENT_VERSION,
                layout: {
                    pageSize: { width: 320, height: 220 },
                    margins: { top: 20, right: 20, bottom: 20, left: 20 },
                    fontFamily: 'Arimo',
                    fontSize: 12,
                    lineHeight: 1.3,
                    worldPlain: {
                        frameOverflow: 'move-whole',
                        worldBehavior: 'fixed',
                        style: { marginTop: 8, marginBottom: 8 }
                    }
                },
                fonts: { regular: 'Arimo' },
                styles: {
                    body: { marginBottom: 10 }
                },
                elements: [
                    {
                        type: 'body',
                        content: 'Prelude before conservative world plain host.',
                        properties: { sourceId: 'plain-prelude' }
                    },
                    {
                        type: 'body',
                        content: 'Conservative world body should defer together when it does not fit.',
                        properties: { sourceId: 'plain-conservative-start' }
                    },
                    {
                        type: 'body',
                        content: 'Conservative continuation body.',
                        properties: { sourceId: 'plain-conservative-later' }
                    }
                ]
            };

            const resolved = resolveDocumentPaths(doc, 'world-plain-conservative-options.json');
            const engine = new LayoutEngine(toLayoutConfig(resolved, false), runtime);
            const pages = engine.simulate(resolved.elements);
            const worldPlainPackager = buildPackagerForElement(resolved.elements[0], 0, engine) as any;

            assert.equal(worldPlainPackager.frameOverflowMode, 'move-whole');
            assert.equal(worldPlainPackager.worldBehaviorMode, 'fixed');
            assert.ok(findPagesForSource(pages, 'plain-conservative-start').length > 0, 'expected conservative world content to render');
        }
    );

    _check(
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

    _check(
        'move-whole zone-map defers the regional body to the next page',
        'zone content begins only on page 2 when frameOverflow is move-whole',
        () => {
            assert.deepEqual(findPagesForSource(moveWholePages, 'main-zone-open'), [1]);
            assert.deepEqual(findPagesForSource(moveWholePages, 'side-zone-label'), [1]);
        }
    );

    _check(
        'fixed world behavior stays conservative even when frameOverflow is continue',
        'non-expandable fields do not gain mid-page continuation semantics yet',
        () => {
            assert.deepEqual(findPagesForSource(fixedContinuePages, 'main-zone-open'), [1]);
            assert.deepEqual(findPagesForSource(fixedContinuePages, 'side-zone-label'), [1]);
        }
    );

    _check(
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

    _check(
        'continue mode preserves downstream document flow',
        'post-zone ordinary flow still appears after the regional continuation finishes',
        () => {
            const postFlowPages = findPagesForSource(continuePages, 'post-zone-flow');
            assert.ok(postFlowPages.length > 0, 'post-zone flow should still render');
            assert.ok(postFlowPages[0] >= 1, 'post-zone flow should come after the zone continuation pages');
        }
    );

    _check(
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

    _check(
        'explicit region height constrains a continued regional story like a bounded room',
        'a story inside a zone with authored region.height should stop at that room boundary and continue later even if the page has more open space',
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
                    body: { marginBottom: 10, allowLineSplit: true, orphans: 2, widows: 2, textAlign: 'justify' }
                },
                elements: [
                    {
                        type: 'zone-map',
                        zoneLayout: {
                            frameOverflow: 'continue',
                            worldBehavior: 'expandable'
                        },
                        zones: [
                            {
                                id: 'main',
                                region: { x: 0, y: 0, width: 372, height: 120 },
                                elements: [
                                    {
                                        type: 'story',
                                        columns: 2,
                                        gutter: 12,
                                        children: [
                                            { type: 'body', content: 'Room-bounded story opening '.repeat(110), properties: { sourceId: 'room-story-a' } },
                                            { type: 'body', content: 'Room-bounded story continuation '.repeat(110), properties: { sourceId: 'room-story-b' } }
                                        ]
                                    }
                                ]
                            }
                        ]
                    },
                    {
                        type: 'body',
                        content: 'Flow after the room-bounded zone field.',
                        properties: { sourceId: 'room-post-flow' }
                    }
                ]
            };

            const resolved = resolveDocumentPaths(doc, 'zone-continue-region-height-story.json');
            const engine = new LayoutEngine(toLayoutConfig(resolved, false), runtime);
            const pages = engine.simulate(resolved.elements);

            const pageOne = pages[0];
            const pageOneStoryBoxes = (pageOne.boxes || []).filter((box: any) => {
                const actual = String(box.meta?.sourceId || '');
                return actual === 'room-story-a' || actual.endsWith(':room-story-a') ||
                    actual === 'room-story-b' || actual.endsWith(':room-story-b');
            });
            assert.ok(pageOneStoryBoxes.length > 0, 'expected room-bounded story content on page 1');

            const storyBottomOnPageOne = Math.max(...pageOneStoryBoxes.map((box: any) => Number(box.y || 0) + Number(box.h || 0)));
            const roomBottom = 24 + 120;
            assert.ok(
                storyBottomOnPageOne <= roomBottom + 0.5,
                `expected page-1 story bottom (${storyBottomOnPageOne}) to stay within room bottom (${roomBottom})`
            );

            assert.ok(
                findPagesForSource(pages, 'room-story-b').some((pageIndex) => pageIndex >= 1),
                'expected story continuation beyond page 1 due to authored room height'
            );

            const postFlowPages = findPagesForSource(pages, 'room-post-flow');
            assert.ok(postFlowPages.length > 0, 'expected downstream flow after the bounded room field');
            assert.ok(postFlowPages[0] >= 1, 'expected downstream flow to appear only after the bounded room continuation completes');
        }
    );

    _check(
        'multi-column story continuation advances by actual region stack height',
        'when lane regions differ in height, the continuation storyYOffset should use the real stacked travel distance rather than raw columns times viewport height',
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
                    body: { marginBottom: 10, allowLineSplit: true, orphans: 2, widows: 2, textAlign: 'justify' }
                },
                elements: [
                    {
                        type: 'story',
                        columns: 2,
                        gutter: 12,
                        children: [
                            { type: 'body', content: 'Uneven region travel probe opening '.repeat(90), properties: { sourceId: 'balanced-a' } },
                            { type: 'body', content: 'Uneven region travel probe continuation '.repeat(90), properties: { sourceId: 'balanced-b' } }
                        ]
                    }
                ]
            };

            const resolved = resolveDocumentPaths(doc, 'story-balanced-continuation-offset.json');
            const engine = new LayoutEngine(toLayoutConfig(resolved, false), runtime);
            const packager = buildPackagerForElement(resolved.elements[0], 0, engine) as any;
            const context = {
                processor: engine,
                pageIndex: 0,
                cursorY: 0,
                margins: { left: 24, right: 24, top: 24, bottom: 24 },
                pageWidth: 420,
                pageHeight: 420,
                publishActorSignal: () => ({ pageIndex: 0, sequence: -1 }),
                readActorSignals: () => []
            };

            const availableWidth = 372;
            const availableHeight = 300;
            packager.buildColumnRegions = () => ([
                { index: 0, x: 0, w: 180, h: 300 },
                { index: 1, x: 192, w: 180, h: 120 }
            ]);
            packager.prepare(availableWidth, availableHeight, context);
            const split = packager.split(availableHeight, context);
            const continuation = split.continuationFragment as any;

            assert.ok(split.currentFragment, 'expected a current fragment for the uneven-region story');
            assert.ok(continuation, 'expected the uneven-region story to overflow into a continuation fragment');
            assert.equal(continuation.storyYOffset, 420, `expected continuation storyYOffset (${continuation.storyYOffset}) to equal the uneven region stack height (420)`);
            assert.equal(continuation.storyYOffset < 2 * availableHeight, true, `expected continuation storyYOffset (${continuation.storyYOffset}) to be less than raw lane stack height (${2 * availableHeight})`);
        }
    );

    _check(
        'deferred story-absolute images survive into continuation fragments',
        'an absolute image authored before the overflowing text but positioned after page 1 should still appear on page 2',
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
                    body: { marginBottom: 10, allowLineSplit: true, orphans: 2, widows: 2, textAlign: 'justify' }
                },
                elements: [
                    {
                        type: 'story',
                        children: [
                            {
                                type: 'image',
                                content: '',
                                placement: {
                                    mode: 'story-absolute',
                                    x: 220,
                                    y: 430,
                                    wrap: 'around',
                                    gap: 8
                                },
                                properties: {
                                    sourceId: 'deferred-abs-image',
                                    style: {
                                        width: 80,
                                        height: 80
                                    }
                                },
                                image: {
                                    data: onePixelPng,
                                    mimeType: 'image/png',
                                    fit: 'contain'
                                }
                            },
                            {
                                type: 'body',
                                content: 'Continuation probe text before the deferred absolute image. '.repeat(180),
                                properties: { sourceId: 'deferred-abs-body' }
                            }
                        ]
                    }
                ]
            };

            const resolved = resolveDocumentPaths(doc, 'story-absolute-deferred-continuation.json');
            const engine = new LayoutEngine(toLayoutConfig(resolved, false), runtime);
            const pages = engine.simulate(resolved.elements);

            assert.ok(
                findPagesForSource(pages, 'deferred-abs-body').some((pageIndex) => pageIndex >= 1),
                'expected the story body to continue beyond page 1'
            );
            assert.ok(
                findPagesForSource(pages, 'deferred-abs-image').some((pageIndex) => pageIndex >= 1),
                'expected the deferred story-absolute image to appear on a continuation page'
            );
        }
    );

    _check(
        'multi-column story-absolute images project into later lanes',
        'an absolute image whose story y falls into the second lane should render near the top of that lane rather than at a flat page y far below',
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
                    body: { marginBottom: 10, allowLineSplit: true, orphans: 2, widows: 2, textAlign: 'justify' }
                },
                elements: [
                    {
                        type: 'story',
                        columns: 2,
                        gutter: 12,
                        children: [
                            {
                                type: 'image',
                                content: '',
                                placement: {
                                    mode: 'story-absolute',
                                    x: 206,
                                    y: 412,
                                    wrap: 'around',
                                    gap: 8
                                },
                                properties: {
                                    sourceId: 'lane-two-abs-image',
                                    style: {
                                        width: 80,
                                        height: 80
                                    }
                                },
                                image: {
                                    data: onePixelPng,
                                    mimeType: 'image/png',
                                    fit: 'contain'
                                }
                            },
                            {
                                type: 'body',
                                content: 'Lane-two absolute image probe text. '.repeat(20),
                                properties: { sourceId: 'lane-two-body' }
                            }
                        ]
                    }
                ]
            };

            const resolved = resolveDocumentPaths(doc, 'story-absolute-lane-two.json');
            const engine = new LayoutEngine(toLayoutConfig(resolved, false), runtime);
            const pages = engine.simulate(resolved.elements);
            const pageOne = pages[0];
            const imageBoxes = (pageOne.boxes || []).filter((box: any) => {
                const actual = String(box.meta?.sourceId || '');
                return actual === 'lane-two-abs-image' || actual.endsWith(':lane-two-abs-image');
            });

            assert.ok(imageBoxes.length > 0, 'expected the lane-two absolute image on page 1');

            const imageLeft = Math.min(...imageBoxes.map((box: any) => Number(box.x || 0)));
            const imageTop = Math.min(...imageBoxes.map((box: any) => Number(box.y || 0)));
            assert.ok(imageLeft >= 24 + 192 - 0.5, `expected lane-two absolute image x (${imageLeft}) to land in the second lane`);
            assert.ok(imageTop < 80, `expected lane-two absolute image y (${imageTop}) to project near the top of lane two rather than a flat page y`);
        }
    );

    _check(
        'story-absolute blocks render as real placed actors',
        'a non-image direct child of story with story-absolute placement should render at its pinned x/y instead of degrading to normal flow',
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
                    body: { marginBottom: 10, allowLineSplit: true, orphans: 2, widows: 2, textAlign: 'justify' }
                },
                elements: [
                    {
                        type: 'story',
                        children: [
                            {
                                type: 'box',
                                content: 'Pinned note',
                                placement: {
                                    mode: 'story-absolute',
                                    x: 220,
                                    y: 36,
                                    wrap: 'around',
                                    gap: 8
                                },
                                properties: {
                                    sourceId: 'pinned-abs-box',
                                    style: {
                                        width: 90,
                                        height: 60,
                                        borderWidth: 1
                                    }
                                }
                            },
                            {
                                type: 'body',
                                content: 'Absolute block probe text. '.repeat(80),
                                properties: { sourceId: 'pinned-abs-body' }
                            }
                        ]
                    }
                ]
            };

            const resolved = resolveDocumentPaths(doc, 'story-absolute-block.json');
            const engine = new LayoutEngine(toLayoutConfig(resolved, false), runtime);
            const pages = engine.simulate(resolved.elements);
            const pageOne = pages[0];
            const boxMatches = (pageOne.boxes || []).filter((box: any) => {
                const actual = String(box.meta?.sourceId || '');
                return actual === 'pinned-abs-box' || actual.endsWith(':pinned-abs-box');
            });

            assert.ok(boxMatches.length > 0, 'expected the story-absolute block to render');
            const placedLeft = Math.min(...boxMatches.map((box: any) => Number(box.x || 0)));
            const placedTop = Math.min(...boxMatches.map((box: any) => Number(box.y || 0)));
            assert.ok(placedLeft >= 24 + 220 - 0.5, `expected story-absolute block x (${placedLeft}) to respect the pinned story offset`);
            assert.ok(placedTop >= 36 - 0.5 && placedTop < 110, `expected story-absolute block y (${placedTop}) to land near the authored story y`);
        }
    );

    _check(
        'continued story fragments stamp emitted boxes with the real continuation page index',
        'boxes emitted from a continuation fragment should report the pageIndex supplied at emit time rather than staying pinned to page 0',
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
                    body: { marginBottom: 10, allowLineSplit: true, orphans: 2, widows: 2, textAlign: 'justify' }
                },
                elements: [
                    {
                        type: 'story',
                        children: [
                            { type: 'body', content: 'Continuation page index probe. '.repeat(180), properties: { sourceId: 'story-page-index-body' } }
                        ]
                    }
                ]
            };

            const resolved = resolveDocumentPaths(doc, 'story-continuation-page-index.json');
            const engine = new LayoutEngine(toLayoutConfig(resolved, false), runtime);
            const packager = buildPackagerForElement(resolved.elements[0], 0, engine) as any;
            const pageOneContext = {
                processor: engine,
                pageIndex: 0,
                cursorY: 0,
                viewportWorldY: 0,
                viewportHeight: 420,
                margins: { left: 24, right: 24, top: 24, bottom: 24 },
                pageWidth: 420,
                pageHeight: 420,
                publishActorSignal: () => ({ pageIndex: 0, sequence: -1 }),
                readActorSignals: () => []
            };

            const availableWidth = 372;
            const availableHeight = 180;
            packager.prepare(availableWidth, availableHeight, pageOneContext);
            const split = packager.split(availableHeight, pageOneContext);
            const continuation = split.continuationFragment as any;

            assert.ok(split.currentFragment, 'expected a current story fragment');
            assert.ok(continuation, 'expected a continuation story fragment');

            const continuationBoxes = continuation.emitBoxes(availableWidth, 1200, {
                ...pageOneContext,
                pageIndex: 1,
                viewportWorldY: 420
            });
            assert.ok(continuationBoxes.length > 0, 'expected boxes on the continuation fragment');
            assert.ok(
                continuationBoxes.every((box: any) => Number(box.meta?.pageIndex) === 1),
                'expected continuation fragment boxes to carry pageIndex 1'
            );
        }
    );

    _check(
        'nested tables inside later story lanes inherit stacked viewport world origins',
        'a table pushed into lane 2 of a multi-column story should see the second lane world origin rather than the outer page origin',
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
                    body: { marginBottom: 10, allowLineSplit: true, orphans: 2, widows: 2, textAlign: 'justify' }
                },
                elements: [
                    {
                        type: 'story',
                        columns: 2,
                        gutter: 12,
                        children: [
                            {
                                type: 'image',
                                content: '',
                                properties: {
                                    sourceId: 'lane-anchor-image',
                                    style: { width: 180, height: 340, marginBottom: 0 }
                                },
                                image: {
                                    data: onePixelPng,
                                    mimeType: 'image/png',
                                    fit: 'fill'
                                }
                            },
                            {
                                type: 'table',
                                properties: { sourceId: 'lane-two-table' },
                                children: [
                                    {
                                        type: 'table-row',
                                        children: [
                                            { type: 'table-cell', content: 'Cell A', properties: { sourceId: 'lane-two-cell-a' } },
                                            { type: 'table-cell', content: 'Cell B', properties: { sourceId: 'lane-two-cell-b' } }
                                        ]
                                    },
                                    {
                                        type: 'table-row',
                                        children: [
                                            { type: 'table-cell', content: 'Cell C', properties: { sourceId: 'lane-two-cell-c' } },
                                            { type: 'table-cell', content: 'Cell D', properties: { sourceId: 'lane-two-cell-d' } }
                                        ]
                                    }
                                ]
                            }
                        ]
                    }
                ]
            };

            const resolved = resolveDocumentPaths(doc, 'story-lane-table-viewport.json');
            const engine = new LayoutEngine(toLayoutConfig(resolved, false), runtime);
            const pages = engine.simulate(resolved.elements);
            const pageOneCell = (pages[0]?.boxes || []).find((box: any) => {
                if (box.type !== 'table_cell') return false;
                const actual = String(box.meta?.sourceId || '');
                return actual === 'lane-two-cell-a' || actual.endsWith(':lane-two-cell-a');
            });

            assert.ok(pageOneCell, 'expected the lane-two table to render on page 1');
            assert.equal(pageOneCell.properties?._tableViewportWorldY, 372, 'expected the nested table viewport origin to start at lane two');
            assert.equal(pageOneCell.properties?._tableViewportHeight, 372, 'expected the nested table viewport height to match the lane height');
        }
    );

    _check(
        'continued multi-column stories can carry deferred nested actors forward as packagers',
        'when a nested structured actor splits late in a story lane, the continuation story should resume that actor before later children',
        () => {
            class MockSplitActor implements PackagerUnit {
                readonly actorId = 'mock-actor';
                readonly sourceId = 'mock-actor';
                readonly actorKind = 'mock';
                readonly fragmentIndex = 0;

                constructor(
                    private readonly label: string,
                    private readonly requiredHeight: number,
                    private readonly continuation: MockSplitActor | null = null
                ) { }

                prepare(): void { }
                emitBoxes(_availableWidth: number, _availableHeight: number, context: PackagerContext) {
                    return [{
                        type: 'body',
                        x: context.margins.left,
                        y: 0,
                        w: 40,
                        h: this.requiredHeight,
                        content: this.label,
                        properties: { mockLabel: this.label },
                        meta: { sourceId: this.label, pageIndex: context.pageIndex }
                    } as any];
                }
                split(availableHeight: number, _context: PackagerContext): PackagerSplitResult {
                    if (this.continuation && availableHeight < this.requiredHeight) {
                        return {
                            currentFragment: new MockSplitActor(`${this.label}-partA`, Math.max(1, availableHeight)),
                            continuationFragment: this.continuation
                        };
                    }
                    return { currentFragment: null, continuationFragment: this };
                }
                getRequiredHeight(): number { return this.requiredHeight; }
                isUnbreakable(): boolean { return false; }
                getMarginTop(): number { return 0; }
                getMarginBottom(): number { return 0; }
            }

            const storyElement = {
                type: 'story',
                columns: 2,
                gutter: 12,
                children: [
                    { type: 'body', content: 'After actor', properties: { sourceId: 'after-actor' } }
                ]
            } as any;
            const continuationActor = new MockSplitActor('mock-continued', 24);
            const leadingActor = new MockSplitActor('mock-start', 180, continuationActor);
            const engine = new LayoutEngine({
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
                    body: { marginBottom: 10, allowLineSplit: true, orphans: 2, widows: 2 }
                }
            } as any, runtime);

            const packager = new StoryPackager(storyElement, engine as any, 0, [], 0, undefined, leadingActor);
            const context: PackagerContext = {
                processor: engine,
                pageIndex: 0,
                cursorY: 0,
                viewportWorldY: 0,
                viewportHeight: 120,
                margins: { left: 24, right: 24, top: 24, bottom: 24 },
                pageWidth: 420,
                pageHeight: 120,
                publishActorSignal: () => ({ pageIndex: 0, sequence: -1 } as any),
                readActorSignals: () => []
            };

            packager.prepare(372, 120, context);
            const split = packager.split(120, context);
            assert.ok(split.currentFragment, 'expected a current story fragment');
            assert.ok(split.continuationFragment, 'expected a continuation story fragment');

            const currentBoxes = split.currentFragment!.emitBoxes(372, 120, context) as any[];
            const continuationBoxes = split.continuationFragment!.emitBoxes(372, 120, {
                ...context,
                pageIndex: 1,
                viewportWorldY: 120
            }) as any[];

            assert.ok(currentBoxes.some((box) => box.properties?.mockLabel === 'mock-start-partA'), 'expected page 1 to contain the leading actor fragment');
            assert.ok(continuationBoxes.some((box) => box.properties?.mockLabel === 'mock-continued'), 'expected page 2 to resume the deferred actor');
            assert.ok(continuationBoxes.some((box) => String(box.meta?.sourceId || '').includes('after-actor')), 'expected later story children to remain after the resumed actor');
        }
    );

    _check(
        'continued multi-column stories preserve deferred nested actors even with no later source children',
        'a split nested actor by itself should still produce a continuation story fragment instead of being dropped',
        () => {
            class MockSplitActorSolo implements PackagerUnit {
                readonly actorId = 'mock-actor-solo';
                readonly sourceId = 'mock-actor-solo';
                readonly actorKind = 'mock';
                readonly fragmentIndex = 0;

                constructor(
                    private readonly label: string,
                    private readonly requiredHeight: number,
                    private readonly continuation: MockSplitActorSolo | null = null
                ) { }

                prepare(): void { }
                emitBoxes(_availableWidth: number, _availableHeight: number, context: PackagerContext) {
                    return [{
                        type: 'body',
                        x: context.margins.left,
                        y: 0,
                        w: 40,
                        h: this.requiredHeight,
                        content: this.label,
                        properties: { mockLabel: this.label },
                        meta: { sourceId: this.label, pageIndex: context.pageIndex }
                    } as any];
                }
                split(availableHeight: number, _context: PackagerContext): PackagerSplitResult {
                    if (this.continuation && availableHeight < this.requiredHeight) {
                        return {
                            currentFragment: new MockSplitActorSolo(`${this.label}-partA`, Math.max(1, availableHeight)),
                            continuationFragment: this.continuation
                        };
                    }
                    return { currentFragment: null, continuationFragment: this };
                }
                getRequiredHeight(): number { return this.requiredHeight; }
                isUnbreakable(): boolean { return false; }
                getMarginTop(): number { return 0; }
                getMarginBottom(): number { return 0; }
            }

            const storyElement = {
                type: 'story',
                columns: 2,
                gutter: 12,
                children: []
            } as any;
            const continuationActor = new MockSplitActorSolo('mock-solo-continued', 24);
            const leadingActor = new MockSplitActorSolo('mock-solo-start', 180, continuationActor);
            const engine = new LayoutEngine({
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
                    body: { marginBottom: 10, allowLineSplit: true, orphans: 2, widows: 2 }
                }
            } as any, runtime);

            const packager = new StoryPackager(storyElement, engine as any, 0, [], 0, undefined, leadingActor);
            const context: PackagerContext = {
                processor: engine,
                pageIndex: 0,
                cursorY: 0,
                viewportWorldY: 0,
                viewportHeight: 120,
                margins: { left: 24, right: 24, top: 24, bottom: 24 },
                pageWidth: 420,
                pageHeight: 120,
                publishActorSignal: () => ({ pageIndex: 0, sequence: -1 } as any),
                readActorSignals: () => []
            };

            packager.prepare(372, 120, context);
            const split = packager.split(120, context);
            assert.ok(split.currentFragment, 'expected a current story fragment');
            assert.ok(split.continuationFragment, 'expected a continuation fragment even without later source children');

            const continuationBoxes = split.continuationFragment!.emitBoxes(372, 120, {
                ...context,
                pageIndex: 1,
                viewportWorldY: 120
            }) as any[];

            assert.ok(continuationBoxes.some((box) => box.properties?.mockLabel === 'mock-solo-continued'), 'expected the deferred actor to survive into the continuation story');
        }
    );
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
