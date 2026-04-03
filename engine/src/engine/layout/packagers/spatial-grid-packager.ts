import { Box } from '../../types';
import { LayoutProcessor } from '../layout-core';
import { FlowBox, type FlowMaterializationContext } from '../layout-core-types';
import { materializeSpatialGridFlowBox, splitSpatialGridFlowBox, type SpatialGridLayoutContext } from '../layout-table';
import { createContinuationIdentity, createFlowBoxPackagerIdentity, PackagerIdentity } from './packager-identity';
import {
    PackagerContext,
    PackagerPlacementPreference,
    PackagerSplitResult,
    PackagerTransformProfile,
    PackagerUnit,
    resolvePackagerChunkOriginWorldY
} from './packager-types';

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

    getTransformProfile(): PackagerTransformProfile {
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

        const chunkOriginWorldY = Number.isFinite(resolvePackagerChunkOriginWorldY(context))
            ? Math.max(0, Number(resolvePackagerChunkOriginWorldY(context)))
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

    getMarginTop(): number {
        return this.flowBox.marginTop;
    }

    getMarginBottom(): number {
        return this.flowBox.marginBottom;
    }

    split(availableHeight: number, context: PackagerContext): PackagerSplitResult {
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
