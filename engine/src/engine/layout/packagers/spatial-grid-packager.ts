import { Box } from '../../types';
import { LayoutProcessor } from '../layout-core';
import { FlowBox, type FlowMaterializationContext } from '../layout-core-types';
import { LayoutUtils } from '../layout-utils';
import { materializeSpatialGridFlowBox, splitSpatialGridFlowBox, type SpatialGridLayoutContext } from '../layout-table';
import { createContinuationIdentity, createFlowBoxPackagerIdentity, PackagerIdentity } from './packager-identity';
import {
    PackagerContext,
    PackagerCaretInput,
    PackagerCaretResult,
    PackagerHitTestInput,
    PackagerHitTestResult,
    PackagerPlacementPreference,
    PackagerReshapeResult,
    PackagerReshapeProfile,
    PackagerSpatialCaretMoveInput,
    PackagerTableCellHitContext,
    PackagerUnit,
    resolvePackagerChunkOriginWorldY
} from './packager-types';
import { hitTestRichTextBox, resolveCaretInRichTextBox, resolveSpatialCaretMoveInRichTextBoxes } from './text-hit-testing';

type SpatialGridPackagerProcessor = {
    createFlowMaterializationContext(pageIndex: number, cursorY: number, availableWidth: number, worldY?: number): FlowMaterializationContext;
    materializeFlowBox(flowBox: FlowBox): void;
    positionFlowBox(
        flowBox: FlowBox,
        currentY: number,
        layoutBefore: number,
        margins: PackagerContext['margins'],
        availableWidth: number,
        pageIndex: number
    ): Box | Box[];
    getSpatialGridLayoutContext(): SpatialGridLayoutContext;
    config: {
        layout: {
            fontSize: number;
            lineHeight: number;
        };
    };
};

function finiteNumber(value: unknown): number | undefined {
    const number = Number(value);
    return Number.isFinite(number) ? number : undefined;
}

function finiteInteger(value: unknown): number | undefined {
    const number = finiteNumber(value);
    return number === undefined ? undefined : Math.floor(number);
}

function resolveTableCellHitContext(box: Box): PackagerTableCellHitContext | null {
    const properties = box.properties || {};
    if (box.type !== 'table_cell' && properties._tableCell !== true) return null;
    const sourceId = String(box.meta?.sourceId || '').trim();
    if (!sourceId) return null;
    return {
        sourceId,
        rowIndex: finiteInteger(properties._tableRowIndex),
        viewportRowIndex: finiteInteger(properties._tableViewportRowIndex),
        colIndex: finiteInteger(properties._tableColIndex),
        colStart: finiteInteger(properties._tableColStart),
        colSpan: finiteInteger(properties._tableColSpan),
        rowSpan: finiteInteger(properties._tableRowSpan),
        repeatedHeaderClone: properties._tableIsRepeatedHeaderClone === true,
        worldRowOffset: finiteNumber(properties._tableWorldRowOffset),
        viewportWorldY: finiteNumber(properties._tableViewportWorldY),
        viewportHeight: finiteNumber(properties._tableViewportHeight)
    };
}

type TableCaretCell = {
    box: Box;
    context: PackagerTableCellHitContext;
};

function resolveTableCaretCell(box: Box): TableCaretCell | null {
    const context = resolveTableCellHitContext(box);
    return context ? { box, context } : null;
}

function sortTableCells(a: TableCaretCell, b: TableCaretCell): number {
    return Number(a.context.rowIndex ?? 0) - Number(b.context.rowIndex ?? 0)
        || Number(a.context.colStart ?? a.context.colIndex ?? 0) - Number(b.context.colStart ?? b.context.colIndex ?? 0)
        || Number(a.box.y || 0) - Number(b.box.y || 0)
        || Number(a.box.x || 0) - Number(b.box.x || 0);
}

function findCurrentTableCell(cells: TableCaretCell[], caret: PackagerCaretResult): TableCaretCell | null {
    const tableCell = caret.tableCell;
    if (tableCell) {
        const byTableCell = cells.find((cell) => (
            cell.context.sourceId === tableCell.sourceId
            && cell.context.rowIndex === tableCell.rowIndex
            && cell.context.colStart === tableCell.colStart
            && cell.context.colSpan === tableCell.colSpan
            && cell.context.rowSpan === tableCell.rowSpan
        ));
        if (byTableCell) return byTableCell;
    }

    const sourceId = String(caret.sourceId || '');
    if (sourceId) {
        const bySource = cells.find((cell) => cell.context.sourceId === sourceId);
        if (bySource) return bySource;
    }
    const x = Number(caret.x || 0);
    const y = Number(caret.y || 0);
    return cells.find((cell) => (
        x >= Number(cell.box.x || 0)
        && x <= Number(cell.box.x || 0) + Math.max(0, Number(cell.box.w || 0))
        && y >= Number(cell.box.y || 0)
        && y <= Number(cell.box.y || 0) + Math.max(0, Number(cell.box.h || 0))
    )) || null;
}

function rowOfCell(cell: TableCaretCell): number {
    return Number(cell.context.rowIndex ?? cell.context.viewportRowIndex ?? 0);
}

function colStartOfCell(cell: TableCaretCell): number {
    return Number(cell.context.colStart ?? cell.context.colIndex ?? 0);
}

function colEndOfCell(cell: TableCaretCell): number {
    return colStartOfCell(cell) + Math.max(1, Number(cell.context.colSpan ?? 1));
}

function findInlineNeighborCell(
    cells: TableCaretCell[],
    current: TableCaretCell,
    direction: PackagerSpatialCaretMoveInput['direction']
): TableCaretCell | null {
    const currentRow = rowOfCell(current);
    const rowCells = cells
        .filter((cell) => rowOfCell(cell) === currentRow)
        .sort(sortTableCells);
    const currentIndex = rowCells.findIndex((cell) => cell.box === current.box);
    if (currentIndex < 0) return null;
    return direction === 'inlineForward'
        ? rowCells[currentIndex + 1] || null
        : rowCells[currentIndex - 1] || null;
}

function findBlockNeighborCell(
    cells: TableCaretCell[],
    current: TableCaretCell,
    direction: PackagerSpatialCaretMoveInput['direction'],
    targetX: number
): TableCaretCell | null {
    const currentRow = rowOfCell(current);
    const candidateRows = Array.from(new Set(
        cells
            .map(rowOfCell)
            .filter((row) => direction === 'blockForward' ? row > currentRow : row < currentRow)
    )).sort((a, b) => direction === 'blockForward' ? a - b : b - a);
    const targetCol = colStartOfCell(current);

    for (const row of candidateRows) {
        const rowCells = cells.filter((cell) => rowOfCell(cell) === row).sort(sortTableCells);
        const byColumn = rowCells.find((cell) => targetCol >= colStartOfCell(cell) && targetCol < colEndOfCell(cell));
        if (byColumn) return byColumn;

        let nearest = rowCells[0] || null;
        let nearestDistance = nearest
            ? Math.abs((Number(nearest.box.x || 0) + Math.max(0, Number(nearest.box.w || 0)) / 2) - targetX)
            : Number.POSITIVE_INFINITY;
        for (const cell of rowCells.slice(1)) {
            const centerX = Number(cell.box.x || 0) + Math.max(0, Number(cell.box.w || 0)) / 2;
            const distance = Math.abs(centerX - targetX);
            if (distance < nearestDistance) {
                nearest = cell;
                nearestDistance = distance;
            }
        }
        if (nearest) return nearest;
    }
    return null;
}

function resolveCaretAtTableCellPoint(
    cell: TableCaretCell,
    pageIndex: number,
    pagePoint: { x: number; y: number },
    owner: { actorId: string },
    layout: unknown
): PackagerCaretResult | null {
    const caret = resolveCaretInRichTextBox(
        {
            pageIndex,
            pagePoint,
            boxPoint: {
                x: pagePoint.x - Number(cell.box.x || 0),
                y: pagePoint.y - Number(cell.box.y || 0)
            },
            box: cell.box
        },
        {
            actorId: owner.actorId,
            sourceId: cell.context.sourceId
        },
        { layout }
    );
    return caret ? { ...caret, tableCell: cell.context } : null;
}

function resolveCaretAtCellEntry(
    cell: TableCaretCell,
    input: PackagerSpatialCaretMoveInput,
    owner: { actorId: string },
    layout: unknown
): PackagerCaretResult | null {
    const boxX = Number(cell.box.x || 0);
    const boxY = Number(cell.box.y || 0);
    const width = Math.max(0, Number(cell.box.w || 0));
    const height = Math.max(0, Number(cell.box.h || 0));
    const epsilon = 0.5;
    const x = input.direction === 'inlineBackward'
        ? boxX + Math.max(0, width - epsilon)
        : input.direction === 'inlineForward'
            ? boxX + Math.min(width, epsilon)
            : Math.max(boxX + epsilon, Math.min(boxX + Math.max(epsilon, width - epsilon), Number(input.caret.x || boxX)));
    const y = input.direction === 'blockBackward'
        ? boxY + Math.max(0, height - epsilon)
        : input.direction === 'blockForward'
            ? boxY + Math.min(height, epsilon)
            : Math.max(boxY + epsilon, Math.min(boxY + Math.max(epsilon, height - epsilon), Number(input.caret.y || boxY)));
    return resolveCaretAtTableCellPoint(cell, input.pageIndex, { x, y }, owner, layout);
}

/**
 * Dedicated packager for normalized SpatialGrid / table flow boxes.
 */
export class SpatialGridPackager implements PackagerUnit {
    private processor: LayoutProcessor;
    private flowBox: FlowBox;
    private lastAvailableWidth: number = -1;
    private cachedBoxes: Box[] | null = null;
    private requiredHeight: number = 0;
    private isMaterialized: boolean = false;

    readonly actorId: string;
    readonly sourceId: string;
    readonly actorKind: string;
    readonly fragmentIndex: number;
    readonly continuationOf?: string;

    get pageBreakBefore(): boolean | undefined { return this.flowBox.pageBreakBefore; }
    get keepWithNext(): boolean | undefined { return this.flowBox.keepWithNext; }

    constructor(processor: LayoutProcessor, flowBox: FlowBox, identity?: PackagerIdentity) {
        this.processor = processor;
        this.flowBox = flowBox;
        const resolvedIdentity = createFlowBoxPackagerIdentity(flowBox, identity);
        this.actorId = resolvedIdentity.actorId;
        this.sourceId = resolvedIdentity.sourceId;
        this.actorKind = resolvedIdentity.actorKind;
        this.fragmentIndex = resolvedIdentity.fragmentIndex;
        this.continuationOf = resolvedIdentity.continuationOf;
    }

    private materialize(availableWidth: number) {
        const processor = this.processor as unknown as SpatialGridPackagerProcessor;
        if (this.isMaterialized && this.lastAvailableWidth === availableWidth) return;

        const hasFrozenResolvedTable =
            this.flowBox._materializationMode === 'frozen'
            && !!this.flowBox.properties?._tableModel
            && !!this.flowBox.properties?._tableResolved
            && !!this.flowBox.properties?._normalizedTable;
        if (hasFrozenResolvedTable) {
            this.lastAvailableWidth = availableWidth;
            this.cachedBoxes = null;
            this.isMaterialized = true;

            const top = Math.max(0, this.flowBox.marginTop);
            const bottom = this.flowBox.marginBottom;
            const height = this.flowBox.measuredContentHeight;
            this.requiredHeight = top + height + bottom;
            return;
        }

        const element = this.flowBox._unresolvedElement || this.flowBox._sourceElement;
        if (element) {
            const context = processor.createFlowMaterializationContext(0, 0, availableWidth);
            const style = this.flowBox.style;
            const fontSize = Number(style.fontSize || processor.config.layout.fontSize);
            const lineHeight = Number(style.lineHeight || processor.config.layout.lineHeight);
            materializeSpatialGridFlowBox(
                this.flowBox,
                element,
                context,
                fontSize,
                lineHeight,
                processor.getSpatialGridLayoutContext()
            );
            this.flowBox._unresolvedElement = undefined;
        } else {
            processor.materializeFlowBox(this.flowBox);
        }

        this.lastAvailableWidth = availableWidth;
        this.cachedBoxes = null;
        this.isMaterialized = true;

        const top = Math.max(0, this.flowBox.marginTop);
        const bottom = this.flowBox.marginBottom;
        const height = this.flowBox.measuredContentHeight;
        this.requiredHeight = top + height + bottom;
    }

    prepare(availableWidth: number, _availableHeight: number, _context: PackagerContext): void {
        this.materialize(availableWidth);
    }

    getPlacementPreference(fullAvailableWidth: number, _context: PackagerContext): PackagerPlacementPreference {
        return {
            minimumWidth: fullAvailableWidth,
            acceptsFrame: true
        };
    }

    getReshapeProfile(): PackagerReshapeProfile {
        return {
            capabilities: [
                {
                    kind: 'split',
                    preservesIdentity: true,
                    producesContinuation: true
                },
                {
                    kind: 'clone',
                    preservesIdentity: true,
                    clonesStableSubstructure: true
                },
                {
                    kind: 'morph',
                    preservesIdentity: true,
                    reflowsContent: true
                }
            ]
        };
    }

    emitBoxes(availableWidth: number, _availableHeight: number, context: PackagerContext): Box[] {
        const processor = this.processor as unknown as SpatialGridPackagerProcessor;
        this.prepare(availableWidth, _availableHeight, context);

        const resolvedChunkOriginWorldY = resolvePackagerChunkOriginWorldY(context);
        const chunkOriginWorldY = Number.isFinite(resolvedChunkOriginWorldY)
            ? Math.max(0, Number(resolvedChunkOriginWorldY))
            : null;
        const viewportHeight = Number.isFinite(context.viewportHeight)
            ? Math.max(0, Number(context.viewportHeight))
            : Math.max(0, Number(context.pageHeight || 0));
        this.flowBox.properties = {
            ...(this.flowBox.properties || {}),
            ...(chunkOriginWorldY !== null ? { _tableViewportWorldY: chunkOriginWorldY } : {}),
            _tableViewportHeight: viewportHeight
        };

        const positioned = processor.positionFlowBox(
            this.flowBox,
            0,
            this.flowBox.marginTop,
            context.margins,
            availableWidth,
            context.pageIndex
        );
        const boxes = (Array.isArray(positioned) ? positioned : [positioned]).map((box) => {
            if (box.type !== 'table_cell') {
                return box;
            }
            return {
                ...box,
                properties: {
                    ...(box.properties || {}),
                    ...(chunkOriginWorldY !== null ? { _tableViewportWorldY: chunkOriginWorldY } : {}),
                    _tableViewportHeight: viewportHeight
                },
                meta: {
                    ...(box.meta || {}),
                    actorId: this.actorId
                }
            };
        });
        this.cachedBoxes = boxes;

        return boxes;
    }

    getRequiredHeight(): number {
        return this.requiredHeight;
    }

    isUnbreakable(_availableHeight: number): boolean {
        if (!this.flowBox.allowLineSplit) return true;
        if (!this.flowBox.lines || this.flowBox.lines.length <= 1) return true;
        if (this.flowBox.overflowPolicy === 'move-whole') return true;
        return false;
    }

    hitTestPoint(input: PackagerHitTestInput): PackagerHitTestResult | null {
        const tableCell = resolveTableCellHitContext(input.box);
        if (!tableCell) {
            return { kind: 'box', actorId: this.actorId, sourceId: this.sourceId, reason: 'not-table-cell' };
        }

        const textHit = hitTestRichTextBox(
            input,
            {
                actorId: this.actorId,
                sourceId: tableCell.sourceId
            },
            { layout: (this.processor as any).config?.layout }
        );
        if (textHit) {
            return { ...textHit, tableCell };
        }

        return {
            kind: 'box',
            actorId: this.actorId,
            sourceId: tableCell.sourceId,
            tableCell,
            reason: 'table-cell'
        };
    }

    resolveCaretAtPoint(input: PackagerCaretInput): PackagerCaretResult | null {
        const tableCell = resolveTableCellHitContext(input.box);
        if (!tableCell) return null;
        const caret = resolveCaretInRichTextBox(
            input,
            {
                actorId: this.actorId,
                sourceId: tableCell.sourceId
            },
            { layout: (this.processor as any).config?.layout }
        );
        return caret ? { ...caret, tableCell } : null;
    }

    resolveSpatialCaretMove(input: PackagerSpatialCaretMoveInput): PackagerCaretResult | null {
        const boxes = input.pageBoxes && input.pageBoxes.length > 0
            ? input.pageBoxes
            : this.cachedBoxes || [];
        const cells = boxes
            .map(resolveTableCaretCell)
            .filter((cell): cell is TableCaretCell => !!cell && cell.box.meta?.actorId === this.actorId)
            .sort(sortTableCells);
        if (cells.length === 0) return null;

        const currentCell = findCurrentTableCell(cells, input.caret);
        if (!currentCell) return null;
        const layout = (this.processor as any).config?.layout;
        const owner = { actorId: this.actorId };

        const inCell = resolveSpatialCaretMoveInRichTextBoxes(
            input,
            [currentCell.box],
            {
                actorId: this.actorId,
                sourceId: currentCell.context.sourceId
            },
            { layout }
        );
        if (inCell) return { ...inCell, tableCell: currentCell.context };

        const neighbor = input.direction === 'inlineForward' || input.direction === 'inlineBackward'
            ? findInlineNeighborCell(cells, currentCell, input.direction)
            : findBlockNeighborCell(cells, currentCell, input.direction, Number(input.caret.x || 0));
        if (!neighbor) return null;

        return resolveCaretAtCellEntry(neighbor, input, owner, layout);
    }

    getLeadingSpacing(): number {
        return this.flowBox.marginTop;
    }

    getTrailingSpacing(): number {
        return this.flowBox.marginBottom;
    }

    reshape(availableHeight: number, context: PackagerContext): PackagerReshapeResult {
        this.materialize(this.lastAvailableWidth);
        if (this.isUnbreakable(availableHeight)) {
            return { currentFragment: null, continuationFragment: this };
        }

        const splitResult = splitSpatialGridFlowBox(
            this.flowBox,
            availableHeight,
            this.flowBox.marginTop,
            context
        );

        if (!splitResult) {
            return { currentFragment: null, continuationFragment: this };
        }

        const partA = new SpatialGridPackager(this.processor, splitResult.partA, {
            actorId: this.actorId,
            sourceId: this.sourceId,
            actorKind: this.actorKind,
            fragmentIndex: this.fragmentIndex,
            continuationOf: this.continuationOf
        });
        const partB = new SpatialGridPackager(
            this.processor,
            splitResult.partB,
            createContinuationIdentity(this, splitResult.partB.meta?.fragmentIndex)
        );
        return { currentFragment: partA, continuationFragment: partB };
    }
}
