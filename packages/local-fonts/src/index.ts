import { FontConfig, FontManager, FallbackFontSource } from '@vmprint/contracts';
import { cloneFontRegistry } from '@vmprint/engine';
import { LOCAL_FONT_ALIASES, LOCAL_FONT_REGISTRY } from './config.js';

const normalizeFamilyKey = (family: string): string =>
    String(family || '')
        .trim()
        .toLowerCase()
        .replace(/["']/g, '')
        .replace(/\s+/g, ' ');

export class LocalFontManager implements FontManager {
    private readonly seedFonts: FontConfig[];
    private readonly familyAliases: Record<string, string>;

    constructor(options: { fonts?: FontConfig[]; aliases?: Record<string, string> } = {}) {
        this.seedFonts = cloneFontRegistry(options.fonts || LOCAL_FONT_REGISTRY);
        this.familyAliases = { ...(options.aliases || LOCAL_FONT_ALIASES) };
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
                unicodeRange: font.unicodeRange,
            }));
    }

    getFontsByFamily(family: string, registry: FontConfig[]): FontConfig[] {
        const resolvedFamily = this.resolveFamilyAlias(family);
        return registry.filter((font) => font.family === resolvedFamily && font.enabled);
    }

    getFallbackFamilies(registry: FontConfig[]): string[] {
        return Array.from(new Set(registry.filter((font) => font.fallback && font.enabled).map((font) => font.family)));
    }

    registerFont(config: FontConfig, registry: FontConfig[]): void {
        registry.push(config);
    }

    async loadFontBuffer(src: string): Promise<ArrayBuffer> {
        if (src.startsWith('http://') || src.startsWith('https://') || src.startsWith('data:')) {
            const response = await fetch(src);
            if (!response.ok) {
                throw new Error(`HTTP error while loading font "${src}". Status: ${response.status}`);
            }
            return await response.arrayBuffer();
        }

        if (typeof window !== 'undefined') {
            const response = await fetch(src);
            if (!response.ok) {
                throw new Error(`HTTP error while loading font "${src}". Status: ${response.status}`);
            }
            return await response.arrayBuffer();
        }

        const fs = await import('fs');
        const path = await import('path');

        const resolveLocalPath = (ref: string, fsMod: typeof fs, pathMod: typeof path): string => {
            if (pathMod.isAbsolute(ref) && fsMod.existsSync(ref)) {
                return ref;
            }

            const normalizedRef = ref.replace(/\\/g, '/');
            const refWithoutSrcPrefix = normalizedRef.startsWith('src/') ? normalizedRef.slice(4) : normalizedRef;
            const refWithSrcPrefix = normalizedRef.startsWith('src/') ? normalizedRef : `src/${normalizedRef}`;
            const packageRoots = [pathMod.resolve(__dirname, '..'), pathMod.resolve(__dirname, '..', '..')];
            const candidates: string[] = [];

            for (const packageRoot of packageRoots) {
                candidates.push(
                    pathMod.resolve(packageRoot, normalizedRef),
                    pathMod.resolve(packageRoot, 'dist', normalizedRef),
                    pathMod.resolve(packageRoot, refWithSrcPrefix),
                    pathMod.resolve(packageRoot, 'dist', refWithSrcPrefix),
                    pathMod.resolve(packageRoot, refWithoutSrcPrefix),
                    pathMod.resolve(packageRoot, 'dist', refWithoutSrcPrefix),
                );
            }

            candidates.push(
                pathMod.resolve(process.cwd(), normalizedRef),
                pathMod.resolve(process.cwd(), 'dist', normalizedRef),
                pathMod.resolve(process.cwd(), refWithSrcPrefix),
                pathMod.resolve(process.cwd(), 'dist', refWithSrcPrefix),
                pathMod.resolve(process.cwd(), refWithoutSrcPrefix),
                pathMod.resolve(process.cwd(), 'dist', refWithoutSrcPrefix),
            );

            for (const candidate of candidates) {
                if (fsMod.existsSync(candidate)) return candidate;
            }

            throw new Error(`Font file not found for "${ref}". Checked: ${candidates.join(', ')}`);
        };

        const targetPath = resolveLocalPath(src, fs, path);
        const fileBuffer = fs.readFileSync(targetPath);
        const view = new Uint8Array(fileBuffer);
        const copy = new Uint8Array(view.byteLength);
        copy.set(view);
        return copy.buffer;
    }
}

export { LOCAL_FONT_REGISTRY, LOCAL_FONT_ALIASES, LOCAL_FONT_ROOT } from './config.js';
export default LocalFontManager;
