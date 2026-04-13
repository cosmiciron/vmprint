import type { FontConfig, FontManager, TextDelegate, TextDelegateState } from '../contracts';

export interface EngineRuntime {
    textDelegate: TextDelegate;
    textDelegateState: TextDelegateState;
    fontCache: Record<string, unknown>;
    bufferCache: Record<string, ArrayBuffer>;
    loadingPromises: Record<string, Promise<unknown>>;
    measurementCache: Map<string, {
        width: number;
        glyphs: { char: string; x: number; y: number }[];
        shapedGlyphs?: import('./types').ShapedGlyph[];
        ascent: number;
        descent: number;
    }>;
    /**
     * VMPrint compatibility fields kept on the bootstrap side so existing
     * preview/CLI/tests can continue to speak font-manager language while the
     * copied core uses text delegates internally.
     */
    fontManager?: FontManager;
    fontRegistry?: FontConfig[];
}

export type EngineRuntimeOptions =
    {
        textDelegate: TextDelegate;
        /**
         * Optional bootstrap metadata carried by product-specific runtimes.
         * Shared engine code should continue to speak text delegates only.
         */
        fontManager?: FontManager;
        fontRegistry?: FontConfig[];
    };
