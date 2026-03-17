import type { Element, ElementStyle } from '../types';

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
    marginTop: number;
    marginBottom: number;
    gap: number;
    blockStyle?: ElementStyle;
    zones: NormalizedIndependentZone[];
}
