import assert from 'node:assert/strict';

import {
    CURRENT_DOCUMENT_VERSION,
    LayoutEngine,
    loadDocument,
    setDefaultEngineRuntime,
    toLayoutConfig,
    type DocumentInput
} from '../src';
import { createPrintEngineRuntime } from '../src/font-management/runtime';
import { loadLocalFontManager } from './harness/engine-harness';
import { checkAsync, logStep } from './harness/test-utils';

const TEST_PREFIX = 'publication-mode.spec';
const log = (msg: string) => logStep(TEST_PREFIX, msg);
const _checkAsync = (desc: string, exp: string, fn: () => Promise<void>) => checkAsync(TEST_PREFIX, desc, exp, fn);

function makeDocument(
    layout: Partial<DocumentInput['layout']> = {}
): DocumentInput {
    const blockText = 'Continuous publication keeps browser flow in one world while print pagination can still slice it into pages.';
    return {
        documentVersion: CURRENT_DOCUMENT_VERSION,
        layout: {
            pageSize: 'LETTER',
            margins: { top: 72, right: 72, bottom: 72, left: 72 },
            fontFamily: 'Arimo',
            fontSize: 13,
            lineHeight: 1.35,
            ...layout
        },
        fonts: { regular: 'Arimo' },
        styles: {
            p: {
                marginBottom: 10,
                allowLineSplit: true,
                orphans: 2,
                widows: 2
            }
        },
        elements: [
            { type: 'p', name: 'lead', content: blockText.repeat(2) },
            {
                type: 'p',
                name: 'forcedBreak',
                content: blockText.repeat(2),
                properties: { style: { pageBreakBefore: true } }
            },
            ...Array.from({ length: 120 }, (_, index) => ({
                type: 'p',
                name: `tail${index + 1}`,
                content: `${index + 1}. ${blockText}`
            }))
        ]
    };
}

async function layout(document: DocumentInput): Promise<{ engine: LayoutEngine; pages: ReturnType<LayoutEngine['simulate']> }> {
    const ir = loadDocument(document, `publication-mode:${document.layout.publicationMode || 'paginated'}`);
    const engine = new LayoutEngine(toLayoutConfig(ir, false));
    await engine.waitForFonts();
    return { engine, pages: engine.simulate(ir.elements) };
}

function boxIntersectsRect(
    box: any,
    rect: { x: number; y: number; w: number; h: number }
): boolean {
    const x = Number(box.x || 0);
    const y = Number(box.y || 0);
    const w = Math.max(0, Number(box.w || 0));
    const h = Math.max(0, Number(box.h || 0));
    return x + w >= rect.x
        && x <= rect.x + rect.w
        && y + h >= rect.y
        && y <= rect.y + rect.h;
}

function byteLength(value: unknown): number {
    return Buffer.byteLength(JSON.stringify(value));
}

function countBoxes(pages: readonly any[]): number {
    return pages.reduce((total, page) => total + (Array.isArray(page?.boxes) ? page.boxes.length : 0), 0);
}

function sourceText(element: any): string {
    if (typeof element?.content === 'string' && element.content) return element.content;
    if (Array.isArray(element?.children)) {
        return element.children.map((child: any) => sourceText(child)).join('');
    }
    return '';
}

async function main(): Promise<void> {
    const LocalFontManager = await loadLocalFontManager();
    const runtime = createPrintEngineRuntime({ fontManager: new LocalFontManager() });
    setDefaultEngineRuntime(runtime);

    log('Installing local font runtime');

    await _checkAsync('continuous publication ignores print breaks by default', 'one resized page with no continuations', async () => {
        const { engine, pages } = await layout(makeDocument({ publicationMode: 'continuous' }));
        assert.equal(pages.length, 1);
        assert.ok(pages[0].height > 792, 'continuous page should grow beyond the default LETTER page height');
        assert.ok(pages[0].height < 10_000_000, 'continuous page should publish at explored content height');
        const registry = (engine.getCurrentLayoutSession() as any)?.kernel?.actorRegistry || [];
        assert.equal(registry.filter((actor: any) => actor?.continuationOf).length, 0);
    });

    await _checkAsync('continuous publication can preserve print breaks explicitly', 'forced break still creates a page boundary', async () => {
        const { pages } = await layout(makeDocument({
            publicationMode: 'continuous',
            printBreakPolicy: 'preserve'
        }));
        assert.ok(pages.length > 1);
    });

    await _checkAsync('paginated publication preserves print breaks by default', 'ordinary print layout remains multi-page', async () => {
        const { pages } = await layout(makeDocument());
        assert.ok(pages.length > 1);
    });

    await _checkAsync('continuous publication honors world-y replay stops', 'initial and runtime replay windows stay bounded by world region', async () => {
        const document = makeDocument({ publicationMode: 'continuous' });
        const ir = loadDocument(document, 'publication-mode:continuous-world-y-stop');
        const engine = new LayoutEngine(toLayoutConfig(ir, false));
        await engine.waitForFonts();

        const partialPages = engine.simulate(ir.elements, { stopAtWorldY: 1600 });
        const full = await layout(makeDocument({ publicationMode: 'continuous' }));
        assert.equal(partialPages.length, 1);
        assert.equal(full.pages.length, 1);
        assert.ok(partialPages[0].height >= 1600, 'partial continuous page should reach the requested world Y');
        assert.ok(partialPages[0].height < full.pages[0].height, 'partial continuous page should stop before full document height');
        assert.ok(countBoxes(partialPages) < countBoxes(full.pages), 'partial continuous publication should omit unseen tail boxes');

        const replayEvents: any[] = [];
        const unlisten = engine.listen('layout.startReplayAroundViewport', (event) => replayEvents.push(event));
        const replay = engine.send('layout.startReplayAroundViewport', {
            elements: ir.elements,
            viewport: { y: 900, height: 300, overscanY: 0 },
            intent: {
                kind: 'formatting',
                target: { sourceId: 'lead' },
                patch: {
                    fontSize: 18,
                    lineHeight: 1.45,
                    marginBottom: 18
                }
            }
        }) as any;
        unlisten();

        assert.equal(replay?.kind, 'geometry');
        assert.equal(replay?.replay?.completion, 'partial');
        assert.equal(replay?.replay?.pending, true);
        assert.equal(replay?.replay?.continueUntil?.requested?.untilY, 1200);
        assert.equal(replay?.replay?.continueUntil?.reason, 'until-y');
        assert.ok(countBoxes(replay.pages) < countBoxes(full.pages), 'runtime replay should not publish unseen continuous tail boxes');
        assert.ok(replay.pages[0].height < full.pages[0].height, 'runtime replay should stop before full continuous height');
        assert.equal(replayEvents.length, 1);
        assert.equal(replayEvents[0].payload?.replay?.replayId, replay.replay.replayId);
        assert.ok(!Object.prototype.hasOwnProperty.call(replay, 'replaySession'), 'protocol result should not expose live replaySession');
    });

    await _checkAsync('visible world viewport projects continuous output', 'visible-region request returns clipped page snapshots through protocol events', async () => {
        const { engine, pages } = await layout(makeDocument({ publicationMode: 'continuous' }));
        const page = pages[0];
        const targetBox = page.boxes.find((box: any) => Number(box.y || 0) > 900);
        assert.ok(targetBox, 'expected a target box below the initial viewport');

        const request = {
            worldX: 0,
            worldY: Math.max(0, Number(targetBox.y || 0) - 24),
            width: page.width,
            height: Math.max(120, Number(targetBox.h || 0) + 48)
        };
        const events: any[] = [];
        const unlisten = engine.listen('layout.visibleWorldViewport', (event) => events.push(event));
        const ordinaryViewport = engine.send('layout.worldViewport', request) as any;
        const visibleViewport = engine.send('layout.visibleWorldViewport', request) as any;
        unlisten();

        assert.equal(visibleViewport.kind, 'world');
        assert.equal(visibleViewport.pageCount, 1);
        assert.equal(visibleViewport.segments.length, 1);
        assert.equal(events.length, 1);
        assert.equal(events[0].payload.sourceSignature, visibleViewport.sourceSignature);

        const ordinaryBoxes = ordinaryViewport.segments[0].page.boxes.length;
        const visibleBoxes = visibleViewport.segments[0].page.boxes.length;
        assert.ok(visibleBoxes > 0, 'expected the visible viewport to include intersecting boxes');
        assert.ok(visibleBoxes < ordinaryBoxes, 'expected visible viewport to omit off-screen boxes');
        assert.ok(
            byteLength(visibleViewport) < byteLength(ordinaryViewport),
            'expected visible viewport payload to be smaller than ordinary world viewport payload'
        );

        const sourceRect = visibleViewport.segments[0].sourceRect;
        assert.equal(sourceRect.x, request.worldX);
        assert.equal(sourceRect.y, request.worldY);
        assert.equal(sourceRect.w, request.width);
        assert.ok(Math.abs(sourceRect.h - request.height) < 0.001);
        assert.ok(
            visibleViewport.segments[0].page.boxes.every((box: any) => boxIntersectsRect(box, sourceRect)),
            'expected every projected box to intersect the requested source rectangle'
        );
    });

    await _checkAsync('runtime text edit can split and merge source paragraphs', 'system text-edit intents mutate source blocks through protocol replay', async () => {
        const document: DocumentInput = {
            documentVersion: CURRENT_DOCUMENT_VERSION,
            layout: {
                pageSize: 'LETTER',
                margins: { top: 72, right: 72, bottom: 72, left: 72 },
                fontFamily: 'Arimo',
                fontSize: 13,
                lineHeight: 1.35
            },
            fonts: { regular: 'Arimo' },
            styles: {
                p: { marginBottom: 10, allowLineSplit: true }
            },
            elements: [
                { type: 'p', content: 'Lead anchor.', properties: { sourceId: 'edit-lead' } },
                { type: 'p', content: 'Alpha target sentence. Bravo target sentence.', properties: { sourceId: 'edit-target' } },
                { type: 'p', content: 'Tail anchor.', properties: { sourceId: 'edit-tail' } }
            ]
        };
        const ir = loadDocument(document, 'publication-mode:runtime-text-edit');
        const engine = new LayoutEngine(toLayoutConfig(ir, false));
        await engine.waitForFonts();
        engine.simulate(ir.elements);

        const events: any[] = [];
        const unlisten = engine.listen('layout.runtimeIntentApplied', (event) => events.push(event));
        const insert = engine.send('layout.applyRuntimeIntent', {
            elements: ir.elements,
            intent: {
                kind: 'text-edit',
                operation: 'insertText',
                target: { sourceId: 'edit-target', sourceOffset: 6 },
                text: 'runtime '
            }
        }) as any;
        const split = engine.send('layout.applyRuntimeIntent', {
            elements: ir.elements,
            intent: {
                kind: 'text-edit',
                operation: 'splitParagraph',
                target: { sourceId: 'edit-target', sourceOffset: String(ir.elements[1].content || '').indexOf('Bravo') }
            }
        }) as any;
        const splitSourceId = String(split?.history?.edit?.insertedSourceId || '');
        const merge = engine.send('layout.applyRuntimeIntent', {
            elements: ir.elements,
            intent: {
                kind: 'text-edit',
                operation: 'mergeParagraphBackward',
                target: { sourceId: splitSourceId }
            }
        }) as any;
        const deleteSmall = engine.send('layout.applyRuntimeIntent', {
            elements: ir.elements,
            intent: {
                kind: 'text-edit',
                operation: 'deleteText',
                target: { sourceId: 'edit-target', sourceStart: 6, sourceEnd: 14 }
            }
        }) as any;
        unlisten();

        assert.equal(insert?.kind, 'content-only');
        assert.equal(insert?.update?.kind, 'content-only');
        assert.equal(deleteSmall?.kind, 'content-only');
        assert.equal(deleteSmall?.update?.kind, 'content-only');
        assert.equal(insert?.update?.source, 'runtime-text-edit');
        assert.equal(deleteSmall?.update?.source, 'runtime-text-edit');
        assert.equal(split?.update?.source, 'runtime-text-edit');
        assert.equal(merge?.update?.source, 'runtime-text-edit');
        assert.ok(splitSourceId.endsWith('edit-target:split-1'));
        assert.deepEqual(split?.update?.sourceIds, ['author:edit-target', splitSourceId]);
        assert.deepEqual(merge?.update?.sourceIds, [splitSourceId, 'author:edit-target']);
        assert.deepEqual(deleteSmall?.update?.sourceIds, ['author:edit-target']);
        assert.equal(events.length, 4);
        assert.equal(ir.elements.length, 3);
        assert.equal(ir.elements[1].properties?.sourceId, 'edit-target');
        assert.equal(ir.elements[1].content, 'Alpha target sentence. Bravo target sentence.');
    });

    await _checkAsync('runtime text edit falls back to geometry when text changes box size', 'same intent path detects content-only mismatch', async () => {
        const document: DocumentInput = {
            documentVersion: CURRENT_DOCUMENT_VERSION,
            layout: {
                pageSize: { width: 320, height: 500 },
                margins: { top: 48, right: 48, bottom: 48, left: 48 },
                fontFamily: 'Arimo',
                fontSize: 14,
                lineHeight: 1.35
            },
            fonts: { regular: 'Arimo' },
            styles: {
                p: { marginBottom: 10, allowLineSplit: true }
            },
            elements: [
                { type: 'p', content: 'Lead anchor.', properties: { sourceId: 'growth-lead' } },
                { type: 'p', content: 'Short target.', properties: { sourceId: 'growth-target' } },
                { type: 'p', content: 'Tail anchor.', properties: { sourceId: 'growth-tail' } }
            ]
        };
        const ir = loadDocument(document, 'publication-mode:runtime-text-edit-growth');
        const engine = new LayoutEngine(toLayoutConfig(ir, false));
        await engine.waitForFonts();
        engine.simulate(ir.elements);

        const result = engine.send('layout.applyRuntimeIntent', {
            elements: ir.elements,
            intent: {
                kind: 'text-edit',
                operation: 'insertText',
                target: { sourceId: 'growth-target', sourceOffset: 6 },
                text: 'runtime growth text that is deliberately long enough to wrap onto additional lines and alter the target paragraph height '
            }
        }) as any;

        assert.equal(result?.kind, 'geometry');
        assert.equal(result?.update?.kind, 'geometry');
        assert.equal(result?.update?.source, 'runtime-text-edit');
        assert.deepEqual(result?.update?.sourceIds, ['author:growth-target']);
        assert.ok(result?.update?.replayFrontier, 'expected geometry fallback to report replay frontier');
        assert.equal(ir.elements[1].content.startsWith('Short runtime growth text'), true);
    });

    await _checkAsync('runtime delete text falls back to geometry when it shrinks box size', 'deleteText uses replay after content-only mismatch', async () => {
        const document: DocumentInput = {
            documentVersion: CURRENT_DOCUMENT_VERSION,
            layout: {
                pageSize: { width: 320, height: 500 },
                margins: { top: 48, right: 48, bottom: 48, left: 48 },
                fontFamily: 'Arimo',
                fontSize: 14,
                lineHeight: 1.35
            },
            fonts: { regular: 'Arimo' },
            styles: {
                p: { marginBottom: 10, allowLineSplit: true }
            },
            elements: [
                { type: 'p', content: 'Lead anchor.', properties: { sourceId: 'delete-lead' } },
                {
                    type: 'p',
                    content: 'Short target with a deliberately long removable tail that wraps across several narrow lines, making the paragraph tall enough that deleting this removable tail must reduce box height and require geometry replay.',
                    properties: { sourceId: 'delete-target' }
                },
                { type: 'p', content: 'Tail anchor.', properties: { sourceId: 'delete-tail' } }
            ]
        };
        const ir = loadDocument(document, 'publication-mode:runtime-delete-text-geometry');
        const engine = new LayoutEngine(toLayoutConfig(ir, false));
        await engine.waitForFonts();
        engine.simulate(ir.elements);

        const text = String(ir.elements[1].content || '');
        const start = text.indexOf(' with a deliberately');
        const end = text.indexOf('.', start);
        const result = engine.send('layout.applyRuntimeIntent', {
            elements: ir.elements,
            intent: {
                kind: 'text-edit',
                operation: 'deleteText',
                target: { sourceId: 'delete-target', sourceStart: start, sourceEnd: end }
            }
        }) as any;

        assert.equal(result?.kind, 'geometry');
        assert.equal(result?.update?.kind, 'geometry');
        assert.equal(result?.update?.source, 'runtime-text-edit');
        assert.deepEqual(result?.update?.sourceIds, ['author:delete-target']);
        assert.ok(result?.update?.replayFrontier, 'expected geometry fallback to report replay frontier');
        assert.equal(ir.elements[1].content, 'Short target.');
    });

    await _checkAsync('runtime range formatting separates paint-only and geometry edits', 'source ranges redraw or replay according to measured impact', async () => {
        const document: DocumentInput = {
            documentVersion: CURRENT_DOCUMENT_VERSION,
            layout: {
                pageSize: { width: 360, height: 520 },
                margins: { top: 48, right: 48, bottom: 48, left: 48 },
                fontFamily: 'Arimo',
                fontSize: 14,
                lineHeight: 1.35
            },
            fonts: { regular: 'Arimo' },
            styles: {
                p: { marginBottom: 10, allowLineSplit: true }
            },
            elements: [
                { type: 'p', content: 'Lead anchor.', properties: { sourceId: 'format-lead' } },
                {
                    type: 'p',
                    content: 'Alpha range target sentence. Bravo range target sentence stays nearby.',
                    properties: { sourceId: 'format-target' }
                },
                { type: 'p', content: 'Tail anchor.', properties: { sourceId: 'format-tail' } }
            ]
        };
        const ir = loadDocument(document, 'publication-mode:runtime-range-formatting');
        const engine = new LayoutEngine(toLayoutConfig(ir, false));
        await engine.waitForFonts();
        engine.simulate(ir.elements);

        const text = String(ir.elements[1].content || '');
        const rangeStart = text.indexOf('range target');
        const rangeEnd = rangeStart + 'range target'.length;
        const events: any[] = [];
        const unlisten = engine.listen('layout.runtimeIntentApplied', (event) => events.push(event));
        const paint = engine.send('layout.applyRuntimeIntent', {
            elements: ir.elements,
            intent: {
                kind: 'formatting',
                target: { sourceId: 'format-target', sourceStart: rangeStart, sourceEnd: rangeEnd },
                patch: {
                    color: '#0f766e',
                    backgroundColor: '#ccfbf1'
                }
            }
        }) as any;
        const geometry = engine.send('layout.applyRuntimeIntent', {
            elements: ir.elements,
            intent: {
                kind: 'formatting',
                target: { sourceId: 'format-target', sourceStart: rangeStart, sourceEnd: rangeEnd },
                patch: {
                    fontSize: 24,
                    fontWeight: 700,
                    backgroundColor: '#fde68a'
                }
            }
        }) as any;
        unlisten();

        assert.equal(paint?.kind, 'content-only');
        assert.equal(paint?.update?.kind, 'content-only');
        assert.equal(paint?.update?.source, 'runtime-formatting');
        assert.deepEqual(paint?.update?.sourceIds, ['author:format-target']);
        assert.equal(geometry?.kind, 'geometry');
        assert.equal(geometry?.update?.kind, 'geometry');
        assert.equal(geometry?.update?.source, 'runtime-formatting');
        assert.deepEqual(geometry?.update?.sourceIds, ['author:format-target']);
        assert.ok(geometry?.update?.replayFrontier, 'expected metric range formatting to report replay frontier');
        assert.equal(events.length, 2);
        assert.equal(ir.elements[1].content, '');
        assert.ok(Array.isArray(ir.elements[1].children), 'expected range formatting to preserve source as inline children');
        assert.equal(
            ir.elements[1].children.map((child: any) => String(child.content || '')).join(''),
            'Alpha range target sentence. Bravo range target sentence stays nearby.'
        );
        assert.ok(
            ir.elements[1].children.some((child: any) => child?.properties?.style?.fontSize === 24),
            'expected metric range style to live in the source tree'
        );
    });

    await _checkAsync('runtime text edits preserve inline range structure', 'editing formatted source trees keeps style spans sane', async () => {
        const document: DocumentInput = {
            documentVersion: CURRENT_DOCUMENT_VERSION,
            layout: {
                pageSize: 'LETTER',
                margins: { top: 72, right: 72, bottom: 72, left: 72 },
                fontFamily: 'Arimo',
                fontSize: 13,
                lineHeight: 1.35
            },
            fonts: { regular: 'Arimo' },
            styles: {
                p: { marginBottom: 10, allowLineSplit: true }
            },
            elements: [
                { type: 'p', content: 'Lead anchor.', properties: { sourceId: 'inline-edit-lead' } },
                {
                    type: 'p',
                    content: 'Alpha range target sentence. Bravo range target sentence.',
                    properties: { sourceId: 'inline-edit-target' }
                },
                { type: 'p', content: 'Tail anchor.', properties: { sourceId: 'inline-edit-tail' } }
            ]
        };
        const ir = loadDocument(document, 'publication-mode:inline-text-edit');
        const engine = new LayoutEngine(toLayoutConfig(ir, false));
        await engine.waitForFonts();
        engine.simulate(ir.elements);

        const text = String(ir.elements[1].content || '');
        const rangeStart = text.indexOf('range target');
        const rangeEnd = rangeStart + 'range target'.length;
        const format = engine.send('layout.applyRuntimeIntent', {
            elements: ir.elements,
            intent: {
                kind: 'formatting',
                target: { sourceId: 'inline-edit-target', sourceStart: rangeStart, sourceEnd: rangeEnd },
                patch: {
                    color: '#0f766e',
                    backgroundColor: '#ccfbf1'
                }
            }
        }) as any;
        const insert = engine.send('layout.applyRuntimeIntent', {
            elements: ir.elements,
            intent: {
                kind: 'text-edit',
                operation: 'insertText',
                target: { sourceId: 'inline-edit-target', sourceOffset: rangeStart + 'range '.length },
                text: 'live '
            }
        }) as any;

        assert.equal(format?.kind, 'content-only');
        assert.equal(insert?.kind, 'content-only');
        assert.equal(sourceText(ir.elements[1]), 'Alpha range live target sentence. Bravo range target sentence.');
        assert.ok(
            ir.elements[1].children.some((child: any) =>
                child.content === 'range live target'
                && child?.properties?.style?.backgroundColor === '#ccfbf1'
            ),
            'expected inserted text inside range to inherit the styled text node'
        );

        const deleteStyledRange = engine.send('layout.applyRuntimeIntent', {
            elements: ir.elements,
            intent: {
                kind: 'text-edit',
                operation: 'deleteText',
                target: { sourceId: 'inline-edit-target', sourceStart: rangeStart, sourceEnd: rangeStart + 'range live target'.length }
            }
        }) as any;
        assert.equal(deleteStyledRange?.kind, 'content-only');
        assert.equal(sourceText(ir.elements[1]), 'Alpha  sentence. Bravo range target sentence.');
        assert.equal(
            ir.elements[1].children.filter((child: any) => !child?.properties?.style?.backgroundColor).length,
            1,
            'expected compatible unstyled siblings to merge after deleting styled range'
        );

        const secondRangeStart = sourceText(ir.elements[1]).indexOf('range target');
        const secondRangeEnd = secondRangeStart + 'range target'.length;
        engine.send('layout.applyRuntimeIntent', {
            elements: ir.elements,
            intent: {
                kind: 'formatting',
                target: { sourceId: 'inline-edit-target', sourceStart: secondRangeStart, sourceEnd: secondRangeEnd },
                patch: {
                    color: '#92400e',
                    backgroundColor: '#fde68a'
                }
            }
        });
        const split = engine.send('layout.applyRuntimeIntent', {
            elements: ir.elements,
            intent: {
                kind: 'text-edit',
                operation: 'splitParagraph',
                target: { sourceId: 'inline-edit-target', sourceOffset: secondRangeStart }
            }
        }) as any;
        const splitSourceId = String(split?.history?.edit?.insertedSourceId || '');
        assert.equal(split?.kind, 'geometry');
        assert.ok(splitSourceId.endsWith('inline-edit-target:split-1'));
        assert.equal(sourceText(ir.elements[1]), 'Alpha  sentence. Bravo ');
        assert.equal(sourceText(ir.elements[2]), 'range target sentence.');
        assert.ok(
            ir.elements[2].children.some((child: any) => child.content === 'range target' && child?.properties?.style?.backgroundColor === '#fde68a'),
            'expected split sibling to retain styled range children'
        );

        const merge = engine.send('layout.applyRuntimeIntent', {
            elements: ir.elements,
            intent: {
                kind: 'text-edit',
                operation: 'mergeParagraphBackward',
                target: { sourceId: splitSourceId }
            }
        }) as any;
        assert.equal(merge?.kind, 'geometry');
        assert.equal(sourceText(ir.elements[1]), 'Alpha  sentence. Bravo range target sentence.');
        assert.ok(
            ir.elements[1].children.some((child: any) => child.content === 'range target' && child?.properties?.style?.backgroundColor === '#fde68a'),
            'expected merge to preserve styled range child'
        );
    });

    await _checkAsync('runtime text edits split through inline ranges', 'partial edits preserve style fragments across boundaries', async () => {
        const document: DocumentInput = {
            documentVersion: CURRENT_DOCUMENT_VERSION,
            layout: {
                pageSize: 'LETTER',
                margins: { top: 72, right: 72, bottom: 72, left: 72 },
                fontFamily: 'Arimo',
                fontSize: 13,
                lineHeight: 1.35
            },
            fonts: { regular: 'Arimo' },
            styles: {
                p: { marginBottom: 10, allowLineSplit: true }
            },
            elements: [
                { type: 'p', content: 'Lead anchor.', properties: { sourceId: 'inline-boundary-lead' } },
                {
                    type: 'p',
                    content: 'Alpha range target sentence. Bravo range target sentence.',
                    properties: { sourceId: 'inline-boundary-target' }
                },
                { type: 'p', content: 'Tail anchor.', properties: { sourceId: 'inline-boundary-tail' } }
            ]
        };
        const ir = loadDocument(document, 'publication-mode:inline-boundary-text-edit');
        const engine = new LayoutEngine(toLayoutConfig(ir, false));
        await engine.waitForFonts();
        engine.simulate(ir.elements);

        const text = String(ir.elements[1].content || '');
        const rangeStart = text.indexOf('range target');
        const rangeEnd = rangeStart + 'range target'.length;
        engine.send('layout.applyRuntimeIntent', {
            elements: ir.elements,
            intent: {
                kind: 'formatting',
                target: { sourceId: 'inline-boundary-target', sourceStart: rangeStart, sourceEnd: rangeEnd },
                patch: {
                    color: '#92400e',
                    backgroundColor: '#fde68a'
                }
            }
        });

        const splitInsideStyled = engine.send('layout.applyRuntimeIntent', {
            elements: ir.elements,
            intent: {
                kind: 'text-edit',
                operation: 'splitParagraph',
                target: { sourceId: 'inline-boundary-target', sourceOffset: rangeStart + 'range '.length }
            }
        }) as any;
        const splitSourceId = String(splitInsideStyled?.history?.edit?.insertedSourceId || '');
        assert.equal(splitInsideStyled?.kind, 'geometry');
        assert.equal(sourceText(ir.elements[1]), 'Alpha range ');
        assert.equal(sourceText(ir.elements[2]), 'target sentence. Bravo range target sentence.');
        assert.ok(
            ir.elements[1].children.some((child: any) => child.content === 'range ' && child?.properties?.style?.backgroundColor === '#fde68a'),
            'expected first paragraph to retain first half of styled range'
        );
        assert.ok(
            ir.elements[2].children.some((child: any) => child.content === 'target' && child?.properties?.style?.backgroundColor === '#fde68a'),
            'expected split sibling to retain second half of styled range'
        );

        const merge = engine.send('layout.applyRuntimeIntent', {
            elements: ir.elements,
            intent: {
                kind: 'text-edit',
                operation: 'mergeParagraphBackward',
                target: { sourceId: splitSourceId }
            }
        }) as any;
        assert.equal(merge?.kind, 'geometry');
        assert.equal(sourceText(ir.elements[1]), 'Alpha range target sentence. Bravo range target sentence.');
        assert.ok(
            ir.elements[1].children.some((child: any) => child.content === 'range target' && child?.properties?.style?.backgroundColor === '#fde68a'),
            'expected merge to combine compatible styled fragments'
        );

        const crossBoundaryDelete = engine.send('layout.applyRuntimeIntent', {
            elements: ir.elements,
            intent: {
                kind: 'text-edit',
                operation: 'deleteText',
                target: {
                    sourceId: 'inline-boundary-target',
                    sourceStart: rangeStart - 'ha '.length,
                    sourceEnd: rangeStart + 'range '.length
                }
            }
        }) as any;
        assert.equal(crossBoundaryDelete?.kind, 'content-only');
        assert.equal(sourceText(ir.elements[1]), 'Alptarget sentence. Bravo range target sentence.');
        assert.ok(
            ir.elements[1].children.some((child: any) => child.content === 'target' && child?.properties?.style?.backgroundColor === '#fde68a'),
            'expected remaining styled suffix to survive cross-boundary delete'
        );
        assert.ok(
            ir.elements[1].children.some((child: any) => child.content === 'Alp' && !child?.properties?.style?.backgroundColor),
            'expected unstyled prefix to survive cross-boundary delete'
        );
    });

    await _checkAsync('runtime history undo and redo restores text, formatting, and structure', 'history snapshots replay through system script protocol', async () => {
        const document: DocumentInput = {
            documentVersion: CURRENT_DOCUMENT_VERSION,
            layout: {
                pageSize: 'LETTER',
                margins: { top: 72, right: 72, bottom: 72, left: 72 },
                fontFamily: 'Arimo',
                fontSize: 13,
                lineHeight: 1.35
            },
            fonts: { regular: 'Arimo' },
            styles: {
                p: { marginBottom: 10, allowLineSplit: true }
            },
            elements: [
                { type: 'p', content: 'Lead anchor.', properties: { sourceId: 'history-lead' } },
                {
                    type: 'p',
                    content: 'Alpha range target sentence. Bravo range target sentence.',
                    properties: { sourceId: 'history-target' }
                },
                { type: 'p', content: 'Tail anchor.', properties: { sourceId: 'history-tail' } }
            ]
        };
        const ir = loadDocument(document, 'publication-mode:runtime-history');
        const engine = new LayoutEngine(toLayoutConfig(ir, false));
        await engine.waitForFonts();
        engine.simulate(ir.elements);

        const insert = engine.send('layout.applyRuntimeIntent', {
            elements: ir.elements,
            intent: {
                kind: 'text-edit',
                operation: 'insertText',
                target: { sourceId: 'history-target', sourceOffset: 'Alpha '.length },
                text: 'runtime '
            }
        }) as any;
        assert.equal(insert?.kind, 'content-only');
        assert.equal(sourceText(ir.elements[1]), 'Alpha runtime range target sentence. Bravo range target sentence.');

        const undoInsert = engine.send('layout.undoRuntimeIntent', {
            elements: ir.elements,
            entry: insert
        }) as any;
        assert.equal(undoInsert?.kind, 'content-only');
        assert.equal(sourceText(ir.elements[1]), 'Alpha range target sentence. Bravo range target sentence.');

        const redoInsert = engine.send('layout.redoRuntimeIntent', {
            elements: ir.elements,
            entry: insert
        }) as any;
        assert.equal(redoInsert?.kind, 'content-only');
        assert.equal(sourceText(ir.elements[1]), 'Alpha runtime range target sentence. Bravo range target sentence.');

        const rangeStart = sourceText(ir.elements[1]).indexOf('range target');
        const rangeEnd = rangeStart + 'range target'.length;
        const format = engine.send('layout.applyRuntimeIntent', {
            elements: ir.elements,
            intent: {
                kind: 'formatting',
                target: { sourceId: 'history-target', sourceStart: rangeStart, sourceEnd: rangeEnd },
                patch: {
                    color: '#0f766e',
                    backgroundColor: '#ccfbf1'
                }
            }
        }) as any;
        assert.equal(format?.kind, 'content-only');
        assert.ok(ir.elements[1].children.some((child: any) => child.content === 'range target'));

        const undoFormat = engine.send('layout.undoRuntimeIntent', {
            elements: ir.elements,
            entry: format
        }) as any;
        assert.equal(undoFormat?.kind, 'content-only');
        assert.equal(typeof ir.elements[1].content, 'string');
        assert.equal(sourceText(ir.elements[1]), 'Alpha runtime range target sentence. Bravo range target sentence.');

        const redoFormat = engine.send('layout.redoRuntimeIntent', {
            elements: ir.elements,
            entry: format
        }) as any;
        assert.equal(redoFormat?.kind, 'content-only');
        assert.ok(
            ir.elements[1].children.some((child: any) =>
                child.content === 'range target'
                && child?.properties?.style?.backgroundColor === '#ccfbf1'
            )
        );

        const split = engine.send('layout.applyRuntimeIntent', {
            elements: ir.elements,
            intent: {
                kind: 'text-edit',
                operation: 'splitParagraph',
                target: { sourceId: 'history-target', sourceOffset: sourceText(ir.elements[1]).indexOf('Bravo') }
            }
        }) as any;
        const splitSourceId = String(split?.history?.edit?.insertedSourceId || '');
        assert.equal(split?.kind, 'geometry');
        assert.equal(sourceText(ir.elements[1]), 'Alpha runtime range target sentence. ');
        assert.equal(sourceText(ir.elements[2]), 'Bravo range target sentence.');

        const undoSplit = engine.send('layout.undoRuntimeIntent', {
            elements: ir.elements,
            entry: split
        }) as any;
        assert.equal(undoSplit?.kind, 'geometry');
        assert.equal(sourceText(ir.elements[1]), 'Alpha runtime range target sentence. Bravo range target sentence.');
        assert.equal(String(ir.elements[2]?.properties?.sourceId || ''), 'history-tail');

        const redoSplit = engine.send('layout.redoRuntimeIntent', {
            elements: ir.elements,
            entry: split
        }) as any;
        assert.equal(redoSplit?.kind, 'geometry');
        assert.equal(String(ir.elements[2]?.properties?.sourceId || ''), splitSourceId);
        assert.equal(sourceText(ir.elements[2]), 'Bravo range target sentence.');
    });

    // Keep the runtime alive through all checks; the local variable makes that
    // explicit for environments with aggressive module cleanup.
    assert.ok(runtime);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
