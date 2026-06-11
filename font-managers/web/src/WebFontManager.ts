import { FontConfig, FallbackFontSource, FontManager } from '@vmprint/contracts';
import {
    WebFontCatalog,
    WebFontCatalogLoadOptions,
    WebFontManagerOptions,
    WebFontProgressEvent,
    PersistentArrayBufferStore,
    WebFontCacheConfig
} from './types.js';
import {
    normalizeFamilyKey,
    cloneFontRegistry,
    copyArrayBuffer,
    isDataUri,
    isRemoteUrl,
    mergeAliases,
    normalizeCacheOptions,
    decodeDataUri,
    combineRequestInit,
    resolveAgainstBase,
    buildCacheKey,
    sleep,
    isAbortLikeError
} from './utils.js';
import { IndexedDbArrayBufferStore, CacheStorageArrayBufferStore } from './PersistentStore.js';
import { DownloadLimiter } from './DownloadLimiter.js';

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
