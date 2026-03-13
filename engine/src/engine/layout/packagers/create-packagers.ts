import { Element } from '../../types';
import { LayoutProcessor } from '../layout-core';
import { PackagerUnit } from './packager-types';
import { FlowBoxPackager } from './flow-box-packager';
import { DropCapPackager } from './dropcap-packager';
import { TablePackager } from './table-packager';
import { StoryPackager } from './story-packager';
import { ExpandingProbePackager } from './expanding-probe-packager';
import { isTableElement } from '../layout-table';
import { createElementPackagerIdentity } from './packager-identity';

export function buildPackagerForElement(item: Element, index: number, processor: LayoutProcessor): PackagerUnit {
    const identity = createElementPackagerIdentity(item, [index]);
    if (item.type === 'story') {
        return new StoryPackager(item, processor, index, undefined, undefined, identity);
    }
    const flowBox = (processor as any).shapeElement(item, { path: [index] });
    if (item.type === 'expanding-probe-region') {
        return new ExpandingProbePackager(processor, flowBox, identity);
    }
    if (isTableElement(item)) {
        return new TablePackager(processor, flowBox, identity);
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
