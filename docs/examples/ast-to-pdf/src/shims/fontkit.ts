export function create(_buffer: Uint8Array): never {
    throw new Error('[docs/examples/ast-to-pdf] fontkit is not available in this browser demo.');
}

const browserFontkitShim = { create };

export default browserFontkitShim;
