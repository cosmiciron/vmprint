import { Box, Element } from '../../types';
import { LayoutProcessor } from '../layout-core';
import { FlowBox, type FlowMaterializationContext } from '../layout-core-types';
import { resolveDocumentMicroLanePolicy, resolveMinUsableLaneWidth } from '../micro-lane-policy';
import { reflowTextElementAgainstSpatialField } from '../spatial-field-reflow';
import { createContinuationIdentity, createFlowBoxPackagerIdentity, PackagerIdentity } from './packager-identity';
import { resolveSpatialFieldOverflow, SpatialFieldGeometryCapability } from './spatial-field-capability';
import { SpatialMap } from './spatial-map';
import { buildContainedContinueFragment, resolveContainedContentSummary, resolveContainedVisibleHeight } from './contained-overflow-fragments';
import { registerContainedField } from './contained-field-geometry';
import {
    PackagerContext,
    PackagerPlacementPreference,
    PackagerReshapeProfile,
    PackagerReshapeResult,
    PackagerUnit,
    resolvePackagerChunkOriginWorldY
} from './packager-types';

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

export class ContainedFlowPackager implements PackagerUnit {
    private lastAvailableWidth = -1;
    private lastContentWidth = -1;
    private lastAvailableHeight = -1;
    private cachedSpatialBoxes: Box[] | null = null;
    private cachedPlacementKey: string | null = null;
    private requiredHeight = 0;
    private readonly spatialMap = new SpatialMap();
    private isMaterialized = false;

    readonly actorId: string;
    readonly sourceId: string;
    readonly actorKind: string;
    readonly fragmentIndex: number;
    readonly continuationOf?: string;

    get pageBreakBefore(): boolean | undefined { return this.flowBox.pageBreakBefore; }
    get keepWithNext(): boolean | undefined { return this.flowBox.keepWithNext; }

    constructor(
        private processor: LayoutProcessor,
        private flowBox: FlowBox,
        identity?: PackagerIdentity
    ) {
        const resolvedIdentity = createFlowBoxPackagerIdentity(flowBox, identity);
        this.actorId = resolvedIdentity.actorId;
        this.sourceId = resolvedIdentity.sourceId;
        this.actorKind = resolvedIdentity.actorKind;
        this.fragmentIndex = resolvedIdentity.fragmentIndex;
        this.continuationOf = resolvedIdentity.continuationOf;
    }

    prepare(availableWidth: number, availableHeight: number, context: PackagerContext): void {
        this.lastAvailableHeight = availableHeight;
        this.lastAvailableWidth = availableWidth;
        this.lastContentWidth = context.contentWidthOverride ?? -1;
        this.materialize(availableWidth, this.lastContentWidth);
        this.prepareContainedPlacement(context);
    }

    prepareLookahead(availableWidth: number, availableHeight: number, context: PackagerContext): void {
        this.lastAvailableHeight = availableHeight;
        this.lastAvailableWidth = availableWidth;
        this.lastContentWidth = context.contentWidthOverride ?? -1;
        this.materialize(availableWidth, this.lastContentWidth);
        if (this.prepareSealedContainmentLookahead()) {
            return;
        }
        this.prepareContainedPlacement(context);
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
            { kind: 'split', preservesIdentity: true, producesContinuation: true }
        ];
        if (this.flowBox._materializationMode === 'reflowable' && !!this.flowBox._sourceElement) {
            capabilities.push({ kind: 'morph', preservesIdentity: true, reflowsContent: true });
        }
        return { capabilities };
    }

    emitBoxes(availableWidth: number, availableHeight: number, context: PackagerContext): Box[] {
        this.prepare(availableWidth, availableHeight, context);
        return this.projectBoxesForContext(this.cachedSpatialBoxes || [], context);
    }

    getRequiredHeight(): number {
        return this.requiredHeight;
    }

    getZIndex(): number {
        const style = this.flowBox.style as { zIndex?: unknown } | undefined;
        return Number.isFinite(Number(style?.zIndex)) ? Number(style?.zIndex) : 0;
    }

    isUnbreakable(_availableHeight: number): boolean {
        if (!this.flowBox.allowLineSplit) return true;
        if (!this.flowBox.lines || this.flowBox.lines.length <= 1) return true;
        if (this.flowBox.overflowPolicy === 'move-whole') return true;
        return false;
    }

    getLeadingSpacing(): number {
        return this.flowBox.marginTop;
    }

    getTrailingSpacing(): number {
        return this.flowBox.marginBottom;
    }

    reshape(availableHeight: number, context: PackagerContext): PackagerReshapeResult {
        const processor = this.processor as unknown as FlowBoxProcessor;
        this.materialize(this.lastAvailableWidth, this.lastContentWidth);
        if (this.isUnbreakable(availableHeight)) {
            return { currentFragment: null, continuationFragment: this };
        }

        const splitResult = processor.splitFlowBox(
            this.flowBox,
            availableHeight,
            this.flowBox.marginTop
        );
        if (!splitResult) {
            return { currentFragment: null, continuationFragment: this };
        }

        this.cachedSpatialBoxes = null;
        this.spatialMap.clear();

        return {
            currentFragment: new ContainedFlowPackager(this.processor, splitResult.partA, {
                actorId: this.actorId,
                sourceId: this.sourceId,
                actorKind: this.actorKind,
                fragmentIndex: this.fragmentIndex,
                continuationOf: this.continuationOf
            }),
            continuationFragment: new ContainedFlowPackager(
                this.processor,
                splitResult.partB,
                createContinuationIdentity(this, splitResult.partB.meta?.fragmentIndex)
            )
        };
    }

    private materialize(availableWidth: number, contentWidth: number = -1): void {
        const processor = this.processor as unknown as FlowBoxProcessor;
        if (this.isMaterialized && this.lastAvailableWidth === availableWidth && this.lastContentWidth === contentWidth) {
            return;
        }
        const materializeContext = processor.createFlowMaterializationContext(0, 0, contentWidth);
        processor.materializeFlowBox(this.flowBox, materializeContext);
        this.lastAvailableWidth = availableWidth;
        this.lastContentWidth = contentWidth;
        this.isMaterialized = true;
    }

    private prepareSealedContainmentLookahead(): boolean {
        const directive = (this.flowBox._sourceElement?.properties?.space ?? this.flowBox._sourceElement?.properties?.spatialField) as any;
        if (!directive || resolveSpatialFieldOverflow(directive) !== 'stash' || this.flowBox.overflowPolicy !== 'clip') {
            return false;
        }
        const hostHeight = resolveContainedVisibleHeight(this.flowBox, this.flowBox.style);
        if (!(hostHeight > 0)) {
            return false;
        }
        this.requiredHeight = Math.max(0, this.flowBox.marginTop) + hostHeight + this.flowBox.marginBottom;
        return true;
    }

    private prepareContainedPlacement(context: PackagerContext): void {
        const sourceElement = this.flowBox._sourceElement;
        const directive = (sourceElement?.properties?.space ?? sourceElement?.properties?.spatialField) as any;
        if (!sourceElement || directive?.kind !== 'contain' || this.flowBox.image) {
            this.cachedSpatialBoxes = null;
            this.cachedPlacementKey = null;
            return;
        }

        const placementKey = [
            context.pageWidth,
            context.margins.left,
            context.margins.right,
            context.contentWidthOverride ?? -1
        ].join(':');
        if (this.cachedSpatialBoxes && this.cachedPlacementKey === placementKey) {
            return;
        }

        this.spatialMap.clear();
        registerContainedField(this.spatialMap, sourceElement);

        const availableWidth = resolveContainmentHostWidth(
            sourceElement,
            Math.max(0, context.pageWidth - context.margins.left - context.margins.right)
        );
        const microLanePolicy = resolveDocumentMicroLanePolicy((this.processor as any).config?.layout);
        const minUsableSlotWidth = resolveMinUsableLaneWidth({
            policy: microLanePolicy,
            element: sourceElement,
            availableWidth
        });

        const placed = reflowTextElementAgainstSpatialField({
            processor: this.processor,
            element: sourceElement,
            path: this.flowBox._normalizedFlowBlock?.identitySeed?.path ?? [0],
            sourceFlowBox: this.flowBox,
            availableWidth,
            currentY: 0,
            layoutBefore: 0,
            spatialMap: this.spatialMap,
            leftMargin: context.margins.left,
            pageIndex: context.pageIndex,
            ...(Number.isFinite(resolvePackagerChunkOriginWorldY(context))
                ? { worldY: Number(resolvePackagerChunkOriginWorldY(context)) }
                : {}),
            clearTopBeforeStart: false,
            minUsableSlotWidth,
            rejectSubMinimumSlots: microLanePolicy !== 'allow',
            microLanePolicy
        });

        if (!placed) {
            this.cachedSpatialBoxes = null;
            this.cachedPlacementKey = null;
            this.requiredHeight = 0;
            return;
        }

        const overflowMode = resolveSpatialFieldOverflow(directive);
        const clipProperties = new SpatialFieldGeometryCapability(sourceElement).buildClipProperties();
        const contentSummary = resolveContainedContentSummary(
            this.processor,
            sourceElement,
            placed.lines,
            placed.lines.length,
            overflowMode
        );
        const continued = overflowMode === 'continue'
            ? this.buildContainedContinuePlacement(placed, sourceElement, context)
            : null;

        this.cachedSpatialBoxes = continued
            ? continued.boxes
            : [{
                ...placed.box,
                y: Number(placed.box.y || 0),
                properties: {
                    ...(placed.box.properties || {}),
                    ...clipProperties,
                    _containedContentSummary: contentSummary
                }
            }];
        this.cachedPlacementKey = placementKey;
        this.requiredHeight = placed.marginTop + (continued ? continued.contentHeight : placed.contentHeight) + placed.marginBottom;
    }

    private buildContainedContinuePlacement(
        placed: ReturnType<typeof reflowTextElementAgainstSpatialField>,
        sourceElement: Element,
        context: PackagerContext
    ): { boxes: Box[]; contentHeight: number } | null {
        const fragment = buildContainedContinueFragment(
            this.processor,
            sourceElement,
            placed.box,
            placed,
            resolveContainedVisibleHeight(this.flowBox, this.flowBox.style)
        );
        if (!fragment) {
            return null;
        }
        const processor = this.processor as unknown as FlowBoxProcessor;
        const path = this.flowBox._normalizedFlowBlock?.identitySeed?.path ?? [0];
        const normalized = processor.normalizeFlowBlock(fragment.continuationElement, { path });
        const continuationFlowBox = processor.shapeNormalizedFlowBlock(normalized);
        const contentWidth = context.contentWidthOverride ?? -1;
        const materializeContext = processor.createFlowMaterializationContext(0, 0, contentWidth);
        processor.materializeFlowBox(continuationFlowBox, materializeContext);
        const positioned = processor.positionFlowBox(
            continuationFlowBox,
            fragment.contentHeight,
            continuationFlowBox.marginTop,
            context.margins,
            Math.max(0, context.pageWidth - context.margins.left - context.margins.right),
            0
        );
        const continuationBoxes = (Array.isArray(positioned) ? positioned : [positioned]).map((box) => ({
            ...box,
            y: Number(box.y || 0)
        }));
        const continuationHeight = Math.max(0, continuationFlowBox.marginTop) + continuationFlowBox.measuredContentHeight + continuationFlowBox.marginBottom;

        return {
            boxes: [{
                ...fragment.box,
                y: Number(fragment.box.y || 0),
                properties: {
                    ...(fragment.box.properties || {}),
                    ...new SpatialFieldGeometryCapability(sourceElement).buildClipProperties(),
                    _containedContentSummary: fragment.contentSummary
                }
            }, ...continuationBoxes],
            contentHeight: fragment.contentHeight + continuationHeight
        };
    }

    private projectBoxesForContext(boxes: Box[], context: PackagerContext): Box[] {
        const layoutBefore = Number(context.layoutBefore ?? this.flowBox.marginTop);
        if (!(layoutBefore > 0)) {
            return boxes;
        }
        return boxes.map((box) => {
            const props = box.properties || {};
            const worldY = Number(props._worldY);
            return {
                ...box,
                y: Number(box.y || 0) + layoutBefore,
                properties: Number.isFinite(worldY)
                    ? { ...props, _worldY: worldY + layoutBefore }
                    : props
            };
        });
    }
}

function resolveContainmentHostWidth(element: Element, fallbackWidth: number): number {
    const style = (element.properties?.style || {}) as { width?: unknown };
    const authoredWidth = Number(style.width);
    if (Number.isFinite(authoredWidth) && authoredWidth > 0) return authoredWidth;
    return fallbackWidth;
}
