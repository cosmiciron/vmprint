import { FontConfig, FallbackFontSource, FontManager } from '@vmprint/contracts';

export type { FontConfig, FontManager };

export const cloneFontConfig = (font: FontConfig): FontConfig => ({
    ...font,
    weightRange: font.weightRange ? { ...font.weightRange } : undefined,
});

export const cloneFontRegistry = (fonts: FontConfig[]): FontConfig[] => fonts.map(cloneFontConfig);

const requireManager = (manager: FontManager): FontManager => {
    if (!manager) {
        throw new Error(
            'FontManager is required. Inject one via EngineRuntime (createEngineRuntime({ fontManager })).',
        );
    }
    return manager;
};

export const resolveFontFamilyAlias = (family: string, manager: FontManager): string =>
    requireManager(manager).resolveFamilyAlias(family);

export const getFontRegistrySnapshot = (manager: FontManager): FontConfig[] =>
    requireManager(manager).getFontRegistrySnapshot();

export const getAllFonts = (registry: FontConfig[], manager: FontManager): FontConfig[] =>
    requireManager(manager).getAllFonts(registry);

export const getEnabledFallbackFonts = (registry: FontConfig[], manager: FontManager): FallbackFontSource[] =>
    requireManager(manager).getEnabledFallbackFonts(registry);

export const getFontsByFamily = (family: string, registry: FontConfig[], manager: FontManager): FontConfig[] =>
    requireManager(manager).getFontsByFamily(family, registry);

export const getFallbackFamilies = (registry: FontConfig[], manager: FontManager): string[] =>
    requireManager(manager).getFallbackFamilies(registry);

export const registerFont = (config: FontConfig, registry: FontConfig[], manager: FontManager): void => {
    requireManager(manager).registerFont(config, registry);
};

export const registerFallbackFont = (
    family: string,
    src: string,
    unicodeRange: string,
    options: {
        name?: string;
        weight?: number;
        weightRange?: { min: number; max: number };
        style?: 'normal' | 'italic';
    } = {},
    registry: FontConfig[],
    manager: FontManager,
): void => {
    registerFont(
        {
            name: options.name || `${family} ${options.weight === 700 ? 'Bold' : 'Regular'}`,
            family,
            weight: options.weight || 400,
            weightRange: options.weightRange,
            style: options.style || 'normal',
            src,
            unicodeRange,
            enabled: true,
            fallback: true,
        },
        registry,
        manager,
    );
};
