type CanvgLike = {
    fromString: (..._args: unknown[]) => Promise<{ render: () => Promise<never> }>;
};

const canvgShim: CanvgLike = {
    async fromString() {
        throw new Error('[docs/examples/ast-to-pdf] canvg is disabled in this build.');
    }
};

export default canvgShim;
