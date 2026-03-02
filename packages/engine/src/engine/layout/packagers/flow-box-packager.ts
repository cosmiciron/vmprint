import { Box } from '../../types';
import { LayoutProcessor } from '../layout-core';
import { FlowBox } from '../layout-core-types';
import { PackagerContext, PackagerUnit } from './packager-types';

/**
 * A basic packager for standard reflowable layout boxes (e.g. paragraph, header, normal image).
 */
export class FlowBoxPackager implements PackagerUnit {
    private processor: LayoutProcessor;
    private flowBox: FlowBox;
    private lastAvailableWidth: number = -1;
    private lastAvailableHeight: number = -1;
    private cachedBoxes: Box[] | null = null;
    private requiredHeight: number = 0;

    get pageBreakBefore(): boolean | undefined {
        return this.flowBox.pageBreakBefore;
    }
    get keepWithNext(): boolean | undefined {
        return this.flowBox.keepWithNext;
    }

    constructor(processor: LayoutProcessor, flowBox: FlowBox) {
        this.processor = processor;
        this.flowBox = flowBox;
    }

    private materialize(availableWidth: number) {
        if (this.lastAvailableWidth === availableWidth && this.cachedBoxes) return;

        // Use a dummy pageIndex=0 and cursorY=0 for materialization measurements
        const context = (this.processor as any).createFlowMaterializationContext(0, 0, availableWidth);
        (this.processor as any).materializeFlowBox(this.flowBox, context);

        this.lastAvailableWidth = availableWidth;
        this.cachedBoxes = null;

        const top = Math.max(0, this.flowBox.marginTop);
        const bottom = this.flowBox.marginBottom;
        const height = this.flowBox.measuredContentHeight;
        this.requiredHeight = top + height + bottom;
    }

    emitBoxes(availableWidth: number, availableHeight: number, context: PackagerContext): Box[] {
        this.materialize(availableWidth);
        this.lastAvailableHeight = availableHeight;

        // Position at y=0, with layoutBefore matching marginTop
        // The orchestration loop will shift box's .y by the current page Y.
        // We pretend page index is 0 and we are positioning at (margins.left, 0).
        const positioned = (this.processor as any).positionFlowBox(
            this.flowBox,
            0, // currentY
            this.flowBox.marginTop, // layoutBefore
            context.margins,
            availableWidth,
            0, // pageIndex
        );

        const boxes = Array.isArray(positioned) ? positioned : [positioned];
        this.cachedBoxes = boxes;

        // Reset absolute coordinates for the paginator to shift properly
        // positionFlowBox adds padding left/top. We keep the relative X, but normalize Y.
        for (const box of boxes) {
            // keep box.y relative to the packager's bounds
            // box.y includes marginTop (layoutBefore).
            box.meta = { ...box.meta };
        }

        return boxes;
    }

    getRequiredHeight(): number {
        return this.requiredHeight;
    }

    isUnbreakable(availableHeight: number): boolean {
        // Simple logic for paragraphs limits splits if allowLineSplit is false
        if (!this.flowBox.allowLineSplit) return true;
        if (!this.flowBox.lines || this.flowBox.lines.length <= 1) return true;

        // Hard fallback for move-whole
        if (this.flowBox.overflowPolicy === 'move-whole') return true;

        return false;
    }

    getMarginTop(): number {
        return this.flowBox.marginTop;
    }

    getMarginBottom(): number {
        return this.flowBox.marginBottom;
    }

    split(availableHeight: number, context: PackagerContext): [PackagerUnit | null, PackagerUnit | null] {
        this.materialize(this.lastAvailableWidth);
        if (this.isUnbreakable(availableHeight)) {
            return [null, this];
        }

        // Defer to LayoutProcessor's split logic
        const splitResult = (this.processor as any).splitFlowBox(
            this.flowBox,
            availableHeight,
            this.flowBox.marginTop, // layoutBefore
        );

        if (!splitResult) {
            return [null, this]; // Couldn't split neatly
        }

        // We successfully split
        const partA = new FlowBoxPackager(this.processor, splitResult.partA);
        const partB = new FlowBoxPackager(this.processor, splitResult.partB);
        return [partA, partB];
    }
}
