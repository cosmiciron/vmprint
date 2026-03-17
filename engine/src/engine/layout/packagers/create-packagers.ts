import { Element } from '../../types';
import { LayoutProcessor } from '../layout-core';
import { PackagerUnit } from './packager-types';
import { FlowBoxPackager } from './flow-box-packager';
import { DropCapPackager } from './dropcap-packager';
import { SpatialGridPackager } from './spatial-grid-packager';
import { StoryPackager } from './story-packager';
import { ExpandingProbePackager } from './expanding-probe-packager';
import { ZonePackager, isZoneMapElement } from './zone-packager';
import { isTableElement } from '../layout-table';
import type { FlowBox } from '../layout-core-types';
import type { NormalizedFlowBlock } from '../normalized-flow-block';
import { createElementPackagerIdentity } from './packager-identity';

type ElementShaper = {
    shapeElement(element: Element, options: { path: number[] }): FlowBox;
    normalizeFlowBlock(element: Element, options: { path: number[] }): NormalizedFlowBlock;
    shapeNormalizedFlowBlock(block: NormalizedFlowBlock): FlowBox;
};

export function buildPackagerForElement(item: Element, index: number, processor: LayoutProcessor): PackagerUnit {
    const identity = createElementPackagerIdentity(item, [index]);
    if (item.type === 'story') {
        return new StoryPackager(item, processor, index, undefined, undefined, identity);
    }
    if (isZoneMapElement(item)) {
        return new ZonePackager(item, processor, identity);
    }
    const shaper = processor as unknown as ElementShaper;
    if (isTableElement(item)) {
        const flowBox = shaper.shapeElement(item, { path: [index] });
        return new SpatialGridPackager(processor, flowBox, identity);
    }
    const normalizedFlowBlock = shaper.normalizeFlowBlock(item, { path: [index] });
    const flowBox = shaper.shapeNormalizedFlowBlock(normalizedFlowBlock);
    if (item.type === 'expanding-probe-region') {
        return new ExpandingProbePackager(processor, flowBox, identity);
    }
    const dropCap = item.properties?.dropCap;
    if (dropCap && dropCap.enabled) {
        return new DropCapPackager(processor, item, index, dropCap, identity);
    }
    return new FlowBoxPackager(processor, flowBox, identity);
}

export function createPackagers(elements: Element[], processor: LayoutProcessor): PackagerUnit[] {
    return elements.map((element, i) => buildPackagerForElement(element, i, processor));
}
