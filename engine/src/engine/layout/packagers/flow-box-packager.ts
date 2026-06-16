import { Box } from '../../types';
import { LayoutProcessor } from '../layout-core';
import { FlowBox, type FlowMaterializationContext } from '../layout-core-types';
import { resolveDocumentMicroLanePolicy, resolveMinUsableLaneWidth } from '../micro-lane-policy';
import type { SpatialExclusion } from '../runtime/session/session-spatial-types';
import { reflowTextElementAgainstSpatialField } from '../spatial-field-reflow';
import {
    applyRuntimeFormattingIntentToSourceElement,
    buildRuntimeIntentTopic
} from '../runtime-formatting';
import { createContinuationIdentity, createFlowBoxPackagerIdentity, PackagerIdentity } from './packager-identity';
import { SpatialMap } from './spatial-map';
import {
    ObservationResult,
    PackagerCaretInput,
    PackagerCaretResult,
    PackagerContext,
    PackagerHitTestInput,
    PackagerHitTestResult,
    PackagerPlacementPreference,
    PackagerReshapeResult,
    PackagerReshapeProfile,
    PackagerSpatialCaretMoveInput,
    PackagerUnit,
    resolvePackagerChunkOriginWorldY
} from './packager-types';
import { hitTestRichTextBox, resolveCaretInRichTextBox, resolveSpatialCaretMoveInRichTextBoxes } from './text-hit-testing';

type FlowBoxProcessor = {
    normalizeFlowBlock(element: any, options: { path: number[] }): any;
    shapeNormalizedFlowBlock(block: any): FlowBox;
    createFlowMaterializationContext(pageIndex: number, cursorY: number, availableWidth: number, worldY?: number): FlowMaterializationContext;
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
    private cachedSpatialBoxes: Box[] | null = null;
    private cachedSpatialExclusions: readonly SpatialExclusion[] | null = null;
    private cachedSpatialPageIndex: number | null = null;
    private cachedSpatialCursorY: number | null = null;
    private cachedSpatialLayoutBefore: number | null = null;
    private requiredHeight: number = 0;
    private isMaterialized: boolean = false;
    private readonly spatialMap: SpatialMap = new SpatialMap();

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
        (shaper as any).resolvedLinesCache?.delete?.(sourceElement);
        const path = this.flowBox._normalizedFlowBlock?.identitySeed?.path ?? [0];
        const normalized = shaper.normalizeFlowBlock(sourceElement, { path });
        this.flowBox = shaper.shapeNormalizedFlowBlock(normalized);
        this.isMaterialized = false;
        this.cachedBoxes = null;
        this.clearSpatialCache();
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

    getCommittedSignalSubscriptions(): readonly string[] {
        return [buildRuntimeIntentTopic(this.sourceId)];
    }

    participatesInCommittedSignalObservation(): boolean {
        return false;
    }

    updateCommittedState(context: PackagerContext): ObservationResult | null {
        return applyRuntimeFormattingIntentToSourceElement({
            context,
            actor: this,
            sourceElement: this.flowBox._sourceElement,
            rebuild: () => this.rebuildLiveFlowBox(),
            getGeometrySignature: () => this.captureRuntimeGeometrySignature(context)
        });
    }

    private captureRuntimeGeometrySignature(context: PackagerContext): Record<string, number | string> {
        const pageContentWidth = Math.max(0, Number(context.pageWidth || 0) - context.margins.left - context.margins.right);
        const contentWidth = context.contentWidthOverride ?? pageContentWidth;
        this.materialize(pageContentWidth, contentWidth);
        return {
            measuredWidth: Number(Number(this.flowBox.measuredWidth || 0).toFixed(3)),
            measuredContentHeight: Number(Number(this.flowBox.measuredContentHeight || 0).toFixed(3)),
            marginTop: Number(Number(this.flowBox.marginTop || 0).toFixed(3)),
            marginBottom: Number(Number(this.flowBox.marginBottom || 0).toFixed(3)),
            requiredHeight: Number(Number(this.requiredHeight || 0).toFixed(3)),
            lineCount: Array.isArray(this.flowBox.lines) ? this.flowBox.lines.length : 0,
            overflowPolicy: String(this.flowBox.overflowPolicy || '')
        };
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
        this.lastAvailableHeight = availableHeight;
        // Use the resolved page content width so page templates reflow text
        // against the actual owning page without treating collision lanes as
        // permanent line-wrap width.
        const hasPageTemplates = Array.isArray((this.processor as any).config?.layout?.pageTemplates)
            && (this.processor as any).config.layout.pageTemplates.length > 0;
        const pageContentWidth = Math.max(0, Number(context.pageWidth || 0) - context.margins.left - context.margins.right);
        const contentWidth = context.contentWidthOverride ?? (hasPageTemplates ? pageContentWidth : -1);
        this.materialize(availableWidth, contentWidth);
        this.prepareSpatialPlacement(context);
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

    getReshapeProfile(): PackagerReshapeProfile {
        const capabilities: NonNullable<PackagerReshapeProfile['capabilities']> = [
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
        this.prepareSpatialPlacement(context);
        if (this.cachedSpatialBoxes) {
            return this.cachedSpatialBoxes;
        }
        this.prepare(availableWidth, availableHeight, context);
        if (this.cachedSpatialBoxes) {
            return this.cachedSpatialBoxes;
        }
        const processor = this.processor as unknown as FlowBoxProcessor;

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

    hitTestPoint(input: PackagerHitTestInput): PackagerHitTestResult | null {
        return hitTestRichTextBox(input, this, {
            layout: (this.processor as any).config?.layout
        });
    }

    resolveCaretAtPoint(input: PackagerCaretInput): PackagerCaretResult | null {
        return resolveCaretInRichTextBox(input, this, {
            layout: (this.processor as any).config?.layout
        });
    }

    resolveSpatialCaretMove(input: PackagerSpatialCaretMoveInput): PackagerCaretResult | null {
        return resolveSpatialCaretMoveInRichTextBoxes(input, this.cachedBoxes, this, {
            layout: (this.processor as any).config?.layout
        });
    }

    getRequiredHeight(): number {
        return this.requiredHeight;
    }

    getZIndex(): number {
        const style = this.flowBox.style as { zIndex?: unknown } | undefined;
        return Number.isFinite(Number(style?.zIndex)) ? Number(style?.zIndex) : 0;
    }

    isUnbreakable(availableHeight: number): boolean {
        // Simple logic for paragraphs limits splits if allowLineSplit is false
        if (!this.flowBox.allowLineSplit) return true;
        if (!this.flowBox.lines || this.flowBox.lines.length <= 1) return true;

        // Hard fallback for move-whole
        if (this.flowBox.overflowPolicy === 'move-whole') return true;

        return false;
    }

    getLeadingSpacing(): number {
        return this.flowBox.marginTop;
    }

    getTrailingSpacing(): number {
        return this.flowBox.marginBottom;
    }

    prepareLookahead(availableWidth: number, availableHeight: number, context: PackagerContext): void {
        this.lastAvailableHeight = availableHeight;
        const hasPageTemplates = Array.isArray((this.processor as any).config?.layout?.pageTemplates)
            && (this.processor as any).config.layout.pageTemplates.length > 0;
        const pageContentWidth = Math.max(0, Number(context.pageWidth || 0) - context.margins.left - context.margins.right);
        const contentWidth = context.contentWidthOverride ?? (hasPageTemplates ? pageContentWidth : -1);
        this.materialize(availableWidth, contentWidth);
        this.prepareSpatialPlacement(context);
    }

    private prepareSpatialPlacement(context: PackagerContext): void {
        const sourceElement = this.flowBox._sourceElement;
        const exclusions = context.getWorldTraversalExclusions?.(context.pageIndex)
            ?? (context.getPageExclusions?.(context.pageIndex) ?? [])
                .filter((exclusion) => exclusion.surface === 'world-traversal');
        if (!sourceElement || this.flowBox.image || exclusions.length === 0) {
            this.clearSpatialCache();
            return;
        }

        const layoutBefore = Number(context.layoutBefore ?? this.flowBox.marginTop);
        const cursorY = Number(context.cursorY);
        if (
            this.cachedSpatialBoxes
            && this.cachedSpatialExclusions === exclusions
            && this.cachedSpatialPageIndex === context.pageIndex
            && this.cachedSpatialCursorY === cursorY
            && this.cachedSpatialLayoutBefore === layoutBefore
        ) {
            return;
        }

        this.spatialMap.clear();
        for (const exclusion of exclusions) {
            this.registerSpatialExclusion(this.spatialMap, exclusion, context);
        }

        const path = this.flowBox._normalizedFlowBlock?.identitySeed?.path ?? [0];
        const authoredWrapOverride = exclusions.some((exclusion) => exclusion.traversalInteraction === 'wrap');
        const microLanePolicy = authoredWrapOverride
            ? 'allow'
            : resolveDocumentMicroLanePolicy((this.processor as any).config?.layout);
        const minUsableSlotWidth = resolveMinUsableLaneWidth({
            policy: microLanePolicy,
            element: sourceElement,
            availableWidth: Math.max(0, context.pageWidth - context.margins.left - context.margins.right)
        });
        const placed = reflowTextElementAgainstSpatialField({
            processor: this.processor,
            element: sourceElement,
            path,
            sourceFlowBox: this.flowBox,
            availableWidth: Math.max(0, context.pageWidth - context.margins.left - context.margins.right),
            currentY: 0,
            layoutBefore,
            spatialMap: this.spatialMap,
            leftMargin: context.margins.left,
            pageIndex: context.pageIndex,
            ...(Number.isFinite(resolvePackagerChunkOriginWorldY(context))
                ? { worldY: Number(resolvePackagerChunkOriginWorldY(context)) }
                : {}),
            clearTopBeforeStart: false,
            minUsableSlotWidth,
            rejectSubMinimumSlots: microLanePolicy !== 'allow'
        });
        if (!placed) {
            this.clearSpatialCache();
            return;
        }

        this.cachedSpatialBoxes = [{
            ...placed.box,
            y: Number(placed.box.y || 0)
        }];
        this.cachedSpatialExclusions = exclusions;
        this.cachedSpatialPageIndex = context.pageIndex;
        this.cachedSpatialCursorY = cursorY;
        this.cachedSpatialLayoutBefore = layoutBefore;
        this.requiredHeight = placed.marginTop + placed.contentHeight + placed.marginBottom;
    }

    private clearSpatialCache(): void {
        this.cachedSpatialBoxes = null;
        this.cachedSpatialExclusions = null;
        this.cachedSpatialPageIndex = null;
        this.cachedSpatialCursorY = null;
        this.cachedSpatialLayoutBefore = null;
        this.spatialMap.clear();
    }

    private registerSpatialExclusion(
        spatialMap: SpatialMap,
        exclusion: SpatialExclusion,
        context: PackagerContext
    ): void {
        spatialMap.register({
            x: Number(exclusion.x || 0) - context.margins.left,
            y: Number(exclusion.y || 0) - context.cursorY,
            w: Math.max(0, Number(exclusion.w || 0)),
            h: Math.max(0, Number(exclusion.h || 0)),
            wrap: exclusion.wrap ?? 'around',
            gap: Number.isFinite(Number(exclusion.gap)) ? Math.max(0, Number(exclusion.gap)) : 0,
            gapTop: Number.isFinite(Number(exclusion.gapTop)) ? Math.max(0, Number(exclusion.gapTop)) : undefined,
            gapBottom: Number.isFinite(Number(exclusion.gapBottom)) ? Math.max(0, Number(exclusion.gapBottom)) : undefined,
            shape: exclusion.shape === 'circle'
                ? 'circle'
                : exclusion.shape === 'ellipse'
                    ? 'ellipse'
                : exclusion.shape === 'polygon'
                    ? 'polygon'
                    : 'rect',
            path: typeof exclusion.path === 'string' && exclusion.path.trim() ? exclusion.path.trim() : undefined,
            align: exclusion.align,
            traversalInteraction: exclusion.traversalInteraction ?? 'auto',
            zIndex: Number.isFinite(Number(exclusion.zIndex)) ? Number(exclusion.zIndex) : 0
        });
    }

    reshape(availableHeight: number, context: PackagerContext): PackagerReshapeResult {
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
        this.cachedBoxes = null;
        this.clearSpatialCache();
        return { currentFragment: partA, continuationFragment: partB };
    }
}
