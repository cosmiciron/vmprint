import type { FontConfig, FontManager, TextDelegate } from '../contracts';
import { createEngineRuntime, type EngineRuntime } from '../engine/runtime';
import { createFontManagerTextDelegate } from './text-delegate';
import { cloneFontRegistry } from './ops';

export type PrintEngineRuntimeOptions = {
    fontManager: FontManager;
    fontRegistry?: FontConfig[];
    textDelegate?: TextDelegate;
};

export const createPrintEngineRuntime = (options: PrintEngineRuntimeOptions): EngineRuntime => {
    const bufferCache: Record<string, ArrayBuffer> = {};
    const textDelegate = options.textDelegate || createFontManagerTextDelegate(options.fontManager, {
        fontRegistry: options.fontRegistry,
        bufferCacheMirror: bufferCache
    });
    const runtime = createEngineRuntime({
        textDelegate,
        fontManager: options.fontManager,
        fontRegistry: options.fontRegistry
            ? cloneFontRegistry(options.fontRegistry)
            : textDelegate.getFontRegistrySnapshot()
    });

    runtime.bufferCache = bufferCache;
    return runtime;
};
