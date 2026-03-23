import type { BoxMeta, Element, ElementStyle, OverflowPolicy } from '../types';
import type { FlowIdentitySeed } from './layout-core-types';

export interface NormalizedFlowBlock {
    kind: 'flow-block';
    element: Element;
    sourceType: string;
    meta: BoxMeta;
    style: ElementStyle;
    marginTop: number;
    marginBottom: number;
    keepWithNext: boolean;
    pageBreakBefore: boolean;
    allowLineSplit: boolean;
    overflowPolicy: OverflowPolicy;
    orphans: number;
    widows: number;
    heightOverride?: number;
    identitySeed?: FlowIdentitySeed;
}
