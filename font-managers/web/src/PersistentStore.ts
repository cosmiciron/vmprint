import { PersistentArrayBufferStore } from './types.js';
import { copyArrayBuffer, toArrayBuffer } from './utils.js';

export class IndexedDbArrayBufferStore implements PersistentArrayBufferStore {
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

export class CacheStorageArrayBufferStore implements PersistentArrayBufferStore {
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
