import type { FontConfig, FontManager, TextDelegate, TextDelegateState } from '@vmprint/contracts';

export interface EngineRuntime {
    fontManager: FontManager;
    fontRegistry: FontConfig[];
    textDelegate?: TextDelegate;
    textDelegateState: TextDelegateState;
    measurementCache: Map<string, {
        width: number;
        glyphs: { char: string; x: number; y: number }[];
        shapedGlyphs?: import('./types').ShapedGlyph[];
        ascent: number;
        descent: number;
    }>;
}

export type EngineRuntimeOptions = {
    fontManager: FontManager;
    fontRegistry?: FontConfig[];
    textDelegate?: TextDelegate;
};
