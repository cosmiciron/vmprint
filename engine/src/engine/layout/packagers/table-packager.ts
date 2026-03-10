import { Box } from '../../types';
import { LayoutProcessor } from '../layout-core';
import { FlowBox } from '../layout-core-types';
import { materializeTableFlowBox, splitTableFlowBox } from '../layout-table';
import { createContinuationIdentity, createFlowBoxPackagerIdentity, PackagerIdentity } from './packager-identity';
import { PackagerContext, PackagerSplitResult, PackagerUnit } from './packager-types';

/**
 * Dedicated packager for table flow boxes.
 */
export class TablePackager implements PackagerUnit {
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
        if (this.isMaterialized && this.lastAvailableWidth === availableWidth) return;

        const element = this.flowBox._unresolvedElement || this.flowBox._sourceElement;
        if (element) {
            const context = (this.processor as any).createFlowMaterializationContext(0, 0, availableWidth);
            const style = this.flowBox.style;
            const fontSize = Number(style.fontSize || (this.processor as any).config.layout.fontSize);
            const lineHeight = Number(style.lineHeight || (this.processor as any).config.layout.lineHeight);
            materializeTableFlowBox(
                this.flowBox,
                element,
                context,
                fontSize,
                lineHeight,
                (this.processor as any).getTableLayoutContext()
            );
            this.flowBox._unresolvedElement = undefined;
        } else {
            (this.processor as any).materializeFlowBox(this.flowBox);
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

    getMinimumPlacementWidth(fullAvailableWidth: number, _context: PackagerContext): number {
        return fullAvailableWidth;
    }

    acceptsPlacementFrame(frameAvailableWidth: number, fullAvailableWidth: number, _context: PackagerContext): boolean {
        return frameAvailableWidth >= fullAvailableWidth;
    }

    emitBoxes(availableWidth: number, _availableHeight: number, context: PackagerContext): Box[] {
        this.prepare(availableWidth, _availableHeight, context);

        const positioned = (this.processor as any).positionFlowBox(
            this.flowBox,
            0,
            this.flowBox.marginTop,
            context.margins,
            availableWidth,
            0
        );

        const boxes = Array.isArray(positioned) ? positioned : [positioned];
        this.cachedBoxes = boxes;

        for (const box of boxes) {
            box.meta = { ...box.meta };
        }

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

    getMarginTop(): number {
        return this.flowBox.marginTop;
    }

    getMarginBottom(): number {
        return this.flowBox.marginBottom;
    }

    split(availableHeight: number, _context: PackagerContext): PackagerSplitResult {
        this.materialize(this.lastAvailableWidth);
        if (this.isUnbreakable(availableHeight)) {
            return { currentFragment: null, continuationFragment: this };
        }

        const splitResult = splitTableFlowBox(
            this.flowBox,
            availableHeight,
            this.flowBox.marginTop
        );

        if (!splitResult) {
            return { currentFragment: null, continuationFragment: this };
        }

        const partA = new TablePackager(this.processor, splitResult.partA, {
            actorId: this.actorId,
            sourceId: this.sourceId,
            actorKind: this.actorKind,
            fragmentIndex: this.fragmentIndex,
            continuationOf: this.continuationOf
        });
        const partB = new TablePackager(
            this.processor,
            splitResult.partB,
            createContinuationIdentity(this, splitResult.partB.meta?.fragmentIndex)
        );
        return { currentFragment: partA, continuationFragment: partB };
    }
}
