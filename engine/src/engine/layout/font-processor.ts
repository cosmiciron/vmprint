import { BaseLayout } from './base-layout';
import { getEnabledFallbackFonts, getFontsByFamily } from '../../font-management/ops';
import { LayoutConfig } from '../types';
import { EngineRuntime } from '../runtime';
import { FontkitTextDelegate, TextDelegateLoadError } from './text-delegate';

export class FontProcessor extends BaseLayout {
    protected font: any = null;
    protected fallbackFonts: any[] = [];
    protected fontPromise: Promise<void> | null = null;

    constructor(config: LayoutConfig, runtime?: EngineRuntime) {
        super(config, runtime);
        this.initializeFont();
    }

    async waitForFonts(): Promise<void> {
        if (this.fontPromise) {
            await this.fontPromise;
            return;
        }
        await this.initializeFont();
    }

    protected async initializeFont() {
        if (this.fontPromise) return this.fontPromise;
        this.runtime.textDelegate = this.runtime.textDelegate || new FontkitTextDelegate();
        const textDelegate = this.runtime.textDelegate;
        const delegateState = this.runtime.textDelegateState;

        const enabledFallbacks = getEnabledFallbackFonts(this.runtime.fontRegistry, this.runtime.fontManager);
        const primaryFamily = this.config.fonts?.regular || this.config.layout.fontFamily;
        const primaryFamilyFonts = getFontsByFamily(primaryFamily, this.runtime.fontRegistry, this.runtime.fontManager);
        const primaryUrl = primaryFamilyFonts.find(f => f.style === 'normal' && f.weight === 400)?.src || primaryFamilyFonts[0]?.src;

        if (primaryUrl) {
            const cached = textDelegate.getCachedFace(primaryUrl, delegateState);
            if (cached) {
                this.font = cached;
            }
        }

        this.fallbackFonts = enabledFallbacks
            .map(f => textDelegate.getCachedFace(f.src, delegateState))
            .filter(Boolean);

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
                familyFonts.forEach(f => loadPromises.push(textDelegate.loadFace(f.src, this.runtime.fontManager, delegateState)));
            }

            await Promise.allSettled(loadPromises);

            if (!primaryUrl) return;

            if (!this.font) {
                try {
                    this.font = await textDelegate.loadFace(primaryUrl, this.runtime.fontManager, delegateState);
                } catch (e) {
                    const details = e instanceof TextDelegateLoadError
                        ? `${e.message}${(e as Error & { cause?: unknown }).cause ? ` | cause: ${String((e as Error & { cause?: unknown }).cause)}` : ''}`
                        : String(e);
                    throw new Error(`[FontProcessor] Failed to load primary font "${primaryUrl}": ${details}`);
                }
            }

            // Load fallbacks that weren't in cache
            const missingFallbacks = enabledFallbacks.filter(f => !textDelegate.getCachedFace(f.src, delegateState));
            if (missingFallbacks.length > 0) {
                const results = await Promise.allSettled(missingFallbacks.map(f => textDelegate.loadFace(f.src, this.runtime.fontManager, delegateState)));
                const failures = results
                    .map((result, index) => ({ result, font: missingFallbacks[index] }))
                    .filter(({ result }) => result.status === 'rejected');

                if (failures.length > 0) {
                    failures.forEach(({ result, font }) => {
                        const reason = (result as PromiseRejectedResult).reason;
                        const renderedReason = reason instanceof Error
                            ? `${reason.message}${(reason as Error & { cause?: unknown }).cause ? ` | cause: ${String((reason as Error & { cause?: unknown }).cause)}` : ''}`
                            : String(reason);
                        console.warn(`[FontProcessor] Failed to load fallback font "${font.name}" (${font.src}): ${renderedReason}`);
                    });
                }

                const newFallbacks = results
                    .filter(r => r.status === 'fulfilled' && r.value)
                    .map(r => (r as PromiseFulfilledResult<any>).value);

                const currentSources = new Set(this.fallbackFonts.map(f => textDelegate.getFaceCacheKey(f)));
                newFallbacks.forEach(f => {
                    const faceKey = textDelegate.getFaceCacheKey(f);
                    if (!currentSources.has(faceKey)) {
                        this.fallbackFonts.push(f);
                        currentSources.add(faceKey);
                    }
                });
            }
        })();

        return this.fontPromise;
    }
}
