import { EngineRuntime } from '../engine/runtime';
import type { VmprintTextDelegate } from './text-delegate';

type LoadedFont = any;

export class FontLoadError extends Error {
    constructor(public readonly url: string, message: string, options?: { cause?: unknown }) {
        super(message);
        this.name = 'FontLoadError';
        if (options?.cause !== undefined) {
            (this as Error & { cause?: unknown }).cause = options.cause;
        }
    }
}

const requireRuntime = (runtime: EngineRuntime): EngineRuntime => {
    if (!runtime) {
        throw new Error('EngineRuntime is required. Provide runtime explicitly.');
    }
    return runtime;
};

export const loadFont = async (url: string, runtime: EngineRuntime): Promise<LoadedFont> => {
    const scopedRuntime = requireRuntime(runtime);
    try {
        return await scopedRuntime.textDelegate.loadFace(url, scopedRuntime.textDelegateState);
    } catch (e: unknown) {
        if (e instanceof FontLoadError) {
            throw e;
        }
        throw new FontLoadError(url, `Failed to load font "${url}".`, { cause: e });
    }
};

export const getCachedFont = (url: string, runtime: EngineRuntime): LoadedFont =>
    requireRuntime(runtime).textDelegate.getCachedFace(url, requireRuntime(runtime).textDelegateState);

export const getCachedBuffer = (url: string, runtime: EngineRuntime): ArrayBuffer | undefined => {
    const scopedRuntime = requireRuntime(runtime);
    const cached = scopedRuntime.bufferCache[url];
    if (cached) return cached;
    const delegate = scopedRuntime.textDelegate as Partial<VmprintTextDelegate>;
    return typeof delegate.getCachedBuffer === 'function' ? delegate.getCachedBuffer(url) : undefined;
};

export const registerFontBuffer = (url: string, buffer: ArrayBuffer, runtime: EngineRuntime): void => {
    const scopedRuntime = requireRuntime(runtime);
    scopedRuntime.bufferCache[url] = buffer;
    delete scopedRuntime.textDelegateState.faceCache[url];
    delete scopedRuntime.loadingPromises[url];
};
