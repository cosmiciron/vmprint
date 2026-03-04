import { Element } from '../../types';
import { LayoutProcessor } from '../layout-core';
import { PackagerUnit } from './packager-types';
import { FlowBoxPackager } from './flow-box-packager';
import { DropCapPackager } from './dropcap-packager';
import { TablePackager } from './table-packager';
import { StoryPackager } from './story-packager';
import { isTableElement } from '../layout-table';

export function buildPackagerForElement(item: Element, index: number, processor: LayoutProcessor): PackagerUnit {
    if (item.type === 'story') {
        return new StoryPackager(item, processor, index);
    }
    const flowBox = (processor as any).shapeElement(item, { path: [index] });
    if (isTableElement(item)) {
        return new TablePackager(processor, flowBox);
    }
    const dropCap = item.properties?.dropCap;
    if (dropCap && dropCap.enabled) {
        return new DropCapPackager(processor, item, index, dropCap);
    }
    return new FlowBoxPackager(processor, flowBox);
}

export function createPackagers(elements: Element[], processor: LayoutProcessor): PackagerUnit[] {
    return elements.map((element, i) => buildPackagerForElement(element, i, processor));
}
