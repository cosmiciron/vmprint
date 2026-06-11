import { FontConfig, FallbackFontSource } from '@vmprint/contracts';

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

export interface PersistentArrayBufferStore {
    get(key: string): Promise<ArrayBuffer | null>;
    set(key: string, value: ArrayBuffer): Promise<void>;
}

export type WebFontCacheConfig = Required<WebFontCacheOptions>;
