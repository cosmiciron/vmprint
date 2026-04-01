import { Box } from '../../types';
import { LayoutProcessor } from '../layout-core';
import { FlowBox, type FlowMaterializationContext } from '../layout-core-types';
import { createContinuationIdentity, createFlowBoxPackagerIdentity, PackagerIdentity } from './packager-identity';
import {
    PackagerContext,
    PackagerPlacementPreference,
    PackagerSplitResult,
    PackagerTransformProfile,
    PackagerUnit
} from './packager-types';

type FlowBoxProcessor = {
    normalizeFlowBlock(element: any, options: { path: number[] }): any;
    shapeNormalizedFlowBlock(block: any): FlowBox;
    createFlowMaterializationContext(pageIndex: number, cursorY: number, availableWidth: number): FlowMaterializationContext;
    materializeFlowBox(flowBox: FlowBox, context?: FlowMaterializationContext): void;
    positionFlowBox(
        flowBox: FlowBox,
        currentY: number,
        layoutBefore: number,
        margins: PackagerContext['margins'],
        availableWidth: number,
        pageIndex: number
    ): Box | Box[];
    splitFlowBox(
        flowBox: FlowBox,
        availableHeight: number,
        layoutBefore: number
    ): { partA: FlowBox; partB: FlowBox } | null;
};

/**
 * A basic packager for standard reflowable layout boxes (e.g. paragraph, header, normal image).
 */
export class FlowBoxPackager implements PackagerUnit {
    private processor: LayoutProcessor;
    private flowBox: FlowBox;
    private lastAvailableWidth: number = -1;
    private lastContentWidth: number = -1;
    private lastAvailableHeight: number = -1;
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

    getLiveContent(): string {
        return String(this.flowBox._sourceElement?.content || '');
    }

    private rebuildLiveFlowBox(): boolean {
        const sourceElement = this.flowBox._sourceElement;
        if (!sourceElement) return false;
        const shaper = this.processor as unknown as FlowBoxProcessor;
        const path = this.flowBox._normalizedFlowBlock?.identitySeed?.path ?? [0];
        const normalized = shaper.normalizeFlowBlock(sourceElement, { path });
        this.flowBox = shaper.shapeNormalizedFlowBlock(normalized);
        this.isMaterialized = false;
        this.cachedBoxes = null;
        this.lastAvailableWidth = -1;
        this.lastContentWidth = -1;
        this.lastAvailableHeight = -1;
        return true;
    }

    setLiveContent(content: string): boolean {
        const sourceElement = this.flowBox._sourceElement;
        if (!sourceElement) return false;
        const nextContent = String(content);
        if (this.getLiveContent() === nextContent) return false;
        sourceElement.content = nextContent;
        return this.rebuildLiveFlowBox();
    }

    private materialize(availableWidth: number, contentWidth: number = -1) {
        const processor = this.processor as unknown as FlowBoxProcessor;
        if (this.isMaterialized && this.lastAvailableWidth === availableWidth && this.lastContentWidth === contentWidth) return;

        // Use a dummy pageIndex=0 and cursorY=0 for materialization measurements.
        // Pass contentWidth (derived from the packer context) for correct line-wrapping
        // width in zone sub-sessions and story columns.
        const context = processor.createFlowMaterializationContext(0, 0, contentWidth);
        processor.materializeFlowBox(this.flowBox, context);

        this.lastAvailableWidth = availableWidth;
        this.lastContentWidth = contentWidth;
        this.cachedBoxes = null;
        this.isMaterialized = true;

        const top = Math.max(0, this.flowBox.marginTop);
        const bottom = this.flowBox.marginBottom;
        const height = this.flowBox.measuredContentHeight;
        this.requiredHeight = top + height + bottom;
    }

    prepare(availableWidth: number, availableHeight: number, context: PackagerContext): void {
        // Use context.contentWidthOverride (set by zone sub-sessions) when present.
        // Falls back to -1 so createFlowMaterializationContext skips contentWidth,
        // causing getContextualContentWidth to use the style-based default width
        // (pageContentWidth) rather than the narrowed lane/available width.
        const contentWidth = context.contentWidthOverride ?? -1;
        this.materialize(availableWidth, contentWidth);
        this.lastAvailableHeight = availableHeight;
    }

    getPlacementPreference(_fullAvailableWidth: number, _context: PackagerContext): PackagerPlacementPreference | null {
        if (this.flowBox.image) {
            return { minimumWidth: Math.max(0, Number(this.flowBox.measuredWidth || 0)) };
        }
        if (!this.flowBox.allowLineSplit || this.flowBox.overflowPolicy === 'move-whole') {
            return { minimumWidth: Math.max(0, Number(this.flowBox.measuredWidth || 0)) };
        }
        return null;
    }

    getTransformProfile(): PackagerTransformProfile {
        const capabilities: NonNullable<PackagerTransformProfile['capabilities']> = [
            {
                kind: 'split',
                preservesIdentity: true,
                producesContinuation: true
            }
        ];
        if (this.flowBox._materializationMode === 'reflowable' && !!this.flowBox._sourceElement) {
            capabilities.push({
                kind: 'morph',
                preservesIdentity: true,
                reflowsContent: true
            });
        }
        return { capabilities };
    }

    emitBoxes(availableWidth: number, availableHeight: number, context: PackagerContext): Box[] {
        const processor = this.processor as unknown as FlowBoxProcessor;
        this.prepare(availableWidth, availableHeight, context);

        // Position at y=0 in local flow-box space, with layoutBefore matching
        // marginTop. The orchestration loop applies the outer page/frame
        // placement later when the fragment is committed.
        const positioned = processor.positionFlowBox(
            this.flowBox,
            0, // currentY
            this.flowBox.marginTop, // layoutBefore
            context.margins,
            availableWidth,
            0 // local page index for a single flow-box materialization pass
        );

        const boxes = Array.isArray(positioned) ? positioned : [positioned];
        this.cachedBoxes = boxes;

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

    split(availableHeight: number, context: PackagerContext): PackagerSplitResult {
        const processor = this.processor as unknown as FlowBoxProcessor;
        this.materialize(this.lastAvailableWidth, this.lastContentWidth);
        if (this.isUnbreakable(availableHeight)) {
            return { currentFragment: null, continuationFragment: this };
        }

        // Defer to LayoutProcessor's split logic
        const splitResult = processor.splitFlowBox(
            this.flowBox,
            availableHeight,
            this.flowBox.marginTop // layoutBefore
        );

        if (!splitResult) {
            return { currentFragment: null, continuationFragment: this }; // Couldn't split neatly
        }

        // We successfully split
        const partA = new FlowBoxPackager(this.processor, splitResult.partA, {
            actorId: this.actorId,
            sourceId: this.sourceId,
            actorKind: this.actorKind,
            fragmentIndex: this.fragmentIndex,
            continuationOf: this.continuationOf
        });
        const partB = new FlowBoxPackager(
            this.processor,
            splitResult.partB,
            createContinuationIdentity(this, splitResult.partB.meta?.fragmentIndex)
        );
        return { currentFragment: partA, continuationFragment: partB };
    }
}
