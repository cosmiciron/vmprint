import { FontConfig, FallbackFontSource, FontManager } from '@vmprint/contracts';
import {
    createStandardFontSentinelBuffer,
    getStandardFontMetadataById,
    type StandardFontId
} from './sentinel.js';
import {
    normalizeFamilyKey,
    STANDARD_FONT_ALIASES,
    STANDARD_FONT_REGISTRY,
    STANDARD_FONT_SRC_PREFIX,
    STANDARD_FONT_SRC_TO_ID
} from './config.js';

const normalizeSrcKey = (src: string): string => String(src || '').trim();
const cloneFontConfig = (font: FontConfig): FontConfig => ({ ...font });
const cloneFontRegistry = (fonts: FontConfig[]): FontConfig[] => fonts.map(cloneFontConfig);

export class StandardFontManager implements FontManager {
    private readonly seedFonts: FontConfig[];
    private readonly familyAliases: Record<string, string>;
    private readonly srcToId: Record<string, StandardFontId>;

    constructor(options: { fonts?: FontConfig[]; aliases?: Record<string, string> } = {}) {
        this.seedFonts = cloneFontRegistry(options.fonts || STANDARD_FONT_REGISTRY);
        this.familyAliases = { ...(options.aliases || STANDARD_FONT_ALIASES) };
        this.srcToId = { ...STANDARD_FONT_SRC_TO_ID };
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

    getEnabledFallbackFonts(_registry: FontConfig[]): FallbackFontSource[] {
        return [];
    }

    getFontsByFamily(family: string, registry: FontConfig[]): FontConfig[] {
        const resolvedFamily = this.resolveFamilyAlias(family);
        return registry.filter((font) => font.family === resolvedFamily && font.enabled);
    }

    getFallbackFamilies(_registry: FontConfig[]): string[] {
        return [];
    }

    registerFont(config: FontConfig, registry: FontConfig[]): void {
        registry.push(config);
    }

    async loadFontBuffer(src: string): Promise<ArrayBuffer> {
        const standardFontId = this.resolveStandardFontId(src);
        if (standardFontId === undefined) {
            throw new Error(`[StandardFontManager] Unknown standard font source "${src}".`);
        }
        return createStandardFontSentinelBuffer(standardFontId);
    }

    private resolveStandardFontId(src: string): StandardFontId | undefined {
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
        const metadata = getStandardFontMetadataById(parsed);
        if (!metadata) return undefined;
        return metadata.id as StandardFontId;
    }
}
