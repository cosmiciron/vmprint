import { Element, SpatialFieldDirective, TraversalInteractionPolicy, ZoneFrameOverflow, ZoneWorldBehavior } from '../../types';
import { LayoutProcessor } from '../layout-core';
import { buildExclusionFieldObstacles } from '../exclusion-field';
import { createElementPackagerIdentity, PackagerIdentity } from './packager-identity';
import { buildHostedRegionActorQueuesFromZones } from './region-actor-queues';
import {
    DebugRegion,
    PackagerContext,
    PackagerPlacementPreference,
    PackagerReshapeResult,
    PackagerReshapeProfile,
    PackagerUnit
} from './packager-types';
import { HostedRegionPackager } from './hosted-region-packager';

export function isWorldPlainElement(element: Element | undefined): boolean {
    return String(element?.type || '').trim().toLowerCase() === 'world-plain';
}

function resolveWorldPlainHostLayout(element: Element) {
    const style = (element.properties?.style ?? {}) as Record<string, unknown>;
    const options = (element.properties?._worldPlainOptions ?? {}) as {
        frameOverflow?: ZoneFrameOverflow;
        worldBehavior?: ZoneWorldBehavior;
        rootFlowMode?: 'wrapped' | 'traverse';
        traversalInteractionDefault?: TraversalInteractionPolicy;
    };
    return {
        sourceKind: 'world-plain' as const,
        frameOverflow: options.frameOverflow === 'move-whole' ? 'move-whole' : 'continue',
        worldBehavior: options.worldBehavior === 'fixed' || options.worldBehavior === 'spanning' || options.worldBehavior === 'expandable'
            ? options.worldBehavior
            : 'expandable',
        rootFlowMode: options.rootFlowMode === 'traverse' ? 'traverse' : 'wrapped',
        traversalInteractionDefault: options.traversalInteractionDefault === 'wrap'
            || options.traversalInteractionDefault === 'overpass'
            || options.traversalInteractionDefault === 'ignore'
            || options.traversalInteractionDefault === 'auto'
            ? options.traversalInteractionDefault
            : 'auto',
        marginTop: Math.max(0, Number(style.marginTop ?? 0) || 0),
        marginBottom: Math.max(0, Number(style.marginBottom ?? 0) || 0),
    };
}

function buildWorldPlainRegionQueues(
    element: Element,
    availableWidth: number,
    processor: LayoutProcessor
) {
    return buildHostedRegionActorQueuesFromZones(
        [
            {
                id: 'plain',
                rect: {
                    x: 0,
                    y: 0,
                    width: Math.max(0, availableWidth)
                },
                elements: [...(element.children || [])]
            }
        ],
        processor
    );
}

function describeWorldPlainRegions(availableWidth: number) {
    return [
        {
            id: 'plain',
            rect: {
                x: 0,
                y: 0,
                width: Math.max(0, availableWidth)
            }
        }
    ];
}

function normalizeWorldPlainElement(element: Element) {
    const hostLayout = resolveWorldPlainHostLayout(element);
    return {
        kind: 'world-plain' as const,
        sourceKind: hostLayout.sourceKind,
        frameOverflow: hostLayout.frameOverflow,
        worldBehavior: hostLayout.worldBehavior,
        rootFlowMode: hostLayout.rootFlowMode,
        traversalInteractionDefault: hostLayout.traversalInteractionDefault,
        marginTop: hostLayout.marginTop,
        marginBottom: hostLayout.marginBottom
    };
}

/**
 * First-pass world host.
 *
 * World Plain is a distinct host concept, but its initial settlement arena is
 * intentionally implemented as a single-region map so we can reuse the lowered
 * spatial-field and actor-reassembly machinery without inventing a second
 * independent stack immediately.
 */
export class WorldPlainPackager implements PackagerUnit {
    private readonly inner: HostedRegionPackager;

    readonly actorId: string;
    readonly sourceId: string;
    readonly actorKind: string;
    readonly fragmentIndex: number;
    readonly continuationOf?: string;
    readonly frameOverflowMode: ZoneFrameOverflow;
    readonly worldBehaviorMode: ZoneWorldBehavior;
    readonly rootFlowMode: 'wrapped' | 'traverse';
    readonly traversalInteractionDefault: TraversalInteractionPolicy;

    constructor(
        private readonly element: Element,
        processor: LayoutProcessor,
        identity?: PackagerIdentity
    ) {
        const resolvedIdentity = identity ?? createElementPackagerIdentity(element, [0]);
        const normalized = normalizeWorldPlainElement(element);
        this.inner = new HostedRegionPackager(element, processor, {
            ...resolvedIdentity,
            actorKind: 'world-plain'
        }, undefined, undefined, undefined, undefined, () => normalized, (availableWidth) =>
            buildWorldPlainRegionQueues(element, availableWidth, processor), describeWorldPlainRegions);
        this.actorId = resolvedIdentity.actorId;
        this.sourceId = resolvedIdentity.sourceId;
        this.actorKind = 'world-plain';
        this.fragmentIndex = resolvedIdentity.fragmentIndex;
        this.continuationOf = resolvedIdentity.continuationOf;
        this.frameOverflowMode = this.inner.frameOverflowMode;
        this.worldBehaviorMode = this.inner.worldBehaviorMode;
        this.rootFlowMode = normalized.rootFlowMode;
        this.traversalInteractionDefault = normalized.traversalInteractionDefault;
    }

    get pageBreakBefore(): boolean | undefined {
        return this.rootFlowMode === 'traverse' ? undefined : this.inner.pageBreakBefore;
    }

    get keepWithNext(): boolean | undefined {
        return this.rootFlowMode === 'traverse' ? undefined : this.inner.keepWithNext;
    }

    getHostedRuntimeActors(): readonly PackagerUnit[] {
        return this.inner.getHostedRuntimeActors();
    }

    getDebugRegions(): DebugRegion[] {
        return this.inner.getDebugRegions();
    }

    handlesHostedRuntimeActor(targetActor: PackagerUnit): boolean {
        return this.inner.handlesHostedRuntimeActor(targetActor);
    }

    insertHostedRuntimeActors(
        targetActor: PackagerUnit,
        insertions: readonly PackagerUnit[],
        position: 'before' | 'after',
        sourceElements?: readonly Element[]
    ): boolean {
        return this.inner.insertHostedRuntimeActors(targetActor, insertions, position, sourceElements);
    }

    deleteHostedRuntimeActor(targetActor: PackagerUnit): boolean {
        return this.inner.deleteHostedRuntimeActor(targetActor);
    }

    replaceHostedRuntimeActor(
        targetActor: PackagerUnit,
        replacements: readonly PackagerUnit[],
        sourceElements?: readonly Element[]
    ): boolean {
        return this.inner.replaceHostedRuntimeActor(targetActor, replacements, sourceElements);
    }

    refreshHostedRuntimeActor(targetActor: PackagerUnit): boolean {
        return this.inner.refreshHostedRuntimeActor?.(targetActor) ?? false;
    }

    prepare(availableWidth: number, availableHeight: number, context: PackagerContext): void {
        this.inner.prepare(availableWidth, availableHeight, context);
    }

    getPlacementPreference(fullAvailableWidth: number, context: PackagerContext): PackagerPlacementPreference | null {
        return this.inner.getPlacementPreference(fullAvailableWidth, context);
    }

    getReshapeProfile(): PackagerReshapeProfile {
        return this.inner.getReshapeProfile();
    }

    emitBoxes(availableWidth: number, availableHeight: number, context: PackagerContext) {
        const boxes = this.inner.emitBoxes(availableWidth, availableHeight, context);
        if (this.rootFlowMode === 'traverse') {
            this.publishTraversingFlowExclusions(boxes, context);
        }
        return boxes;
    }

    getRequiredHeight(): number {
        return this.rootFlowMode === 'traverse' ? 0 : this.inner.getRequiredHeight();
    }

    getZIndex(): number {
        return 0;
    }

    isUnbreakable(availableHeight: number): boolean {
        return this.inner.isUnbreakable(availableHeight);
    }

    getLeadingSpacing(): number {
        return this.rootFlowMode === 'traverse' ? 0 : this.inner.getLeadingSpacing();
    }

    getTrailingSpacing(): number {
        return this.rootFlowMode === 'traverse' ? 0 : this.inner.getTrailingSpacing();
    }

    occupiesFlowSpace(): boolean {
        return this.rootFlowMode !== 'traverse';
    }

    reshape(availableHeight: number, context: PackagerContext): PackagerReshapeResult {
        return this.inner.reshape(availableHeight, context);
    }

    private publishTraversingFlowExclusions(
        boxes: ReturnType<HostedRegionPackager['emitBoxes']>,
        context: PackagerContext
    ): void {
        const session = context.processor.getCurrentLayoutSession?.() ?? null;
        if (!session || !Array.isArray(boxes)) return;

        for (const box of boxes) {
            const directive = (box.properties?.space ?? box.properties?.spatialField) as SpatialFieldDirective | undefined;
            if (!directive || (directive.kind !== undefined && directive.kind !== 'exclude')) continue;
            const sourceId = String(box.meta?.sourceId || this.sourceId || 'world-plain');
            const obstacles = buildExclusionFieldObstacles({
                x: Number(box.x || 0),
                y: Number(box.y || 0) + context.cursorY,
                w: Math.max(0, Number(box.w || 0)),
                h: Math.max(0, Number(box.h || 0)),
                wrap: directive.wrap ?? 'around',
                gap: directive.gap ?? 0,
                shape: directive.shape,
                align: directive.align,
                exclusionAssembly: directive.exclusionAssembly,
                traversalInteraction: directive.traversalInteraction ?? this.traversalInteractionDefault,
                zIndex: Number.isFinite(Number(directive.zIndex))
                    ? Number(directive.zIndex)
                    : (Number.isFinite(Number(box.style?.zIndex)) ? Number(box.style?.zIndex) : 0)
            });
            obstacles.forEach((obstacle, index) => {
                session.excludePageSpace({
                    id: `world-plain:traverse:${context.pageIndex}:${sourceId}:${index}`,
                    x: obstacle.x,
                    y: obstacle.y,
                    w: obstacle.w,
                    h: obstacle.h,
                    surface: 'world-traversal',
                    source: `world-plain:${sourceId}`,
                    wrap: obstacle.wrap,
                    gap: obstacle.gap,
                    gapTop: obstacle.gapTop,
                    gapBottom: obstacle.gapBottom,
                    shape: obstacle.shape,
                    align: obstacle.align,
                    traversalInteraction: obstacle.traversalInteraction,
                    zIndex: obstacle.zIndex
                }, context.pageIndex);
            });
        }
    }
}
