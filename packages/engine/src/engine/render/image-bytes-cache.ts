export class RendererImageBytesCache {
    private readonly cache = new Map<string, Uint8Array>();

    get(base64Data: string): Uint8Array {
        const cached = this.cache.get(base64Data);
        if (cached) return cached;
        const binaryString = atob(base64Data);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        this.cache.set(base64Data, bytes);
        return bytes;
    }
}
