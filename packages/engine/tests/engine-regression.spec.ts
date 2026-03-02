import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { LayoutEngine } from '../src/engine/layout-engine';
import { Renderer } from '../src/engine/renderer';
import {
    MockContext,
    assertAdvancedLayoutSignals,
    assertAdvancedRenderSignals,
    assertFlatPipelineInvariants,
    loadJsonDocumentFixtures,
    snapshotPages,
    loadLocalFontManager,
} from './harness/engine-harness';
import {
    CURRENT_DOCUMENT_VERSION,
    CURRENT_IR_VERSION,
    resolveDocumentPaths,
    toLayoutConfig,
} from '../src/engine/document';
import { LayoutUtils } from '../src/engine/layout/layout-utils';
import { createEngineRuntime, setDefaultEngineRuntime } from '../src/engine/runtime';

const GOD_FIXTURE_NAME = '00-all-capabilities.json';
const UPDATE_LAYOUT_SNAPSHOTS =
    process.argv.includes('--update-layout-snapshots') || process.env.VMPRINT_UPDATE_LAYOUT_SNAPSHOTS === '1';

function logStep(message: string): void {
    console.log(`[engine-regression.spec] ${message}`);
}

function check(description: string, expected: string, assertion: () => void): void {
    logStep(`CHECK: ${description}`);
    logStep(`EXPECT: ${expected}`);
    assertion();
    logStep(`PASS: ${description}`);
}

async function checkAsync(description: string, expected: string, assertion: () => Promise<void>): Promise<void> {
    logStep(`CHECK: ${description}`);
    logStep(`EXPECT: ${expected}`);
    await assertion();
    logStep(`PASS: ${description}`);
}

function assertNoInputMutation(elements: any[], fixtureName: string): void {
    const visit = (node: any) => {
        assert.equal(node?.properties?._box, undefined, `${fixtureName}: input node mutated with _box`);
        if (Array.isArray(node?.children)) {
            node.children.forEach(visit);
        }
    };
    elements.forEach(visit);
}

function assertTableMixedSpanFixtureSignals(pages: any[], fixtureName: string): void {
    const pageCells = pages.map((page: any) => (page.boxes || []).filter((box: any) => box.type === 'table_cell'));
    const allCells = pageCells.flat();
    assert.ok(allCells.length > 0, `${fixtureName}: expected table_cell output`);
    assert.ok(pages.length >= 2, `${fixtureName}: expected multi-page pagination for mixed-span table`);

    const hasColSpan = allCells.some((cell: any) => Number(cell.properties?._tableColSpan || 1) > 1);
    const hasRowSpan = allCells.some((cell: any) => Number(cell.properties?._tableRowSpan || 1) > 1);
    assert.equal(hasColSpan, true, `${fixtureName}: expected at least one colSpan>1 cell`);
    assert.equal(hasRowSpan, true, `${fixtureName}: expected at least one rowSpan>1 cell`);

    // No row-spanned cell should be split across pages.
    pageCells.forEach((cellsOnPage: any[], pageIndex: number) => {
        const rowsOnPage = new Set<number>(
            cellsOnPage
                .map((cell: any) => Number(cell.properties?._tableRowIndex))
                .filter((value: number) => Number.isFinite(value)),
        );
        cellsOnPage
            .filter((cell: any) => Number(cell.properties?._tableRowSpan || 1) > 1)
            .forEach((cell: any) => {
                const startRow = Number(cell.properties?._tableRowIndex || 0);
                const rowSpan = Number(cell.properties?._tableRowSpan || 1);
                const endRow = startRow + rowSpan - 1;
                assert.ok(
                    rowsOnPage.has(endRow),
                    `${fixtureName}: rowSpan crosses page boundary at page=${pageIndex} row=${startRow}`,
                );
            });
    });

    const rowIndexesByPage = pageCells.map((cellsOnPage) =>
        cellsOnPage
            .map((cell: any) => Number(cell.properties?._tableRowIndex))
            .filter((value: number) => Number.isFinite(value)),
    );
    const pagesWithTable = rowIndexesByPage
        .map((rows, pageIndex) => ({ pageIndex, rows }))
        .filter((entry) => entry.rows.length > 0);
    assert.ok(pagesWithTable.length >= 2, `${fixtureName}: expected table content to span at least two pages`);
    assert.ok(pagesWithTable[0].rows.includes(0), `${fixtureName}: expected header row on first table page`);
    assert.ok(
        pagesWithTable[1].rows.includes(0),
        `${fixtureName}: expected repeated header row on continuation table page`,
    );

    // Fixture-anchored structural checks (rows 1-4 are deterministic in input).
    const row2Col0 = allCells.find(
        (cell: any) => Number(cell.properties?._tableRowIndex) === 2 && Number(cell.properties?._tableColStart) === 0,
    );
    assert.equal(row2Col0, undefined, `${fixtureName}: row=2 col=0 should be covered by rowSpan from row=1`);

    const row4Covered = allCells.find(
        (cell: any) =>
            Number(cell.properties?._tableRowIndex) === 4 &&
            (Number(cell.properties?._tableColStart) === 1 || Number(cell.properties?._tableColStart) === 2),
    );
    assert.equal(row4Covered, undefined, `${fixtureName}: row=4 cols=1..2 should be covered by rowSpan from row=3`);
}

function assertPackagerShatterShowcaseSignals(pages: any[], fixtureName: string): void {
    const matchesSourceId = (box: any, id: string): boolean => {
        const sourceId = String(box.meta?.sourceId || '');
        return sourceId === id || sourceId.endsWith(`:${id}`);
    };
    const withPageIndex = (boxes: any[], pageIndex: number) => boxes.map((box) => ({ box, pageIndex }));

    const keepBoxes = pages.flatMap((page: any, pageIndex: number) =>
        withPageIndex(
            (page.boxes || []).filter((box: any) => matchesSourceId(box, 'keep-split')),
            pageIndex,
        ),
    );
    assert.ok(keepBoxes.length > 0, `${fixtureName}: expected keep-split boxes`);
    const keepFirst = keepBoxes.find((entry) => Number(entry.box.meta?.fragmentIndex || 0) === 0);
    const keepContinuation = keepBoxes.find((entry) => Number(entry.box.meta?.fragmentIndex || 0) > 0);
    assert.ok(keepFirst, `${fixtureName}: expected keep-split fragmentIndex=0`);
    assert.ok(keepContinuation, `${fixtureName}: expected keep-split continuation fragment`);
    assert.ok(
        keepFirst && keepContinuation && keepFirst.pageIndex !== keepContinuation.pageIndex,
        `${fixtureName}: keep-split should span multiple pages`,
    );

    const leadBoxes = pages.flatMap((page: any, pageIndex: number) =>
        withPageIndex(
            (page.boxes || []).filter((box: any) => matchesSourceId(box, 'keep-lead')),
            pageIndex,
        ),
    );
    assert.ok(leadBoxes.length > 0, `${fixtureName}: expected keep-lead box`);
    const leadPage = leadBoxes[0]?.pageIndex;
    assert.equal(
        leadPage,
        keepFirst?.pageIndex,
        `${fixtureName}: keep-lead should remain with keep-split fragmentIndex=0`,
    );
    assert.ok(
        keepContinuation && leadBoxes.every((entry) => entry.pageIndex !== keepContinuation.pageIndex),
        `${fixtureName}: keep-lead should not appear on continuation page`,
    );

    const tablePages = pages
        .map((page: any, pageIndex: number) => ({
            pageIndex,
            tableBoxes: (page.boxes || []).filter((box: any) => matchesSourceId(box, 'table-split')),
        }))
        .filter((entry) => entry.tableBoxes.length > 0);
    assert.ok(tablePages.length >= 2, `${fixtureName}: expected table to paginate across pages`);
    const firstTablePage = tablePages[0];
    const minTableY = Math.min(...firstTablePage.tableBoxes.map((box: any) => Number(box.y || 0)));
    const hasContentBeforeTable = (pages[firstTablePage.pageIndex]?.boxes || []).some(
        (box: any) => box.type !== 'table_cell' && Number(box.y || 0) < minTableY - 0.1,
    );
    assert.ok(hasContentBeforeTable, `${fixtureName}: expected table to start mid-page after other content`);

    const topBoxes = pages.flatMap((page: any, pageIndex: number) =>
        withPageIndex(
            (page.boxes || []).filter((box: any) => matchesSourceId(box, 'page-top-split')),
            pageIndex,
        ),
    );
    assert.ok(topBoxes.length > 0, `${fixtureName}: expected page-top-split boxes`);
    const topFirst = topBoxes.find((entry) => Number(entry.box.meta?.fragmentIndex || 0) === 0);
    const topContinuation = topBoxes.find((entry) => Number(entry.box.meta?.fragmentIndex || 0) > 0);
    assert.ok(topFirst, `${fixtureName}: expected page-top-split fragmentIndex=0`);
    assert.ok(topContinuation, `${fixtureName}: expected page-top-split continuation fragment`);
    const topPageBoxes = pages[topFirst?.pageIndex || 0]?.boxes || [];
    const minY = Math.min(...topPageBoxes.map((box: any) => Number(box.y || 0)));
    assert.ok(
        topFirst && Math.abs(Number(topFirst.box.y || 0) - minY) < 0.2,
        `${fixtureName}: expected page-top-split to start at top of its page`,
    );
}

function assertStoryPackagerShowcaseSignals(pages: any[], fixtureName: string): void {
    // Must produce multiple pages (story is long enough to paginate).
    assert.ok(pages.length >= 2, `${fixtureName}: expected at least two pages`);

    const allBoxes = pages.flatMap((page: any) => page.boxes || []);

    // Story must emit image boxes.
    const imageBoxes = allBoxes.filter((box: any) => !!box.image);
    assert.ok(imageBoxes.length >= 6, `${fixtureName}: expected at least 6 image boxes (one per layout mode)`);

    // Text boxes with per-line layout data must be present (resolver fired).
    const wrappedTextBoxes = allBoxes.filter((box: any) => {
        const lw = box.properties?._lineWidths;
        if (!Array.isArray(lw) || lw.length < 2) return false;
        const min = Math.min(...lw);
        const max = Math.max(...lw);
        // At least one box must have lines of visibly different widths.
        return max - min > 4;
    });
    assert.ok(
        wrappedTextBoxes.length > 0,
        `${fixtureName}: expected text boxes with non-uniform _lineWidths (wrap-around resolver result)`,
    );

    // Images must appear on the first page (the story starts with a story-absolute image).
    const page0Images = (pages[0]?.boxes || []).filter((box: any) => !!box.image);
    assert.ok(page0Images.length > 0, `${fixtureName}: expected image boxes on page 1`);

    // Optical underhang: the amber float paragraph should finish with a full-width line
    // once the line top clears the obstacle bottom (storyWrapOpticalUnderhang).
    const amberTextBox = allBoxes.find((box: any) =>
        (box.lines || []).some((line: any[]) =>
            line.some((seg: any) => String(seg.text || '').includes('An amber square occupies the left margin here')),
        ),
    );
    assert.ok(amberTextBox, `${fixtureName}: expected amber float paragraph box`);
    if (amberTextBox) {
        const offsets: number[] = Array.isArray(amberTextBox.properties?._lineOffsets)
            ? amberTextBox.properties._lineOffsets.map((n: any) => Number(n))
            : [];
        const widths: number[] = Array.isArray(amberTextBox.properties?._lineWidths)
            ? amberTextBox.properties._lineWidths.map((n: any) => Number(n))
            : [];
        const hasWrappedLine = offsets.some((val) => Number.isFinite(val) && val > 0.1);
        const hasFullWidthLine = offsets.some(
            (val, idx) => Number.isFinite(val) && Math.abs(val) <= 0.1 && Number(widths[idx] || 0) > 0,
        );
        assert.ok(hasWrappedLine, `${fixtureName}: expected amber paragraph to include wrapped (offset) lines`);
        assert.ok(
            hasFullWidthLine,
            `${fixtureName}: expected amber paragraph to include a full-width line after underhang`,
        );
    }
}

function assertDropCapPaginationSignals(pages: any[], fixtureName: string): void {
    if (fixtureName !== '08-dropcap-pagination.json') return;

    const matchesSourceId = (box: any, id: string): boolean => {
        const sourceId = String(box.meta?.sourceId || '');
        return sourceId === id || sourceId.endsWith(`:${id}`);
    };

    const dropcapBoxes = pages.flatMap((page: any, pageIndex: number) =>
        (page.boxes || []).filter((box: any) => box.type === 'dropcap').map((box: any) => ({ box, pageIndex })),
    );
    assert.ok(dropcapBoxes.length >= 2, `${fixtureName}: expected dropcap boxes`);

    const basicParagraphBoxes = pages.flatMap((page: any, pageIndex: number) =>
        (page.boxes || [])
            .filter((box: any) => matchesSourceId(box, 'dropcap-basic'))
            .map((box: any) => ({ box, pageIndex })),
    );
    const basicDropcap = dropcapBoxes.find((entry) => String(entry.box.meta?.sourceId || '').includes('dropcap-basic'));
    assert.ok(basicDropcap, `${fixtureName}: expected dropcap-basic dropcap box`);
    const basicFragments = basicParagraphBoxes.filter((entry) => entry.box.type !== 'dropcap');
    const hasContinuation = basicFragments.some((entry) => Number(entry.box.meta?.fragmentIndex || 0) > 0);
    assert.ok(hasContinuation, `${fixtureName}: expected dropcap-basic continuation fragment`);

    const continuationPages = new Set(
        basicFragments
            .filter((entry) => Number(entry.box.meta?.fragmentIndex || 0) > 0)
            .map((entry) => entry.pageIndex),
    );
    const dropcapPages = new Set(
        dropcapBoxes
            .filter((entry) => String(entry.box.meta?.sourceId || '').includes('dropcap-basic'))
            .map((entry) => entry.pageIndex),
    );
    const firstDropcapPage = dropcapBoxes
        .filter((entry) => String(entry.box.meta?.sourceId || '').includes('dropcap-basic'))
        .map((entry) => entry.pageIndex)
        .sort((a, b) => a - b)[0];
    continuationPages.forEach((pageIndex) => {
        if (pageIndex === firstDropcapPage) return;
        assert.equal(
            dropcapPages.has(pageIndex),
            false,
            `${fixtureName}: dropcap should not repeat on continuation page`,
        );
    });

    const moveWholeDropcap = dropcapBoxes.find((entry) =>
        String(entry.box.meta?.sourceId || '').includes('dropcap-move-whole'),
    );
    assert.ok(moveWholeDropcap, `${fixtureName}: expected dropcap-move-whole dropcap box`);
}

function resolveSnapshotPath(fixturePath: string): string {
    const ext = path.extname(fixturePath);
    return fixturePath.slice(0, fixturePath.length - ext.length) + '.snapshot.layout.json';
}

function assertGodSnapshot(fixtureName: string, fixturePath: string, pages: any[]): void {
    if (fixtureName !== GOD_FIXTURE_NAME) return;

    const snapshotPath = resolveSnapshotPath(fixturePath);
    const actual = snapshotPages(pages);

    if (!fs.existsSync(snapshotPath)) {
        if (!UPDATE_LAYOUT_SNAPSHOTS) {
            throw new Error(
                `${fixtureName}: snapshot missing at ${snapshotPath}. Re-run tests with --update-layout-snapshots or set VMPRINT_UPDATE_LAYOUT_SNAPSHOTS=1.`,
            );
        }
        fs.writeFileSync(snapshotPath, JSON.stringify(actual, null, 2) + '\n', 'utf-8');
        return;
    }

    if (UPDATE_LAYOUT_SNAPSHOTS) {
        fs.writeFileSync(snapshotPath, JSON.stringify(actual, null, 2) + '\n', 'utf-8');
        return;
    }

    const expectedRaw = fs.readFileSync(snapshotPath, 'utf-8');
    const expected = JSON.parse(expectedRaw);
    assert.deepEqual(actual, expected, `${fixtureName}: layout snapshot mismatch (${snapshotPath})`);
}

async function run() {
    const LocalFontManager = await loadLocalFontManager();
    setDefaultEngineRuntime(createEngineRuntime({ fontManager: new LocalFontManager() }));

    logStep('Scenario: fixture-driven deterministic pagination and renderer regression checks');
    const fixtures = loadJsonDocumentFixtures();
    check('fixture discovery', 'at least one JSON fixture is present in src/tests/fixtures/regression', () => {
        assert.ok(fixtures.length > 0, 'no JSON fixtures found in src/tests/fixtures/regression');
    });

    for (const fixture of fixtures) {
        logStep(`Fixture: ${fixture.name}`);
        const fixturePath = fixture.filePath;
        const fixtureRaw = fs.readFileSync(fixturePath, 'utf-8');
        const irA = resolveDocumentPaths(JSON.parse(fixtureRaw), fixturePath);
        const irB = resolveDocumentPaths(JSON.parse(fixtureRaw), fixturePath);

        check(
            `${fixture.name} canonical IR determinism`,
            're-loading the same fixture yields byte-equivalent canonical IR',
            () => {
                assert.equal(
                    irA.documentVersion,
                    CURRENT_DOCUMENT_VERSION,
                    `${fixture.name}: unexpected documentVersion`,
                );
                assert.equal(irA.irVersion, CURRENT_IR_VERSION, `${fixture.name}: unexpected irVersion`);
                assert.deepEqual(irA, irB, `${fixture.name}: canonical IR drift between repeated loads`);
            },
        );

        const config = toLayoutConfig(fixture.document, false);
        const engine = new LayoutEngine(config);
        await engine.waitForFonts();

        const elements = fixture.document.elements;
        const pagesA = engine.paginate(elements);
        const pagesB = engine.paginate(elements);

        check(
            `${fixture.name} flat pipeline invariants`,
            'finite geometry, measured lines fit, and no nested children in boxes',
            () => {
                assertFlatPipelineInvariants(pagesA, fixture.name);
            },
        );
        check(
            `${fixture.name} deterministic pagination`,
            'two paginate runs with same input produce identical snapshots',
            () => {
                assert.deepEqual(
                    snapshotPages(pagesA),
                    snapshotPages(pagesB),
                    `${fixture.name}: layout is not deterministic between runs`,
                );
            },
        );
        check(
            `${fixture.name} layout snapshot`,
            fixture.name === GOD_FIXTURE_NAME
                ? 'matches stored snapshot for god fixture'
                : 'skipped for non-god fixtures',
            () => {
                assertGodSnapshot(fixture.name, fixturePath, pagesA);
            },
        );
        if (fixture.name.startsWith('05-page-size-') || fixture.name.startsWith('06-page-size-')) {
            check(
                `${fixture.name} orientation/page-size dimensions`,
                'all paginated pages use dimensions resolved from pageSize + orientation',
                () => {
                    const expected = LayoutUtils.getPageDimensions(config);
                    pagesA.forEach((page, idx) => {
                        assert.equal(page.width, expected.width, `${fixture.name}: page=${idx} width mismatch`);
                        assert.equal(page.height, expected.height, `${fixture.name}: page=${idx} height mismatch`);
                    });
                },
            );
        }
        if (fixture.name === '02-text-layout-advanced.json') {
            check(
                `${fixture.name} advanced layout signals`,
                'advanced fixtures emit expected justification and soft-hyphen layout markers',
                () => {
                    assertAdvancedLayoutSignals(pagesA, fixture.name);
                },
            );
        }
        if (fixture.name === '14-flow-images-multipage.json') {
            check(
                `${fixture.name} flow-image pagination coverage`,
                'flow-image comic fixture spans multiple pages and retains all three image boxes',
                () => {
                    assert.ok(pagesA.length >= 2, `${fixture.name}: expected at least two pages`);
                    const imageCount = pagesA
                        .flatMap((page) => page.boxes)
                        .filter((box) => box.type === 'image').length;
                    assert.equal(imageCount, 3, `${fixture.name}: expected exactly three flow image boxes`);
                },
            );
        }
        if (fixture.name === '13-inline-rich-objects.json') {
            check(
                `${fixture.name} inline rich-object pagination coverage`,
                'inline object fixture spans multiple pages and includes inline-object segments on later pages',
                () => {
                    assert.ok(pagesA.length >= 2, `${fixture.name}: expected at least two pages`);
                    const pagesWithInlineSegments = pagesA
                        .map((page, pageIndex) => ({
                            pageIndex,
                            hasInline: page.boxes.some((box) =>
                                (box.lines || []).some((line) => line.some((seg: any) => !!seg.inlineObject)),
                            ),
                        }))
                        .filter((entry) => entry.hasInline)
                        .map((entry) => entry.pageIndex);
                    assert.ok(
                        pagesWithInlineSegments.length > 0,
                        `${fixture.name}: expected inline segments in output`,
                    );
                    assert.ok(
                        pagesWithInlineSegments.some((idx) => idx > 0),
                        `${fixture.name}: expected inline segments on at least one continuation page`,
                    );
                },
            );
        }
        if (fixture.name === '12-inline-baseline-alignment.json') {
            check(
                `${fixture.name} inline baseline controls coverage`,
                'fixture emits inline metrics for all verticalAlign variants and inline margin metadata',
                () => {
                    const inlineSegments = pagesA
                        .flatMap((page) => page.boxes)
                        .flatMap((box) => box.lines || [])
                        .flatMap((line) => line)
                        .filter((seg: any) => !!seg.inlineObject && !!seg.inlineMetrics);
                    assert.ok(inlineSegments.length > 0, `${fixture.name}: expected inline segments with metrics`);

                    const aligns = new Set<string>(
                        inlineSegments.map((seg: any) => String(seg.inlineMetrics.verticalAlign || '')),
                    );
                    ['baseline', 'middle', 'text-top', 'text-bottom', 'bottom'].forEach((mode) => {
                        assert.ok(aligns.has(mode), `${fixture.name}: missing verticalAlign=${mode}`);
                    });

                    const hasBaselineShiftMetric = inlineSegments.every((seg: any) =>
                        Number.isFinite(Number(seg.inlineMetrics.baselineShift ?? 0)),
                    );
                    assert.ok(hasBaselineShiftMetric, `${fixture.name}: expected numeric baselineShift metrics`);

                    const hasMargins = inlineSegments.some(
                        (seg: any) =>
                            Number(seg.inlineMetrics.marginLeft || 0) > 0 ||
                            Number(seg.inlineMetrics.marginRight || 0) > 0,
                    );
                    assert.ok(hasMargins, `${fixture.name}: expected inline margin usage`);

                    const widthIncludesMargin = inlineSegments.some(
                        (seg: any) => Number(seg.width || 0) > Number(seg.inlineMetrics.contentWidth || 0),
                    );
                    assert.ok(widthIncludesMargin, `${fixture.name}: expected total width to include inline margins`);

                    const hasOpticalInsetMetrics = inlineSegments.some(
                        (seg: any) =>
                            seg.inlineObject?.kind === 'image' &&
                            seg.inlineMetrics.opticalInsetTop !== undefined &&
                            seg.inlineMetrics.opticalInsetBottom !== undefined,
                    );
                    assert.ok(
                        hasOpticalInsetMetrics,
                        `${fixture.name}: expected inline image optical inset metrics to be populated`,
                    );
                },
            );
        }
        if (fixture.name === '09-tables-spans-pagination.json') {
            check(
                `${fixture.name} mixed-span table signals`,
                'colSpan + rowSpan cells paginate deterministically with repeated headers and no span boundary splits',
                () => {
                    assertTableMixedSpanFixtureSignals(pagesA, fixture.name);
                },
            );
        }
        if (fixture.name === '10-packager-split-scenarios.json') {
            check(
                `${fixture.name} packager split scenarios`,
                'keepWithNext, mid-page table, and page-top overflow splits are all exercised',
                () => {
                    assertPackagerShatterShowcaseSignals(pagesA, fixture.name);
                },
            );
        }
        if (fixture.name === '08-dropcap-pagination.json') {
            check(
                `${fixture.name} dropcap pagination`,
                'dropcap stays on first fragment and continuation splits correctly',
                () => {
                    assertDropCapPaginationSignals(pagesA, fixture.name);
                },
            );
        }
        if (fixture.name === '11-story-image-floats.json') {
            check(
                `${fixture.name} story layout signals`,
                'multi-page story with image floats, story-absolute, and non-uniform line widths',
                () => {
                    assertStoryPackagerShowcaseSignals(pagesA, fixture.name);
                },
            );
        }
        check(`${fixture.name} input immutability`, 'input elements are unchanged after pagination', () => {
            assertNoInputMutation(elements, fixture.name);
        });

        const { width: pageWidth, height: pageHeight } = LayoutUtils.getPageDimensions(config);
        const context = new MockContext(pageWidth, pageHeight);
        const renderer = new Renderer(config, false, engine.getRuntime());
        await renderer.render(pagesA, context);
        check(`${fixture.name} renderer integration`, 'renderer consumes all pages and emits text draw calls', () => {
            assert.equal(context.pagesAdded, pagesA.length, `${fixture.name}: renderer/page count mismatch`);
            assert.ok(context.textCalls > 0, `${fixture.name}: renderer emitted no text draw calls`);
            if (fixture.name === '13-inline-rich-objects.json') {
                assert.ok(
                    context.imageCalls > 0,
                    `${fixture.name}: expected renderer image draw calls for inline images`,
                );
            }
            if (fixture.name === '11-story-image-floats.json') {
                assert.ok(
                    context.imageCalls >= 6,
                    `${fixture.name}: expected renderer image draw calls for all story images`,
                );
            }
            if (fixture.name === '12-inline-baseline-alignment.json') {
                assert.ok(
                    context.imageCalls > 0,
                    `${fixture.name}: expected renderer image draw calls for inline images`,
                );
                const hotBadgeDraws = context.imageTrace.filter(
                    (call) => call.width >= 70 && call.width <= 82 && call.height >= 22 && call.height <= 30,
                );
                assert.ok(hotBadgeDraws.length >= 2, `${fixture.name}: expected at least two HOT badge draws`);

                // Variant 1 (baseline) and Variant 2 (middle) are emitted in-order.
                // Their badge Y positions must differ when verticalAlign/baselineShift differ.
                const variant1HotY = hotBadgeDraws[0].y;
                const variant2HotY = hotBadgeDraws[1].y;
                assert.ok(
                    Math.abs(variant1HotY - variant2HotY) > 0.1,
                    `${fixture.name}: expected Variant 1/2 HOT badge Y positions to differ`,
                );
            }
        });
        if (fixture.name === '02-text-layout-advanced.json') {
            check(
                `${fixture.name} advanced render signals`,
                'advanced fixtures exhibit expected rtl drawing progression',
                () => {
                    assertAdvancedRenderSignals(context.textTrace, fixture.name);
                },
            );
        }
    }

    console.log(`[engine-regression.spec] OK (${fixtures.length} fixtures)`);
}

run().catch((err) => {
    console.error('[engine-regression.spec] FAILED', err);
    process.exit(1);
});
