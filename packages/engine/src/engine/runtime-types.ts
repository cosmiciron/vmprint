import type { FontConfig, FontManager } from '@vmprint/contracts';

export interface EngineRuntime {
    fontManager: FontManager;
    fontRegistry: FontConfig[];
    measurementCache: Map<
        string,
        {
            width: number;
            glyphs: { char: string; x: number; y: number }[];
            ascent: number;
            descent: number;
        }
    >;
    fontCache: Record<string, unknown>;
    bufferCache: Record<string, ArrayBuffer>;
    loadingPromises: Record<string, Promise<unknown>>;
}

export type EngineRuntimeOptions = {
    fontManager: FontManager;
    fontRegistry?: FontConfig[];
};
