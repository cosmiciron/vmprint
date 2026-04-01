import { Element, ZoneFrameOverflow, ZoneWorldBehavior } from '../../types';
import { LayoutProcessor } from '../layout-core';
import { createElementPackagerIdentity, PackagerIdentity } from './packager-identity';
import {
    DebugZoneRegion,
    PackagerContext,
    PackagerPlacementPreference,
    PackagerSplitResult,
    PackagerTransformProfile,
    PackagerUnit
} from './packager-types';
import { ZonePackager } from './zone-packager';

export function isWorldPlainElement(element: Element | undefined): boolean {
    return String(element?.type || '').trim().toLowerCase() === 'world-plain';
}

function normalizeWorldPlainElement(element: Element, availableWidth: number) {
    const style = (element.properties?.style ?? {}) as Record<string, unknown>;
    const options = (element.properties?._worldPlainOptions ?? {}) as {
        frameOverflow?: ZoneFrameOverflow;
        worldBehavior?: ZoneWorldBehavior;
    };
    return {
        kind: 'zone-strip' as const,
        overflow: 'independent' as const,
        sourceKind: 'world-plain' as const,
        frameOverflow: options.frameOverflow === 'move-whole' ? 'move-whole' : 'continue',
        worldBehavior: options.worldBehavior === 'fixed' || options.worldBehavior === 'spanning' || options.worldBehavior === 'expandable'
            ? options.worldBehavior
            : 'expandable',
        marginTop: Math.max(0, Number(style.marginTop ?? 0) || 0),
        marginBottom: Math.max(0, Number(style.marginBottom ?? 0) || 0),
        gap: 0,
        blockStyle: Object.keys(style).length > 0 ? style as any : undefined,
        zones: [
            {
                id: 'plain',
                rect: {
                    x: 0,
                    y: 0,
                    width: Math.max(0, availableWidth)
                },
                elements: [...(element.children || [])]
            }
        ]
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
    private readonly inner: ZonePackager;

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
        this.inner = new ZonePackager(element, processor, {
            ...resolvedIdentity,
            actorKind: 'world-plain'
        }, undefined, undefined, undefined, (availableWidth) => normalizeWorldPlainElement(element, availableWidth));
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

    getDebugRegions(): DebugZoneRegion[] {
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
