export interface FontConfig {
    name: string;
    family: string;
    weight: number;
    weightRange?: { min: number; max: number };
    style: 'normal' | 'italic';
    src: string;
    unicodeRange?: string;
    enabled: boolean;
    fallback: boolean;
}

export interface FallbackFontSource {
    src: string;
    name: string;
    unicodeRange?: string;
}

export interface FontManager {
    getFontRegistrySnapshot(): FontConfig[];
    resolveFamilyAlias(family: string): string;
    getAllFonts(registry: FontConfig[]): FontConfig[];
    getEnabledFallbackFonts(registry: FontConfig[]): FallbackFontSource[];
    getFontsByFamily(family: string, registry: FontConfig[]): FontConfig[];
    getFallbackFamilies(registry: FontConfig[]): string[];
    registerFont(config: FontConfig, registry: FontConfig[]): void;
    loadFontBuffer(src: string): Promise<ArrayBuffer>;
}
