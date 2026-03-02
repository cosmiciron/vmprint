import { LayoutConfig, Element, ElementStyle } from '../types';
import { LayoutUtils } from '../layout/layout-utils';
import { EngineRuntime, getDefaultEngineRuntime } from '../runtime';

/**
 * BaseLayout provides shared config and style resolution for the flat pipeline.
 */
export class BaseLayout {
    protected runtime: EngineRuntime;

    constructor(
        protected config: LayoutConfig,
        runtime?: EngineRuntime,
    ) {
        this.runtime = runtime || getDefaultEngineRuntime();
    }

    protected logWarn(message: string, error?: unknown): void {
        if (error !== undefined) {
            console.warn(message, error);
            return;
        }
        console.warn(message);
    }

    protected logError(message: string, error?: unknown): void {
        if (error !== undefined) {
            console.error(message, error);
            return;
        }
        console.error(message);
    }

    protected getStyle(element: Element): ElementStyle {
        const typeKey = element.type;

        const rawStyle = this.config.styles[typeKey] || {};
        return {
            ...rawStyle,
            ...(element.properties?.style || {}),
        } as ElementStyle;
    }

    protected getPageDimensions(): { width: number; height: number } {
        return LayoutUtils.getPageDimensions(this.config);
    }

    getRuntime(): EngineRuntime {
        return this.runtime;
    }
}
