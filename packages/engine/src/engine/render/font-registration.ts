import { Context } from '@vmprint/contracts';
import { getCachedBuffer, getCachedFont, loadFont } from '../../font-management/font-cache-loader';
import { getAllFonts } from '../../font-management/ops';
import { EngineRuntime } from '../runtime';
import { LayoutUtils } from '../layout/layout-utils';

type LoadedFontLike = {
    variationAxes?: {
        wght?: { min?: number; max?: number };
    };
};

type RegisterRendererFontsOptions = {
    context: Context;
    runtime: EngineRuntime;
    getFontId: (family: string, weight: number | string | undefined, style: string | undefined) => string;
};

const getRegistrationWeights = (weight: number, weightRange?: { min: number; max: number }): number[] => {
    const range = LayoutUtils.normalizeFontWeightRange(weightRange);
    if (!range) return [LayoutUtils.normalizeFontWeight(weight)];

    const values: number[] = [];
    for (let candidate = range.min; candidate <= range.max; candidate += 100) {
        values.push(candidate);
    }
    const fallbackWeight = LayoutUtils.normalizeFontWeight(weight);
    if (!values.includes(fallbackWeight)) {
        values.push(fallbackWeight);
    }
    return values.sort((left, right) => left - right);
};

const hydrateWeightRangeFromLoadedFont = (
    fontConfig: { weightRange?: { min: number; max: number } },
    loadedFont: unknown,
): void => {
    if (fontConfig.weightRange) return;
    const axis = (loadedFont as LoadedFontLike | undefined)?.variationAxes?.wght;
    if (!axis) return;

    const min = Number(axis.min);
    const max = Number(axis.max);
    if (!Number.isFinite(min) || !Number.isFinite(max)) return;

    fontConfig.weightRange = {
        min: Math.min(LayoutUtils.normalizeFontWeight(min), LayoutUtils.normalizeFontWeight(max)),
        max: Math.max(LayoutUtils.normalizeFontWeight(min), LayoutUtils.normalizeFontWeight(max)),
    };
};

export const registerRendererFonts = async ({
    context,
    runtime,
    getFontId,
}: RegisterRendererFontsOptions): Promise<void> => {
    const allFonts = getAllFonts(runtime.fontRegistry, runtime.fontManager);
    const registeredIds = new Set<string>();

    for (const fontConfig of allFonts) {
        let buffer = getCachedBuffer(fontConfig.src, runtime);
        if (!buffer || buffer.byteLength === 0) {
            try {
                await loadFont(fontConfig.src, runtime);
            } catch (e) {
                console.warn(`[Renderer] Failed to load font "${fontConfig.src}"`, e);
            }
            buffer = getCachedBuffer(fontConfig.src, runtime);
        }

        if (buffer && buffer.byteLength > 0) {
            hydrateWeightRangeFromLoadedFont(fontConfig, getCachedFont(fontConfig.src, runtime));
            const registrationWeights = getRegistrationWeights(fontConfig.weight, fontConfig.weightRange);
            for (const registrationWeight of registrationWeights) {
                const uniqueId = getFontId(fontConfig.family, registrationWeight, fontConfig.style);
                if (registeredIds.has(uniqueId)) continue;
                try {
                    await context.registerFont(uniqueId, new Uint8Array(buffer));
                    registeredIds.add(uniqueId);
                } catch (e) {
                    console.error(`Failed to register font ${uniqueId}`, e);
                }
            }
        } else {
            console.warn(
                `[Renderer] Skipping font ${fontConfig.family} - missing or empty buffer for ${fontConfig.src}`,
            );
        }
    }
};
