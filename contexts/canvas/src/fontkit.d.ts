declare module 'fontkit' {
    const fontkit: {
        create(buffer: Uint8Array | Buffer): any;
    };
    export = fontkit;
}
