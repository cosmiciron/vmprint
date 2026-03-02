import * as fontkit from 'fontkit';
import { EngineRuntime } from '../engine/runtime';

type LoadedFont = any;

export class FontLoadError extends Error {
    constructor(
        public readonly url: string,
        message: string,
        options?: { cause?: unknown },
    ) {
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

export const loadFont = async (url: string, runtime: EngineRuntime) => {
    const scopedRuntime = requireRuntime(runtime);
    const fontCache = scopedRuntime.fontCache;
    const bufferCache = scopedRuntime.bufferCache;
    const loadingPromises = scopedRuntime.loadingPromises;

    if (fontCache[url]) return fontCache[url];
    if (url in loadingPromises) return loadingPromises[url];

    loadingPromises[url] = (async () => {
        try {
            const arrayBuffer = await scopedRuntime.fontManager.loadFontBuffer(url);

            if (!arrayBuffer || arrayBuffer.byteLength === 0) {
                throw new FontLoadError(url, 'Loaded font buffer is empty.');
            }

            bufferCache[url] = arrayBuffer;
            const font: LoadedFont = fontkit.create(new Uint8Array(arrayBuffer));
            fontCache[url] = font;
            return font;
        } catch (e: unknown) {
            delete fontCache[url];
            delete bufferCache[url];
            delete loadingPromises[url];
            if (e instanceof FontLoadError) {
                throw e;
            }
            throw new FontLoadError(url, `Failed to load font "${url}".`, { cause: e });
        }
    })();

    return loadingPromises[url];
};

export const getCachedFont = (url: string, runtime: EngineRuntime) => requireRuntime(runtime).fontCache[url];
export const getCachedBuffer = (url: string, runtime: EngineRuntime) => requireRuntime(runtime).bufferCache[url];

export const registerFontBuffer = (url: string, buffer: ArrayBuffer, runtime: EngineRuntime) => {
    const scopedRuntime = requireRuntime(runtime);
    const bufferCache = scopedRuntime.bufferCache;
    const fontCache = scopedRuntime.fontCache;
    const loadingPromises = scopedRuntime.loadingPromises;

    bufferCache[url] = buffer;
    const font: any = fontkit.create(new Uint8Array(buffer));
    fontCache[url] = font;
    loadingPromises[url] = Promise.resolve(font);
};
