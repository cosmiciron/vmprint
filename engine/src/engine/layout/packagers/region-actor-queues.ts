import type { Element, ElementStyle } from '../../types';
import type { LayoutProcessor } from '../layout-core';
import type { NormalizedIndependentZone, NormalizedIndependentZoneStrip } from '../normalized-zone-strip';
import { buildPackagerForElement } from './create-packagers';
import type { PackagerUnit } from './packager-types';

export type HostedRegionActorEntry = {
    actor: PackagerUnit;
    element: Element;
};

export type HostedRegionActorQueue = {
    id?: string;
    rect: {
        x: number;
        y: number;
        width: number;
        height?: number;
    };
    style?: ElementStyle;
    actors: HostedRegionActorEntry[];
};

export type HostedRegionDescriptor = Pick<HostedRegionActorQueue, 'id' | 'rect' | 'style'>;

function buildHostedRegionActorEntries(
    zone: NormalizedIndependentZone,
    processor: LayoutProcessor
): HostedRegionActorEntry[] {
    return (zone.elements ?? []).map((element, index) => ({
        element,
        actor: buildPackagerForElement(element, index, processor)
    }));
}

export function buildHostedRegionActorQueuesFromZones(
    zones: readonly NormalizedIndependentZone[],
    processor: LayoutProcessor
): HostedRegionActorQueue[] {
    return zones.map((zone) => ({
        id: zone.id,
        rect: { ...zone.rect },
        style: zone.style,
        actors: buildHostedRegionActorEntries(zone, processor)
    }));
}

export function buildHostedRegionActorQueues(
    strip: NormalizedIndependentZoneStrip,
    processor: LayoutProcessor
): HostedRegionActorQueue[] {
    return buildHostedRegionActorQueuesFromZones(strip.zones, processor);
}
