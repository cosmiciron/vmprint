import { TextProcessor } from './text-processor';
import { LayoutUtils } from './layout-utils';
import { Box, BoxImagePayload, BoxMeta, Element, ElementStyle, OverflowPolicy, Page, PageRegionContent, RichLine, TextSegment } from '../types';
import type { SimulationProgressionConfig } from '../types';
import { LAYOUT_DEFAULTS } from './defaults';
import { parseEmbeddedImagePayloadCached } from '../image-data';
import {
    ContinuationArtifacts,
    FlowBox,
    FlowIdentitySeed,
    FlowMaterializationContext,
    ResolvedLinesResult
} from './layout-core-types';
import type { NormalizedFlowBlock } from './normalized-flow-block';
import { getContinuationArtifactsWithCallbacks, splitFlowBoxWithCallbacks } from './layout-flow-splitting';
import { ContinuationMarkerCollaborator } from './runtime/passes/continuation-marker-pass';
import { PageReservationCollaborator } from './runtime/passes/page-reservation-pass';
import { PageStartExclusionCollaborator } from './runtime/passes/page-start-exclusion-pass';
import { PageStartReservationCollaborator } from './runtime/passes/page-start-reservation-pass';
import { FragmentTransitionArtifactCollaborator } from './collaborators/fragment-transition-artifact-collaborator';
import { createMorphedBoxMeta, freezeFlowFragment } from './flow-fragment-state';
import { HeadingTelemetryCollaborator } from './collaborators/heading-telemetry-collaborator';
import { HeadingSignalCollaborator } from './runtime/signals/heading-signal-publisher';
import { PageRegionCollaborator } from './runtime/page-finalization/page-region-finalization';
import { PageNumberArtifactCollaborator } from './collaborators/page-number-artifact-collaborator';
import { PageOverrideArtifactCollaborator } from './collaborators/page-override-artifact-collaborator';
import { PageExclusionArtifactCollaborator } from './collaborators/page-exclusion-artifact-collaborator';
import { PageReservationArtifactCollaborator } from './collaborators/page-reservation-artifact-collaborator';
import { PageSpatialConstraintArtifactCollaborator } from './collaborators/page-spatial-constraint-artifact-collaborator';
import { PageRegionArtifactCollaborator } from './collaborators/page-region-artifact-collaborator';
import type { LayoutProfileMetrics } from './runtime/session/session-profile-types';
import type { Collaborator } from './runtime/session/session-runtime-types';
import { LayoutSession } from './layout-session';
import {
    createPrintPipelineSnapshot,
    createSimulationReportReader,
    PrintPipelineSnapshot,
    SimulationReport,
    SimulationReportReader
} from './simulation-report';
import { SourcePositionArtifactCollaborator } from './collaborators/source-position-artifact-collaborator';
import { ScriptRuntimeCollaborator } from './runtime/scripting/script-runtime-pass';
import { ScriptRuntimeHost } from './script-runtime-host';
import type { ScriptLifecycleState } from './script-runtime-host';
import { TransformCapabilityArtifactCollaborator } from './collaborators/transform-capability-artifact-collaborator';
import { TransformArtifactCollaborator } from './collaborators/transform-artifact-collaborator';
import { RegionDebugOverlayCollaborator } from './collaborators/region-debug-overlay-collaborator';
import { TemporalPresentationCollaborator } from './collaborators/temporal-presentation-collaborator';
import { AsyncThoughtRuntimeCollaborator } from './collaborators/async-thought-runtime-collaborator';
import { InteractionArtifactCollaborator } from './collaborators/interaction-artifact-collaborator';
import { ViewportCaptureArtifactCollaborator } from './collaborators/viewport-capture-artifact-collaborator';
import { AsyncThoughtHost } from './async-thought-host';
import {
    buildTableModel,
    isTableElement,
    materializeSpatialGridFlowBox,
    positionSpatialGridFlowBoxes,
    splitSpatialGridFlowBox,
    SpatialGridLayoutContext
} from './layout-table';
import { buildTableModelFromNormalizedTable, normalizeTableElement } from './normalized-table';
import { DropCapPackager } from './packagers/dropcap-packager';
import { createPackagers, ExternalPackagerFactory } from './packagers/create-packagers';
import { ScriptDocumentPackager } from './packagers/script-document-packager';
import { createSimulationMarchRunner, executeSimulationMarch, type SimulationRunner } from './packagers/execute-simulation-march';
import type { PackagerContext } from './packagers/packager-types';
import { SimulationLoop, type SimulationLoopOptions, type SimulationLoopScheduler } from './simulation-loop';


export class LayoutProcessor extends TextProcessor {
    private static readonly REGION_LAYOUT_HEIGHT = 1000000;
    private lastLayoutSession: LayoutSession | null = null;
    private activeScriptRuntimeHost: ScriptRuntimeHost | null = null;
    private packagerFactory: ExternalPackagerFactory | undefined = undefined;
    private resolvedLinesCache = new WeakMap<Element, Map<string, ResolvedLinesResult>>();
    private static readonly SCRIPT_PROFILE_KEYS: Array<keyof LayoutProfileMetrics> = [
        'handlerCalls',
        'handlerMs',
        'loadCalls',
        'loadMs',
        'createCalls',
        'createMs',
        'readyCalls',
        'readyMs',
        'replayRequests',
        'replayPasses',
        'docQueryCalls',
        'setContentCalls',
        'replaceCalls',
        'insertCalls',
        'removeCalls',
        'messageSendCalls',
        'messageHandlerCalls'
    ];

    setPackagerFactory(factory: ExternalPackagerFactory | undefined): void {
        this.packagerFactory = factory;
    }

    getActiveScriptRuntimeHost(): ScriptRuntimeHost | null {
        return this.activeScriptRuntimeHost;
    }

    getPackagerFactory(): ExternalPackagerFactory | undefined {
        return this.packagerFactory;
    }

    getSimulationProgressionConfig(): Required<SimulationProgressionConfig> {
        const configured = this.config.layout.progression;
        const policy = configured?.policy === 'fixed-tick-count'
            ? 'fixed-tick-count'
            : 'until-settled';
        const maxTicks = policy === 'fixed-tick-count'
            ? Math.max(1, Math.floor(Number(configured?.maxTicks || 1)))
            : 0;
        const tickRateHz = Math.max(1, Number(configured?.tickRateHz || 24));
        return { policy, maxTicks, tickRateHz };
    }

    private resolveSimulationProgressionOverride(
        options: { tickRateHz?: number } = {}
    ): Required<SimulationProgressionConfig> {
        const base = this.getSimulationProgressionConfig();
        const tickRateHz = Number.isFinite(options.tickRateHz)
            ? Math.max(1, Number(options.tickRateHz))
            : base.tickRateHz;
        if (base.policy !== 'fixed-tick-count' || !Number.isFinite(base.maxTicks) || base.maxTicks <= 0) {
            return {
                ...base,
                tickRateHz
            };
        }
        const baseDurationSeconds = base.maxTicks / base.tickRateHz;
        return {
            ...base,
            tickRateHz,
            maxTicks: Math.max(1, Math.round(baseDurationSeconds * tickRateHz))
        };
    }

    private cloneElementsForSimulation(elements: Element[]): Element[] {
        return structuredClone(elements) as Element[];
    }

    private elementTreeHasPhaseHandler(
        elements: Element[],
        predicate: (element: Element) => boolean
    ): boolean {
        const stack = [...elements];
        while (stack.length > 0) {
            const element = stack.pop();
            if (!element) continue;
            if (predicate(element)) return true;
            if (Array.isArray(element.children) && element.children.length > 0) {
                stack.push(...element.children);
            }
            if (Array.isArray(element.zones)) {
                for (const zone of element.zones) {
                    if (Array.isArray(zone.elements) && zone.elements.length > 0) {
                        stack.push(...zone.elements);
                    }
                }
            }
            if (Array.isArray(element.slots)) {
                for (const slot of element.slots) {
                    if (Array.isArray(slot.elements) && slot.elements.length > 0) {
                        stack.push(...slot.elements);
                    }
                }
            }
        }
        return false;
    }

    private requiresSimulationClone(
        elements: Element[],
        scriptRuntimeHost: ScriptRuntimeHost | null
    ): boolean {
        if (!scriptRuntimeHost) return false;

        const hasOnLoad = scriptRuntimeHost.getDocumentHandlerName('onLoad') !== null;
        if (hasOnLoad) return true;

        if (scriptRuntimeHost.hasDocumentAfterSettleHandler()) return true;

        return this.elementTreeHasPhaseHandler(elements, (element) => {
            const sourceId = typeof element.properties?.sourceId === 'string'
                ? element.properties.sourceId
                : null;
            const explicitHandlerName = typeof element.properties?.onResolve === 'string'
                ? element.properties.onResolve
                : null;
            return !!scriptRuntimeHost.getElementHandlerName(sourceId, 'onCreate', explicitHandlerName);
        });
    }

    private normalizeOverflowPolicy(value: unknown): OverflowPolicy {
        if (value === undefined || value === null || value === '') return LAYOUT_DEFAULTS.overflowPolicy;
        if (value === 'clip' || value === 'move-whole' || value === 'error') return value;
        throw new Error(`[LayoutProcessor] Invalid overflowPolicy "${String(value)}". Expected "clip", "move-whole", or "error".`);
    }

    private normalizeLineConstraint(value: number, fallback: number = LAYOUT_DEFAULTS.orphans): number {
        const numeric = Number.isFinite(value) ? value : fallback;
        return Math.max(1, Math.floor(numeric));
    }

    private createFlowMaterializationContext(
        pageIndex: number,
        cursorY: number,
        contentWidth: number,
        worldY?: number
    ): FlowMaterializationContext {
        // Only propagate contentWidth when it is a valid non-negative finite number.
        // Negative sentinel values (e.g. -1 = "unset") must not be propagated
        // because getContextualContentWidth treats any finite value as authoritative.
        const ctx: FlowMaterializationContext = {
            pageIndex,
            cursorY,
            ...(Number.isFinite(worldY) ? { worldY: Number(worldY) } : {})
        };
        if (Number.isFinite(contentWidth) && contentWidth >= 0) {
            ctx.contentWidth = contentWidth;
        }
        return ctx;
    }

    private getMaterializationContextKey(unit: FlowBox, context?: FlowMaterializationContext): string {
        if (!context) return 'default';
        const top = Number(context.cursorY).toFixed(3);
        const worldKey = Number.isFinite(context.worldY) ? Number(context.worldY).toFixed(3) : 'na';
        const widthKey = Number.isFinite(context.contentWidth) ? Number(context.contentWidth).toFixed(3) : 'auto';
        return `${context.pageIndex}:${top}:${worldKey}:${unit.type}:${widthKey}`;
    }

    private hashTextContent(text: string): string {
        let hash = 2166136261;
        for (let index = 0; index < text.length; index += 1) {
            hash ^= text.charCodeAt(index);
            hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
        }
        return `${text.length}:${(hash >>> 0).toString(36)}`;
    }

    private buildFlowResolveSignature(
        unit: FlowBox,
        element: Element,
        style: ElementStyle,
        fontSize: number,
        lineHeight: number,
        context?: FlowMaterializationContext
    ): string {
        const width = this.getContextualContentWidth(style, context, fontSize, lineHeight);
        const widthKey = Number.isFinite(width) ? Number(width).toFixed(3) : 'auto';
        const fontFamily = String(style.fontFamily || this.config.layout.fontFamily || '');
        const fontWeight = String(style.fontWeight ?? 400);
        const fontStyle = String(style.fontStyle || 'normal');
        const letterSpacing = Number(style.letterSpacing || 0).toFixed(3);
        const textIndent = Number(style.textIndent || 0).toFixed(3);
        const lang = String(style.lang || this.config.layout.lang || '');
        const direction = String(style.direction || this.config.layout.direction || '');
        const hyphenation = String(style.hyphenation || this.config.layout.hyphenation || '');
        const justifyEngine = String(style.justifyEngine || this.config.layout.justifyEngine || '');
        const reflowKey = unit.meta?.reflowKey || unit.meta?.sourceId || unit.meta?.engineKey || '';
        const textHash = this.hashTextContent(this.getElementText(element));
        return [
            reflowKey,
            unit.type,
            widthKey,
            fontFamily,
            fontWeight,
            fontStyle,
            Number(fontSize).toFixed(3),
            Number(lineHeight).toFixed(3),
            letterSpacing,
            textIndent,
            lang,
            direction,
            hyphenation,
            justifyEngine,
            textHash
        ].join('|');
    }

    private buildResolvedLinesCacheKey(
        element: Element,
        style: ElementStyle,
        fontSize: number,
        lineHeight: number,
        context?: FlowMaterializationContext
    ): string {
        const width = this.getContextualContentWidth(style, context, fontSize, lineHeight);
        const widthKey = Number.isFinite(width) ? Number(width).toFixed(3) : 'auto';
        const fontFamily = String(style.fontFamily || this.config.layout.fontFamily || '');
        const fontWeight = String(style.fontWeight ?? 400);
        const fontStyle = String(style.fontStyle || 'normal');
        const letterSpacing = Number(style.letterSpacing || 0).toFixed(3);
        const textIndent = Number(style.textIndent || 0).toFixed(3);
        const lang = String(style.lang || this.config.layout.lang || '');
        const direction = String(style.direction || this.config.layout.direction || '');
        const hyphenation = String(style.hyphenation || this.config.layout.hyphenation || '');
        const justifyEngine = String(style.justifyEngine || this.config.layout.justifyEngine || '');
        const textHash = this.hashTextContent(this.getElementText(element));
        return [
            widthKey,
            fontFamily,
            fontWeight,
            fontStyle,
            Number(fontSize).toFixed(3),
            Number(lineHeight).toFixed(3),
            letterSpacing,
            textIndent,
            lang,
            direction,
            hyphenation,
            justifyEngine,
            textHash
        ].join('|');
    }

    private cloneResolvedLinesResult(result: ResolvedLinesResult): ResolvedLinesResult {
        return {
            lines: result.lines.map((line) => line.map((segment) => ({
                ...segment,
                glyphs: Array.isArray(segment.glyphs)
                    ? this.cloneGlyphs(segment.glyphs)
                    : segment.glyphs,
                shapedGlyphs: Array.isArray(segment.shapedGlyphs)
                    ? segment.shapedGlyphs.map((glyph) => ({
                        ...glyph,
                        codePoints: Array.isArray(glyph.codePoints) ? [...glyph.codePoints] : glyph.codePoints
                    }))
                    : segment.shapedGlyphs,
                inlineMetrics: segment.inlineMetrics
                    ? { ...segment.inlineMetrics }
                    : segment.inlineMetrics
            }))),
            lineOffsets: result.lineOffsets?.slice(),
            lineWidths: result.lineWidths?.slice(),
            lineYOffsets: result.lineYOffsets?.slice()
        };
    }

    private getContextualContentWidth(
        style: ElementStyle,
        _context: FlowMaterializationContext | undefined,
        _fontSize: number,
        _lineHeight: number
    ): number {
        // style-based width: uses style.width when explicitly set, else falls back to
        // page content width minus margins and insets.
        const styleBasedWidth = this.getContentWidth(style);

        if (!(_context && Number.isFinite(_context.contentWidth))) {
            return styleBasedWidth;
        }

        // context.contentWidth is the available outer width from the surrounding
        // context (zone column, story column, etc.). Subtract element margins and
        // horizontal insets to derive the line-wrapping width.
        const marginLeft = LayoutUtils.validateUnit((style as any).marginLeft ?? 0);
        const marginRight = LayoutUtils.validateUnit((style as any).marginRight ?? 0);
        const insets = LayoutUtils.getHorizontalInsets(style);
        const contextWidth = Math.max(0, Number(_context.contentWidth) - marginLeft - marginRight - insets);

        // When style.width is set explicitly, the element declares its desired box
        // width. Use the more restrictive (smaller) of the two: this respects the
        // element's declared width in normal flow while allowing a narrower context
        // (e.g., drop-cap wrap) to constrain it further.
        if (style.width !== undefined) {
            return Math.min(styleBasedWidth, contextWidth);
        }

        // No explicit style.width: context is authoritative (zone/column layout).
        return contextWidth;
    }

    private normalizeElementStyle(
        style: ElementStyle,
        overrides: {
            fontSize: number;
            lineHeight: number;
        }
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
            hyphenateCaps: style.hyphenateCaps ?? this.config.layout.hyphenateCaps ?? LAYOUT_DEFAULTS.textLayout.hyphenateCaps,
            hyphenMinWordLength: Number(style.hyphenMinWordLength ?? this.config.layout.hyphenMinWordLength ?? LAYOUT_DEFAULTS.textLayout.hyphenMinWordLength),
            hyphenMinPrefix: Number(style.hyphenMinPrefix ?? this.config.layout.hyphenMinPrefix ?? LAYOUT_DEFAULTS.textLayout.hyphenMinPrefix),
            hyphenMinSuffix: Number(style.hyphenMinSuffix ?? this.config.layout.hyphenMinSuffix ?? LAYOUT_DEFAULTS.textLayout.hyphenMinSuffix),
            justifyEngine: style.justifyEngine || this.config.layout.justifyEngine || LAYOUT_DEFAULTS.textLayout.justifyEngine,
            justifyStrategy: style.justifyStrategy || this.config.layout.justifyStrategy || LAYOUT_DEFAULTS.textLayout.justifyStrategy
        };
    }

    private getSpatialGridLayoutContext(): SpatialGridLayoutContext {
        let tableDropCapIndex = 0;
        return {
            layoutFontSize: this.config.layout.fontSize,
            layoutLineHeight: this.config.layout.lineHeight,
            getStyle: (element) => this.getStyle(element),
            getElementText: (element) => this.getElementText(element),
            resolveEmbeddedImage: (element) => this.resolveEmbeddedImage(element),
            resolveLines: (element, style, fontSize, context) => this.resolveLines(element, style, fontSize, context),
            calculateLineBlockHeight: (lines, style, lineYOffsets) => this.calculateLineBlockHeight(lines, style, lineYOffsets),
            getHorizontalInsets: (style) => LayoutUtils.getHorizontalInsets(style),
            getVerticalInsets: (style) => LayoutUtils.getVerticalInsets(style),
            getContextualBoxWidth: (style, context, fontSize, lineHeight) => this.getContextualBoxWidth(style, context, fontSize, lineHeight),
            getBoxWidth: (style) => LayoutUtils.getBoxWidth(this.config, style),
            resolveMeasurementFontForStyle: (style) => this.resolveMeasurementFontForStyle(style),
            measureText: (text, font, fontSize, letterSpacing) => this.measureText(text, font, fontSize, letterSpacing),
            emitDropCapBoxes: (element, width, context) => {
                const spec = element.dropCap;
                if (!spec || spec.enabled === false) return null;
                const packager = new DropCapPackager(this, element, tableDropCapIndex++, spec);
                const pageDims = this.getPageDimensions();
                const packagerContext: PackagerContext = {
                    processor: this,
                    pageIndex: Number.isFinite(context?.pageIndex) ? Number(context?.pageIndex) : 0,
                    cursorY: Number.isFinite(context?.cursorY) ? Number(context?.cursorY) : 0,
                    margins: { top: 0, right: 0, bottom: 0, left: 0 },
                    pageWidth: Number.isFinite(width) ? Math.max(0, Number(width)) : pageDims.width,
                    pageHeight: pageDims.height,
                    publishActorSignal: () => {
                        throw new Error('[LayoutProcessor] Region-only drop-cap materialization cannot publish actor signals.');
                    },
                    readActorSignals: () => []
                };
                return packager.emitBoxes(
                    Number.isFinite(width) ? Math.max(0, Number(width)) : pageDims.width,
                    Number.POSITIVE_INFINITY,
                    packagerContext
                );
            }
        };
    }

    resolveMeasurementFontForStyle(style: ElementStyle): any {
        if (!style.fontFamily) return this.font;
        try {
            return this.resolveLoadedFamilyFont(
                style.fontFamily,
                style.fontWeight ?? 400,
                style.fontStyle ?? 'normal'
            );
        } catch {
            return this.font;
        }
    }

    private getContextualBoxWidth(
        style: ElementStyle,
        context: FlowMaterializationContext | undefined,
        fontSize: number,
        lineHeight: number
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
        return totalHeight > 0 ? (totalHeight / lines.length) : 0;
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

    private classifySimpleProseEligibility(richSegments: TextSegment[], text: string): keyof import('./layout-session-types').LayoutProfileMetrics {
        if (richSegments.length === 0) {
            return 'simpleProseEligibleCalls';
        }

        let baseStyleSignature: string | null = null;
        for (const segment of richSegments) {
            if (segment.inlineObject) {
                return 'simpleProseIneligibleInlineObjectCalls';
            }
            if (segment.linkTarget) {
                return 'simpleProseIneligibleRichStructureCalls';
            }
            const style = segment.style || {};
            const signature = [
                String(segment.fontFamily || ''),
                String(style.fontFamily || ''),
                String(style.fontWeight ?? ''),
                String(style.fontStyle || ''),
                String(style.textAlign || ''),
                String(style.direction || ''),
                String(style.lang || ''),
                Number(style.letterSpacing || 0).toFixed(3),
                Number(style.textIndent || 0).toFixed(3)
            ].join('|');
            if (baseStyleSignature === null) {
                baseStyleSignature = signature;
            } else if (baseStyleSignature !== signature) {
                return 'simpleProseIneligibleMixedStyleCalls';
            }
        }

        if (!/^[\u0009\u000A\u000D\u0020-\u007E\u00A0-\u00FF\u2010-\u201F\u2026]*$/u.test(text)) {
            return 'simpleProseIneligibleComplexScriptCalls';
        }

        return 'simpleProseEligibleCalls';
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
                children: this.sliceElements(element.children, trimCount, trimCount + remainingLength)
            };
        }

        return {
            ...element,
            content: text.slice(trimCount)
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
                while (renderedIndex < renderedText.length && /\s/.test(renderedText[renderedIndex])) renderedIndex += 1;
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

            // At this point the rendered text no longer looks like a tolerable
            // prefix of the source. Stop rather than drifting forward through
            // repeated prose and over-consuming real content.
            break;
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
        const engineKey = (typeof seed?.engineKey === 'string' && seed.engineKey.trim())
            ? seed.engineKey.trim()
            : this.buildEngineKey(path, sourceType);
        const explicitReflowKey = this.normalizeReflowKey(seed?.reflowKey ?? element.properties?.reflowKey);
        const reflowKey = explicitReflowKey || this.buildReflowKey(path, sourceType);
        const semanticRole = (typeof seed?.semanticRole === 'string' && seed.semanticRole.trim())
            ? seed.semanticRole.trim()
            : (typeof element.properties?.semanticRole === 'string' && element.properties.semanticRole.trim()
                ? element.properties.semanticRole.trim()
                : undefined);
        const fragmentIndex = Math.max(0, Math.floor(Number(seed?.fragmentIndex ?? 0)));
        const continuation = seed?.isContinuation ?? (fragmentIndex > 0);

        const meta: BoxMeta = {
            sourceId,
            engineKey,
            sourceType,
            semanticRole,
            fragmentIndex,
            isContinuation: continuation,
            generated: !!seed?.generated,
            originSourceId: seed?.originSourceId,
            transformKind: seed?.transformKind,
            clonedFromSourceId: seed?.clonedFromSourceId
        };

        if (reflowKey) meta.reflowKey = reflowKey;

        return meta;
    }

    private getContinuationArtifacts(box: FlowBox): ContinuationArtifacts {
        return getContinuationArtifactsWithCallbacks(box, {
            shapeElement: (element, identitySeed) => this.shapeElement(element, identitySeed),
            materializeFlowBox: (unit) => this.materializeFlowBox(unit),
            normalizeAuthorSourceId: (value) => LayoutUtils.normalizeAuthorSourceId(value)
        });
    }

    /**
     * Canonical flat pipeline:
     * input elements -> flow boxes -> paginated flow boxes -> positioned page boxes.
     */
    simulate(elements: Element[]): Page[] {
        const result = this.runSimulationReplayLoop(elements, null, null);
        return result.pages;
    }

    createSimulationRunner(
        elements: Element[],
        options: { tickRateHz?: number; timeOffsetSeconds?: number } = {}
    ): SimulationRunner {
        const scriptRuntimeHost = this.config.scripting
            ? new ScriptRuntimeHost(this.config.scripting)
            : null;
        const simulationElements = this.requiresSimulationClone(elements, scriptRuntimeHost)
            ? this.cloneElementsForSimulation(elements)
            : elements;
        const scriptLifecycleState = scriptRuntimeHost?.createLifecycleState() ?? null;
        this.resolvedLinesCache = new WeakMap<Element, Map<string, ResolvedLinesResult>>();
        const { collaborators, scriptRuntimeHost: activeScriptRuntimeHost } = this.createLayoutCollaborators(
            simulationElements,
            scriptLifecycleState,
            scriptRuntimeHost ?? undefined,
            null
        );
        const progression = this.resolveSimulationProgressionOverride(options);
        return this.createSimulationRunnerPass(
            simulationElements,
            activeScriptRuntimeHost,
            scriptLifecycleState,
            null,
            collaborators,
            progression,
            Number.isFinite(options.timeOffsetSeconds) ? Number(options.timeOffsetSeconds) : 0
        ).runner;
    }

    createSimulationLoop(
        elements: Element[],
        scheduler: SimulationLoopScheduler,
        options: Partial<SimulationLoopOptions> = {}
    ): SimulationLoop {
        const progression = this.getSimulationProgressionConfig();
        return new SimulationLoop(
            (runnerOptions) => this.createSimulationRunner(elements, runnerOptions),
            scheduler,
            {
                tickRateHz: Number.isFinite(options.tickRateHz)
                    ? Math.max(1, Number(options.tickRateHz))
                    : progression.tickRateHz,
                loop: options.loop !== false
            }
        );
    }

    async simulateAsync(
        elements: Element[],
        options: { timeoutMs?: number; maxAsyncReplayPasses?: number } = {}
    ): Promise<Page[]> {
        const asyncThoughtHost = new AsyncThoughtHost();
        const timeoutMs = Math.max(1, Number(options.timeoutMs || 5000));
        const maxAsyncReplayPasses = Math.max(1, Math.floor(Number(options.maxAsyncReplayPasses || 8)));
        const accumulatedTimeline: any[] = [];

        for (let asyncPass = 0; asyncPass < maxAsyncReplayPasses; asyncPass++) {
            const result = this.runSimulationReplayLoop(elements, null, asyncThoughtHost);
            const report = result.session.getSimulationReport();
            const timeline = result.session.getSimulationReportReader().get('temporalPresentationTimeline' as any) as any[] | undefined;
            if (Array.isArray(timeline)) {
                accumulatedTimeline.push(...timeline.map((frame) => ({
                    ...frame,
                    captureIndex: accumulatedTimeline.length + Number(frame.captureIndex || 0)
                })));
            }
            if (!asyncThoughtHost.hasPending()) {
                if (report) {
                    report.artifacts.temporalPresentationTimeline = accumulatedTimeline;
                }
                return result.pages;
            }
            const completed = await asyncThoughtHost.waitForNextCompletion(timeoutMs);
            if (!completed) {
                throw new Error('[LayoutProcessor] Async thought did not complete before timeout.');
            }
        }

        throw new Error('[LayoutProcessor] Async thought replay exceeded the current bounded limit.');
    }

    private runSimulationReplayLoop(
        elements: Element[],
        existingScriptRuntimeHost: ScriptRuntimeHost | null,
        asyncThoughtHost: AsyncThoughtHost | null
    ): { pages: Page[]; session: LayoutSession } {
        const { height: pageHeight, width: pageWidth } = this.getPageDimensions();
        const maxScriptReplayPasses = 3;
        const aggregateScriptProfile = Object.fromEntries(
            LayoutProcessor.SCRIPT_PROFILE_KEYS.map((key) => [key, 0])
        ) as Record<keyof LayoutProfileMetrics, number>;
        const scriptRuntimeHost = existingScriptRuntimeHost ?? (this.config.scripting
            ? new ScriptRuntimeHost(this.config.scripting)
            : null);
        // Any scripting-capable simulation works against a cloned element tree so
        // authored input remains immutable across pre-layout and post-settlement
        // runtime mutations.
        const simulationElements = this.requiresSimulationClone(elements, scriptRuntimeHost)
            ? this.cloneElementsForSimulation(elements)
            : elements;
        const scriptLifecycleState = scriptRuntimeHost?.createLifecycleState() ?? null;

        for (let pass = 0; pass < maxScriptReplayPasses; pass++) {
            this.resolvedLinesCache = new WeakMap<Element, Map<string, ResolvedLinesResult>>();
            const { collaborators, scriptRuntimeCollaborator, scriptRuntimeHost: activeScriptRuntimeHost } = this.createLayoutCollaborators(
                simulationElements,
                scriptLifecycleState,
                scriptRuntimeHost ?? undefined,
                asyncThoughtHost
            );
            const { session, scriptDocumentPackager, runner } = this.createSimulationRunnerPass(
                simulationElements,
                activeScriptRuntimeHost,
                scriptLifecycleState,
                asyncThoughtHost,
                collaborators
            );
            const pages = runner.runToCompletion();
            const finalized = session.finalizePages(pages);
            for (const key of LayoutProcessor.SCRIPT_PROFILE_KEYS) {
                aggregateScriptProfile[key] += Number(session.profile[key] || 0);
            }

            if (
                scriptRuntimeCollaborator?.consumeReplayRequested()
                || scriptDocumentPackager?.consumeReplayRequested()
                || session.consumeScriptReplayRequested()
            ) {
                aggregateScriptProfile.replayPasses += 1;
                if (pass >= maxScriptReplayPasses - 1) {
                    throw new Error('[LayoutProcessor] Script requested replay more times than the current bounded limit allows.');
                }
                continue;
            }

            for (const key of LayoutProcessor.SCRIPT_PROFILE_KEYS) {
                session.profile[key] = aggregateScriptProfile[key] as never;
            }
            const report = session.getSimulationReport();
            if (report?.profile) {
                for (const key of LayoutProcessor.SCRIPT_PROFILE_KEYS) {
                    report.profile[key] = aggregateScriptProfile[key] as never;
                }
            }

            return { pages: finalized, session };
        }

        throw new Error('[LayoutProcessor] Script replay loop exited unexpectedly.');
    }

    private createSimulationRunnerPass(
        elements: Element[],
        scriptRuntimeHost: ScriptRuntimeHost | null,
        scriptLifecycleState: ScriptLifecycleState | null,
        asyncThoughtHost: AsyncThoughtHost | null,
        collaborators: readonly Collaborator[],
        progressionOverride?: Required<SimulationProgressionConfig>,
        timeOffsetSeconds: number = 0
    ): {
        runner: SimulationRunner;
        session: LayoutSession;
        scriptDocumentPackager: ScriptDocumentPackager | null;
    } {
        const { height: pageHeight, width: pageWidth } = this.getPageDimensions();
        this.activeScriptRuntimeHost = scriptRuntimeHost;
        const session = new LayoutSession({
            runtime: this.getRuntime(),
            collaborators,
            asyncThoughtHost
        });
        this.lastLayoutSession = session;
        session.notifySimulationStart();
        const packagers = createPackagers(elements, this, this.packagerFactory);
        let scriptDocumentPackager: ScriptDocumentPackager | null = null;
        if (scriptRuntimeHost?.hasDocumentAfterSettleHandler()) {
            scriptDocumentPackager = new ScriptDocumentPackager(scriptRuntimeHost, elements, scriptLifecycleState!);
            packagers.push(scriptDocumentPackager);
        }
        for (const packager of packagers) {
            session.notifyActorSpawn(packager);
        }
        const contextBase = {
            processor: this,
            pageWidth,
            pageHeight,
            margins: this.config.layout.margins,
            simulationTickRateHz: progressionOverride?.tickRateHz ?? this.getSimulationProgressionConfig().tickRateHz,
            simulationProgression: progressionOverride ?? this.getSimulationProgressionConfig(),
            simulationTimeOffsetSeconds: Number.isFinite(timeOffsetSeconds) ? Number(timeOffsetSeconds) : 0,
            getPageExclusions: (pageIndex: number) => session.getPageExclusions(pageIndex),
            getWorldTraversalExclusions: (pageIndex: number) => session.getWorldTraversalExclusions(pageIndex),
            publishActorSignal: (signal: any) => session.publishActorSignal(signal),
            readActorSignals: (topic?: string) => session.getActorSignals(topic),
            requestAsyncThought: (request: any) => session.requestAsyncThought(request),
            readAsyncThoughtResult: (key: string) => session.readAsyncThoughtResult(key)
        };
        return {
            runner: createSimulationMarchRunner(this, packagers, contextBase, session, progressionOverride),
            session,
            scriptDocumentPackager
        };
    }

    getLastSimulationReport(): SimulationReport | undefined {
        return this.lastLayoutSession?.getSimulationReport();
    }

    getLastSimulationReportReader(): SimulationReportReader {
        return this.lastLayoutSession?.getSimulationReportReader()
            ?? createSimulationReportReader(undefined);
    }

    getLastPrintPipelineSnapshot(): PrintPipelineSnapshot {
        const pages = this.lastLayoutSession?.getFinalizedPages() ?? [];
        const report = this.lastLayoutSession?.getSimulationReport();
        return createPrintPipelineSnapshot(pages, report);
    }

    getCurrentLayoutSession(): LayoutSession | null {
        return this.lastLayoutSession;
    }

    private shapeTableElement(element: Element, identitySeed?: FlowIdentitySeed): FlowBox {
        const style = this.getStyle(element);
        const meta = this.buildFlowBoxMeta(element, identitySeed);
        const fontSize = Number(style.fontSize || this.config.layout.fontSize);
        const lineHeight = Number(style.lineHeight || this.config.layout.lineHeight);
        const marginTop = LayoutUtils.validateUnit(element.properties?.marginTop ?? style.marginTop ?? 0);
        const marginBottom = LayoutUtils.validateUnit(element.properties?.marginBottom ?? style.marginBottom ?? 0);
        const normalizedTable = (element.properties?._normalizedTable as ReturnType<typeof normalizeTableElement> | undefined)
            ?? normalizeTableElement(element);
        const model = buildTableModelFromNormalizedTable(normalizedTable);
        const normalizedStyle = this.normalizeElementStyle(style, {
            fontSize,
            lineHeight
        });

        return {
            type: element.type,
            meta,
            style: normalizedStyle,
            lines: Array.from({ length: Math.max(1, model.rowIndices.length) }, () => []),
            properties: {
                ...(element.properties || {}),
                _tableModel: model,
                _normalizedTable: normalizedTable,
                _isFirstLine: true,
                _isLastLine: true,
                _isFirstFragmentInLine: true,
                _isLastFragmentInLine: true
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
            _normalizedTable: normalizedTable
        };
    }

    protected shapeElement(element: Element, identitySeed?: FlowIdentitySeed): FlowBox {
        if (!element) {
            console.error('shapeElement called with undefined element!', new Error().stack);
        }
        if (isTableElement(element)) {
            return this.shapeTableElement(element, identitySeed);
        }

        return this.shapeNormalizedFlowBlock(this.normalizeFlowBlock(element, identitySeed));
    }

    public normalizeFlowBlock(element: Element, identitySeed?: FlowIdentitySeed): NormalizedFlowBlock {
        const style = this.getStyle(element);
        const meta = this.buildFlowBoxMeta(element, identitySeed);
        const fontSize = Number(style.fontSize || this.config.layout.fontSize);
        const lineHeight = Number(style.lineHeight || this.config.layout.lineHeight);
        const marginTop = LayoutUtils.validateUnit(element.properties?.marginTop ?? style.marginTop ?? 0);
        const marginBottom = LayoutUtils.validateUnit(element.properties?.marginBottom ?? style.marginBottom ?? 0);
        const hasEmbeddedImage = !!element.image;
        const allowLineSplit = hasEmbeddedImage ? false : style.allowLineSplit !== false;
        const normalizedStyle = this.normalizeElementStyle(style, {
            fontSize,
            lineHeight
        });
        const heightOverride = style.height !== undefined ? LayoutUtils.validateUnit(style.height) : undefined;

        return {
            kind: 'flow-block',
            element,
            sourceType: element.type,
            meta,
            style: normalizedStyle,
            marginTop,
            marginBottom,
            keepWithNext: !!(element.properties?.keepWithNext || style.keepWithNext),
            pageBreakBefore: !!style.pageBreakBefore,
            allowLineSplit,
            overflowPolicy: this.normalizeOverflowPolicy(style.overflowPolicy),
            orphans: this.normalizeLineConstraint(
                LayoutUtils.validateUnit(style.orphans ?? LAYOUT_DEFAULTS.orphans),
                LAYOUT_DEFAULTS.orphans
            ),
            widows: this.normalizeLineConstraint(
                LayoutUtils.validateUnit(style.widows ?? LAYOUT_DEFAULTS.widows),
                LAYOUT_DEFAULTS.widows
            ),
            heightOverride,
            identitySeed
        };
    }

    public shapeNormalizedFlowBlock(block: NormalizedFlowBlock): FlowBox {
        return {
            type: block.sourceType,
            meta: block.meta,
            style: block.style,
            lines: undefined,
            properties: {
                ...(block.element.properties || {}),
                _isFirstLine: true,
                _isLastLine: true,
                _isFirstFragmentInLine: true,
                _isLastFragmentInLine: true
            },
            marginTop: block.marginTop,
            marginBottom: block.marginBottom,
            keepWithNext: block.keepWithNext,
            pageBreakBefore: block.pageBreakBefore,
            allowLineSplit: block.allowLineSplit,
            overflowPolicy: block.overflowPolicy,
            orphans: block.orphans,
            widows: block.widows,
            measuredContentHeight: block.heightOverride ?? 0,
            heightOverride: block.heightOverride,
            _materializationMode: 'reflowable',
            _sourceElement: block.element,
            _unresolvedElement: block.element,
            _normalizedFlowBlock: block
        };
    }

    private resolveEmbeddedImage(element: Element): BoxImagePayload | undefined {
        const image = element.image;
        if (!image || typeof image !== 'object') return undefined;
        const parsed = parseEmbeddedImagePayloadCached(image);
        return {
            base64Data: parsed.base64Data,
            mimeType: parsed.mimeType,
            intrinsicWidth: parsed.intrinsicWidth,
            intrinsicHeight: parsed.intrinsicHeight,
            fit: parsed.fit
        };
    }

    private materializeImageFlowBox(
        unit: FlowBox,
        element: Element,
        context: FlowMaterializationContext | undefined,
        fontSize: number,
        lineHeight: number
    ): FlowBox {
        const resolvedImage = unit.image || this.resolveEmbeddedImage(element);
        if (!resolvedImage) return unit;

        const style = unit.style;
        const insetsHorizontal = LayoutUtils.getHorizontalInsets(style);
        const insetsVertical = LayoutUtils.getVerticalInsets(style);

        const contextualBoxWidth = this.getContextualBoxWidth(style, context, fontSize, lineHeight);
        const intrinsicBoxWidth = resolvedImage.intrinsicWidth + insetsHorizontal;
        let boxWidth = style.width !== undefined
            ? Math.max(0, LayoutUtils.validateUnit(style.width))
            : Math.min(Math.max(insetsHorizontal, intrinsicBoxWidth), Math.max(insetsHorizontal, contextualBoxWidth));

        if (!Number.isFinite(boxWidth) || boxWidth <= 0) {
            boxWidth = Math.max(insetsHorizontal, contextualBoxWidth || intrinsicBoxWidth);
        }

        const contentWidth = Math.max(0, boxWidth - insetsHorizontal);
        const explicitHeight = style.height !== undefined ? Math.max(0, LayoutUtils.validateUnit(style.height)) : undefined;
        const computedContentHeight = contentWidth > 0
            ? (contentWidth * (resolvedImage.intrinsicHeight / Math.max(1, resolvedImage.intrinsicWidth)))
            : 0;
        const measuredHeight = explicitHeight !== undefined
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
        const session = this.lastLayoutSession;
        const materializeStartedAt = performance.now();
        session?.recordProfile('flowMaterializeCalls', 1);
        const contextKey = this.getMaterializationContextKey(unit, context);
        const canRematerialize = unit._materializationMode === 'reflowable' && !!unit._sourceElement;
        if (!unit._unresolvedElement && (!canRematerialize || unit._materializationContextKey === contextKey)) {
            session?.recordProfile('flowMaterializeMs', performance.now() - materializeStartedAt);
            return unit;
        }

        const previousContextKey = unit._materializationContextKey;
        const isMorphTransition =
            canRematerialize
            && !!previousContextKey
            && previousContextKey !== contextKey
            && unit.meta?.transformKind === undefined;

        const element = unit._unresolvedElement || unit._sourceElement;
        if (!element) return unit;
        const style = unit.style;
        const fontSize = Number(style.fontSize || this.config.layout.fontSize);
        const lineHeight = Number(style.lineHeight || this.config.layout.lineHeight);

        if (isTableElement(element)) {
            materializeSpatialGridFlowBox(unit, element, context, fontSize, lineHeight, this.getSpatialGridLayoutContext());
            if (isMorphTransition) unit.meta = createMorphedBoxMeta(unit.meta);
            unit._materializationContextKey = contextKey;
            unit._unresolvedElement = undefined;
            session?.recordProfile('flowMaterializeMs', performance.now() - materializeStartedAt);
            return unit;
        }

        const maybeImage = unit.image || this.resolveEmbeddedImage(element);
        if (maybeImage) {
            unit.image = maybeImage;
            this.materializeImageFlowBox(unit, element, context, fontSize, lineHeight);
            if (isMorphTransition) unit.meta = createMorphedBoxMeta(unit.meta);
            unit._materializationContextKey = contextKey;
            unit._unresolvedElement = undefined;
            session?.recordProfile('flowMaterializeMs', performance.now() - materializeStartedAt);
            return unit;
        }

        unit.image = undefined;
        unit.measuredWidth = undefined;

        const resolveSignature = this.buildFlowResolveSignature(unit, element, style, fontSize, lineHeight, context);
        session?.recordFlowResolveSignature(resolveSignature, !!(unit.meta?.isContinuation || (unit.meta?.fragmentIndex || 0) > 0));
        const resolved = this.resolveLines(element, style, fontSize, context);
        const lines = resolved.lines;
        let contentHeight = lines.length > 0
            ? this.calculateLineBlockHeight(lines, style, resolved.lineYOffsets)
            : 0;

        const insetsVertical = LayoutUtils.getVerticalInsets(style);
        contentHeight += insetsVertical;

        const text = this.getElementText(element);
        if (contentHeight === 0 && text) {
            contentHeight = (fontSize * lineHeight) + LayoutUtils.getVerticalInsets(style);
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
        if (isMorphTransition) unit.meta = createMorphedBoxMeta(unit.meta);
        unit._materializationContextKey = contextKey;
        unit._unresolvedElement = undefined; // Mark as resolved
        session?.recordProfile('flowMaterializeMs', performance.now() - materializeStartedAt);

        return unit;
    }

    protected resolveLines(
        element: Element,
        style: ElementStyle,
        fontSize: number,
        context?: FlowMaterializationContext
    ): ResolvedLinesResult {
        const session = this.lastLayoutSession;
        const resolveStartedAt = performance.now();
        session?.recordProfile('flowResolveLinesCalls', 1);
        const text = this.getElementText(element);
        if (!text) {
            session?.recordProfile('flowResolveLinesMs', performance.now() - resolveStartedAt);
            return { lines: [] };
        }

        const lineHeight = Number(style.lineHeight || this.config.layout.lineHeight);
        const cacheKey = this.buildResolvedLinesCacheKey(element, style, Number(fontSize), lineHeight, context);
        const cachedByElement = this.resolvedLinesCache.get(element);
        const cached = cachedByElement?.get(cacheKey);
        if (cached) {
            session?.recordProfile('flowResolveLinesMs', performance.now() - resolveStartedAt);
            return this.cloneResolvedLinesResult(cached);
        }
        const baseWidth = this.getContextualContentWidth(style, context, Number(fontSize), lineHeight);
        let measurementFont = this.font;

        if (style.fontFamily) {
            try {
                measurementFont = this.resolveLoadedFamilyFont(
                    style.fontFamily,
                    style.fontWeight ?? 400,
                    style.fontStyle ?? 'normal'
                );
            } catch {
                const fontConfig = LayoutUtils.resolveFontConfig(
                    style.fontFamily,
                    style.fontWeight,
                    style.fontStyle,
                    this.getTextDelegate()
                );
                const cached = this.getTextDelegate().getCachedFace(fontConfig.src, this.runtime.textDelegateState);
                if (cached) measurementFont = cached;
            }
        }

        const textIndent = Number(style.textIndent || 0);
        const letterSpacing = Number(style.letterSpacing || 0);
        const richSegments = this.getRichSegments(element, style);
        session?.recordProfile(this.classifySimpleProseEligibility(richSegments, text), 1);
        const wrapped = this.wrapRichSegments(
            richSegments,
            baseWidth,
            measurementFont,
            Number(fontSize),
            letterSpacing,
            textIndent,
            undefined,
            undefined
        );
        session?.recordProfile('flowResolveLinesMs', performance.now() - resolveStartedAt);
        const resolved = { lines: wrapped };
        const cacheBucket = cachedByElement ?? new Map<string, ResolvedLinesResult>();
        cacheBucket.set(cacheKey, this.cloneResolvedLinesResult(resolved));
        if (!cachedByElement) {
            this.resolvedLinesCache.set(element, cacheBucket);
        }
        return resolved;
    }

    protected splitFlowBox(
        box: FlowBox,
        availableHeight: number,
        layoutBefore: number
    ): { partA: FlowBox; partB: FlowBox } | null {
        if (box.properties?._tableModel) {
            return splitSpatialGridFlowBox(box, availableHeight, layoutBefore);
        }

        return splitFlowBoxWithCallbacks(
            {
                box,
                availableHeight,
                layoutBefore
            },
            {
                normalizeLineConstraint: (value, fallback) => this.normalizeLineConstraint(value, fallback),
                calculateLineBlockHeight: (lines, style, lineYOffsets) => this.calculateLineBlockHeight(lines, style, lineYOffsets),
                rebuildFlowBox: (base, lines, style, meta, properties) => this.rebuildFlowBox(base, lines, style, meta, properties),
                getElementText: (element) => this.getElementText(element),
                getJoinedLineText: (lines) => this.getJoinedLineText(lines),
                resolveConsumedSourceChars: (sourceText, renderedText) => this.resolveConsumedSourceChars(sourceText, renderedText),
                sliceElements: (elements, start, end) => this.sliceElements(elements, start, end),
                trimLeadingContinuationWhitespace: (element) => this.trimLeadingContinuationWhitespace(element)
            }
        );
    }

    protected rebuildFlowBox(
        base: FlowBox,
        lines: RichLine[],
        style: ElementStyle,
        meta: BoxMeta,
        properties: Record<string, any>
    ): FlowBox {
        const lineHeight = this.calculateLineBlockHeight(
            lines,
            style,
            Array.isArray(properties?._lineYOffsets) ? properties._lineYOffsets : undefined
        );
        const insetsVertical = LayoutUtils.getVerticalInsets(style);
        let measuredContentHeight = lineHeight + insetsVertical;
        return freezeFlowFragment(base, {
            meta,
            style,
            lines,
            properties,
            measuredContentHeight
        });
    }


    protected positionFlowBox(
        unit: FlowBox,
        currentY: number,
        layoutBefore: number,
        margins: { left: number },
        _pageWidth: number,
        pageIndex: number
    ): Box | Box[] {
        const style = unit.style;
        const glueOffset = LayoutUtils.validateUnit(unit.properties?._glueOffsetX ?? 0);
        const x = margins.left + LayoutUtils.validateUnit(style.marginLeft || 0) + glueOffset;
        const y = currentY + layoutBefore;
        // Use measuredWidth when explicitly set (images, floats, fixed-width elements).
        // For fluid text boxes (measuredWidth === undefined), derive width from the
        // actual available width passed in — not from the page-level config — so that
        // elements inside zone sub-sessions are sized to their zone column, not the
        // full page content area.
        const w = Number.isFinite(unit.measuredWidth)
            ? Math.max(0, Number(unit.measuredWidth))
            : style.width !== undefined
                ? LayoutUtils.validateUnit(style.width)
                : Math.max(0, _pageWidth - LayoutUtils.validateUnit(style.marginLeft || 0) - LayoutUtils.validateUnit(style.marginRight || 0));
        const h = Math.max(0, unit.measuredContentHeight);

        if (unit.properties?._tableModel) {
            return positionSpatialGridFlowBoxes(unit, x, y, pageIndex, this.getSpatialGridLayoutContext());
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
                pageIndex
            }
        };
    }

    private createLayoutCollaborators(
        elements: Element[],
        scriptLifecycleState: ScriptLifecycleState | null,
        existingScriptRuntimeHost?: ScriptRuntimeHost,
        asyncThoughtHost?: AsyncThoughtHost | null
    ): {
        collaborators: Collaborator[];
        scriptRuntimeCollaborator: ScriptRuntimeCollaborator | null;
        scriptRuntimeHost: ScriptRuntimeHost | null;
    } {
        const scriptRuntimeHost = existingScriptRuntimeHost
            ?? (this.config.scripting
                ? new ScriptRuntimeHost(this.config.scripting)
                : null);
        const scriptRuntimeCollaborator = scriptRuntimeHost
            ? new ScriptRuntimeCollaborator(scriptRuntimeHost, elements, scriptLifecycleState ?? scriptRuntimeHost.createLifecycleState())
            : null;
        const spatialCorePasses: Collaborator[] = [
            new ContinuationMarkerCollaborator(),
            new PageStartExclusionCollaborator(this.config),
            new PageStartReservationCollaborator(this.config),
            new PageReservationCollaborator(),
        ];
        const spatialCoreSignals: Collaborator[] = [
            new HeadingSignalCollaborator(),
        ];
        const spatialCoreExperiments: Collaborator[] = [
            ...(asyncThoughtHost ? [new AsyncThoughtRuntimeCollaborator(asyncThoughtHost)] : []),
        ];
        const shouldCaptureTemporalPresentation = !!asyncThoughtHost
            || this.getSimulationProgressionConfig().policy === 'fixed-tick-count';
        const shouldBuildInteractionMap = this.config.layout.emitInteractionMap === true;
        const vmPrintPolicyCollaborators: Collaborator[] = [
            new PageRegionCollaborator(this.config, {
                layoutRegion: (content, rect, pageIndex, sourceType, actorId) =>
                    this.layoutRegion(content, rect, pageIndex, sourceType, actorId)
            }),
        ];
        const documentScriptingCollaborators: Collaborator[] = [
            ...(scriptRuntimeCollaborator ? [scriptRuntimeCollaborator] : []),
        ];
        const observerCollaborators: Collaborator[] = [
            new FragmentTransitionArtifactCollaborator(),
            new TransformCapabilityArtifactCollaborator(),
            new TransformArtifactCollaborator(),
            new PageExclusionArtifactCollaborator(),
            new PageNumberArtifactCollaborator(),
            new PageOverrideArtifactCollaborator(),
            new PageReservationArtifactCollaborator(),
            new PageSpatialConstraintArtifactCollaborator(),
            new PageRegionArtifactCollaborator(),
            new SourcePositionArtifactCollaborator(),
            new HeadingTelemetryCollaborator(),
            ...(shouldCaptureTemporalPresentation ? [new TemporalPresentationCollaborator()] : []),
            ...(shouldBuildInteractionMap ? [new InteractionArtifactCollaborator(this.config.layout)] : []),
            new ViewportCaptureArtifactCollaborator(),
            new RegionDebugOverlayCollaborator(),
        ];
        return {
            scriptRuntimeHost,
            scriptRuntimeCollaborator,
            collaborators: [
                ...spatialCorePasses,
                ...spatialCoreSignals,
                ...spatialCoreExperiments,
                ...vmPrintPolicyCollaborators,
                ...documentScriptingCollaborators,
                ...observerCollaborators,
            ]
        };
    }

    private layoutRegion(
        content: PageRegionContent,
        rect: { x: number; y: number; w: number; h: number },
        pageIndex: number,
        sourceType: 'header' | 'footer',
        actorId?: string
    ): Box[] {
        if (!content || !Array.isArray(content.elements) || content.elements.length === 0) return [];
        if (!(rect.w > 0) || !(rect.h > 0)) return [];

        const regionStyle = { ...(content.style || {}) };
        const insetLeft = LayoutUtils.validateUnit(regionStyle.paddingLeft ?? regionStyle.padding ?? 0)
            + LayoutUtils.validateUnit(regionStyle.borderLeftWidth ?? regionStyle.borderWidth ?? 0);
        const insetRight = LayoutUtils.validateUnit(regionStyle.paddingRight ?? regionStyle.padding ?? 0)
            + LayoutUtils.validateUnit(regionStyle.borderRightWidth ?? regionStyle.borderWidth ?? 0);
        const insetTop = LayoutUtils.validateUnit(regionStyle.paddingTop ?? regionStyle.padding ?? 0)
            + LayoutUtils.validateUnit(regionStyle.borderTopWidth ?? regionStyle.borderWidth ?? 0);
        const insetBottom = LayoutUtils.validateUnit(regionStyle.paddingBottom ?? regionStyle.padding ?? 0)
            + LayoutUtils.validateUnit(regionStyle.borderBottomWidth ?? regionStyle.borderWidth ?? 0);

        const innerWidth = Math.max(0, rect.w - insetLeft - insetRight);
        const innerHeight = Math.max(0, rect.h - insetTop - insetBottom);
        const regionElements = content.elements.map((element) => this.sanitizePageRegionElement(element));

        const regionConfig = {
            ...this.config,
            layout: {
                ...this.config.layout,
                pageBackground: undefined,
                pageSize: { width: innerWidth, height: LayoutProcessor.REGION_LAYOUT_HEIGHT },
                margins: { top: 0, right: 0, bottom: 0, left: 0 }
            },
            header: undefined,
            footer: undefined
        };

        const regionProcessor = new LayoutProcessor(regionConfig, this.runtime);
        const regionPages = regionProcessor.simulate(regionElements);
        const firstRegionPage = regionPages[0];
        const contentBoxes = (firstRegionPage?.boxes || [])
            .filter((box) => (box.y + box.h) > 0 && box.y < innerHeight)
            .map((box, index) => ({
                ...box,
                x: box.x + rect.x + insetLeft,
                y: box.y + rect.y + insetTop,
                meta: {
                    ...(box.meta || {
                        sourceId: `system:${sourceType}:${pageIndex}:${index}`,
                        engineKey: `system:${sourceType}:${pageIndex}:${index}`,
                        fragmentIndex: 0,
                        isContinuation: false
                    }),
                    ...(actorId ? { actorId } : {}),
                    pageIndex,
                    sourceType,
                    generated: true
                }
            }));

        const wrapperNeeded = Object.keys(regionStyle).length > 0;
        if (!wrapperNeeded) return contentBoxes;

        const wrapperBox: Box = {
            type: `${sourceType}_region`,
            x: rect.x,
            y: rect.y,
            w: rect.w,
            h: rect.h,
            style: regionStyle,
            properties: {},
            meta: {
                sourceId: `system:${sourceType}:region:${pageIndex}`,
                engineKey: `system:${sourceType}:region:${pageIndex}`,
                ...(actorId ? { actorId } : {}),
                sourceType,
                fragmentIndex: 0,
                isContinuation: false,
                pageIndex,
                generated: true
            }
        };

        return [wrapperBox, ...contentBoxes];
    }

    private sanitizePageRegionElement(element: Element): Element {
        const properties = element.properties && typeof element.properties === 'object'
            ? { ...element.properties }
            : {};
        delete properties.keepWithNext;
        delete properties.paginationContinuation;
        delete properties.pageOverrides;

        const style = properties.style && typeof properties.style === 'object'
            ? { ...(properties.style as Record<string, unknown>) }
            : undefined;
        if (style) {
            delete style.pageBreakBefore;
            delete style.keepWithNext;
        }

        return {
            ...element,
            properties: {
                ...properties,
                ...(style ? { style } : {})
            },
            children: Array.isArray(element.children)
                ? element.children.map((child) => this.sanitizePageRegionElement(child))
                : element.children
        };
    }
}
