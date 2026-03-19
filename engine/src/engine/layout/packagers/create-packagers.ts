import { Element } from '../../types';
import { LayoutProcessor } from '../layout-core';
import { PackagerUnit } from './packager-types';
import { FlowBoxPackager } from './flow-box-packager';
import { DropCapPackager } from './dropcap-packager';
import { SpatialGridPackager } from './spatial-grid-packager';
import { StoryPackager } from './story-packager';
import { ZonePackager, isZoneMapElement } from './zone-packager';
import { TocPackager } from './toc-packager';
import { isTableElement } from '../layout-table';
import type { FlowBox } from '../layout-core-types';
import type { NormalizedFlowBlock } from '../normalized-flow-block';
import { createElementPackagerIdentity } from './packager-identity';

type ElementShaper = {
    shapeElement(element: Element, options: { path: number[] }): FlowBox;
    normalizeFlowBlock(element: Element, options: { path: number[] }): NormalizedFlowBlock;
    shapeNormalizedFlowBlock(block: NormalizedFlowBlock): FlowBox;
};

/**
 * An optional external packager factory. Return a PackagerUnit to claim the
 * element, or null to fall through to the built-in dispatch. Used by the
 * experiments harness to inject proof packagers without touching production code.
 */
export type ExternalPackagerFactory = (
    item: Element,
    index: number,
    processor: LayoutProcessor
) => PackagerUnit | null;

export function buildPackagerForElement(
    item: Element,
    index: number,
    processor: LayoutProcessor,
    externalFactory?: ExternalPackagerFactory
): PackagerUnit {
    if (externalFactory) {
        const result = externalFactory(item, index, processor);
        if (result !== null) return result;
    }
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
    if (item.type === 'toc') {
        return new TocPackager(processor, flowBox, identity);
    }
    const dropCap = item.properties?.dropCap;
    if (dropCap && dropCap.enabled) {
        return new DropCapPackager(processor, item, index, dropCap, identity);
    }
    return new FlowBoxPackager(processor, flowBox, identity);
}

export function createPackagers(
    elements: Element[],
    processor: LayoutProcessor,
    externalFactory?: ExternalPackagerFactory
): PackagerUnit[] {
    return elements.map((element, i) => buildPackagerForElement(element, i, processor, externalFactory));
}
