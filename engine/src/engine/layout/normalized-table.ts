import type { Element, ElementStyle, TableLayoutOptions } from '../types';
import type { TrackSizingDefinition } from './track-sizing';
import type { TableModel } from './layout-table-types';
import { LayoutUtils } from './layout-utils';

export type NormalizedTableRowGroup = 'header' | 'body' | 'footer';

export type NormalizedTableCell = {
    source: Element;
    sourceCellIndex: number;
    colStart: number;
    colSpan: number;
    rowSpan: number;
};

export type NormalizedTableRow = {
    rowIndex: number;
    rowElement: Element;
    rowGroup: NormalizedTableRowGroup;
    isHeader: boolean;
    sourceRowIndex: number;
    cells: NormalizedTableCell[];
    columnSpanCount: number;
};

export type NormalizedTableGrid = {
    kind: 'spatial-grid';
    sourceElement: Element;
    rows: NormalizedTableRow[];
    rowIndices: number[];
    columnCount: number;
    headerRowIndices: number[];
    headerRows: number;
    hasRowSpan: boolean;
    headerHasRowSpan: boolean;
    repeatHeader: boolean;
    rowGap: number;
    columnGap: number;
    columns?: TrackSizingDefinition[];
    cellStyle?: ElementStyle;
    headerCellStyle?: ElementStyle;
};

const TABLE_OPTION_DEFAULTS: Required<Pick<TableLayoutOptions, 'headerRows' | 'repeatHeader' | 'columnGap' | 'rowGap'>> = {
    headerRows: 1,
    repeatHeader: true,
    columnGap: 0,
    rowGap: 0
};

function isTableRowElement(element: Element | undefined): boolean {
    const type = String(element?.type || '').trim().toLowerCase();
    return type === 'table-row' || type === 'tr' || type === 'row';
}

function isTableCellElement(element: Element | undefined): boolean {
    const type = String(element?.type || '').trim().toLowerCase();
    return type === 'table-cell' || type === 'td' || type === 'th' || type === 'cell';
}

function normalizeTableOptions(raw: unknown): TableLayoutOptions {
    if (!raw || typeof raw !== 'object') {
        return { ...TABLE_OPTION_DEFAULTS };
    }

    const value = raw as TableLayoutOptions;
    const headerRowsRaw = Number(value.headerRows ?? TABLE_OPTION_DEFAULTS.headerRows);
    const headerRows = Number.isFinite(headerRowsRaw) ? Math.max(0, Math.floor(headerRowsRaw)) : TABLE_OPTION_DEFAULTS.headerRows;
    return {
        headerRows,
        repeatHeader: value.repeatHeader !== false,
        columnGap: Math.max(0, LayoutUtils.validateUnit(value.columnGap ?? TABLE_OPTION_DEFAULTS.columnGap)),
        rowGap: Math.max(0, LayoutUtils.validateUnit(value.rowGap ?? TABLE_OPTION_DEFAULTS.rowGap)),
        columns: Array.isArray(value.columns)
            ? value.columns.map((column) => ({
                mode: column.mode || 'auto',
                value: column.value,
                fr: column.fr,
                min: column.min,
                max: column.max,
                basis: column.basis,
                minContent: column.minContent,
                maxContent: column.maxContent,
                grow: column.grow,
                shrink: column.shrink
            }))
            : undefined,
        cellStyle: value.cellStyle,
        headerCellStyle: value.headerCellStyle
    };
}

function normalizeTableSpan(value: unknown, fallback: number = 1): number {
    const numeric = Number(value ?? fallback);
    if (!Number.isFinite(numeric)) return fallback;
    return Math.max(1, Math.floor(numeric));
}

function resolveRowGroup(row: Element): NormalizedTableRowGroup {
    const role = String(row.properties?.semanticRole || '').trim().toLowerCase();
    if (role === 'footer' || role === 'table-footer' || role === 'tfoot') return 'footer';
    if (role === 'header' || role === 'table-header' || role === 'thead') return 'header';
    return 'body';
}

export function normalizeTableElement(element: Element): NormalizedTableGrid {
    const options = normalizeTableOptions(element.table);
    const candidateRows = Array.isArray(element.children)
        ? element.children.filter((child) => isTableRowElement(child))
        : [];
    const rows = candidateRows.length > 0
        ? candidateRows
        : (Array.isArray(element.children) ? element.children : []);

    const out: NormalizedTableRow[] = [];
    const occupiedUntilByColumn: number[] = [];

    for (let idx = 0; idx < rows.length; idx++) {
        const row = rows[idx];
        const rawCells = Array.isArray(row.children)
            ? row.children.filter((child) => isTableCellElement(child))
            : [];
        const cells = rawCells.length > 0
            ? rawCells
            : (Array.isArray(row.children) && row.children.length > 0
                ? row.children
                : [{
                    type: 'table-cell',
                    content: String(row.content || ''),
                    children: [],
                    properties: {
                        ...(row.properties || {})
                    }
                } as Element]);

        let colCursor = 0;
        const placements: NormalizedTableCell[] = [];
        const isOccupied = (col: number): boolean => Number(occupiedUntilByColumn[col] ?? -1) >= idx;
        const canPlaceSpanAt = (start: number, span: number): boolean => {
            for (let col = start; col < start + span; col++) {
                if (isOccupied(col)) return false;
            }
            return true;
        };

        for (let sourceCellIndex = 0; sourceCellIndex < cells.length; sourceCellIndex++) {
            const cell = cells[sourceCellIndex];
            const colSpan = normalizeTableSpan(cell.properties?.colSpan ?? (cell.properties as any)?.colspan, 1);
            const rowSpan = normalizeTableSpan(cell.properties?.rowSpan ?? (cell.properties as any)?.rowspan, 1);

            while (isOccupied(colCursor)) colCursor += 1;
            while (!canPlaceSpanAt(colCursor, colSpan)) colCursor += 1;

            placements.push({
                source: cell,
                sourceCellIndex,
                colStart: colCursor,
                colSpan,
                rowSpan
            });

            if (rowSpan > 1) {
                const occupiedUntil = idx + rowSpan - 1;
                for (let col = colCursor; col < colCursor + colSpan; col++) {
                    const current = Number(occupiedUntilByColumn[col] ?? -1);
                    occupiedUntilByColumn[col] = Math.max(current, occupiedUntil);
                }
            }
            colCursor += colSpan;
        }

        let rowOccupiedColumnCount = 0;
        for (let col = 0; col < occupiedUntilByColumn.length; col++) {
            if (Number(occupiedUntilByColumn[col] ?? -1) >= idx) {
                rowOccupiedColumnCount = col + 1;
            }
        }

        const rowGroup = resolveRowGroup(row);
        const isHeader = rowGroup === 'header';
        out.push({
            rowIndex: idx,
            rowElement: row,
            rowGroup,
            isHeader,
            sourceRowIndex: idx,
            cells: placements,
            columnSpanCount: Math.max(1, colCursor, rowOccupiedColumnCount)
        });
    }

    if (out.length === 0) {
        const fallbackCell: Element = {
            type: 'table-cell',
            content: String(element.content || ''),
            children: Array.isArray(element.children) ? element.children : [],
            properties: {}
        };
        out.push({
            rowIndex: 0,
            rowElement: { type: 'table-row', content: '', children: [fallbackCell], properties: {} },
            rowGroup: 'body',
            isHeader: false,
            sourceRowIndex: 0,
            cells: [{
                source: fallbackCell,
                sourceCellIndex: 0,
                colStart: 0,
                colSpan: 1,
                rowSpan: 1
            }],
            columnSpanCount: 1
        });
    }

    const explicitHeaderRows = Math.min(out.length, Math.max(0, Number(options.headerRows ?? TABLE_OPTION_DEFAULTS.headerRows)));
    const headerRowIndices = out
        .filter((row, idx) => row.isHeader || idx < explicitHeaderRows)
        .map((row) => row.rowIndex);
    const dedupedHeaderIndices = Array.from(new Set(headerRowIndices)).sort((a, b) => a - b);
    const headerSet = new Set<number>(dedupedHeaderIndices);
    const hasRowSpan = out.some((row) => row.cells.some((cell) => cell.rowSpan > 1));
    const headerHasRowSpan = out.some((row) =>
        headerSet.has(row.rowIndex) && row.cells.some((cell) => cell.rowSpan > 1)
    );
    const rowIndices = out.map((row) => row.rowIndex);

    return {
        kind: 'spatial-grid',
        sourceElement: element,
        rows: out,
        rowIndices,
        columnCount: Math.max(1, out.reduce((max, row) => Math.max(max, row.columnSpanCount), 1)),
        headerRowIndices: dedupedHeaderIndices,
        headerRows: dedupedHeaderIndices.length,
        hasRowSpan,
        headerHasRowSpan,
        repeatHeader: options.repeatHeader !== false && !headerHasRowSpan,
        rowGap: options.rowGap ?? TABLE_OPTION_DEFAULTS.rowGap,
        columnGap: options.columnGap ?? TABLE_OPTION_DEFAULTS.columnGap,
        columns: options.columns as TrackSizingDefinition[] | undefined,
        cellStyle: options.cellStyle,
        headerCellStyle: options.headerCellStyle
    };
}

export function buildTableModelFromNormalizedTable(table: NormalizedTableGrid): TableModel {
    const rowSpanBlockedBoundaryIndices = new Set<number>();
    for (const row of table.rows) {
        for (const cell of row.cells) {
            const rowSpan = Math.max(1, Math.floor(cell.rowSpan || 1));
            if (rowSpan <= 1) continue;
            const start = row.rowIndex;
            const end = start + rowSpan - 1;
            for (let boundary = start + 1; boundary <= end; boundary++) {
                rowSpanBlockedBoundaryIndices.add(boundary);
            }
        }
    }

    const blockedBoundaryList = Array.from(rowSpanBlockedBoundaryIndices).sort((a, b) => a - b);
    return {
        rows: table.rows.map((row) => ({
            rowIndex: row.rowIndex,
            rowElement: row.rowElement,
            placements: row.cells.map((cell) => ({
                source: cell.source,
                colStart: cell.colStart,
                colSpan: cell.colSpan,
                rowSpan: cell.rowSpan
            })),
            columnSpanCount: row.columnSpanCount,
            isHeader: row.isHeader
        })),
        rowIndices: table.rowIndices.slice(),
        columnCount: table.columnCount,
        headerRowIndices: table.headerRowIndices.slice(),
        rowSpanBlockedBoundaryIndices: blockedBoundaryList,
        rowSpanBlockedBoundaryLookup: new Set<number>(blockedBoundaryList),
        headerRows: table.headerRows,
        hasRowSpan: table.hasRowSpan,
        headerHasRowSpan: table.headerHasRowSpan,
        repeatHeader: table.repeatHeader,
        rowGap: table.rowGap,
        columnGap: table.columnGap,
        columns: table.columns,
        cellStyle: table.cellStyle,
        headerCellStyle: table.headerCellStyle
    };
}

export function sliceNormalizedTable(table: NormalizedTableGrid, rowIndices: number[]): NormalizedTableGrid {
    return {
        ...table,
        rowIndices: rowIndices.slice()
    };
}
