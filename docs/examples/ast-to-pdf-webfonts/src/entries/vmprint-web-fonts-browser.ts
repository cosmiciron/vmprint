import { WebFontManager } from '@vmprint/web-fonts';
import { LOCAL_FONT_ALIASES, LOCAL_FONT_REGISTRY } from '../../../../../font-managers/local/src/config';
import type { FontConfig } from '@vmprint/contracts';

const PRIMARY_FONT_BASE_URL = 'https://cdn.jsdelivr.net/gh/cosmiciron/vmprint@main/font-managers/local/';
const FALLBACK_FONT_BASE_URL = 'https://cdn.jsdelivr.net/gh/cosmiciron/vmprint@assets/font-managers/local/';
const FALLBACK_MAIN_BRANCH_PREFIXES = [
    'assets/fonts/NotoSansSymbol/'
];
const WEBFONT_FETCH_TIMEOUT_MS = 180_000;
const WEBFONT_MAX_CONCURRENT_DOWNLOADS = 2;
const WEBFONT_CACHE_OPTIONS = { persistent: true };

const normalizeFamilyKey = (family: string): string => String(family || '')
    .trim()
    .toLowerCase()
    .replace(/["']/g, '')
    .replace(/\s+/g, ' ');

const resolveAlias = (family: string): string => {
    const normalized = normalizeFamilyKey(family);
    return LOCAL_FONT_ALIASES[normalized] || family;
};

const collectStrings = (value: unknown, bucket: string[]): void => {
    if (typeof value === 'string') {
        bucket.push(value);
        return;
    }
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
        value.forEach((item) => collectStrings(item, bucket));
        return;
    }
    Object.values(value).forEach((entry) => collectStrings(entry, bucket));
};

const collectDocumentCodePoints = (documentInput: unknown): Set<number> => {
    const strings: string[] = [];
    collectStrings(documentInput, strings);
    const codePoints = new Set<number>();
    for (const text of strings) {
        for (const char of text) {
            const codePoint = char.codePointAt(0);
            if (codePoint !== undefined) codePoints.add(codePoint);
        }
    }
    return codePoints;
};

const parseUnicodeRange = (unicodeRange?: string): Array<[number, number]> => {
    if (!unicodeRange) return [];
    return unicodeRange
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean)
        .flatMap((part) => {
            const match = /^U\+([0-9A-F?]+)(?:-([0-9A-F]+))?$/i.exec(part);
            if (!match) return [];
            if (match[1].includes('?')) {
                const start = Number.parseInt(match[1].replace(/\?/g, '0'), 16);
                const end = Number.parseInt(match[1].replace(/\?/g, 'F'), 16);
                return [[start, end] as [number, number]];
            }
            const start = Number.parseInt(match[1], 16);
            const end = Number.parseInt(match[2] || match[1], 16);
            if (!Number.isFinite(start) || !Number.isFinite(end)) return [];
            return [[start, end] as [number, number]];
        });
};

const unicodeRangeContainsAny = (unicodeRange: string | undefined, codePoints: Set<number>): boolean => {
    if (!unicodeRange || codePoints.size === 0) return false;
    const ranges = parseUnicodeRange(unicodeRange);
    if (ranges.length === 0) return false;
    for (const codePoint of codePoints) {
        for (const [start, end] of ranges) {
            if (codePoint >= start && codePoint <= end) return true;
        }
    }
    return false;
};

const toRemoteFontConfig = (font: FontConfig): FontConfig => {
    const normalizedSrc = font.src.replace(/\\/g, '/');
    const fallbackUsesMainBranch = font.fallback && FALLBACK_MAIN_BRANCH_PREFIXES.some((prefix) => normalizedSrc.startsWith(prefix));
    const baseUrl = fallbackUsesMainBranch
        ? PRIMARY_FONT_BASE_URL
        : (font.fallback ? FALLBACK_FONT_BASE_URL : PRIMARY_FONT_BASE_URL);

    return {
        ...font,
        src: `${baseUrl}${normalizedSrc}`
    };
};

const buildFilteredFontRegistry = (documentInput: unknown, config: any): FontConfig[] => {
    const requiredFamilies = new Set<string>();
    const addFamily = (family: unknown) => {
        if (typeof family !== 'string' || !family.trim()) return;
        requiredFamilies.add(resolveAlias(family));
    };

    addFamily(config?.layout?.fontFamily);
    Object.values(config?.fonts || {}).forEach(addFamily);
    Object.values(config?.styles || {}).forEach((style: any) => addFamily(style?.fontFamily));
    (config?.preloadFontFamilies || []).forEach(addFamily);

    const codePoints = collectDocumentCodePoints(documentInput);
    const selectedFallbackFamilies = new Set<string>();
    for (const font of LOCAL_FONT_REGISTRY) {
        if (!font.fallback || !font.enabled) continue;
        if (unicodeRangeContainsAny(font.unicodeRange, codePoints)) {
            selectedFallbackFamilies.add(font.family);
        }
    }

    return LOCAL_FONT_REGISTRY.filter((font) =>
        font.enabled && (requiredFamilies.has(font.family) || selectedFallbackFamilies.has(font.family))
    ).map(toRemoteFontConfig);
};

const createDefaultWebFontManager = (): WebFontManager => new WebFontManager({
    fonts: LOCAL_FONT_REGISTRY.map(toRemoteFontConfig),
    aliases: LOCAL_FONT_ALIASES,
    cache: WEBFONT_CACHE_OPTIONS,
    fetchTimeoutMs: WEBFONT_FETCH_TIMEOUT_MS,
    maxConcurrentDownloads: WEBFONT_MAX_CONCURRENT_DOWNLOADS,
    onProgress: (event) => {
        window.dispatchEvent(new CustomEvent('vmprint:webfont-progress', {
            detail: {
                ...event,
                fileName: event.src.split('/').pop() || event.src
            }
        }));
    }
});

const createDocumentWebFontManager = (documentInput: unknown, config: any): WebFontManager => new WebFontManager({
    fonts: buildFilteredFontRegistry(documentInput, config),
    aliases: LOCAL_FONT_ALIASES,
    cache: WEBFONT_CACHE_OPTIONS,
    fetchTimeoutMs: WEBFONT_FETCH_TIMEOUT_MS,
    maxConcurrentDownloads: WEBFONT_MAX_CONCURRENT_DOWNLOADS,
    onProgress: (event) => {
        window.dispatchEvent(new CustomEvent('vmprint:webfont-progress', {
            detail: {
                ...event,
                fileName: event.src.split('/').pop() || event.src
            }
        }));
    }
});

export {
    buildFilteredFontRegistry,
    createDocumentWebFontManager,
    FALLBACK_FONT_BASE_URL,
    LOCAL_FONT_ALIASES,
    LOCAL_FONT_REGISTRY,
    PRIMARY_FONT_BASE_URL,
    WebFontManager,
    createDefaultWebFontManager
};

export default {
    buildFilteredFontRegistry,
    createDocumentWebFontManager,
    WebFontManager,
    LOCAL_FONT_ALIASES,
    LOCAL_FONT_REGISTRY,
    createDefaultWebFontManager
};
