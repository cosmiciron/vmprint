import { LayoutConfig } from './types';
import { LayoutProcessor } from './layout/layout-core';
import { EngineRuntime } from './runtime';

/**
 * LayoutEngine shapes elements into flow boxes, paginates them, and returns
 * positioned page boxes for rendering.
 */
export class LayoutEngine extends LayoutProcessor {
    constructor(config: LayoutConfig, runtime?: EngineRuntime) {
        super(config, runtime);
    }
}
