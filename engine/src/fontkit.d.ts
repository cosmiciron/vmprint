declare module 'fontkit' {
    export function create(buffer: Uint8Array): any;
    export function openSync(path: string): any;
}

declare module 'bidi-js' {
    const defaultExport: () => any;
    export default defaultExport;
}
