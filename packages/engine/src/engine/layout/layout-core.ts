import { TextProcessor } from './text-processor';
import { LayoutUtils } from './layout-utils';
import { Box, BoxImagePayload, BoxMeta, Element, ElementStyle, OverflowPolicy, Page, RichLine } from '../types';
import { getCachedFont } from '../../font-management/font-cache-loader';
import { LAYOUT_DEFAULTS } from './defaults';
import { parseEmbeddedImagePayloadCached } from '../image-data';
import {
    ContinuationArtifacts,
    FlowBox,
    FlowIdentitySeed,
    FlowMaterializationContext,
    ResolvedLinesResult,
} from './layout-core-types';
import { getContinuationArtifactsWithCallbacks, splitFlowBoxWithCallbacks } from './layout-flow-splitting';
import { finalizePagesWithCallbacks } from './layout-page-finalization';
import {
    buildTableModel,
    isTableElement,
    materializeTableFlowBox,
    positionTableFlowBoxes,
    splitTableFlowBox,
    TableLayoutContext,
} from './layout-table';
import { DropCapPackager } from './packagers/dropcap-packager';
import { createPackagers } from './packagers/create-packagers';
import { paginatePackagers } from './packagers/paginate-packagers';

export class LayoutProcessor extends TextProcessor {
    private normalizeOverflowPolicy(value: unknown): OverflowPolicy {
        if (value === undefined || value === null || value === '') return LAYOUT_DEFAULTS.overflowPolicy;
        if (value === 'clip' || value === 'move-whole' || value === 'error') return value;
        throw new Error(
            `[LayoutProcessor] Invalid overflowPolicy "${String(value)}". Expected "clip", "move-whole", or "error".`,
        );
    }

    private normalizeLineConstraint(value: number, fallback: number = LAYOUT_DEFAULTS.orphans): number {
        const numeric = Number.isFinite(value) ? value : fallback;
        return Math.max(1, Math.floor(numeric));
    }

    private createFlowMaterializationContext(
        pageIndex: number,
        cursorY: number,
        _pageWidth: number,
    ): FlowMaterializationContext {
        return {
            pageIndex,
            cursorY,
        };
    }

    private getMaterializationContextKey(unit: FlowBox, context?: FlowMaterializationContext): string {
        if (!context) return 'default';
        const top = Number(context.cursorY).toFixed(3);
        const widthKey = Number.isFinite(context.contentWidth) ? Number(context.contentWidth).toFixed(3) : 'auto';
        return `${context.pageIndex}:${top}:${unit.type}:${widthKey}`;
    }

    private getContextualContentWidth(
        style: ElementStyle,
        _context: FlowMaterializationContext | undefined,
        _fontSize: number,
        _lineHeight: number,
    ): number {
        if (_context && Number.isFinite(_context.contentWidth)) {
            return Math.max(0, Number(_context.contentWidth));
        }
        return this.getContentWidth(style);
    }

    private normalizeElementStyle(
        style: ElementStyle,
        overrides: {
            fontSize: number;
            lineHeight: number;
        },
    ): ElementStyle {
        return {
            ...style,
            fontSize: overrides.fontSize,
            lineHeight: overrides.lineHeight,
            paddingTop: LayoutUtils.validateUnit(style.paddingTop ?? style.padding ?? 0),
            paddingLeft: LayoutUtils.validateUnit(style.paddingLeft ?? style.padding ?? 0),
            paddingRight: LayoutUtils.validateUnit(style.paddingRight ?? style.padding ?? 0),
            paddingBottom: LayoutUtils.validateUnit(style.paddingBottom ?? style.padding ?? 0),
            borderTopWidth: LayoutUtils.validateUnit(style.borderTopWidth ?? style.borderWidth ?? 0),
            borderLeftWidth: LayoutUtils.validateUnit(style.borderLeftWidth ?? style.borderWidth ?? 0),
            borderRightWidth: LayoutUtils.validateUnit(style.borderRightWidth ?? style.borderWidth ?? 0),
            borderBottomWidth: LayoutUtils.validateUnit(style.borderBottomWidth ?? style.borderWidth ?? 0),
            letterSpacing: LayoutUtils.validateUnit(style.letterSpacing || 0),
            textIndent: LayoutUtils.validateUnit(style.textIndent || 0),
            zIndex: style.zIndex !== undefined ? LayoutUtils.validateUnit(style.zIndex) : undefined,
            lang: style.lang || this.config.layout.lang || LAYOUT_DEFAULTS.textLayout.lang,
            direction: style.direction || this.config.layout.direction || LAYOUT_DEFAULTS.textLayout.direction,
            hyphenation: style.hyphenation || this.config.layout.hyphenation || LAYOUT_DEFAULTS.textLayout.hyphenation,
            hyphenateCaps:
                style.hyphenateCaps ?? this.config.layout.hyphenateCaps ?? LAYOUT_DEFAULTS.textLayout.hyphenateCaps,
            hyphenMinWordLength: Number(
                style.hyphenMinWordLength ??
                    this.config.layout.hyphenMinWordLength ??
                    LAYOUT_DEFAULTS.textLayout.hyphenMinWordLength,
            ),
            hyphenMinPrefix: Number(
                style.hyphenMinPrefix ??
                    this.config.layout.hyphenMinPrefix ??
                    LAYOUT_DEFAULTS.textLayout.hyphenMinPrefix,
            ),
            hyphenMinSuffix: Number(
                style.hyphenMinSuffix ??
                    this.config.layout.hyphenMinSuffix ??
                    LAYOUT_DEFAULTS.textLayout.hyphenMinSuffix,
            ),
            justifyEngine:
                style.justifyEngine || this.config.layout.justifyEngine || LAYOUT_DEFAULTS.textLayout.justifyEngine,
            justifyStrategy:
                style.justifyStrategy ||
                this.config.layout.justifyStrategy ||
                LAYOUT_DEFAULTS.textLayout.justifyStrategy,
        };
    }

    private getTableLayoutContext(): TableLayoutContext {
        let tableDropCapIndex = 0;
        return {
            layoutFontSize: this.config.layout.fontSize,
            layoutLineHeight: this.config.layout.lineHeight,
            getStyle: (element) => this.getStyle(element),
            getElementText: (element) => this.getElementText(element),
            resolveEmbeddedImage: (element) => this.resolveEmbeddedImage(element),
            resolveLines: (element, style, fontSize, context) => this.resolveLines(element, style, fontSize, context),
            calculateLineBlockHeight: (lines, style, lineYOffsets) =>
                this.calculateLineBlockHeight(lines, style, lineYOffsets),
            getHorizontalInsets: (style) => LayoutUtils.getHorizontalInsets(style),
            getVerticalInsets: (style) => LayoutUtils.getVerticalInsets(style),
            getContextualBoxWidth: (style, context, fontSize, lineHeight) =>
                this.getContextualBoxWidth(style, context, fontSize, lineHeight),
            getBoxWidth: (style) => LayoutUtils.getBoxWidth(this.config, style),
            resolveMeasurementFontForStyle: (style) => this.resolveMeasurementFontForStyle(style),
            measureText: (text, font, fontSize, letterSpacing) => this.measureText(text, font, fontSize, letterSpacing),
            emitDropCapBoxes: (element, width, context) => {
                const spec = element.properties?.dropCap;
                if (!spec || spec.enabled === false) return null;
                const packager = new DropCapPackager(this, element, tableDropCapIndex++, spec);
                const pageDims = this.getPageDimensions();
                const packagerContext = {
                    processor: this,
                    pageIndex: context?.pageIndex ?? 0,
                    cursorY: context?.cursorY ?? 0,
                    margins: { top: 0, right: 0, bottom: 0, left: 0 },
                    pageWidth: Number.isFinite(width) ? Math.max(0, Number(width)) : pageDims.width,
                    pageHeight: pageDims.height,
                };
                return packager.emitBoxes(
                    Number.isFinite(width) ? Math.max(0, Number(width)) : pageDims.width,
                    Number.POSITIVE_INFINITY,
                    packagerContext,
                ) as any;
            },
        };
    }

    private resolveMeasurementFontForStyle(style: ElementStyle): any {
        if (!style.fontFamily) return this.font;
        try {
            return this.resolveLoadedFamilyFont(style.fontFamily, style.fontWeight ?? 400, style.fontStyle ?? 'normal');
        } catch {
            return this.font;
        }
    }

    private getContextualBoxWidth(
        style: ElementStyle,
        context: FlowMaterializationContext | undefined,
        fontSize: number,
        lineHeight: number,
    ): number {
        if (style.width !== undefined) {
            return Math.max(0, LayoutUtils.validateUnit(style.width));
        }

        if (!context) {
            return Math.max(0, LayoutUtils.getBoxWidth(this.config, style));
        }

        const contentWidth = this.getContextualContentWidth(style, context, fontSize, lineHeight);
        return Math.max(0, contentWidth + LayoutUtils.getHorizontalInsets(style));
    }

    private getUniformLineHeight(lines: RichLine[], style: ElementStyle): number {
        if (!lines || lines.length === 0) return 0;
        const totalHeight = this.calculateLinesHeight(lines, style);
        return totalHeight > 0 ? totalHeight / lines.length : 0;
    }

    private calculateLineBlockHeight(lines: RichLine[], style: ElementStyle, lineYOffsets?: number[]): number {
        if (!lines || lines.length === 0) return 0;
        const uniformLineHeight = this.getUniformLineHeight(lines, style);
        if (!Array.isArray(lineYOffsets) || lineYOffsets.length === 0 || uniformLineHeight <= 0) {
            return this.calculateLinesHeight(lines, style);
        }

        let maxBottom = 0;
        for (let idx = 0; idx < lines.length; idx++) {
            const candidate = lineYOffsets[idx];
            const yOffset = Number.isFinite(candidate) ? Math.max(0, Number(candidate)) : 0;
            const bottom = yOffset + uniformLineHeight;
            if (bottom > maxBottom) maxBottom = bottom;
        }
        return maxBottom;
    }

    private getJoinedLineText(lines: RichLine[]): string {
        return lines.map((line) => line.map((seg) => seg.text || '').join('')).join('');
    }

    private trimLeadingContinuationWhitespace(element: Element): Element {
        const text = this.getElementText(element);
        const match = text.match(/^[ \t\r\n\f\v]+/);
        if (!match || match[0].length === 0) return element;
        const trimCount = match[0].length;
        const remainingLength = Math.max(0, text.length - trimCount);

        if (Array.isArray(element.children) && element.children.length > 0) {
            return {
                ...element,
                content: '',
                children: this.sliceElements(element.children, trimCount, trimCount + remainingLength),
            };
        }

        return {
            ...element,
            content: text.slice(trimCount),
        };
    }

    private resolveConsumedSourceChars(sourceText: string, renderedText: string): number {
        if (!sourceText || !renderedText) return 0;
        let sourceIndex = 0;
        let renderedIndex = 0;

        while (renderedIndex < renderedText.length && sourceIndex < sourceText.length) {
            const renderedChar = renderedText[renderedIndex];
            const sourceChar = sourceText[sourceIndex];

            if (renderedChar === sourceChar) {
                renderedIndex += 1;
                sourceIndex += 1;
                continue;
            }

            // Soft hyphen can exist in source but may not materialize in rendered text.
            if (sourceChar === '\u00AD') {
                sourceIndex += 1;
                continue;
            }

            // Discretionary hyphen can be inserted by layout although not present in source.
            if ((renderedChar === '-' || renderedChar === '\u2010') && sourceChar !== '-') {
                renderedIndex += 1;
                continue;
            }

            // Normalize whitespace runs conservatively.
            if (/\s/.test(renderedChar) && /\s/.test(sourceChar)) {
                while (renderedIndex < renderedText.length && /\s/.test(renderedText[renderedIndex]))
                    renderedIndex += 1;
                while (sourceIndex < sourceText.length && /\s/.test(sourceText[sourceIndex])) sourceIndex += 1;
                continue;
            }

            // Defensive single-character drift recovery.
            if (sourceIndex + 1 < sourceText.length && sourceText[sourceIndex + 1] === renderedChar) {
                sourceIndex += 1;
                continue;
            }
            if (renderedIndex + 1 < renderedText.length && renderedText[renderedIndex + 1] === sourceChar) {
                renderedIndex += 1;
                continue;
            }

            renderedIndex += 1;
            sourceIndex += 1;
        }

        return Math.max(0, Math.min(sourceText.length, sourceIndex));
    }

    private normalizeReflowKey(value: unknown): string | null {
        if (typeof value === 'string') {
            const trimmed = value.trim();
            return trimmed.length > 0 ? trimmed : null;
        }
        if (typeof value === 'number' && Number.isFinite(value)) {
            return String(value);
        }
        return null;
    }

    private sanitizePath(path?: number[]): number[] {
        if (!Array.isArray(path) || path.length === 0) return [0];
        return path.map((n) => Math.max(0, Math.floor(Number(n) || 0)));
    }

    private buildAutoSourceId(path: number[], sourceType: string): string {
        return `auto:e/${path.join('/')}:${sourceType}`;
    }

    private buildEngineKey(path: number[], sourceType: string): string {
        return `ek:e/${path.join('/')}:${sourceType}`;
    }

    private buildReflowKey(path: number[], sourceType: string): string {
        return `rk:e/${path.join('/')}:${sourceType}`;
    }

    private buildFlowBoxMeta(element: Element, seed?: FlowIdentitySeed): BoxMeta {
        const path = this.sanitizePath(seed?.path);
        const sourceType = String(seed?.sourceType || element.type || 'node').trim() || 'node';
        const explicitSourceId =
            LayoutUtils.normalizeAuthorSourceId(seed?.sourceId) ||
            LayoutUtils.normalizeAuthorSourceId(element.properties?.sourceId);

        const sourceId = explicitSourceId || this.buildAutoSourceId(path, sourceType);
        const engineKey =
            typeof seed?.engineKey === 'string' && seed.engineKey.trim()
                ? seed.engineKey.trim()
                : this.buildEngineKey(path, sourceType);
        const explicitReflowKey = this.normalizeReflowKey(seed?.reflowKey ?? element.properties?.reflowKey);
        const reflowKey = explicitReflowKey || this.buildReflowKey(path, sourceType);
        const semanticRole =
            typeof seed?.semanticRole === 'string' && seed.semanticRole.trim()
                ? seed.semanticRole.trim()
                : typeof element.properties?.semanticRole === 'string' && element.properties.semanticRole.trim()
                  ? element.properties.semanticRole.trim()
                  : undefined;
        const fragmentIndex = Math.max(0, Math.floor(Number(seed?.fragmentIndex ?? 0)));
        const continuation = seed?.isContinuation ?? fragmentIndex > 0;

        const meta: BoxMeta = {
            sourceId,
            engineKey,
            sourceType,
            semanticRole,
            fragmentIndex,
            isContinuation: continuation,
            generated: !!seed?.generated,
            originSourceId: seed?.originSourceId,
        };

        if (reflowKey) meta.reflowKey = reflowKey;

        return meta;
    }

    private getContinuationArtifacts(box: FlowBox): ContinuationArtifacts {
        return getContinuationArtifactsWithCallbacks(box, {
            shapeElement: (element, identitySeed) => this.shapeElement(element, identitySeed),
            materializeFlowBox: (unit) => this.materializeFlowBox(unit),
            normalizeAuthorSourceId: (value) => LayoutUtils.normalizeAuthorSourceId(value),
        });
    }

    /**
     * Canonical flat pipeline:
     * input elements -> flow boxes -> paginated flow boxes -> positioned page boxes.
     */
    paginate(elements: Element[]): Page[] {
        const packagers = createPackagers(elements, this);
        const { height: pageHeight, width: pageWidth } = this.getPageDimensions();
        const contextBase = {
            processor: this,
            pageWidth,
            pageHeight,
            margins: this.config.layout.margins,
        };
        const pages = paginatePackagers(this, packagers, contextBase);
        return this.finalizePages(pages);
    }

    private shapeTableElement(element: Element, identitySeed?: FlowIdentitySeed): FlowBox {
        const style = this.getStyle(element);
        const meta = this.buildFlowBoxMeta(element, identitySeed);
        const fontSize = Number(style.fontSize || this.config.layout.fontSize);
        const lineHeight = Number(style.lineHeight || this.config.layout.lineHeight);
        const marginTop = LayoutUtils.validateUnit(element.properties?.marginTop ?? style.marginTop ?? 0);
        const marginBottom = LayoutUtils.validateUnit(element.properties?.marginBottom ?? style.marginBottom ?? 0);
        const model = buildTableModel(element);
        const normalizedStyle = this.normalizeElementStyle(style, {
            fontSize,
            lineHeight,
        });

        return {
            type: element.type,
            meta,
            style: normalizedStyle,
            lines: Array.from({ length: Math.max(1, model.rowIndices.length) }, () => []),
            properties: {
                ...(element.properties || {}),
                _tableModel: model,
                _isFirstLine: true,
                _isLastLine: true,
                _isFirstFragmentInLine: true,
                _isLastFragmentInLine: true,
            },
            marginTop,
            marginBottom,
            keepWithNext: !!(element.properties?.keepWithNext || style.keepWithNext),
            pageBreakBefore: !!style.pageBreakBefore,
            allowLineSplit: model.rowIndices.length > 1,
            overflowPolicy: this.normalizeOverflowPolicy(style.overflowPolicy),
            orphans: 1,
            widows: 1,
            measuredContentHeight: 0,
            heightOverride: style.height !== undefined ? LayoutUtils.validateUnit(style.height) : undefined,
            _materializationMode: 'reflowable',
            _sourceElement: element,
            _unresolvedElement: element,
        };
    }

    protected shapeElement(element: Element, identitySeed?: FlowIdentitySeed): FlowBox {
        if (!element) {
            console.error('shapeElement called with undefined element!', new Error().stack);
        }
        if (isTableElement(element)) {
            return this.shapeTableElement(element, identitySeed);
        }

        const style = this.getStyle(element);
        const meta = this.buildFlowBoxMeta(element, identitySeed);
        const fontSize = Number(style.fontSize || this.config.layout.fontSize);
        const lineHeight = Number(style.lineHeight || this.config.layout.lineHeight);

        const marginTop = LayoutUtils.validateUnit(element.properties?.marginTop ?? style.marginTop ?? 0);
        const marginBottom = LayoutUtils.validateUnit(element.properties?.marginBottom ?? style.marginBottom ?? 0);
        const hasEmbeddedImage = !!element.properties?.image;
        const allowLineSplit = hasEmbeddedImage ? false : style.allowLineSplit !== false;
        const normalizedStyle = this.normalizeElementStyle(style, {
            fontSize,
            lineHeight,
        });

        const heightOverride = style.height !== undefined ? LayoutUtils.validateUnit(style.height) : undefined;

        return {
            type: element.type,
            meta,
            style: normalizedStyle,
            lines: undefined,
            properties: {
                ...(element.properties || {}),
                _isFirstLine: true,
                _isLastLine: true,
                _isFirstFragmentInLine: true,
                _isLastFragmentInLine: true,
            },
            marginTop,
            marginBottom,
            keepWithNext: !!(element.properties?.keepWithNext || style.keepWithNext),
            pageBreakBefore: !!style.pageBreakBefore,
            allowLineSplit,
            overflowPolicy: this.normalizeOverflowPolicy(style.overflowPolicy),
            orphans: this.normalizeLineConstraint(
                LayoutUtils.validateUnit(style.orphans ?? LAYOUT_DEFAULTS.orphans),
                LAYOUT_DEFAULTS.orphans,
            ),
            widows: this.normalizeLineConstraint(
                LayoutUtils.validateUnit(style.widows ?? LAYOUT_DEFAULTS.widows),
                LAYOUT_DEFAULTS.widows,
            ),
            measuredContentHeight: heightOverride ?? 0,
            heightOverride,
            _materializationMode: 'reflowable',
            _sourceElement: element,
            _unresolvedElement: element,
        };
    }

    private resolveEmbeddedImage(element: Element): BoxImagePayload | undefined {
        const image = element.properties?.image;
        if (!image || typeof image !== 'object') return undefined;
        const parsed = parseEmbeddedImagePayloadCached(image);
        return {
            base64Data: parsed.base64Data,
            mimeType: parsed.mimeType,
            intrinsicWidth: parsed.intrinsicWidth,
            intrinsicHeight: parsed.intrinsicHeight,
            fit: parsed.fit,
        };
    }

    private materializeImageFlowBox(
        unit: FlowBox,
        element: Element,
        context: FlowMaterializationContext | undefined,
        fontSize: number,
        lineHeight: number,
    ): FlowBox {
        const resolvedImage = unit.image || this.resolveEmbeddedImage(element);
        if (!resolvedImage) return unit;

        const style = unit.style;
        const insetsHorizontal = LayoutUtils.getHorizontalInsets(style);
        const insetsVertical = LayoutUtils.getVerticalInsets(style);

        const contextualBoxWidth = this.getContextualBoxWidth(style, context, fontSize, lineHeight);
        const intrinsicBoxWidth = resolvedImage.intrinsicWidth + insetsHorizontal;
        let boxWidth =
            style.width !== undefined
                ? Math.max(0, LayoutUtils.validateUnit(style.width))
                : Math.min(
                      Math.max(insetsHorizontal, intrinsicBoxWidth),
                      Math.max(insetsHorizontal, contextualBoxWidth),
                  );

        if (!Number.isFinite(boxWidth) || boxWidth <= 0) {
            boxWidth = Math.max(insetsHorizontal, contextualBoxWidth || intrinsicBoxWidth);
        }

        const contentWidth = Math.max(0, boxWidth - insetsHorizontal);
        const explicitHeight =
            style.height !== undefined ? Math.max(0, LayoutUtils.validateUnit(style.height)) : undefined;
        const computedContentHeight =
            contentWidth > 0
                ? contentWidth * (resolvedImage.intrinsicHeight / Math.max(1, resolvedImage.intrinsicWidth))
                : 0;
        const measuredHeight =
            explicitHeight !== undefined
                ? explicitHeight
                : Math.max(insetsVertical, computedContentHeight + insetsVertical);

        unit.image = resolvedImage;
        unit.lines = undefined;
        unit.content = undefined;
        unit.glyphs = undefined;
        unit.ascent = undefined;
        unit.measuredWidth = boxWidth;
        unit.measuredContentHeight = unit.heightOverride ?? measuredHeight;
        delete unit.properties._lineOffsets;
        delete unit.properties._lineWidths;
        delete unit.properties._lineYOffsets;

        return unit;
    }

    protected materializeFlowBox(unit: FlowBox, context?: FlowMaterializationContext): FlowBox {
        const contextKey = this.getMaterializationContextKey(unit, context);
        const canRematerialize = unit._materializationMode === 'reflowable' && !!unit._sourceElement;
        if (!unit._unresolvedElement && (!canRematerialize || unit._materializationContextKey === contextKey))
            return unit;

        const element = unit._unresolvedElement || unit._sourceElement;
        if (!element) return unit;
        const style = unit.style;
        const fontSize = Number(style.fontSize || this.config.layout.fontSize);
        const lineHeight = Number(style.lineHeight || this.config.layout.lineHeight);

        if (isTableElement(element)) {
            materializeTableFlowBox(unit, element, context, fontSize, lineHeight, this.getTableLayoutContext());
            unit._materializationContextKey = contextKey;
            unit._unresolvedElement = undefined;
            return unit;
        }

        const maybeImage = unit.image || this.resolveEmbeddedImage(element);
        if (maybeImage) {
            unit.image = maybeImage;
            this.materializeImageFlowBox(unit, element, context, fontSize, lineHeight);
            unit._materializationContextKey = contextKey;
            unit._unresolvedElement = undefined;
            return unit;
        }

        unit.image = undefined;
        unit.measuredWidth = undefined;

        const resolved = this.resolveLines(element, style, fontSize, context);
        const lines = resolved.lines;
        let contentHeight = lines.length > 0 ? this.calculateLineBlockHeight(lines, style, resolved.lineYOffsets) : 0;

        const insetsVertical = LayoutUtils.getVerticalInsets(style);
        contentHeight += insetsVertical;

        const text = this.getElementText(element);
        if (contentHeight === 0 && text) {
            contentHeight = fontSize * lineHeight + LayoutUtils.getVerticalInsets(style);
        }

        unit.lines = lines.length > 0 ? lines : undefined;
        unit.measuredContentHeight = unit.heightOverride ?? contentHeight;
        if (resolved.lineOffsets && resolved.lineOffsets.length > 0) {
            unit.properties._lineOffsets = resolved.lineOffsets.slice();
        } else {
            delete unit.properties._lineOffsets;
        }
        if (resolved.lineWidths && resolved.lineWidths.length > 0) {
            unit.properties._lineWidths = resolved.lineWidths.slice();
        } else {
            delete unit.properties._lineWidths;
        }
        if (resolved.lineYOffsets && resolved.lineYOffsets.length > 0) {
            unit.properties._lineYOffsets = resolved.lineYOffsets.slice();
        } else {
            delete unit.properties._lineYOffsets;
        }
        unit._materializationContextKey = contextKey;
        unit._unresolvedElement = undefined; // Mark as resolved

        return unit;
    }

    protected resolveLines(
        element: Element,
        style: ElementStyle,
        fontSize: number,
        context?: FlowMaterializationContext,
    ): ResolvedLinesResult {
        const text = this.getElementText(element);
        if (!text) return { lines: [] };

        const lineHeight = Number(style.lineHeight || this.config.layout.lineHeight);
        const baseWidth = this.getContextualContentWidth(style, context, Number(fontSize), lineHeight);
        let measurementFont = this.font;

        if (style.fontFamily) {
            try {
                measurementFont = this.resolveLoadedFamilyFont(
                    style.fontFamily,
                    style.fontWeight ?? 400,
                    style.fontStyle ?? 'normal',
                );
            } catch {
                const fontConfig = LayoutUtils.resolveFontConfig(
                    style.fontFamily,
                    style.fontWeight,
                    style.fontStyle,
                    this.runtime.fontRegistry,
                    this.runtime.fontManager,
                );
                const cached = getCachedFont(fontConfig.src, this.runtime);
                if (cached) measurementFont = cached;
            }
        }

        const textIndent = Number(style.textIndent || 0);
        const letterSpacing = Number(style.letterSpacing || 0);
        const richSegments = this.getRichSegments(element, style);
        const wrapped = this.wrapRichSegments(
            richSegments,
            baseWidth,
            measurementFont,
            Number(fontSize),
            letterSpacing,
            textIndent,
            undefined,
            undefined,
        );
        return { lines: wrapped };
    }

    protected splitFlowBox(
        box: FlowBox,
        availableHeight: number,
        layoutBefore: number,
    ): { partA: FlowBox; partB: FlowBox } | null {
        if (box.properties?._tableModel) {
            return splitTableFlowBox(box, availableHeight, layoutBefore);
        }

        return splitFlowBoxWithCallbacks(
            {
                box,
                availableHeight,
                layoutBefore,
            },
            {
                normalizeLineConstraint: (value, fallback) => this.normalizeLineConstraint(value, fallback),
                calculateLineBlockHeight: (lines, style, lineYOffsets) =>
                    this.calculateLineBlockHeight(lines, style, lineYOffsets),
                rebuildFlowBox: (base, lines, style, meta, properties) =>
                    this.rebuildFlowBox(base, lines, style, meta, properties),
                getElementText: (element) => this.getElementText(element),
                getJoinedLineText: (lines) => this.getJoinedLineText(lines),
                resolveConsumedSourceChars: (sourceText, renderedText) =>
                    this.resolveConsumedSourceChars(sourceText, renderedText),
                sliceElements: (elements, start, end) => this.sliceElements(elements, start, end),
                trimLeadingContinuationWhitespace: (element) => this.trimLeadingContinuationWhitespace(element),
            },
        );
    }

    protected rebuildFlowBox(
        base: FlowBox,
        lines: RichLine[],
        style: ElementStyle,
        meta: BoxMeta,
        properties: Record<string, any>,
    ): FlowBox {
        const lineHeight = this.calculateLineBlockHeight(
            lines,
            style,
            Array.isArray(properties?._lineYOffsets) ? properties._lineYOffsets : undefined,
        );
        const insetsVertical = LayoutUtils.getVerticalInsets(style);
        const measuredContentHeight = lineHeight + insetsVertical;
        return {
            ...base,
            meta,
            style,
            lines,
            properties,
            measuredContentHeight,
            _materializationMode: 'frozen',
            _materializationContextKey: undefined,
            _unresolvedElement: undefined,
        };
    }

    protected positionFlowBox(
        unit: FlowBox,
        currentY: number,
        layoutBefore: number,
        margins: { left: number },
        _pageWidth: number,
        pageIndex: number,
    ): Box | Box[] {
        const style = unit.style;
        const glueOffset = LayoutUtils.validateUnit(unit.properties?._glueOffsetX ?? 0);
        const x = margins.left + LayoutUtils.validateUnit(style.marginLeft || 0) + glueOffset;
        const y = currentY + layoutBefore;
        const w = Number.isFinite(unit.measuredWidth)
            ? Math.max(0, Number(unit.measuredWidth))
            : LayoutUtils.getBoxWidth(this.config, style);
        const h = Math.max(0, unit.measuredContentHeight);

        if (unit.properties?._tableModel) {
            return positionTableFlowBoxes(unit, x, y, pageIndex, this.getTableLayoutContext());
        }

        return {
            type: unit.type,
            x,
            y,
            w,
            h,
            style,
            image: unit.image,
            lines: unit.lines,
            content: unit.content,
            glyphs: unit.glyphs,
            ascent: unit.ascent,
            properties: { ...unit.properties },
            meta: {
                ...unit.meta,
                pageIndex,
            },
        };
    }

    private finalizePages(pages: Page[]): Page[] {
        return finalizePagesWithCallbacks(pages, this.config, {
            resolveLoadedFamilyFont: (familyName, weight, style) =>
                this.resolveLoadedFamilyFont(familyName, weight, style),
            measureText: (text, font, fontSize, letterSpacing, populateSegment) =>
                this.measureText(text, font, fontSize, letterSpacing, populateSegment),
        });
    }
}
