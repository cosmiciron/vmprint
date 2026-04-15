import {
    Box,
    LayoutConfig,
    Page
} from './types';
import type { Context, OverlayBox, OverlayContext, OverlayPage, OverlayProvider } from '../contracts';
import { LayoutUtils } from './layout/layout-utils';
import { EngineRuntime, getDefaultEngineRuntime } from './runtime';
import {
    RendererBoxProperties,
    RendererLine
} from './render/types';
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

type OverlayInteractionRegion = {
    sourceId: string;
    originSourceId?: string;
    clonedFromSourceId?: string;
    engineKey?: string;
    sourceType?: string;
    fragmentIndex: number;
    isContinuation: boolean;
    generated: boolean;
    transformKind?: 'clone' | 'split' | 'morph';
    selectableText: boolean;
    containerSourceId?: string;
    containerType?: string;
    containerEngineKey?: string;
};

export abstract class BaseRenderer {
    protected config: LayoutConfig;
    protected debug: boolean;
    protected overlay: OverlayProvider | undefined;
    private _runtime?: EngineRuntime;

    constructor(
        config: LayoutConfig,
        debug: boolean = false,
        runtime?: EngineRuntime,
        overlay?: OverlayProvider
    ) {
        this.config = config;
        this.debug = debug;
        this._runtime = runtime;
        this.overlay = overlay;
    }

    /**
     * Lazily resolved engine runtime. This keeps browser-oriented subclasses
     * safe while preserving identical behavior for VMPrint renderers that
     * provide a runtime explicitly.
     */
    protected get runtime(): EngineRuntime {
        if (!this._runtime) {
            this._runtime = getDefaultEngineRuntime();
        }
        return this._runtime;
    }

    abstract render(pages: Page[], output: unknown): Promise<void>;
    protected abstract registerFonts(context: Context, pages: Page[]): Promise<void>;
    protected abstract getFontId(family: string, weight: number | string | undefined, style: string | undefined): string;
    protected abstract getFontAscent(family: string, weight: number | string | undefined, style: string | undefined): number;

    public toOverlayPage(page: Page): OverlayPage {
        const boxes: OverlayBox[] = page.boxes.map((box) => ({
            type: box.type,
            x: box.x,
            y: box.y,
            w: box.w,
            h: box.h,
            style: box.style ? { ...box.style } : undefined,
            lines: box.lines?.map(line => line.map(seg => ({ text: seg.text, width: seg.width, direction: seg.direction }))),
            meta: box.meta ? { ...box.meta } : undefined,
            properties: this.buildOverlayBoxProperties(box)
        }));
        return {
            index: page.index,
            width: page.width,
            height: page.height,
            boxes
        };
    }

    protected buildOverlayBoxProperties(box: Box): Record<string, unknown> | undefined {
        const properties = box.properties ? { ...box.properties } : {};
        const textMetrics = this.computeOverlayTextMetrics(box);
        if (textMetrics) {
            properties.__vmprintTextMetrics = textMetrics;
        }
        const interactionRegion = this.computeOverlayInteractionRegion(box);
        if (interactionRegion) {
            properties.__vmprintInteractionRegion = interactionRegion;
        }
        return Object.keys(properties).length > 0 ? properties : undefined;
    }

    protected computeOverlayInteractionRegion(box: Box): OverlayInteractionRegion | null {
        const sourceId = String(box.meta?.sourceId || '');
        if (!sourceId) return null;
        const properties = box.properties || {};
        return {
            sourceId,
            originSourceId: typeof box.meta?.originSourceId === 'string' ? box.meta.originSourceId : undefined,
            clonedFromSourceId: typeof box.meta?.clonedFromSourceId === 'string' ? box.meta.clonedFromSourceId : undefined,
            engineKey: typeof box.meta?.engineKey === 'string' ? box.meta.engineKey : undefined,
            sourceType: typeof box.meta?.sourceType === 'string' ? box.meta.sourceType : undefined,
            fragmentIndex: Number(box.meta?.fragmentIndex || 0),
            isContinuation: Boolean(box.meta?.isContinuation),
            generated: Boolean(box.meta?.generated),
            transformKind: box.meta?.transformKind,
            selectableText: Boolean(
                (Array.isArray(box.lines) && box.lines.length > 0)
                || (typeof box.content === 'string' && box.content.length > 0)
                || (Array.isArray(box.glyphs) && box.glyphs.length > 0)
            ),
            containerSourceId: typeof properties._interactionContainerSourceId === 'string'
                ? properties._interactionContainerSourceId
                : undefined,
            containerType: typeof properties._interactionContainerType === 'string'
                ? properties._interactionContainerType
                : undefined,
            containerEngineKey: typeof properties._interactionContainerEngineKey === 'string'
                ? properties._interactionContainerEngineKey
                : undefined
        };
    }

    protected computeOverlayTextMetrics(box: Box): OverlayComputedTextMetrics | null {
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
        const lineFrame = createLineFrameAccessors((box.properties || {}) as RendererBoxProperties, contentY, contentWidth);

        const lines: OverlayComputedLineMetric[] = [];
        let currentY = contentY;

        rendererLines.forEach((line, lineIndex) => {
            const metric = paragraphMetrics.lineMetrics[lineIndex];
            const actualLineFontSize = metric?.lineFontSize ?? baseFontSize;
            const referenceAscentScale = metric?.referenceAscentScale ?? paragraphMetrics.paragraphReferenceAscentScale;
            const effectiveLineHeight = metric?.effectiveLineHeight ?? (actualLineFontSize * lineHeight);
            const nominalLineHeight = actualLineFontSize * lineHeight;
            const nominalLeading = nominalLineHeight - actualLineFontSize;
            const vOffset = nominalLeading / 2;
            const lineTop = lineFrame.getLineY(lineIndex) ?? currentY;
            const baseline = lineTop + vOffset + (referenceAscentScale * actualLineFontSize);
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
                descent
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
                h: Math.max(0, contentHeight)
            },
            paragraphReferenceAscentScale: paragraphMetrics.paragraphReferenceAscentScale,
            uniformLineHeight: paragraphMetrics.uniformLineHeight,
            lines
        };
    }

    protected wrapOverlayContext(context: Context): OverlayContext {
        let activeFontFamily = this.config.layout.fontFamily;
        const overlayContext: OverlayContext = {
            font: (family, size) => {
                activeFontFamily = family;
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
                const ascent = options?.ascent ?? this.getFontAscent(activeFontFamily, undefined, undefined);
                context.text(str, x, y, { ...options, ascent });
                return overlayContext;
            },
            save: () => {
                context.save();
            },
            restore: () => {
                context.restore();
            }
        };

        return overlayContext;
    }

    protected getPageDrawOrder(page: Page): Array<{ box: Box; order: number }> {
        return page.boxes
            .map((box, order) => ({ box, order }))
            .sort((left, right) => {
                const leftZ = LayoutUtils.validateUnit(left.box.style?.zIndex ?? 0);
                const rightZ = LayoutUtils.validateUnit(right.box.style?.zIndex ?? 0);
                if (leftZ !== rightZ) return leftZ - rightZ;
                return left.order - right.order;
            });
    }
}
