import { Element } from '../../types';
import { LayoutProcessor } from '../layout-core';
import { createElementPackagerIdentity, PackagerIdentity } from './packager-identity';
import {
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

function synthesizeZoneMapFromWorldPlain(element: Element): Element {
    return {
        type: 'zone-map',
        content: element.content || '',
        properties: {
            ...(element.properties || {}),
            style: { ...((element.properties?.style || {}) as Record<string, unknown>) }
        },
        zones: [
            {
                id: 'plain',
                elements: [...(element.children || [])]
            }
        ],
        zoneLayout: {
            columns: [{ mode: 'flex', fr: 1 }],
            gap: 0,
            frameOverflow: 'move-whole',
            worldBehavior: 'fixed'
        }
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

    constructor(
        private readonly element: Element,
        processor: LayoutProcessor,
        identity?: PackagerIdentity
    ) {
        const resolvedIdentity = identity ?? createElementPackagerIdentity(element, [0]);
        const synthesized = synthesizeZoneMapFromWorldPlain(element);
        this.inner = new ZonePackager(synthesized, processor, {
            ...resolvedIdentity,
            actorKind: 'world-plain'
        });
        this.actorId = resolvedIdentity.actorId;
        this.sourceId = resolvedIdentity.sourceId;
        this.actorKind = 'world-plain';
        this.fragmentIndex = resolvedIdentity.fragmentIndex;
        this.continuationOf = resolvedIdentity.continuationOf;
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
