import { cloneFontRegistry } from '../font-management/ops';
import type { EngineRuntime, EngineRuntimeOptions } from './runtime-types';

export type { EngineRuntime, EngineRuntimeOptions } from './runtime-types';

export const createEngineRuntime = (options: EngineRuntimeOptions): EngineRuntime => {
    const fontManager = options.fontManager;
    return {
        fontManager,
        fontRegistry: options.fontRegistry
            ? cloneFontRegistry(options.fontRegistry)
            : fontManager.getFontRegistrySnapshot(),
        measurementCache: new Map(),
        fontCache: {},
        bufferCache: {},
        loadingPromises: {},
    };
};

let defaultRuntime: EngineRuntime | null = null;

export const getDefaultEngineRuntime = (): EngineRuntime => {
    if (defaultRuntime) return defaultRuntime;
    throw new Error(
        'No default EngineRuntime is configured. Provide runtime explicitly or call setDefaultEngineRuntime(createEngineRuntime({ fontManager })).',
    );
};

export const setDefaultEngineRuntime = (runtime: EngineRuntime): void => {
    defaultRuntime = runtime;
};

export const resetDefaultEngineRuntime = (): void => {
    defaultRuntime = null;
};
