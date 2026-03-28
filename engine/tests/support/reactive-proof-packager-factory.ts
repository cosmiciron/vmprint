import type { Element } from '../../src/engine/types';
import type { LayoutProcessor } from '../../src/engine/layout/layout-core';
import type { PackagerUnit } from '../../src/engine/layout/packagers/packager-types';
import type { ExternalPackagerFactory } from '../../src/engine/layout/packagers/create-packagers';
import { createElementPackagerIdentity } from '../../src/engine/layout/packagers/packager-identity';
import {
    TestClockCookingPackager,
    TestSignalPublisherPackager,
    TestSignalObserverPackager,
    TestSignalFollowerPackager,
    TestReplayMarkerPackager
} from './reactive-proof-packagers';

type ElementShaper = {
    shapeElement(element: Element, options: { path: number[] }): any;
    normalizeFlowBlock(element: Element, options: { path: number[] }): any;
    shapeNormalizedFlowBlock(block: any): any;
};

/**
 * Regression-only packager factory for filing-era reactive proof actors.
 * Register this with engine.setPackagerFactory() before simulate() when a
 * regression needs to exercise actor signaling, replay, or tick cooking.
 */
export const reactiveProofPackagerFactory: ExternalPackagerFactory = (
    item: Element,
    index: number,
    processor: LayoutProcessor
): PackagerUnit | null => {
    const shaper = processor as unknown as ElementShaper;
    const identity = createElementPackagerIdentity(item, [index]);

    if (item.type === 'test-signal-publisher' || item.properties?._actorSignalPublish) {
        const normalizedFlowBlock = shaper.normalizeFlowBlock(item, { path: [index] });
        const flowBox = shaper.shapeNormalizedFlowBlock(normalizedFlowBlock);
        return new TestSignalPublisherPackager(processor, flowBox, identity);
    }

    if (item.type === 'test-signal-follower') {
        const normalizedFlowBlock = shaper.normalizeFlowBlock(item, { path: [index] });
        const flowBox = shaper.shapeNormalizedFlowBlock(normalizedFlowBlock);
        return new TestSignalFollowerPackager(processor, flowBox, identity);
    }

    if (item.type === 'test-signal-observer') {
        const normalizedFlowBlock = shaper.normalizeFlowBlock(item, { path: [index] });
        const flowBox = shaper.shapeNormalizedFlowBlock(normalizedFlowBlock);
        return new TestSignalObserverPackager(processor, flowBox, identity);
    }

    if (item.type === 'test-clock-cooking') {
        const normalizedFlowBlock = shaper.normalizeFlowBlock(item, { path: [index] });
        const flowBox = shaper.shapeNormalizedFlowBlock(normalizedFlowBlock);
        return new TestClockCookingPackager(processor, flowBox, identity);
    }

    if (item.type === 'test-replay-marker') {
        const normalizedFlowBlock = shaper.normalizeFlowBlock(item, { path: [index] });
        const flowBox = shaper.shapeNormalizedFlowBlock(normalizedFlowBlock);
        return new TestReplayMarkerPackager(processor, flowBox, identity);
    }

    return null;
};

