import { BaseLayout } from './base-layout';
import { loadFont, getCachedFont, FontLoadError } from '../../font-management/font-cache-loader';
import { getEnabledFallbackFonts, getFontsByFamily } from '../../font-management/ops';
import { LayoutConfig } from '../types';
import { EngineRuntime } from '../runtime';

export class FontProcessor extends BaseLayout {
    protected font: any = null;
    protected fallbackFonts: any[] = [];
    protected fontPromise: Promise<void> | null = null;

    constructor(config: LayoutConfig, runtime?: EngineRuntime) {
        super(config, runtime);
        this.initializeFont();
    }

    async waitForFonts(): Promise<void> {
        if (this.font && this.fallbackFonts.length > 0) return;
        await this.initializeFont();
    }

    protected async initializeFont() {
        if (this.fontPromise) return this.fontPromise;

        const enabledFallbacks = getEnabledFallbackFonts(this.runtime.fontRegistry, this.runtime.fontManager);
        const primaryFamily = this.config.fonts?.regular || this.config.layout.fontFamily;
        const primaryFamilyFonts = getFontsByFamily(primaryFamily, this.runtime.fontRegistry, this.runtime.fontManager);
        const primaryUrl =
            primaryFamilyFonts.find((f) => f.style === 'normal' && f.weight === 400)?.src || primaryFamilyFonts[0]?.src;

        if (primaryUrl) {
            const cached = getCachedFont(primaryUrl, this.runtime);
            if (cached) {
                this.font = cached;
            }
        }

        this.fallbackFonts = enabledFallbacks.map((f) => getCachedFont(f.src, this.runtime)).filter(Boolean);

        this.fontPromise = (async () => {
            const familiesToLoad = new Set<string>();
            familiesToLoad.add(this.config.layout.fontFamily);
            Object.values(this.config.fonts || {}).forEach((family) => {
                if (family) familiesToLoad.add(family);
            });

            Object.values(this.config.styles).forEach((style: any) => {
                if (style.fontFamily) familiesToLoad.add(style.fontFamily);
            });
            (this.config.preloadFontFamilies || []).forEach((family) => {
                if (family) familiesToLoad.add(family);
            });

            const loadPromises: Promise<any>[] = [];
            for (const family of familiesToLoad) {
                const familyFonts = getFontsByFamily(family, this.runtime.fontRegistry, this.runtime.fontManager);
                if (familyFonts.length === 0) {
                    console.warn(`[FontProcessor] Requested font family not registered: ${family}`);
                    continue;
                }
                familyFonts.forEach((f) => loadPromises.push(loadFont(f.src, this.runtime)));
            }

            await Promise.allSettled(loadPromises);

            if (!primaryUrl) return;

            if (!this.font) {
                try {
                    this.font = await loadFont(primaryUrl, this.runtime);
                } catch (e) {
                    const details =
                        e instanceof FontLoadError
                            ? `${e.message}${(e as Error & { cause?: unknown }).cause ? ` | cause: ${String((e as Error & { cause?: unknown }).cause)}` : ''}`
                            : String(e);
                    throw new Error(`[FontProcessor] Failed to load primary font "${primaryUrl}": ${details}`);
                }
            }

            // Load fallbacks that weren't in cache
            const missingFallbacks = enabledFallbacks.filter((f) => !getCachedFont(f.src, this.runtime));
            if (missingFallbacks.length > 0) {
                const results = await Promise.allSettled(missingFallbacks.map((f) => loadFont(f.src, this.runtime)));
                const newFallbacks = results
                    .filter((r) => r.status === 'fulfilled' && r.value)
                    .map((r) => (r as PromiseFulfilledResult<any>).value);

                const currentSources = new Set(this.fallbackFonts.map((f) => f.postscriptName));
                newFallbacks.forEach((f) => {
                    if (!currentSources.has(f.postscriptName)) {
                        this.fallbackFonts.push(f);
                    }
                });
            }
        })();

        return this.fontPromise;
    }
}
