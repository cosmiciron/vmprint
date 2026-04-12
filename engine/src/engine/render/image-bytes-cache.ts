export class RendererImageBytesCache {
    private readonly cache = new Map<string, Uint8Array>();

    get(base64Data: string): Uint8Array {
        const cached = this.cache.get(base64Data);
        if (cached) return cached;
        const atobFn = (globalThis as { atob?: ((data: string) => string) }).atob;
        let bytes: Uint8Array;
        if (typeof atobFn === 'function') {
            const binaryString = atobFn(base64Data);
            bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
                bytes[i] = binaryString.charCodeAt(i);
            }
        } else {
            const bufferCtor = (globalThis as { Buffer?: { from(data: string, encoding: string): Uint8Array } }).Buffer;
            if (!bufferCtor?.from) {
                throw new Error('No base64 decoder is available in this runtime.');
            }
            bytes = new Uint8Array(bufferCtor.from(base64Data, 'base64'));
        }
        this.cache.set(base64Data, bytes);
        return bytes;
    }
}
