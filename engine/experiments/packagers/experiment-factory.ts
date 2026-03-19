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
} from './test-signal-packagers';
import { ExpandingProbePackager } from './expanding-probe-packager';

type ElementShaper = {
    shapeElement(element: Element, options: { path: number[] }): any;
    normalizeFlowBlock(element: Element, options: { path: number[] }): any;
    shapeNormalizedFlowBlock(block: any): any;
};

/**
 * The experiment packager factory. Register this with engine.setPackagerFactory()
 * before calling simulate() to activate the experiment proof packagers.
 *
 * Handles:
 *   - test-signal-publisher  (FIG. 5, 6, 8, 9, 10)
 *   - test-signal-observer   (FIG. 5, 6, 8, 9, 10)
 *   - test-replay-marker     (FIG. 10 — locked prelude precision proof)
 *   - expanding-probe-region (FIG. 4 — single-pass cyclic spatial dependency)
 */
export const experimentFactory: ExternalPackagerFactory = (
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

    if (item.type === 'expanding-probe-region') {
        const normalizedFlowBlock = shaper.normalizeFlowBlock(item, { path: [index] });
        const flowBox = shaper.shapeNormalizedFlowBlock(normalizedFlowBlock);
        return new ExpandingProbePackager(processor, flowBox, identity);
    }

    return null;
};
