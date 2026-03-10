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
    loadLocalFontManager
} from './harness/engine-harness';
import { CURRENT_DOCUMENT_VERSION, CURRENT_IR_VERSION, resolveDocumentPaths, toLayoutConfig } from '../src/engine/document';
import { LayoutUtils } from '../src/engine/layout/layout-utils';
import {
    simulationArtifactKeys
} from '../src/engine/layout/simulation-report';
import { createEngineRuntime, setDefaultEngineRuntime } from '../src/engine/runtime';

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
                .filter((value: number) => Number.isFinite(value))
        );
        cellsOnPage
            .filter((cell: any) => Number(cell.properties?._tableRowSpan || 1) > 1)
            .forEach((cell: any) => {
                const startRow = Number(cell.properties?._tableRowIndex || 0);
                const rowSpan = Number(cell.properties?._tableRowSpan || 1);
                const endRow = startRow + rowSpan - 1;
                assert.ok(rowsOnPage.has(endRow), `${fixtureName}: rowSpan crosses page boundary at page=${pageIndex} row=${startRow}`);
            });
    });

    const rowIndexesByPage = pageCells.map((cellsOnPage) =>
        cellsOnPage
            .map((cell: any) => Number(cell.properties?._tableRowIndex))
            .filter((value: number) => Number.isFinite(value))
    );
    const pagesWithTable = rowIndexesByPage
        .map((rows, pageIndex) => ({ pageIndex, rows }))
        .filter((entry) => entry.rows.length > 0);
    assert.ok(pagesWithTable.length >= 2, `${fixtureName}: expected table content to span at least two pages`);
    assert.ok(pagesWithTable[0].rows.includes(0), `${fixtureName}: expected header row on first table page`);
    assert.ok(pagesWithTable[1].rows.includes(0), `${fixtureName}: expected repeated header row on continuation table page`);

    // Fixture-anchored structural checks (rows 1-4 are deterministic in input).
    const row2Col0 = allCells.find((cell: any) =>
        Number(cell.properties?._tableRowIndex) === 2 && Number(cell.properties?._tableColStart) === 0
    );
    assert.equal(row2Col0, undefined, `${fixtureName}: row=2 col=0 should be covered by rowSpan from row=1`);

    const row4Covered = allCells.find((cell: any) =>
        Number(cell.properties?._tableRowIndex) === 4
        && (Number(cell.properties?._tableColStart) === 1 || Number(cell.properties?._tableColStart) === 2)
    );
    assert.equal(row4Covered, undefined, `${fixtureName}: row=4 cols=1..2 should be covered by rowSpan from row=3`);
}

function assertPackagerShatterShowcaseSignals(pages: any[], fixtureName: string): void {
    const matchesSourceId = (box: any, id: string): boolean => {
        const sourceId = String(box.meta?.sourceId || '');
        return sourceId === id || sourceId.endsWith(`:${id}`);
    };
    const withPageIndex = (boxes: any[], pageIndex: number) =>
        boxes.map((box) => ({ box, pageIndex }));

    const keepBoxes = pages.flatMap((page: any, pageIndex: number) =>
        withPageIndex((page.boxes || []).filter((box: any) => matchesSourceId(box, 'keep-split')), pageIndex)
    );
    assert.ok(keepBoxes.length > 0, `${fixtureName}: expected keep-split boxes`);
    const keepFirst = keepBoxes.find((entry) => Number(entry.box.meta?.fragmentIndex || 0) === 0);
    const keepContinuation = keepBoxes.find((entry) => Number(entry.box.meta?.fragmentIndex || 0) > 0);
    assert.ok(keepFirst, `${fixtureName}: expected keep-split fragmentIndex=0`);
    assert.ok(keepContinuation, `${fixtureName}: expected keep-split continuation fragment`);
    assert.ok(
        keepFirst && keepContinuation && keepFirst.pageIndex !== keepContinuation.pageIndex,
        `${fixtureName}: keep-split should span multiple pages`
    );

    const leadBoxes = pages.flatMap((page: any, pageIndex: number) =>
        withPageIndex((page.boxes || []).filter((box: any) => matchesSourceId(box, 'keep-lead')), pageIndex)
    );
    assert.ok(leadBoxes.length > 0, `${fixtureName}: expected keep-lead box`);
    const leadPage = leadBoxes[0]?.pageIndex;
    assert.equal(
        leadPage,
        keepFirst?.pageIndex,
        `${fixtureName}: keep-lead should remain with keep-split fragmentIndex=0`
    );
    assert.ok(
        keepContinuation && leadBoxes.every((entry) => entry.pageIndex !== keepContinuation.pageIndex),
        `${fixtureName}: keep-lead should not appear on continuation page`
    );

    const tablePages = pages
        .map((page: any, pageIndex: number) => ({
            pageIndex,
            tableBoxes: (page.boxes || []).filter((box: any) => matchesSourceId(box, 'table-split'))
        }))
        .filter((entry) => entry.tableBoxes.length > 0);
    assert.ok(tablePages.length >= 2, `${fixtureName}: expected table to paginate across pages`);
    const firstTablePage = tablePages[0];
    const minTableY = Math.min(...firstTablePage.tableBoxes.map((box: any) => Number(box.y || 0)));
    const hasContentBeforeTable = (pages[firstTablePage.pageIndex]?.boxes || []).some((box: any) =>
        box.type !== 'table_cell' && Number(box.y || 0) < (minTableY - 0.1)
    );
    assert.ok(hasContentBeforeTable, `${fixtureName}: expected table to start mid-page after other content`);

    const topBoxes = pages.flatMap((page: any, pageIndex: number) =>
        withPageIndex((page.boxes || []).filter((box: any) => matchesSourceId(box, 'page-top-split')), pageIndex)
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
        `${fixtureName}: expected page-top-split to start at top of its page`
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
        `${fixtureName}: expected text boxes with non-uniform _lineWidths (wrap-around resolver result)`
    );

    // Images must appear on the first page (the story starts with a story-absolute image).
    const page0Images = (pages[0]?.boxes || []).filter((box: any) => !!box.image);
    assert.ok(page0Images.length > 0, `${fixtureName}: expected image boxes on page 1`);

    // Optical underhang: the amber float paragraph should finish with a full-width line
    // once the line top clears the obstacle bottom (storyWrapOpticalUnderhang).
    const amberTextBox = allBoxes.find((box: any) =>
        (box.lines || []).some((line: any[]) =>
            line.some((seg: any) => String(seg.text || '').includes('An amber square occupies the left margin here'))
        )
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
        const hasFullWidthLine = offsets.some((val, idx) =>
            Number.isFinite(val) &&
            Math.abs(val) <= 0.1 &&
            Number(widths[idx] || 0) > 0
        );
        assert.ok(hasWrappedLine, `${fixtureName}: expected amber paragraph to include wrapped (offset) lines`);
        assert.ok(hasFullWidthLine, `${fixtureName}: expected amber paragraph to include a full-width line after underhang`);
    }
}

function assertStoryMultiColumnSignals(pages: any[], fixtureName: string): void {
    if (fixtureName !== '15-story-multi-column.json') return;
    assert.ok(pages.length >= 3, `${fixtureName}: expected at least three pages for 2-col intro + 3-col continuation`);

    const byPrefix = (prefix: string) =>
        pages.flatMap((page: any, pageIndex: number) =>
            (page.boxes || [])
                .filter((box: any) => String(box.meta?.sourceId || '').includes(prefix))
                .map((box: any) => ({ box, pageIndex }))
        );

    const mc2 = byPrefix('mc2-').filter((entry: any) => Array.isArray(entry.box.lines) && entry.box.lines.length > 0);
    const mc3 = byPrefix('mc3-').filter((entry: any) => Array.isArray(entry.box.lines) && entry.box.lines.length > 0);
    assert.ok(mc2.length > 0, `${fixtureName}: expected text boxes from two-column story`);
    assert.ok(mc3.length > 0, `${fixtureName}: expected text boxes from three-column continuation story`);

    const page0Mc2 = mc2.filter((entry: any) => entry.pageIndex === 0).map((entry: any) => entry.box);
    assert.ok(page0Mc2.length > 0, `${fixtureName}: expected two-column story text on page 1`);
    const mc2X = Array.from(new Set(page0Mc2.map((box: any) => Number(box.x || 0).toFixed(2))));
    assert.ok(mc2X.length >= 2, `${fixtureName}: expected at least two distinct X anchors for two-column page`);

    const firstMc3Page = Math.min(...mc3.map((entry: any) => entry.pageIndex));
    assert.ok(firstMc3Page >= 1, `${fixtureName}: expected three-column story to start on page 2+`);
    const firstMc3Boxes = mc3.filter((entry: any) => entry.pageIndex === firstMc3Page).map((entry: any) => entry.box);
    const mc3X = Array.from(new Set(firstMc3Boxes.map((box: any) => Number(box.x || 0).toFixed(2))));
    assert.ok(mc3X.length >= 3, `${fixtureName}: expected at least three distinct X anchors on first three-column page`);

    const mc3Pages = new Set(mc3.map((entry: any) => entry.pageIndex));
    assert.ok(mc3Pages.size >= 1, `${fixtureName}: expected three-column continuation content to render on continuation pages`);

    const imageObstacleCount = byPrefix('mc3-obstacle-').length + byPrefix('mc2-obstacle-').length;
    assert.ok(imageObstacleCount >= 3, `${fixtureName}: expected multiple obstacle boxes in column stories`);

    const wrappedVariance = mc3.some((entry: any) => {
        const widths = entry.box.properties?._lineWidths;
        if (!Array.isArray(widths) || widths.length < 2) return false;
        const nums = widths.map((n: any) => Number(n)).filter((n: number) => Number.isFinite(n));
        if (nums.length < 2) return false;
        return (Math.max(...nums) - Math.min(...nums)) > 6;
    });
    assert.equal(wrappedVariance, true, `${fixtureName}: expected visible line-width variance from obstacle wrapping`);

    const textCorpus = pages
        .flatMap((page: any) => page.boxes || [])
        .flatMap((box: any) => box.lines || [])
        .flatMap((line: any[]) => line.map((seg: any) => String(seg.text || '')))
        .join(' ');
    const hasSpanish = /equipo editorial/i.test(textCorpus);
    const hasFrench = /rubrique de service/i.test(textCorpus);
    assert.equal(hasSpanish, true, `${fixtureName}: expected Spanish-language content in layout output`);
    assert.equal(hasFrench, true, `${fixtureName}: expected French-language content in layout output`);
}

function assertDropCapPaginationSignals(pages: any[], fixtureName: string): void {
    if (fixtureName !== '08-dropcap-pagination.json') return;

    const matchesSourceId = (box: any, id: string): boolean => {
        const sourceId = String(box.meta?.sourceId || '');
        return sourceId === id || sourceId.endsWith(`:${id}`);
    };

    const dropcapBoxes = pages.flatMap((page: any, pageIndex: number) =>
        (page.boxes || [])
            .filter((box: any) => box.type === 'dropcap')
            .map((box: any) => ({ box, pageIndex }))
    );
    assert.ok(dropcapBoxes.length >= 2, `${fixtureName}: expected dropcap boxes`);

    const basicParagraphBoxes = pages.flatMap((page: any, pageIndex: number) =>
        (page.boxes || [])
            .filter((box: any) => matchesSourceId(box, 'dropcap-basic'))
            .map((box: any) => ({ box, pageIndex }))
    );
    const basicDropcap = dropcapBoxes.find((entry) =>
        String(entry.box.meta?.sourceId || '').includes('dropcap-basic')
    );
    assert.ok(basicDropcap, `${fixtureName}: expected dropcap-basic dropcap box`);
    const basicFragments = basicParagraphBoxes.filter((entry) => entry.box.type !== 'dropcap');
    const hasContinuation = basicFragments.some((entry) => Number(entry.box.meta?.fragmentIndex || 0) > 0);
    assert.ok(hasContinuation, `${fixtureName}: expected dropcap-basic continuation fragment`);

    const continuationPages = new Set(
        basicFragments
            .filter((entry) => Number(entry.box.meta?.fragmentIndex || 0) > 0)
            .map((entry) => entry.pageIndex)
    );
    const dropcapPages = new Set(
        dropcapBoxes
            .filter((entry) => String(entry.box.meta?.sourceId || '').includes('dropcap-basic'))
            .map((entry) => entry.pageIndex)
    );
    const firstDropcapPage = dropcapBoxes
        .filter((entry) => String(entry.box.meta?.sourceId || '').includes('dropcap-basic'))
        .map((entry) => entry.pageIndex)
        .sort((a, b) => a - b)[0];
    continuationPages.forEach((pageIndex) => {
        if (pageIndex === firstDropcapPage) return;
        assert.equal(dropcapPages.has(pageIndex), false, `${fixtureName}: dropcap should not repeat on continuation page`);
    });

    const moveWholeDropcap = dropcapBoxes.find((entry) =>
        String(entry.box.meta?.sourceId || '').includes('dropcap-move-whole')
    );
    assert.ok(moveWholeDropcap, `${fixtureName}: expected dropcap-move-whole dropcap box`);
}

function assertHeaderFooterTestSignals(pages: any[], fixtureName: string): void {
    if (fixtureName !== '17-header-footer-test.json') return;

    const textOf = (box: any): string =>
        Array.isArray(box?.lines) && Array.isArray(box.lines[0])
            ? box.lines[0].map((seg: any) => String(seg.text || '')).join('')
            : String(box?.content || '');

    assert.equal(pages.length, 11, `${fixtureName}: expected exactly eleven pages`);

    const headerBoxes = pages.map((page: any) =>
        (page.boxes || []).filter((box: any) => box.meta?.sourceType === 'header')
    );
    const footerBoxes = pages.map((page: any) =>
        (page.boxes || []).filter((box: any) => box.meta?.sourceType === 'footer')
    );

    // Page 1 (index 0): firstPage:null suppresses both regions
    assert.equal(headerBoxes[0].length, 0, `${fixtureName}: page 1 should suppress header (firstPage:null)`);
    assert.equal(footerBoxes[0].length, 0, `${fixtureName}: page 1 should suppress footer (firstPage:null)`);

    // Pages 2 and 4 (index 1, 3, even): verso running head
    [1, 3].forEach((pi) => {
        const verso = headerBoxes[pi].find((box: any) => box.type === 'rh-even');
        assert.ok(verso, `${fixtureName}: expected rh-even header on page ${pi + 1}`);
        assert.ok(textOf(verso).includes('Study'), `${fixtureName}: verso header text mismatch on page ${pi + 1}`);
    });

    // Pages 3 and 5 (index 2, 4, odd): recto running head (chapter I)
    [2, 4].forEach((pi) => {
        const recto = headerBoxes[pi].find((box: any) => box.type === 'rh-odd');
        assert.ok(recto, `${fixtureName}: expected rh-odd header on page ${pi + 1}`);
        assert.ok(textOf(recto).includes('Problem'), `${fixtureName}: recto header should show chapter-I title on page ${pi + 1}`);
    });

    // Page 6 (index 5): Part Two divider — pageOverrides {header:null, footer:null}
    assert.equal(headerBoxes[5].length, 0, `${fixtureName}: Part Two page should suppress header`);
    assert.equal(footerBoxes[5].length, 0, `${fixtureName}: Part Two page should suppress footer`);

    // Page 7 (index 6, odd): chapter-II title override replaces recto running head
    const overrideChII = headerBoxes[6].find((box: any) => box.type === 'rh-odd');
    assert.ok(overrideChII, `${fixtureName}: expected rh-odd override on page 7`);
    assert.ok(textOf(overrideChII).includes('II'), `${fixtureName}: header override should contain chapter-II text on page 7`);
    assert.ok(!textOf(overrideChII).includes('Problem'), `${fixtureName}: header override should not contain chapter-I text on page 7`);

    // Page 10 (index 9, even): Epilogue pageOverrides — rh-override with physicalPageNumber token
    const epilogue10 = headerBoxes[9].find((box: any) => box.type === 'rh-override');
    assert.ok(epilogue10, `${fixtureName}: expected rh-override on page 10 (Epilogue)`);
    assert.ok(textOf(epilogue10).includes('Epilogue'), `${fixtureName}: epilogue header should include "Epilogue"`);
    assert.ok(textOf(epilogue10).includes('10'), `${fixtureName}: epilogue header should resolve physicalPageNumber to "10"`);

    // Page 11 (index 10, odd): footer suppressed via pageOverrides.footer:null
    assert.equal(footerBoxes[10].length, 0, `${fixtureName}: page 11 should suppress footer (pageOverrides.footer:null)`);

    // Footer uses a three-column folio table (work title | folio number | section title).
    // Verify the table structure is present and the center cell resolves the logical number.
    const folioPageIndices = [1, 2, 3, 4, 6, 7, 8, 9];
    const expectedNumbers = ['1', '2', '3', '4', '5', '6', '7', '8'];
    folioPageIndices.forEach((pi, i) => {
        const folioCells = footerBoxes[pi].filter((box: any) => box.type === 'table_cell');
        assert.equal(folioCells.length, 3, `${fixtureName}: expected three table_cell boxes on page ${pi + 1}`);
        const centerCell = folioCells[1];
        assert.equal(
            textOf(centerCell),
            expectedNumbers[i],
            `${fixtureName}: expected logical number "${expectedNumbers[i]}" in center folio cell on page ${pi + 1}`
        );
    });
}

function buildExperimentalReservationConfig() {
    return {
        layout: {
            pageSize: { width: 320, height: 220 },
            margins: { top: 20, right: 20, bottom: 20, left: 20 },
            fontFamily: 'Arimo',
            fontSize: 12,
            lineHeight: 1.2
        },
        fonts: {
            regular: 'Arimo'
        },
        styles: {
            p: { marginBottom: 8, allowLineSplit: true, orphans: 2, widows: 2 }
        }
    } as const;
}

function assertSimulationReportSignals(engine: any, pages: any[], fixtureName: string): void {
    const reader = engine.getLastSimulationReportReader?.();
    assert.ok(reader?.report, `${fixtureName}: expected simulation report`);
    assert.ok(reader, `${fixtureName}: expected simulation report reader`);
    assert.equal(reader.pageCount, pages.length, `${fixtureName}: simulation report pageCount mismatch`);
    assert.ok(
        reader.has(simulationArtifactKeys.fragmentationSummary),
        `${fixtureName}: simulation report should expose fragmentationSummary`
    );
    const fragmentationSummary = reader.require(simulationArtifactKeys.fragmentationSummary);
    assert.equal(
        reader.splitTransitionCount,
        fragmentationSummary.reduce((sum: number, item: any) => sum + Number(item?.splitCount || 0), 0),
        `${fixtureName}: simulation report splitTransitionCount mismatch`
    );
    assert.ok(reader.actorCount > 0, `${fixtureName}: simulation report should record actorCount`);
    assert.ok(reader.profile, `${fixtureName}: simulation report should include profile`);
    assert.equal(typeof reader.profile.keepWithNextPlanCalls, 'number', `${fixtureName}: report profile shape mismatch`);
    assert.ok(reader.report?.artifacts, `${fixtureName}: simulation report should include artifacts`);
    assert.ok(
        reader.has(simulationArtifactKeys.sourcePositionMap),
        `${fixtureName}: simulation report should expose sourcePositionMap`
    );
    assert.ok(
        reader.has(simulationArtifactKeys.pageRegionSummary),
        `${fixtureName}: simulation report should expose pageRegionSummary`
    );
    assert.ok(
        reader.has(simulationArtifactKeys.pageNumberSummary),
        `${fixtureName}: simulation report should expose pageNumberSummary`
    );
    assert.ok(
        reader.has(simulationArtifactKeys.pageOverrideSummary),
        `${fixtureName}: simulation report should expose pageOverrideSummary`
    );
    const pageRegionSummary = reader.require(simulationArtifactKeys.pageRegionSummary);
    assert.equal(
        reader.generatedBoxCount,
        pageRegionSummary.reduce((sum: number, item: any) => sum + Number(item?.generatedBoxes || 0), 0),
        `${fixtureName}: simulation report generatedBoxCount mismatch`
    );
}

function resolveSnapshotPath(fixturePath: string): string {
    const ext = path.extname(fixturePath);
    return fixturePath.slice(0, fixturePath.length - ext.length) + '.snapshot.layout.json';
}

function assertSnapshot(fixtureName: string, fixturePath: string, pages: any[]): void {
    const snapshotPath = resolveSnapshotPath(fixturePath);
    const actual = snapshotPages(pages);

    if (!fs.existsSync(snapshotPath)) {
        if (!UPDATE_LAYOUT_SNAPSHOTS) {
            throw new Error(
                `${fixtureName}: snapshot missing at ${snapshotPath}. Re-run tests with --update-layout-snapshots or set VMPRINT_UPDATE_LAYOUT_SNAPSHOTS=1.`
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
    check(
        'fixture discovery',
        'at least one JSON fixture is present in src/tests/fixtures/regression',
        () => {
            assert.ok(fixtures.length > 0, 'no JSON fixtures found in src/tests/fixtures/regression');
        }
    );

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
                assert.equal(irA.documentVersion, CURRENT_DOCUMENT_VERSION, `${fixture.name}: unexpected documentVersion`);
                assert.equal(irA.irVersion, CURRENT_IR_VERSION, `${fixture.name}: unexpected irVersion`);
                assert.deepEqual(irA, irB, `${fixture.name}: canonical IR drift between repeated loads`);
            }
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
            }
        );
        check(
            `${fixture.name} deterministic pagination`,
            'two paginate runs with same input produce identical snapshots',
            () => {
                assert.deepEqual(
                    snapshotPages(pagesA),
                    snapshotPages(pagesB),
                    `${fixture.name}: layout is not deterministic between runs`
                );
            }
        );
        check(
            `${fixture.name} simulation report contract`,
            'paginate() produces a simulation report whose top-level counts and typed artifact sections are available',
            () => {
                assertSimulationReportSignals(engine, pagesA, fixture.name);
            }
        );
        check(
            `${fixture.name} layout snapshot`,
            'matches stored snapshot',
            () => {
                assertSnapshot(fixture.name, fixturePath, pagesA);
            }
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
                }
            );
        }
        if (fixture.name === '02-text-layout-advanced.json') {
            check(
                `${fixture.name} advanced layout signals`,
                'advanced fixtures emit expected justification and soft-hyphen layout markers',
                () => {
                    assertAdvancedLayoutSignals(pagesA, fixture.name);
                }
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
                        .filter((box) => box.type === 'image')
                        .length;
                    assert.equal(imageCount, 3, `${fixture.name}: expected exactly three flow image boxes`);
                }
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
                                (box.lines || []).some((line) => line.some((seg: any) => !!seg.inlineObject))
                            )
                        }))
                        .filter((entry) => entry.hasInline)
                        .map((entry) => entry.pageIndex);
                    assert.ok(pagesWithInlineSegments.length > 0, `${fixture.name}: expected inline segments in output`);
                    assert.ok(
                        pagesWithInlineSegments.some((idx) => idx > 0),
                        `${fixture.name}: expected inline segments on at least one continuation page`
                    );
                }
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

                    const aligns = new Set<string>(inlineSegments.map((seg: any) => String(seg.inlineMetrics.verticalAlign || '')));
                    ['baseline', 'middle', 'text-top', 'text-bottom', 'bottom'].forEach((mode) => {
                        assert.ok(aligns.has(mode), `${fixture.name}: missing verticalAlign=${mode}`);
                    });

                    const hasBaselineShiftMetric = inlineSegments.every((seg: any) =>
                        Number.isFinite(Number(seg.inlineMetrics.baselineShift ?? 0))
                    );
                    assert.ok(hasBaselineShiftMetric, `${fixture.name}: expected numeric baselineShift metrics`);

                    const hasMargins = inlineSegments.some((seg: any) =>
                        Number(seg.inlineMetrics.marginLeft || 0) > 0 || Number(seg.inlineMetrics.marginRight || 0) > 0
                    );
                    assert.ok(hasMargins, `${fixture.name}: expected inline margin usage`);

                    const widthIncludesMargin = inlineSegments.some((seg: any) =>
                        Number(seg.width || 0) > Number(seg.inlineMetrics.contentWidth || 0)
                    );
                    assert.ok(widthIncludesMargin, `${fixture.name}: expected total width to include inline margins`);

                    const hasOpticalInsetMetrics = inlineSegments.some((seg: any) =>
                        seg.inlineObject?.kind === 'image' &&
                        seg.inlineMetrics.opticalInsetTop !== undefined &&
                        seg.inlineMetrics.opticalInsetBottom !== undefined
                    );
                    assert.ok(hasOpticalInsetMetrics, `${fixture.name}: expected inline image optical inset metrics to be populated`);
                }
            );
        }
        if (fixture.name === '09-tables-spans-pagination.json') {
            check(
                `${fixture.name} mixed-span table signals`,
                'colSpan + rowSpan cells paginate deterministically with repeated headers and no span boundary splits',
                () => {
                    assertTableMixedSpanFixtureSignals(pagesA, fixture.name);
                }
            );
        }
        if (fixture.name === '10-packager-split-scenarios.json') {
            check(
                `${fixture.name} packager split scenarios`,
                'keepWithNext, mid-page table, and page-top overflow splits are all exercised',
                () => {
                    assertPackagerShatterShowcaseSignals(pagesA, fixture.name);
                }
            );
        }
        if (fixture.name === '08-dropcap-pagination.json') {
            check(
                `${fixture.name} dropcap pagination`,
                'dropcap stays on first fragment and continuation splits correctly',
                () => {
                    assertDropCapPaginationSignals(pagesA, fixture.name);
                }
            );
        }
        if (fixture.name === '17-header-footer-test.json') {
            check(
                `${fixture.name} header/footer test signals`,
                'firstPage suppression, odd/even selectors, per-page override replacement and null-suppression, physicalPageNumber token, and logical counter skipping all behave deterministically',
                () => {
                    assertHeaderFooterTestSignals(pagesA, fixture.name);
                }
            );
        }
        if (fixture.name === '11-story-image-floats.json') {
            check(
                `${fixture.name} story layout signals`,
                'multi-page story with image floats, story-absolute, and non-uniform line widths',
                () => {
                    assertStoryPackagerShowcaseSignals(pagesA, fixture.name);
                }
            );
        }
        if (fixture.name === '15-story-multi-column.json') {
            check(
                `${fixture.name} multi-column story signals`,
                'story emits at least two column anchors on page 1 and continues across pages',
                () => {
                    assertStoryMultiColumnSignals(pagesA, fixture.name);
                }
            );
        }
        check(
            `${fixture.name} input immutability`,
            'input elements are unchanged after pagination',
            () => {
                assertNoInputMutation(elements, fixture.name);
            }
        );

        const { width: pageWidth, height: pageHeight } = LayoutUtils.getPageDimensions(config);
        const context = new MockContext(pageWidth, pageHeight);
        const renderer = new Renderer(config, false, engine.getRuntime());
        await renderer.render(pagesA, context);
        check(
            `${fixture.name} renderer integration`,
            'renderer consumes all pages and emits text draw calls',
            () => {
                assert.equal(context.pagesAdded, pagesA.length, `${fixture.name}: renderer/page count mismatch`);
                assert.ok(context.textCalls > 0, `${fixture.name}: renderer emitted no text draw calls`);
                if (fixture.name === '13-inline-rich-objects.json') {
                    assert.ok(context.imageCalls > 0, `${fixture.name}: expected renderer image draw calls for inline images`);
                }
                if (fixture.name === '11-story-image-floats.json') {
                    assert.ok(context.imageCalls >= 6, `${fixture.name}: expected renderer image draw calls for all story images`);
                }
                if (fixture.name === '12-inline-baseline-alignment.json') {
                    assert.ok(context.imageCalls > 0, `${fixture.name}: expected renderer image draw calls for inline images`);
                    const hotBadgeDraws = context.imageTrace.filter((call) =>
                        call.width >= 70 && call.width <= 82 && call.height >= 22 && call.height <= 30
                    );
                    assert.ok(hotBadgeDraws.length >= 2, `${fixture.name}: expected at least two HOT badge draws`);

                    // Variant 1 (baseline) and Variant 2 (middle) are emitted in-order.
                    // Their badge Y positions must differ when verticalAlign/baselineShift differ.
                    const variant1HotY = hotBadgeDraws[0].y;
                    const variant2HotY = hotBadgeDraws[1].y;
                    assert.ok(
                        Math.abs(variant1HotY - variant2HotY) > 0.1,
                        `${fixture.name}: expected Variant 1/2 HOT badge Y positions to differ`
                    );
                }
            }
        );
        if (fixture.name === '02-text-layout-advanced.json') {
            check(
                `${fixture.name} advanced render signals`,
                'advanced fixtures exhibit expected rtl drawing progression',
                () => {
                    assertAdvancedRenderSignals(context.textTrace, fixture.name);
                }
            );
        }
    }

    await checkAsync(
        'experimental page reservation system',
        'a committed actor can reserve page space for subsequent actors through session-owned constraint state',
        async () => {
            const config = buildExperimentalReservationConfig();
            const engine = new LayoutEngine(config);
            await engine.waitForFonts();

            const sharedText =
                'VMPrint reservation probe text spans a few stable lines in a narrow measure. '.repeat(2);

            const baselineElements = [
                { type: 'p', content: sharedText, properties: { sourceId: 'probe-first' } },
                { type: 'p', content: sharedText, properties: { sourceId: 'probe-second' } }
            ];
            const reservedElements = [
                { type: 'p', content: sharedText, properties: { sourceId: 'probe-first', _experimentalPageReservationAfter: 100 } },
                { type: 'p', content: sharedText, properties: { sourceId: 'probe-second' } }
            ];

            const baselinePages = engine.paginate(baselineElements as any);
            const reservedPages = engine.paginate(reservedElements as any);

            const findFirstPageIndexForSource = (pages: any[], sourceId: string): number => {
                for (const page of pages) {
                    if ((page.boxes || []).some((box: any) => {
                        const actual = String(box.meta?.sourceId || '');
                        return actual === sourceId || actual.endsWith(`:${sourceId}`);
                    })) {
                        return page.index;
                    }
                }
                return -1;
            };

            assert.equal(baselinePages.length, 1, 'baseline probe should fit on a single page');
            assert.equal(reservedPages.length, 2, 'reservation probe should push the second actor to a new page');
            assert.equal(findFirstPageIndexForSource(baselinePages, 'probe-second'), 0, 'baseline second actor should stay on page 0');
            assert.equal(findFirstPageIndexForSource(reservedPages, 'probe-second'), 1, 'reserved second actor should move to page 1');

            const session = engine.getLastSimulationReportReader();
            assert.ok(session.report, 'reservation probe should still publish a simulation report');
            const reservationSummary = session.require(simulationArtifactKeys.pageReservationSummary);
            const reservationSpatialSummary = session.require(simulationArtifactKeys.pageSpatialConstraintSummary);
            assert.equal(reservationSummary.length, 1, 'reservation probe should publish one reservation summary entry');
            assert.equal(reservationSummary[0]?.pageIndex, 0, 'reservation summary should point at the first page');
            assert.equal(reservationSummary[0]?.reservationCount, 1, 'reservation summary should count the emitted reservation');
            assert.ok((reservationSummary[0]?.totalReservedHeight || 0) >= 100, 'reservation summary should retain reserved height');
            assert.equal(reservationSpatialSummary.length, 1, 'reservation probe should publish one unified spatial summary entry');
            assert.equal(reservationSpatialSummary[0]?.reservationCount, 1, 'unified spatial summary should include reservation count');
            assert.equal(reservationSpatialSummary[0]?.exclusionCount, 0, 'unified spatial summary should not invent exclusions for the reservation-only probe');

            const pageStartReservationEngine = new LayoutEngine({
                ...config,
                layout: {
                    ...config.layout,
                    _experimentalPageReservationOnFirstPageStart: 120
                }
            } as any);
            await pageStartReservationEngine.waitForFonts();

            const pageStartReservedPages = pageStartReservationEngine.paginate(baselineElements as any);
            assert.equal(pageStartReservedPages.length, 2, 'page-start reservation should also push the second actor to a new page');
            assert.equal(findFirstPageIndexForSource(pageStartReservedPages, 'probe-second'), 1, 'page-start reservation should move the second actor to page 1');

            const pageStartSession = pageStartReservationEngine.getLastSimulationReportReader();
            assert.ok(pageStartSession.report, 'page-start reservation should still publish a simulation report');
            const pageStartSummary = pageStartSession.require(simulationArtifactKeys.pageReservationSummary);
            assert.equal(pageStartSummary.length, 1, 'page-start reservation should publish one reservation summary entry');
            assert.equal(pageStartSummary[0]?.pageIndex, 0, 'page-start reservation should point at the first page');
            assert.ok((pageStartSummary[0]?.totalReservedHeight || 0) >= 120, 'page-start reservation summary should retain the configured height');

            const multiPageElements = Array.from({ length: 6 }, (_, index) => ({
                type: 'p',
                content: sharedText,
                properties: { sourceId: `odd-probe-${index}` }
            }));
            const oddSelectorEngine = new LayoutEngine({
                ...config,
                layout: {
                    ...config.layout,
                    _experimentalPageReservationOnFirstPageStart: 20,
                    _experimentalPageStartReservationSelector: 'odd'
                }
            } as any);
            await oddSelectorEngine.waitForFonts();

            const oddSelectorPages = oddSelectorEngine.paginate(multiPageElements as any);
            assert.ok(oddSelectorPages.length >= 3, 'odd-selector reservation probe should produce at least three pages');

            const oddSelectorSession = oddSelectorEngine.getLastSimulationReportReader();
            const oddSelectorSummary = oddSelectorSession.require(simulationArtifactKeys.pageReservationSummary);
            assert.ok(oddSelectorSummary.length >= 2, 'odd-selector reservation should publish multiple summary entries');
            assert.ok(
                oddSelectorSummary.every((entry) => entry.pageIndex % 2 === 0),
                'odd-selector reservation should only target odd physical pages'
            );

            const exclusionEngine = new LayoutEngine({
                ...config,
                layout: {
                    ...config.layout,
                    _experimentalPageStartExclusionTop: 20,
                    _experimentalPageStartExclusionHeight: 35,
                    _experimentalPageStartExclusionSelector: 'first'
                }
            } as any);
            await exclusionEngine.waitForFonts();

            const exclusionPages = exclusionEngine.paginate(baselineElements as any);
            assert.equal(exclusionPages.length, 1, 'page-start exclusion probe should stay on one page');

            const findFirstBoxYForSource = (pages: any[], sourceId: string): number => {
                for (const page of pages) {
                    const box = (page.boxes || []).find((entry: any) => {
                        const actual = String(entry.meta?.sourceId || '');
                        return actual === sourceId || actual.endsWith(`:${sourceId}`);
                    });
                    if (box) return Number(box.y || 0);
                }
                return -1;
            };

            const baselineFirstY = findFirstBoxYForSource(baselinePages, 'probe-first');
            const excludedFirstY = findFirstBoxYForSource(exclusionPages, 'probe-first');
            assert.ok(excludedFirstY > baselineFirstY + 20, 'page-start exclusion should push the first actor noticeably lower on the page');

            const exclusionSession = exclusionEngine.getLastSimulationReportReader();
            assert.ok(exclusionSession.report, 'page-start exclusion should still publish a simulation report');
            const exclusionSummary = exclusionSession.require(simulationArtifactKeys.pageExclusionSummary);
            const exclusionSpatialSummary = exclusionSession.require(simulationArtifactKeys.pageSpatialConstraintSummary);
            assert.equal(exclusionSummary.length, 1, 'page-start exclusion should publish one exclusion summary entry');
            assert.equal(exclusionSummary[0]?.pageIndex, 0, 'page-start exclusion should target the first page');
            assert.ok((exclusionSummary[0]?.totalExcludedHeight || 0) >= 35, 'page-start exclusion summary should retain the excluded height');
            assert.equal(exclusionSpatialSummary.length, 1, 'page-start exclusion should publish one unified spatial summary entry');
            assert.equal(exclusionSpatialSummary[0]?.reservationCount, 0, 'unified spatial summary should not invent reservations for the exclusion-only probe');
            assert.equal(exclusionSpatialSummary[0]?.exclusionCount, 1, 'unified spatial summary should include exclusion count');

            const laneExclusionEngine = new LayoutEngine({
                ...config,
                layout: {
                    ...config.layout,
                    _experimentalPageStartExclusionTop: 20,
                    _experimentalPageStartExclusionHeight: 45,
                    _experimentalPageStartExclusionLeftWidth: 80,
                    _experimentalPageStartExclusionSelector: 'first'
                }
            } as any);
            await laneExclusionEngine.waitForFonts();

            const laneExclusionPages = laneExclusionEngine.paginate(baselineElements as any);
            assert.equal(laneExclusionPages.length, 1, 'lane exclusion probe should stay on one page');

            const findFirstBoxForSource = (pages: any[], sourceId: string): any => {
                for (const page of pages) {
                    const box = (page.boxes || []).find((entry: any) => {
                        const actual = String(entry.meta?.sourceId || '');
                        return actual === sourceId || actual.endsWith(`:${sourceId}`);
                    });
                    if (box) return box;
                }
                return null;
            };

            const findMinimumBoxXForSource = (pages: any[], sourceId: string): number => {
                const matches = pages.flatMap((page: any) =>
                    (page.boxes || []).filter((entry: any) => {
                        const actual = String(entry.meta?.sourceId || '');
                        return actual === sourceId || actual.endsWith(`:${sourceId}`);
                    })
                );
                if (!matches.length) return -1;
                return Math.min(...matches.map((entry: any) => Number(entry.x || 0)));
            };

            const baselineFirstBox = findFirstBoxForSource(baselinePages, 'probe-first');
            const laneFirstBox = findFirstBoxForSource(laneExclusionPages, 'probe-first');
            assert.ok(laneFirstBox, 'lane exclusion should still emit the first actor');
            assert.ok(Number(laneFirstBox.x || 0) > Number(baselineFirstBox?.x || 0) + 40, 'lane exclusion should shift the first actor right into the remaining lane');

            const centeredLaneExclusionEngine = new LayoutEngine({
                ...config,
                layout: {
                    ...config.layout,
                    _experimentalPageStartExclusionTop: 20,
                    _experimentalPageStartExclusionHeight: 45,
                    _experimentalPageStartExclusionLeftWidth: 70,
                    _experimentalPageStartExclusionRightWidth: 70,
                    _experimentalPageStartExclusionSelector: 'first'
                }
            } as any);
            await centeredLaneExclusionEngine.waitForFonts();

            const centeredLanePages = centeredLaneExclusionEngine.paginate(baselineElements as any);
            assert.equal(centeredLanePages.length, 2, 'centered lane exclusion probe should defer full-width actors below the constrained band');

            const centeredLaneFirstBox = findFirstBoxForSource(centeredLanePages, 'probe-first');
            assert.ok(centeredLaneFirstBox, 'centered lane exclusion should still emit the first paragraph');
            assert.equal(findFirstPageIndexForSource(centeredLanePages, 'probe-first'), 0, 'centered lane exclusion should keep the first paragraph on the first page');
            assert.ok(
                Number(centeredLaneFirstBox.x || 0) === Number(baselineFirstBox?.x || 0),
                'centered lane exclusion should restore full-width placement once the constrained band is cleared'
            );
            assert.ok(
                Number(centeredLaneFirstBox.y || 0) > baselineFirstY + 20,
                'centered lane exclusion should move the first paragraph below the constrained band instead of forcing it through the lane'
            );

            const centeredLaneSession = centeredLaneExclusionEngine.getLastSimulationReportReader();
            const centeredLaneSummary = centeredLaneSession.require(simulationArtifactKeys.pageExclusionSummary);
            const centeredLaneSpatialSummary = centeredLaneSession.require(simulationArtifactKeys.pageSpatialConstraintSummary);
            assert.equal(centeredLaneSummary.length, 1, 'centered lane exclusion should publish one page summary entry');
            assert.equal(centeredLaneSummary[0]?.exclusionCount, 2, 'centered lane exclusion should publish two exclusion shapes on the first page');
            assert.ok((centeredLaneSummary[0]?.totalExcludedHeight || 0) >= 90, 'centered lane exclusion summary should retain both exclusion heights');
            assert.equal(centeredLaneSpatialSummary[0]?.exclusionCount, 2, 'unified spatial summary should reflect both centered-lane exclusions');

            const dropcapLaneEngine = new LayoutEngine({
                ...config,
                layout: {
                    ...config.layout,
                    _experimentalPageStartExclusionTop: 20,
                    _experimentalPageStartExclusionHeight: 45,
                    _experimentalPageStartExclusionLeftWidth: 70,
                    _experimentalPageStartExclusionRightWidth: 70,
                    _experimentalPageStartExclusionSelector: 'first'
                }
            } as any);
            await dropcapLaneEngine.waitForFonts();

            const dropcapElements = [
                {
                    type: 'p',
                    content:
                        'Drop cap probe text should be deferred below the constrained band when the centered lane is too narrow for the composite actor. '.repeat(2),
                    properties: {
                        sourceId: 'dropcap-lane-probe',
                        dropCap: {
                            enabled: true,
                            lines: 3,
                            gap: 6,
                            characterStyle: {
                                fontFamily: 'Arimo',
                                fontWeight: 700
                            }
                        }
                    }
                },
                {
                    type: 'p',
                    content: sharedText,
                    properties: { sourceId: 'dropcap-follow' }
                }
            ];

            const dropcapLanePages = dropcapLaneEngine.paginate(dropcapElements as any);
            assert.equal(dropcapLanePages.length, 2, 'dropcap lane probe should defer below the constrained band rather than force the drop cap through it');

            const dropcapLaneFirstBox = findFirstBoxForSource(dropcapLanePages, 'dropcap-lane-probe');
            assert.ok(dropcapLaneFirstBox, 'dropcap lane probe should still emit the paragraph');
            const dropcapLaneMinX = findMinimumBoxXForSource(dropcapLanePages, 'dropcap-lane-probe');
            assert.ok(
                dropcapLaneMinX <= Number(baselineFirstBox?.x || 0) + 0.1,
                'dropcap lane probe should restore full-width placement instead of entering the centered lane'
            );
            assert.ok(
                Number(dropcapLaneFirstBox.y || 0) > baselineFirstY + 20,
                'dropcap lane probe should defer the opening paragraph below the constrained band'
            );

            const baselineStoryElements = [
                {
                    type: 'story',
                    children: [
                        {
                            type: 'p',
                            content: sharedText.repeat(4),
                            properties: { sourceId: 'story-lane-first' }
                        },
                        {
                            type: 'p',
                            content: sharedText.repeat(3),
                            properties: { sourceId: 'story-lane-second' }
                        }
                    ]
                }
            ];
            const baselineStoryEngine = new LayoutEngine(config as any);
            await baselineStoryEngine.waitForFonts();
            const centeredLaneStoryEngine = new LayoutEngine({
                ...config,
                layout: {
                    ...config.layout,
                    _experimentalPageStartExclusionTop: 20,
                    _experimentalPageStartExclusionHeight: 45,
                    _experimentalPageStartExclusionLeftWidth: 70,
                    _experimentalPageStartExclusionRightWidth: 70,
                    _experimentalPageStartExclusionSelector: 'first'
                }
            } as any);
            await centeredLaneStoryEngine.waitForFonts();

            const baselineStoryPages = baselineStoryEngine.paginate(baselineStoryElements as any);
            const centeredLaneStoryPages = centeredLaneStoryEngine.paginate(baselineStoryElements as any);

            const baselineStoryFirstBox = findFirstBoxForSource(baselineStoryPages, 'story-lane-first');
            const centeredLaneStoryFirstBox = findFirstBoxForSource(centeredLaneStoryPages, 'story-lane-first');
            const centeredLaneStoryMinX = findMinimumBoxXForSource(centeredLaneStoryPages, 'story-lane-first');
            assert.ok(centeredLaneStoryFirstBox, 'centered lane story probe should still emit the first story paragraph');
            assert.ok(
                Number(centeredLaneStoryFirstBox.y || 0) > Number(baselineStoryFirstBox?.y || 0) + 20,
                'centered lane story probe should defer the story below the constrained band'
            );
            assert.ok(
                centeredLaneStoryMinX <= Number(baselineStoryFirstBox?.x || 0) + 0.1,
                'centered lane story probe should restore full-width placement for the frozen story fragment'
            );
        }
    );

    console.log(`[engine-regression.spec] OK (${fixtures.length} fixtures)`);
}

run().catch((err) => {
    console.error('[engine-regression.spec] FAILED', err);
    process.exit(1);
});

