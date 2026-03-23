type BrowserFontkitModule = {
    create(buffer: Uint8Array): unknown;
};

const getBrowserFontkit = (): BrowserFontkitModule => {
    const globalRuntime = (globalThis as {
        VMPrintFontkit?: BrowserFontkitModule & { default?: BrowserFontkitModule };
    }).VMPrintFontkit;
    const runtime = globalRuntime && typeof globalRuntime.create === 'function'
        ? globalRuntime
        : globalRuntime?.default;
    if (!runtime || typeof runtime.create !== 'function') {
        throw new Error('[docs/examples] VMPrintFontkit runtime is missing. Load vmprint-fontkit.js before the engine/context bundles.');
    }
    return runtime;
};

export function create(buffer: Uint8Array): unknown {
    return getBrowserFontkit().create(buffer);
}

const browserFontkitShim = { create };

export default browserFontkitShim;
