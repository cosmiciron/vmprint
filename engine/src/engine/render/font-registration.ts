import { Context } from '@vmprint/contracts';
import { getCachedBuffer, getCachedFont, loadFont } from '../../font-management/font-cache-loader';
import { LayoutConfig, Page } from '../types';
import { getStandardFontMetadata } from '../../font-management/sentinel';
import { EngineRuntime } from '../runtime';
import { LayoutUtils } from '../layout/layout-utils';

type RegisterRendererFontsOptions = {
    context: Context;
    runtime: EngineRuntime;
    config: LayoutConfig;
    pages: Page[];
    debug?: boolean;
    getFontId: (family: string, weight: number | string | undefined, style: string | undefined) => string;
};

const getRegistrationWeight = (weight: number): number => LayoutUtils.normalizeFontWeight(weight);
const rendererFontRegistrationCache = new WeakMap<Context, Set<string>>();

function collectRequiredFontConfigs(runtime: EngineRuntime, config: LayoutConfig, pages: Page[], debug: boolean): Array<{
    family: string;
    weight: number | string | undefined;
    style: string | undefined;
    config: ReturnType<typeof LayoutUtils.resolveFontMatch>['config'];
}> {
    const requested = new Map<string, { family: string; weight: number | string | undefined; style: string | undefined }>();
    const addRequested = (family: string | undefined, weight: number | string | undefined, style: string | undefined): void => {
        const resolvedFamily = String(family || '').trim();
        if (!resolvedFamily) return;
        const normalizedWeight = weight ?? 400;
        const normalizedStyle = style || 'normal';
        const key = `${resolvedFamily}|${normalizedWeight}|${normalizedStyle}`;
        if (!requested.has(key)) {
            requested.set(key, {
                family: resolvedFamily,
                weight: normalizedWeight,
                style: normalizedStyle
            });
        }
    };

    addRequested(config.layout.fontFamily, 400, 'normal');
    Object.values(config.fonts || {}).forEach((family) => addRequested(family, 400, 'normal'));
    Object.values(config.styles || {}).forEach((style: any) => {
        addRequested(style?.fontFamily, style?.fontWeight, style?.fontStyle);
    });
    if (debug) {
        addRequested(config.layout.fontFamily, 400, 'normal');
    }

    for (const page of pages) {
        for (const box of page.boxes) {
            const boxStyle = box.style || {};
            addRequested(
                (boxStyle.fontFamily as string | undefined) || config.layout.fontFamily,
                boxStyle.fontWeight as number | string | undefined,
                boxStyle.fontStyle as string | undefined
            );
            for (const line of box.lines || []) {
                for (const segment of line) {
                    const segmentStyle = segment.style || {};
                    addRequested(
                        (segment.fontFamily as string | undefined)
                            || (segmentStyle.fontFamily as string | undefined)
                            || (boxStyle.fontFamily as string | undefined)
                            || config.layout.fontFamily,
                        (segmentStyle.fontWeight as number | string | undefined) ?? (boxStyle.fontWeight as number | string | undefined),
                        (segmentStyle.fontStyle as string | undefined) || (boxStyle.fontStyle as string | undefined)
                    );
                }
            }
        }
    }

    const resolved = new Map<string, {
        family: string;
        weight: number | string | undefined;
        style: string | undefined;
        config: ReturnType<typeof LayoutUtils.resolveFontMatch>['config'];
    }>();

    for (const entry of requested.values()) {
        try {
            const match = LayoutUtils.resolveFontMatch(
                entry.family,
                entry.weight,
                entry.style,
                runtime.fontRegistry,
                runtime.fontManager
            );
            if (!resolved.has(match.config.src)) {
                resolved.set(match.config.src, {
                    family: entry.family,
                    weight: entry.weight,
                    style: entry.style,
                    config: match.config
                });
            }
        } catch {
            // Rendering will surface missing-font failures when/if the font is actually used.
        }
    }

    return Array.from(resolved.values());
}

export const registerRendererFonts = async ({
    context,
    runtime,
    config,
    pages,
    debug = false,
    getFontId
}: RegisterRendererFontsOptions): Promise<void> => {
    const allFonts = collectRequiredFontConfigs(runtime, config, pages, debug);
    const cachedRegistrations = rendererFontRegistrationCache.get(context) ?? new Set<string>();
    if (!rendererFontRegistrationCache.has(context)) {
        rendererFontRegistrationCache.set(context, cachedRegistrations);
    }
    const registeredIds = new Set<string>();

    for (const fontConfig of allFonts) {
        let buffer = getCachedBuffer(fontConfig.config.src, runtime);
        if (!buffer || buffer.byteLength === 0) {
            try {
                await loadFont(fontConfig.config.src, runtime);
            } catch (e) {
                console.warn(`[Renderer] Failed to load font "${fontConfig.config.src}"`, e);
            }
            buffer = getCachedBuffer(fontConfig.config.src, runtime);
        }

        if (buffer && buffer.byteLength > 0) {
            const registrationWeight = getRegistrationWeight(Number(fontConfig.config.weight));
            const uniqueId = getFontId(fontConfig.config.family, registrationWeight, fontConfig.config.style);
            const registrationKey = `${uniqueId}|${fontConfig.config.src}`;
            if (cachedRegistrations.has(registrationKey)) continue;
            if (registeredIds.has(uniqueId)) continue;
            try {
                const loadedFont = getCachedFont(fontConfig.config.src, runtime);
                const standardMetadata = getStandardFontMetadata(loadedFont);
                await context.registerFont(
                    uniqueId,
                    new Uint8Array(buffer),
                    standardMetadata ? { standardFontPostScriptName: standardMetadata.postscriptName } : undefined
                );
                cachedRegistrations.add(registrationKey);
                registeredIds.add(uniqueId);
            } catch (e) {
                console.error(`Failed to register font ${uniqueId}`, e);
            }
        } else {
            console.warn(`[Renderer] Skipping font ${fontConfig.config.family} - missing or empty buffer for ${fontConfig.config.src}`);
        }
    }
};
