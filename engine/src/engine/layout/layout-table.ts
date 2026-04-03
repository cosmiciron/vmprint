import { Box, BoxImagePayload, Element, ElementStyle, RichLine, TableLayoutOptions } from '../types';
import { LayoutUtils } from './layout-utils';
import { solveTrackSizing, TrackSizingDefinition } from './track-sizing';
import { FlowBox, FlowMaterializationContext, ResolvedLinesResult } from './layout-core-types';
import { LAYOUT_DEFAULTS } from './defaults';
import {
    createClonedBoxMeta,
    createContinuationFragmentMeta,
    createContinuationFragmentStyle,
    createLeadingFragmentMeta,
    createLeadingFragmentStyle,
    freezeFlowFragment
} from './flow-fragment-state';
import {
    TableCellMaterialized,
    TableCellPlacement,
    TableModel,
    TableModelRow,
    TableResolvedLayout
} from './layout-table-types';
import {
    buildTableModelFromNormalizedTable,
    normalizeTableElement,
    sliceNormalizedTable,
    type NormalizedTableGrid
} from './normalized-table';

export type SpatialGridLayoutContext = {
    layoutFontSize: number;
    layoutLineHeight: number;
    getStyle: (element: Element) => ElementStyle;
    getElementText: (element: Element) => string;
    resolveEmbeddedImage: (element: Element) => BoxImagePayload | undefined;
    resolveLines: (element: Element, style: ElementStyle, fontSize: number, context?: FlowMaterializationContext) => ResolvedLinesResult;
    calculateLineBlockHeight: (lines: RichLine[], style: ElementStyle, lineYOffsets?: number[]) => number;
    getHorizontalInsets: (style: ElementStyle) => number;
    getVerticalInsets: (style: ElementStyle) => number;
    getContextualBoxWidth: (
        style: ElementStyle,
        context: FlowMaterializationContext | undefined,
        fontSize: number,
        lineHeight: number
    ) => number;
    getBoxWidth: (style: ElementStyle) => number;
    resolveMeasurementFontForStyle: (style: ElementStyle) => any;
    measureText: (text: string, font: any, fontSize: number, letterSpacing: number) => number;
    emitDropCapBoxes?: (element: Element, width: number, context?: FlowMaterializationContext) => Box[] | null;
};

export function isTableElement(element: Element | undefined): boolean {
    return String(element?.type || '').trim().toLowerCase() === 'table';
}

export function isTableRowElement(element: Element | undefined): boolean {
    const type = String(element?.type || '').trim().toLowerCase();
    return type === 'table-row' || type === 'tr' || type === 'row';
}

export function isTableCellElement(element: Element | undefined): boolean {
    const type = String(element?.type || '').trim().toLowerCase();
    return type === 'table-cell' || type === 'td' || type === 'th' || type === 'cell';
}

export function buildTableModel(element: Element): TableModel {
    return buildTableModelFromNormalizedTable(normalizeTableElement(element));
}

function doesTableBoundaryCrossRowSpan(model: TableModel, boundaryRowIndex: number): boolean {
    if (!model.hasRowSpan) return false;
    if (model.rowSpanBlockedBoundaryLookup) {
        return model.rowSpanBlockedBoundaryLookup.has(boundaryRowIndex);
    }
    return (model.rowSpanBlockedBoundaryIndices || []).includes(boundaryRowIndex);
}

function measureCellIntrinsicWidths(
    cell: Element,
    style: ElementStyle,
    fontSize: number,
    tableContext: SpatialGridLayoutContext
): { minContent: number; maxContent: number } {
    const measurementFont = tableContext.resolveMeasurementFontForStyle(style);
    const letterSpacing = Number(style.letterSpacing || 0);
    const text = tableContext.getElementText(cell).replace(/\s+/g, ' ').trim();
    if (!text) return { minContent: 0, maxContent: 0 };

    const tokens = text.split(' ').filter((token) => token.length > 0);
    const minContent = tokens.length > 0
        ? tokens.reduce((max, token) => Math.max(max, tableContext.measureText(token, measurementFont, fontSize, letterSpacing)), 0)
        : tableContext.measureText(text, measurementFont, fontSize, letterSpacing);
    const maxContent = tableContext.measureText(text, measurementFont, fontSize, letterSpacing);
    return { minContent, maxContent };
}

function getTableSpanWidth(columnWidths: number[], colStart: number, colSpan: number, columnGap: number): number {
    const safeStart = Math.max(0, Math.floor(colStart));
    const safeSpan = Math.max(1, Math.floor(colSpan));
    let width = 0;
    for (let col = safeStart; col < Math.min(columnWidths.length, safeStart + safeSpan); col++) {
        width += Math.max(0, Number(columnWidths[col] || 0));
        if (col < safeStart + safeSpan - 1 && col < columnWidths.length - 1) {
            width += columnGap;
        }
    }
    return width;
}

function getTableColumnOffsets(columnWidths: number[], columnGap: number): number[] {
    const offsets = new Array(columnWidths.length).fill(0);
    let cursor = 0;
    for (let col = 0; col < columnWidths.length; col++) {
        offsets[col] = cursor;
        cursor += Math.max(0, Number(columnWidths[col] || 0));
        if (col < columnWidths.length - 1) cursor += columnGap;
    }
    return offsets;
}

function materializeTableCell(
    cell: Element,
    width: number,
    baseStyle: ElementStyle,
    context: FlowMaterializationContext | undefined,
    placement: TableCellPlacement,
    tableContext: SpatialGridLayoutContext
): TableCellMaterialized {
    const mergedStyle: ElementStyle = {
        ...baseStyle,
        width: Math.max(0, width),
        marginTop: 0,
        marginBottom: 0,
        marginLeft: 0,
        marginRight: 0,
        pageBreakBefore: false,
        keepWithNext: false
    };
    const fontSize = Number(mergedStyle.fontSize || tableContext.layoutFontSize);
    const lineHeight = Number(mergedStyle.lineHeight || tableContext.layoutLineHeight);
    const insetsVertical = tableContext.getVerticalInsets(mergedStyle);
    const insetsHorizontal = tableContext.getHorizontalInsets(mergedStyle);
    const text = tableContext.getElementText(cell);
    const hasChildElements = Array.isArray(cell.children) && cell.children.length > 0;
    const image = tableContext.resolveEmbeddedImage(cell);

    if (image) {
        const contentWidth = Math.max(0, width - insetsHorizontal);
        const imageHeight = contentWidth > 0
            ? (contentWidth * (image.intrinsicHeight / Math.max(1, image.intrinsicWidth)))
            : 0;
        const measuredHeight = Math.max(insetsVertical, imageHeight + insetsVertical);
        return {
            placement,
            source: cell,
            style: mergedStyle,
            measuredHeight,
            image,
            properties: { ...(cell.properties || {}) }
        };
    }

    const dropCapSpec = cell.dropCap;
    if (dropCapSpec?.enabled && typeof tableContext.emitDropCapBoxes === 'function') {
        const contentWidth = Math.max(0, width - insetsHorizontal);
        const dropCapElement: Element = {
            ...cell,
            type: 'p',
            properties: {
                ...(cell.properties || {}),
                style: {
                    ...mergedStyle,
                    width: contentWidth,
                    marginTop: 0,
                    marginBottom: 0,
                    marginLeft: 0,
                    marginRight: 0,
                    padding: 0,
                    paddingTop: 0,
                    paddingRight: 0,
                    paddingBottom: 0,
                    paddingLeft: 0,
                    borderWidth: 0,
                    borderTopWidth: 0,
                    borderBottomWidth: 0,
                    borderLeftWidth: 0,
                    borderRightWidth: 0
                }
            }
        };
        const dropCapBoxes = tableContext.emitDropCapBoxes(dropCapElement, contentWidth, context);
        if (dropCapBoxes && dropCapBoxes.length > 0) {
            const maxBottom = dropCapBoxes.reduce(
                (max, box) => Math.max(max, Math.max(0, Number(box.y || 0)) + Math.max(0, Number(box.h || 0))),
                0
            );
            const measuredHeight = Math.max(insetsVertical, maxBottom + insetsVertical);
            return {
                placement,
                source: cell,
                style: mergedStyle,
                measuredHeight,
                childBoxes: dropCapBoxes,
                properties: { ...(cell.properties || {}), _tableDropCap: true }
            };
        }
    }

    // Fast path: blank structural cells, especially auto-fill placeholders used to
    // preserve occupied grid topology around row/col spans, do not need the full
    // line-resolution pipeline.
    if (!text && !hasChildElements) {
        return {
            placement,
            source: cell,
            style: mergedStyle,
            measuredHeight: insetsVertical,
            content: undefined,
            properties: { ...(cell.properties || {}) }
        };
    }

    // Strip contentWidth from context: table cells use mergedStyle.width (= cellWidth)
    // as the authoritative width. The table-level context.contentWidth is the full
    // table available width and must not override the per-cell width here.
    const cellContext = context ? { pageIndex: context.pageIndex, cursorY: context.cursorY } : undefined;
    const resolved = tableContext.resolveLines(cell, mergedStyle, fontSize, cellContext);
    let measuredHeight = 0;
    if (resolved.lines.length > 0) {
        measuredHeight = tableContext.calculateLineBlockHeight(resolved.lines, mergedStyle, resolved.lineYOffsets);
    } else {
        if (text) measuredHeight = fontSize * lineHeight;
    }
    measuredHeight += insetsVertical;

    return {
        placement,
        source: cell,
        style: mergedStyle,
        measuredHeight,
        lines: resolved.lines.length > 0 ? resolved.lines : undefined,
        content: resolved.lines.length === 0 ? tableContext.getElementText(cell) : undefined,
        properties: {
            ...(cell.properties || {}),
            ...(resolved.lineOffsets && resolved.lineOffsets.length > 0 ? { _lineOffsets: resolved.lineOffsets.slice() } : {}),
            ...(resolved.lineWidths && resolved.lineWidths.length > 0 ? { _lineWidths: resolved.lineWidths.slice() } : {}),
            ...(resolved.lineYOffsets && resolved.lineYOffsets.length > 0 ? { _lineYOffsets: resolved.lineYOffsets.slice() } : {})
        }
    };
}

export function materializeSpatialGridFlowBox(
    unit: FlowBox,
    element: Element,
    context: FlowMaterializationContext | undefined,
    fontSize: number,
    lineHeight: number,
    tableContext: SpatialGridLayoutContext
): FlowBox {
    const style = unit.style;
    const normalizedTable = (
        unit._normalizedTable
        || (unit.properties?._normalizedTable as NormalizedTableGrid | undefined)
        || normalizeTableElement(element)
    );
    const model = ((unit.properties?._tableModel as TableModel | undefined) || buildTableModelFromNormalizedTable(normalizedTable));
    const allRows = model.rows;
    const columnCount = Math.max(1, Number(model.columnCount || 0), Number(model.columns?.length || 0));
    const headerRowSet = new Set<number>(model.headerRowIndices || []);
    const horizontalInsets = tableContext.getHorizontalInsets(style);
    const verticalInsets = tableContext.getVerticalInsets(style);
    const tableWidth = tableContext.getContextualBoxWidth(style, context, fontSize, lineHeight);
    const contentWidth = Math.max(0, tableWidth - horizontalInsets);

    const minContentByColumn = new Array(columnCount).fill(0);
    const maxContentByColumn = new Array(columnCount).fill(0);

    for (const row of allRows) {
        for (const placement of row.placements) {
            const colStart = Math.max(0, Math.floor(placement.colStart));
            if (colStart >= columnCount) continue;
            const colSpan = Math.max(1, Math.min(columnCount - colStart, Math.floor(placement.colSpan || 1)));
            const cell = placement.source;
            const roleStyle = tableContext.getStyle(cell);
            const headerStyle = row.isHeader || headerRowSet.has(row.rowIndex)
                ? (model.headerCellStyle || {})
                : {};
            const combinedStyle = {
                ...model.cellStyle,
                ...headerStyle,
                ...roleStyle
            } as ElementStyle;
            const measured = measureCellIntrinsicWidths(
                cell,
                combinedStyle,
                Number(combinedStyle.fontSize || tableContext.layoutFontSize),
                tableContext
            );
            if (colSpan === 1) {
                minContentByColumn[colStart] = Math.max(minContentByColumn[colStart], measured.minContent);
                maxContentByColumn[colStart] = Math.max(maxContentByColumn[colStart], measured.maxContent);
                continue;
            }

            const distributedMin = measured.minContent / colSpan;
            const distributedMax = measured.maxContent / colSpan;
            for (let col = colStart; col < colStart + colSpan; col++) {
                minContentByColumn[col] = Math.max(minContentByColumn[col], distributedMin);
                maxContentByColumn[col] = Math.max(maxContentByColumn[col], distributedMax);
            }
        }
    }

    const trackDefs: TrackSizingDefinition[] = [];
    for (let idx = 0; idx < columnCount; idx++) {
        const provided = model.columns?.[idx];
        if (provided) {
            trackDefs.push({
                ...provided,
                mode: provided.mode || 'auto',
                minContent: provided.minContent ?? minContentByColumn[idx],
                maxContent: provided.maxContent ?? maxContentByColumn[idx]
            });
            continue;
        }
        trackDefs.push({
            mode: 'flex',
            fr: 1,
            minContent: minContentByColumn[idx],
            maxContent: Math.max(minContentByColumn[idx], maxContentByColumn[idx]),
            min: minContentByColumn[idx]
        });
    }

    const solved = solveTrackSizing({
        containerWidth: contentWidth,
        gap: model.columnGap,
        tracks: trackDefs
    });
    const columnWidths = solved.sizes.slice();
    const rowHeightsByIndex = new Array(allRows.length).fill(0);
    const cellsByRowIndex: TableCellMaterialized[][] = Array.from({ length: allRows.length }, () => []);
    const activeSpanUntilByColumn = new Array(columnCount).fill(-1);
    const spanningCells: Array<{ startRowIndex: number; rowSpan: number; measuredHeight: number }> = [];

    for (const row of allRows) {
        let rowMinHeight = 0;
        const rowCells: TableCellMaterialized[] = [];
        const occupiedColumns = new Array(columnCount).fill(false);
        const normalizedPlacements: TableCellPlacement[] = [];
        for (let col = 0; col < columnCount; col++) {
            occupiedColumns[col] = Number(activeSpanUntilByColumn[col] ?? -1) >= row.rowIndex;
        }

        for (const rawPlacement of row.placements) {
            const colStart = Math.max(0, Math.floor(rawPlacement.colStart));
            if (colStart >= columnCount) continue;
            const colSpan = Math.max(1, Math.min(columnCount - colStart, Math.floor(rawPlacement.colSpan || 1)));
            const rowSpan = Math.max(1, Math.floor(rawPlacement.rowSpan || 1));
            normalizedPlacements.push({
                source: rawPlacement.source,
                colStart,
                colSpan,
                rowSpan
            });
            for (let col = colStart; col < colStart + colSpan; col++) {
                occupiedColumns[col] = true;
            }
        }

        for (let col = 0; col < columnCount; col++) {
            if (occupiedColumns[col]) continue;
            normalizedPlacements.push({
                source: {
                    type: 'table-cell',
                    content: '',
                    children: [],
                    properties: { _tableAutoFill: true }
                },
                colStart: col,
                colSpan: 1,
                rowSpan: 1
            });
        }

        normalizedPlacements.sort((a, b) => a.colStart - b.colStart);

        for (const placement of normalizedPlacements) {
            const sourceCell = placement.source || {
                type: 'table-cell',
                content: '',
                children: [],
                properties: {}
            };
            const roleStyle = tableContext.getStyle(sourceCell);
            const headerStyle = row.isHeader || headerRowSet.has(row.rowIndex)
                ? (model.headerCellStyle || {})
                : {};
            const cellStyle: ElementStyle = {
                ...model.cellStyle,
                ...headerStyle,
                ...roleStyle
            };
            const width = getTableSpanWidth(columnWidths, placement.colStart, placement.colSpan, model.columnGap);
            const materialized = materializeTableCell(sourceCell, width, cellStyle, context, placement, tableContext);
            rowCells.push(materialized);
            if (placement.rowSpan > 1) {
                spanningCells.push({
                    startRowIndex: row.rowIndex,
                    rowSpan: placement.rowSpan,
                    measuredHeight: materialized.measuredHeight
                });
                const spanUntil = row.rowIndex + placement.rowSpan - 1;
                for (let col = placement.colStart; col < placement.colStart + placement.colSpan; col++) {
                    activeSpanUntilByColumn[col] = Math.max(Number(activeSpanUntilByColumn[col] ?? -1), spanUntil);
                }
            } else {
                rowMinHeight = Math.max(rowMinHeight, materialized.measuredHeight);
            }
        }
        rowHeightsByIndex[row.rowIndex] = Math.max(rowHeightsByIndex[row.rowIndex], rowMinHeight);
        cellsByRowIndex[row.rowIndex] = rowCells;
    }

    for (const spanCell of spanningCells) {
        const spanStart = Math.max(0, Math.floor(spanCell.startRowIndex));
        const spanEnd = Math.min(allRows.length - 1, spanStart + Math.max(1, Math.floor(spanCell.rowSpan)) - 1);
        if (spanEnd < spanStart) continue;

        let currentHeight = 0;
        for (let rowIndex = spanStart; rowIndex <= spanEnd; rowIndex++) {
            currentHeight += Number(rowHeightsByIndex[rowIndex] || 0);
            if (rowIndex > spanStart) currentHeight += model.rowGap;
        }

        const deficit = Number(spanCell.measuredHeight || 0) - currentHeight;
        if (deficit <= LAYOUT_DEFAULTS.wrapTolerance) continue;
        const rowCount = spanEnd - spanStart + 1;
        const perRowIncrease = deficit / Math.max(1, rowCount);
        for (let rowIndex = spanStart; rowIndex <= spanEnd; rowIndex++) {
            rowHeightsByIndex[rowIndex] = Number(rowHeightsByIndex[rowIndex] || 0) + perRowIncrease;
        }
    }

    const rowIndices = Array.isArray(model.rowIndices) && model.rowIndices.length > 0
        ? model.rowIndices.slice()
        : allRows.map((row) => row.rowIndex);
    const rowWorldOffsetsByIndex = new Array(allRows.length).fill(0);
    let worldRowCursor = 0;
    for (let idx = 0; idx < allRows.length; idx++) {
        rowWorldOffsetsByIndex[idx] = worldRowCursor;
        worldRowCursor += Number(rowHeightsByIndex[idx] || 0);
        if (idx < allRows.length - 1) worldRowCursor += model.rowGap;
    }
    const rowsHeight = rowIndices.reduce((sum, rowIndex, idx) => {
        const rowHeight = rowHeightsByIndex[rowIndex] || 0;
        return sum + rowHeight + (idx > 0 ? model.rowGap : 0);
    }, 0);

    const resolvedLayout: TableResolvedLayout = {
        columnCount,
        columnWidths,
        rowHeightsByIndex,
        rowWorldOffsetsByIndex,
        rowGap: model.rowGap,
        columnGap: model.columnGap,
        rowIndices,
        headerRowIndices: model.headerRowIndices.slice(),
        clonedRowIndices: [],
        repeatHeader: model.repeatHeader,
        cellsByRowIndex
    };

    unit.image = undefined;
    unit.lines = Array.from({ length: Math.max(1, rowIndices.length) }, () => []);
    unit.content = undefined;
    unit.glyphs = undefined;
    unit.ascent = undefined;
    unit.measuredWidth = tableWidth;
    unit.measuredContentHeight = unit.heightOverride ?? (rowsHeight + verticalInsets);
    unit.properties = {
        ...unit.properties,
        _tableModel: model,
        _normalizedTable: normalizedTable,
        _tableResolved: resolvedLayout
    };
    delete unit.properties._lineOffsets;
    delete unit.properties._lineWidths;
    delete unit.properties._lineYOffsets;

    return unit;
}

export function splitSpatialGridFlowBox(
    box: FlowBox,
    availableHeight: number,
    layoutBefore: number,
    context?: FlowMaterializationContext & {
        pageIndex?: number;
        getPageExclusions?: (pageIndex: number) => ReadonlyArray<{
            x: number;
            y: number;
            w: number;
            h: number;
        }>;
    }
): { partA: FlowBox; partB: FlowBox } | null {
    const model = box.properties?._tableModel as TableModel | undefined;
    const resolved = box.properties?._tableResolved as TableResolvedLayout | undefined;
    const normalizedTable = (
        box._normalizedTable
        || (box.properties?._normalizedTable as NormalizedTableGrid | undefined)
    );
    if (!model || !resolved || !normalizedTable) return null;

    const rowIndices = Array.isArray(resolved.rowIndices) ? resolved.rowIndices.slice() : [];
    if (rowIndices.length <= 1) return null;

    const style = box.style;
    const paddingTop = LayoutUtils.validateUnit(style.paddingTop ?? style.padding ?? 0);
    const paddingBottom = LayoutUtils.validateUnit(style.paddingBottom ?? style.padding ?? 0);
    const borderTop = LayoutUtils.validateUnit(style.borderTopWidth ?? style.borderWidth ?? 0);
    const borderBottom = LayoutUtils.validateUnit(style.borderBottomWidth ?? style.borderWidth ?? 0);
    const verticalInsets = paddingTop + paddingBottom + borderTop + borderBottom;

    const maxContentHeight = resolveTableSplitMaxContentHeight(
        box,
        availableHeight,
        layoutBefore,
        context
    );
    if (maxContentHeight <= verticalInsets + LAYOUT_DEFAULTS.wrapTolerance) return null;

    const headerSet = new Set<number>(resolved.headerRowIndices || []);
    let leadingHeaderCount = 0;
    while (leadingHeaderCount < rowIndices.length && headerSet.has(rowIndices[leadingHeaderCount])) {
        leadingHeaderCount += 1;
    }

    let fitCount = 0;
    let usedHeight = verticalInsets;
    for (let idx = 0; idx < rowIndices.length; idx++) {
        const rowIndex = rowIndices[idx];
        const rowHeight = Number(resolved.rowHeightsByIndex[rowIndex] || 0);
        const nextHeight = usedHeight + (idx > 0 ? resolved.rowGap : 0) + rowHeight;
        if (nextHeight <= maxContentHeight + LAYOUT_DEFAULTS.wrapTolerance) {
            usedHeight = nextHeight;
            fitCount = idx + 1;
            continue;
        }
        break;
    }

    while (fitCount > leadingHeaderCount && fitCount < rowIndices.length) {
        const boundaryRowIndex = rowIndices[fitCount];
        if (!doesTableBoundaryCrossRowSpan(model, boundaryRowIndex)) break;
        fitCount -= 1;
    }

    if (fitCount <= leadingHeaderCount) return null;
    if (fitCount >= rowIndices.length) return null;

    const partAIndices = rowIndices.slice(0, fitCount);
    const remainingBody = rowIndices.slice(fitCount).filter((rowIndex) => !headerSet.has(rowIndex));
    if (remainingBody.length === 0) return null;
    const partBIndices = resolved.repeatHeader
        ? [...resolved.headerRowIndices, ...remainingBody]
        : rowIndices.slice(fitCount);

    const computeFragmentHeight = (indices: number[]): number => {
        const rowsHeight = indices.reduce((sum, rowIndex, idx) => {
            const rowHeight = Number(resolved.rowHeightsByIndex[rowIndex] || 0);
            return sum + rowHeight + (idx > 0 ? resolved.rowGap : 0);
        }, 0);
        return rowsHeight + verticalInsets;
    };

    const partAResolved: TableResolvedLayout = {
        ...resolved,
        rowIndices: partAIndices.slice(),
        clonedRowIndices: []
    };
    const partBResolved: TableResolvedLayout = {
        ...resolved,
        rowIndices: partBIndices.slice(),
        clonedRowIndices: resolved.repeatHeader ? resolved.headerRowIndices.slice() : []
    };

    const partAModel: TableModel = { ...model, rowIndices: partAIndices.slice() };
    const partBModel: TableModel = { ...model, rowIndices: partBIndices.slice() };
    const partANormalizedTable = sliceNormalizedTable(normalizedTable, partAIndices);
    const partBNormalizedTable = sliceNormalizedTable(normalizedTable, partBIndices);
    const partA = freezeFlowFragment(box, {
        meta: createLeadingFragmentMeta(box.meta),
        style: {
            ...createLeadingFragmentStyle(box.style),
            marginBottom: 0
        },
        lines: Array.from({ length: Math.max(1, partAIndices.length) }, () => []),
        marginBottom: 0,
        allowLineSplit: partAIndices.length > 1,
        measuredContentHeight: box.heightOverride ?? computeFragmentHeight(partAIndices),
        properties: {
            ...box.properties,
            _tableModel: partAModel,
            _normalizedTable: partANormalizedTable,
            _tableResolved: partAResolved,
            _isFirstLine: true,
            _isLastLine: false
        },
        _normalizedTable: partANormalizedTable
    });

    const partB = freezeFlowFragment(box, {
        meta: createContinuationFragmentMeta(box.meta, box.meta.fragmentIndex + 1),
        style: {
            ...createContinuationFragmentStyle(box.style),
            marginTop: 0
        },
        lines: Array.from({ length: Math.max(1, partBIndices.length) }, () => []),
        marginTop: 0,
        allowLineSplit: partBIndices.length > 1,
        measuredContentHeight: box.heightOverride ?? computeFragmentHeight(partBIndices),
        properties: {
            ...box.properties,
            _tableModel: partBModel,
            _normalizedTable: partBNormalizedTable,
            _tableResolved: partBResolved,
            _isFirstLine: false,
            _isLastLine: true
        },
        _normalizedTable: partBNormalizedTable
    });

    return { partA, partB };
}

function resolveTableSplitMaxContentHeight(
    box: FlowBox,
    availableHeight: number,
    layoutBefore: number,
    context?: FlowMaterializationContext & {
        pageIndex?: number;
        getPageExclusions?: (pageIndex: number) => ReadonlyArray<{
            x: number;
            y: number;
            w: number;
            h: number;
        }>;
    }
): number {
    const baseMaxContentHeight = availableHeight - layoutBefore;
    if (!(baseMaxContentHeight > 0)) return baseMaxContentHeight;
    if (!context?.getPageExclusions) return baseMaxContentHeight;

    const pageIndex = Number.isFinite(context.pageIndex) ? Math.max(0, Math.floor(Number(context.pageIndex))) : 0;
    const cursorY = Number.isFinite(context.cursorY) ? Number(context.cursorY) : 0;
    const contentTop = cursorY + layoutBefore;
    const tableWidth = Number.isFinite(box.measuredWidth) ? Math.max(0, Number(box.measuredWidth)) : 0;
    if (!(tableWidth > 0)) return baseMaxContentHeight;

    let nextBlockedTop: number | null = null;
    for (const exclusion of context.getPageExclusions(pageIndex) || []) {
        const exclusionTop = Number.isFinite(exclusion.y) ? Math.max(0, Number(exclusion.y)) : 0;
        const exclusionHeight = Number.isFinite(exclusion.h) ? Math.max(0, Number(exclusion.h)) : 0;
        const exclusionBottom = exclusionTop + exclusionHeight;
        if (exclusionBottom <= contentTop + LAYOUT_DEFAULTS.wrapTolerance) continue;
        if (exclusionTop <= contentTop + LAYOUT_DEFAULTS.wrapTolerance) continue;

        const exclusionLeft = Number.isFinite(exclusion.x) ? Number(exclusion.x) : 0;
        const exclusionRight = exclusionLeft + (Number.isFinite(exclusion.w) ? Math.max(0, Number(exclusion.w)) : 0);
        const overlapsTableWidth =
            exclusionLeft < tableWidth - LAYOUT_DEFAULTS.wrapTolerance &&
            exclusionRight > LAYOUT_DEFAULTS.wrapTolerance;
        if (!overlapsTableWidth) continue;

        if (nextBlockedTop === null || exclusionTop < nextBlockedTop) {
            nextBlockedTop = exclusionTop;
        }
    }

    if (nextBlockedTop === null) return baseMaxContentHeight;

    return Math.min(baseMaxContentHeight, Math.max(0, nextBlockedTop - contentTop));
}

function buildTableCellBorderStyle(
    style: ElementStyle,
    rowIndex: number,
    _rowCount: number,
    colStart: number,
    colSpan: number,
    columnCount: number
): ElementStyle {
    const baseBorderWidth = LayoutUtils.validateUnit(style.borderWidth ?? 0);
    const borderColor = style.borderColor || '#111111';
    const isLastColumn = colStart + Math.max(1, Math.floor(colSpan || 1)) >= Math.max(1, Math.floor(columnCount || 1));
    return {
        ...style,
        borderTopWidth: style.borderTopWidth !== undefined
            ? LayoutUtils.validateUnit(style.borderTopWidth)
            : (rowIndex === 0 ? baseBorderWidth : 0),
        borderBottomWidth: style.borderBottomWidth !== undefined
            ? LayoutUtils.validateUnit(style.borderBottomWidth)
            : baseBorderWidth,
        borderLeftWidth: style.borderLeftWidth !== undefined
            ? LayoutUtils.validateUnit(style.borderLeftWidth)
            : baseBorderWidth,
        borderRightWidth: style.borderRightWidth !== undefined
            ? LayoutUtils.validateUnit(style.borderRightWidth)
            : (isLastColumn ? baseBorderWidth : 0),
        borderTopColor: style.borderTopColor || borderColor,
        borderBottomColor: style.borderBottomColor || borderColor,
        borderLeftColor: style.borderLeftColor || borderColor,
        borderRightColor: style.borderRightColor || borderColor,
        borderColor
    };
}

export function positionSpatialGridFlowBoxes(
    unit: FlowBox,
    x: number,
    y: number,
    pageIndex: number,
    tableContext: SpatialGridLayoutContext
): Box[] {
    const resolved = unit.properties?._tableResolved as TableResolvedLayout | undefined;
    if (!resolved) {
        return [{
            type: unit.type,
            x,
            y,
            w: Number.isFinite(unit.measuredWidth) ? Math.max(0, Number(unit.measuredWidth)) : tableContext.getBoxWidth(unit.style),
            h: Math.max(0, unit.measuredContentHeight),
            style: unit.style,
            properties: { ...unit.properties },
            meta: { ...unit.meta, pageIndex }
        }];
    }

    const out: Box[] = [];
    const style = unit.style;
    const paddingTop = LayoutUtils.validateUnit(style.paddingTop ?? style.padding ?? 0);
    const paddingLeft = LayoutUtils.validateUnit(style.paddingLeft ?? style.padding ?? 0);
    const borderTop = LayoutUtils.validateUnit(style.borderTopWidth ?? style.borderWidth ?? 0);
    const borderLeft = LayoutUtils.validateUnit(style.borderLeftWidth ?? style.borderWidth ?? 0);
    const contentX = x + paddingLeft + borderLeft;
    const contentY = y + paddingTop + borderTop;
    const columnOffsets = getTableColumnOffsets(resolved.columnWidths, resolved.columnGap);
    const rowIndices = Array.isArray(resolved.rowIndices) ? resolved.rowIndices.slice() : [];
    const clonedRowSet = new Set<number>(Array.isArray(resolved.clonedRowIndices) ? resolved.clonedRowIndices : []);
    const headerRowSet = new Set<number>(Array.isArray(resolved.headerRowIndices) ? resolved.headerRowIndices : []);
    const rowDisplayIndexBySource = new Map<number, number>();
    for (let displayRowIndex = 0; displayRowIndex < rowIndices.length; displayRowIndex++) {
        rowDisplayIndexBySource.set(rowIndices[displayRowIndex], displayRowIndex);
    }

    let rowCursorY = contentY;
    for (let displayRowIndex = 0; displayRowIndex < resolved.rowIndices.length; displayRowIndex++) {
        const sourceRowIndex = resolved.rowIndices[displayRowIndex];
        const rowHeight = Number(resolved.rowHeightsByIndex[sourceRowIndex] || 0);
        const rowCells = (resolved.cellsByRowIndex[sourceRowIndex] || []).slice().sort((a, b) => a.placement.colStart - b.placement.colStart);

        for (let cellIndex = 0; cellIndex < rowCells.length; cellIndex++) {
            const cell = rowCells[cellIndex];
            const placement = cell.placement;
            const colStart = Math.max(0, Math.min(resolved.columnWidths.length - 1, Math.floor(placement.colStart)));
            const colSpan = Math.max(1, Math.min(resolved.columnWidths.length - colStart, Math.floor(placement.colSpan || 1)));
            const declaredRowSpan = Math.max(1, Math.floor(placement.rowSpan || 1));
            const colWidth = getTableSpanWidth(resolved.columnWidths, colStart, colSpan, resolved.columnGap);
            const colOffset = columnOffsets[colStart] || 0;
            const colCursorX = contentX + colOffset;
            const requestedEndRow = sourceRowIndex + declaredRowSpan - 1;
            let endDisplayIndex = displayRowIndex;
            const directEndDisplay = rowDisplayIndexBySource.get(requestedEndRow);
            if (directEndDisplay !== undefined && directEndDisplay >= displayRowIndex) {
                endDisplayIndex = directEndDisplay;
            } else {
                for (let probe = displayRowIndex + 1; probe < rowIndices.length; probe++) {
                    const probeRow = rowIndices[probe];
                    if (probeRow > requestedEndRow) break;
                    endDisplayIndex = probe;
                }
            }

            let cellHeight = 0;
            for (let probe = displayRowIndex; probe <= endDisplayIndex; probe++) {
                const probeRow = rowIndices[probe];
                cellHeight += Number(resolved.rowHeightsByIndex[probeRow] || 0);
                if (probe > displayRowIndex) cellHeight += resolved.rowGap;
            }
            const effectiveRowSpan = Math.max(1, endDisplayIndex - displayRowIndex + 1);

            const cellStyle = buildTableCellBorderStyle(
                cell.style,
                displayRowIndex,
                resolved.rowIndices.length,
                colStart,
                colSpan,
                resolved.columnCount
            );
            const rawCellSourceId = cell.source?.properties?.sourceId;
            const normalizedCellSourceId = LayoutUtils.normalizeAuthorSourceId(rawCellSourceId) || unit.meta.sourceId;
            const cellMeta: any = {
                sourceId: normalizedCellSourceId,
                engineKey: `${unit.meta.engineKey}:r${sourceRowIndex}:c${colStart}:cs${colSpan}:rs${effectiveRowSpan}:i${cellIndex}`,
                sourceType: 'table_cell',
                semanticRole: String(cell.source?.properties?.semanticRole || ''),
                fragmentIndex: unit.meta.fragmentIndex,
                isContinuation: unit.meta.isContinuation,
                pageIndex
            };

            if (unit.meta.reflowKey) cellMeta.reflowKey = unit.meta.reflowKey;
            const isRepeatedHeaderClone =
                (clonedRowSet.has(sourceRowIndex) || (
                    unit.meta.isContinuation
                    && resolved.repeatHeader
                    && headerRowSet.has(sourceRowIndex)
                    && displayRowIndex < headerRowSet.size
                ));
            const rowWorldOffset = Number(resolved.rowWorldOffsetsByIndex?.[sourceRowIndex] || 0);
            const emittedCellMeta = isRepeatedHeaderClone
                ? createClonedBoxMeta(cellMeta, normalizedCellSourceId)
                : cellMeta;

            out.push({
                type: 'table_cell',
                x: colCursorX,
                y: rowCursorY,
                w: Math.max(0, colWidth),
                h: Math.max(0, cellHeight),
                style: cellStyle,
                image: cell.image,
                lines: cell.lines,
                content: cell.content,
                glyphs: cell.glyphs,
                ascent: cell.ascent,
                properties: {
                    ...cell.properties,
                    _isFirstLine: true,
                    _isLastLine: true,
                    _isFirstFragmentInLine: true,
                    _isLastFragmentInLine: true,
                    _tableCell: true,
                    _tableRowIndex: sourceRowIndex,
                    _tableViewportRowIndex: displayRowIndex,
                    _tableWorldRowOffset: rowWorldOffset,
                    _tableIsRepeatedHeaderClone: isRepeatedHeaderClone,
                    ...(Number.isFinite(unit.properties?._tableViewportWorldY)
                        ? { _tableViewportWorldY: Number(unit.properties?._tableViewportWorldY) }
                        : {}),
                    ...(Number.isFinite(unit.properties?._tableViewportHeight)
                        ? { _tableViewportHeight: Number(unit.properties?._tableViewportHeight) }
                        : {}),
                    _tableColIndex: colStart,
                    _tableColStart: colStart,
                    _tableColSpan: colSpan,
                    _tableRowSpan: effectiveRowSpan
                },
                meta: emittedCellMeta
            });

            if (cell.childBoxes && cell.childBoxes.length > 0) {
                const cellPadLeft = LayoutUtils.validateUnit(cellStyle.paddingLeft ?? cellStyle.padding ?? 0);
                const cellPadTop = LayoutUtils.validateUnit(cellStyle.paddingTop ?? cellStyle.padding ?? 0);
                const cellBorderLeft = LayoutUtils.validateUnit(cellStyle.borderLeftWidth ?? cellStyle.borderWidth ?? 0);
                const cellBorderTop = LayoutUtils.validateUnit(cellStyle.borderTopWidth ?? cellStyle.borderWidth ?? 0);
                const offsetX = colCursorX + cellPadLeft + cellBorderLeft;
                const offsetY = rowCursorY + cellPadTop + cellBorderTop;
                for (const child of cell.childBoxes) {
                    const childMeta = child.meta ? { ...child.meta, pageIndex } : { pageIndex } as any;
                    const emittedChildMeta = isRepeatedHeaderClone && childMeta.sourceId
                        ? createClonedBoxMeta(childMeta, String(childMeta.sourceId))
                        : childMeta;
                    out.push({
                        ...child,
                        x: Number(child.x || 0) + offsetX,
                        y: Number(child.y || 0) + offsetY,
                        properties: {
                            ...(child.properties || {}),
                            _interactionContainerSourceId: normalizedCellSourceId,
                            _interactionContainerType: 'table_cell',
                            _interactionContainerEngineKey: String(emittedCellMeta.engineKey || '')
                        },
                        meta: emittedChildMeta
                    });
                }
            }
        }
        rowCursorY += rowHeight + (displayRowIndex < resolved.rowIndices.length - 1 ? resolved.rowGap : 0);
    }

    return out;
}

export type TableLayoutContext = SpatialGridLayoutContext;
export const materializeTableFlowBox = materializeSpatialGridFlowBox;
export const splitTableFlowBox = splitSpatialGridFlowBox;
export const positionTableFlowBoxes = positionSpatialGridFlowBoxes;
