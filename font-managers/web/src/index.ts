import { FontConfig, FallbackFontSource, FontManager } from '@vmprint/contracts';

const normalizeFamilyKey = (family: string): string => String(family || '')
    .trim()
    .toLowerCase()
    .replace(/["']/g, '')
    .replace(/\s+/g, ' ');

const cloneFontConfig = (font: FontConfig): FontConfig => ({ ...font });
const cloneFontRegistry = (fonts: FontConfig[]): FontConfig[] => fonts.map(cloneFontConfig);

const copyArrayBuffer = (buffer: ArrayBuffer): ArrayBuffer => buffer.slice(0);

const toArrayBuffer = (value: ArrayBuffer | ArrayBufferView): ArrayBuffer => {
    if (value instanceof ArrayBuffer) {
        return copyArrayBuffer(value);
    }

    const view = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    const copy = new Uint8Array(view.byteLength);
    copy.set(view);
    return copy.buffer;
};

const isDataUri = (src: string): boolean => /^data:/i.test(src);
const isRemoteUrl = (src: string): boolean => /^https?:\/\//i.test(src);
const isAbsoluteUrl = (src: string): boolean => /^[a-z][a-z0-9+\-.]*:/i.test(src);

const mergeAliases = (base: Record<string, string>, extra?: Record<string, string>): Record<string, string> => ({
    ...base,
    ...(extra || {})
});

const DEFAULT_FETCH_TIMEOUT_MS = 30_000;
const DEFAULT_RETRY_COUNT = 2;

export const WEB_FONT_ALIASES: Record<string, string> = {
    'times': 'Tinos',
    'times new roman': 'Tinos',
    'timesnewroman': 'Tinos',
    'times-roman': 'Tinos',
    'courier': 'Cousine',
    'courier new': 'Cousine',
    'couriernew': 'Cousine',
    'arial': 'Arimo',
    'helvetica': 'Arimo',
    'helvetica neue': 'Arimo',
    'helveticaneue': 'Arimo',
    'calibri': 'Carlito',
    'cambria': 'Caladea',
    'segoe ui': 'Carlito',
    'sans-serif': 'Noto Sans',
    'sans serif': 'Noto Sans',
    'serif': 'Tinos',
    'monospace': 'Cousine',
    'symbol': 'Noto Sans Symbols 2',
    'zapfdingbats': 'Noto Sans Symbols 2',
    'zapf dingbats': 'Noto Sans Symbols 2'
};

export interface WebFontCatalog {
    fonts: FontConfig[];
    aliases?: Record<string, string>;
    repositoryBaseUrl?: string;
}

export interface WebFontCacheOptions {
    persistent?: boolean;
    dbName?: string;
    storeName?: string;
    namespace?: string;
}

export interface WebFontManagerOptions {
    fonts?: FontConfig[];
    aliases?: Record<string, string>;
    repositoryBaseUrl?: string;
    cache?: boolean | WebFontCacheOptions;
    fetch?: typeof fetch;
    requestInit?: RequestInit;
    fetchTimeoutMs?: number;
    maxConcurrentDownloads?: number;
    onProgress?: (event: WebFontProgressEvent) => void;
}

export interface WebFontCatalogLoadOptions extends Omit<WebFontManagerOptions, 'fonts' | 'aliases'> {
    aliases?: Record<string, string>;
}

export interface WebFontProgressEvent {
    src: string;
    resolvedSrc: string;
    loadedBytes: number;
    totalBytes?: number;
    percent?: number;
    phase: 'cache-hit' | 'downloading' | 'finalizing' | 'caching' | 'complete';
}

interface PersistentArrayBufferStore {
    get(key: string): Promise<ArrayBuffer | null>;
    set(key: string, value: ArrayBuffer): Promise<void>;
}

type WebFontCacheConfig = Required<WebFontCacheOptions>;

const normalizeCacheOptions = (cache: boolean | WebFontCacheOptions | undefined, repositoryBaseUrl?: string): WebFontCacheConfig => {
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

const decodeDataUri = (src: string): ArrayBuffer => {
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

const combineRequestInit = (base: RequestInit | undefined, signal: AbortSignal | undefined): RequestInit | undefined => {
    if (!base && !signal) return undefined;
    return {
        ...(base || {}),
        ...(signal ? { signal } : {})
    };
};

const resolveAgainstBase = (src: string, repositoryBaseUrl?: string): string => {
    if (!src) return src;
    if (isAbsoluteUrl(src) || !repositoryBaseUrl) return src;

    try {
        return new URL(src, repositoryBaseUrl).toString();
    } catch {
        return src;
    }
};

const buildCacheKey = (namespace: string, src: string): string => `${namespace}::${src}`;

class IndexedDbArrayBufferStore {
    constructor(
        private readonly dbName: string,
        private readonly storeName: string
    ) { }

    async get(key: string): Promise<ArrayBuffer | null> {
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(this.storeName, 'readonly');
            const store = tx.objectStore(this.storeName);
            const request = store.get(key);

            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                const result = request.result;
                if (result instanceof ArrayBuffer) {
                    resolve(copyArrayBuffer(result));
                    return;
                }
                if (ArrayBuffer.isView(result)) {
                    resolve(toArrayBuffer(result));
                    return;
                }
                resolve(null);
            };
        });
    }

    async set(key: string, value: ArrayBuffer): Promise<void> {
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(this.storeName, 'readwrite');
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
            tx.objectStore(this.storeName).put(copyArrayBuffer(value), key);
        });
    }

    private async open(): Promise<IDBDatabase> {
        if (typeof indexedDB === 'undefined') {
            throw new Error('[WebFontManager] IndexedDB is not available in this runtime.');
        }

        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, 1);
            request.onerror = () => reject(request.error);
            request.onupgradeneeded = () => {
                const db = request.result;
                if (!db.objectStoreNames.contains(this.storeName)) {
                    db.createObjectStore(this.storeName);
                }
            };
            request.onsuccess = () => resolve(request.result);
        });
    }
}

class CacheStorageArrayBufferStore implements PersistentArrayBufferStore {
    constructor(
        private readonly cacheName: string,
        private readonly namespace: string
    ) { }

    async get(key: string): Promise<ArrayBuffer | null> {
        if (typeof caches === 'undefined') {
            throw new Error('[WebFontManager] Cache Storage is not available in this runtime.');
        }

        const cache = await caches.open(this.cacheName);
        const response = await cache.match(this.toRequest(key));
        if (!response) return null;
        return await response.arrayBuffer();
    }

    async set(key: string, value: ArrayBuffer): Promise<void> {
        if (typeof caches === 'undefined') {
            throw new Error('[WebFontManager] Cache Storage is not available in this runtime.');
        }

        const cache = await caches.open(this.cacheName);
        await cache.put(
            this.toRequest(key),
            new Response(copyArrayBuffer(value), {
                headers: {
                    'content-type': 'application/octet-stream'
                }
            })
        );
    }

    private toRequest(key: string): Request {
        const safeNamespace = encodeURIComponent(this.namespace);
        const safeKey = encodeURIComponent(key);
        return new Request(`https://vmprint.invalid/__font-cache__/${safeNamespace}/${safeKey}`);
    }
}

class DownloadLimiter {
    private activeCount = 0;
    private readonly queue: Array<() => void> = [];

    constructor(private readonly maxConcurrent: number) { }

    async run<T>(task: () => Promise<T>): Promise<T> {
        if (this.maxConcurrent > 0 && this.activeCount >= this.maxConcurrent) {
            await new Promise<void>((resolve) => {
                this.queue.push(resolve);
            });
        }

        this.activeCount += 1;
        try {
            return await task();
        } finally {
            this.activeCount -= 1;
            const next = this.queue.shift();
            if (next) next();
        }
    }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const isAbortLikeError = (error: unknown): boolean => {
    if (!error) return false;
    if (typeof DOMException !== 'undefined' && error instanceof DOMException) {
        return error.name === 'AbortError';
    }
    const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    return /AbortError|aborted/i.test(message);
};

export class WebFontManager implements FontManager {
    private readonly seedFonts: FontConfig[];
    private readonly familyAliases: Record<string, string>;
    private readonly repositoryBaseUrl?: string;
    private readonly fetchImpl?: typeof fetch;
    private readonly requestInit?: RequestInit;
    private readonly fetchTimeoutMs: number;
    private readonly downloadLimiter: DownloadLimiter;
    private readonly onProgress?: (event: WebFontProgressEvent) => void;
    private readonly memoryCache = new Map<string, ArrayBuffer>();
    private readonly inFlightLoads = new Map<string, Promise<ArrayBuffer>>();
    private readonly cacheOptions: WebFontCacheConfig;
    private readonly persistentCache: PersistentArrayBufferStore | null;

    constructor(options: WebFontManagerOptions = {}) {
        this.seedFonts = cloneFontRegistry(options.fonts || []);
        this.familyAliases = mergeAliases(WEB_FONT_ALIASES, options.aliases);
        this.repositoryBaseUrl = options.repositoryBaseUrl;
        this.fetchImpl = options.fetch;
        this.requestInit = options.requestInit;
        this.fetchTimeoutMs = Math.max(0, Number(options.fetchTimeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS));
        this.downloadLimiter = new DownloadLimiter(Math.max(1, Number(options.maxConcurrentDownloads || 4)));
        this.onProgress = options.onProgress;
        this.cacheOptions = normalizeCacheOptions(options.cache, this.repositoryBaseUrl);
        this.persistentCache = this.createPersistentCache();
    }

    static async fromCatalogUrl(url: string, options: WebFontCatalogLoadOptions = {}): Promise<WebFontManager> {
        const fetchImpl = options.fetch ?? globalThis.fetch;
        if (typeof fetchImpl !== 'function') {
            throw new Error('[WebFontManager] fetch() is not available. Provide options.fetch when loading a catalog.');
        }

        const response = await fetchImpl(url, options.requestInit);
        if (!response.ok) {
            throw new Error(`[WebFontManager] Failed to load font catalog "${url}". Status: ${response.status}.`);
        }

        const catalog = await response.json() as WebFontCatalog;
        if (!catalog || !Array.isArray(catalog.fonts)) {
            throw new Error(`[WebFontManager] Invalid font catalog "${url}". Expected a JSON object with a "fonts" array.`);
        }

        const derivedBaseUrl = catalog.repositoryBaseUrl || (() => {
            try {
                return new URL('./', url).toString();
            } catch {
                return undefined;
            }
        })();

        return new WebFontManager({
            ...options,
            fonts: catalog.fonts,
            aliases: mergeAliases(catalog.aliases || {}, options.aliases),
            repositoryBaseUrl: options.repositoryBaseUrl || derivedBaseUrl
        });
    }

    getFontRegistrySnapshot(): FontConfig[] {
        return cloneFontRegistry(this.seedFonts);
    }

    resolveFamilyAlias(family: string): string {
        const key = normalizeFamilyKey(family);
        if (!key) return family;
        return this.familyAliases[key] || family;
    }

    getAllFonts(registry: FontConfig[]): FontConfig[] {
        return registry.filter((font) => font.enabled);
    }

    getEnabledFallbackFonts(registry: FontConfig[]): FallbackFontSource[] {
        return registry
            .filter((font) => font.fallback && font.enabled)
            .map((font) => ({
                src: font.src,
                name: font.name,
                unicodeRange: font.unicodeRange
            }));
    }

    getFontsByFamily(family: string, registry: FontConfig[]): FontConfig[] {
        const resolvedFamily = this.resolveFamilyAlias(family);
        return registry.filter((font) => font.family === resolvedFamily && font.enabled);
    }

    getFallbackFamilies(registry: FontConfig[]): string[] {
        return Array.from(new Set(
            registry
                .filter((font) => font.fallback && font.enabled)
                .map((font) => font.family)
        ));
    }

    registerFont(config: FontConfig, registry: FontConfig[]): void {
        registry.push(config);
    }

    async loadFontBuffer(src: string): Promise<ArrayBuffer> {
        const resolvedSrc = resolveAgainstBase(src, this.repositoryBaseUrl);
        const memoryHit = this.memoryCache.get(resolvedSrc);
        if (memoryHit) {
            this.emitProgress({
                src,
                resolvedSrc,
                loadedBytes: memoryHit.byteLength,
                totalBytes: memoryHit.byteLength,
                percent: 100,
                phase: 'cache-hit'
            });
            return copyArrayBuffer(memoryHit);
        }

        const inflight = this.inFlightLoads.get(resolvedSrc);
        if (inflight) {
            const buffer = await inflight;
            return copyArrayBuffer(buffer);
        }

        const loadPromise = this.loadFontBufferInternal(src, resolvedSrc);
        this.inFlightLoads.set(resolvedSrc, loadPromise);

        try {
            const buffer = await loadPromise;
            this.memoryCache.set(resolvedSrc, copyArrayBuffer(buffer));
            return copyArrayBuffer(buffer);
        } finally {
            this.inFlightLoads.delete(resolvedSrc);
        }
    }

    private async loadFontBufferInternal(src: string, resolvedSrc: string): Promise<ArrayBuffer> {
        if (isDataUri(resolvedSrc)) {
            return decodeDataUri(resolvedSrc);
        }

        const cacheKey = buildCacheKey(this.cacheOptions.namespace, resolvedSrc);
        if (this.persistentCache) {
            try {
                const cached = await this.persistentCache.get(cacheKey);
                if (cached) {
                    this.emitProgress({
                        src,
                        resolvedSrc,
                        loadedBytes: cached.byteLength,
                        totalBytes: cached.byteLength,
                        percent: 100,
                        phase: 'cache-hit'
                    });
                    return cached;
                }
            } catch (error) {
                console.warn(`[WebFontManager] Persistent cache read failed for "${resolvedSrc}".`, error);
            }
        }

        const fetchImpl = this.fetchImpl ?? globalThis.fetch;
        if (typeof fetchImpl !== 'function') {
            throw new Error(
                `[WebFontManager] Cannot load font "${src}". fetch() is unavailable and the source is not a data URI.`
            );
        }

        try {
            let completedTotalBytes: number | undefined;
            let lastError: unknown = null;
            let buffer: ArrayBuffer | null = null;

            for (let attempt = 0; attempt <= DEFAULT_RETRY_COUNT; attempt++) {
                try {
                    buffer = await this.downloadLimiter.run(async () => {
                        const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
                        let timer: ReturnType<typeof setTimeout> | null = null;
                        const resetTimeout = () => {
                            if (!controller || this.fetchTimeoutMs <= 0) return;
                            if (timer) clearTimeout(timer);
                            timer = setTimeout(() => controller.abort(), this.fetchTimeoutMs);
                        };

                        try {
                            resetTimeout();
                            const response = await fetchImpl(
                                resolvedSrc,
                                combineRequestInit(this.requestInit, controller?.signal)
                            );
                            resetTimeout();
                            if (!response.ok) {
                                throw new Error(`HTTP ${response.status}`);
                            }
                            const totalBytesHeader = response.headers.get('content-length');
                            const totalBytes = totalBytesHeader ? Number.parseInt(totalBytesHeader, 10) : undefined;
                            completedTotalBytes = totalBytes;
                            const reader = response.body?.getReader();

                            if (reader) {
                                const chunks: Uint8Array[] = [];
                                let loadedBytes = 0;
                                this.emitProgress({ src, resolvedSrc, loadedBytes: 0, totalBytes, percent: 0, phase: 'downloading' });

                                while (true) {
                                    const { done, value } = await reader.read();
                                    resetTimeout();
                                    if (done) break;
                                    if (!value) continue;
                                    chunks.push(value);
                                    loadedBytes += value.byteLength;
                                    this.emitProgress({
                                        src,
                                        resolvedSrc,
                                        loadedBytes,
                                        totalBytes,
                                        percent: totalBytes && totalBytes > 0 ? Math.min(100, (loadedBytes / totalBytes) * 100) : undefined,
                                        phase: 'downloading'
                                    });
                                }

                                this.emitProgress({
                                    src,
                                    resolvedSrc,
                                    loadedBytes,
                                    totalBytes,
                                    percent: 100,
                                    phase: 'finalizing'
                                });
                                const merged = new Uint8Array(loadedBytes);
                                let offset = 0;
                                for (const chunk of chunks) {
                                    merged.set(chunk, offset);
                                    offset += chunk.byteLength;
                                }
                                return merged.buffer;
                            }

                            const responseBuffer = await response.arrayBuffer();
                            resetTimeout();
                            return responseBuffer;
                        } finally {
                            if (timer) clearTimeout(timer);
                        }
                    });
                    break;
                } catch (error) {
                    lastError = error;
                    if (attempt >= DEFAULT_RETRY_COUNT || !isAbortLikeError(error)) {
                        throw error;
                    }
                    await sleep(250 * (attempt + 1));
                }
            }

            if (!buffer || buffer.byteLength === 0) {
                throw lastError instanceof Error ? lastError : new Error('empty response body');
            }

            if (this.persistentCache) {
                try {
                    this.emitProgress({
                        src,
                        resolvedSrc,
                        loadedBytes: buffer.byteLength,
                        totalBytes: completedTotalBytes && completedTotalBytes > 0 ? completedTotalBytes : buffer.byteLength,
                        percent: 100,
                        phase: 'caching'
                    });
                    await this.persistentCache.set(cacheKey, buffer);
                } catch (error) {
                    console.warn(`[WebFontManager] Persistent cache write failed for "${resolvedSrc}".`, error);
                }
            }

            this.emitProgress({
                src,
                resolvedSrc,
                loadedBytes: buffer.byteLength,
                totalBytes: completedTotalBytes && completedTotalBytes > 0 ? completedTotalBytes : buffer.byteLength,
                percent: 100,
                phase: 'complete'
            });
            return buffer;
        } catch (error) {
            const renderedSource = isRemoteUrl(resolvedSrc) || resolvedSrc !== src
                ? `"${src}" (resolved to "${resolvedSrc}")`
                : src;
            throw new Error(`[WebFontManager] Failed to load font "${renderedSource}". ${String(error)}`);
        }
    }

    private createPersistentCache(): PersistentArrayBufferStore | null {
        if (!this.cacheOptions.persistent) {
            return null;
        }

        if (typeof indexedDB !== 'undefined') {
            return new IndexedDbArrayBufferStore(this.cacheOptions.dbName, this.cacheOptions.storeName);
        }

        if (typeof caches !== 'undefined') {
            return new CacheStorageArrayBufferStore(this.cacheOptions.dbName, this.cacheOptions.namespace);
        }

        return null;
    }

    private emitProgress(event: WebFontProgressEvent): void {
        try {
            this.onProgress?.(event);
        } catch {
            // Progress handlers must never fail the load path.
        }
    }
}

export default WebFontManager;
