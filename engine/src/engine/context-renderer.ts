import type { Context } from '../contracts';
import type { Box, Page } from './types';
import { BaseRenderer } from './base-renderer';
import { LayoutUtils } from './layout/layout-utils';
import { registerRendererFonts } from './render/font-registration';
import { getCachedFont } from '../font-management/font-cache-loader';
import {
    RendererBoxProperties,
    RendererLine
} from './render/types';
import {
    drawDebugBoxOverlay,
    drawDebugPageMargins,
    drawDebugZoneOverlay
} from './render/debug-draw';
import {
    drawBoxBackground,
    drawBoxBorders,
    drawImageBox
} from './render/box-paint';
import { RendererImageBytesCache } from './render/image-bytes-cache';
import { drawRichLines } from './render/rich-lines';

/**
 * Canonical VMPrint renderer that emits to the stable Context contract.
 */
export class ContextRenderer extends BaseRenderer {
    private readonly imageBytesCache = new RendererImageBytesCache();
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

    protected drawContextBox(context: Context, box: Box): void {
        const boxStyle = box.style || {};

        context.save();

        if (boxStyle.opacity !== undefined) {
            context.opacity(boxStyle.opacity);
        }

        drawBoxBackground(context, box, boxStyle);

        if (box.image) {
            drawImageBox(context, box, (base64Data) => this.imageBytesCache.get(base64Data));
        } else if (box.lines && box.lines.length > 0) {
            const paddingLeft = LayoutUtils.validateUnit(boxStyle.paddingLeft ?? boxStyle.padding ?? 0);
            const paddingRight = LayoutUtils.validateUnit(boxStyle.paddingRight ?? boxStyle.padding ?? 0);
            const paddingTop = LayoutUtils.validateUnit(boxStyle.paddingTop ?? boxStyle.padding ?? 0);

            const borderLeft = LayoutUtils.validateUnit(boxStyle.borderLeftWidth ?? boxStyle.borderWidth ?? 0);
            const borderRight = LayoutUtils.validateUnit(boxStyle.borderRightWidth ?? boxStyle.borderWidth ?? 0);
            const borderTop = LayoutUtils.validateUnit(boxStyle.borderTopWidth ?? boxStyle.borderWidth ?? 0);

            const contentX = box.x + paddingLeft + borderLeft;
            const contentY = box.y + paddingTop + borderTop;
            const contentWidth = box.w - paddingLeft - paddingRight - borderLeft - borderRight;
            drawRichLines(
                context,
                box.lines as RendererLine[],
                contentX,
                contentY,
                boxStyle,
                contentWidth,
                {
                    layout: this.config.layout,
                    debug: this.debug,
                    getFontId: (family, weight, style) => this.getFontId(family, weight, style),
                    getFontAscent: (family, weight, style) => this.getFontAscent(family, weight, style),
                    getImageBytes: (base64Data) => this.imageBytesCache.get(base64Data)
                },
                (box.properties || {}) as RendererBoxProperties
            );
        } else if (box.content || box.glyphs) {
            const defaultFamily = (boxStyle.fontFamily as string | undefined) || this.config.layout.fontFamily;
            const defaultWeight = (boxStyle.fontWeight as number | string | undefined) ?? 400;
            const defaultStyle = (boxStyle.fontStyle as string | undefined) || 'normal';
            const lines = [[{
                text: box.content || '',
                glyphs: box.glyphs,
                ascent: box.ascent,
                style: { ...boxStyle, textIndent: 0 },
                width: box.w,
                resolvedFontId: this.getFontId(defaultFamily, defaultWeight, defaultStyle),
                resolvedFontAscent: this.getFontAscent(defaultFamily, defaultWeight, defaultStyle)
            }]] as RendererLine[];
            drawRichLines(
                context,
                lines,
                box.x,
                box.y,
                { ...boxStyle, textIndent: 0 },
                box.w,
                {
                    layout: this.config.layout,
                    debug: this.debug,
                    getFontId: (family, weight, style) => this.getFontId(family, weight, style),
                    getFontAscent: (family, weight, style) => this.getFontAscent(family, weight, style),
                    getImageBytes: (base64Data) => this.imageBytesCache.get(base64Data)
                },
                (box.properties || {}) as RendererBoxProperties
            );
        }

        drawBoxBorders(context, box, boxStyle);

        context.restore();
    }

    protected drawContextDebugPage(context: Context, page: Page, drawOrder: Array<{ box: Box; order: number }>): void {
        const debugLabelFontId = this.getFontId(this.config.layout.fontFamily, 400, 'normal');
        const debugLabelFontAscent = this.getFontAscent(this.config.layout.fontFamily, 400, 'normal');
        drawDebugPageMargins(
            context,
            page.width,
            page.height,
            this.config.layout.margins,
            debugLabelFontId,
            debugLabelFontAscent
        );
        (page.debugRegions || []).forEach((zone) => drawDebugZoneOverlay(
            context,
            zone,
            debugLabelFontId,
            debugLabelFontAscent
        ));
        drawOrder.forEach(({ box }) => drawDebugBoxOverlay(
            context,
            box,
            debugLabelFontId,
            debugLabelFontAscent
        ));
    }
}
