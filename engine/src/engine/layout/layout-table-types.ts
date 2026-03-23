import { Box, BoxImagePayload, Element, ElementStyle, RichLine } from '../types';
import { TrackSizingDefinition } from './track-sizing';

export type TableModelRow = {
    rowIndex: number;
    rowElement: Element;
    placements: TableCellPlacement[];
    columnSpanCount: number;
    isHeader: boolean;
};

export type TableCellPlacement = {
    source: Element;
    colStart: number;
    colSpan: number;
    rowSpan: number;
};

export type TableModel = {
    rows: TableModelRow[];
    rowIndices: number[];
    columnCount: number;
    headerRowIndices: number[];
    rowSpanBlockedBoundaryIndices: number[];
    rowSpanBlockedBoundaryLookup?: Set<number>;
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

export type TableCellMaterialized = {
    placement: TableCellPlacement;
    source: Element;
    style: ElementStyle;
    measuredHeight: number;
    lines?: RichLine[];
    image?: BoxImagePayload;
    content?: string;
    glyphs?: { char: string; x: number; y: number }[];
    ascent?: number;
    childBoxes?: Box[];
    properties: Record<string, any>;
};

export type TableResolvedLayout = {
    columnCount: number;
    columnWidths: number[];
    rowHeightsByIndex: number[];
    rowWorldOffsetsByIndex: number[];
    rowGap: number;
    columnGap: number;
    rowIndices: number[];
    headerRowIndices: number[];
    clonedRowIndices: number[];
    repeatHeader: boolean;
    cellsByRowIndex: TableCellMaterialized[][];
};
