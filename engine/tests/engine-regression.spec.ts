import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { LayoutEngine } from '../src/engine/layout-engine';
import { Renderer } from '../src/engine/renderer';
import {
    HARNESS_REGRESSION_CASES_DIR,
    MockContext,
    assertAdvancedLayoutSignals,
    assertAdvancedRenderSignals,
    assertFlatPipelineInvariants,
    snapshotPages,
    loadLocalFontManager
} from './harness/engine-harness';
import { CURRENT_DOCUMENT_VERSION, CURRENT_IR_VERSION, resolveDocumentPaths, toLayoutConfig } from '../src';
import { loadAstJsonDocumentFixtures } from './harness/ast-fixture-harness';
import { LayoutUtils } from '../src/engine/layout/layout-utils';
import {
    buildAssembledTableOfContentsElements,
    buildAssembledBookmarkTree,
    buildBookmarkTree,
    buildTableOfContentsElements,
    getHeadingOutline,
    resolvePhysicalPageReference,
    remapHeadingOutlineWithAssembly,
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

function assertTableMixedSpanFixtureSignals(
    pages: any[],
    fixtureName: string,
    engine: any
): void {
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

    const continuationHeaderClones = pageCells
        .slice(1)
        .flatMap((cellsOnPage) =>
            cellsOnPage.filter((cell: any) =>
                Number(cell.properties?._tableRowIndex) === 0
                && cell.meta?.transformKind === 'clone'
                && cell.meta?.clonedFromSourceId
            )
        );
    assert.ok(
        continuationHeaderClones.length > 0,
        `${fixtureName}: expected repeated continuation headers to be emitted as cloned substructures`
    );
    const transformSummary = engine.getLastSimulationReportReader().require(simulationArtifactKeys.transformSummary);
    assert.ok(
        transformSummary.some((item: any) => item?.transformKind === 'clone' && Number(item?.count || 0) > 0),
        `${fixtureName}: expected transformSummary to report cloned continuation headers`
    );

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

function assertAcceptedSplitBranchingSignals(pages: any[], fixtureName: string): void {
    const flattenText = (box: any): string => {
        if (typeof box?.text === 'string' && box.text.length > 0) return box.text;
        if (!Array.isArray(box?.lines)) return '';
        return box.lines
            .flatMap((line: any[]) => line || [])
            .map((segment: any) => String(segment?.text || ''))
            .join('');
    };
    const matchesSourceId = (box: any, id: string): boolean => {
        const sourceId = String(box.meta?.sourceId || '');
        return sourceId === id || sourceId.endsWith(`:${id}`);
    };
    const allBoxes = pages.flatMap((page: any) => page.boxes || []);
    assert.ok(pages.length >= 4, `${fixtureName}: expected multiple pages across both accepted-split seams`);

    const branchA = allBoxes.filter((box: any) => matchesSourceId(box, 'accepted-branch-a'));
    const branchB = allBoxes.filter((box: any) => matchesSourceId(box, 'accepted-branch-b'));
    assert.ok(branchA.some((box: any) => Number(box.meta?.fragmentIndex || 0) === 0), `${fixtureName}: expected branch A fragmentIndex=0`);
    assert.ok(branchA.some((box: any) => Number(box.meta?.fragmentIndex || 0) > 0), `${fixtureName}: expected branch A continuation fragment`);
    assert.ok(branchB.some((box: any) => Number(box.meta?.fragmentIndex || 0) === 0), `${fixtureName}: expected branch B fragmentIndex=0`);
    assert.ok(branchB.some((box: any) => Number(box.meta?.fragmentIndex || 0) > 0), `${fixtureName}: expected branch B continuation fragment`);

    const countText = (needle: string): number =>
        allBoxes.filter((box: any) => flattenText(box).includes(needle)).length;

    assert.equal(countText('A continues on next page'), 1, `${fixtureName}: expected exactly one A after-split marker`);
    assert.equal(countText('A continued from previous page'), 1, `${fixtureName}: expected exactly one A continuation marker`);
    assert.equal(countText('B continues on next page'), 1, `${fixtureName}: expected exactly one B after-split marker`);
    assert.equal(countText('B continued from previous page'), 1, `${fixtureName}: expected exactly one B continuation marker`);
    assert.equal(
        allBoxes.filter((box: any) => matchesSourceId(box, 'branch-postlude')).length,
        1,
        `${fixtureName}: expected the postlude to appear exactly once`
    );
}

function assertTransformCapabilitySignals(
    fixtureName: string,
    engine: any,
    requiredKinds: Array<'split' | 'clone' | 'morph'>
): void {
    const capabilitySummary = engine
        .getLastSimulationReportReader()
        .require(simulationArtifactKeys.transformCapabilitySummary);

    assert.ok(capabilitySummary.length > 0, `${fixtureName}: expected transformCapabilitySummary entries`);
    for (const kind of requiredKinds) {
        assert.ok(
            capabilitySummary.some((entry: any) => Array.isArray(entry?.supportedTransforms) && entry.supportedTransforms.includes(kind)),
            `${fixtureName}: expected at least one actor capability entry for transform=${kind}`
        );
    }
}

function assertTransformCapabilitySourceSignals(
    fixtureName: string,
    engine: any,
    sourceId: string,
    requiredKinds: Array<'split' | 'clone' | 'morph'>
): void {
    const capabilitySummary = engine
        .getLastSimulationReportReader()
        .require(simulationArtifactKeys.transformCapabilitySummary);

    const matchesSourceId = (actual: unknown, expected: string): boolean => {
        const value = String(actual || '');
        return value === expected || value.endsWith(`:${expected}`);
    };

    const entry = capabilitySummary.find((item: any) => matchesSourceId(item?.sourceId, sourceId));
    assert.ok(entry, `${fixtureName}: expected transform capability entry for source=${sourceId}`);
    for (const kind of requiredKinds) {
        assert.ok(
            Array.isArray(entry?.supportedTransforms) && entry.supportedTransforms.includes(kind),
            `${fixtureName}: expected source=${sourceId} to support transform=${kind}`
        );
    }
}

function assertTransformCapabilityActorKindSignals(
    fixtureName: string,
    engine: any,
    actorKind: string,
    requiredKinds: Array<'split' | 'clone' | 'morph'>
): void {
    const capabilitySummary = engine
        .getLastSimulationReportReader()
        .require(simulationArtifactKeys.transformCapabilitySummary);

    const entry = capabilitySummary.find((item: any) => String(item?.actorKind || '') === actorKind);
    assert.ok(entry, `${fixtureName}: expected transform capability entry for actorKind=${actorKind}`);
    for (const kind of requiredKinds) {
        assert.ok(
            Array.isArray(entry?.supportedTransforms) && entry.supportedTransforms.includes(kind),
            `${fixtureName}: expected actorKind=${actorKind} to support transform=${kind}`
        );
    }
}

function assertTransformCapabilityDetails(
    fixtureName: string,
    engine: any,
    selector: { sourceId?: string; actorKind?: string },
    expected: Record<string, Record<string, boolean>>
): void {
    const capabilitySummary = engine
        .getLastSimulationReportReader()
        .require(simulationArtifactKeys.transformCapabilitySummary);

    const matchesSourceId = (actual: unknown, wanted: string): boolean => {
        const value = String(actual || '');
        return value === wanted || value.endsWith(`:${wanted}`);
    };

    const entry = capabilitySummary.find((item: any) => {
        if (selector.sourceId && !matchesSourceId(item?.sourceId, selector.sourceId)) return false;
        if (selector.actorKind && String(item?.actorKind || '') !== selector.actorKind) return false;
        return true;
    });
    assert.ok(
        entry,
        `${fixtureName}: expected transform capability detail entry for ${
            selector.sourceId ? `source=${selector.sourceId}` : `actorKind=${selector.actorKind}`
        }`
    );

    const capabilityMap = new Map(
        (entry?.capabilities || []).map((capability: any) => [String(capability?.kind || ''), capability] as const)
    );
    for (const [kind, fields] of Object.entries(expected)) {
        const capability = capabilityMap.get(kind);
        assert.ok(capability, `${fixtureName}: expected capability details for transform=${kind}`);
        for (const [field, value] of Object.entries(fields)) {
            assert.equal(
                Boolean((capability as any)?.[field]),
                value,
                `${fixtureName}: expected transform=${kind} field ${field}=${value}`
            );
        }
    }
}

function assertBlockFloatsAndColumnSpanSignals(pages: any[], fixtureName: string): void {
    if (fixtureName !== '20-block-floats-and-column-span.json') return;

    const allBoxes = pages.flatMap((page: any) => page.boxes || []);
    const matchesSourceId = (box: any, id: string): boolean => {
        const sourceId = String(box.meta?.sourceId || '');
        return sourceId === id || sourceId.endsWith(`:${id}`);
    };

    // -- Block float: left-aligned -------------------------------------------
    const leftFloatBoxes = allBoxes.filter((box: any) => matchesSourceId(box, 'pull-quote-float'));
    assert.ok(leftFloatBoxes.length > 0, `${fixtureName}: expected pull-quote-float box`);
    const leftFloat = leftFloatBoxes[0];
    // Left-aligned float in column 1 (region.x=0) → box.x = margins.left = 50
    assert.ok(
        Math.abs(Number(leftFloat.x) - 50) < 2,
        `${fixtureName}: expected left block float x ≈ 50, got ${leftFloat.x}`
    );
    assert.ok(
        Math.abs(Number(leftFloat.w) - 108) < 4,
        `${fixtureName}: expected left block float width ≈ 108, got ${leftFloat.w}`
    );

    // -- Block float: right-aligned ------------------------------------------
    const rightFloatBoxes = allBoxes.filter((box: any) => matchesSourceId(box, 'pull-quote-float-right'));
    assert.ok(rightFloatBoxes.length > 0, `${fixtureName}: expected pull-quote-float-right box`);
    const rightFloat = rightFloatBoxes[0];
    assert.ok(
        Math.abs(Number(rightFloat.w) - 108) < 4,
        `${fixtureName}: expected right block float width ≈ 108, got ${rightFloat.w}`
    );
    // Right-anchored float is always offset to the right of left-anchored float
    assert.ok(
        Number(rightFloat.x) > Number(leftFloat.x),
        `${fixtureName}: expected right float x (${rightFloat.x}) > left float x (${leftFloat.x})`
    );

    // -- Text wraps around block floats (non-uniform _lineWidths) ------------
    const wrappedTextBoxes = allBoxes.filter((box: any) => {
        const lw = box.properties?._lineWidths;
        if (!Array.isArray(lw) || lw.length < 2) return false;
        const nums = lw.map((n: any) => Number(n)).filter((n: number) => Number.isFinite(n));
        return (Math.max(...nums) - Math.min(...nums)) > 6;
    });
    assert.ok(
        wrappedTextBoxes.length > 0,
        `${fixtureName}: expected at least one text box with non-uniform line widths (text wrapping around block float)`
    );

    // -- Column span: full story width at left content edge ------------------
    const spanBoxes = allBoxes.filter((box: any) => matchesSourceId(box, 'section-span'));
    assert.ok(spanBoxes.length > 0, `${fixtureName}: expected section-span box`);
    const spanBox = spanBoxes[0];
    // Content width = 612 - 50 - 50 = 512; span should be at least 480
    assert.ok(
        Number(spanBox.w) > 480,
        `${fixtureName}: expected section-span width > 480 (full story width), got ${spanBox.w}`
    );
    assert.ok(
        Math.abs(Number(spanBox.x) - 50) < 2,
        `${fixtureName}: expected section-span x ≈ 50 (content left edge), got ${spanBox.x}`
    );

    // -- Three-column layout: at least 3 distinct column X anchors -----------
    const storyTextBoxes = allBoxes.filter((box: any) =>
        Array.isArray(box.lines) && box.lines.length > 0 &&
        box.meta?.sourceType !== 'header' && box.meta?.sourceType !== 'footer'
    );
    const xBuckets = Array.from(new Set(
        storyTextBoxes.map((box: any) => Math.round(Number(box.x || 0) / 5) * 5)
    ));
    assert.ok(
        xBuckets.length >= 3,
        `${fixtureName}: expected at least 3 distinct X positions for 3-column layout, got ${xBuckets.length} (${xBuckets.join(', ')})`
    );

    // -- Post-span content exists and appears on the same or later page as the span
    const spanPageIndex = pages.findIndex((page: any) =>
        (page.boxes || []).some((box: any) => matchesSourceId(box, 'section-span'))
    );
    assert.ok(spanPageIndex >= 0, `${fixtureName}: expected section-span to be on a page`);

    const postSpanBoxes = pages.flatMap((page: any, pageIndex: number) =>
        (page.boxes || [])
            .filter((box: any) => matchesSourceId(box, 'post-span-para-1') || matchesSourceId(box, 'post-span-para-2'))
            .map((box: any) => ({ box, pageIndex }))
    );
    assert.ok(
        postSpanBoxes.length > 0,
        `${fixtureName}: expected post-span paragraph boxes`
    );
    const allPostSpanOnOrAfterSpanPage = postSpanBoxes.every((entry: any) => entry.pageIndex >= spanPageIndex);
    assert.ok(
        allPostSpanOnOrAfterSpanPage,
        `${fixtureName}: expected all post-span boxes to appear on the same or later page as the span`
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

function assertSplitTransformSignals(pages: any[], fixtureName: string, engine: any): void {
    if (
        fixtureName !== '07-pagination-fragments.json'
        && fixtureName !== '08-dropcap-pagination.json'
        && fixtureName !== '10-packager-split-scenarios.json'
    ) {
        return;
    }

    const splitBoxes = pages.flatMap((page: any) =>
        (page.boxes || []).filter((box: any) =>
            Number(box.meta?.fragmentIndex || 0) > 0
            || box.meta?.isContinuation
        )
    );
    assert.ok(splitBoxes.length > 0, `${fixtureName}: expected continuation fragment boxes`);
    assert.ok(
        splitBoxes.some((box: any) => box.meta?.transformKind === 'split'),
        `${fixtureName}: expected continuation fragment boxes to carry explicit split transform metadata`
    );

    const transformSummary = engine.getLastSimulationReportReader().require(simulationArtifactKeys.transformSummary);
    const splitEntries = transformSummary.filter((item: any) => item?.transformKind === 'split');
    assert.ok(splitEntries.length > 0, `${fixtureName}: expected transformSummary to report split transforms`);
    assert.ok(
        splitEntries.some((item: any) => Array.isArray(item?.fragmentIndices) && item.fragmentIndices.some((value: any) => Number(value) > 0)),
        `${fixtureName}: expected split transform summary to retain continuation fragment indices`
    );
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

function buildCloneProbeConfig() {
    return {
        layout: {
            pageSize: { width: 320, height: 220 },
            margins: { top: 20, right: 20, bottom: 20, left: 20 },
            fontFamily: 'Arimo',
            fontSize: 10,
            lineHeight: 1.15
        },
        fonts: {
            regular: 'Arimo'
        },
        styles: {
            p: { marginBottom: 8 },
            table: {
                marginTop: 0,
                marginBottom: 10,
                padding: 0,
                borderWidth: 0
            },
            'table-cell': {
                fontSize: 9,
                lineHeight: 1.15,
                paddingTop: 4,
                paddingBottom: 4,
                paddingLeft: 5,
                paddingRight: 5,
                borderWidth: 0.6,
                borderColor: '#111111'
            }
        }
    } as const;
}

function buildCloneProbeTable(id: string, rowCount: number): any {
    const rows = [
        {
            type: 'table-row',
            properties: { semanticRole: 'header', sourceId: `${id}-header-row` },
            children: [
                { type: 'table-cell', content: `${id.toUpperCase()} ID`, properties: { sourceId: `${id}-h-id` } },
                { type: 'table-cell', content: `${id.toUpperCase()} Task`, properties: { sourceId: `${id}-h-task` } },
                { type: 'table-cell', content: `${id.toUpperCase()} Note`, properties: { sourceId: `${id}-h-note` } }
            ]
        }
    ];

    for (let index = 0; index < rowCount; index += 1) {
        rows.push({
            type: 'table-row',
            properties: { sourceId: `${id}-row-${index}` },
            children: [
                { type: 'table-cell', content: `${id.toUpperCase()}-${String(index + 1).padStart(2, '0')}` },
                { type: 'table-cell', content: `Branch ${id.toUpperCase()} row ${index + 1} keeps the table tall enough to force a repeated header on the next page.` },
                { type: 'table-cell', content: `note-${index + 1}` }
            ]
        });
    }

    return {
        type: 'table',
        properties: {
            sourceId: `${id}-table`,
            table: {
                headerRows: 1,
                repeatHeader: true,
                columnGap: 3,
                rowGap: 1,
                columns: [
                    { mode: 'fixed', value: 58 },
                    { mode: 'flex', fr: 2, min: 100 },
                    { mode: 'fixed', value: 70 }
                ]
            }
        },
        children: rows
    };
}

function assertSimulationReportSignals(engine: any, pages: any[], fixtureName: string): void {
    const reader = engine.getLastSimulationReportReader?.();
    const printSnapshot = engine.getLastPrintPipelineSnapshot?.();
    assert.ok(reader?.report, `${fixtureName}: expected simulation report`);
    assert.ok(reader, `${fixtureName}: expected simulation report reader`);
    assert.ok(printSnapshot, `${fixtureName}: expected print pipeline snapshot`);
    assert.equal(printSnapshot.pages.length, pages.length, `${fixtureName}: print pipeline snapshot page count mismatch`);
    assert.ok(printSnapshot.reader, `${fixtureName}: expected print pipeline snapshot reader`);
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
        reader.has(simulationArtifactKeys.headingTelemetry),
        `${fixtureName}: simulation report should expose headingTelemetry`
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

function resolveSnapshotPath(fixtureName: string): string {
    return path.join(
        HARNESS_REGRESSION_CASES_DIR,
        fixtureName.slice(0, fixtureName.length - '.json'.length) + '.snapshot.layout.json'
    );
}

function assertSnapshot(fixtureName: string, pages: any[]): void {
    const snapshotPath = resolveSnapshotPath(fixtureName);
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
    const fixtures = loadAstJsonDocumentFixtures();
    check(
        'fixture discovery',
        'at least one AST fixture is present in engine/tests/fixtures/regression',
        () => {
            assert.ok(fixtures.length > 0, 'no AST fixtures found in engine/tests/fixtures/regression');
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
        const pagesA = engine.simulate(elements);
        const pagesB = engine.simulate(elements);

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
            'simulate() produces a simulation report whose top-level counts and typed artifact sections are available',
            () => {
                assertSimulationReportSignals(engine, pagesA, fixture.name);
            }
        );
        check(
            `${fixture.name} layout snapshot`,
            'matches stored snapshot',
            () => {
                assertSnapshot(fixture.name, pagesA);
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
                'colSpan + rowSpan cells paginate deterministically with repeated headers, no span boundary splits, and table transform capabilities',
                () => {
                    assertTableMixedSpanFixtureSignals(pagesA, fixture.name, engine);
                    assertTransformCapabilitySignals(fixture.name, engine, ['split', 'clone', 'morph']);
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
        if (fixture.name === '19-accepted-split-branching.json') {
            check(
                `${fixture.name} accepted split branching signals`,
                'two accepted-split seams each emit exactly one marker pair and leave no duplicated post-split residue behind',
                () => {
                    assertAcceptedSplitBranchingSignals(pagesA, fixture.name);
                }
            );
        }
        if (fixture.name === '08-dropcap-pagination.json') {
            check(
                `${fixture.name} dropcap pagination`,
                'dropcap stays on first fragment, continuation splits correctly, and dropcap actors declare split+morph capabilities',
                () => {
                    assertDropCapPaginationSignals(pagesA, fixture.name);
                    assertTransformCapabilitySourceSignals(fixture.name, engine, 'dropcap-basic', ['split', 'morph']);
                }
            );
        }
        if (
            fixture.name === '07-pagination-fragments.json'
            || fixture.name === '08-dropcap-pagination.json'
            || fixture.name === '10-packager-split-scenarios.json'
        ) {
            check(
                `${fixture.name} split transform signals`,
                'split-heavy fixtures publish split transform summaries with continuation fragment indices and actor split capabilities',
                () => {
                    assertSplitTransformSignals(pagesA, fixture.name, engine);
                    assertTransformCapabilitySignals(fixture.name, engine, ['split']);
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
        if (fixture.name === '20-block-floats-and-column-span.json') {
            check(
                `${fixture.name} block float and column span signals`,
                'block floats are positioned correctly, text wraps around them, column span is full-width, and post-span content flows in columns',
                () => {
                    assertBlockFloatsAndColumnSpanSignals(pagesA, fixture.name);
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
                'story emits at least two column anchors on page 1, continues across pages, and declares split+morph capabilities',
                () => {
                    assertStoryMultiColumnSignals(pagesA, fixture.name);
                    assertTransformCapabilityActorKindSignals(fixture.name, engine, 'story', ['split', 'morph']);
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
        'heading telemetry probe',
        'heading actors should publish ordered heading telemetry artifacts for the print pipeline handoff',
        async () => {
            const config = buildCloneProbeConfig();
            const engine = new LayoutEngine(config);
            await engine.waitForFonts();
            const matchesSourceId = (actual: unknown, expected: string): boolean => {
                const value = String(actual || '');
                return value === expected || value.endsWith(`:${expected}`);
            };

            const elements = [
                {
                    type: 'h1',
                    content: 'Architecture Overhaul',
                    properties: {
                        sourceId: 'heading-main',
                        style: { marginBottom: 10 }
                    }
                },
                {
                    type: 'p',
                    content: 'Introductory body copy keeps the layout path realistic while leaving the headings on the first page.',
                    properties: { sourceId: 'heading-body-a' }
                },
                {
                    type: 'h2',
                    content: 'Subsystem Handoff',
                    properties: {
                        sourceId: 'heading-sub',
                        style: { marginTop: 8, marginBottom: 8 }
                    }
                },
                {
                    type: 'p',
                    content: 'Post-processing should consume heading telemetry from the committed simulation output.',
                    properties: { sourceId: 'heading-body-b' }
                }
            ];

            const pages = engine.simulate(elements as any);
            assert.ok(pages.length >= 1, 'heading telemetry probe should paginate successfully');

            const reader = engine.getLastSimulationReportReader();
            const headingTelemetry = reader.require(simulationArtifactKeys.headingTelemetry);
            const printSnapshot = engine.getLastPrintPipelineSnapshot();
            const headingOutline = getHeadingOutline(printSnapshot);
            const bookmarkTree = buildBookmarkTree(printSnapshot);
            const tocElements = buildTableOfContentsElements(printSnapshot);
            assert.equal(headingTelemetry.length, 2, 'heading telemetry probe should publish exactly two heading entries');
            assert.equal(headingOutline.length, 2, 'heading outline should expose two heading entries');
            assert.equal(bookmarkTree.length, 1, 'bookmark tree should expose one root heading');
            assert.equal(tocElements.length, 3, 'TOC builder should emit one title plus one entry per heading');
            assert.equal(printSnapshot.pages.length, pages.length, 'print pipeline snapshot should expose finalized pages');
            assert.equal(
                printSnapshot.reader.require(simulationArtifactKeys.headingTelemetry).length,
                headingTelemetry.length,
                'print pipeline snapshot should expose heading telemetry through its reader'
            );
            assert.deepEqual(
                headingOutline.map((entry) => ({ sourceId: entry.sourceId, level: entry.level, heading: entry.heading })),
                [
                    { sourceId: headingTelemetry[0]?.sourceId, level: 1, heading: 'Architecture Overhaul' },
                    { sourceId: headingTelemetry[1]?.sourceId, level: 2, heading: 'Subsystem Handoff' }
                ],
                'heading outline should provide ordered TOC/bookmark-ready entries'
            );
            assert.deepEqual(
                bookmarkTree.map((entry) => ({
                    sourceId: entry.sourceId,
                    level: entry.level,
                    children: entry.children.map((child) => ({
                        sourceId: child.sourceId,
                        level: child.level
                    }))
                })),
                [
                    {
                        sourceId: headingTelemetry[0]?.sourceId,
                        level: 1,
                        children: [{ sourceId: headingTelemetry[1]?.sourceId, level: 2 }]
                    }
                ],
                'bookmark tree should nest lower-level headings beneath the nearest higher-level heading'
            );
            assert.deepEqual(
                tocElements.map((element) => ({
                    type: element.type,
                    content: element.content,
                    linkTarget: element.properties?.linkTarget,
                    semanticRole: element.properties?.semanticRole,
                    sourceId: element.properties?.sourceId,
                    source: element.properties?._generatedTocSourceId,
                    level: element.properties?._generatedTocLevel,
                    pageLabel: element.properties?._generatedTocPageLabel,
                    generatedLinkTarget: element.properties?._generatedTocLinkTarget
                })),
                [
                    {
                        type: 'h1',
                        content: 'Contents',
                        linkTarget: undefined,
                        semanticRole: 'toc-title',
                        sourceId: 'generated-toc-title',
                        source: undefined,
                        level: undefined,
                        pageLabel: undefined,
                        generatedLinkTarget: undefined
                    },
                    {
                        type: 'p',
                        content: 'Architecture Overhaul 1',
                        linkTarget: '#page=1',
                        semanticRole: 'toc-entry',
                        sourceId: `generated-toc:${headingTelemetry[0]?.sourceId}`,
                        source: headingTelemetry[0]?.sourceId,
                        level: 1,
                        pageLabel: '1',
                        generatedLinkTarget: '#page=1'
                    },
                    {
                        type: 'p',
                        content: 'Subsystem Handoff 1',
                        linkTarget: '#page=1',
                        semanticRole: 'toc-entry',
                        sourceId: `generated-toc:${headingTelemetry[1]?.sourceId}`,
                        source: headingTelemetry[1]?.sourceId,
                        level: 2,
                        pageLabel: '1',
                        generatedLinkTarget: '#page=1'
                    }
                ],
                'TOC builder should convert heading telemetry into layoutable post-processing elements'
            );

            const tocEngine = new LayoutEngine(config);
            await tocEngine.waitForFonts();
            const tocPages = tocEngine.simulate(tocElements as any);
            const flattenBoxText = (box: any): string => {
                if (typeof box?.text === 'string' && box.text.length > 0) return box.text;
                if (typeof box?.content === 'string' && box.content.length > 0) return box.content;
                if (!Array.isArray(box?.lines)) return '';
                return box.lines
                    .flatMap((line: any[]) => line || [])
                    .map((segment: any) => String(segment?.text || ''))
                    .join('');
            };
            const tocText = tocPages
                .flatMap((page: any) => page.boxes || [])
                .map((box: any) => flattenBoxText(box))
                .join('\n');
            assert.ok(tocPages.length >= 1, 'generated TOC fragment should paginate successfully');
            assert.match(tocText, /Contents/, 'generated TOC fragment should render the TOC title');
            assert.match(tocText, /Architecture Overhaul 1/, 'generated TOC fragment should include the first heading entry');
            assert.match(tocText, /Subsystem Handoff 1/, 'generated TOC fragment should include the nested heading entry');

            const reservedPlan = await engine.planReservedTableOfContents(printSnapshot, 1);
            assert.equal(reservedPlan.reservedPageCount, 1, 'reserved TOC plan should preserve the declared reservation size');
            assert.equal(reservedPlan.fitsReservation, true, 'reserved TOC plan should fit a one-page reservation for the probe');
            assert.equal(reservedPlan.overflowPageCount, 0, 'reserved TOC plan should report no overflow when it fits');
            assert.equal(reservedPlan.tocPages.length, 1, 'reserved TOC plan should expose the separately paginated TOC pages');
            assert.equal(reservedPlan.tocElements.length, tocElements.length, 'reserved TOC plan should expose the generated TOC elements');
            assert.equal(reservedPlan.bodyPages.length, pages.length, 'reserved TOC plan should preserve the original body page list');
            assert.equal(
                reservedPlan.tocSnapshot.reader.require(simulationArtifactKeys.headingTelemetry).length,
                1,
                'generated TOC fragment should publish telemetry only for the generated TOC title heading'
            );

            const overflowPlan = await engine.planReservedTableOfContents(printSnapshot, 0);
            assert.equal(overflowPlan.fitsReservation, false, 'reserved TOC plan should report overflow when the reservation is too small');
            assert.equal(overflowPlan.overflowPageCount, 1, 'reserved TOC overflow should equal the number of generated pages beyond the reservation');

            const configuredEngine = new LayoutEngine({
                ...config,
                printPipeline: {
                    tableOfContents: {
                        reservedPageCount: 1,
                        title: 'Table of Contents',
                        titleType: 'h2',
                        entryType: 'p',
                        indentPerLevel: 20,
                        includeTitle: true
                    }
                }
            });
            await configuredEngine.waitForFonts();
            configuredEngine.simulate(elements as any);
            const configuredPlan = await configuredEngine.planConfiguredTableOfContents();
            assert.ok(configuredPlan, 'configured TOC planner should activate when the document declares tableOfContents');
            assert.equal(configuredPlan?.reservedPageCount, 1, 'configured TOC planner should use the declared reservation size');
            assert.equal(configuredPlan?.fitsReservation, true, 'configured TOC planner should honor the declared reservation');
            assert.equal(
                configuredPlan?.tocElements[0]?.content,
                'Table of Contents',
                'configured TOC planner should use the declared TOC title'
            );
            assert.equal(
                configuredPlan?.tocElements[0]?.type,
                'h2',
                'configured TOC planner should use the declared TOC title type'
            );
            assert.equal(
                configuredPlan?.tocElements[2]?.properties?.style?.marginLeft,
                20,
                'configured TOC planner should use the declared indent per heading level'
            );

            const configuredBundle = await configuredEngine.buildPrintPipelineArtifacts();
            const assembledTocElements = buildAssembledTableOfContentsElements(
                printSnapshot,
                configuredBundle.assembly,
                {
                    title: 'Table of Contents',
                    titleType: 'h2',
                    entryType: 'p',
                    indentPerLevel: 20,
                    includeTitle: true
                }
            );
            assert.equal(configuredBundle.body.pages.length, pages.length, 'print artifact bundle should preserve the committed body snapshot');
            assert.equal(configuredBundle.tableOfContents.declared, true, 'print artifact bundle should report configured TOC declaration');
            assert.equal(configuredBundle.tableOfContents.status, 'fits-reservation', 'print artifact bundle should report a fitting TOC reservation');
            assert.equal(configuredBundle.tableOfContents.overflowPageCount, 0, 'print artifact bundle should report zero overflow when TOC fits');
            assert.ok(configuredBundle.tableOfContents.plan, 'print artifact bundle should include the configured TOC plan');
            assert.equal(configuredBundle.assembly.status, 'reserved-front-matter', 'assembly plan should report reserved front matter when TOC fits');
            assert.equal(configuredBundle.assembly.reservedFrontMatterPageCount, 1, 'assembly plan should preserve reserved TOC page count');
            assert.equal(configuredBundle.assembly.bodyStartPageIndex, 1, 'assembly plan should start body pages after the reserved TOC block');
            assert.equal(configuredBundle.assembly.omittedTocPageCount, 0, 'assembly plan should not omit TOC pages when reservation fits');
            assert.deepEqual(
                configuredBundle.assembly.bodyFinalPageIndexByBodyPageIndex,
                [1],
                'assembly plan should expose final page indices for body pages after front matter insertion'
            );
            assert.deepEqual(
                configuredBundle.assembly.tocFinalPageIndexByTocPageIndex,
                [0],
                'assembly plan should expose final page indices for placed TOC pages'
            );
            assert.deepEqual(
                configuredBundle.assembly.pages.slice(0, 2).map((entry) => ({
                    finalPageIndex: entry.finalPageIndex,
                    source: entry.source,
                    sourcePageIndex: entry.sourcePageIndex
                })),
                [
                    { finalPageIndex: 0, source: 'toc', sourcePageIndex: 0 },
                    { finalPageIndex: 1, source: 'body', sourcePageIndex: 0 }
                ],
                'assembly plan should place TOC pages before body pages'
            );
            assert.deepEqual(
                remapHeadingOutlineWithAssembly(headingOutline, configuredBundle.assembly).map((entry) => ({
                    sourceId: entry.sourceId,
                    pageIndex: entry.pageIndex
                })),
                [
                    { sourceId: headingTelemetry[0]?.sourceId, pageIndex: 1 },
                    { sourceId: headingTelemetry[1]?.sourceId, pageIndex: 1 }
                ],
                'assembly remapping should translate body heading page indices into final assembled page indices'
            );
            assert.deepEqual(
                resolvePhysicalPageReference(printSnapshot, 0, configuredBundle.assembly),
                {
                    originalPageIndex: 0,
                    finalPageIndex: 1,
                    originalPageLabel: '1',
                    finalPageLabel: '2',
                    originalLinkTarget: '#page=1',
                    finalLinkTarget: '#page=2'
                },
                'generic page-reference resolution should remap body-page references into final assembled page positions'
            );
            assert.deepEqual(
                configuredBundle.bodyPageReferences,
                [
                    {
                        originalPageIndex: 0,
                        finalPageIndex: 1,
                        originalPageLabel: '1',
                        finalPageLabel: '2',
                        originalLinkTarget: '#page=1',
                        finalLinkTarget: '#page=2'
                    }
                ],
                'print artifact bundle should expose precomputed body-page references for assembled host consumers'
            );
            assert.deepEqual(
                configuredBundle.navigation.headingOutline.map((entry) => ({
                    sourceId: entry.sourceId,
                    pageIndex: entry.pageIndex,
                    level: entry.level
                })),
                [
                    { sourceId: headingTelemetry[0]?.sourceId, pageIndex: 0, level: 1 },
                    { sourceId: headingTelemetry[1]?.sourceId, pageIndex: 0, level: 2 }
                ],
                'print artifact bundle should expose the raw heading outline as navigational substrate'
            );
            assert.deepEqual(
                configuredBundle.navigation.assembledHeadingOutline.map((entry) => ({
                    sourceId: entry.sourceId,
                    pageIndex: entry.pageIndex,
                    level: entry.level
                })),
                [
                    { sourceId: headingTelemetry[0]?.sourceId, pageIndex: 1, level: 1 },
                    { sourceId: headingTelemetry[1]?.sourceId, pageIndex: 1, level: 2 }
                ],
                'print artifact bundle should expose the assembly-remapped heading outline for host consumers'
            );
            assert.deepEqual(
                configuredBundle.navigation.assembledBookmarkTree.map((entry) => ({
                    sourceId: entry.sourceId,
                    pageIndex: entry.pageIndex,
                    children: entry.children.map((child) => ({
                        sourceId: child.sourceId,
                        pageIndex: child.pageIndex
                    }))
                })),
                [
                    {
                        sourceId: headingTelemetry[0]?.sourceId,
                        pageIndex: 1,
                        children: [{ sourceId: headingTelemetry[1]?.sourceId, pageIndex: 1 }]
                    }
                ],
                'print artifact bundle should expose an assembled bookmark tree without requiring helper reconstruction'
            );
            assert.deepEqual(
                {
                    main: configuredBundle.navigation.sourceAnchorsBySourceId[headingTelemetry[0]?.sourceId || ''],
                    sub: configuredBundle.navigation.sourceAnchorsBySourceId[headingTelemetry[1]?.sourceId || '']
                },
                {
                    main: {
                        sourceId: headingTelemetry[0]?.sourceId,
                        sourceType: 'h1',
                        firstPageIndex: 0,
                        finalFirstPageIndex: 1,
                        firstY: headingTelemetry[0]?.y,
                        pageIndices: [0],
                        finalPageIndices: [1],
                        fragmentCount: 1,
                        linkTarget: '#page=1',
                        finalLinkTarget: '#page=2'
                    },
                    sub: {
                        sourceId: headingTelemetry[1]?.sourceId,
                        sourceType: 'h2',
                        firstPageIndex: 0,
                        finalFirstPageIndex: 1,
                        firstY: headingTelemetry[1]?.y,
                        pageIndices: [0],
                        finalPageIndices: [1],
                        fragmentCount: 1,
                        linkTarget: '#page=1',
                        finalLinkTarget: '#page=2'
                    }
                },
                'print artifact bundle should expose assembled source anchors keyed by sourceId for downstream navigation consumers'
            );
            assert.deepEqual(
                configuredBundle.getSourceAnchor(headingTelemetry[0]?.sourceId || ''),
                configuredBundle.navigation.sourceAnchorsBySourceId[headingTelemetry[0]?.sourceId || ''],
                'print artifact bundle should expose a direct sourceId anchor lookup without requiring map plumbing'
            );
            assert.equal(
                configuredBundle.getSourceAnchor('missing-source-id'),
                undefined,
                'print artifact bundle sourceId lookup should return undefined for unknown anchors'
            );
            assert.deepEqual(
                assembledTocElements.map((element) => ({
                    type: element.type,
                    content: element.content,
                    linkTarget: element.properties?.linkTarget,
                    semanticRole: element.properties?.semanticRole,
                    sourceId: element.properties?.sourceId,
                    source: element.properties?._generatedTocSourceId,
                    level: element.properties?._generatedTocLevel,
                    pageIndex: element.properties?._generatedTocPageIndex,
                    pageLabel: element.properties?._generatedTocPageLabel,
                    generatedLinkTarget: element.properties?._generatedTocLinkTarget
                })),
                [
                    {
                        type: 'h2',
                        content: 'Table of Contents',
                        linkTarget: undefined,
                        semanticRole: 'toc-title',
                        sourceId: 'generated-toc-title',
                        source: undefined,
                        level: undefined,
                        pageIndex: undefined,
                        pageLabel: undefined,
                        generatedLinkTarget: undefined
                    },
                    {
                        type: 'p',
                        content: 'Architecture Overhaul 2',
                        linkTarget: '#page=2',
                        semanticRole: 'toc-entry',
                        sourceId: `generated-toc:${headingTelemetry[0]?.sourceId}`,
                        source: headingTelemetry[0]?.sourceId,
                        level: 1,
                        pageIndex: 1,
                        pageLabel: '2',
                        generatedLinkTarget: '#page=2'
                    },
                    {
                        type: 'p',
                        content: 'Subsystem Handoff 2',
                        linkTarget: '#page=2',
                        semanticRole: 'toc-entry',
                        sourceId: `generated-toc:${headingTelemetry[1]?.sourceId}`,
                        source: headingTelemetry[1]?.sourceId,
                        level: 2,
                        pageIndex: 1,
                        pageLabel: '2',
                        generatedLinkTarget: '#page=2'
                    }
                ],
                'assembled TOC builder should rewrite TOC page labels and navigation targets through the final assembly plan'
            );
            assert.deepEqual(
                buildAssembledBookmarkTree(printSnapshot, configuredBundle.assembly).map((entry) => ({
                    sourceId: entry.sourceId,
                    pageIndex: entry.pageIndex,
                    children: entry.children.map((child) => ({
                        sourceId: child.sourceId,
                        pageIndex: child.pageIndex
                    }))
                })),
                [
                    {
                        sourceId: headingTelemetry[0]?.sourceId,
                        pageIndex: 1,
                        children: [{ sourceId: headingTelemetry[1]?.sourceId, pageIndex: 1 }]
                    }
                ],
                'assembled bookmark tree should expose final page indices after front matter insertion'
            );

            const overflowingConfiguredEngine = new LayoutEngine({
                ...config,
                printPipeline: {
                    tableOfContents: {
                        reservedPageCount: 0
                    }
                }
            });
            await overflowingConfiguredEngine.waitForFonts();
            overflowingConfiguredEngine.simulate(elements as any);
            const overflowingBundle = await overflowingConfiguredEngine.buildPrintPipelineArtifacts();
            assert.equal(overflowingBundle.tableOfContents.declared, true, 'overflow bundle should still report TOC declaration');
            assert.equal(overflowingBundle.tableOfContents.status, 'overflow', 'overflow bundle should report TOC overflow clearly');
            assert.equal(overflowingBundle.tableOfContents.overflowPageCount, 1, 'overflow bundle should report the extra TOC pages');
            assert.equal(overflowingBundle.assembly.status, 'overflow', 'assembly plan should report overflow when reserved TOC space is insufficient');
            assert.equal(overflowingBundle.assembly.reservedFrontMatterPageCount, 0, 'overflow assembly should preserve the declared reservation size');
            assert.equal(overflowingBundle.assembly.bodyStartPageIndex, 0, 'overflow assembly should keep the body starting at page 0 when nothing is reserved');
            assert.equal(overflowingBundle.assembly.omittedTocPageCount, 1, 'overflow assembly should report the omitted TOC pages');
            assert.deepEqual(
                overflowingBundle.assembly.bodyFinalPageIndexByBodyPageIndex,
                [0],
                'overflow assembly should keep body pages mapped to their original final positions when no front matter was reserved'
            );
            assert.deepEqual(
                overflowingBundle.assembly.tocFinalPageIndexByTocPageIndex,
                [null],
                'overflow assembly should report omitted TOC pages with null final-page mapping'
            );
            assert.deepEqual(
                resolvePhysicalPageReference(printSnapshot, 0, overflowingBundle.assembly),
                {
                    originalPageIndex: 0,
                    finalPageIndex: 0,
                    originalPageLabel: '1',
                    finalPageLabel: '1',
                    originalLinkTarget: '#page=1',
                    finalLinkTarget: '#page=1'
                },
                'generic page-reference resolution should preserve body-page references when reserved TOC overflow leaves the body in place'
            );
            assert.deepEqual(
                overflowingBundle.bodyPageReferences,
                [
                    {
                        originalPageIndex: 0,
                        finalPageIndex: 0,
                        originalPageLabel: '1',
                        finalPageLabel: '1',
                        originalLinkTarget: '#page=1',
                        finalLinkTarget: '#page=1'
                    }
                ],
                'overflow bundle should still expose stable body-page references when the body remains at its original positions'
            );
            assert.deepEqual(
                overflowingBundle.navigation.assembledHeadingOutline.map((entry) => ({
                    sourceId: entry.sourceId,
                    pageIndex: entry.pageIndex
                })),
                [
                    { sourceId: headingTelemetry[0]?.sourceId, pageIndex: 0 },
                    { sourceId: headingTelemetry[1]?.sourceId, pageIndex: 0 }
                ],
                'overflow bundle should preserve assembled heading positions when front matter overflow leaves the body in place'
            );
            assert.equal(
                overflowingBundle.navigation.sourceAnchorsBySourceId[headingTelemetry[0]?.sourceId || '']?.finalLinkTarget,
                '#page=1',
                'overflow bundle should preserve source anchor targets when body pages remain unmoved'
            );
            assert.equal(
                overflowingBundle.getSourceAnchor(headingTelemetry[0]?.sourceId || '')?.finalLinkTarget,
                '#page=1',
                'overflow bundle sourceId lookup should preserve source anchor targets when body pages remain unmoved'
            );

            const noTocEngine = new LayoutEngine(config);
            await noTocEngine.waitForFonts();
            noTocEngine.simulate(elements as any);
            const noTocBundle = await noTocEngine.buildPrintPipelineArtifacts();
            assert.equal(noTocBundle.tableOfContents.declared, false, 'print artifact bundle should report no TOC declaration when absent');
            assert.equal(noTocBundle.tableOfContents.status, 'not-configured', 'print artifact bundle should distinguish the unconfigured case');
            assert.equal(noTocBundle.tableOfContents.plan, null, 'print artifact bundle should omit TOC plan when none is configured');
            assert.equal(noTocBundle.assembly.status, 'body-only', 'assembly plan should report body-only composition when no TOC is configured');
            assert.equal(noTocBundle.assembly.reservedFrontMatterPageCount, 0, 'body-only assembly should not reserve front matter pages');
            assert.equal(noTocBundle.assembly.bodyStartPageIndex, 0, 'body-only assembly should start the body at page 0');
            assert.deepEqual(
                noTocBundle.assembly.bodyFinalPageIndexByBodyPageIndex,
                [0],
                'body-only assembly should expose identity body-page mappings'
            );
            assert.deepEqual(
                noTocBundle.assembly.tocFinalPageIndexByTocPageIndex,
                [],
                'body-only assembly should expose no TOC page mappings'
            );
            assert.deepEqual(
                noTocBundle.bodyPageReferences,
                [
                    {
                        originalPageIndex: 0,
                        finalPageIndex: 0,
                        originalPageLabel: '1',
                        finalPageLabel: '1',
                        originalLinkTarget: '#page=1',
                        finalLinkTarget: '#page=1'
                    }
                ],
                'body-only bundle should expose identity body-page references for host consumers'
            );
            assert.deepEqual(
                noTocBundle.navigation.assembledBookmarkTree.map((entry) => ({
                    sourceId: entry.sourceId,
                    pageIndex: entry.pageIndex,
                    children: entry.children.map((child) => ({
                        sourceId: child.sourceId,
                        pageIndex: child.pageIndex
                    }))
                })),
                [
                    {
                        sourceId: headingTelemetry[0]?.sourceId,
                        pageIndex: 0,
                        children: [{ sourceId: headingTelemetry[1]?.sourceId, pageIndex: 0 }]
                    }
                ],
                'body-only bundle should expose identity assembled bookmark data when no front matter is inserted'
            );
            assert.equal(
                noTocBundle.navigation.sourceAnchorsBySourceId[headingTelemetry[1]?.sourceId || '']?.finalLinkTarget,
                '#page=1',
                'body-only bundle should expose identity source anchor targets when no assembly remapping occurs'
            );
            assert.equal(
                noTocBundle.getSourceAnchor(headingTelemetry[1]?.sourceId || '')?.finalLinkTarget,
                '#page=1',
                'body-only bundle sourceId lookup should expose identity source anchor targets when no assembly remapping occurs'
            );

            const [mainHeading, subHeading] = headingTelemetry;
            assert.ok(
                matchesSourceId(mainHeading?.sourceId, 'heading-main'),
                'heading telemetry should include the first heading sourceId'
            );
            assert.equal(mainHeading?.heading, 'Architecture Overhaul', 'heading telemetry should preserve the first heading text');
            assert.equal(mainHeading?.pageIndex, 0, 'heading telemetry should record the first heading page');
            assert.equal(mainHeading?.actorKind, 'h1', 'heading telemetry should preserve the first heading actorKind');
            assert.equal(mainHeading?.sourceType, 'h1', 'heading telemetry should preserve the first heading sourceType');
            assert.equal(mainHeading?.level, 1, 'heading telemetry should publish the first heading level');

            assert.ok(
                matchesSourceId(subHeading?.sourceId, 'heading-sub'),
                'heading telemetry should include the second heading sourceId'
            );
            assert.equal(subHeading?.heading, 'Subsystem Handoff', 'heading telemetry should preserve the second heading text');
            assert.equal(subHeading?.pageIndex, 0, 'heading telemetry should record the second heading page');
            assert.equal(subHeading?.actorKind, 'h2', 'heading telemetry should preserve the second heading actorKind');
            assert.equal(subHeading?.sourceType, 'h2', 'heading telemetry should preserve the second heading sourceType');
            assert.equal(subHeading?.level, 2, 'heading telemetry should publish the second heading level');

            assert.ok(
                Number(mainHeading?.y || 0) < Number(subHeading?.y || 0),
                'heading telemetry should remain ordered by committed page position'
            );
        }
    );

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
                { type: 'p', content: sharedText, properties: { sourceId: 'probe-first', pageReservationAfter: 100 } },
                { type: 'p', content: sharedText, properties: { sourceId: 'probe-second' } }
            ];

            const baselinePages = engine.simulate(baselineElements as any);
            const reservedPages = engine.simulate(reservedElements as any);

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
                    pageReservationOnFirstPageStart: 120
                }
            } as any);
            await pageStartReservationEngine.waitForFonts();

            const pageStartReservedPages = pageStartReservationEngine.simulate(baselineElements as any);
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
                    pageReservationOnFirstPageStart: 20,
                    pageStartReservationSelector: 'odd'
                }
            } as any);
            await oddSelectorEngine.waitForFonts();

            const oddSelectorPages = oddSelectorEngine.simulate(multiPageElements as any);
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
                    pageStartExclusionTop: 20,
                    pageStartExclusionHeight: 35,
                    pageStartExclusionSelector: 'first'
                }
            } as any);
            await exclusionEngine.waitForFonts();

            const exclusionPages = exclusionEngine.simulate(baselineElements as any);
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
                    pageStartExclusionTop: 20,
                    pageStartExclusionHeight: 45,
                    pageStartExclusionLeftWidth: 80,
                    pageStartExclusionSelector: 'first'
                }
            } as any);
            await laneExclusionEngine.waitForFonts();

            const laneExclusionPages = laneExclusionEngine.simulate(baselineElements as any);
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
                    pageStartExclusionTop: 20,
                    pageStartExclusionHeight: 45,
                    pageStartExclusionLeftWidth: 70,
                    pageStartExclusionRightWidth: 70,
                    pageStartExclusionSelector: 'first'
                }
            } as any);
            await centeredLaneExclusionEngine.waitForFonts();

            const centeredLanePages = centeredLaneExclusionEngine.simulate(baselineElements as any);
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

            const interiorExclusionEngine = new LayoutEngine({
                ...config,
                layout: {
                    ...config.layout,
                    pageStartExclusionTop: 20,
                    pageStartExclusionHeight: 45,
                    pageStartExclusionX: 90,
                    pageStartExclusionWidth: 80,
                    pageStartExclusionSelector: 'first'
                }
            } as any);
            await interiorExclusionEngine.waitForFonts();

            const interiorExclusionPages = interiorExclusionEngine.simulate(baselineElements as any);
            assert.equal(interiorExclusionPages.length, 1, 'interior exclusion probe should negotiate a same-page lane');

            const interiorFirstBox = findFirstBoxForSource(interiorExclusionPages, 'probe-first');
            assert.ok(interiorFirstBox, 'interior exclusion probe should still emit the first actor');
            assert.ok(
                Number(interiorFirstBox.x || 0) > Number(baselineFirstBox?.x || 0) + 40,
                'interior exclusion probe should shift the first actor into the wider right-hand lane'
            );
            assert.ok(
                Number(interiorFirstBox.y || 0) <= baselineFirstY + 1,
                'interior exclusion probe should not defer vertically when a same-page horizontal lane is available'
            );

            const interiorExclusionSession = interiorExclusionEngine.getLastSimulationReportReader();
            const interiorExclusionSummary = interiorExclusionSession.require(simulationArtifactKeys.pageExclusionSummary);
            assert.equal(interiorExclusionSummary.length, 1, 'interior exclusion probe should publish one exclusion summary entry');
            assert.equal(interiorExclusionSummary[0]?.exclusionCount, 1, 'interior exclusion probe should publish one interior exclusion shape');

            const multiInteriorExclusionEngine = new LayoutEngine({
                ...config,
                layout: {
                    ...config.layout,
                    pageStartExclusionTop: 20,
                    pageStartExclusionHeight: 45,
                    pageStartExclusionX: 30,
                    pageStartExclusionWidth: 40,
                    pageStartExclusionX2: 220,
                    pageStartExclusionWidth2: 40,
                    pageStartExclusionSelector: 'first'
                }
            } as any);
            await multiInteriorExclusionEngine.waitForFonts();

            const multiInteriorElements = [
                {
                    type: 'p',
                    content: 'Lane probe.',
                    properties: {
                        sourceId: 'probe-first',
                        style: { marginBottom: 0 }
                    }
                },
                {
                    type: 'p',
                    content: sharedText,
                    properties: { sourceId: 'probe-second' }
                }
            ];
            const multiInteriorPages = multiInteriorExclusionEngine.simulate(multiInteriorElements as any);
            assert.equal(multiInteriorPages.length, 1, 'multi-interior exclusion probe should negotiate a same-page lane');

            const multiInteriorFirstBox = findFirstBoxForSource(multiInteriorPages, 'probe-first');
            assert.ok(multiInteriorFirstBox, 'multi-interior exclusion probe should still emit the first actor');
            const baselineFirstX = Number(baselineFirstBox?.x || 0);
            const multiInteriorX = Number(multiInteriorFirstBox.x || 0);
            assert.equal(
                multiInteriorX,
                baselineFirstX,
                'multi-interior exclusion probe should restore full-width placement when the fragmented band does not yield an acceptable lane'
            );
            assert.ok(
                Number(multiInteriorFirstBox.y || 0) > baselineFirstY + 20,
                'multi-interior exclusion probe should defer below the fragmented exclusion band instead of forcing a bad lateral fit'
            );

            const multiInteriorSession = multiInteriorExclusionEngine.getLastSimulationReportReader();
            const multiInteriorSummary = multiInteriorSession.require(simulationArtifactKeys.pageExclusionSummary);
            const multiInteriorSpatialSummary = multiInteriorSession.require(simulationArtifactKeys.pageSpatialConstraintSummary);
            assert.equal(multiInteriorSummary.length, 1, 'multi-interior exclusion probe should publish one summary entry');
            assert.equal(multiInteriorSummary[0]?.exclusionCount, 2, 'multi-interior exclusion probe should publish both interior exclusion shapes');
            assert.equal(multiInteriorSpatialSummary[0]?.exclusionCount, 2, 'unified spatial summary should reflect both interior exclusions');

            const narrowLaneProbeEngine = new LayoutEngine({
                ...config,
                layout: {
                    ...config.layout,
                    pageStartExclusionTop: 20,
                    pageStartExclusionHeight: 45,
                    pageStartExclusionX: 60,
                    pageStartExclusionWidth: 40,
                    pageStartExclusionX2: 210,
                    pageStartExclusionWidth2: 40,
                    pageStartExclusionSelector: 'first'
                }
            } as any);
            await narrowLaneProbeEngine.waitForFonts();

            const narrowLaneElements = [
                {
                    type: 'p',
                    content: 'Narrow lane probe.',
                    properties: {
                        sourceId: 'probe-narrow',
                        style: { fontSize: 10, marginBottom: 0 }
                    }
                },
                {
                    type: 'p',
                    content: sharedText,
                    properties: { sourceId: 'probe-after-narrow' }
                }
            ];

            const narrowLanePages = narrowLaneProbeEngine.simulate(narrowLaneElements as any);
            assert.equal(narrowLanePages.length, 1, 'narrow multi-interior probe should stay on one page');

            const narrowLaneFirstBox = findFirstBoxForSource(narrowLanePages, 'probe-narrow');
            assert.ok(narrowLaneFirstBox, 'narrow multi-interior probe should emit the first actor');
            const narrowLaneX = Number(narrowLaneFirstBox.x || 0);
            assert.equal(
                narrowLaneX,
                baselineFirstX,
                'narrow multi-interior probe should still prefer restored full-width placement over fragmented same-band lanes'
            );
            assert.ok(
                Number(narrowLaneFirstBox.y || 0) > baselineFirstY + 20,
                'narrow multi-interior probe should also defer below the fragmented band instead of forcing a narrow actor through it'
            );

            const narrowLaneSession = narrowLaneProbeEngine.getLastSimulationReportReader();
            const narrowLaneSummary = narrowLaneSession.require(simulationArtifactKeys.pageExclusionSummary);
            const narrowLaneSpatialSummary = narrowLaneSession.require(simulationArtifactKeys.pageSpatialConstraintSummary);
            assert.equal(narrowLaneSummary.length, 1, 'narrow multi-interior probe should publish one summary entry');
            assert.equal(narrowLaneSummary[0]?.exclusionCount, 2, 'narrow multi-interior probe should publish both interior exclusion shapes');
            assert.equal(narrowLaneSpatialSummary[0]?.exclusionCount, 2, 'unified spatial summary should reflect both narrow-lane exclusions');

            const dropcapLaneEngine = new LayoutEngine({
                ...config,
                layout: {
                    ...config.layout,
                    pageStartExclusionTop: 20,
                    pageStartExclusionHeight: 45,
                    pageStartExclusionLeftWidth: 70,
                    pageStartExclusionRightWidth: 70,
                    pageStartExclusionSelector: 'first'
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

            const dropcapLanePages = dropcapLaneEngine.simulate(dropcapElements as any);
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
                    pageStartExclusionTop: 20,
                    pageStartExclusionHeight: 45,
                    pageStartExclusionLeftWidth: 70,
                    pageStartExclusionRightWidth: 70,
                    pageStartExclusionSelector: 'first'
                }
            } as any);
            await centeredLaneStoryEngine.waitForFonts();

            const baselineStoryPages = baselineStoryEngine.simulate(baselineStoryElements as any);
            const centeredLaneStoryPages = centeredLaneStoryEngine.simulate(baselineStoryElements as any);

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

    await checkAsync(
        'transformable actor cloning probe',
        'two independent multi-page tables each emit their own repeated-header clones and clone summaries without leaking into each other',
        async () => {
            const config = buildCloneProbeConfig();
            const engine = new LayoutEngine(config);
            await engine.waitForFonts();

            const elements = [
                {
                    type: 'p',
                    content: 'Transformable actor clone probe. Two multi-page tables must each repeat their own headers as explicit clones.'
                },
                buildCloneProbeTable('clone-a', 14),
                {
                    type: 'p',
                    content: 'Interlude. Ordinary flow resumes between the first and second cloned-table seams.',
                    properties: { sourceId: 'clone-probe-interlude' }
                },
                buildCloneProbeTable('clone-b', 14),
                {
                    type: 'p',
                    content: 'Postlude. The clone system should leave normal flow intact after both tables.',
                    properties: { sourceId: 'clone-probe-postlude' }
                }
            ];

            const pages = engine.simulate(elements as any);
            assert.ok(pages.length >= 4, 'clone probe should span several pages');

            const allBoxes = pages.flatMap((page: any) => page.boxes || []);
            const matchesSourceId = (actual: unknown, expected: string): boolean => {
                const value = String(actual || '');
                return value === expected || value.endsWith(`:${expected}`);
            };
            const clonedHeaders = allBoxes.filter((box: any) =>
                box.type === 'table_cell'
                && box.meta?.transformKind === 'clone'
                && typeof box.meta?.sourceId === 'string'
                && (
                    String(box.meta.sourceId).includes('clone-a-h-')
                    || String(box.meta.sourceId).includes('clone-b-h-')
                )
            );
            assert.ok(clonedHeaders.length > 0, 'clone probe should emit cloned continuation headers');

            const clonedHeaderIds = clonedHeaders.map((box: any) => String(box.meta?.sourceId || ''));
            ['clone-a-h-id', 'clone-a-h-task', 'clone-a-h-note', 'clone-b-h-id', 'clone-b-h-task', 'clone-b-h-note'].forEach((id) => {
                assert.ok(clonedHeaderIds.some((actual) => matchesSourceId(actual, id)), `clone probe should clone header cell ${id}`);
            });

            const reader = engine.getLastSimulationReportReader();
            const transformSummary = reader.require(simulationArtifactKeys.transformSummary);
            ['clone-a-h-id', 'clone-a-h-task', 'clone-a-h-note', 'clone-b-h-id', 'clone-b-h-task', 'clone-b-h-note'].forEach((id) => {
                const entry = transformSummary.find((item: any) => matchesSourceId(item?.sourceId, id));
                assert.ok(entry, `clone probe should publish transform summary for ${id}`);
                assert.equal(entry?.transformKind, 'clone', `clone probe should classify ${id} as clone`);
                assert.ok(Number(entry?.count || 0) > 0, `clone probe should count cloned emissions for ${id}`);
                assert.ok(Array.isArray(entry?.pageIndices) && entry.pageIndices.length > 0, `clone probe should report page indices for ${id}`);
            });

            const postludeBoxes = allBoxes.filter((box: any) => {
                const actual = String(box.meta?.sourceId || '');
                return actual === 'clone-probe-postlude' || actual.endsWith(':clone-probe-postlude');
            });
            assert.equal(postludeBoxes.length, 1, 'clone probe should leave the postlude as a single ordinary flow box');
        }
    );

    console.log(`[engine-regression.spec] OK (${fixtures.length} fixtures)`);
}

run().catch((err) => {
    console.error('[engine-regression.spec] FAILED', err);
    process.exit(1);
});

