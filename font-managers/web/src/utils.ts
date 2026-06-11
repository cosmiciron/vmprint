import { FontConfig, FallbackFontSource } from '@vmprint/contracts';
import { WebFontCacheOptions, WebFontCacheConfig } from './types.js';

export const normalizeFamilyKey = (family: string): string => String(family || '')
    .trim()
    .toLowerCase()
    .replace(/["']/g, '')
    .replace(/\s+/g, ' ');

export const cloneFontConfig = (font: FontConfig): FontConfig => ({ ...font });
export const cloneFontRegistry = (fonts: FontConfig[]): FontConfig[] => fonts.map(cloneFontConfig);

export const copyArrayBuffer = (buffer: ArrayBuffer): ArrayBuffer => buffer.slice(0);

export const toArrayBuffer = (value: ArrayBuffer | ArrayBufferView): ArrayBuffer => {
    if (value instanceof ArrayBuffer) {
        return copyArrayBuffer(value);
    }

    const view = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    const copy = new Uint8Array(view.byteLength);
    copy.set(view);
    return copy.buffer;
};

export const isDataUri = (src: string): boolean => /^data:/i.test(src);
export const isRemoteUrl = (src: string): boolean => /^https?:\/\//i.test(src);
export const isAbsoluteUrl = (src: string): boolean => /^[a-z][a-z0-9+\-.]*:/i.test(src);

export const mergeAliases = (base: Record<string, string>, extra?: Record<string, string>): Record<string, string> => ({
    ...base,
    ...(extra || {})
});

export const normalizeCacheOptions = (cache: boolean | WebFontCacheOptions | undefined, repositoryBaseUrl?: string): WebFontCacheConfig => {
    if (!cache) {
        return {
            persistent: false,
            dbName: 'vmprint-web-font-cache',
            storeName: 'fonts',
            namespace: repositoryBaseUrl || 'default'
        };
    }
    if (cache === true) {
        return {
            persistent: true,
            dbName: 'vmprint-web-font-cache',
            storeName: 'fonts',
            namespace: repositoryBaseUrl || 'default'
        };
    }
    return {
        persistent: cache.persistent === true,
        dbName: cache.dbName || 'vmprint-web-font-cache',
        storeName: cache.storeName || 'fonts',
        namespace: cache.namespace || repositoryBaseUrl || 'default'
    };
};

export const decodeDataUri = (src: string): ArrayBuffer => {
    const commaIndex = src.indexOf(',');
    if (commaIndex < 0) {
        throw new Error('[WebFontManager] Invalid data URI: missing comma separator.');
    }

    const header = src.slice(0, commaIndex);
    const payload = src.slice(commaIndex + 1);
    const isBase64 = /;base64/i.test(header);

    if (isBase64) {
        if (typeof Buffer !== 'undefined') {
            const bytes = Buffer.from(payload, 'base64');
            const view = new Uint8Array(bytes);
            const copy = new Uint8Array(view.byteLength);
            copy.set(view);
            return copy.buffer;
        }
        if (typeof atob === 'function') {
            const binary = atob(payload);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) {
                bytes[i] = binary.charCodeAt(i);
            }
            return bytes.buffer;
        }
        throw new Error('[WebFontManager] No base64 decoder is available in this runtime.');
    }

    const decoded = decodeURIComponent(payload);
    const bytes = new TextEncoder().encode(decoded);
    return bytes.buffer;
};

export const combineRequestInit = (base: RequestInit | undefined, signal: AbortSignal | undefined): RequestInit | undefined => {
    if (!base && !signal) return undefined;
    return {
        ...(base || {}),
        ...(signal ? { signal } : {})
    };
};

export const resolveAgainstBase = (src: string, repositoryBaseUrl?: string): string => {
    if (!src) return src;
    if (isAbsoluteUrl(src) || !repositoryBaseUrl) return src;

    try {
        return new URL(src, repositoryBaseUrl).toString();
    } catch {
        return src;
    }
};

export const buildCacheKey = (namespace: string, src: string): string => `${namespace}::${src}`;

export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export const isAbortLikeError = (error: unknown): boolean => {
    if (!error) return false;
    if (typeof DOMException !== 'undefined' && error instanceof DOMException) {
        return error.name === 'AbortError';
    }
    const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    return /AbortError|aborted/i.test(message);
};
