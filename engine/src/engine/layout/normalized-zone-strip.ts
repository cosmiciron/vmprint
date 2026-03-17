import type { Element, ElementStyle, ZoneFrameOverflow, ZoneWorldBehavior } from '../types';

export interface NormalizedIndependentZone {
    id?: string;
    x: number;
    width: number;
    elements: Element[];
    style?: ElementStyle;
}

export interface NormalizedIndependentZoneStrip {
    kind: 'zone-strip';
    overflow: 'independent';
    sourceKind: 'zone-map';
    frameOverflow: ZoneFrameOverflow;
    worldBehavior: ZoneWorldBehavior;
    marginTop: number;
    marginBottom: number;
    gap: number;
    blockStyle?: ElementStyle;
    zones: NormalizedIndependentZone[];
}
