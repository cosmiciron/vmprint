import { EmbeddedImagePayload, ImageFitMode } from '../engine/types';

export interface NormalizedEmbeddedImage {
    base64Data: string;
    bytes: Uint8Array;
    mimeType: string;
    intrinsicWidth: number;
    intrinsicHeight: number;
    fit: ImageFitMode;
}

const EMBEDDED_IMAGE_PAYLOAD_CACHE_LIMIT = 256;
type EmbeddedImageCacheEntry = {
    cacheKey: string;
    base64Data: string;
    parsed: NormalizedEmbeddedImage;
};
const embeddedImagePayloadCache = new Map<string, EmbeddedImageCacheEntry[]>();
const embeddedImagePayloadCacheOrder: EmbeddedImageCacheEntry[] = [];
/** Fast-path: same payload object reference → O(1) lookup, no string comparison. */
const embeddedImageWeakCache = new WeakMap<object, NormalizedEmbeddedImage>();

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_SIGNATURE = [0xff, 0xd8];

const SOF_MARKERS = new Set<number>([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

function isPng(bytes: Uint8Array): boolean {
    if (bytes.length < PNG_SIGNATURE.length) return false;
    for (let i = 0; i < PNG_SIGNATURE.length; i++) {
        if (bytes[i] !== PNG_SIGNATURE[i]) return false;
    }
    return true;
}

function isJpeg(bytes: Uint8Array): boolean {
    if (bytes.length < JPEG_SIGNATURE.length) return false;
    return bytes[0] === JPEG_SIGNATURE[0] && bytes[1] === JPEG_SIGNATURE[1];
}

function getPngDimensions(bytes: Uint8Array): { width: number; height: number } | null {
    if (!isPng(bytes)) return null;
    if (bytes.length < 24) return null;
    const width = (bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19];
    const height = (bytes[20] << 24) | (bytes[21] << 16) | (bytes[22] << 8) | bytes[23];
    if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
    if (width <= 0 || height <= 0) return null;
    return { width, height };
}

function getJpegDimensions(bytes: Uint8Array): { width: number; height: number } | null {
    if (!isJpeg(bytes)) return null;
    let offset = 2;

    while (offset + 1 < bytes.length) {
        if (bytes[offset] !== 0xff) {
            offset += 1;
            continue;
        }

        while (offset < bytes.length && bytes[offset] === 0xff) {
            offset += 1;
        }
        if (offset >= bytes.length) break;

        const marker = bytes[offset];
        offset += 1;

        if (marker === 0xd8 || marker === 0xd9 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
            continue;
        }

        if (offset + 1 >= bytes.length) break;
        const segmentLength = (bytes[offset] << 8) | bytes[offset + 1];
        offset += 2;
        if (segmentLength < 2 || offset + segmentLength - 2 > bytes.length) break;

        if (SOF_MARKERS.has(marker)) {
            if (segmentLength < 7) return null;
            const height = (bytes[offset + 1] << 8) | bytes[offset + 2];
            const width = (bytes[offset + 3] << 8) | bytes[offset + 4];
            if (width <= 0 || height <= 0) return null;
            return { width, height };
        }

        offset += segmentLength - 2;
    }

    return null;
}

function inferMimeType(bytes: Uint8Array): string | null {
    if (isPng(bytes)) return 'image/png';
    if (isJpeg(bytes)) return 'image/jpeg';
    return null;
}

function getImageDimensions(bytes: Uint8Array): { width: number; height: number } | null {
    return getPngDimensions(bytes) || getJpegDimensions(bytes);
}

function parseDataUri(raw: string): { mimeType: string; base64Data: string } | null {
    const match = raw.match(/^data:([^;,]+);base64,([A-Za-z0-9+/=\s]+)$/i);
    if (!match) return null;
    return {
        mimeType: match[1].trim().toLowerCase(),
        base64Data: match[2].replace(/\s+/g, ''),
    };
}

function normalizeBase64(raw: string): string {
    return raw.replace(/\s+/g, '');
}

function assertBase64Data(base64Data: string): void {
    if (!base64Data || base64Data.length === 0) {
        throw new Error('[image] Embedded image data is empty.');
    }

    const valid = /^[A-Za-z0-9+/]*={0,2}$/.test(base64Data);
    if (!valid) {
        throw new Error('[image] Embedded image data must be valid base64.');
    }
}

function decodeBase64(base64Data: string): Uint8Array {
    const binaryString = atob(base64Data);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    if (bytes.length === 0) {
        throw new Error('[image] Embedded image base64 could not be decoded.');
    }
    return bytes;
}

export function parseEmbeddedImageData(
    rawData: string,
    explicitMimeType?: string,
    fit: ImageFitMode = 'contain',
): NormalizedEmbeddedImage {
    if (typeof rawData !== 'string' || rawData.trim().length === 0) {
        throw new Error('[image] Embedded image payload requires a non-empty "data" string.');
    }

    const dataUri = parseDataUri(rawData.trim());
    const uriMime = dataUri?.mimeType;
    const base64Data = normalizeBase64(dataUri?.base64Data || rawData.trim());
    assertBase64Data(base64Data);
    const bytes = decodeBase64(base64Data);

    const inferredMime = inferMimeType(bytes);
    const normalizedExplicitMime = explicitMimeType ? explicitMimeType.trim().toLowerCase() : undefined;
    const mimeType = (uriMime || normalizedExplicitMime || inferredMime || '').trim();
    if (!mimeType) {
        throw new Error('[image] Unable to determine embedded image mimeType. Set "properties.image.mimeType".');
    }

    if (inferredMime && mimeType !== inferredMime) {
        throw new Error(
            `[image] Embedded image mimeType "${mimeType}" does not match decoded bytes ("${inferredMime}").`,
        );
    }

    if (mimeType !== 'image/png' && mimeType !== 'image/jpeg') {
        throw new Error(`[image] Unsupported embedded image mimeType "${mimeType}". Supported: image/png, image/jpeg.`);
    }

    const dims = getImageDimensions(bytes);
    if (!dims) {
        throw new Error('[image] Could not detect embedded image dimensions.');
    }

    const normalizedFit: ImageFitMode = fit === 'fill' ? 'fill' : 'contain';

    return {
        base64Data,
        bytes,
        mimeType,
        intrinsicWidth: dims.width,
        intrinsicHeight: dims.height,
        fit: normalizedFit,
    };
}

export function parseEmbeddedImagePayload(payload: EmbeddedImagePayload): NormalizedEmbeddedImage {
    const rawFit = String(payload?.fit || 'contain');
    const fit: ImageFitMode = rawFit === 'fill' ? 'fill' : 'contain';
    return parseEmbeddedImageData(payload?.data || '', payload?.mimeType, fit);
}

export function parseEmbeddedImagePayloadCached(payload: EmbeddedImagePayload): NormalizedEmbeddedImage {
    // Fast path: same payload object reference is the common case during re-layout.
    const payloadObj = payload as object;
    const weakHit = payloadObj ? embeddedImageWeakCache.get(payloadObj) : undefined;
    if (weakHit) return weakHit;

    const rawData = String(payload?.data || '');
    const rawMime = payload?.mimeType ? String(payload.mimeType).trim().toLowerCase() : '';
    const rawFit = String(payload?.fit || 'contain');
    const fit: ImageFitMode = rawFit === 'fill' ? 'fill' : 'contain';
    const dataUri = parseDataUri(rawData.trim());
    const normalizedBase64 = normalizeBase64(dataUri?.base64Data || rawData.trim());
    // Use length + sampled fingerprint as key to avoid O(n) string comparisons on multi-MB images.
    const dataLen = rawData.length;
    const step = Math.max(1, Math.floor(dataLen / 64));
    let fingerprint = 0x811c9dc5;
    for (let i = 0; i < dataLen; i += step) {
        fingerprint ^= rawData.charCodeAt(i);
        fingerprint = (fingerprint * 0x01000193) >>> 0;
    }
    const cacheKey = `${fit}|${rawMime}|${dataLen}|${fingerprint.toString(36)}`;
    const bucket = embeddedImagePayloadCache.get(cacheKey);
    if (bucket && bucket.length > 0) {
        for (let i = 0; i < bucket.length; i++) {
            const entry = bucket[i];
            // Collision-safe lookup: verify exact normalized payload before returning.
            if (entry.base64Data !== normalizedBase64) continue;
            if (payloadObj) embeddedImageWeakCache.set(payloadObj, entry.parsed);
            return entry.parsed;
        }
    }

    const parsed = parseEmbeddedImageData(rawData, rawMime || undefined, fit);
    const entry: EmbeddedImageCacheEntry = {
        cacheKey,
        base64Data: parsed.base64Data,
        parsed,
    };
    const targetBucket = bucket || [];
    targetBucket.push(entry);
    embeddedImagePayloadCache.set(cacheKey, targetBucket);
    embeddedImagePayloadCacheOrder.push(entry);

    while (embeddedImagePayloadCacheOrder.length > EMBEDDED_IMAGE_PAYLOAD_CACHE_LIMIT) {
        const oldest = embeddedImagePayloadCacheOrder.shift();
        if (!oldest) break;
        const oldestBucket = embeddedImagePayloadCache.get(oldest.cacheKey);
        if (!oldestBucket || oldestBucket.length === 0) continue;
        const idx = oldestBucket.indexOf(oldest);
        if (idx >= 0) oldestBucket.splice(idx, 1);
        if (oldestBucket.length === 0) {
            embeddedImagePayloadCache.delete(oldest.cacheKey);
        } else {
            embeddedImagePayloadCache.set(oldest.cacheKey, oldestBucket);
        }
    }
    if (payloadObj) embeddedImageWeakCache.set(payloadObj, parsed);
    return parsed;
}

export function buildDataUri(base64Data: string, mimeType: string): string {
    return `data:${mimeType};base64,${base64Data}`;
}
