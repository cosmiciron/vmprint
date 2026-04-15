import type { Context } from '../contracts';
import type { Page } from './types';
import { BaseRenderer } from './base-renderer';
import { LayoutUtils } from './layout/layout-utils';
import { registerRendererFonts } from './render/font-registration';
import { getCachedFont } from '../font-management/font-cache-loader';

/**
 * Canonical VMPrint renderer that emits to the stable Context contract.
 */
export class ContextRenderer extends BaseRenderer {
    private readonly fontIdCache = new Map<string, string>();
    private readonly fontAscentCache = new Map<string, number>();

    protected async registerFonts(context: Context, pages: Page[]): Promise<void> {
        await registerRendererFonts({
            context,
            runtime: this.runtime,
            config: this.config,
            pages,
            debug: this.debug,
            getFontId: (family, weight, style) => this.getFontId(family, weight, style)
        });
    }

    private getFontCacheKey(family: string, weight: number | string | undefined, style: string | undefined): string {
        return `${family || ''}|${String(weight ?? 400)}|${style || 'normal'}`;
    }

    protected getFontId(family: string, weight: number | string | undefined, style: string | undefined): string {
        const cacheKey = this.getFontCacheKey(family, weight, style);
        const cached = this.fontIdCache.get(cacheKey);
        if (cached) return cached;
        const resolved = LayoutUtils.getFontId(family, weight, style, this.runtime.textDelegate);
        this.fontIdCache.set(cacheKey, resolved);
        return resolved;
    }

    protected getFontAscent(family: string, weight: number | string | undefined, style: string | undefined): number {
        const cacheKey = this.getFontCacheKey(family, weight, style);
        const cached = this.fontAscentCache.get(cacheKey);
        if (cached !== undefined) return cached;

        let resolvedAscent = 750;
        try {
            const match = LayoutUtils.resolveFontMatch(family, weight, style, this.runtime.textDelegate);
            const font = getCachedFont(match.config.src, this.runtime) as any;
            if (!font) {
                this.fontAscentCache.set(cacheKey, resolvedAscent);
                return resolvedAscent;
            }
            const upm = Number(font.unitsPerEm);
            const rawAscent = Number(font.ascent);
            if (Number.isFinite(upm) && upm > 0 && Number.isFinite(rawAscent)) {
                resolvedAscent = (rawAscent / upm) * 1000;
            }
        } catch {
            resolvedAscent = 750;
        }
        this.fontAscentCache.set(cacheKey, resolvedAscent);
        return resolvedAscent;
    }

    async render(pages: Page[], context: Context): Promise<void> {
        await this.registerFonts(context, pages);

        pages.forEach((page) => {
            context.addPage();
            if (this.config.layout.pageBackground) {
                context.save();
                context.fillColor(this.config.layout.pageBackground).opacity(1)
                    .rect(0, 0, page.width, page.height).fill();
                context.restore();
            }
            const hasOverlay = !!(this.overlay?.backdrop || this.overlay?.overlay);
            const overlayPage = hasOverlay ? this.toOverlayPage(page) : undefined;
            const overlayContext = hasOverlay ? this.wrapOverlayContext(context) : undefined;

            if (this.overlay?.backdrop && overlayPage && overlayContext) {
                this.overlay.backdrop(overlayPage, overlayContext);
            }

            const drawOrder = this.getPageDrawOrder(page);
            drawOrder.forEach(({ box }) => this.drawContextBox(context, box));

            if (this.debug) {
                this.drawContextDebugPage(context, page, drawOrder);
            }

            if (this.overlay?.overlay && overlayPage && overlayContext) {
                this.overlay.overlay(overlayPage, overlayContext);
            }
        });

        context.end();
    }
}
