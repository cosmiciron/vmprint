import { Context } from '@vmprint/contracts';
import { getCachedBuffer, getCachedFont, loadFont } from '../../font-management/font-cache-loader';
import { getAllFonts } from '../../font-management/ops';
import { getStandardFontMetadata } from '../../font-management/sentinel';
import { EngineRuntime } from '../runtime';
import { LayoutUtils } from '../layout/layout-utils';

type RegisterRendererFontsOptions = {
    context: Context;
    runtime: EngineRuntime;
    getFontId: (family: string, weight: number | string | undefined, style: string | undefined) => string;
};

const getRegistrationWeight = (weight: number): number => LayoutUtils.normalizeFontWeight(weight);

export const registerRendererFonts = async ({
    context,
    runtime,
    getFontId
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
            const registrationWeight = getRegistrationWeight(fontConfig.weight);
            const uniqueId = getFontId(fontConfig.family, registrationWeight, fontConfig.style);
            if (registeredIds.has(uniqueId)) continue;
            try {
                const loadedFont = getCachedFont(fontConfig.src, runtime);
                const standardMetadata = getStandardFontMetadata(loadedFont);
                await context.registerFont(
                    uniqueId,
                    new Uint8Array(buffer),
                    standardMetadata ? { standardFontPostScriptName: standardMetadata.postscriptName } : undefined
                );
                registeredIds.add(uniqueId);
            } catch (e) {
                console.error(`Failed to register font ${uniqueId}`, e);
            }
        } else {
            console.warn(`[Renderer] Skipping font ${fontConfig.family} - missing or empty buffer for ${fontConfig.src}`);
        }
    }
};
