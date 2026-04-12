import type { EngineRuntime, EngineRuntimeOptions } from './runtime-types';

export type { EngineRuntime, EngineRuntimeOptions } from './runtime-types';

export const createEngineRuntime = (options: EngineRuntimeOptions): EngineRuntime => {
    const textDelegateState = {
        faceCache: {},
        loadingPromises: {}
    };
    const bufferCache: Record<string, ArrayBuffer> = {};

    return {
        textDelegate: options.textDelegate,
        textDelegateState,
        fontCache: textDelegateState.faceCache,
        bufferCache,
        loadingPromises: textDelegateState.loadingPromises,
        measurementCache: new Map(),
        ...(options.fontManager ? { fontManager: options.fontManager } : {}),
        ...(options.fontRegistry ? { fontRegistry: options.fontRegistry } : {})
    };
};

let defaultRuntime: EngineRuntime | null = null;

export const getDefaultEngineRuntime = (): EngineRuntime => {
    if (defaultRuntime) return defaultRuntime;
    throw new Error(
        'No default EngineRuntime is configured. Provide runtime explicitly or call setDefaultEngineRuntime(createEngineRuntime({ textDelegate })).'
    );
};

export const setDefaultEngineRuntime = (runtime: EngineRuntime): void => {
    defaultRuntime = runtime;
};

export const resetDefaultEngineRuntime = (): void => {
    defaultRuntime = null;
};
