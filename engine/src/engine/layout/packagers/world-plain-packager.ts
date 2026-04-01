import { Element, ZoneFrameOverflow, ZoneWorldBehavior } from '../../types';
import { LayoutProcessor } from '../layout-core';
import { createElementPackagerIdentity, PackagerIdentity } from './packager-identity';
import { buildHostedRegionActorQueuesFromZones } from './region-actor-queues';
import {
    DebugRegion,
    PackagerContext,
    PackagerPlacementPreference,
    PackagerSplitResult,
    PackagerTransformProfile,
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
    };
    return {
        sourceKind: 'world-plain' as const,
        frameOverflow: options.frameOverflow === 'move-whole' ? 'move-whole' : 'continue',
        worldBehavior: options.worldBehavior === 'fixed' || options.worldBehavior === 'spanning' || options.worldBehavior === 'expandable'
            ? options.worldBehavior
            : 'expandable',
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
    }

    get pageBreakBefore(): boolean | undefined {
        return this.inner.pageBreakBefore;
    }

    get keepWithNext(): boolean | undefined {
        return this.inner.keepWithNext;
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

    getTransformProfile(): PackagerTransformProfile {
        return this.inner.getTransformProfile();
    }

    emitBoxes(availableWidth: number, availableHeight: number, context: PackagerContext) {
        return this.inner.emitBoxes(availableWidth, availableHeight, context);
    }

    getRequiredHeight(): number {
        return this.inner.getRequiredHeight();
    }

    isUnbreakable(availableHeight: number): boolean {
        return this.inner.isUnbreakable(availableHeight);
    }

    getMarginTop(): number {
        return this.inner.getMarginTop();
    }

    getMarginBottom(): number {
        return this.inner.getMarginBottom();
    }

    split(availableHeight: number, context: PackagerContext): PackagerSplitResult {
        return this.inner.split(availableHeight, context);
    }
}
