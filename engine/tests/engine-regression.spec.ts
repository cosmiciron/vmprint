import assert from 'node:assert/strict';

import fs from 'node:fs';
import path from 'node:path';
import { LayoutEngine } from '../src/engine/layout-engine';
import { ContextRenderer } from '../src/engine/context-renderer';
import {
    HARNESS_REGRESSION_CASES_DIR,
    MockContext,
    assertAdvancedLayoutSignals,
    assertAdvancedRenderSignals,
    assertFlatPipelineInvariants,
    snapshotPages,
    loadLocalFontManager
} from './harness/engine-harness';
import { CURRENT_DOCUMENT_VERSION, CURRENT_IR_VERSION, resolveDocumentSourceText, toLayoutConfig } from '../src';
import { loadAstJsonDocumentFixtures } from './harness/ast-fixture-harness';
import { LayoutUtils } from '../src/engine/layout/layout-utils';
import {
    simulationArtifactKeys
} from '../src/engine/layout/simulation-report';
import { setDefaultEngineRuntime } from '../src/engine/runtime';
import { createPrintEngineRuntime } from '../src/font-management/runtime';
import { LayoutSession } from '../src/engine/layout/layout-session';
import { reactiveProofPackagerFactory } from './support/reactive-proof-packager-factory';

const UPDATE_LAYOUT_SNAPSHOTS =
    process.argv.includes('--update-layout-snapshots') || process.env.VMPRINT_UPDATE_LAYOUT_SNAPSHOTS === '1';
import { logStep, check, checkAsync, assertNoInputMutation as _assertNoInputMutation } from './harness/test-utils';
const TEST_PREFIX = 'engine-regression.spec';
const log = (msg: string) => logStep(TEST_PREFIX, msg);
const _check = (desc: string, exp: string, fn: () => void) => check(TEST_PREFIX, desc, exp, fn);
const _checkAsync = (desc: string, exp: string, fn: () => Promise<void>) => checkAsync(TEST_PREFIX, desc, exp, fn);
const assertNoInputMutation = (elements: any[], fixtureName: string) => _assertNoInputMutation(assert, elements, fixtureName);

function flattenBoxText(box: any): string {
    if (typeof box?.text === 'string' && box.text.length > 0) return box.text;
    if (!Array.isArray(box?.lines)) return '';
    return box.lines
        .flatMap((line: any[]) => line || [])
        .map((segment: any) => String(segment?.text || ''))
        .join('');
}

function boxesForSourceId(pages: any[], sourceId: string): any[] {
    return pages.flatMap((page: any) =>
        (page.boxes || []).filter((box: any) => {
            const actual = String(box.meta?.sourceId || '');
            return actual === sourceId || actual.endsWith(`:${sourceId}`);
        })
    );
}

function pageIndexesForSourceId(pages: any[], sourceId: string): number[] {
    return pages.flatMap((page: any, pageIndex: number) =>
        (page.boxes || []).some((box: any) => {
            const actual = String(box.meta?.sourceId || '');
            return actual === sourceId || actual.endsWith(`:${sourceId}`);
        })
            ? [pageIndex]
            : []
    );
}

function longParagraph(seed: string, repeatCount = 40): string {
    return `${seed} `.repeat(repeatCount).trim();
}

function repeatedParagraph(seed: string, repeatCount: number): string {
    return `${seed} `.repeat(repeatCount).trim();
}

function assertArabicMixedBidiSignals(pages: any[], fixtureName: string): void {
    if (fixtureName !== '18-multilingual-arabic.json') return;

    const segments = pages
        .flatMap((page: any) => page.boxes || [])
        .flatMap((box: any) => box.lines || [])
        .flatMap((line: any[]) => line || []);

    const findSegment = (text: string) => segments.find((segment: any) => segment?.text === text);
    const expectSegment = (text: string) => {
        const segment = findSegment(text);
        assert.ok(segment, `${fixtureName}: expected segment "${text}"`);
        return segment;
    };

    const arabicSegment = expectSegment('مرحبا');
    assert.ok(
        Array.isArray(arabicSegment.shapedGlyphs) && arabicSegment.shapedGlyphs.length > 0,
        `${fixtureName}: expected Arabic segment to retain shaped glyphs`
    );

    const embeddedLatin = expectSegment('VMPrint');
    assert.equal(embeddedLatin.direction, 'ltr', `${fixtureName}: embedded Latin token should stay LTR`);
    assert.equal(embeddedLatin.shapedGlyphs, undefined, `${fixtureName}: embedded Latin token should not be RTL-shaped`);

    const embeddedVersion = expectSegment('0.1.0');
    assert.equal(embeddedVersion.direction, 'ltr', `${fixtureName}: embedded version token should stay LTR`);
    assert.equal(embeddedVersion.shapedGlyphs, undefined, `${fixtureName}: embedded version token should not be RTL-shaped`);

    const embeddedNumber =
        findSegment('100') ??
        findSegment('100%');
    assert.ok(
        embeddedNumber,
        `${fixtureName}: expected numeric token "100" or combined token "100%"`
    );
    assert.equal(embeddedNumber.shapedGlyphs, undefined, `${fixtureName}: embedded numeric token should not be RTL-shaped`);

    const embeddedPercent = findSegment('%');
    if (embeddedPercent) {
        assert.equal(embeddedPercent.shapedGlyphs, undefined, `${fixtureName}: embedded percent token should not be RTL-shaped`);
    }

    const embeddedGroupedNumber = expectSegment('123,456');
    assert.equal(
        embeddedGroupedNumber.shapedGlyphs,
        undefined,
        `${fixtureName}: grouped numeric token should not be RTL-shaped`
    );
}

function createReactiveProofEngine(overrides: Record<string, unknown> = {}): LayoutEngine {
    const layoutOverrides = (overrides.layout as Record<string, unknown>) || {};
    const engine = new LayoutEngine({
        layout: {
            pageSize: 'LETTER',
            margins: { top: 72, right: 72, bottom: 72, left: 72 },
            fontFamily: 'Helvetica',
            fontSize: 12,
            lineHeight: 1.2,
            ...layoutOverrides
        },
        fonts: {
            regular: 'Helvetica'
        },
        styles: {},
        ...overrides,
        layout: {
            pageSize: 'LETTER',
            margins: { top: 72, right: 72, bottom: 72, left: 72 },
            fontFamily: 'Helvetica',
            fontSize: 12,
            lineHeight: 1.2,
            ...layoutOverrides
        }
    } as any);
    engine.setPackagerFactory(reactiveProofPackagerFactory);
    return engine;
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
    assert.ok(
        topFirst && topContinuation && topFirst.pageIndex !== topContinuation.pageIndex,
        `${fixtureName}: expected page-top-split to span across pages`
    );
}

function assertWorldPlainDefaultContinueSignals(pages: any[], fixtureName: string): void {
    assert.ok(pages.length >= 2, `${fixtureName}: expected default worldPlain fixture to span at least two pages`);
    assert.deepEqual(
        pageIndexesForSourceId(pages, 'plain-default-lead'),
        [0],
        `${fixtureName}: lead paragraph should begin on page 1`
    );
    assert.ok(
        pageIndexesForSourceId(pages, 'plain-default-main').some((pageIndex) => pageIndex >= 1),
        `${fixtureName}: main world body should continue onto a later page`
    );
    assert.ok(
        pageIndexesForSourceId(pages, 'plain-default-later').some((pageIndex) => pageIndex >= 1),
        `${fixtureName}: later world paragraph should remain visible in continued world flow`
    );
}

function assertWorldPlainSpanningSignals(pages: any[], fixtureName: string): void {
    assert.ok(pages.length >= 2, `${fixtureName}: expected spanning worldPlain fixture to span at least two pages`);
    assert.deepEqual(
        pageIndexesForSourceId(pages, 'plain-spanning-lead'),
        [0],
        `${fixtureName}: spanning lead paragraph should begin on page 1`
    );
    assert.ok(
        pageIndexesForSourceId(pages, 'plain-spanning-main').some((pageIndex) => pageIndex >= 1),
        `${fixtureName}: spanning world body should continue onto a later page`
    );
    assert.ok(
        pageIndexesForSourceId(pages, 'plain-spanning-later').some((pageIndex) => pageIndex >= 1),
        `${fixtureName}: later spanning world paragraph should remain visible in continued world flow`
    );
}

function assertWorldPlainConservativeSignals(pages: any[], fixtureName: string): void {
    assert.equal(pages.length, 1, `${fixtureName}: expected conservative worldPlain override fixture to remain on a single page`);
    assert.ok(
        boxesForSourceId(pages, 'plain-conservative-main').length > 0,
        `${fixtureName}: conservative main world body should still render`
    );
    assert.ok(
        boxesForSourceId(pages, 'plain-conservative-later').length > 0,
        `${fixtureName}: conservative trailing world paragraph should still render`
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
            capabilitySummary.some((entry: any) => Array.isArray(entry?.supportedReshapes) && entry.supportedReshapes.includes(kind)),
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
            Array.isArray(entry?.supportedReshapes) && entry.supportedReshapes.includes(kind),
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
            Array.isArray(entry?.supportedReshapes) && entry.supportedReshapes.includes(kind),
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

function assertCircleFloatSignals(pages: any[], fixtureName: string): void {
    const allBoxes = pages.flatMap((page: any) => page.boxes || []);

    // All three circle floats must produce image boxes.
    const imageBoxes = allBoxes.filter((box: any) => !!box.image);
    assert.ok(imageBoxes.length >= 3, `${fixtureName}: expected at least 3 image boxes (one per circle float)`);

    // Text boxes with non-uniform _lineWidths must be present — the resolver fired.
    const wrappedBoxes = allBoxes.filter((box: any) => {
        const lw: number[] = Array.isArray(box.properties?._lineWidths)
            ? box.properties._lineWidths.map((n: any) => Number(n))
            : [];
        if (lw.length < 3) return false;
        return Math.max(...lw) - Math.min(...lw) > 4;
    });
    assert.ok(wrappedBoxes.length >= 2, `${fixtureName}: expected text boxes with non-uniform _lineWidths from circle wrap`);

    // Circle arcs must carve more than two distinct line widths within a single
    // wrapped paragraph — rectangles produce only two (constrained / full).
    // Three or more distinct widths (rounded to 0.5pt bins) proves the arc is
    // shaping each scanline individually.
    const hasArcGradient = wrappedBoxes.some((box: any) => {
        const lw: number[] = (box.properties._lineWidths as any[]).map((n: any) => Number(n));
        const bins = new Set(lw.map((w) => Math.round(w * 2) / 2));
        return bins.size >= 3;
    });
    assert.ok(hasArcGradient, `${fixtureName}: expected at least one text box with 3+ distinct line widths proving arc carving`);

    const centerWrapBox = allBoxes.find((box: any) =>
        (box.lines || []).some((line: any[]) =>
            line.some((seg: any) => String(seg.text || '').includes('A centred circle'))
        )
    );
    assert.ok(centerWrapBox, `${fixtureName}: expected centered-circle paragraph box`);
    if (centerWrapBox) {
        const widths: number[] = Array.isArray(centerWrapBox.properties?._lineWidths)
            ? centerWrapBox.properties._lineWidths.map((n: any) => Number(n))
            : [];
        const offsets: number[] = Array.isArray(centerWrapBox.properties?._lineOffsets)
            ? centerWrapBox.properties._lineOffsets.map((n: any) => Number(n))
            : [];
        const constrainedPairs = widths
            .map((width, index) => ({ width, offset: Number(offsets[index] || 0), index }))
            .filter((entry) => entry.width < 300);
        assert.ok(constrainedPairs.length >= 6, `${fixtureName}: expected centered circle to constrain multiple split intervals`);

        const widthBins = new Set(constrainedPairs.map((entry) => Math.round(entry.width * 2) / 2));
        assert.ok(widthBins.size >= 3, `${fixtureName}: centered circle should vary the split interval widths across scanlines`);

        const rightOffsets = constrainedPairs
            .map((entry) => entry.offset)
            .filter((offset) => offset > 0.1);
        const rightOffsetBins = new Set(rightOffsets.map((offset) => Math.round(offset * 2) / 2));
        assert.ok(rightOffsetBins.size >= 3, `${fixtureName}: centered circle should shift the right-hand split interval across scanlines`);
    }
}

function assertExclusionAssemblySignals(pages: any[], fixtureName: string): void {
    const allBoxes = pages.flatMap((page: any) => page.boxes || []);
    const imageBoxes = allBoxes.filter((box: any) => !!box.image);
    assert.ok(imageBoxes.length >= 1, `${fixtureName}: expected the assembly proof to emit an image box`);

    const wrappedBoxes = allBoxes.filter((box: any) => {
        const widths: number[] = Array.isArray(box.properties?._lineWidths)
            ? box.properties._lineWidths.map((n: any) => Number(n))
            : [];
        return widths.length >= 4 && Math.max(...widths) - Math.min(...widths) > 8;
    });
    assert.ok(wrappedBoxes.length >= 1, `${fixtureName}: expected a wrapped paragraph with non-uniform line widths`);

    const targetBox = wrappedBoxes
        .map((box: any) => {
            const widths: number[] = Array.isArray(box.properties?._lineWidths)
                ? box.properties._lineWidths.map((n: any) => Number(n))
                : [];
            const offsets: number[] = Array.isArray(box.properties?._lineOffsets)
                ? box.properties._lineOffsets.map((n: any) => Number(n))
                : [];
            const constrained = widths
                .map((width, index) => ({ width, offset: Number(offsets[index] || 0) }))
                .filter((entry) => entry.offset > 0.1);
            return { box, constrained };
        })
        .sort((left, right) => right.constrained.length - left.constrained.length)[0]?.box;
    assert.ok(targetBox, `${fixtureName}: expected the lead assembly paragraph box`);
    if (!targetBox) return;

    const widths: number[] = Array.isArray(targetBox.properties?._lineWidths)
        ? targetBox.properties._lineWidths.map((n: any) => Number(n))
        : [];
    const offsets: number[] = Array.isArray(targetBox.properties?._lineOffsets)
        ? targetBox.properties._lineOffsets.map((n: any) => Number(n))
        : [];
    const constrained = widths
        .map((width, index) => ({ width, offset: Number(offsets[index] || 0) }))
        .filter((entry) => entry.offset > 0.1);
    assert.ok(constrained.length >= 4, `${fixtureName}: expected several offset lines from the composed field`);
    const widthBins = new Set(constrained.map((entry) => Math.round(entry.width * 2) / 2));
    assert.ok(widthBins.size >= 3, `${fixtureName}: expected the composed field to generate at least three distinct wrapped widths`);
}

function assertPolygonFloatSignals(pages: any[], fixtureName: string): void {
    const allBoxes = pages.flatMap((page: any) => page.boxes || []);

    const polygonImages = allBoxes.filter((box: any) =>
        !!box.image && box.properties?._clipShape === 'polygon'
    );
    assert.ok(polygonImages.length >= 1, `${fixtureName}: expected at least one polygon-clipped image box`);
    assert.ok(
        polygonImages.some((box: any) => typeof box.properties?._clipPath === 'string' && box.properties._clipPath.length > 0),
        `${fixtureName}: expected polygon image box to preserve authored clip path`
    );

    const wrappedBox = allBoxes
        .filter((box: any) => {
            const widths: number[] = Array.isArray(box.properties?._lineWidths)
                ? box.properties._lineWidths.map((n: any) => Number(n))
                : [];
            const offsets: number[] = Array.isArray(box.properties?._lineOffsets)
                ? box.properties._lineOffsets.map((n: any) => Number(n))
                : [];
            return widths.length >= 6 && offsets.some((offset) => Number.isFinite(offset) && offset > 0.5);
        })
        .sort((left: any, right: any) => {
            const leftOffsets: number[] = Array.isArray(left.properties?._lineOffsets)
                ? left.properties._lineOffsets.map((n: any) => Number(n)).filter((n: number) => n > 0.5)
                : [];
            const rightOffsets: number[] = Array.isArray(right.properties?._lineOffsets)
                ? right.properties._lineOffsets.map((n: any) => Number(n)).filter((n: number) => n > 0.5)
                : [];
            return rightOffsets.length - leftOffsets.length;
        })[0];
    assert.ok(wrappedBox, `${fixtureName}: expected wrapped polygon paragraph box`);
    if (!wrappedBox) return;

    const widths: number[] = Array.isArray(wrappedBox.properties?._lineWidths)
        ? wrappedBox.properties._lineWidths.map((n: any) => Number(n))
        : [];
    const offsets: number[] = Array.isArray(wrappedBox.properties?._lineOffsets)
        ? wrappedBox.properties._lineOffsets.map((n: any) => Number(n))
        : [];
    assert.ok(widths.length >= 6, `${fixtureName}: expected several measured lines in wrapped polygon paragraph`);
    assert.ok(offsets.some((offset) => Number.isFinite(offset) && offset > 0.5), `${fixtureName}: expected polygon wrap to shift at least one line`);
    assert.ok(offsets.some((offset) => Number.isFinite(offset) && offset <= 0.5), `${fixtureName}: expected polygon wrap to restore near-full-width lines after the obstacle`);

    const constrainedWidths = widths.filter((width, index) => Number(offsets[index] || 0) > 0.5);
    const widthBins = new Set(constrainedWidths.map((width) => Math.round(width * 2) / 2));
    assert.ok(widthBins.size >= 3, `${fixtureName}: expected polygon silhouette to produce at least three distinct constrained widths`);
}

function assertPolygonCarryoverSignals(pages: any[], fixtureName: string, engine?: any): void {
    assert.ok(pages.length >= 2, `${fixtureName}: expected polygon carry-over proof to span at least two pages`);

    const page0 = pages[0];
    const page1 = pages[1];
    const firstPagePolygon = (page0?.boxes || []).find((box: any) =>
        !!box.image && box.properties?._clipShape === 'polygon'
    );
    assert.ok(firstPagePolygon, `${fixtureName}: expected a polygon-clipped float image on the first page`);
    assert.ok(
        Number(firstPagePolygon?.y || 0) + Number(firstPagePolygon?.h || 0) <= 332.5,
        `${fixtureName}: expected the first-page polygon visual to be clipped at the page content boundary`
    );
    const carriedPolygon = (page1?.boxes || []).find((box: any) =>
        !!box.image
        && Number(box.y || 0) < 48
    );
    assert.ok(carriedPolygon, `${fixtureName}: expected the carried polygon image remainder to remain visible at the top of page two`);
    assert.ok(
        Number(carriedPolygon?.h || 0) > 0 && Number(carriedPolygon?.h || 0) < Number(firstPagePolygon?.h || 0),
        `${fixtureName}: expected the carried polygon remainder to be cropped smaller than the original float`
    );

    const continuationWrapped = (page1?.boxes || [])
        .filter((box: any) => {
            const offsets: number[] = Array.isArray(box.properties?._lineOffsets)
                ? box.properties._lineOffsets.map((n: any) => Number(n))
                : [];
            const widths: number[] = Array.isArray(box.properties?._lineWidths)
                ? box.properties._lineWidths.map((n: any) => Number(n))
                : [];
            return Number(box.y || 0) < 140
                && offsets.some((offset) => Number.isFinite(offset) && offset > 0.5)
                && widths.length >= 3;
        })
        .sort((left: any, right: any) => Number(left.y || 0) - Number(right.y || 0))[0];
    assert.ok(continuationWrapped, `${fixtureName}: expected a top-of-page continuation paragraph to wrap around the carried polygon`);
    if (!continuationWrapped) return;

    const offsets: number[] = Array.isArray(continuationWrapped.properties?._lineOffsets)
        ? continuationWrapped.properties._lineOffsets.map((n: any) => Number(n))
        : [];
    const widths: number[] = Array.isArray(continuationWrapped.properties?._lineWidths)
        ? continuationWrapped.properties._lineWidths.map((n: any) => Number(n))
        : [];
    const constrainedWidths = widths.filter((width, index) => Number(offsets[index] || 0) > 0.5);
    const widthBins = new Set(constrainedWidths.map((width) => Math.round(width * 2) / 2));
    assert.ok(widthBins.size >= 2, `${fixtureName}: expected carried polygon wrap to vary continuation widths near the top of page two`);

    const report = engine?.getLastSimulationReport?.();
    const profile = report?.profile;
    assert.ok(profile, `${fixtureName}: expected simulation profile for carry-over performance assertions`);
    assert.equal(profile?.speculativeBranchCalls ?? 0, 0, `${fixtureName}: carry-over pagination should not require speculative branch snapshots`);
    assert.equal(profile?.progressionSnapshotCalls ?? 0, 0, `${fixtureName}: carry-over pagination should not restore progression snapshots`);
    assert.equal(profile?.checkpointRecordCalls ?? 0, 0, `${fixtureName}: carry-over pagination should not record boundary checkpoints`);
    assert.equal(profile?.boundaryCheckpointCalls ?? 0, 0, `${fixtureName}: carry-over pagination should not sweep page-boundary checkpoints`);
    assert.ok(
        Number(profile?.keepWithNextPlanMs ?? 0) < 40,
        `${fixtureName}: keep-with-next lookahead should remain on the capped continuation probe path`
    );
}

function assertPolygonCarryoverRightSignals(pages: any[], fixtureName: string): void {
    assert.ok(pages.length >= 2, `${fixtureName}: expected right-aligned polygon carry-over proof to span at least two pages`);
    const page0 = pages[0];
    const page1 = pages[1];
    const firstPagePolygon = (page0?.boxes || []).find((box: any) =>
        !!box.image && box.properties?._clipShape === 'polygon'
    );
    assert.ok(firstPagePolygon, `${fixtureName}: expected a polygon-clipped float image on the first page`);

    const carriedPolygon = (page1?.boxes || []).find((box: any) =>
        !!box.image && Number(box.y || 0) < 48
    );
    assert.ok(carriedPolygon, `${fixtureName}: expected the carried polygon remainder to be visible near the top of page two`);
    assert.ok(Number(carriedPolygon?.x || 0) > 200, `${fixtureName}: expected the carried polygon remainder to stay right-aligned on page two`);

    const continuationWrapped = (page1?.boxes || [])
        .filter((box: any) => {
            const offsets: number[] = Array.isArray(box.properties?._lineOffsets)
                ? box.properties._lineOffsets.map((n: any) => Number(n))
                : [];
            const widths: number[] = Array.isArray(box.properties?._lineWidths)
                ? box.properties._lineWidths.map((n: any) => Number(n))
                : [];
            return Number(box.y || 0) < 140 && widths.length >= 3;
        })
        .sort((left: any, right: any) => Number(left.y || 0) - Number(right.y || 0))[0];
    assert.ok(continuationWrapped, `${fixtureName}: expected a top-of-page continuation paragraph on page two`);
    if (!continuationWrapped) return;

    const widths: number[] = Array.isArray(continuationWrapped.properties?._lineWidths)
        ? continuationWrapped.properties._lineWidths.map((n: any) => Number(n))
        : [];
    assert.ok(widths.some((width) => Number.isFinite(width) && width < Math.max(...widths) - 12), `${fixtureName}: expected right carry-over to constrain continuation widths`);
}

function assertPolygonTopBottomCarryoverSignals(pages: any[], fixtureName: string): void {
    assert.ok(pages.length >= 2, `${fixtureName}: expected top-bottom carry-over proof to span at least two pages`);
    const page0 = pages[0];
    const page1 = pages[1];
    const firstPagePolygon = (page0?.boxes || []).find((box: any) =>
        !!box.image && box.properties?._clipShape === 'polygon'
    );
    assert.ok(firstPagePolygon, `${fixtureName}: expected a top-bottom polygon float on the first page`);
    const carriedPolygon = (page1?.boxes || []).find((box: any) =>
        !!box.image && Number(box.y || 0) < 48
    );
    assert.ok(carriedPolygon, `${fixtureName}: expected the carried top-bottom polygon remainder to remain visible at the top of page two`);
    if (!carriedPolygon) return;

    const firstTextBox = (page1?.boxes || [])
        .filter((box: any) => Array.isArray(box.lines) && box.lines.length > 0)
        .sort((left: any, right: any) => Number(left.y || 0) - Number(right.y || 0))[0];
    assert.ok(firstTextBox, `${fixtureName}: expected text content on page two`);
    if (!firstTextBox) return;

    const polygonBottom = Number(carriedPolygon.y || 0) + Number(carriedPolygon.h || 0);
    assert.ok(Number(firstTextBox.y || 0) >= polygonBottom + 6, `${fixtureName}: expected top-bottom continuation text to start below the carried polygon remainder`);
    const offsets: number[] = Array.isArray(firstTextBox.properties?._lineOffsets)
        ? firstTextBox.properties._lineOffsets.map((n: any) => Number(n))
        : [];
    assert.ok(offsets.every((offset) => !Number.isFinite(offset) || offset <= 0.5), `${fixtureName}: expected top-bottom continuation text to clear vertically rather than side-wrap`);
}

function assertPolygonMultiColumnCarryoverSignals(pages: any[], fixtureName: string): void {
    assert.ok(pages.length >= 2, `${fixtureName}: expected multi-column polygon carry-over proof to span at least two pages`);
    const page1 = pages[1];
    const carriedPolygon = (page1?.boxes || []).find((box: any) =>
        !!box.image && Number(box.y || 0) < 48
    );
    assert.ok(carriedPolygon, `${fixtureName}: expected a carried polygon remainder at the top of the continuation page`);
    if (!carriedPolygon) return;

    const continuationWrapped = (page1?.boxes || [])
        .filter((box: any) => {
            const lines: any[] = Array.isArray(box.lines) ? box.lines : [];
            return (
                Number(box.y || 0) < 140
                && Math.abs(Number(box.x || 0) - Number(carriedPolygon.x || 0)) <= 2
                && lines.length >= 3
            );
        })
        .sort((left: any, right: any) => Number(left.y || 0) - Number(right.y || 0))[0];
    assert.ok(continuationWrapped, `${fixtureName}: expected the continuation column to begin with wrapped text beside the carried polygon remainder`);
    if (!continuationWrapped) return;

    const widths: number[] = (Array.isArray(continuationWrapped.lines) ? continuationWrapped.lines : []).map((line: any[]) =>
        (Array.isArray(line) ? line : []).reduce((sum: number, fragment: any) => sum + Number(fragment?.width || 0), 0)
    );
    const bins = new Set(widths.map((width) => Math.round(width * 2) / 2));
    assert.ok(bins.size >= 2, `${fixtureName}: expected multi-column carry-over to preserve varied constrained widths in the continuation column`);
}

function assertPolygonMixedShapesSignals(pages: any[], fixtureName: string): void {
    const allBoxes = pages.flatMap((page: any) => page.boxes || []);
    assert.ok(pages.length >= 2, `${fixtureName}: expected the mixed-shape proof to span more than one page`);

    const imageBoxes = allBoxes.filter((box: any) => !!box.image);
    assert.ok(imageBoxes.length >= 4, `${fixtureName}: expected several visible obstacle images across the document`);

    const polygonImages = imageBoxes.filter((box: any) =>
        box.properties?._clipShape === 'polygon'
    );
    assert.ok(polygonImages.length >= 2, `${fixtureName}: expected at least two polygon-clipped image boxes`);

    const circleImages = imageBoxes.filter((box: any) =>
        box.properties?._clipShape === 'circle'
    );
    assert.ok(circleImages.length >= 1, `${fixtureName}: expected at least one circle-clipped image box`);

    const assemblyImages = imageBoxes.filter((box: any) =>
        Array.isArray(box.properties?._clipAssembly) && box.properties._clipAssembly.length >= 2
    );
    assert.ok(assemblyImages.length >= 1, `${fixtureName}: expected at least one exclusion-assembly image box`);

    const clipPaths = polygonImages
        .map((box: any) => String(box.properties?._clipPath || '').trim())
        .filter((path: string) => path.length > 0);
    assert.ok(clipPaths.length >= 2, `${fixtureName}: expected polygon images to preserve authored clip paths`);
    assert.equal(new Set(clipPaths).size, clipPaths.length, `${fixtureName}: expected each polygon image to keep a distinct silhouette path`);

    const wrappedBoxes = allBoxes
        .filter((box: any) => {
            const widths: number[] = Array.isArray(box.properties?._lineWidths)
                ? box.properties._lineWidths.map((n: any) => Number(n))
                : [];
            const offsets: number[] = Array.isArray(box.properties?._lineOffsets)
                ? box.properties._lineOffsets.map((n: any) => Number(n))
                : [];
            return widths.length >= 4 && offsets.some((offset) => Number.isFinite(offset) && offset > 0.5);
        })
        .sort((left: any, right: any) => Number(left.y || 0) - Number(right.y || 0));
    assert.ok(wrappedBoxes.length >= 4, `${fixtureName}: expected several wrapped paragraph boxes across the mixed-shape document`);

    const widthSignatures = wrappedBoxes.slice(0, 4).map((box: any) => {
        const widths: number[] = Array.isArray(box.properties?._lineWidths)
            ? box.properties._lineWidths.map((n: any) => Number(n))
            : [];
        const offsets: number[] = Array.isArray(box.properties?._lineOffsets)
            ? box.properties._lineOffsets.map((n: any) => Number(n))
            : [];
        const constrainedWidths = widths
            .filter((width, index) => Number(offsets[index] || 0) > 0.5)
            .map((width) => Math.round(width * 2) / 2);
        return constrainedWidths.join('|');
    });
    assert.ok(new Set(widthSignatures).size >= 3, `${fixtureName}: expected mixed obstacle lanes to produce several distinct constrained width signatures`);
}

function collectConstrainedLineWidths(boxes: any[]): number[] {
    return boxes.flatMap((box: any) => {
        const widths: number[] = Array.isArray(box.properties?._lineWidths)
            ? box.properties._lineWidths.map((n: any) => Number(n))
            : [];
        const offsets: number[] = Array.isArray(box.properties?._lineOffsets)
            ? box.properties._lineOffsets.map((n: any) => Number(n))
            : [];
        return widths.filter((width, index) =>
            Number.isFinite(width) && Number(offsets[index] || 0) > 0.5
        );
    });
}

function assertPolygonExpressiveLaneSignals(pages: any[], fixtureName: string): void {
    const allBoxes = pages.flatMap((page: any) => page.boxes || []);
    assert.ok(pages.length >= 2, `${fixtureName}: expected the expressive polygon proof to span more than one page`);

    const polygonImages = allBoxes.filter((box: any) =>
        !!box.image && box.properties?._clipShape === 'polygon'
    );
    assert.ok(polygonImages.length >= 3, `${fixtureName}: expected visible polygon carry-over plus both authored polygon floats`);

    const clipPaths = polygonImages
        .map((box: any) => String(box.properties?._clipPath || '').trim())
        .filter((path: string) => path.length > 0);
    assert.ok(clipPaths.length >= 3, `${fixtureName}: expected expressive polygon boxes to preserve authored clip paths through carry-over`);
    assert.ok(new Set(clipPaths).size >= 2, `${fixtureName}: expected at least two distinct authored polygon silhouettes`);

    const constrainedWidths = collectConstrainedLineWidths(allBoxes);
    assert.ok(constrainedWidths.length >= 12, `${fixtureName}: expected many constrained lines when micro lanes are fully allowed`);
    assert.ok(
        constrainedWidths.some((width) => width <= 10),
        `${fixtureName}: expected expressive mode to preserve absurdly tiny legal sliver lanes`
    );
    assert.ok(
        constrainedWidths.some((width) => width > 30 && width < 80),
        `${fixtureName}: expected expressive mode to retain narrow but still readable mid-sized lanes`
    );
    assert.ok(
        constrainedWidths.some((width) => width >= 180),
        `${fixtureName}: expected expressive mode to also preserve broader constrained lanes from the same authored shapes`
    );
}

function assertPolygonEditorialLaneSignals(pages: any[], fixtureName: string): void {
    const allBoxes = pages.flatMap((page: any) => page.boxes || []);
    assert.ok(pages.length >= 2, `${fixtureName}: expected the editorial polygon proof to span more than one page`);

    const polygonImages = allBoxes.filter((box: any) =>
        !!box.image && box.properties?._clipShape === 'polygon'
    );
    assert.ok(polygonImages.length >= 3, `${fixtureName}: expected visible polygon carry-over plus both authored polygon floats`);

    const clipPaths = polygonImages
        .map((box: any) => String(box.properties?._clipPath || '').trim())
        .filter((path: string) => path.length > 0);
    assert.ok(clipPaths.length >= 3, `${fixtureName}: expected editorial polygon boxes to preserve authored clip paths through carry-over`);
    assert.ok(new Set(clipPaths).size >= 2, `${fixtureName}: expected at least two distinct authored polygon silhouettes`);

    const constrainedWidths = collectConstrainedLineWidths(allBoxes);
    assert.ok(constrainedWidths.length >= 3, `${fixtureName}: expected editorial mode to keep some honest wrap interaction with the polygons`);
    assert.ok(
        constrainedWidths.every((width) => width >= 60),
        `${fixtureName}: expected editorial mode to reject the truly tiny micro-lane shards`
    );
    assert.ok(
        constrainedWidths.filter((width) => width < 80).length <= 1,
        `${fixtureName}: expected editorial mode to keep at most one narrow but still usable lane`
    );
    assert.ok(
        constrainedWidths.some((width) => width >= 180),
        `${fixtureName}: expected editorial mode to preserve broad useful lanes rather than deferring everything`
    );
}

function assertZoneMapExclusionAssemblySignals(pages: any[], fixtureName: string): void {
    const allBoxes = pages.flatMap((page: any) => page.boxes || []);
    const hiddenFieldActors = allBoxes.filter((box: any) =>
        String(box.type || '').toLowerCase() === 'field-actor'
        && Number(box.w || 0) >= 200
    );
    assert.ok(hiddenFieldActors.length >= 1, `${fixtureName}: expected a large invisible field actor in the main zone`);

    const wrappedBoxes = allBoxes.filter((box: any) => {
        const widths: number[] = Array.isArray(box.properties?._lineWidths)
            ? box.properties._lineWidths.map((n: any) => Number(n))
            : [];
        const offsets: number[] = Array.isArray(box.properties?._lineOffsets)
            ? box.properties._lineOffsets.map((n: any) => Number(n))
            : [];
        return widths.length >= 4 && offsets.some((offset) => Number(offset || 0) > 0.1);
    });
    assert.ok(wrappedBoxes.length >= 1, `${fixtureName}: expected a wrapped story paragraph inside the zone-map`);
}

function assertZoneMapNativeFieldSignals(pages: any[], fixtureName: string): void {
    const allBoxes = pages.flatMap((page: any) => page.boxes || []);
    const fieldActorBoxes = allBoxes.filter((box: any) =>
        String(box.type || '').toLowerCase() === 'field-actor'
        && Number(box.w || 0) >= 90
        && Number(box.y || 0) >= 170
    );
    assert.ok(fieldActorBoxes.length >= 2, `${fixtureName}: expected visible placed native zone field actors`);

    const wrappedParagraphs = allBoxes.filter((box: any) => {
        if (String(box.type || '').toLowerCase() !== 'p') return false;
        const debug = box.properties?.__vmprintZoneDebug;
        if (!debug || debug.zoneId !== 'main') return false;
        const offsets = Array.isArray(box.properties?._lineOffsets)
            ? box.properties._lineOffsets.map((n: any) => Number(n)).filter((n: number) => Number.isFinite(n))
            : [];
        const yOffsets = Array.isArray(box.properties?._lineYOffsets)
            ? box.properties._lineYOffsets.map((n: any) => Number(n)).filter((n: number) => Number.isFinite(n))
            : [];
        if (offsets.length < 2 || yOffsets.length < 2) return false;
        const seen = new Map<number, Set<string>>();
        for (let i = 0; i < Math.min(offsets.length, yOffsets.length); i++) {
            const key = Number(yOffsets[i]).toFixed(2);
            const set = seen.get(yOffsets[i]) ?? new Set<string>();
            set.add(Number(offsets[i]).toFixed(2));
            seen.set(yOffsets[i], set);
            if (set.size >= 2) return true;
        }
        return false;
    });
    assert.ok(
        wrappedParagraphs.length >= 1,
        `${fixtureName}: expected ordinary zone paragraphs to split into multiple scanline slots around the placed native fields`
    );
}

function assertZoneMapAbsoluteRockSignals(pages: any[], fixtureName: string): void {
    const allBoxes = pages.flatMap((page: any) => page.boxes || []);
    const rockBoxes = allBoxes.filter((box: any) =>
        String(box.type || '').toLowerCase() === 'field-actor'
        && Number(box.w || 0) >= 140
        && Number(box.x || 0) >= 120
        && Number(box.y || 0) >= 190
    );
    assert.ok(rockBoxes.length >= 1, `${fixtureName}: expected a visible absolute-positioned rock actor in the main zone`);

    const wrappedParagraphs = allBoxes.filter((box: any) => {
        if (String(box.type || '').toLowerCase() !== 'p') return false;
        const debug = box.properties?.__vmprintZoneDebug;
        if (!debug || debug.zoneId !== 'main') return false;
        const offsets = Array.isArray(box.properties?._lineOffsets)
            ? box.properties._lineOffsets.map((n: any) => Number(n)).filter((n: number) => Number.isFinite(n))
            : [];
        const yOffsets = Array.isArray(box.properties?._lineYOffsets)
            ? box.properties._lineYOffsets.map((n: any) => Number(n)).filter((n: number) => Number.isFinite(n))
            : [];
        if (offsets.length < 2 || yOffsets.length < 2) return false;
        const bands = new Map<string, Set<string>>();
        for (let i = 0; i < Math.min(offsets.length, yOffsets.length); i++) {
            const bandKey = Number(yOffsets[i]).toFixed(2);
            const set = bands.get(bandKey) ?? new Set<string>();
            set.add(Number(offsets[i]).toFixed(2));
            bands.set(bandKey, set);
            if (set.size >= 2) return true;
        }
        return false;
    });
    assert.ok(
        wrappedParagraphs.length >= 1,
        `${fixtureName}: expected ordinary zone labels to split into multiple scanline slots around the absolute rock`
    );
}

function assertZoneMapSpanningContinueSignals(pages: any[], fixtureName: string): void {
    if (fixtureName !== '39-zone-map-spanning-continue.json') return;

    const findPagesForSource = (sourceId: string): number[] => {
        const indices = new Set<number>();
        pages.forEach((page: any, pageIndex: number) => {
            (page.boxes || []).forEach((box: any) => {
                const actual = String(box.meta?.sourceId || '');
                if (actual === sourceId || actual.endsWith(`:${sourceId}`)) {
                    indices.add(pageIndex);
                }
            });
        });
        return Array.from(indices.values()).sort((a, b) => a - b);
    };

    assert.deepEqual(findPagesForSource('main-zone-open'), [0], `${fixtureName}: expected main zone opening content to start on page 1`);
    assert.deepEqual(findPagesForSource('side-zone-label'), [0], `${fixtureName}: expected side zone label to start on page 1`);
    assert.ok(
        findPagesForSource('main-zone-tail').some((pageIndex) => pageIndex >= 1),
        `${fixtureName}: expected tail content to continue onto a later page`
    );
    assert.ok(
        findPagesForSource('post-zone-flow').every((pageIndex) => pageIndex >= 1),
        `${fixtureName}: expected downstream ordinary flow to remain after the continued zone host`
    );
}

function assertZoneMapSpanningFieldCarryoverSignals(pages: any[], fixtureName: string): void {
    if (fixtureName !== '40-zone-map-spanning-field-carryover.json') return;

    const findPagesForSource = (sourceId: string): number[] => {
        const indices = new Set<number>();
        pages.forEach((page: any, pageIndex: number) => {
            (page.boxes || []).forEach((box: any) => {
                const actual = String(box.meta?.sourceId || '');
                if (actual === sourceId || actual.endsWith(`:${sourceId}`)) {
                    indices.add(pageIndex);
                }
            });
        });
        return Array.from(indices.values()).sort((a, b) => a - b);
    };

    assert.ok(findPagesForSource('zone-carryover-rock').includes(0), `${fixtureName}: expected zone rock on the first page`);
    assert.ok(
        findPagesForSource('zone-carryover-rock').some((pageIndex) => pageIndex >= 1),
        `${fixtureName}: expected zone rock to persist onto a later continuation page`
    );
    assert.ok(
        findPagesForSource('zone-carryover-body').some((pageIndex) => pageIndex >= 1),
        `${fixtureName}: expected regional body flow to continue onto a later page`
    );
    assert.ok(
        findPagesForSource('post-zone-carryover-flow').every((pageIndex) => pageIndex >= 1),
        `${fixtureName}: expected downstream flow only after zone continuation pages`
    );
}

function assertZoneMapSpanningMultiParticipantSignals(pages: any[], fixtureName: string, engine: any): void {
    if (fixtureName !== '41-zone-map-spanning-multi-participant.json') return;

    const findPagesForSource = (sourceId: string): number[] => {
        const indices = new Set<number>();
        pages.forEach((page: any, pageIndex: number) => {
            (page.boxes || []).forEach((box: any) => {
                const actual = String(box.meta?.sourceId || '');
                if (actual === sourceId || actual.endsWith(`:${sourceId}`)) {
                    indices.add(pageIndex);
                }
            });
        });
        return Array.from(indices.values()).sort((a, b) => a - b);
    };

    const hearthPages = findPagesForSource('zone-multi-hearth');
    const sideMarkerPages = findPagesForSource('zone-multi-side-marker');
    const mainBodyPages = findPagesForSource('zone-multi-main-body');
    const sideBodyPages = findPagesForSource('zone-multi-side-body');
    const postFlowPages = findPagesForSource('post-zone-multi-flow');

    assert.ok(hearthPages.includes(0), `${fixtureName}: expected main hearth on the first page`);
    assert.ok(sideMarkerPages.includes(0), `${fixtureName}: expected side marker on the first page`);
    assert.ok(
        hearthPages.some((pageIndex) => pageIndex >= 1),
        `${fixtureName}: expected main hearth to persist onto a later continuation page`
    );
    assert.ok(
        sideMarkerPages.some((pageIndex) => pageIndex >= 1),
        `${fixtureName}: expected side marker to persist onto a later continuation page`
    );
    assert.ok(
        mainBodyPages.some((pageIndex) => pageIndex >= 1),
        `${fixtureName}: expected main regional body to continue onto a later page`
    );
    assert.ok(
        sideBodyPages.some((pageIndex) => pageIndex >= 1),
        `${fixtureName}: expected side regional body to continue onto a later page`
    );
    assert.ok(
        postFlowPages.every((pageIndex) => pageIndex >= 1),
        `${fixtureName}: expected downstream flow only after the multi-participant zone continuation`
    );

    const reader = engine.getLastSimulationReportReader?.();
    assert.ok(reader?.has(simulationArtifactKeys.pageRegionSummary), `${fixtureName}: expected pageRegionSummary in simulation report`);
    const pageRegionSummary = reader.require(simulationArtifactKeys.pageRegionSummary);
    const findRegionPages = (regionId: string): number[] => pageRegionSummary
        .filter((item: any) => Array.isArray(item?.debugRegions) && item.debugRegions.some((region: any) =>
            region?.sourceKind === 'zone-map' && (region?.regionId === regionId || region?.zoneId === regionId)
        ))
        .map((item: any) => Number(item?.pageIndex))
        .filter((pageIndex: number) => Number.isFinite(pageIndex))
        .sort((a: number, b: number) => a - b);
    const mainRegionPages = findRegionPages('main');
    const sideRegionPages = findRegionPages('side');

    assert.ok(mainRegionPages.includes(0), `${fixtureName}: expected report to mark main region on first page`);
    assert.ok(sideRegionPages.includes(0), `${fixtureName}: expected report to mark side region on first page`);
    assert.ok(
        mainRegionPages.some((pageIndex: number) => pageIndex >= 1),
        `${fixtureName}: expected report to preserve main region identity across later pages`
    );
    assert.ok(
        sideRegionPages.some((pageIndex: number) => pageIndex >= 1),
        `${fixtureName}: expected report to preserve side region identity across later pages`
    );
}

function assertZoneMapScriptRegionQuerySignals(pages: any[], fixtureName: string, engine: any): void {
    if (fixtureName !== '42-zone-map-script-region-query.json') return;

    const reportBoxes = boxesForSourceId(pages, 'region-query-report');
    assert.ok(reportBoxes.length > 0, `${fixtureName}: expected script-populated region query report`);
    const reportText = reportBoxes.map((box: any) => flattenBoxText(box)).join(' ').replace(/\s+/g, ' ').trim();
    assert.notEqual(reportText, 'region query pending', `${fixtureName}: expected onReady script to rewrite the region report`);

    const reader = engine.getLastSimulationReportReader?.();
    assert.ok(reader?.has(simulationArtifactKeys.pageRegionSummary), `${fixtureName}: expected pageRegionSummary in simulation report`);
    const pageRegionSummary = reader.require(simulationArtifactKeys.pageRegionSummary);
    const findRegionPages = (regionId: string): number[] => pageRegionSummary
        .filter((item: any) => Array.isArray(item?.debugRegions) && item.debugRegions.some((region: any) =>
            region?.sourceKind === 'zone-map' && (region?.regionId === regionId || region?.zoneId === regionId)
        ))
        .map((item: any) => Number(item?.pageIndex) + 1)
        .filter((pageIndex: number) => Number.isFinite(pageIndex))
        .sort((a: number, b: number) => a - b);

    const expectedMain = findRegionPages('main');
    const expectedSide = findRegionPages('side');
    const expectedRegionCount = new Set(
        pageRegionSummary.flatMap((item: any) => (item?.debugRegions || [])
            .filter((region: any) => region?.sourceKind === 'zone-map')
            .map((region: any) => String(region?.stableKey || ''))
            .filter(Boolean))
    ).size;
    const expectedMembers = (regionId: string): string[] => {
        const memberSet = new Set<string>();
        for (const page of pages) {
            const regions = (page.debugRegions || []).filter((region: any) =>
                region?.sourceKind === 'zone-map' && (region?.regionId === regionId || region?.zoneId === regionId)
            );
            if (regions.length === 0) continue;
            for (const box of page.boxes || []) {
                const sourceId = String(box?.meta?.sourceId || '');
                if (!sourceId || box?.meta?.generated === true) continue;
                const intersects = regions.some((region: any) => {
                    const left = Number(box?.x || 0);
                    const top = Number(box?.y || 0);
                    const right = left + Math.max(0, Number(box?.w || 0));
                    const bottom = top + Math.max(0, Number(box?.h || 0));
                    const regionRight = Number(region?.x || 0) + Math.max(0, Number(region?.w || 0));
                    const regionBottom = Number(region?.y || 0) + Math.max(0, Number(region?.h || 0));
                    return right > Number(region?.x || 0)
                        && left < regionRight
                        && bottom > Number(region?.y || 0)
                        && top < regionBottom;
                });
                if (intersects) {
                    memberSet.add(sourceId);
                }
            }
        }
        return Array.from(memberSet).sort((a, b) => a.localeCompare(b));
    };
    const expectedMainMembers = expectedMembers('main');
    const expectedSideMembers = expectedMembers('side');

    assert.ok(reportText.includes(`regions=${expectedRegionCount}`), `${fixtureName}: expected region count in script report`);
    assert.ok(
        reportText.includes(`main:${expectedMain.join('/')}:${expectedMain.length}`),
        `${fixtureName}: expected main region pages in script report`
    );
    assert.ok(
        reportText.includes(`side:${expectedSide.join('/')}:${expectedSide.length}`),
        `${fixtureName}: expected side region pages in script report`
    );
    assert.ok(
        reportText.includes(`members=${expectedMainMembers.join('/')}`),
        `${fixtureName}: expected main region members in script report`
    );
    assert.ok(
        reportText.includes(`members=${expectedSideMembers.join('/')}`),
        `${fixtureName}: expected side region members in script report`
    );
}

function assertWorldPlainAbsoluteRockSignals(pages: any[], fixtureName: string): void {
    const allBoxes = pages.flatMap((page: any) => page.boxes || []);
    const rockBoxes = allBoxes.filter((box: any) =>
        String(box.type || '').toLowerCase() === 'field-actor'
        && Number(box.w || 0) >= 140
        && Number(box.x || 0) >= 180
        && Number(box.y || 0) >= 140
    );
    assert.ok(rockBoxes.length >= 1, `${fixtureName}: expected a visible absolute-positioned rock actor inside the world plain`);

    const wrappedParagraphs = allBoxes.filter((box: any) => {
        if (String(box.type || '').toLowerCase() !== 'p') return false;
        const debug = box.properties?.__vmprintZoneDebug;
        if (!debug || debug.zoneId !== 'plain') return false;
        const offsets = Array.isArray(box.properties?._lineOffsets)
            ? box.properties._lineOffsets.map((n: any) => Number(n)).filter((n: number) => Number.isFinite(n))
            : [];
        const yOffsets = Array.isArray(box.properties?._lineYOffsets)
            ? box.properties._lineYOffsets.map((n: any) => Number(n)).filter((n: number) => Number.isFinite(n))
            : [];
        if (offsets.length < 2 || yOffsets.length < 2) return false;
        const bands = new Map<string, Set<string>>();
        for (let i = 0; i < Math.min(offsets.length, yOffsets.length); i++) {
            const bandKey = Number(yOffsets[i]).toFixed(2);
            const set = bands.get(bandKey) ?? new Set<string>();
            set.add(Number(offsets[i]).toFixed(2));
            bands.set(bandKey, set);
            if (set.size >= 2) return true;
        }
        return false;
    });
    assert.ok(
        wrappedParagraphs.length >= 1,
        `${fixtureName}: expected ordinary world-plain labels to split into multiple scanline slots around the rock`
    );
}

function assertWorldPlainZOverpassSignals(pages: any[], fixtureName: string): void {
    const allBoxes = pages.flatMap((page: any) => page.boxes || []);
    const lowRockBoxes = allBoxes.filter((box: any) => {
        const sourceId = String(box.meta?.sourceId || '');
        return sourceId === 'plain-overpass-low-rock' || sourceId.endsWith(':plain-overpass-low-rock');
    });
    const highRockBoxes = allBoxes.filter((box: any) => {
        const sourceId = String(box.meta?.sourceId || '');
        return sourceId === 'plain-overpass-high-rock' || sourceId.endsWith(':plain-overpass-high-rock');
    });
    assert.ok(lowRockBoxes.length >= 1, `${fixtureName}: expected a visible lower-z rock actor inside the world plain`);
    assert.ok(highRockBoxes.length >= 1, `${fixtureName}: expected a visible same-z rock actor inside the world plain`);

    const wrappedParagraphs = allBoxes.filter((box: any) => {
        if (String(box.type || '').toLowerCase() !== 'p') return false;
        const sourceId = String(box.meta?.sourceId || '');
        if (!(sourceId === 'plain-overpass-body-late' || sourceId.endsWith(':plain-overpass-body-late'))) return false;
        const debug = box.properties?.__vmprintZoneDebug;
        if (!debug || debug.zoneId !== 'plain') return false;
        const offsets = Array.isArray(box.properties?._lineOffsets)
            ? box.properties._lineOffsets.map((n: any) => Number(n)).filter((n: number) => Number.isFinite(n))
            : [];
        const yOffsets = Array.isArray(box.properties?._lineYOffsets)
            ? box.properties._lineYOffsets.map((n: any) => Number(n)).filter((n: number) => Number.isFinite(n))
            : [];
        if (offsets.length < 2 || yOffsets.length < 2) return false;
        const bands = new Map<string, Set<string>>();
        for (let i = 0; i < Math.min(offsets.length, yOffsets.length); i++) {
            const bandKey = Number(yOffsets[i]).toFixed(2);
            const set = bands.get(bandKey) ?? new Set<string>();
            set.add(Number(offsets[i]).toFixed(2));
            bands.set(bandKey, set);
            if (set.size >= 2) return true;
        }
        return false;
    });
    assert.ok(
        wrappedParagraphs.length >= 1,
        `${fixtureName}: expected the higher-z river to wrap once it reaches the same-z rock`
    );

    const earlyRiverBoxes = allBoxes.filter((box: any) => {
        if (String(box.type || '').toLowerCase() !== 'p') return false;
        const sourceId = String(box.meta?.sourceId || '');
        return sourceId === 'plain-overpass-body-early' || sourceId.endsWith(':plain-overpass-body-early');
    });
    const earlyWrappedCount = earlyRiverBoxes.filter((box: any) => {
        const debug = box.properties?.__vmprintZoneDebug;
        if (!debug || debug.zoneId !== 'plain') return false;
        const offsets = Array.isArray(box.properties?._lineOffsets)
            ? box.properties._lineOffsets.map((n: any) => Number(n)).filter((n: number) => Number.isFinite(n))
            : [];
        const yOffsets = Array.isArray(box.properties?._lineYOffsets)
            ? box.properties._lineYOffsets.map((n: any) => Number(n)).filter((n: number) => Number.isFinite(n))
            : [];
        if (offsets.length < 2 || yOffsets.length < 2) return false;
        const bands = new Map<string, Set<string>>();
        for (let i = 0; i < Math.min(offsets.length, yOffsets.length); i++) {
            const bandKey = Number(yOffsets[i]).toFixed(2);
            const set = bands.get(bandKey) ?? new Set<string>();
            set.add(Number(offsets[i]).toFixed(2));
            bands.set(bandKey, set);
            if (set.size >= 2) return true;
        }
        return false;
    }).length;
    assert.equal(earlyWrappedCount, 0, `${fixtureName}: expected the early river to pass over the lower-z rock without wrap slots`);
}

function assertWorldPlainTraversingFlowSignals(pages: any[], fixtureName: string): void {
    const allBoxes = pages.flatMap((page: any) => page.boxes || []);
    const lowRockBoxes = allBoxes.filter((box: any) => {
        const sourceId = String(box.meta?.sourceId || '');
        return sourceId === 'plain-traverse-low-rock' || sourceId.endsWith(':plain-traverse-low-rock');
    });
    const highRockBoxes = allBoxes.filter((box: any) => {
        const sourceId = String(box.meta?.sourceId || '');
        return sourceId === 'plain-traverse-high-rock' || sourceId.endsWith(':plain-traverse-high-rock');
    });
    assert.ok(lowRockBoxes.length >= 1, `${fixtureName}: expected a visible lower-z world rock`);
    assert.ok(highRockBoxes.length >= 1, `${fixtureName}: expected a visible same-z world rock`);

    const paragraphWraps = (sourceIdNeedle: string): number =>
        allBoxes.filter((box: any) => {
            if (String(box.type || '').toLowerCase() !== 'p') return false;
            const sourceId = String(box.meta?.sourceId || '');
            if (!(sourceId === sourceIdNeedle || sourceId.endsWith(`:${sourceIdNeedle}`))) return false;
            const offsets = Array.isArray(box.properties?._lineOffsets)
                ? box.properties._lineOffsets.map((n: any) => Number(n)).filter((n: number) => Number.isFinite(n))
                : [];
            const yOffsets = Array.isArray(box.properties?._lineYOffsets)
                ? box.properties._lineYOffsets.map((n: any) => Number(n)).filter((n: number) => Number.isFinite(n))
                : [];
            if (offsets.length < 2 || yOffsets.length < 2) return false;
            const bands = new Map<string, Set<string>>();
            for (let i = 0; i < Math.min(offsets.length, yOffsets.length); i++) {
                const bandKey = Number(yOffsets[i]).toFixed(2);
                const set = bands.get(bandKey) ?? new Set<string>();
                set.add(Number(offsets[i]).toFixed(2));
                bands.set(bandKey, set);
                if (set.size >= 2) return true;
            }
            return false;
        }).length;

    assert.equal(
        paragraphWraps('plain-traverse-body-early'),
        0,
        `${fixtureName}: expected the early traversing paragraph to pass over the lower-z rock without wrap lanes`
    );
    assert.ok(
        paragraphWraps('plain-traverse-body-late') >= 1,
        `${fixtureName}: expected the later traversing paragraph to wrap around the same-z rock`
    );
}

function assertWorldPlainTraversalPolicySignals(pages: any[], fixtureName: string): void {
    const allBoxes = pages.flatMap((page: any) => page.boxes || []);
    const paragraphWraps = (sourceIdNeedle: string): number =>
        allBoxes.filter((box: any) => {
            if (String(box.type || '').toLowerCase() !== 'p') return false;
            const sourceId = String(box.meta?.sourceId || '');
            if (!(sourceId === sourceIdNeedle || sourceId.endsWith(`:${sourceIdNeedle}`))) return false;
            const offsets = Array.isArray(box.properties?._lineOffsets)
                ? box.properties._lineOffsets.map((n: any) => Number(n)).filter((n: number) => Number.isFinite(n))
                : [];
            const yOffsets = Array.isArray(box.properties?._lineYOffsets)
                ? box.properties._lineYOffsets.map((n: any) => Number(n)).filter((n: number) => Number.isFinite(n))
                : [];
            if (offsets.length < 2 || yOffsets.length < 2) return false;
            const bands = new Map<string, Set<string>>();
            for (let i = 0; i < Math.min(offsets.length, yOffsets.length); i++) {
                const bandKey = Number(yOffsets[i]).toFixed(2);
                const set = bands.get(bandKey) ?? new Set<string>();
                set.add(Number(offsets[i]).toFixed(2));
                bands.set(bandKey, set);
                if (set.size >= 2) return true;
            }
            return false;
        }).length;

    assert.ok(
        boxesForSourceId(pages, 'plain-policy-overpass-rock').length >= 1,
        `${fixtureName}: expected the explicit overpass rock to remain visible`
    );
    assert.ok(
        boxesForSourceId(pages, 'plain-policy-wrap-rock').length >= 1,
        `${fixtureName}: expected the explicit wrap rock to remain visible`
    );
    assert.equal(
        paragraphWraps('plain-policy-body-overpass'),
        0,
        `${fixtureName}: expected the authored overpass policy to suppress wrap even at the same depth`
    );
    assert.ok(
        paragraphWraps('plain-policy-body-wrap') >= 1,
        `${fixtureName}: expected the authored wrap policy to force wrap even across depth mismatch`
    );
}

function assertWorldPlainHostTraversalDefaultSignals(pages: any[], fixtureName: string): void {
    const allBoxes = pages.flatMap((page: any) => page.boxes || []);
    const paragraphWraps = (sourceIdNeedle: string): number =>
        allBoxes.filter((box: any) => {
            if (String(box.type || '').toLowerCase() !== 'p') return false;
            const sourceId = String(box.meta?.sourceId || '');
            if (!(sourceId === sourceIdNeedle || sourceId.endsWith(`:${sourceIdNeedle}`))) return false;
            const offsets = Array.isArray(box.properties?._lineOffsets)
                ? box.properties._lineOffsets.map((n: any) => Number(n)).filter((n: number) => Number.isFinite(n))
                : [];
            const yOffsets = Array.isArray(box.properties?._lineYOffsets)
                ? box.properties._lineYOffsets.map((n: any) => Number(n)).filter((n: number) => Number.isFinite(n))
                : [];
            if (offsets.length < 2 || yOffsets.length < 2) return false;
            const bands = new Map<string, Set<string>>();
            for (let i = 0; i < Math.min(offsets.length, yOffsets.length); i++) {
                const bandKey = Number(yOffsets[i]).toFixed(2);
                const set = bands.get(bandKey) ?? new Set<string>();
                set.add(Number(offsets[i]).toFixed(2));
                bands.set(bandKey, set);
                if (set.size >= 2) return true;
            }
            return false;
        }).length;
    const paragraphBoxes = (sourceIdNeedle: string): any[] =>
        allBoxes.filter((box: any) => {
            if (String(box.type || '').toLowerCase() !== 'p') return false;
            const sourceId = String(box.meta?.sourceId || '');
            return sourceId === sourceIdNeedle || sourceId.endsWith(`:${sourceIdNeedle}`);
        });

    assert.ok(
        boxesForSourceId(pages, 'plain-host-policy-default-rock').length >= 1,
        `${fixtureName}: expected the host-default rock to remain visible`
    );
    assert.ok(
        boxesForSourceId(pages, 'plain-host-policy-explicit-wrap-rock').length >= 1,
        `${fixtureName}: expected the explicit-wrap override rock to remain visible`
    );
    assert.equal(
        paragraphWraps('plain-host-policy-body-default'),
        0,
        `${fixtureName}: expected the world host default overpass policy to suppress wrap for an otherwise unannotated same-depth obstacle`
    );
    assert.ok(
        paragraphWraps('plain-host-policy-body-override') >= 1
        || paragraphBoxes('plain-host-policy-body-override').some((box: any) =>
            Number(box.x || 0) > 50.5 || Number(box.w || 0) < 499.5
        ),
        `${fixtureName}: expected the local wrap override to beat the world host default by forcing the traversing paragraph into a constrained wrap lane`
    );
}

function assertViewportCaptureSummarySignals(fixtureName: string, engine: any): void {
    const summary = engine
        .getLastSimulationReportReader()
        .require(simulationArtifactKeys.viewportCaptureSummary);

    assert.ok(summary.length > 0, `${fixtureName}: expected viewport capture summary entries`);

    for (const entry of summary) {
        assert.equal(
            entry.viewport.worldY,
            entry.pageIndex * entry.viewport.height,
            `${fixtureName}: expected viewport worldY to advance by page-height slices`
        );
        assert.ok(
            entry.worldSpace.exploredBottom >= entry.viewport.worldY + entry.viewport.height,
            `${fixtureName}: expected exploredBottom to cover at least the current viewport slice`
        );
    }
}

function assertWorldPlainTraversingViewportCaptureSignals(fixtureName: string, engine: any): void {
    const summary = engine
        .getLastSimulationReportReader()
        .require(simulationArtifactKeys.viewportCaptureSummary);
    assert.ok(summary.length >= 1, `${fixtureName}: expected at least one viewport capture summary entry`);
    assert.ok(
        summary.some((entry: any) => Number(entry.terrain.worldTraversalExclusionCount || 0) >= 1),
        `${fixtureName}: expected traversing-world viewport capture summary to record world-traversal obstacles`
    );
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

function assertStoryNestedTableContinuationSignals(pages: any[], fixtureName: string): void {
    if (fixtureName !== '22-story-nested-table-continuation.json') return;

    const matchesSourceId = (box: any, id: string): boolean => {
        const sourceId = String(box.meta?.sourceId || '');
        return sourceId === id || sourceId.endsWith(`:${id}`);
    };

    const pageTableCells = pages.map((page: any, pageIndex: number) => ({
        pageIndex,
        cells: (page.boxes || []).filter((box: any) => box.type === 'table_cell')
    })).filter((entry) => entry.cells.length > 0);

    assert.ok(pageTableCells.length >= 2, `${fixtureName}: expected nested table cells on at least two pages`);

    const firstTablePage = pageTableCells[0];
    const firstViewportOrigins = new Set(
        firstTablePage.cells
            .map((cell: any) => Number(cell.properties?._tableViewportWorldY))
            .filter((value: number) => Number.isFinite(value))
    );
    assert.ok(
        Array.from(firstViewportOrigins).some((value) => value > 0),
        `${fixtureName}: expected first-page nested table cells to carry a non-zero local viewport origin`
    );

    const continuationHeaders = pageTableCells
        .slice(1)
        .flatMap((entry) => entry.cells)
        .filter((cell: any) =>
            Number(cell.properties?._tableRowIndex) === 0
            && cell.meta?.transformKind === 'clone'
        );
    assert.ok(
        continuationHeaders.length > 0,
        `${fixtureName}: expected repeated header clones on continuation pages`
    );

    const firstRowPageIndexes = pageTableCells
        .filter((entry) => entry.cells.some((cell: any) => matchesSourceId(cell, 'nested-table-r01-id')))
        .map((entry) => entry.pageIndex);
    const lateRowPageIndexes = pageTableCells
        .filter((entry) => entry.cells.some((cell: any) => matchesSourceId(cell, 'nested-table-r12-id')))
        .map((entry) => entry.pageIndex);
    assert.ok(firstRowPageIndexes.includes(firstTablePage.pageIndex), `${fixtureName}: expected early table rows on the first table page`);
    assert.ok(
        lateRowPageIndexes.some((pageIndex) => pageIndex > firstTablePage.pageIndex),
        `${fixtureName}: expected late table rows to remain for continuation pages`
    );

    const tailPages = pages
        .map((page: any, pageIndex: number) => ({
            pageIndex,
            hasTail: (page.boxes || []).some((box: any) => matchesSourceId(box, 'nested-story-tail'))
        }))
        .filter((entry) => entry.hasTail)
        .map((entry) => entry.pageIndex);
    assert.ok(tailPages.length > 0, `${fixtureName}: expected downstream story tail content`);
    assert.ok(
        tailPages[0] >= pageTableCells[pageTableCells.length - 1].pageIndex,
        `${fixtureName}: expected downstream story tail to remain after nested table continuation`
    );
}

function assertStoryNestedStoryContinuationSignals(pages: any[], fixtureName: string): void {
    if (fixtureName !== '23-story-nested-story-continuation.json') return;

    const matchesSourceId = (box: any, id: string): boolean => {
        const sourceId = String(box.meta?.sourceId || '');
        return sourceId === id || sourceId.endsWith(`:${id}`);
    };

    const nestedPageEntries = pages
        .map((page: any, pageIndex: number) => ({
            pageIndex,
            boxes: (page.boxes || []).filter((box: any) =>
                matchesSourceId(box, 'nested-story-inner-a')
                || matchesSourceId(box, 'nested-story-inner-b')
                || matchesSourceId(box, 'nested-story-inner-c')
                || matchesSourceId(box, 'nested-story-inner-d')
                || matchesSourceId(box, 'nested-story-inner-e')
                || matchesSourceId(box, 'nested-story-inner-f')
            )
        }))
        .filter((entry) => entry.boxes.length > 0);

    assert.ok(nestedPageEntries.length >= 2, `${fixtureName}: expected nested story content on at least two pages`);

    const firstNestedBox = nestedPageEntries[0].boxes[0];
    assert.ok(
        Number(firstNestedBox.x || 0) > 150,
        `${fixtureName}: expected nested story to begin in the outer story's later lane`
    );

    const firstNestedPageIndexes = nestedPageEntries
        .filter((entry) => entry.boxes.some((box: any) => matchesSourceId(box, 'nested-story-inner-a')))
        .map((entry) => entry.pageIndex);
    const lateNestedPageIndexes = nestedPageEntries
        .filter((entry) => entry.boxes.some((box: any) => matchesSourceId(box, 'nested-story-inner-f')))
        .map((entry) => entry.pageIndex);

    assert.ok(
        firstNestedPageIndexes.includes(nestedPageEntries[0].pageIndex),
        `${fixtureName}: expected early nested story content on the first nested page`
    );
    assert.ok(
        lateNestedPageIndexes.some((pageIndex) => pageIndex > nestedPageEntries[0].pageIndex),
        `${fixtureName}: expected late nested story content to remain for continuation pages`
    );

    const tailPages = pages
        .map((page: any, pageIndex: number) => ({
            pageIndex,
            hasTail: (page.boxes || []).some((box: any) => matchesSourceId(box, 'nested-story-outer-tail'))
        }))
        .filter((entry) => entry.hasTail)
        .map((entry) => entry.pageIndex);

    assert.ok(tailPages.length > 0, `${fixtureName}: expected downstream outer-story tail content`);
    assert.ok(
        tailPages[0] >= nestedPageEntries[nestedPageEntries.length - 1].pageIndex,
        `${fixtureName}: expected downstream outer-story tail to remain after nested story continuation`
    );
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

    const pagesWithHeaders = [1, 2, 3, 4, 6, 7, 8, 9, 10];
    pagesWithHeaders.forEach((pi) => {
        const logo = headerBoxes[pi].find((box: any) => box.type === 'image');
        assert.ok(logo, `${fixtureName}: expected header logo image on page ${pi + 1}`);
    });

    // Footer uses a three-slot strip (work title | Page x of y | section title).
    // Verify the center folio resolves the logical number and the final page count.
    const folioPageIndices = [1, 2, 3, 4, 6, 7, 8, 9];
    const expectedNumbers = ['1', '2', '3', '4', '5', '6', '7', '8'];
    folioPageIndices.forEach((pi, i) => {
        const centerFolio = footerBoxes[pi].find((box: any) => box.type === 'folio-page');
        assert.ok(centerFolio, `${fixtureName}: expected folio-page footer box on page ${pi + 1}`);
        assert.equal(
            textOf(centerFolio),
            `Page ${expectedNumbers[i]} of 11`,
            `${fixtureName}: expected logical number "${expectedNumbers[i]}" and total "11" in center folio on page ${pi + 1}`
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
    assert.ok(reader.progression, `${fixtureName}: simulation report should expose progression summary`);
    assert.ok(reader.capture, `${fixtureName}: simulation report should expose capture summary`);
    assert.ok(reader.world, `${fixtureName}: simulation report should expose world summary`);
    assert.equal(reader.world?.progressionPolicy, 'until-settled', `${fixtureName}: world progressionPolicy mismatch`);
    assert.equal(reader.world?.capturePolicy, 'settle-immediately', `${fixtureName}: world capturePolicy mismatch`);
    assert.equal(reader.world?.stopReason, 'settled', `${fixtureName}: world stopReason mismatch`);
    assert.equal(reader.world?.captureMaxTicks, null, `${fixtureName}: world captureMaxTicks mismatch`);
    assert.equal(reader.world?.currentTick, reader.progression?.finalTick, `${fixtureName}: world/progression tick mismatch`);
    assert.ok((reader.world?.pageCaptures.length || 0) >= 1, `${fixtureName}: world summary should expose page captures`);
    assert.equal(reader.progression?.policy, 'until-settled', `${fixtureName}: progression policy mismatch`);
    assert.equal(reader.progression?.stopReason, 'settled', `${fixtureName}: progression stopReason mismatch`);
    assert.equal(reader.progression?.captureKind, 'finalized-pages', `${fixtureName}: progression captureKind mismatch`);
    assert.equal(reader.capture?.policy, 'settle-immediately', `${fixtureName}: capture policy mismatch`);
    assert.equal(reader.capture?.captureKind, 'finalized-pages', `${fixtureName}: capture captureKind mismatch`);
    assert.equal(reader.capture?.requestedMaxTicks, null, `${fixtureName}: capture requestedMaxTicks mismatch`);
    assert.equal(reader.capture?.satisfiedBy, 'settled', `${fixtureName}: capture satisfiedBy mismatch`);
    assert.equal(reader.capture?.capturedAtTick, reader.progression?.finalTick, `${fixtureName}: capture/progression tick mismatch`);
    assert.ok(
        Number.isFinite(reader.progression?.finalTick),
        `${fixtureName}: progression finalTick should be finite`
    );
    assert.ok(
        Number(reader.progression?.finalTick) >= 0,
        `${fixtureName}: progression finalTick should be non-negative`
    );
    assert.ok(
        Number(reader.progression?.finalTick) <= Number(reader.profile?.simulationTickCount ?? 0),
        `${fixtureName}: progression finalTick should not exceed cumulative simulationTickCount`
    );
    assert.equal(reader.progression?.progressionStopped, true, `${fixtureName}: progression should be stopped at capture`);
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
    assert.equal(
        pageRegionSummary.length,
        pages.length,
        `${fixtureName}: pageRegionSummary page count mismatch`
    );
    pageRegionSummary.forEach((item: any, pageIndex: number) => {
        assert.ok(Array.isArray(item?.debugRegions), `${fixtureName}: pageRegionSummary[${pageIndex}] should expose debugRegions`);
        assert.equal(
            Number(item?.debugRegionCount || 0),
            item.debugRegions.length,
            `${fixtureName}: pageRegionSummary[${pageIndex}] debugRegionCount mismatch`
        );
    });
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
    setDefaultEngineRuntime(createPrintEngineRuntime({ fontManager: new LocalFontManager() }));

    log('Scenario: fixture-driven deterministic pagination and renderer regression checks');
    const fixtures = loadAstJsonDocumentFixtures();
    _check(
        'fixture discovery',
        'at least one AST fixture is present in engine/tests/fixtures/regression',
        () => {
            assert.ok(fixtures.length > 0, 'no AST fixtures found in engine/tests/fixtures/regression');
        }
    );

    for (const fixture of fixtures) {
        log(`Fixture: ${fixture.name}`);
        const fixturePath = fixture.filePath;
        const fixtureRaw = fs.readFileSync(fixturePath, 'utf-8');
        const irA = resolveDocumentSourceText(fixtureRaw, fixturePath);
        const irB = resolveDocumentSourceText(fixtureRaw, fixturePath);

        _check(
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

        _check(
            `${fixture.name} flat pipeline invariants`,
            'finite geometry, measured lines fit, and no nested children in boxes',
            () => {
                assertFlatPipelineInvariants(pagesA, fixture.name);
            }
        );
        _check(
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
        _check(
            `${fixture.name} simulation report contract`,
            'simulate() produces a simulation report whose top-level counts and typed artifact sections are available',
            () => {
                assertSimulationReportSignals(engine, pagesA, fixture.name);
            }
        );
        _check(
            `${fixture.name} layout snapshot`,
            'matches stored snapshot',
            () => {
                assertSnapshot(fixture.name, pagesA);
            }
        );
        if (fixture.name.startsWith('05-page-size-') || fixture.name.startsWith('06-page-size-')) {
            _check(
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
            _check(
                `${fixture.name} advanced layout signals`,
                'advanced fixtures emit expected justification and soft-hyphen layout markers',
                () => {
                    assertAdvancedLayoutSignals(pagesA, fixture.name);
                }
            );
        }
        if (fixture.name === '18-multilingual-arabic.json') {
            _check(
                `${fixture.name} mixed bidi shaping signals`,
                'Arabic runs keep shaped glyphs while embedded Latin and number runs remain unshaped',
                () => {
                    assertArabicMixedBidiSignals(pagesA, fixture.name);
                }
            );
        }
        if (fixture.name === '14-flow-images-multipage.json') {
            _check(
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
            _check(
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
            _check(
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
            _check(
                `${fixture.name} mixed-span table signals`,
                'colSpan + rowSpan cells paginate deterministically with repeated headers, no span boundary splits, and table transform capabilities',
                () => {
                    assertTableMixedSpanFixtureSignals(pagesA, fixture.name, engine);
                    assertTransformCapabilitySignals(fixture.name, engine, ['split', 'clone', 'morph']);
                }
            );
        }
        if (fixture.name === '10-packager-split-scenarios.json') {
            _check(
                `${fixture.name} packager split scenarios`,
                'keepWithNext, mid-page table, and page-top overflow splits are all exercised',
                () => {
                    assertPackagerShatterShowcaseSignals(pagesA, fixture.name);
                }
            );
        }
        if (fixture.name === '19-accepted-split-branching.json') {
            _check(
                `${fixture.name} accepted split branching signals`,
                'two accepted-split seams each emit exactly one marker pair and leave no duplicated post-split residue behind',
                () => {
                    assertAcceptedSplitBranchingSignals(pagesA, fixture.name);
                }
            );
        }
        if (fixture.name === '08-dropcap-pagination.json') {
            _check(
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
            _check(
                `${fixture.name} split transform signals`,
                'split-heavy fixtures publish split transform summaries with continuation fragment indices and actor split capabilities',
                () => {
                    assertSplitTransformSignals(pagesA, fixture.name, engine);
                    assertTransformCapabilitySignals(fixture.name, engine, ['split']);
                }
            );
        }
        if (fixture.name === '24-toc-live-reactive.json') {
            _check(
                `${fixture.name} live TOC reactive signals`,
                'TOC actor placed before headings renders entries from committed heading signals, grows from signal accumulation, and body content follows after the TOC',
                () => {
                    const tocBoxes = pagesA.flatMap((page, pageIndex) =>
                        page.boxes.filter((box: any) => box.type === 'toc').map((box: any) => ({ pageIndex, box }))
                    );
                    assert.ok(tocBoxes.length > 0, `${fixture.name}: expected at least one toc box in output`);

                    const tocText = tocBoxes.map(({ box }: any) => {
                        if (typeof box.content === 'string') return box.content;
                        if (Array.isArray(box.lines)) {
                            return box.lines.map((line: any[]) => line.map((seg: any) => seg.text || '').join('')).join(' ');
                        }
                        return '';
                    }).join('\n');

                    assert.match(tocText, /Chapter One/, `${fixture.name}: TOC should include Chapter One heading`);
                    assert.match(tocText, /Chapter Two/, `${fixture.name}: TOC should include Chapter Two heading`);
                    assert.match(tocText, /Chapter Three/, `${fixture.name}: TOC should include Chapter Three heading`);
                    assert.match(tocText, /Section 1\.1/, `${fixture.name}: TOC should include h2 section heading`);

                    // The TOC is placed first; headings appear later — prove the TOC box
                    // precedes the first h1 heading box in document order
                    const firstTocPage = tocBoxes[0].pageIndex;
                    const headingBoxes = pagesA.flatMap((page, pageIndex) =>
                        page.boxes.filter((box: any) => /^h[1-6]$/.test(box.meta?.sourceType ?? '') || /^h[1-6]$/.test(box.meta?.semanticRole ?? '')).map((box: any) => ({ pageIndex, box }))
                    );
                    assert.ok(headingBoxes.length >= 3, `${fixture.name}: expected at least three heading boxes`);
                    const firstHeadingPage = headingBoxes[0].pageIndex;
                    assert.ok(firstTocPage <= firstHeadingPage, `${fixture.name}: TOC should appear on same page or before first heading`);
                }
            );
        }
        if (fixture.name === '25-total-pages-footer.json') {
            _check(
                `${fixture.name} total-pages content-only reactive update`,
                'footer with {totalPages} token renders the actual final page count on every page, not a placeholder, without a second simulate() call',
                () => {
                    const totalPages = pagesA.length;
                    const report = engine.getLastSimulationReportReader();
                    assert.ok(totalPages >= 2, `${fixture.name}: expected at least 2 pages`);

                    for (let pageIndex = 0; pageIndex < pagesA.length; pageIndex++) {
                        const page = pagesA[pageIndex];
                        const footerBoxes = page.boxes.filter((box: any) => box.meta?.sourceType === 'footer');
                        assert.ok(footerBoxes.length > 0, `${fixture.name}: page ${pageIndex} should have footer boxes`);

                        const footerText = footerBoxes.map((box: any) => {
                            if (typeof box.content === 'string') return box.content;
                            if (Array.isArray(box.lines)) {
                                return box.lines.map((line: any[]) => line.map((seg: any) => seg.text || '').join('')).join(' ');
                            }
                            return '';
                        }).join('\n');

                        const expectedPhysical = pageIndex + 1;
                        assert.match(
                            footerText,
                            new RegExp(`Page ${expectedPhysical} of ${totalPages}`),
                            `${fixture.name}: page ${pageIndex} footer should read "Page ${expectedPhysical} of ${totalPages}", got: ${footerText.trim()}`
                        );
                        assert.doesNotMatch(
                            footerText,
                            /\{totalPages\}/,
                            `${fixture.name}: page ${pageIndex} footer should not contain unresolved {totalPages} token`
                        );
                    }

                    assert.ok(
                        Number(report.profile.actorUpdateContentOnlyCalls || 0) > 0,
                        `${fixture.name}: expected content-only actor updates for total-pages footer`
                    );
                    assert.ok(
                        Number(report.profile.actorUpdateRedrawCalls || 0) > 0,
                        `${fixture.name}: expected in-place redraw calls for total-pages footer`
                    );
                }
            );
        }
        if (fixture.name === '17-header-footer-test.json') {
            _check(
                `${fixture.name} header/footer test signals`,
                'firstPage suppression, odd/even selectors, per-page override replacement and null-suppression, physicalPageNumber token, and logical counter skipping all behave deterministically',
                () => {
                    assertHeaderFooterTestSignals(pagesA, fixture.name);
                }
            );
        }
        if (fixture.name === '20-block-floats-and-column-span.json') {
            _check(
                `${fixture.name} block float and column span signals`,
                'block floats are positioned correctly, text wraps around them, column span is full-width, and post-span content flows in columns',
                () => {
                    assertBlockFloatsAndColumnSpanSignals(pagesA, fixture.name);
                }
            );
        }
        if (fixture.name === '11-story-image-floats.json') {
            _check(
                `${fixture.name} story layout signals`,
                'multi-page story with image floats, story-absolute, and non-uniform line widths',
                () => {
                    assertStoryPackagerShowcaseSignals(pagesA, fixture.name);
                }
            );
        }
        if (fixture.name === '26-circle-floats.json') {
            _check(
                `${fixture.name} circle float signals`,
                'circle floats produce image boxes and text with arc-shaped non-uniform line widths',
                () => {
                    assertCircleFloatSignals(pagesA, fixture.name);
                }
            );
        }
        if (fixture.name === '27-exclusion-assembly.json') {
            _check(
                `${fixture.name} exclusion assembly signals`,
                'composed float members produce a single actor-owned wrap field with varied line widths',
                () => {
                    assertExclusionAssemblySignals(pagesA, fixture.name);
                }
            );
        }
        if (fixture.name === '28-zone-map-exclusion-assembly.json') {
            _check(
                `${fixture.name} zone-map exclusion assembly signals`,
                'a zone-hosted story should wrap around an invisible composed field while sibling zones remain independent',
                () => {
                    assertZoneMapExclusionAssemblySignals(pagesA, fixture.name);
                }
            );
        }
        if (fixture.name === '44-polygon-float.json') {
            _check(
                `${fixture.name} polygon float signals`,
                'polygon floats preserve clip geometry and produce multi-width wrapped lines',
                () => {
                    assertPolygonFloatSignals(pagesA, fixture.name);
                }
            );
        }
        if (fixture.name === '45-polygon-float-carryover.json') {
            _check(
                `${fixture.name} polygon carry-over signals`,
                'polygon floats that straddle a page break should keep constraining continuation lines on the next page',
                () => {
                    assertPolygonCarryoverSignals(pagesA, fixture.name, engine);
                }
            );
        }
        if (fixture.name === '46-polygon-float-carryover-right.json') {
            _check(
                `${fixture.name} polygon right carry-over signals`,
                'right-aligned polygon floats should preserve carried continuation geometry without left-bias assumptions',
                () => {
                    assertPolygonCarryoverRightSignals(pagesA, fixture.name);
                }
            );
        }
        if (fixture.name === '47-polygon-top-bottom-carryover.json') {
            _check(
                `${fixture.name} polygon top-bottom carry-over signals`,
                'top-bottom polygon carry-over should clear the continuation text vertically instead of carving side-wrap slots',
                () => {
                    assertPolygonTopBottomCarryoverSignals(pagesA, fixture.name);
                }
            );
        }
        if (fixture.name === '48-polygon-multicolumn-carryover.json') {
            _check(
                `${fixture.name} polygon multi-column carry-over signals`,
                'multi-column stories should preserve wrapped polygon carry-over in the continuation column',
                () => {
                    assertPolygonMultiColumnCarryoverSignals(pagesA, fixture.name);
                }
            );
        }
        if (fixture.name === '49-polygon-mixed-shapes.json') {
            _check(
                `${fixture.name} mixed polygon silhouette signals`,
                'a document should support several distinct polygon silhouettes at once and preserve their independent wrap signatures',
                () => {
                    assertPolygonMixedShapesSignals(pagesA, fixture.name);
                }
            );
        }
        if (fixture.name === '50-polygon-expressive-lanes.json') {
            _check(
                `${fixture.name} expressive polygon lane signals`,
                'allow-mode polygon wrapping should preserve even tiny authored sliver lanes for spectacle-oriented layouts',
                () => {
                    assertPolygonExpressiveLaneSignals(pagesA, fixture.name);
                }
            );
        }
        if (fixture.name === '51-polygon-editorial-lanes.json') {
            _check(
                `${fixture.name} editorial polygon lane signals`,
                'typography-mode polygon wrapping should reject useless micro lanes while preserving meaningful wider wraps',
                () => {
                    assertPolygonEditorialLaneSignals(pagesA, fixture.name);
                }
            );
        }
        if (fixture.name === '29-zone-map-native-field.json') {
            _check(
                `${fixture.name} zone-map native field signals`,
                'a direct zone child should publish a hidden field that later ordinary zone actors must settle around',
                () => {
                    assertZoneMapNativeFieldSignals(pagesA, fixture.name);
                }
            );
        }
        if (fixture.name === '30-zone-map-absolute-rock.json') {
            _check(
                `${fixture.name} zone-map absolute rock signals`,
                'an absolute-positioned field actor should exist in map space while ordinary zone labels settle around it',
                () => {
                    assertZoneMapAbsoluteRockSignals(pagesA, fixture.name);
                }
            );
        }
        if (fixture.name === '39-zone-map-spanning-continue.json') {
            _check(
                `${fixture.name} zone-map spanning continuation signals`,
                'continue plus spanning should begin in the current page chunk and continue later instead of collapsing back to conservative fixed behavior',
                () => {
                    assertZoneMapSpanningContinueSignals(pagesA, fixture.name);
                }
            );
        }
        if (fixture.name === '40-zone-map-spanning-field-carryover.json') {
            _check(
                `${fixture.name} zone-map spanning field carryover signals`,
                'a zone-owned field actor should remain visible across later chunk intersections while the same zone body continues',
                () => {
                    assertZoneMapSpanningFieldCarryoverSignals(pagesA, fixture.name);
                }
            );
        }
        if (fixture.name === '41-zone-map-spanning-multi-participant.json') {
            _check(
                `${fixture.name} zone-map spanning multi participant signals`,
                'a spanning zone should carry multiple persistent regional participants and continuing regional body flow across later chunk intersections',
                () => {
                    assertZoneMapSpanningMultiParticipantSignals(pagesA, fixture.name, engine);
                }
            );
        }
        if (fixture.name === '42-zone-map-script-region-query.json') {
            _check(
                `${fixture.name} zone-map script region query signals`,
                'scripts should be able to query one spanning regional identity and report its revisited pages without manually stitching page-local strips',
                () => {
                    assertZoneMapScriptRegionQuerySignals(pagesA, fixture.name, engine);
                }
            );
        }
        if (fixture.name === '31-world-plain-absolute-rock.json') {
            _check(
                `${fixture.name} world-plain absolute rock signals`,
                'a world-plain host should hold an absolute-positioned rock actor while ordinary labels settle around it',
                () => {
                    assertWorldPlainAbsoluteRockSignals(pagesA, fixture.name);
                }
            );
        }
        if (fixture.name === '32-world-plain-default-continue.json') {
            _check(
                `${fixture.name} world-plain default continuation signals`,
                'the default world-plain host should begin immediately and continue onto a later page as world-native flow',
                () => {
                    assertWorldPlainDefaultContinueSignals(pagesA, fixture.name);
                    assertViewportCaptureSummarySignals(fixture.name, engine);
                }
            );
        }
        if (fixture.name === '33-world-plain-conservative.json') {
            _check(
                `${fixture.name} world-plain conservative override signals`,
                'explicit move-whole and fixed settings should preserve the current conservative single-page world-plain path',
                () => {
                    assertWorldPlainConservativeSignals(pagesA, fixture.name);
                }
            );
        }
        if (fixture.name === '34-world-plain-spanning.json') {
            _check(
                `${fixture.name} world-plain spanning signals`,
                'explicit continue plus spanning should behave as a real world-host continuation mode instead of collapsing to conservative behavior',
                () => {
                    assertWorldPlainSpanningSignals(pagesA, fixture.name);
                }
            );
        }
        if (fixture.name === '35-world-plain-z-overpass.json') {
            _check(
                `${fixture.name} world-plain z overpass signals`,
                'higher-z world flow should pass over a lower-z rock instead of wrapping around it while the rock remains visible below',
                () => {
                    assertWorldPlainZOverpassSignals(pagesA, fixture.name);
                }
            );
        }
        if (fixture.name === '36-world-plain-traversing-flow.json') {
            _check(
                `${fixture.name} traversing flow signals`,
                'root flow should remain a separate participant, pass over lower-z world obstacles, and wrap around same-z world obstacles',
                () => {
                    assertWorldPlainTraversingFlowSignals(pagesA, fixture.name);
                    assertWorldPlainTraversingViewportCaptureSignals(fixture.name, engine);
                }
            );
        }
        if (fixture.name === '37-world-plain-traversal-policy.json') {
            _check(
                `${fixture.name} traversal policy signals`,
                'explicit authored traversal interaction policy should override the default depth-only decision for traversing root flow',
                () => {
                    assertWorldPlainTraversalPolicySignals(pagesA, fixture.name);
                }
            );
        }
        if (fixture.name === '38-world-plain-host-traversal-default.json') {
            _check(
                `${fixture.name} host traversal default signals`,
                'worldPlain should be able to supply a host-level traversal default while still allowing local obstacle overrides to win',
                () => {
                    assertWorldPlainHostTraversalDefaultSignals(pagesA, fixture.name);
                }
            );
        }
        if (fixture.name === '15-story-multi-column.json') {
            _check(
                `${fixture.name} multi-column story signals`,
                'story emits at least two column anchors on page 1, continues across pages, and declares split+morph capabilities',
                () => {
                    assertStoryMultiColumnSignals(pagesA, fixture.name);
                    assertTransformCapabilityActorKindSignals(fixture.name, engine, 'story', ['split', 'morph']);
                }
            );
        }
        if (fixture.name === '22-story-nested-table-continuation.json') {
            _check(
                `${fixture.name} nested table continuation signals`,
                'a nested table starts in a later story lane, continues across pages, repeats headers, and keeps downstream story flow after the continuation',
                () => {
                    assertStoryNestedTableContinuationSignals(pagesA, fixture.name);
                    assertTransformCapabilityActorKindSignals(fixture.name, engine, 'story', ['split', 'morph']);
                }
            );
        }
        if (fixture.name === '23-story-nested-story-continuation.json') {
            _check(
                `${fixture.name} nested story continuation signals`,
                'a nested story starts in a later story lane, continues across pages, and keeps downstream outer-story flow after the continuation',
                () => {
                    assertStoryNestedStoryContinuationSignals(pagesA, fixture.name);
                    assertTransformCapabilityActorKindSignals(fixture.name, engine, 'story', ['split', 'morph']);
                }
            );
        }
        _check(
            `${fixture.name} input immutability`,
            'input elements are unchanged after pagination',
            () => {
                assertNoInputMutation(elements, fixture.name);
            }
        );

        const { width: pageWidth, height: pageHeight } = LayoutUtils.getPageDimensions(config);
        const context = new MockContext(pageWidth, pageHeight);
        const renderer = new ContextRenderer(config, false, engine.getRuntime());
        await renderer.render(pagesA, context);
        _check(
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
            _check(
                `${fixture.name} advanced render signals`,
                'advanced fixtures exhibit expected rtl drawing progression',
                () => {
                    assertAdvancedRenderSignals(context.textTrace, fixture.name);
                }
            );
        }
    }

    await _checkAsync(
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
            assert.equal(headingTelemetry.length, 2, 'heading telemetry probe should publish exactly two heading entries');
            assert.equal(printSnapshot.pages.length, pages.length, 'print pipeline snapshot should expose finalized pages');
            assert.equal(
                printSnapshot.reader.require(simulationArtifactKeys.headingTelemetry).length,
                headingTelemetry.length,
                'print pipeline snapshot should expose heading telemetry through its reader'
            );
            assert.deepEqual(
                headingTelemetry.map((entry) => ({ sourceId: entry.sourceId, level: entry.level, heading: entry.heading })),
                [
                    { sourceId: headingTelemetry[0]?.sourceId, level: 1, heading: 'Architecture Overhaul' },
                    { sourceId: headingTelemetry[1]?.sourceId, level: 2, heading: 'Subsystem Handoff' }
                ],
                'heading telemetry should provide ordered outline-ready entries'
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

    await _checkAsync(
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

    await _checkAsync(
        'reactive content-only redraw board',
        'a committed wake that changes only observer content should redraw in place without replaying downstream actors',
        async () => {
            const engine = createReactiveProofEngine();
            await engine.waitForFonts();

            const pages = engine.simulate([
                {
                    type: 'test-signal-observer',
                    content: '',
                    properties: {
                        sourceId: 'content-only-observer',
                        _actorSignalObserve: {
                            topic: 'activation-content-only-entry',
                            title: 'Pinned Observer',
                            baseHeight: 96,
                            growthPerSignal: 0
                        }
                    }
                },
                {
                    type: 'test-replay-marker',
                    content: '',
                    properties: {
                        sourceId: 'content-only-replay-marker',
                        _testReplayMarker: {
                            title: 'Replay Marker',
                            height: 48
                        }
                    }
                },
                {
                    type: 'p',
                    content: 'Spacer region should remain committed while the later event source comes online.',
                    properties: {
                        sourceId: 'content-only-spacer'
                    }
                },
                {
                    type: 'test-signal-publisher',
                    content: 'Event source tile',
                    properties: {
                        sourceId: 'activation-content-only-source',
                        _actorSignalPublish: {
                            topic: 'activation-content-only-entry',
                            payload: {
                                label: 'Quiet Update'
                            }
                        }
                    }
                }
            ] as any);

            const observerText = boxesForSourceId(pages, 'content-only-observer').map(flattenBoxText).join('\n');
            const replayMarkerText = boxesForSourceId(pages, 'content-only-replay-marker').map(flattenBoxText).join('\n');

            assert.match(observerText, /Quiet Update/, 'content-only board should redraw observer content with the committed label');
            assert.match(observerText, /Count:\s*1/, 'content-only board should report the committed signal count');
            assert.match(replayMarkerText, /Render Count:\s*1/, 'content-only board should not replay the downstream marker');
        }
    );

    await _checkAsync(
        'reactive geometry replay board',
        'a geometry-changing wake should preserve upstream state and replay only the downstream region',
        async () => {
            const engine = createReactiveProofEngine();
            await engine.waitForFonts();

            const pages = engine.simulate([
                {
                    type: 'test-replay-marker',
                    content: '',
                    properties: {
                        sourceId: 'geometry-upstream-marker',
                        _testReplayMarker: {
                            title: 'Upstream Marker',
                            height: 48
                        }
                    }
                },
                {
                    type: 'test-signal-observer',
                    content: '',
                    properties: {
                        sourceId: 'geometry-observer',
                        _actorSignalObserve: {
                            topic: 'activation-geometry-entry',
                            title: 'Pinned Geometry Actor',
                            baseHeight: 96,
                            growthPerSignal: 72
                        }
                    }
                },
                {
                    type: 'test-replay-marker',
                    content: '',
                    properties: {
                        sourceId: 'geometry-downstream-marker',
                        _testReplayMarker: {
                            title: 'Downstream Marker',
                            height: 48
                        }
                    }
                },
                {
                    type: 'test-signal-publisher',
                    content: 'Wake the actor',
                    properties: {
                        sourceId: 'activation-geometry-source',
                        _actorSignalPublish: {
                            topic: 'activation-geometry-entry',
                            payload: {
                                label: 'Wake the actor'
                            }
                        }
                    }
                }
            ] as any);

            const upstreamText = boxesForSourceId(pages, 'geometry-upstream-marker').map(flattenBoxText).join('\n');
            const downstreamText = boxesForSourceId(pages, 'geometry-downstream-marker').map(flattenBoxText).join('\n');
            const observerText = boxesForSourceId(pages, 'geometry-observer').map(flattenBoxText).join('\n');

            assert.match(observerText, /Wake the actor/, 'geometry board should redraw observer content after the committed wake');
            assert.match(upstreamText, /Render Count:\s*1/, 'geometry board should leave the upstream marker untouched');
            assert.match(downstreamText, /Render Count:\s*2/, 'geometry board should replay the downstream marker after resettlement');
        }
    );

    await _checkAsync(
        'reactive oscillation hard stop board',
        'an observer that keeps proposing new geometry on unchanged committed facts should stop deterministically',
        async () => {
            const engine = createReactiveProofEngine();
            await engine.waitForFonts();

            assert.throws(() => {
                engine.simulate([
                    {
                        type: 'test-signal-observer',
                        content: '',
                        properties: {
                            sourceId: 'activation-oscillation-observer',
                            _actorSignalObserve: {
                                topic: 'activation-oscillation-entry',
                                title: 'Oscillation Observer',
                                baseHeight: 96,
                                growthPerSignal: 0,
                                oscillateHeights: [168, 96]
                            }
                        }
                    },
                    {
                        type: 'test-signal-publisher',
                        content: 'Kick the oscillation',
                        properties: {
                            sourceId: 'activation-oscillation-source',
                            _actorSignalPublish: {
                                topic: 'activation-oscillation-entry',
                                payload: {
                                    label: 'Start loop'
                                }
                            }
                        }
                    }
                ] as any);
            }, /Reactive geometry resettlement exceeded the cycle cap|Reactive geometry oscillation detected/, 'oscillation board should fail with a deterministic hard-stop diagnostic');
        }
    );

    await _checkAsync(
        'clock cooking board',
        'a stepped actor should keep cooking across kernel ticks and expose the final cooked state through the main report path',
        async () => {
            const engine = createReactiveProofEngine({
                layout: {
                    progression: {
                        policy: 'fixed-tick-count',
                        maxTicks: 10
                    }
                }
            });
            await engine.waitForFonts();

            const pages = engine.simulate([
                {
                    type: 'test-clock-cooking',
                    content: '',
                    properties: {
                        sourceId: 'clock-cooking-board',
                        _clockCooking: {
                            title: 'UFO WAVE TRACK',
                            baseHeight: 288,
                            growthPerStage: 8,
                            maxStages: 10,
                            pathStages: 10,
                            sceneMode: 'ascii-diorama',
                            sceneWidth: 62,
                            sceneHeight: 16,
                            fontFamily: 'Helvetica'
                        }
                    }
                },
                {
                    type: 'test-replay-marker',
                    content: '',
                    properties: {
                        sourceId: 'clock-cooking-replay-marker',
                        _testReplayMarker: {
                            title: 'Downstream Replay',
                            height: 36
                        }
                    }
                }
            ] as any);

            const cookingText = boxesForSourceId(pages, 'clock-cooking-board').map(flattenBoxText).join('\n');
            const replayMarkerText = boxesForSourceId(pages, 'clock-cooking-replay-marker').map(flattenBoxText).join('\n');
            const reader = engine.getLastSimulationReportReader();

            assert.match(cookingText, /DOS FLIPBOOK MODE/, 'clock cooking board should expose the recovered flipbook-mode rendering');
            assert.match(cookingText, /Ticks Cooked:\s*10\s*\/\s*10/, 'clock cooking board should reach the declared cooking horizon');
            assert.match(replayMarkerText, /Render Count:\s*11/, 'clock cooking board should replay downstream content across the cooked ticks');
            assert.equal(reader.progression?.policy, 'fixed-tick-count', 'clock cooking board should run through the restored fixed-tick progression path');
            assert.equal(reader.progression?.finalTick, 10, 'clock cooking board should capture at tick 10');
            assert.equal(reader.capture?.policy, 'fixed-tick-count', 'clock cooking board should expose fixed-tick-count as capture policy');
            assert.equal(reader.capture?.requestedMaxTicks, 10, 'clock cooking board should record the requested fixed tick horizon');
            assert.equal(reader.capture?.capturedAtTick, 10, 'clock cooking board capture should occur at tick 10');
            assert.equal(reader.capture?.satisfiedBy, 'fixed-tick-count', 'clock cooking board capture should be satisfied by the fixed tick horizon');
            assert.equal(reader.world?.progressionPolicy, 'fixed-tick-count', 'clock cooking board world summary should expose fixed-tick progression');
            assert.equal(reader.world?.capturePolicy, 'fixed-tick-count', 'clock cooking board world summary should expose fixed-tick capture policy');
            assert.equal(reader.world?.captureMaxTicks, 10, 'clock cooking board world summary should retain the requested capture horizon');
            assert.equal(reader.world?.currentTick, 10, 'clock cooking board world summary should capture the final tick');
            assert.ok((reader.world?.pageCaptures.length || 0) > 0, 'clock cooking board world summary should expose page captures');
            const timeline = reader.require(simulationArtifactKeys.temporalPresentationTimeline);
            assert.ok(timeline.length >= 2, 'clock cooking board should publish a temporal presentation timeline');
            assert.equal(timeline.at(-1)?.tick, 10, 'clock cooking board timeline should end at the final cooked tick');
            assert.ok((timeline.at(-1)?.pages?.[0]?.boxes?.length || 0) > 0, 'clock cooking board timeline should preserve settled page snapshots');
            assert.ok(
                timeline.some((frame: any) => (frame.pages || []).some((page: any) =>
                    (page.boxes || []).some((box: any) => String(box.engineKey || '').length > 0 && String(box.sourceId || '').length > 0)
                )),
                'clock cooking board timeline should preserve stable box identifiers for later interpolation work'
            );
        }
    );

    await _checkAsync(
        'actor event bus rollback',
        'speculative actor signals should disappear completely when the local signal snapshot is restored',
        async () => {
            const engine = createReactiveProofEngine();
            await engine.waitForFonts();

            const session = new LayoutSession({ runtime: engine.getRuntime() });
            session.notifySimulationStart();

            const snapshot = session.captureLocalActorSignalSnapshot();
            session.publishActorSignal({
                topic: 'probe-heading',
                publisherActorId: 'actor:speculative',
                publisherSourceId: 'source:speculative',
                publisherActorKind: 'test-signal-publisher',
                fragmentIndex: 0,
                pageIndex: 4,
                payload: { label: 'Speculative' }
            });

            assert.equal(session.getActorSignals('probe-heading').length, 1, 'rollback proof should see the speculative signal before restore');

            session.restoreLocalActorSignalSnapshot(snapshot);

            assert.equal(session.getActorSignals('probe-heading').length, 0, 'rollback proof should remove speculative signal after restore');
        }
    );

    await _checkAsync(
        'reactive collector board',
        'a collector-style observer should accumulate numbered entries from many publishers and push trailing flow after its final fragment',
        async () => {
            const engine = createReactiveProofEngine({
                layout: {
                    pageSize: { width: 360, height: 260 },
                    margins: { top: 24, right: 24, bottom: 24, left: 24 },
                    fontFamily: 'Helvetica',
                    fontSize: 12,
                    lineHeight: 1.2
                }
            });
            await engine.waitForFonts();

            const labels = [
                'Chapter 1: Signal Fire',
                'Chapter 2: Echo Valley',
                'Chapter 3: Lantern Shore',
                'Chapter 4: Ridge of Glass',
                'Chapter 5: Hollow Drum',
                'Chapter 6: Cedar Crossing',
                'Chapter 7: The Quiet Port',
                'Chapter 8: Ember Rain'
            ];

            const elements: any[] = [];
            labels.forEach((label, index) => {
                elements.push({
                    type: 'test-signal-publisher',
                    content: `Heading Publisher ${index + 1}\n${label}`,
                    properties: {
                        sourceId: `collector-publisher-${index + 1}`,
                        style: {
                            height: 64,
                            marginBottom: 10,
                            paddingTop: 10,
                            paddingLeft: 10,
                            paddingRight: 10,
                            paddingBottom: 10,
                            backgroundColor: '#e0f2fe',
                            borderColor: '#0891b2',
                            borderWidth: 1
                        },
                        _actorSignalPublish: {
                            topic: 'collector-entry',
                            payload: { label }
                        }
                    }
                });
                elements.push({
                    type: 'p',
                    content: longParagraph(`Collector proof filler ${index + 1}.`),
                    properties: { sourceId: `collector-filler-${index + 1}` }
                });
            });

            elements.push({
                type: 'test-signal-observer',
                content: '',
                properties: {
                    sourceId: 'synthetic-collector',
                    style: {
                        marginTop: 10,
                        marginBottom: 12
                    },
                    _actorSignalObserve: {
                        topic: 'collector-entry',
                        title: 'Synthetic Collector',
                        renderMode: 'collector-list',
                        backgroundColor: '#f8fafc',
                        borderColor: '#475569',
                        color: '#0f172a',
                        baseHeight: 100,
                        growthPerSignal: 34
                    }
                }
            });
            elements.push({
                type: 'p',
                content: longParagraph('Trailing aftermath proof text should be displaced by the collector list and appear after its final fragment.'),
                properties: { sourceId: 'collector-aftermath' }
            });

            const pages = engine.simulate(elements);
            const collectorBoxes = boxesForSourceId(pages, 'synthetic-collector');
            const collectorText = collectorBoxes.map((box) => flattenBoxText(box)).join('\n');
            const aftermathBoxes = boxesForSourceId(pages, 'collector-aftermath');

            assert.ok(collectorBoxes.length >= 2, 'collector board should span multiple fragments under aggregate label load');
            assert.match(collectorText, /Synthetic Collector/, 'collector board should render the collector title');
            assert.match(collectorText, /1\.\s+Chapter 1: Signal Fire/, 'collector board should include the first numbered entry');
            assert.match(collectorText, /8\.\s+Chapter 8: Ember Rain/, 'collector board should include the last numbered entry');

            assert.ok(aftermathBoxes.length > 0, 'collector board should preserve the trailing aftermath box');
            const lastCollector = collectorBoxes[collectorBoxes.length - 1];
            const firstAftermath = aftermathBoxes[0];
            assert.ok(
                firstAftermath.meta?.pageIndex >= lastCollector.meta?.pageIndex,
                'collector board should push the aftermath onto or after the collector page'
            );
            if (firstAftermath.meta?.pageIndex === lastCollector.meta?.pageIndex) {
                assert.ok(firstAftermath.y > lastCollector.y, 'collector board should place the aftermath below the collector on a shared page');
            }
        }
    );

    await _checkAsync(
        'in-flow collector late-signal settle board',
        'an early in-flow collector should learn later mature signals and reclaim space from a later actor-boundary settle',
        async () => {
            const engine = createReactiveProofEngine();
            await engine.waitForFonts();

            const labels = [
                'Chapter 1: Signal Fire',
                'Chapter 2: Echo Valley',
                'Chapter 3: Lantern Shore',
                'Chapter 4: Ridge of Glass'
            ];

            const elements: any[] = [
                {
                    type: 'p',
                    content: 'This fixture places ordinary flow before the collector so the dirty frontier resolves to an actor checkpoint instead of a page-start checkpoint.',
                    properties: { sourceId: 'inflow-intro' }
                },
                {
                    type: 'test-signal-observer',
                    content: '',
                    properties: {
                        sourceId: 'inflow-collector',
                        style: {
                            marginTop: 8,
                            marginBottom: 10
                        },
                        _actorSignalObserve: {
                            topic: 'inflow-collector-entry',
                            title: 'In-Flow Collector',
                            renderMode: 'collector-list',
                            backgroundColor: '#f8fafc',
                            borderColor: '#475569',
                            color: '#0f172a',
                            baseHeight: 72,
                            growthPerSignal: 28
                        }
                    }
                },
                {
                    type: 'p',
                    content: longParagraph('Aftermath body should be pushed downward once the collector grows from mature signals discovered later in the run.'),
                    properties: { sourceId: 'inflow-aftermath-1' }
                },
                {
                    type: 'p',
                    content: longParagraph('More aftermath body keeps the early pages occupied so the collector has real downstream consequences.'),
                    properties: { sourceId: 'inflow-aftermath-2' }
                },
                {
                    type: 'p',
                    content: longParagraph('Still more aftermath body extends the early region before the late publishers are encountered.'),
                    properties: { sourceId: 'inflow-aftermath-3' }
                }
            ];

            labels.forEach((label, index) => {
                elements.push({
                    type: 'test-signal-publisher',
                    content: `Heading Publisher ${index + 1}\n${label}`,
                    properties: {
                        sourceId: `inflow-publisher-${index + 1}`,
                        style: {
                            height: 64,
                            marginBottom: 10,
                            paddingTop: 10,
                            paddingLeft: 10,
                            paddingRight: 10,
                            paddingBottom: 10,
                            backgroundColor: '#ede9fe',
                            borderColor: '#7c3aed',
                            borderWidth: 1
                        },
                        _actorSignalPublish: {
                            topic: 'inflow-collector-entry',
                            signalKey: `inflow-collector-entry:${index + 1}`,
                            payload: { label }
                        }
                    }
                });
                elements.push({
                    type: 'p',
                    content: longParagraph(`Late publisher filler ${index + 1} keeps the collector proof marching across later pages.`),
                    properties: { sourceId: `inflow-publisher-filler-${index + 1}` }
                });
                elements.push({
                    type: 'p',
                    content: longParagraph(`Additional late filler ${index + 1} keeps the publishers meaningfully downstream from the collector.`),
                    properties: { sourceId: `inflow-publisher-filler-extra-${index + 1}` }
                });
            });

            const pages = engine.simulate(elements);
            const snapshot = engine.getLastPrintPipelineSnapshot();
            const profile = snapshot.report?.profile;
            const collectorBoxes = boxesForSourceId(pages, 'inflow-collector');
            const publisherBoxes = labels.flatMap((_, index) => boxesForSourceId(pages, `inflow-publisher-${index + 1}`));
            const collectorText = collectorBoxes.map((box) => flattenBoxText(box)).join('\n');
            const firstCollectorPage = Number(collectorBoxes[0]?.meta?.pageIndex ?? -1);
            const firstPublisherPage = Math.min(...publisherBoxes.map((box) => Number(box.meta?.pageIndex ?? 9999)));

            assert.ok(collectorBoxes.length > 0, 'in-flow collector board should render collector boxes');
            assert.ok(firstCollectorPage <= 1, `in-flow collector should begin near the front, got page ${firstCollectorPage}`);
            assert.ok(firstPublisherPage > firstCollectorPage, `in-flow collector should start before its publishers, got collector page ${firstCollectorPage} and publisher page ${firstPublisherPage}`);
            assert.match(collectorText, /1\.\s+Chapter 1: Signal Fire/, 'in-flow collector should absorb the first later label');
            assert.match(collectorText, /4\.\s+Chapter 4: Ridge of Glass/, 'in-flow collector should absorb the last later label');
            assert.ok((profile?.observerSettleCalls || 0) > 0, 'in-flow collector board should record at least one observer settle');
        }
    );

    await _checkAsync(
        'same-page collector checkpoint board',
        'a collector and its publisher should settle on the same page at an actor-boundary checkpoint before any page turn',
        async () => {
            const engine = createReactiveProofEngine({
                layout: {
                    pageSize: { width: 320, height: 520 },
                    margins: { top: 20, right: 20, bottom: 20, left: 20 },
                    fontFamily: 'Arimo',
                    fontSize: 12,
                    lineHeight: 1.2
                }
            });
            await engine.waitForFonts();

            const pages = engine.simulate([
                {
                    type: 'test-signal-observer',
                    content: '',
                    properties: {
                        sourceId: 'same-page-collector',
                        style: { marginTop: 8, marginBottom: 10 },
                        _actorSignalObserve: {
                            topic: 'same-page-entry',
                            title: 'Same-Page Collector',
                            renderMode: 'collector-list',
                            backgroundColor: '#f8fafc',
                            borderColor: '#475569',
                            color: '#0f172a',
                            baseHeight: 56,
                            growthPerSignal: 28
                        }
                    }
                },
                {
                    type: 'p',
                    content: repeatedParagraph('Early aftermath occupies the same page so the collector must reclaim space before the page boundary.', 8),
                    properties: { sourceId: 'same-page-aftermath-1' }
                },
                {
                    type: 'test-signal-publisher',
                    content: 'Heading Publisher\nSame Page Entry',
                    properties: {
                        sourceId: 'same-page-publisher',
                        style: {
                            height: 64,
                            marginBottom: 10,
                            paddingTop: 10,
                            paddingLeft: 10,
                            paddingRight: 10,
                            paddingBottom: 10,
                            backgroundColor: '#dbeafe',
                            borderColor: '#2563eb',
                            borderWidth: 1,
                            color: '#1e3a8a',
                            fontWeight: 700
                        },
                        _actorSignalPublish: {
                            topic: 'same-page-entry',
                            signalKey: 'same-page-entry:1',
                            payload: { label: 'Same Page Entry' }
                        }
                    }
                },
                {
                    type: 'p',
                    content: repeatedParagraph('Late aftermath should still live on the first page after the actor-boundary settle happens.', 6),
                    properties: { sourceId: 'same-page-aftermath-2' }
                }
            ]);

            const snapshot = engine.getLastPrintPipelineSnapshot();
            const profile = snapshot.report?.profile;
            const collectorBoxes = boxesForSourceId(pages, 'same-page-collector');
            const publisherBoxes = boxesForSourceId(pages, 'same-page-publisher');
            const collectorText = collectorBoxes.map((box) => flattenBoxText(box)).join('\n');

            assert.ok(collectorBoxes.length > 0, 'same-page checkpoint board should render the collector');
            assert.ok(publisherBoxes.length > 0, 'same-page checkpoint board should render the publisher');
            assert.equal(Number(collectorBoxes[0].meta?.pageIndex ?? -1), 0, 'same-page checkpoint board should keep collector on page 0');
            assert.equal(Number(publisherBoxes[0].meta?.pageIndex ?? -1), 0, 'same-page checkpoint board should keep publisher on page 0');
            assert.match(collectorText, /1\.\s+Same Page Entry/, 'same-page checkpoint board should settle the same-page label into the collector');
            assert.ok((profile?.observerSettleCalls || 0) > 0, 'same-page checkpoint board should record an intra-page settle');
        }
    );

    await _checkAsync(
        'anchored restore precision board',
        'a later collector settle should preserve a locked prelude marker while still learning the later mature signal',
        async () => {
            const engine = createReactiveProofEngine();
            await engine.waitForFonts();

            const pages = engine.simulate([
                {
                    type: 'test-replay-marker',
                    content: '',
                    properties: {
                        sourceId: 'locked-prelude-marker',
                        style: { marginTop: 6, marginBottom: 8 },
                        _testReplayMarker: {
                            title: 'Locked Prelude',
                            backgroundColor: '#fee2e2',
                            borderColor: '#dc2626',
                            color: '#7f1d1d',
                            height: 56
                        }
                    }
                },
                {
                    type: 'test-signal-observer',
                    content: '',
                    properties: {
                        sourceId: 'locked-prelude-collector',
                        style: { marginTop: 8, marginBottom: 8 },
                        _actorSignalObserve: {
                            topic: 'locked-prelude-entry',
                            title: 'Precision Collector',
                            renderMode: 'collector-list',
                            backgroundColor: '#f8fafc',
                            borderColor: '#475569',
                            color: '#0f172a',
                            baseHeight: 54,
                            growthPerSignal: 28
                        }
                    }
                },
                {
                    type: 'p',
                    content: repeatedParagraph('Early aftermath should remain below the collector while the locked prelude stays untouched if restore precision is correct.', 7),
                    properties: { sourceId: 'locked-prelude-aftermath-1' }
                },
                {
                    type: 'test-signal-publisher',
                    content: 'Heading Publisher\nAnchored Entry',
                    properties: {
                        sourceId: 'locked-prelude-publisher',
                        style: {
                            height: 64,
                            marginBottom: 8,
                            paddingTop: 10,
                            paddingLeft: 10,
                            paddingRight: 10,
                            paddingBottom: 10,
                            backgroundColor: '#dbeafe',
                            borderColor: '#2563eb',
                            borderWidth: 2,
                            color: '#1e3a8a',
                            fontWeight: 700
                        },
                        _actorSignalPublish: {
                            topic: 'locked-prelude-entry',
                            signalKey: 'locked-prelude-entry:1',
                            payload: { label: 'Anchored Entry' }
                        }
                    }
                },
                {
                    type: 'p',
                    content: repeatedParagraph('Late aftermath proves the world resumed after the collector learned the later mature signal.', 5),
                    properties: { sourceId: 'locked-prelude-aftermath-2' }
                }
            ]);

            const snapshot = engine.getLastPrintPipelineSnapshot();
            const profile = snapshot.report?.profile;
            const markerBoxes = boxesForSourceId(pages, 'locked-prelude-marker');
            const collectorBoxes = boxesForSourceId(pages, 'locked-prelude-collector');
            const markerText = markerBoxes.map((box) => flattenBoxText(box)).join('\n');
            const collectorText = collectorBoxes.map((box) => flattenBoxText(box)).join('\n');

            assert.ok(markerBoxes.length > 0, 'anchored restore board should render the locked prelude marker');
            assert.ok(collectorBoxes.length > 0, 'anchored restore board should render the collector');
            assert.match(markerText, /Locked Prelude/, 'anchored restore board should preserve the locked prelude marker');
            assert.match(markerText, /Render Count:\s*1/, 'anchored restore board should keep the prelude marker at a single render');
            assert.match(collectorText, /1\.\s+Anchored Entry/, 'anchored restore board should still learn the later anchored entry');
            assert.ok(markerBoxes[0].y < collectorBoxes[0].y, 'anchored restore board should keep the marker above the collector');
            assert.ok((profile?.observerSettleCalls || 0) > 0, 'anchored restore board should still record a settle');
        }
    );

    await _checkAsync(
        'cross-page bulletin board board',
        'multiple publishers should emit committed signals across pages into one downstream observer with aggregate page provenance',
        async () => {
            const engine = createReactiveProofEngine({
                layout: {
                    pageSize: { width: 320, height: 220 },
                    margins: { top: 20, right: 20, bottom: 20, left: 20 },
                    fontFamily: 'Arimo',
                    fontSize: 12,
                    lineHeight: 1.2
                }
            });
            await engine.waitForFonts();

            const publisherStyle = {
                height: 150,
                marginBottom: 12,
                paddingTop: 12,
                paddingLeft: 12,
                paddingRight: 12,
                paddingBottom: 12,
                backgroundColor: '#dbeafe',
                borderColor: '#2563eb',
                borderWidth: 1
            };

            const pages = engine.simulate([
                {
                    type: 'test-signal-publisher',
                    content: 'Publisher Alpha',
                    properties: {
                        sourceId: 'pub-alpha',
                        style: publisherStyle,
                        _actorSignalPublish: {
                            topic: 'probe-heading',
                            payload: { label: 'Alpha' }
                        }
                    }
                },
                {
                    type: 'test-signal-publisher',
                    content: 'Publisher Beta',
                    properties: {
                        sourceId: 'pub-beta',
                        style: publisherStyle,
                        _actorSignalPublish: {
                            topic: 'probe-heading',
                            payload: { label: 'Beta' }
                        }
                    }
                },
                {
                    type: 'test-signal-publisher',
                    content: 'Publisher Gamma',
                    properties: {
                        sourceId: 'pub-gamma',
                        style: publisherStyle,
                        _actorSignalPublish: {
                            topic: 'probe-heading',
                            payload: { label: 'Gamma' }
                        }
                    }
                },
                {
                    type: 'test-signal-observer',
                    content: '',
                    properties: {
                        sourceId: 'observer-main',
                        style: {
                            marginTop: 8,
                            marginBottom: 8
                        },
                        _actorSignalObserve: {
                            topic: 'probe-heading',
                            title: 'Observed Publishers',
                            backgroundColor: '#fde68a',
                            borderColor: '#b45309',
                            baseHeight: 80,
                            growthPerSignal: 36
                        }
                    }
                }
            ]);

            const publisherBoxes = ['pub-alpha', 'pub-beta', 'pub-gamma'].flatMap((sourceId) => boxesForSourceId(pages, sourceId));
            const publisherPages = new Set(publisherBoxes.map((box) => Number(box.meta?.pageIndex ?? -1)));
            const observerBoxes = boxesForSourceId(pages, 'observer-main');
            const observerText = observerBoxes.map((box) => flattenBoxText(box)).join('\n');

            assert.ok(publisherPages.size >= 2, 'cross-page bulletin board should place publishers on multiple pages');
            assert.ok(observerBoxes.length >= 2, 'cross-page bulletin board should grow observer into multiple fragments');
            assert.ok(Number(observerBoxes[0].meta?.pageIndex ?? -1) >= 2, 'cross-page bulletin board observer should land on a later page');
            assert.match(observerText, /Count:\s*3/, 'cross-page bulletin board should report all three signals');
            assert.match(observerText, /Pages:\s*1,\s*2,\s*3/, 'cross-page bulletin board should preserve page provenance');
        }
    );

    await _checkAsync(
        'observer summary follower board',
        'an observer should publish an aggregate summary that a downstream follower consumes as both content and geometry',
        async () => {
            const engine = createReactiveProofEngine({
                layout: {
                    pageSize: { width: 320, height: 220 },
                    margins: { top: 20, right: 20, bottom: 20, left: 20 },
                    fontFamily: 'Arimo',
                    fontSize: 12,
                    lineHeight: 1.2
                }
            });
            await engine.waitForFonts();

            const publisherStyle = {
                height: 110,
                marginBottom: 12,
                paddingTop: 12,
                paddingLeft: 12,
                paddingRight: 12,
                paddingBottom: 12,
                backgroundColor: '#dbeafe',
                borderColor: '#2563eb',
                borderWidth: 1
            };

            const pages = engine.simulate([
                {
                    type: 'test-signal-publisher',
                    content: 'Publisher Alpha',
                    properties: {
                        sourceId: 'chain-pub-alpha',
                        style: publisherStyle,
                        _actorSignalPublish: {
                            topic: 'probe-heading',
                            payload: { label: 'Alpha' }
                        }
                    }
                },
                { type: 'p', content: longParagraph('Alpha filler for chained follower proof.', 90) },
                {
                    type: 'test-signal-publisher',
                    content: 'Publisher Beta',
                    properties: {
                        sourceId: 'chain-pub-beta',
                        style: publisherStyle,
                        _actorSignalPublish: {
                            topic: 'probe-heading',
                            payload: { label: 'Beta' }
                        }
                    }
                },
                { type: 'p', content: longParagraph('Beta filler for chained follower proof.', 90) },
                {
                    type: 'test-signal-publisher',
                    content: 'Publisher Gamma',
                    properties: {
                        sourceId: 'chain-pub-gamma',
                        style: publisherStyle,
                        _actorSignalPublish: {
                            topic: 'probe-heading',
                            payload: { label: 'Gamma' }
                        }
                    }
                },
                {
                    type: 'test-signal-observer',
                    content: '',
                    properties: {
                        sourceId: 'chain-observer',
                        style: {
                            marginTop: 8,
                            marginBottom: 8
                        },
                        _actorSignalObserve: {
                            topic: 'probe-heading',
                            title: 'Observed Publishers',
                            publishTopic: 'observer-summary',
                            backgroundColor: '#dcfce7',
                            borderColor: '#15803d',
                            baseHeight: 80,
                            growthPerSignal: 28
                        }
                    }
                },
                {
                    type: 'test-signal-follower',
                    content: '',
                    properties: {
                        sourceId: 'chain-follower',
                        style: {
                            marginTop: 10,
                            marginBottom: 8
                        },
                        _actorSignalFollow: {
                            topic: 'observer-summary',
                            title: 'Follower Shift',
                            backgroundColor: '#ede9fe',
                            borderColor: '#7c3aed',
                            baseHeight: 72,
                            indentPerSignal: 18
                        }
                    }
                }
            ]);

            const observerBoxes = boxesForSourceId(pages, 'chain-observer');
            const followerBoxes = boxesForSourceId(pages, 'chain-follower');
            const followerText = followerBoxes.map((box) => flattenBoxText(box)).join('\n');

            assert.ok(observerBoxes.length > 0, 'observer summary follower board should render observer');
            assert.ok(followerBoxes.length > 0, 'observer summary follower board should render follower');
            assert.match(followerText, /Observer Count:\s*3/, 'observer summary follower board should pass aggregate count downstream');
            assert.match(followerText, /Alpha/, 'observer summary follower board should pass Alpha label downstream');
            assert.match(followerText, /Beta/, 'observer summary follower board should pass Beta label downstream');
            assert.match(followerText, /Gamma/, 'observer summary follower board should pass Gamma label downstream');
            assert.ok(Number(followerBoxes[0].x || 0) > 40, 'observer summary follower board should shift follower geometry to the right');
        }
    );

    await _checkAsync(
        'dual in-flow collectors board',
        'two early collectors should resettle independently from interleaved later signals without cross-topic contamination',
        async () => {
            const engine = createReactiveProofEngine({
                layout: {
                    pageSize: { width: 320, height: 220 },
                    margins: { top: 20, right: 20, bottom: 20, left: 20 },
                    fontFamily: 'Arimo',
                    fontSize: 12,
                    lineHeight: 1.2
                }
            });
            await engine.waitForFonts();

            const collectors = [
                {
                    topic: 'inflow-collector-alpha-entry',
                    sourceId: 'dual-inflow-collector-alpha',
                    title: 'In-Flow Collector Alpha',
                    firstLabel: 'Alpha 1: Signal Fire',
                    lastLabel: 'Alpha 3: Ridge Walk',
                    backgroundColor: '#eff6ff',
                    borderColor: '#2563eb',
                    color: '#1e3a8a'
                },
                {
                    topic: 'inflow-collector-beta-entry',
                    sourceId: 'dual-inflow-collector-beta',
                    title: 'In-Flow Collector Beta',
                    firstLabel: 'Beta 1: Echo Vale',
                    lastLabel: 'Beta 3: Quiet Port',
                    backgroundColor: '#fefce8',
                    borderColor: '#ca8a04',
                    color: '#854d0e'
                }
            ];

            const elements: any[] = [
                {
                    type: 'test-signal-observer',
                    content: '',
                    properties: {
                        sourceId: collectors[0].sourceId,
                        style: { marginTop: 8, marginBottom: 10 },
                        _actorSignalObserve: {
                            topic: collectors[0].topic,
                            title: collectors[0].title,
                            renderMode: 'collector-list',
                            backgroundColor: collectors[0].backgroundColor,
                            borderColor: collectors[0].borderColor,
                            color: collectors[0].color,
                            baseHeight: 60,
                            growthPerSignal: 22
                        }
                    }
                },
                {
                    type: 'test-signal-observer',
                    content: '',
                    properties: {
                        sourceId: collectors[1].sourceId,
                        style: { marginTop: 8, marginBottom: 10 },
                        _actorSignalObserve: {
                            topic: collectors[1].topic,
                            title: collectors[1].title,
                            renderMode: 'collector-list',
                            backgroundColor: collectors[1].backgroundColor,
                            borderColor: collectors[1].borderColor,
                            color: collectors[1].color,
                            baseHeight: 60,
                            growthPerSignal: 22
                        }
                    }
                },
                {
                    type: 'p',
                    content: longParagraph('Shared early aftermath keeps the first region occupied so both collectors must claim real space when later signals mature.'),
                    properties: { sourceId: 'dual-inflow-aftermath-1' }
                },
                {
                    type: 'p',
                    content: longParagraph('Additional early aftermath extends the downstream region so dual collector settling becomes visible in ordinary flow.'),
                    properties: { sourceId: 'dual-inflow-aftermath-2' }
                },
                {
                    type: 'p',
                    content: longParagraph('Still more early aftermath keeps the front pages meaningfully occupied before later publishers are encountered.'),
                    properties: { sourceId: 'dual-inflow-aftermath-3' }
                }
            ];

            [
                {
                    sourceId: 'dual-alpha-1',
                    topic: collectors[0].topic,
                    signalKey: 'dual-alpha-1',
                    label: collectors[0].firstLabel,
                    backgroundColor: '#dbeafe',
                    borderColor: '#2563eb',
                    color: '#1e3a8a'
                },
                {
                    sourceId: 'dual-beta-1',
                    topic: collectors[1].topic,
                    signalKey: 'dual-beta-1',
                    label: collectors[1].firstLabel,
                    backgroundColor: '#fef3c7',
                    borderColor: '#d97706',
                    color: '#92400e'
                },
                {
                    sourceId: 'dual-alpha-2',
                    topic: collectors[0].topic,
                    signalKey: 'dual-alpha-2',
                    label: 'Alpha 2: Lantern Shore',
                    backgroundColor: '#dbeafe',
                    borderColor: '#2563eb',
                    color: '#1e3a8a'
                },
                {
                    sourceId: 'dual-beta-2',
                    topic: collectors[1].topic,
                    signalKey: 'dual-beta-2',
                    label: 'Beta 2: Hollow Drum',
                    backgroundColor: '#fef3c7',
                    borderColor: '#d97706',
                    color: '#92400e'
                },
                {
                    sourceId: 'dual-alpha-3',
                    topic: collectors[0].topic,
                    signalKey: 'dual-alpha-3',
                    label: collectors[0].lastLabel,
                    backgroundColor: '#dbeafe',
                    borderColor: '#2563eb',
                    color: '#1e3a8a'
                },
                {
                    sourceId: 'dual-beta-3',
                    topic: collectors[1].topic,
                    signalKey: 'dual-beta-3',
                    label: collectors[1].lastLabel,
                    backgroundColor: '#fef3c7',
                    borderColor: '#d97706',
                    color: '#92400e'
                }
            ].forEach((publisher, index) => {
                elements.push({
                    type: 'test-signal-publisher',
                    content: `Heading Publisher\n${publisher.label}`,
                    properties: {
                        sourceId: publisher.sourceId,
                        style: {
                            height: 64,
                            marginBottom: 10,
                            paddingTop: 10,
                            paddingLeft: 10,
                            paddingRight: 10,
                            paddingBottom: 10,
                            borderWidth: 1,
                            backgroundColor: publisher.backgroundColor,
                            borderColor: publisher.borderColor,
                            color: publisher.color
                        },
                        _actorSignalPublish: {
                            topic: publisher.topic,
                            signalKey: publisher.signalKey,
                            payload: { label: publisher.label }
                        }
                    }
                });
                elements.push({
                    type: 'p',
                    content: longParagraph(`${publisher.label} filler keeps later publishers interleaved so both collectors receive mature traffic at different moments.`),
                    properties: { sourceId: `dual-interleaved-filler-${index + 1}` }
                });
            });

            elements.push({
                type: 'p',
                content: longParagraph('Late aftermath proves both collector invalidations have settled and the forward march resumed normally.'),
                properties: { sourceId: 'dual-inflow-late-aftermath' }
            });

            const pages = engine.simulate(elements);
            const alphaBoxes = boxesForSourceId(pages, collectors[0].sourceId);
            const betaBoxes = boxesForSourceId(pages, collectors[1].sourceId);
            const alphaText = alphaBoxes.map((box) => flattenBoxText(box)).join('\n');
            const betaText = betaBoxes.map((box) => flattenBoxText(box)).join('\n');
            const lateAftermath = boxesForSourceId(pages, 'dual-inflow-late-aftermath');

            assert.ok(alphaBoxes.length > 0 && betaBoxes.length > 0, 'dual in-flow collectors board should render both collectors');
            assert.ok(Number(alphaBoxes[0].meta?.pageIndex ?? -1) === 0, 'dual in-flow collectors board should place alpha near the front');
            assert.ok(Number(betaBoxes[0].meta?.pageIndex ?? -1) <= 1, 'dual in-flow collectors board should place beta near the front');
            assert.match(alphaText, /1\.\s+Alpha 1: Signal Fire/, 'dual in-flow collectors board should retain alpha first label');
            assert.match(alphaText, /3\.\s+Alpha 3: Ridge Walk/, 'dual in-flow collectors board should retain alpha last label');
            assert.doesNotMatch(alphaText, /Beta 1: Echo Vale/, 'dual in-flow collectors board should keep beta labels out of alpha collector');
            assert.match(betaText, /1\.\s+Beta 1: Echo Vale/, 'dual in-flow collectors board should retain beta first label');
            assert.match(betaText, /3\.\s+Beta 3: Quiet Port/, 'dual in-flow collectors board should retain beta last label');
            assert.doesNotMatch(betaText, /Alpha 1: Signal Fire/, 'dual in-flow collectors board should keep alpha labels out of beta collector');
            assert.ok(lateAftermath.length > 0, 'dual in-flow collectors board should keep late aftermath');
        }
    );

    await _checkAsync(
        'saucer flipbook board',
        'the recovered cooking actor should support the historical multi-frame saucer flipbook capture path',
        async () => {
            const frameCount = 10;
            const engine = createReactiveProofEngine({
                layout: {
                    pageSize: { width: 720, height: 420 },
                    margins: { top: 20, right: 20, bottom: 20, left: 20 },
                    fontFamily: 'Courier',
                    fontSize: 12,
                    lineHeight: 1.2
                },
                fonts: {
                    regular: 'Courier'
                }
            });
            await engine.waitForFonts();

            const flipbookPages: any[] = [];
            for (let currentFrame = 1; currentFrame <= frameCount; currentFrame++) {
                const framePages = engine.simulate([
                    {
                        type: 'test-clock-cooking',
                        content: '',
                        properties: {
                            sourceId: `clock-cooking-actor-${currentFrame}`,
                            style: {
                                marginTop: 4,
                                marginBottom: 6
                            },
                            _clockCooking: {
                                title: `UFO WAVE TRACK  FRAME ${currentFrame.toString().padStart(2, '0')}/${frameCount.toString().padStart(2, '0')}  [DOS FLIPBOOK MODE]`,
                                emptyLabel: 'Scene is dormant.',
                                baseHeight: 288,
                                growthPerStage: 8,
                                maxStages: currentFrame,
                                pathStages: frameCount,
                                sceneMode: 'ascii-diorama',
                                sceneWidth: 62,
                                sceneHeight: 16,
                                fontFamily: 'Courier'
                            }
                        }
                    },
                    {
                        type: 'test-replay-marker',
                        content: '',
                        properties: {
                            sourceId: `clock-cooking-downstream-${currentFrame}`,
                            _testReplayMarker: {
                                title: 'DOWNSTREAM REPLAY',
                                backgroundColor: '#eef2ff',
                                borderColor: '#4338ca',
                                color: '#312e81',
                                height: 32
                            }
                        }
                    },
                    {
                        type: 'p',
                        content: 'telemetry ballast keeps a committed downstream region available for replay',
                        properties: {
                            sourceId: `clock-cooking-ballast-${currentFrame}`,
                            style: {
                                fontFamily: 'Courier',
                                fontSize: 8,
                                lineHeight: 1.05,
                                color: '#64748b',
                                marginTop: 4,
                                marginBottom: 0
                            }
                        }
                    },
                    { type: 'p', content: longParagraph(`Frame ${currentFrame} ballast one keeps pagination finalization meaningful while the UFO cooker accumulates later committed state.`, 90) },
                    { type: 'p', content: longParagraph(`Frame ${currentFrame} ballast two preserves downstream replay pressure so the visual frame reflects a deeper settled slice.`, 90) },
                    { type: 'p', content: longParagraph(`Frame ${currentFrame} ballast three prevents the proof from collapsing into a trivial one-pass single-page layout.`, 90) }
                ]);

                const cookerPage = framePages.find((page) => page.boxes.some((box) => box.type === 'test-clock-cooking')) || framePages[0];
                flipbookPages.push(cookerPage);
            }

            assert.equal(flipbookPages.length, 10, 'saucer flipbook board should capture ten visual frames');

            const firstText = flattenBoxText((flipbookPages[0].boxes || []).find((box: any) => box.type === 'test-clock-cooking'));
            const lastText = flattenBoxText((flipbookPages[flipbookPages.length - 1].boxes || []).find((box: any) => box.type === 'test-clock-cooking'));

            assert.match(firstText, /UFO WAVE TRACK\s+FRAME 01\/10/, 'saucer flipbook board should preserve the first frame title');
            assert.match(firstText, /Ticks Cooked:\s*1\s*\/\s*1/, 'saucer flipbook board should settle the first frame at one cooked tick');
            assert.match(lastText, /UFO WAVE TRACK\s+FRAME 10\/10/, 'saucer flipbook board should preserve the last frame title');
            assert.match(lastText, /Ticks Cooked:\s*10\s*\/\s*10/, 'saucer flipbook board should settle the last frame at ten cooked ticks');
            assert.match(lastText, /DOS FLIPBOOK MODE/, 'saucer flipbook board should expose the historical flipbook mode banner');
        }
    );

    await _checkAsync(
        'async thought board',
        'a delayed external thought should keep pending state, resolve later, and preserve both states in the temporal presentation timeline',
        async () => {
            const engine = createReactiveProofEngine();
            const pages = await engine.simulateAsync([
                {
                    type: 'test-async-thought',
                    content: '',
                    properties: {
                        sourceId: 'async-thought-probe',
                        _asyncThought: {
                            title: 'Thought Lobe A',
                            pendingLabel: 'Thinking...',
                            resolvedLabel: 'Resolved: delayed insight committed.',
                            delayMs: 25,
                            baseHeight: 72,
                            resolvedHeight: 132,
                            geometryOnResolve: true
                        }
                    }
                },
                {
                    type: 'test-replay-marker',
                    content: '',
                    properties: {
                        sourceId: 'async-thought-probe-downstream',
                        _testReplayMarker: {
                            title: 'Downstream Region',
                            height: 44
                        }
                    }
                }
            ] as any, { timeoutMs: 1500, maxAsyncReplayPasses: 4 });

            const reader = engine.getLastSimulationReportReader();
            const asyncSummary = reader.require(simulationArtifactKeys.asyncThoughtSummary);
            const timeline = reader.require(simulationArtifactKeys.temporalPresentationTimeline);
            const finalThoughtBox = (pages.flatMap((page: any) => page.boxes || []).find((box: any) =>
                String(box.meta?.sourceId || '').endsWith('async-thought-probe')
            ));
            const finalText = flattenBoxText(finalThoughtBox);

            assert.ok(asyncSummary.some((entry: any) => entry?.state === 'completed'), 'async thought board should complete at least one thought job');
            assert.match(finalText, /Resolved: delayed insight committed\./, 'async thought board should render resolved thought text');
            assert.ok(timeline.length >= 2, 'async thought board should preserve both pending and resolved captures');
            const firstFrameText = timeline[0]?.pages?.flatMap((page: any) => page.boxes || []).find((box: any) =>
                String(box.sourceId || '').endsWith('async-thought-probe')
            )?.lines?.flatMap((line: any[]) => line || []).map((segment: any) => String(segment.text || '')).join('');
            const lastFrameText = timeline.at(-1)?.pages?.flatMap((page: any) => page.boxes || []).find((box: any) =>
                String(box.sourceId || '').endsWith('async-thought-probe')
            )?.lines?.flatMap((line: any[]) => line || []).map((segment: any) => String(segment.text || '')).join('');
            assert.match(String(firstFrameText || ''), /Thinking/, 'async thought board should start in a pending state');
            assert.match(String(lastFrameText || ''), /Resolved/, 'async thought board should end in a resolved state');
        }
    );

    await _checkAsync(
        'streaming thought board',
        'a staged async thought should preserve intermediate committed states as the thought unfolds over multiple replay passes',
        async () => {
            const engine = createReactiveProofEngine();
            const pages = await engine.simulateAsync([
                {
                    type: 'test-async-thought',
                    content: '',
                    properties: {
                        sourceId: 'streaming-thought-probe',
                        _asyncThought: {
                            title: 'Thought Lobe Stream',
                            pendingLabel: 'Listening...',
                            baseHeight: 68,
                            resolvedHeight: 150,
                            geometryOnResolve: true,
                            stages: [
                                { label: 'Stage 1: contact established.', delayMs: 20, height: 80 },
                                { label: 'Stage 2: pattern recognized.', delayMs: 20, height: 102 },
                                { label: 'Stage 3: committed insight arrives.', delayMs: 20, height: 142 }
                            ]
                        }
                    }
                },
                {
                    type: 'test-replay-marker',
                    content: '',
                    properties: {
                        sourceId: 'streaming-thought-probe-downstream',
                        _testReplayMarker: {
                            title: 'Downstream Region',
                            height: 44
                        }
                    }
                }
            ] as any, { timeoutMs: 1500, maxAsyncReplayPasses: 8 });

            const reader = engine.getLastSimulationReportReader();
            const asyncSummary = reader.require(simulationArtifactKeys.asyncThoughtSummary);
            const timeline = reader.require(simulationArtifactKeys.temporalPresentationTimeline);
            const finalThoughtBox = pages.flatMap((page: any) => page.boxes || []).find((box: any) =>
                String(box.meta?.sourceId || '').endsWith('streaming-thought-probe')
            );
            const finalText = flattenBoxText(finalThoughtBox);
            const timelineThoughtTexts = timeline.map((frame: any) =>
                frame?.pages?.flatMap((page: any) => page.boxes || []).find((box: any) =>
                    String(box.sourceId || '').endsWith('streaming-thought-probe')
                )?.lines?.flatMap((line: any[]) => line || []).map((segment: any) => String(segment.text || '')).join('') || ''
            );

            assert.ok(asyncSummary.filter((entry: any) => entry?.state === 'completed').length >= 3, 'streaming thought board should complete each staged thought job');
            assert.ok(timeline.length >= 4, 'streaming thought board should preserve pending plus intermediate staged captures');
            assert.ok(timelineThoughtTexts.some((text: string) => /Stage 1: contact established\./.test(text)), 'streaming thought board should capture the first stage');
            assert.ok(timelineThoughtTexts.some((text: string) => /Stage 2: pattern recognized\./.test(text)), 'streaming thought board should capture the second stage');
            assert.match(finalText, /Stage 3: committed insight arrives\./, 'streaming thought board should finish on the final stage text');
        }
    );

    await _checkAsync(
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
