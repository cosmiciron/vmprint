import {
    normalizeFamilyKey,
    STANDARD_FONT_ALIASES,
    STANDARD_FONT_REGISTRY,
    STANDARD_FONT_SRC_PREFIX,
    STANDARD_FONT_SRC_TO_ID
} from '../../../../../font-managers/standard/src/config';

declare global {
    interface Window {
        VMPrintEngine?: {
            cloneFontRegistry: (fonts: unknown[]) => unknown[];
            createStandardFontSentinelBuffer: (fontId: number) => ArrayBuffer;
            getStandardFontMetadataById: (fontId: number) => { id: number } | null;
        };
    }
}

const normalizeSrcKey = (src: string): string => String(src || '').trim();

type FontLike = {
    family: string;
    enabled: boolean;
};

type FallbackFontSourceLike = unknown;

export class StandardFontManager {
    private readonly seedFonts: unknown[];
    private readonly familyAliases: Record<string, string>;
    private readonly srcToId: Record<string, number>;

    constructor(options: { fonts?: unknown[]; aliases?: Record<string, string> } = {}) {
        const engine = this.engineApi();
        this.seedFonts = engine.cloneFontRegistry(options.fonts || STANDARD_FONT_REGISTRY);
        this.familyAliases = { ...(options.aliases || STANDARD_FONT_ALIASES) };
        this.srcToId = { ...STANDARD_FONT_SRC_TO_ID };
    }

    getFontRegistrySnapshot(): unknown[] {
        return this.engineApi().cloneFontRegistry(this.seedFonts);
    }

    resolveFamilyAlias(family: string): string {
        const key = normalizeFamilyKey(family);
        if (!key) return family;
        return this.familyAliases[key] || family;
    }

    getAllFonts(registry: FontLike[]): FontLike[] {
        return registry.filter((font) => font.enabled);
    }

    getEnabledFallbackFonts(_registry: FontLike[]): FallbackFontSourceLike[] {
        return [];
    }

    getFontsByFamily(family: string, registry: FontLike[]): FontLike[] {
        const resolvedFamily = this.resolveFamilyAlias(family);
        return registry.filter((font) => font.family === resolvedFamily && font.enabled);
    }

    getFallbackFamilies(_registry: FontLike[]): string[] {
        return [];
    }

    registerFont(config: unknown, registry: unknown[]): void {
        registry.push(config);
    }

    async loadFontBuffer(src: string): Promise<ArrayBuffer> {
        const standardFontId = this.resolveStandardFontId(src);
        if (standardFontId === undefined) {
            throw new Error(`[StandardFontManager] Unknown standard font source "${src}".`);
        }
        return this.engineApi().createStandardFontSentinelBuffer(standardFontId);
    }

    private resolveStandardFontId(src: string): number | undefined {
        const normalizedSrc = normalizeSrcKey(src);
        if (!normalizedSrc) return undefined;

        const mapped = this.srcToId[normalizedSrc];
        if (mapped !== undefined) return mapped;

        if (!normalizedSrc.startsWith(STANDARD_FONT_SRC_PREFIX)) return undefined;
        const rawId = normalizedSrc.slice(STANDARD_FONT_SRC_PREFIX.length).trim();
        if (!rawId) return undefined;

        const parsed = /^[0-9a-f]+$/i.test(rawId)
            ? Number.parseInt(rawId, 16)
            : Number.parseInt(rawId, 10);

        if (!Number.isInteger(parsed)) return undefined;
        const metadata = this.engineApi().getStandardFontMetadataById(parsed);
        if (!metadata) return undefined;
        return metadata.id;
    }

    private engineApi(): NonNullable<Window['VMPrintEngine']> {
        const engine = window.VMPrintEngine;
        if (!engine) {
            throw new Error('[StandardFontManager] window.VMPrintEngine is missing. Load vmprint-engine.js first.');
        }
        return engine;
    }
}

export {
    STANDARD_FONT_ALIASES,
    STANDARD_FONT_REGISTRY,
    STANDARD_FONT_SRC_PREFIX
};

export default StandardFontManager;
