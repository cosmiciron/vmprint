import { FontConfig, FontManager, FallbackFontSource } from '@vmprint/contracts';
import { LOCAL_FONT_ALIASES, LOCAL_FONT_REGISTRY } from './config.js';
import { normalizeFamilyKey, cloneFontRegistry } from './utils.js';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { _downloadTracker } from './DownloadTracker.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export class LocalFontManager implements FontManager {
    private seedFonts: FontConfig[];
    private readonly familyAliases: Record<string, string>;

    constructor(options: { fonts?: FontConfig[]; aliases?: Record<string, string> } = {}) {
        this.seedFonts = cloneFontRegistry(options.fonts || LOCAL_FONT_REGISTRY);
        this.familyAliases = { ...(options.aliases || LOCAL_FONT_ALIASES) };
    }

    static async create(options: { fonts?: FontConfig[]; aliases?: Record<string, string>; sync?: boolean } = {}): Promise<LocalFontManager> {
        const manager = new LocalFontManager(options);
        if (options.sync !== false) {
            await manager.syncRegistryFromCDN();
        }
        return manager;
    }

    async syncRegistryFromCDN(): Promise<void> {
        const registryUrl = 'https://cdn.jsdelivr.net/gh/cosmiciron/vmprint-font-managers@assets/assets/registry.json';
        let cdnEntries: FontConfig[];
        try {
            const response = await fetch(registryUrl);
            if (!response.ok) return;
            cdnEntries = await response.json() as FontConfig[];
        } catch {
            return;
        }
        const existingNames = new Set(this.seedFonts.map((f) => f.name));
        for (const entry of cdnEntries) {
            if (!existingNames.has(entry.name)) {
                this.seedFonts.push(entry);
                existingNames.add(entry.name);
            }
        }
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
        const os = await import('os');

        const cacheDir = path.resolve(os.homedir(), '.vmprint', 'fonts');

        const resolveLocalPath = (ref: string, fsMod: typeof fs, pathMod: typeof path): string | null => {
            if (pathMod.isAbsolute(ref) && fsMod.existsSync(ref)) {
                return ref;
            }

            const normalizedRef = ref.replace(/\\/g, '/');
            const refWithoutSrcPrefix = normalizedRef.startsWith('src/') ? normalizedRef.slice(4) : normalizedRef;
            const refWithSrcPrefix = normalizedRef.startsWith('src/') ? normalizedRef : `src/${normalizedRef}`;
            
            // Priority 1: User Cache (~/.vmprint/fonts/...)
            const cachePath = pathMod.resolve(cacheDir, refWithoutSrcPrefix);
            if (fsMod.existsSync(cachePath)) return cachePath;

            const packageRoots = [
                pathMod.resolve(__dirname, '..'),
                pathMod.resolve(__dirname, '..', '..')
            ];
            const candidates: string[] = [];

            for (const packageRoot of packageRoots) {
                candidates.push(
                    pathMod.resolve(packageRoot, normalizedRef),
                    pathMod.resolve(packageRoot, 'dist', normalizedRef),
                    pathMod.resolve(packageRoot, refWithSrcPrefix),
                    pathMod.resolve(packageRoot, 'dist', refWithSrcPrefix),
                    pathMod.resolve(packageRoot, refWithoutSrcPrefix),
                    pathMod.resolve(packageRoot, 'dist', refWithoutSrcPrefix)
                );
            }

            candidates.push(
                pathMod.resolve(process.cwd(), normalizedRef),
                pathMod.resolve(process.cwd(), 'dist', normalizedRef),
                pathMod.resolve(process.cwd(), refWithSrcPrefix),
                pathMod.resolve(process.cwd(), 'dist', refWithSrcPrefix),
                pathMod.resolve(process.cwd(), refWithoutSrcPrefix),
                pathMod.resolve(process.cwd(), 'dist', refWithoutSrcPrefix)
            );

            for (const candidate of candidates) {
                if (fsMod.existsSync(candidate)) return candidate;
            }

            return null;
        };

        const targetPath = resolveLocalPath(src, fs, path);
        if (targetPath) {
            const fileBuffer = fs.readFileSync(targetPath);
            const view = new Uint8Array(fileBuffer);
            const copy = new Uint8Array(view.byteLength);
            copy.set(view);
            return copy.buffer;
        }

        // Priority 2: Auto-download from CDN if missing
        const repoBase = 'https://cdn.jsdelivr.net/gh/cosmiciron/vmprint-font-managers@assets/';
        const downloadUrl = `${repoBase}${src.replace(/\\/g, '/')}`;
        
        try {
            const response = await fetch(downloadUrl);
            if (!response.ok) {
                throw new Error(`Failed to download font from ${downloadUrl} (Status: ${response.status})`);
            }

            const chunks: Uint8Array[] = [];
            const reader = response.body?.getReader();
            const fontName = src.split('/').pop() || src;
            
            if (reader) {
                _downloadTracker.update(fontName, 0);
                let receivedBytes = 0;
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    if (value) {
                        chunks.push(value);
                        receivedBytes += value.length;
                        _downloadTracker.update(fontName, receivedBytes / 1024 / 1024);
                    }
                }
                _downloadTracker.remove(fontName);
            }

            const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
            const buffer = new Uint8Array(totalLength);
            let offset = 0;
            for (const chunk of chunks) {
                buffer.set(chunk, offset);
                offset += chunk.length;
            }
            
            // Save to cache for next time
            const normalizedRef = src.replace(/\\/g, '/');
            const refWithoutSrcPrefix = normalizedRef.startsWith('src/') ? normalizedRef.slice(4) : normalizedRef;
            const finalCachePath = path.resolve(cacheDir, refWithoutSrcPrefix);
            
            fs.mkdirSync(path.dirname(finalCachePath), { recursive: true });
            fs.writeFileSync(finalCachePath, buffer);
            
            // Only log cache success if we didn't just show a progress bar to avoid clutter
            if (!reader) {
                process.stdout.write(`[LocalFontManager] Font cached: ${finalCachePath}\n`);
            }
            
            return buffer.buffer;
        } catch (e) {
            const fontName = src.split('/').pop() || src;
            _downloadTracker.remove(fontName);
            throw new Error(`Font file not found for "${src}" and download failed. | cause: ${String(e)}`);
        }
    }
}
