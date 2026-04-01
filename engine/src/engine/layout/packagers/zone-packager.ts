/**
 * ZonePackager – zone-map specific adapter over the generic hosted-region host.
 */

import { Element, ElementStyle, TableColumnSizing, ZoneDefinition, ZoneLayoutOptions } from '../../types';
import { LayoutProcessor } from '../layout-core';
import { LayoutUtils } from '../layout-utils';
import type { NormalizedIndependentZoneStrip } from '../normalized-zone-strip';
import { solveTrackSizing, TrackSizingDefinition } from '../track-sizing';
import { createElementPackagerIdentity, PackagerIdentity } from './packager-identity';
import { type HostedRegionActorQueue, type HostedRegionDescriptor } from './region-actor-queues';
import { HostedRegionPackager } from './hosted-region-packager';

export function isZoneMapElement(element: Element | undefined): boolean {
    return String(element?.type || '').trim().toLowerCase() === 'zone-map';
}

type ZoneHostLayout = Pick<
    NormalizedIndependentZoneStrip,
    'sourceKind' | 'frameOverflow' | 'worldBehavior' | 'marginTop' | 'marginBottom'
>;

function resolveTrackWidths(columns: TableColumnSizing[] | undefined, columnCount: number, availableWidth: number, gap: number): number[] {
    if (columns && columns.length > 0) {
        const tracks: TrackSizingDefinition[] = columns.map((c) => ({
            mode: c.mode || 'auto',
            value: c.value,
            fr: c.fr,
            min: c.min,
            max: c.max,
            basis: c.basis,
            minContent: c.minContent,
            maxContent: c.maxContent,
            grow: c.grow,
            shrink: c.shrink
        }));
        return solveTrackSizing({ containerWidth: availableWidth, tracks, gap }).sizes;
    }
    const colWidth = (availableWidth - gap * Math.max(0, columnCount - 1)) / Math.max(1, columnCount);
    return Array(columnCount).fill(Math.max(0, colWidth));
}

export function normalizeZoneMapElement(element: Element, availableWidth: number): NormalizedIndependentZoneStrip {
    const style = (element.properties?.style ?? {}) as ElementStyle;
    const marginTop = Math.max(0, LayoutUtils.validateUnit(style.marginTop ?? 0));
    const marginBottom = Math.max(0, LayoutUtils.validateUnit(style.marginBottom ?? 0));

    const options = (element.zoneLayout ?? {}) as ZoneLayoutOptions;
    const gap = Math.max(0, LayoutUtils.validateUnit(options.gap ?? 0));
    const frameOverflow = options.frameOverflow === 'continue' ? 'continue' : 'move-whole';
    const worldBehavior = options.worldBehavior === 'spanning' || options.worldBehavior === 'expandable'
        ? options.worldBehavior
        : 'fixed';

    const zoneDefs: ZoneDefinition[] = Array.isArray(element.zones) ? element.zones : [];
    const columnCount = zoneDefs.length;

    if (columnCount === 0) {
        return {
            kind: 'zone-strip',
            overflow: 'independent',
            sourceKind: 'zone-map',
            frameOverflow,
            worldBehavior,
            marginTop,
            marginBottom,
            gap,
            blockStyle: Object.keys(style).length > 0 ? style : undefined,
            zones: []
        };
    }

    const columnWidths = resolveTrackWidths(options.columns, columnCount, availableWidth, gap);
    const xOffsets: number[] = [];
    let xCursor = 0;
    for (let i = 0; i < columnCount; i++) {
        xOffsets.push(xCursor);
        xCursor += (columnWidths[i] ?? 0) + (i < columnCount - 1 ? gap : 0);
    }

    return {
        kind: 'zone-strip',
        overflow: 'independent',
        sourceKind: 'zone-map',
        frameOverflow,
        worldBehavior,
        marginTop,
        marginBottom,
        gap,
        blockStyle: Object.keys(style).length > 0 ? style : undefined,
        zones: zoneDefs.map((zone, index) => ({
            id: zone.id,
            rect: zone.region
                ? {
                    x: Math.max(0, LayoutUtils.validateUnit(zone.region.x ?? 0)),
                    y: Math.max(0, LayoutUtils.validateUnit(zone.region.y ?? 0)),
                    width: Math.max(0, LayoutUtils.validateUnit(zone.region.width ?? 0)),
                    ...(zone.region.height !== undefined
                        ? { height: Math.max(0, LayoutUtils.validateUnit(zone.region.height)) }
                        : {})
                }
                : {
                    x: xOffsets[index] ?? 0,
                    y: 0,
                    width: columnWidths[index] ?? 0
                },
            elements: zone.elements ?? [],
            style: zone.style as ElementStyle | undefined
        }))
    };
}

export class ZonePackager extends HostedRegionPackager {
    constructor(
        element: Element,
        processor: LayoutProcessor,
        identity?: PackagerIdentity,
        zoneQueues?: HostedRegionActorQueue[] | null,
        fragmentMarginTop?: number,
        fragmentMarginBottom?: number,
        normalizeStrip?: (availableWidth: number) => NormalizedIndependentZoneStrip,
        resolveHostLayout?: (availableWidth: number) => ZoneHostLayout,
        buildInitialQueues?: (availableWidth: number) => HostedRegionActorQueue[],
        describeRegions?: (availableWidth: number) => readonly HostedRegionDescriptor[]
    ) {
        const zoneNormalizeStrip = normalizeStrip ?? ((availableWidth: number) => normalizeZoneMapElement(element, availableWidth));
        super(
            element,
            processor,
            identity ?? createElementPackagerIdentity(element, [0]),
            zoneQueues,
            fragmentMarginTop,
            fragmentMarginBottom,
            zoneNormalizeStrip,
            resolveHostLayout ?? ((availableWidth) => {
                const normalized = zoneNormalizeStrip(availableWidth);
                return {
                    sourceKind: normalized.sourceKind,
                    frameOverflow: normalized.frameOverflow,
                    worldBehavior: normalized.worldBehavior,
                    marginTop: normalized.marginTop,
                    marginBottom: normalized.marginBottom
                };
            }),
            buildInitialQueues,
            describeRegions ?? ((availableWidth) => zoneNormalizeStrip(availableWidth).zones)
        );
    }
}
