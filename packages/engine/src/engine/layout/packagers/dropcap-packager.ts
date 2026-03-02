import { Box, DropCapSpec, Element, ElementStyle } from '../../types';
import { LayoutProcessor } from '../layout-core';
import { FlowBox } from '../layout-core-types';
import { LayoutUtils } from '../layout-utils';
import { LAYOUT_DEFAULTS } from '../defaults';
import { FlowBoxPackager } from './flow-box-packager';
import { LayoutBox, PackagerContext, PackagerUnit } from './packager-types';

type DropCapParts = {
    dropCap: FlowBox;
    wrap: FlowBox;
    body: FlowBox | null;
    wrapOffsetX: number;
    unifiedLayoutBefore: number;
};

class DropCapFragmentPackager implements PackagerUnit {
    private processor: LayoutProcessor;
    private dropCap: FlowBox;
    private wrap: FlowBox;
    private body: FlowBox | null;
    private wrapOffsetX: number;
    private unifiedLayoutBefore: number;
    private requiredHeight: number;

    get pageBreakBefore(): boolean | undefined {
        return this.wrap.pageBreakBefore;
    }
    get keepWithNext(): boolean | undefined {
        return this.wrap.keepWithNext;
    }

    constructor(
        processor: LayoutProcessor,
        dropCap: FlowBox,
        wrap: FlowBox,
        body: FlowBox | null,
        wrapOffsetX: number,
        unifiedLayoutBefore: number,
    ) {
        this.processor = processor;
        this.dropCap = dropCap;
        this.wrap = wrap;
        this.body = body;
        this.wrapOffsetX = wrapOffsetX;
        this.unifiedLayoutBefore = unifiedLayoutBefore;

        const capHeight = Math.max(0, this.dropCap.measuredContentHeight);
        const wrapHeight = Math.max(0, this.wrap.measuredContentHeight);
        let required = this.unifiedLayoutBefore + Math.max(capHeight, wrapHeight);
        if (this.body) {
            required += Math.max(0, this.body.measuredContentHeight) + Math.max(0, this.body.marginBottom);
        } else {
            required += Math.max(this.dropCap.marginBottom || 0, this.wrap.marginBottom || 0);
        }
        this.requiredHeight = required;
    }

    emitBoxes(availableWidth: number, _availableHeight: number, context: PackagerContext): Box[] {
        const dropCap = { ...this.dropCap, properties: { ...this.dropCap.properties } };
        const wrap = { ...this.wrap, properties: { ...this.wrap.properties, _glueOffsetX: this.wrapOffsetX } };
        const body = this.body ? { ...this.body, properties: { ...this.body.properties } } : null;

        const positionedDrop = (this.processor as any).positionFlowBox(
            dropCap,
            0,
            this.unifiedLayoutBefore,
            context.margins,
            availableWidth,
            0,
        );
        const positionedWrap = (this.processor as any).positionFlowBox(
            wrap,
            0,
            this.unifiedLayoutBefore,
            context.margins,
            availableWidth,
            0,
        );

        const boxes: Box[] = [];
        boxes.push(...(Array.isArray(positionedDrop) ? positionedDrop : [positionedDrop]));
        boxes.push(...(Array.isArray(positionedWrap) ? positionedWrap : [positionedWrap]));

        const capHeight = Math.max(0, dropCap.measuredContentHeight);
        const wrapHeight = Math.max(0, wrap.measuredContentHeight);
        const y = this.unifiedLayoutBefore + Math.max(capHeight, wrapHeight);
        if (body) {
            const positionedBody = (this.processor as any).positionFlowBox(
                body,
                y,
                0,
                context.margins,
                availableWidth,
                0,
            );
            boxes.push(...(Array.isArray(positionedBody) ? positionedBody : [positionedBody]));
        }

        for (const b of boxes) {
            if (b.meta) b.meta = { ...b.meta };
        }
        return boxes;
    }

    split(_availableHeight: number, _context: PackagerContext): [PackagerUnit | null, PackagerUnit | null] {
        return [null, this];
    }

    getRequiredHeight(): number {
        return this.requiredHeight;
    }

    isUnbreakable(_availableHeight: number): boolean {
        return true;
    }

    getMarginTop(): number {
        return this.wrap.marginTop;
    }

    getMarginBottom(): number {
        return this.body ? Math.max(0, this.body.marginBottom) : Math.max(0, this.wrap.marginBottom);
    }
}

/**
 * Resolves ascent and descent scales (value / unitsPerEm) from a loaded font object.
 * Falls back to typical Latin values when the font object lacks the expected fields.
 */
function resolveFontMetricScales(font: any): { ascentScale: number; descentScale: number } {
    const upm = Number(font?.unitsPerEm);
    if (upm > 0) {
        const rawAscent = Number(font?.ascent);
        const rawDescent = Number(font?.descent);
        if (Number.isFinite(rawAscent) && rawAscent > 0 && Number.isFinite(rawDescent)) {
            return {
                ascentScale: rawAscent / upm,
                descentScale: Math.abs(rawDescent) / upm,
            };
        }
    }
    return { ascentScale: 0.8, descentScale: 0.2 };
}

/**
 * Attempts to estimate the ascent scale using actual glyph bounds for a string.
 * Falls back to null when glyph bounds are unavailable.
 */
function resolveGlyphMetricScales(font: any, text: string): { ascentScale: number; descentScale: number } | null {
    if (!font || !text) return null;
    const upm = Number(font?.unitsPerEm);
    if (!Number.isFinite(upm) || upm <= 0) return null;
    if (typeof font.layout !== 'function') return null;

    try {
        const run = font.layout(text);
        if (!run?.glyphs || run.glyphs.length === 0) return null;
        let maxY = -Infinity;
        let minY = Infinity;
        for (const glyph of run.glyphs) {
            const bbox = glyph?.bbox || (typeof glyph?.getBBox === 'function' ? glyph.getBBox() : null);
            const yMax = Number(bbox?.maxY ?? bbox?.yMax);
            const yMin = Number(bbox?.minY ?? bbox?.yMin);
            if (Number.isFinite(yMax)) {
                if (yMax > maxY) maxY = yMax;
            }
            if (Number.isFinite(yMin)) {
                if (yMin < minY) minY = yMin;
            }

            const rawYMax = Number(glyph?.yMax);
            const rawYMin = Number(glyph?.yMin);
            if (Number.isFinite(rawYMax) && rawYMax > maxY) maxY = rawYMax;
            if (Number.isFinite(rawYMin) && rawYMin < minY) minY = rawYMin;
        }

        if (!Number.isFinite(maxY) || maxY <= 0) return null;
        if (!Number.isFinite(minY)) {
            minY = 0;
        }
        if (maxY <= 0) return null;
        const ascentScale = maxY / upm;
        const descentScale = Math.max(0, Math.abs(minY) / upm);
        if (!Number.isFinite(ascentScale) || ascentScale <= 0) return null;
        return { ascentScale, descentScale };
    } catch {
        return null;
    }
}

/**
 * Computes the drop cap font size so that:
 *   • the cap glyph top aligns with the body line box top, and
 *   • the cap baseline aligns with body line N's baseline.
 *
 * Strategy — exploit the renderer's clamping guard (rich-line-draw.ts):
 *
 *   maxTopY = lineTopY + effectiveLH − segAscent·px − segDescent·px
 *   if (finalY > maxTopY) finalY = maxTopY;
 *
 * With lineHeight_cap = 1 the cap font has no nominal leading, so
 * effectiveCapLH = capS · capFontSize (font-metric driven) and maxTopY = lineTopY.
 * The clamp unconditionally fires, setting finalY = lineTopY regardless of vOffset.
 * We therefore set lineTopY = startY via _lineYOffsets so the glyph
 * is drawn at the very top of the drop cap box.
 *
 * Because finalY = lineTopY = startY the cap baseline is:
 *
 *   capBaseline = finalY + capAscent · capFontSize
 *               = startY + capAscent · capFontSize
 *
 * For this to equal body line N's baseline (targetBaseline measured from startY):
 *
 *   capAscent · capFontSize = targetBaseline
 *   capFontSize = targetBaseline / capAscent
 *
 * Substituting targetBaseline = (N−1)·uniformBodyLH + vOffset_body + bodyAscent·bodyFontSize:
 *
 *   capFontSize = ((N−1)·uniformBodyLH + vOffset_body + bodyAscent·bodyFontSize) / capAscent
 *
 * Returns { capFontSize, uniformBodyLH, vOffsetBody } so the call site can compute
 * the drop cap line offset without recomputing body metrics.
 */
function computeCapFontSize(
    lines: number,
    bodyFontSize: number,
    lineHeight: number,
    bodyAscentScale: number,
    bodyDescentScale: number,
    capAscentScale: number,
    capDescentScale: number,
): { capFontSize: number; uniformBodyLH: number; vOffsetBody: number } {
    const bodyExcess = Math.max(0, bodyAscentScale + bodyDescentScale - 1);
    const uniformBodyLH = (lineHeight + bodyExcess) * bodyFontSize;
    const vOffsetBody = (uniformBodyLH - bodyFontSize) / 2;

    // Distance from the body line box top to body line N baseline.
    const targetBaseline = (lines - 1) * uniformBodyLH + vOffsetBody + bodyAscentScale * bodyFontSize;
    const sizeByTop = targetBaseline / Math.max(0.01, capAscentScale);
    const availableBelow = Math.max(0, lines * uniformBodyLH - targetBaseline);
    const sizeByBottom = capDescentScale > 0 ? availableBelow / capDescentScale : sizeByTop;
    const capFontSize = Math.max(1, Math.min(sizeByTop, sizeByBottom));

    return { capFontSize, uniformBodyLH, vOffsetBody };
}

export class DropCapPackager implements PackagerUnit {
    private processor: LayoutProcessor;
    private element: Element;
    private index: number;
    private spec: DropCapSpec;

    private cachedParts: DropCapParts | null = null;
    private cachedAvailableWidth: number = -1;
    private requiredHeight: number = 0;

    get pageBreakBefore(): boolean | undefined {
        return this.cachedParts?.wrap.pageBreakBefore ?? false;
    }
    get keepWithNext(): boolean | undefined {
        return this.cachedParts?.wrap.keepWithNext ?? false;
    }

    constructor(processor: LayoutProcessor, element: Element, index: number, spec: DropCapSpec) {
        this.processor = processor;
        this.element = element;
        this.index = index;
        this.spec = spec;
    }

    private materialize(availableWidth: number, context: PackagerContext): void {
        if (this.cachedAvailableWidth === availableWidth && this.cachedParts) return;

        const baseFlow = (this.processor as any).shapeElement(this.element, { path: [this.index] }) as FlowBox;
        const text = (this.processor as any).getElementText(this.element) as string;

        // Extract the first `characters` grapheme clusters as the drop cap text.
        const charCount = Math.max(1, Math.floor(Number(this.spec.characters ?? 1)));
        const graphemes: string[] = Array.from(text || '');
        const capChars = graphemes.slice(0, charCount).join('');
        if (!capChars) {
            this.cachedParts = null;
            this.requiredHeight = 0;
            return;
        }
        const charUnitLength = capChars.length;

        const specLines = Number.isFinite(this.spec.lines) ? Math.max(1, Math.floor(Number(this.spec.lines))) : 3;
        const gap = Number.isFinite(this.spec.gap) ? Math.max(0, Number(this.spec.gap)) : 6;
        const characterStyle = this.spec.characterStyle || {};

        // Resolve body font metrics.
        const bodyFontSize = Number(baseFlow.style.fontSize || (this.processor as any).config.layout.fontSize);
        const lineHeight = Number(baseFlow.style.lineHeight || (this.processor as any).config.layout.lineHeight);

        const bodyFontFamily = baseFlow.style.fontFamily || (this.processor as any).config.layout.fontFamily;
        const bodyFontWeight = baseFlow.style.fontWeight ?? 400;
        const bodyFontStyle = baseFlow.style.fontStyle ?? 'normal';
        let bodyFont: any;
        try {
            bodyFont = (this.processor as any).resolveLoadedFamilyFont(bodyFontFamily, bodyFontWeight, bodyFontStyle);
        } catch {
            bodyFont = (this.processor as any).font;
        }
        const { ascentScale: bodyAscentScale, descentScale: bodyDescentScale } = resolveFontMetricScales(bodyFont);

        // Resolve cap font metrics (may differ when characterStyle.fontFamily is set).
        const capFontFamily = String(characterStyle.fontFamily || bodyFontFamily);
        const capFontWeight = characterStyle.fontWeight ?? bodyFontWeight;
        const capFontStyle = characterStyle.fontStyle ?? bodyFontStyle;
        let capFont: any;
        try {
            capFont = (this.processor as any).resolveLoadedFamilyFont(capFontFamily, capFontWeight, capFontStyle);
        } catch {
            capFont = bodyFont;
        }
        const { ascentScale: capAscentScale, descentScale: capDescentScale } = resolveFontMetricScales(capFont);
        const glyphMetrics = resolveGlyphMetricScales(capFont, capChars);
        const capAscentScaleEffective = glyphMetrics?.ascentScale ?? capAscentScale;
        const capDescentScaleEffective = glyphMetrics?.descentScale ?? capDescentScale;

        // Derive cap font size, uniform body line height, and vOffset_body.
        // See computeCapFontSize for the full derivation.
        const { capFontSize, uniformBodyLH } = computeCapFontSize(
            specLines,
            bodyFontSize,
            lineHeight,
            bodyAscentScale,
            bodyDescentScale,
            capAscentScaleEffective,
            capDescentScaleEffective,
        );

        // Build the drop cap style, inheriting from the paragraph then overlaying
        // only the properties that the character style explicitly sets.
        // lineHeight:1 is intentional — with no nominal lead the renderer's maxTopY
        // clamp fires unconditionally, pinning finalY to lineTopY. We set _lineYOffsets
        // below so lineTopY = startY, aligning the glyph top with the drop cap box top
        // while keeping the baseline on line N.
        const dropCapStyle: ElementStyle = {
            ...baseFlow.style,
            ...characterStyle,
            fontSize: capFontSize,
            lineHeight: 1,
            marginTop: 0,
            marginBottom: 0,
            paddingTop: LayoutUtils.validateUnit(characterStyle.paddingTop ?? characterStyle.padding ?? 0),
            paddingBottom: LayoutUtils.validateUnit(characterStyle.paddingBottom ?? characterStyle.padding ?? 0),
            paddingLeft: LayoutUtils.validateUnit(characterStyle.paddingLeft ?? characterStyle.padding ?? 0),
            paddingRight: LayoutUtils.validateUnit(characterStyle.paddingRight ?? characterStyle.padding ?? 0),
        };

        const dropCapElement: Element = {
            type: 'dropcap',
            content: capChars,
            properties: { style: dropCapStyle },
        };

        const dropCapFlow = (this.processor as any).shapeElement(dropCapElement, {
            path: [this.index, 0],
            sourceId: `${baseFlow.meta.sourceId}:dropcap`,
            engineKey: `${baseFlow.meta.engineKey}:dropcap`,
            sourceType: 'dropcap',
            semanticRole: baseFlow.meta.semanticRole,
            reflowKey: baseFlow.meta.reflowKey,
            fragmentIndex: 0,
            isContinuation: false,
        }) as FlowBox;

        (this.processor as any).materializeFlowBox(dropCapFlow, {
            pageIndex: 0,
            cursorY: 0,
            contentWidth: availableWidth,
        });

        // Align segment ascent/descent to glyph bounds so rendering clamps
        // match the actual ink box (prevents dropcap overflow).
        if (Array.isArray(dropCapFlow.lines)) {
            const segAscent = capAscentScaleEffective * 1000;
            const segDescent = capDescentScaleEffective * 1000;
            for (const line of dropCapFlow.lines) {
                if (!Array.isArray(line)) continue;
                for (const seg of line) {
                    if (seg && !seg.inlineObject) {
                        seg.ascent = segAscent;
                        seg.descent = segDescent;
                        // Force renderer to use text drawing instead of per-glyph offsets.
                        // This keeps the cap ink aligned to the computed ascent/descent box.
                        seg.glyphs = undefined;
                    }
                }
            }
        }

        // Pin the cap line to the top of the drop cap box. The renderer's maxTopY
        // clamp (lineHeight:1 ensures maxTopY = lineTopY) then pins finalY = lineTopY = startY.
        dropCapFlow.properties = { ...(dropCapFlow.properties || {}), _lineYOffsets: [0] };

        // Clamp the block height to exactly N body lines, eliminating the excess
        // that comes from the cap font's natural (ascent+descent) > 1em ink height.
        dropCapFlow.measuredContentHeight = specLines * uniformBodyLH;

        // Measure the natural rendered width of the cap glyph(s).
        let dropCapWidth = Number.isFinite(dropCapFlow.measuredWidth)
            ? Math.max(0, Number(dropCapFlow.measuredWidth))
            : 0;
        if (!dropCapWidth && Array.isArray(dropCapFlow.lines) && dropCapFlow.lines.length > 0) {
            const firstLine = dropCapFlow.lines[0] || [];
            const lineWidth = firstLine.reduce((sum, seg: any) => sum + Number(seg.width || 0), 0);
            const insets = LayoutUtils.getHorizontalInsets(dropCapFlow.style);
            dropCapWidth = Math.max(0, lineWidth + insets);
        }
        if (!dropCapWidth) {
            dropCapWidth = LayoutUtils.getBoxWidth((this.processor as any).config, dropCapFlow.style);
        }

        const dropCapHeight = Math.max(0, dropCapFlow.measuredContentHeight);

        const wrapOffsetX = dropCapWidth + gap;
        const wrapContentWidth = availableWidth - wrapOffsetX;
        const minWrapWidth = Math.max(24, bodyFontSize * 2);

        if (!Number.isFinite(wrapContentWidth) || wrapContentWidth < minWrapWidth || dropCapHeight <= 0) {
            this.cachedParts = null;
            this.requiredHeight = 0;
            return;
        }

        // Build remaining element (text after the cap characters).
        let remainingElement: Element;
        if (Array.isArray(this.element.children) && this.element.children.length > 0) {
            const children = (this.processor as any).sliceElements(this.element.children, charUnitLength, text.length);
            remainingElement = {
                ...this.element,
                type: this.element.type,
                content: '',
                children,
            };
        } else {
            remainingElement = {
                ...this.element,
                type: this.element.type,
                content: text.slice(charUnitLength),
            };
        }

        remainingElement = (this.processor as any).trimLeadingContinuationWhitespace(remainingElement) as Element;

        const wrapLinesResult = (this.processor as any).resolveLines(remainingElement, baseFlow.style, bodyFontSize, {
            pageIndex: 0,
            cursorY: 0,
            contentWidth: wrapContentWidth,
        });

        const wrapLines = wrapLinesResult.lines || [];
        if (wrapLines.length === 0) {
            this.cachedParts = null;
            this.requiredHeight = 0;
            return;
        }

        // Find how many wrap lines fit beside the cap. The formula guarantees
        // exactly specLines will fit, but we guard against edge cases.
        const verticalInsets = LayoutUtils.getVerticalInsets(baseFlow.style);
        let maxLinesFit = 0;
        for (let count = 1; count <= wrapLines.length; count += 1) {
            const candidateLines = wrapLines.slice(0, count);
            const candidateHeight = (this.processor as any).calculateLineBlockHeight(
                candidateLines,
                baseFlow.style,
                wrapLinesResult.lineYOffsets?.slice(0, count),
            );
            if (candidateHeight + verticalInsets <= dropCapHeight + LAYOUT_DEFAULTS.wrapTolerance) {
                maxLinesFit = count;
                continue;
            }
            break;
        }

        if (maxLinesFit <= 0) {
            this.cachedParts = null;
            this.requiredHeight = 0;
            return;
        }

        const linesA = wrapLines.slice(0, maxLinesFit);
        const renderedTextA = (this.processor as any).getJoinedLineText(linesA);
        const remainingText = (this.processor as any).getElementText(remainingElement);
        const consumedNow = (this.processor as any).resolveConsumedSourceChars(remainingText, renderedTextA);

        const remainingChars = Math.max(0, remainingText.length - consumedNow);
        let elementB: Element | null = null;
        if (remainingChars > 0) {
            if (Array.isArray(remainingElement.children) && remainingElement.children.length > 0) {
                elementB = {
                    ...remainingElement,
                    type: remainingElement.type,
                    content: '',
                    children: (this.processor as any).sliceElements(
                        remainingElement.children,
                        consumedNow,
                        consumedNow + remainingChars,
                    ),
                };
            } else {
                elementB = {
                    ...remainingElement,
                    type: remainingElement.type,
                    content: (this.processor as any).getElementText(remainingElement).slice(consumedNow),
                };
            }
            elementB = (this.processor as any).trimLeadingContinuationWhitespace(elementB);
        }

        const wrapStyle: ElementStyle = elementB
            ? { ...baseFlow.style, borderBottomWidth: 0, paddingBottom: 0, marginBottom: 0 }
            : { ...baseFlow.style };

        const wrapMeta = {
            ...baseFlow.meta,
            isContinuation: baseFlow.meta.isContinuation || baseFlow.meta.fragmentIndex > 0,
            pageIndex: undefined,
        };
        const wrapProps = {
            ...baseFlow.properties,
            _isFirstLine: true,
            _isLastLine: !elementB,
        };

        const wrapFlow = (this.processor as any).rebuildFlowBox(
            baseFlow,
            linesA,
            wrapStyle,
            wrapMeta,
            wrapProps,
        ) as FlowBox;
        wrapFlow.measuredWidth = wrapContentWidth + LayoutUtils.getHorizontalInsets(wrapStyle);
        if (elementB) wrapFlow.marginBottom = 0;

        let bodyFlow: FlowBox | null = null;
        if (elementB && (this.processor as any).getElementText(elementB)) {
            const bodyStyle: ElementStyle = {
                ...baseFlow.style,
                borderTopWidth: 0,
                paddingTop: 0,
                marginTop: 0,
                textIndent: 0,
            };
            const bodyLinesResult = (this.processor as any).resolveLines(elementB, bodyStyle, bodyFontSize, {
                pageIndex: 0,
                cursorY: 0,
                contentWidth: availableWidth,
            });
            if (bodyLinesResult.lines && bodyLinesResult.lines.length > 0) {
                const bodyMeta = {
                    ...baseFlow.meta,
                    fragmentIndex: baseFlow.meta.fragmentIndex + 1,
                    isContinuation: true,
                    pageIndex: undefined,
                };
                const bodyProps = { ...baseFlow.properties, _isFirstLine: false, _isLastLine: true };
                bodyFlow = (this.processor as any).rebuildFlowBox(
                    baseFlow,
                    bodyLinesResult.lines,
                    bodyStyle,
                    bodyMeta,
                    bodyProps,
                ) as FlowBox;
                bodyFlow.marginTop = 0;
            }
        }

        const unifiedLayoutBefore = Math.max(Math.max(0, dropCapFlow.marginTop), Math.max(0, wrapFlow.marginTop));

        const capHeight = Math.max(0, dropCapFlow.measuredContentHeight);
        const wrapHeight = Math.max(0, wrapFlow.measuredContentHeight);
        let required = unifiedLayoutBefore + Math.max(capHeight, wrapHeight);
        if (bodyFlow) {
            required += Math.max(0, bodyFlow.measuredContentHeight) + Math.max(0, bodyFlow.marginBottom);
        } else {
            required += Math.max(dropCapFlow.marginBottom || 0, wrapFlow.marginBottom || 0);
        }

        this.cachedParts = {
            dropCap: dropCapFlow,
            wrap: wrapFlow,
            body: bodyFlow,
            wrapOffsetX,
            unifiedLayoutBefore,
        };
        this.cachedAvailableWidth = availableWidth;
        this.requiredHeight = required;
    }

    emitBoxes(availableWidth: number, availableHeight: number, context: PackagerContext): LayoutBox[] | null {
        this.materialize(availableWidth, context);
        if (!this.cachedParts) {
            const fallback = new FlowBoxPackager(
                this.processor,
                (this.processor as any).shapeElement(this.element, { path: [this.index] }),
            );
            return fallback.emitBoxes(availableWidth, availableHeight, context) as LayoutBox[];
        }

        const fragment = new DropCapFragmentPackager(
            this.processor,
            this.cachedParts.dropCap,
            this.cachedParts.wrap,
            this.cachedParts.body,
            this.cachedParts.wrapOffsetX,
            this.cachedParts.unifiedLayoutBefore,
        );
        return fragment.emitBoxes(availableWidth, availableHeight, context);
    }

    split(availableHeight: number, context: PackagerContext): [PackagerUnit | null, PackagerUnit | null] {
        if (this.isUnbreakable(availableHeight)) {
            return [null, this];
        }
        this.materialize(this.cachedAvailableWidth, context);
        if (!this.cachedParts) {
            return [null, this];
        }

        const { dropCap, wrap, body, wrapOffsetX, unifiedLayoutBefore } = this.cachedParts;
        const capHeight = Math.max(0, dropCap.measuredContentHeight);
        const wrapHeight = Math.max(0, wrap.measuredContentHeight);
        const firstBlockHeight = unifiedLayoutBefore + Math.max(capHeight, wrapHeight);

        if (availableHeight <= firstBlockHeight + LAYOUT_DEFAULTS.wrapTolerance) {
            return [null, this];
        }

        if (!body) {
            return [null, this];
        }

        const splitAvailable = availableHeight - firstBlockHeight;
        const splitResult = (this.processor as any).splitFlowBox(body, splitAvailable, 0);
        if (!splitResult) {
            return [null, this];
        }

        const partA = splitResult.partA as FlowBox;
        const partB = splitResult.partB as FlowBox;
        const fitsCurrent = new DropCapFragmentPackager(
            this.processor,
            dropCap,
            wrap,
            partA,
            wrapOffsetX,
            unifiedLayoutBefore,
        );
        const pushedNext = new FlowBoxPackager(this.processor, partB);
        return [fitsCurrent, pushedNext];
    }

    getRequiredHeight(): number {
        return this.requiredHeight;
    }

    isUnbreakable(_availableHeight: number): boolean {
        const flowBox = (this.processor as any).shapeElement(this.element, { path: [this.index] }) as FlowBox;
        if (!flowBox.allowLineSplit) return true;
        if (flowBox.overflowPolicy === 'move-whole') return true;
        return false;
    }

    getMarginTop(): number {
        if (this.cachedParts) return this.cachedParts.wrap.marginTop;
        const flowBox = (this.processor as any).shapeElement(this.element, { path: [this.index] }) as FlowBox;
        return flowBox.marginTop || 0;
    }

    getMarginBottom(): number {
        if (this.cachedParts) {
            return this.cachedParts.body
                ? Math.max(0, this.cachedParts.body.marginBottom)
                : Math.max(0, this.cachedParts.wrap.marginBottom || 0);
        }
        const flowBox = (this.processor as any).shapeElement(this.element, { path: [this.index] }) as FlowBox;
        return flowBox.marginBottom || 0;
    }
}
