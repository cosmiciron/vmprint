type Html2Canvas = (..._args: unknown[]) => Promise<never>;

const html2canvasShim: Html2Canvas = async () => {
    throw new Error('[docs/examples/ast-to-pdf] html2canvas is disabled in this build.');
};

export default html2canvasShim;
