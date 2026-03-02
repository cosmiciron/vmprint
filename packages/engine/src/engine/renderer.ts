import { Box, LayoutConfig, Page } from './types';
import { Context, OverlayBox, OverlayContext, OverlayPage, OverlayProvider } from '@vmprint/contracts';
import { LayoutUtils } from './layout/layout-utils';
import { EngineRuntime, getDefaultEngineRuntime } from './runtime';
import { RendererBoxProperties, RendererLine } from './render/types';
import { drawDebugBoxOverlay, drawDebugPageMargins } from './render/debug-draw';
import { drawBoxBackground, drawBoxBorders, drawImageBox } from './render/box-paint';
import { registerRendererFonts } from './render/font-registration';
import { RendererImageBytesCache } from './render/image-bytes-cache';
import { drawRichLines } from './render/rich-lines';
import { buildParagraphMetrics, createLineFrameAccessors } from './render/rich-line-layout';

type OverlayComputedLineMetric = {
    index: number;
    top: number;
    baseline: number;
    bottom: number;
    height: number;
    fontSize: number;
    referenceAscentScale: number;
    ascent: number;
    descent: number;
};

type OverlayComputedTextMetrics = {
    contentBox: { x: number; y: number; w: number; h: number };
    paragraphReferenceAscentScale: number;
    uniformLineHeight: number;
    lines: OverlayComputedLineMetric[];
};

/**
 * Renderer consumes flat pages of boxes only.
 */
export class Renderer {
    private readonly imageBytesCache = new RendererImageBytesCache();

    constructor(
        protected config: LayoutConfig,
        protected debug: boolean = false,
        protected runtime: EngineRuntime = getDefaultEngineRuntime(),
        protected overlay?: OverlayProvider,
    ) {}

    async render(pages: Page[], context: Context): Promise<void> {
        await this.registerFonts(context);

        pages.forEach((page, pageIdx) => {
            context.addPage();
            if (this.config.layout.pageBackground) {
                context.save();
                context
                    .fillColor(this.config.layout.pageBackground)
                    .opacity(1)
                    .rect(0, 0, page.width, page.height)
                    .fill();
                context.restore();
            }
            const hasOverlay = !!(this.overlay?.backdrop || this.overlay?.overlay);
            const overlayPage = hasOverlay ? this.toOverlayPage(page) : undefined;
            const overlayContext = hasOverlay ? this.wrapOverlayContext(context) : undefined;

            if (this.overlay?.backdrop && overlayPage && overlayContext) {
                this.overlay.backdrop(overlayPage, overlayContext);
            }

            const drawOrder = page.boxes
                .map((box, order) => ({ box, order }))
                .sort((left, right) => {
                    const leftZ = LayoutUtils.validateUnit(left.box.style?.zIndex ?? 0);
                    const rightZ = LayoutUtils.validateUnit(right.box.style?.zIndex ?? 0);
                    if (leftZ !== rightZ) return leftZ - rightZ;
                    return left.order - right.order;
                });
            drawOrder.forEach(({ box }) => this.drawBox(context, box));

            if (this.debug) {
                drawDebugPageMargins(
                    context,
                    page.width,
                    page.height,
                    this.config.layout.margins,
                    this.getFontId(this.config.layout.fontFamily, 400, 'normal'),
                );
                drawOrder.forEach(({ box }) =>
                    drawDebugBoxOverlay(context, box, this.getFontId(this.config.layout.fontFamily, 400, 'normal')),
                );
            }

            if (this.overlay?.overlay && overlayPage && overlayContext) {
                this.overlay.overlay(overlayPage, overlayContext);
            }
        });

        context.end();
    }

    private async registerFonts(context: Context) {
        await registerRendererFonts({
            context,
            runtime: this.runtime,
            getFontId: (family, weight, style) => this.getFontId(family, weight, style),
        });
    }

    private getFontId(family: string, weight: number | string | undefined, style: string | undefined): string {
        return LayoutUtils.getFontId(family, weight, style, this.runtime.fontRegistry, this.runtime.fontManager);
    }

    protected drawBox(context: Context, box: Box) {
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
                    getImageBytes: (base64Data) => this.imageBytesCache.get(base64Data),
                },
                (box.properties || {}) as RendererBoxProperties,
            );
        } else if (box.content || box.glyphs) {
            const lines = [
                [
                    {
                        text: box.content || '',
                        glyphs: box.glyphs,
                        ascent: box.ascent,
                        style: { ...boxStyle, textIndent: 0 },
                        width: box.w,
                    },
                ],
            ] as RendererLine[];
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
                    getImageBytes: (base64Data) => this.imageBytesCache.get(base64Data),
                },
                (box.properties || {}) as RendererBoxProperties,
            );
        }

        drawBoxBorders(context, box, boxStyle);

        context.restore();
    }

    private toOverlayPage(page: Page): OverlayPage {
        const boxes: OverlayBox[] = page.boxes.map((box) => ({
            type: box.type,
            x: box.x,
            y: box.y,
            w: box.w,
            h: box.h,
            style: box.style ? { ...box.style } : undefined,
            lines: box.lines?.map((line) => line.map((seg) => ({ text: seg.text, width: seg.width }))),
            meta: box.meta ? { ...box.meta } : undefined,
            properties: this.buildOverlayBoxProperties(box),
        }));
        return {
            index: page.index,
            width: page.width,
            height: page.height,
            boxes,
        };
    }

    private buildOverlayBoxProperties(box: Box): Record<string, unknown> | undefined {
        const properties = box.properties ? { ...box.properties } : {};
        const textMetrics = this.computeOverlayTextMetrics(box);
        if (textMetrics) {
            properties.__vmprintTextMetrics = textMetrics;
        }
        return Object.keys(properties).length > 0 ? properties : undefined;
    }

    private computeOverlayTextMetrics(box: Box): OverlayComputedTextMetrics | null {
        if (!box.lines || box.lines.length === 0) return null;

        const boxStyle = box.style || {};
        const paddingLeft = LayoutUtils.validateUnit(boxStyle.paddingLeft ?? boxStyle.padding ?? 0);
        const paddingRight = LayoutUtils.validateUnit(boxStyle.paddingRight ?? boxStyle.padding ?? 0);
        const paddingTop = LayoutUtils.validateUnit(boxStyle.paddingTop ?? boxStyle.padding ?? 0);
        const paddingBottom = LayoutUtils.validateUnit(boxStyle.paddingBottom ?? boxStyle.padding ?? 0);
        const borderLeft = LayoutUtils.validateUnit(boxStyle.borderLeftWidth ?? boxStyle.borderWidth ?? 0);
        const borderRight = LayoutUtils.validateUnit(boxStyle.borderRightWidth ?? boxStyle.borderWidth ?? 0);
        const borderTop = LayoutUtils.validateUnit(boxStyle.borderTopWidth ?? boxStyle.borderWidth ?? 0);
        const borderBottom = LayoutUtils.validateUnit(boxStyle.borderBottomWidth ?? boxStyle.borderWidth ?? 0);

        const contentX = box.x + paddingLeft + borderLeft;
        const contentY = box.y + paddingTop + borderTop;
        const contentWidth = box.w - paddingLeft - paddingRight - borderLeft - borderRight;
        const contentHeight = box.h - paddingTop - paddingBottom - borderTop - borderBottom;
        const baseFontSize = Number(boxStyle.fontSize || this.config.layout.fontSize);
        const lineHeight = Number(boxStyle.lineHeight || this.config.layout.lineHeight);
        const rendererLines = box.lines as RendererLine[];
        const paragraphMetrics = buildParagraphMetrics(rendererLines, baseFontSize, lineHeight);
        const lineFrame = createLineFrameAccessors(
            (box.properties || {}) as RendererBoxProperties,
            contentY,
            contentWidth,
        );

        const lines: OverlayComputedLineMetric[] = [];
        let currentY = contentY;

        rendererLines.forEach((line, lineIndex) => {
            const metric = paragraphMetrics.lineMetrics[lineIndex];
            const actualLineFontSize = metric?.lineFontSize ?? baseFontSize;
            const referenceAscentScale = metric?.referenceAscentScale ?? paragraphMetrics.paragraphReferenceAscentScale;
            const effectiveLineHeight = metric?.effectiveLineHeight ?? actualLineFontSize * lineHeight;
            const nominalLineHeight = actualLineFontSize * lineHeight;
            const nominalLeading = nominalLineHeight - actualLineFontSize;
            const vOffset = nominalLeading / 2;
            const lineTop = lineFrame.getLineY(lineIndex) ?? currentY;
            const baseline = lineTop + vOffset + referenceAscentScale * actualLineFontSize;
            const bottom = lineTop + effectiveLineHeight;

            let ascent = 0;
            let descent = 0;
            if (Array.isArray(line)) {
                line.forEach((seg) => {
                    const segFontSize = Number(seg.style?.fontSize || baseFontSize);
                    if (Number.isFinite(seg.ascent)) {
                        ascent = Math.max(ascent, (Number(seg.ascent) / 1000) * segFontSize);
                    }
                    if (Number.isFinite(seg.descent)) {
                        descent = Math.max(descent, (Number(seg.descent) / 1000) * segFontSize);
                    }
                });
            }

            lines.push({
                index: lineIndex,
                top: lineTop,
                baseline,
                bottom,
                height: effectiveLineHeight,
                fontSize: actualLineFontSize,
                referenceAscentScale,
                ascent,
                descent,
            });

            if (lineFrame.hasExplicitLineYOffsets) {
                currentY = Math.max(currentY, bottom);
            } else {
                currentY += effectiveLineHeight;
            }
        });

        return {
            contentBox: {
                x: contentX,
                y: contentY,
                w: Math.max(0, contentWidth),
                h: Math.max(0, contentHeight),
            },
            paragraphReferenceAscentScale: paragraphMetrics.paragraphReferenceAscentScale,
            uniformLineHeight: paragraphMetrics.uniformLineHeight,
            lines,
        };
    }

    private wrapOverlayContext(context: Context): OverlayContext {
        const overlayContext: OverlayContext = {
            font: (family, size) => {
                context.font(family, size);
                return overlayContext;
            },
            fontSize: (size) => {
                context.fontSize(size);
                return overlayContext;
            },
            translate: (x, y) => {
                context.translate(x, y);
                return overlayContext;
            },
            rotate: (angle, originX, originY) => {
                context.rotate(angle, originX, originY);
                return overlayContext;
            },
            opacity: (opacity) => {
                context.opacity(opacity);
                return overlayContext;
            },
            fillColor: (color) => {
                context.fillColor(color);
                return overlayContext;
            },
            strokeColor: (color) => {
                context.strokeColor(color);
                return overlayContext;
            },
            lineWidth: (width) => {
                context.lineWidth(width);
                return overlayContext;
            },
            dash: (length, options) => {
                context.dash(length, options);
                return overlayContext;
            },
            undash: () => {
                context.undash();
                return overlayContext;
            },
            moveTo: (x, y) => {
                context.moveTo(x, y);
                return overlayContext;
            },
            lineTo: (x, y) => {
                context.lineTo(x, y);
                return overlayContext;
            },
            bezierCurveTo: (cp1x, cp1y, cp2x, cp2y, x, y) => {
                context.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, x, y);
                return overlayContext;
            },
            rect: (x, y, w, h) => {
                context.rect(x, y, w, h);
                return overlayContext;
            },
            roundedRect: (x, y, w, h, r) => {
                context.roundedRect(x, y, w, h, r);
                return overlayContext;
            },
            fill: (rule) => {
                context.fill(rule);
                return overlayContext;
            },
            stroke: () => {
                context.stroke();
                return overlayContext;
            },
            fillAndStroke: (fillColor, strokeColor) => {
                context.fillAndStroke(fillColor, strokeColor);
                return overlayContext;
            },
            text: (str, x, y, options) => {
                context.text(str, x, y, options);
                return overlayContext;
            },
            save: () => {
                context.save();
            },
            restore: () => {
                context.restore();
            },
        };

        return overlayContext;
    }
}
