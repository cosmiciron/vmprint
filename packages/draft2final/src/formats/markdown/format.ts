import type { SemanticNode } from '../../semantic';
import type { FormatHandler } from '../compiler/format-handler';
import type { FormatContext } from '../compiler/format-context';
import { formatNumber, toRoman } from '../compiler/numbering';
import { inlinePlainText } from '../compiler';

// ─── Config accessors ────────────────────────────────────────────────────────

type Cfg = Record<string, unknown>;

function cfg<T>(config: Cfg, ...path: string[]): T | undefined {
    let cur: unknown = config;
    for (const key of path) {
        if (!cur || typeof cur !== 'object') return undefined;
        cur = (cur as Cfg)[key];
    }
    return cur as T;
}

function cfgStr(config: Cfg, defaultVal: string, ...path: string[]): string {
    const v = cfg<unknown>(config, ...path);
    return typeof v === 'string' ? v : defaultVal;
}

function cfgNum(config: Cfg, defaultVal: number, ...path: string[]): number {
    const v = cfg<unknown>(config, ...path);
    return typeof v === 'number' ? v : defaultVal;
}

function cfgBool(config: Cfg, defaultVal: boolean, ...path: string[]): boolean {
    const v = cfg<unknown>(config, ...path);
    return typeof v === 'boolean' ? v : defaultVal;
}

function cfgArr<T>(config: Cfg, defaultVal: T[], ...path: string[]): T[] {
    const v = cfg<unknown>(config, ...path);
    return Array.isArray(v) && v.length > 0 ? (v as T[]) : defaultVal;
}

// ─── Ordered marker formatting ────────────────────────────────────────────────

type OrderedMarkerStyle = 'decimal' | 'lower-alpha' | 'upper-alpha' | 'lower-roman' | 'upper-roman' | 'legal';

function formatOrderedMarker(style: OrderedMarkerStyle, value: number, legalPath: number[]): string {
    switch (style) {
        case 'lower-alpha':
            return `${formatNumber(value, 'lower-alpha')}.`;
        case 'upper-alpha':
            return `${formatNumber(value, 'upper-alpha')}.`;
        case 'lower-roman':
            return `${toRoman(value, false)}.`;
        case 'upper-roman':
            return `${toRoman(value, true)}.`;
        case 'legal':
            return `${[...legalPath, value].join('.')}.`;
        case 'decimal':
        default:
            return `${value}.`;
    }
}

// ─── Reference formatting ─────────────────────────────────────────────────────

function formatRefNumber(index: number, style: string): string {
    if (style === 'lower-roman') return toRoman(index, false);
    if (style === 'upper-roman') return toRoman(index, true);
    return String(index);
}

// ─── MarkdownFormat ──────────────────────────────────────────────────────────

export class MarkdownFormat implements FormatHandler {
    protected readonly config: Cfg;
    private previousNode: SemanticNode | null = null;
    private subheadingApplied = false;

    constructor(config: Record<string, unknown>) {
        this.config = config;
    }

    // ── FormatHandler API ──────────────────────────────────────────────────────

    handleBlock(node: SemanticNode, ctx: FormatContext): void {
        this.dispatchBlock(node, ctx, 0, undefined, [], false);
        this.previousNode = node;
    }

    flush(ctx: FormatContext): void {
        const refsEnabled = cfgBool(this.config, true, 'references', 'enabled');
        const linkMode = cfgStr(this.config, 'citation', 'links', 'mode');
        if (!refsEnabled || linkMode === 'inline') return;
        if (ctx.registeredLinkCount() === 0) return;

        const heading = cfgStr(this.config, 'References', 'references', 'heading');
        const numStyle = cfgStr(this.config, 'decimal', 'references', 'numberingStyle');
        const includeTitle = cfgBool(this.config, true, 'references', 'includeLinkTitle');

        ctx.emit('thematic-break', '');
        ctx.emit('references-heading', heading);

        for (const entry of ctx.registeredLinks()) {
            const prefix = `${formatRefNumber(entry.index, numStyle)}. `;
            const titleStr =
                includeTitle && entry.title && entry.title.trim().length > 0 ? entry.title.trim() : undefined;
            ctx.emitReferenceItem(prefix, entry.url, titleStr);
        }
    }

    roles(): string[] {
        return [
            'heading-1',
            'heading-2',
            'heading-3',
            'heading-4',
            'heading-5',
            'heading-6',
            'subheading',
            'paragraph',
            'blockquote',
            'blockquote-attribution',
            'list-item-unordered',
            'list-item-ordered',
            'list-item-continuation',
            'code-block',
            'thematic-break',
            'inline-code',
            'link',
            'citation-marker',
            'references-heading',
            'references-item',
            'definition-term',
            'definition-desc',
            'image',
        ];
    }

    // ── Private dispatch ───────────────────────────────────────────────────────

    private dispatchBlock(
        node: SemanticNode,
        ctx: FormatContext,
        depth: number,
        listContinuationRole: string | undefined,
        orderedPath: number[],
        tightListContext: boolean,
    ): void {
        const inList = listContinuationRole !== undefined;
        const contDepth = Math.min(depth, 5);

        // If the previous block was a standalone image, check if this is a caption
        // and retroactively mark the image keepWithNext.
        this.tryMarkImageKeepWithNextForCaption(node, ctx);

        switch (node.kind) {
            case 'h1':
            case 'h2':
            case 'h3':
            case 'h4':
            case 'h5':
            case 'h6': {
                const level = node.kind.slice(1);
                ctx.emit(`heading-${level}`, node.children || [], {
                    sourceRange: node.sourceRange,
                    sourceSyntax: node.sourceSyntax,
                });
                break;
            }

            case 'p':
            case 'dt':
            case 'dd': {
                // Standalone image?
                const imageOnly = this.standaloneImageNode(node);
                if (imageOnly) {
                    this.emitBlockImage(imageOnly, node, ctx, listContinuationRole, contDepth, tightListContext);
                    break;
                }

                if (node.kind === 'dt') {
                    ctx.emit('definition-term', node.children || [], {
                        sourceRange: node.sourceRange,
                        sourceSyntax: node.sourceSyntax,
                    });
                    break;
                }
                if (node.kind === 'dd') {
                    ctx.emit('definition-desc', node.children || [], {
                        sourceRange: node.sourceRange,
                        sourceSyntax: node.sourceSyntax,
                    });
                    break;
                }

                // Title subheading?
                const subheadingCfg = cfg<Cfg>(this.config, 'title', 'subheading') || {};
                const subheadingEnabled = cfgBool(subheadingCfg, false, 'enabled');
                const isTitleSubheadingCandidate =
                    subheadingEnabled &&
                    !inList &&
                    depth === 0 &&
                    this.previousNode?.kind === 'h1' &&
                    (!cfgBool(subheadingCfg, true, 'applyToFirstH1Only') || !this.subheadingApplied);

                const paraText = inlinePlainText(node.children || []).trim();
                const markerPattern = new RegExp(cfgStr(subheadingCfg, '^::\\s+', 'markerPattern'));
                const requireMarker = cfgBool(subheadingCfg, true, 'requireMarker');
                const hasMarker = markerPattern.test(paraText);
                const asTitleSubheading = isTitleSubheadingCandidate && (!requireMarker || hasMarker);

                let children = node.children || [];
                if (asTitleSubheading && cfgBool(subheadingCfg, true, 'stripMarker')) {
                    children = this.stripLeadingMarker(children, markerPattern);
                }

                let role: string;
                if (asTitleSubheading) {
                    role = 'subheading';
                } else if (inList) {
                    role = `${listContinuationRole}-${contDepth}`;
                } else {
                    role = 'paragraph';
                }

                const props: Record<string, unknown> = {
                    sourceRange: node.sourceRange,
                    sourceSyntax: node.sourceSyntax,
                };

                // Caption style override
                if (!inList && !asTitleSubheading) {
                    const captionStyle = this.tryResolveCaptionStyle(node);
                    if (captionStyle) {
                        props.style = captionStyle;
                    }
                }

                if (asTitleSubheading) {
                    this.subheadingApplied = true;
                    if (cfgBool(subheadingCfg, true, 'keepWithNext')) {
                        props.keepWithNext = true;
                    }
                }

                if (inList) {
                    const indentPerLevel = cfgNum(this.config, 17.5, 'list', 'textIndentPerLevel');
                    const contLevels = cfgNum(this.config, 1, 'list', 'continuationIndentLevels');
                    const effectiveDepth = Math.min(contDepth, contLevels);
                    const contStyle: Record<string, unknown> = { textIndent: indentPerLevel * effectiveDepth };
                    if (tightListContext) {
                        contStyle.marginTop = 0;
                        contStyle.marginBottom = cfgNum(this.config, 0.8, 'list', 'tightItemSpacingAfter');
                    }
                    const existingStyle = props.style as Record<string, unknown> | undefined;
                    props.style = { ...contStyle, ...(existingStyle || {}) };
                }

                if (node.keepWithNext) {
                    props.keepWithNext = true;
                }

                ctx.emit(role, children, props);
                break;
            }

            case 'ul':
            case 'ol':
                this.emitList(node, depth + (inList ? 1 : 0), ctx, orderedPath, tightListContext);
                break;

            case 'dl':
                for (const child of node.children || []) {
                    this.dispatchBlock(child, ctx, depth, listContinuationRole, orderedPath, tightListContext);
                }
                break;

            case 'code': {
                const modeStyle = this.resolveCodeModeStyle(node.language);
                const props: Record<string, unknown> = {
                    language: node.language,
                    sourceRange: node.sourceRange,
                    sourceSyntax: node.sourceSyntax,
                };
                if (modeStyle) props.style = modeStyle;

                if (inList) {
                    // Inside a list: use continuation role
                    const contRole = `${listContinuationRole}-${contDepth}`;
                    const contStyle = ctx.getThemeStyle(contRole) as Record<string, unknown> | undefined;
                    const codeBase = ctx.getThemeStyle('code-block') as Record<string, unknown> | undefined;
                    props.style = { ...(codeBase || {}), ...(modeStyle || {}), ...(contStyle || {}) };
                    ctx.emit(contRole, node.value || '', props);
                } else {
                    // Lead-in detection: mark previous paragraph keepWithNext
                    this.tryKeepLastWithNext(ctx);
                    ctx.emit('code-block', node.value || '', props);
                }
                break;
            }

            case 'blockquote':
                if (!inList) {
                    this.tryKeepLastWithNext(ctx);
                }
                this.emitBlockquote(node, ctx, inList, listContinuationRole, contDepth, tightListContext, orderedPath);
                break;

            case 'hr':
                ctx.emit('thematic-break', '', {
                    sourceRange: node.sourceRange,
                    sourceSyntax: node.sourceSyntax,
                });
                break;

            case 'table':
                this.emitTable(node, ctx, inList ? listContinuationRole : undefined, contDepth, tightListContext);
                break;

            default:
                break;
        }

        // SemanticNode.keepWithNext from markdown HTML comment <!-- keep-with-next -->
        if (node.keepWithNext) {
            ctx.keepLastWithNext();
        }
    }

    // ── Subheading marker stripping ───────────────────────────────────────────

    private stripLeadingMarker(nodes: SemanticNode[], pattern: RegExp): SemanticNode[] {
        let stripped = false;
        const out: SemanticNode[] = [];
        for (const node of nodes) {
            if (!stripped && node.kind === 'text') {
                const next = (node.value || '').replace(pattern, '');
                out.push({ ...node, value: next });
                stripped = true;
                continue;
            }
            out.push(node);
        }
        return out;
    }

    // ── Lead-in detection ─────────────────────────────────────────────────────

    private tryKeepLastWithNext(ctx: FormatContext): void {
        if (!this.previousNode || this.previousNode.kind !== 'p') return;
        const text = inlinePlainText(this.previousNode.children || []).trimEnd();
        if (text.length === 0) return;
        if (/[:\u2014\u2013]$/.test(text)) {
            ctx.keepLastWithNext();
        }
    }

    // ── Image helpers ─────────────────────────────────────────────────────────

    private standaloneImageNode(node: SemanticNode): SemanticNode | null {
        if (node.kind !== 'p') return null;
        const children = node.children || [];
        if (children.length !== 1) return null;
        return children[0].kind === 'image' ? children[0] : null;
    }

    private emitBlockImage(
        imageNode: SemanticNode,
        parentPara: SemanticNode,
        ctx: FormatContext,
        listContinuationRole: string | undefined,
        contDepth: number,
        tightListContext: boolean,
    ): void {
        const shouldFrame = this.shouldFrameImage(imageNode);
        const frameCfg = cfg<Cfg>(this.config, 'images', 'frame') || {};
        const frameStyle = shouldFrame ? cfg<Record<string, unknown>>(frameCfg, 'style') || {} : {};

        let baseStyle: Record<string, unknown>;
        if (listContinuationRole) {
            const contStyle = ctx.getThemeStyle(`${listContinuationRole}-${contDepth}`) as
                | Record<string, unknown>
                | undefined;
            baseStyle = {
                ...(contStyle || {}),
                marginTop: 0,
                marginBottom: tightListContext
                    ? cfgNum(this.config, 0.8, 'list', 'tightItemSpacingAfter')
                    : cfgNum(this.config, 3.4, 'list', 'itemSpacingAfter'),
            };
        } else {
            const blockImgCfg = cfg<Record<string, unknown>>(this.config, 'images', 'blockStyle') || {};
            baseStyle = {
                marginTop: 6,
                marginBottom: 8,
                ...blockImgCfg,
            };
        }

        const imageStyle = { ...baseStyle, ...frameStyle };

        // Check if next block is a caption (we can't see next block here, but
        // we'll handle keepWithNext by checking the next node in handleBlock)
        const props: Record<string, unknown> = {
            style: imageStyle,
            sourceRange: parentPara.sourceRange,
            sourceSyntax: parentPara.sourceSyntax,
        };

        ctx.emitImage(imageNode, props);
        // Note: keepWithNext for caption is applied by the NEXT block's handler
        // (the next paragraph/blockquote will call ctx.keepLastWithNext() if it's a caption)
        // We apply it here if the next node (stored in previousNode) is a caption.
        // Actually: we can't see ahead. We'll track this by storing pending state.
        // For now, caption keepWithNext is handled reactively:
        // if the NEXT block is a caption paragraph, it marks the previous image keepWithNext.
        // We store that the last element was an image so caption detection can trigger it.
        this.lastWasBlockImage = true;
    }

    private lastWasBlockImage = false;

    private tryMarkImageKeepWithNextForCaption(node: SemanticNode, ctx: FormatContext): void {
        if (!this.lastWasBlockImage) return;
        const text = inlinePlainText(node.children || []).trim();
        const isCap = this.isCaptionText(text);
        const isBqCap = this.isFigureCaptionBlockquoteEnabled() && node.kind === 'blockquote';
        if (isCap || isBqCap) {
            ctx.keepLastWithNext();
        }
        this.lastWasBlockImage = false;
    }

    private shouldFrameImage(imageNode: SemanticNode): boolean {
        const mode = cfgStr(this.config, 'off', 'images', 'frame', 'mode');
        if (mode === 'all') return true;
        if (mode !== 'opt-in') return false;
        const pattern = new RegExp(
            cfgStr(this.config, '\\b(frame|framed)\\b', 'images', 'frame', 'markerPattern'),
            'i',
        );
        return pattern.test((imageNode.title || '').trim());
    }

    private isCaptionText(text: string): boolean {
        const pattern = new RegExp(
            cfgStr(this.config, '^(Figure|Fig\\.|Plate|Table|Source)\\s+([0-9]+|[IVXLC]+)\\b', 'captions', 'pattern'),
            'i',
        );
        return pattern.test(text);
    }

    private isFigureCaptionBlockquoteEnabled(): boolean {
        return cfgBool(this.config, false, 'captions', 'blockquoteUnderImageAsFigureCaption');
    }

    // ── Caption style ─────────────────────────────────────────────────────────

    private tryResolveCaptionStyle(node: SemanticNode): Record<string, unknown> | undefined {
        if (node.kind !== 'p') return undefined;
        const text = inlinePlainText(node.children || []).trim();
        if (!this.isCaptionText(text)) return undefined;
        const captionCfg = cfg<Cfg>(this.config, 'captions') || {};
        return (captionCfg.style as Record<string, unknown>) || undefined;
    }

    // ── Blockquote ────────────────────────────────────────────────────────────

    private emitBlockquote(
        node: SemanticNode,
        ctx: FormatContext,
        inList: boolean,
        listContinuationRole: string | undefined,
        contDepth: number,
        tightListContext: boolean,
        orderedPath: number[],
    ): void {
        const asFigureCaption =
            !inList &&
            this.isFigureCaptionBlockquoteEnabled() &&
            this.previousNode !== null &&
            this.standaloneImageNode(this.previousNode) !== null;

        const attributionEnabled = cfgBool(this.config, true, 'blockquote', 'attribution', 'enabled');
        const attributionPattern = attributionEnabled
            ? new RegExp(cfgStr(this.config, '^[-\u2014\u2013]\\s+', 'blockquote', 'attribution', 'markerPattern'))
            : /^$/;

        const children = node.children || [];
        let attributionIndex = -1;
        if (children.length > 0) {
            const last = children[children.length - 1];
            if (this.isBlockquoteAttribution(last, attributionPattern)) {
                attributionIndex = children.length - 1;
            }
        }

        const bqStyle = ctx.getThemeStyle('blockquote') as Record<string, unknown> | undefined;
        const bqAttrStyle = ctx.getThemeStyle('blockquote-attribution') as Record<string, unknown> | undefined;
        const contStyle = inList
            ? (ctx.getThemeStyle(`${listContinuationRole}-${contDepth}`) as Record<string, unknown> | undefined)
            : undefined;
        const captionBqStyle = cfg<Record<string, unknown>>(this.config, 'captions', 'blockquoteStyle');

        for (let idx = 0; idx < children.length; idx += 1) {
            const child = children[idx];

            if (asFigureCaption) {
                // Emit each paragraph as a caption-styled paragraph
                if (child.kind === 'p') {
                    const captionStyle =
                        captionBqStyle || cfg<Record<string, unknown>>(this.config, 'captions', 'style');
                    const props: Record<string, unknown> = {
                        sourceRange: child.sourceRange,
                        sourceSyntax: child.sourceSyntax,
                    };
                    if (captionStyle) props.style = captionStyle;
                    ctx.emit('paragraph', child.children || [], props);
                }
                continue;
            }

            const isAttribution = idx === attributionIndex;
            const quoteChild =
                isAttribution && child.kind === 'p'
                    ? {
                          ...child,
                          children: this.stripBlockquoteAttributionMarker(child.children || [], attributionPattern),
                      }
                    : child;

            if (child.kind === 'p') {
                const partStyle = isAttribution
                    ? { ...(bqStyle || {}), ...(bqAttrStyle || {}), ...(contStyle || {}) }
                    : { ...(bqStyle || {}), ...(contStyle || {}) };
                const role = isAttribution
                    ? 'blockquote-attribution'
                    : inList
                      ? `${listContinuationRole}-${contDepth}`
                      : 'blockquote';
                ctx.emit(role, quoteChild.children || [], {
                    style: partStyle,
                    sourceRange: child.sourceRange,
                    sourceSyntax: child.sourceSyntax,
                });
            } else {
                // Nested block inside blockquote (e.g. code, list)
                this.dispatchBlock(quoteChild, ctx, 1, undefined, orderedPath, tightListContext);
                // Apply blockquote style to the last emitted
                // We don't retroactively override — nested blocks keep their own styling
            }
        }
    }

    private isBlockquoteAttribution(node: SemanticNode, pattern: RegExp): boolean {
        if (node.kind !== 'p') return false;
        const text = inlinePlainText(node.children || []).trim();
        return pattern.test(text);
    }

    private stripBlockquoteAttributionMarker(nodes: SemanticNode[], pattern: RegExp): SemanticNode[] {
        let stripped = false;
        const out: SemanticNode[] = [];
        for (const node of nodes) {
            if (!stripped && node.kind === 'text') {
                out.push({ ...node, value: (node.value || '').replace(pattern, '') });
                stripped = true;
                continue;
            }
            out.push(node);
        }
        return out;
    }

    // ── List ──────────────────────────────────────────────────────────────────

    private emitList(
        list: SemanticNode,
        depth: number,
        ctx: FormatContext,
        orderedPath: number[],
        tightListContext: boolean,
    ): void {
        const depthClamped = Math.min(depth, 5);
        const markerGapSpaces = Math.max(1, Math.round(cfgNum(this.config, 5, 'list', 'markerGap') / 3));
        const markerPad = ' '.repeat(markerGapSpaces);
        const listRole = list.kind === 'ul' ? 'list-item-unordered' : 'list-item-ordered';
        const items = (list.children || []).filter((n) => n.kind === 'li');

        const indentPerLevel = cfgNum(this.config, 17.5, 'list', 'textIndentPerLevel');
        const itemSpacing = cfgNum(this.config, 3.4, 'list', 'itemSpacingAfter');
        const tightSpacing = cfgNum(this.config, 0.8, 'list', 'tightItemSpacingAfter');
        const unorderedMarkers = cfgArr<string>(
            this.config,
            ['\u2022', '\u25e6', '\u25aa'],
            'list',
            'unorderedMarkers',
        );
        const orderedMarkers = cfgArr<string>(
            this.config,
            ['decimal', 'lower-alpha', 'lower-roman'],
            'list',
            'orderedMarkers',
        );
        const taskChecked = cfgStr(this.config, '\u2611', 'list', 'taskMarkers', 'checked');
        const taskUnchecked = cfgStr(this.config, '\u2610', 'list', 'taskMarkers', 'unchecked');

        const isTight = !!(list.listTight || tightListContext);

        for (let index = 0; index < items.length; index += 1) {
            const item = items[index];
            const itemChildren = item.children || [];
            if (itemChildren.length === 0) continue;

            const first = itemChildren[0];

            // Compute marker
            let marker: string;
            if (item.checked !== null && item.checked !== undefined) {
                marker = item.checked ? taskChecked : taskUnchecked;
            } else if (list.kind === 'ul') {
                marker = unorderedMarkers[depthClamped % unorderedMarkers.length] || '\u2022';
            } else {
                const start = list.start || 1;
                const value = start + index;
                const style = (orderedMarkers[depthClamped % orderedMarkers.length] || 'decimal') as OrderedMarkerStyle;
                marker = formatOrderedMarker(style, value, orderedPath);
            }

            const styleType = `${listRole}-${depthClamped}`;
            const textIndent = indentPerLevel * depthClamped;
            const baseStyle: Record<string, unknown> = { textIndent };
            if (isTight) baseStyle.marginBottom = tightSpacing;
            else baseStyle.marginBottom = itemSpacing;

            const nextOrderedPath = list.kind === 'ol' ? [...orderedPath, (list.start || 1) + index] : orderedPath;

            if (first.kind === 'p') {
                ctx.emit(
                    styleType,
                    [{ kind: 'text', value: `${marker}${markerPad}` } as SemanticNode, ...(first.children || [])],
                    {
                        style: baseStyle,
                        sourceRange: item.sourceRange,
                        sourceSyntax: item.sourceSyntax,
                    },
                );
            } else {
                // Non-paragraph first child (e.g. code block, blockquote)
                ctx.emit(styleType, `${marker}${markerPad}`, {
                    style: baseStyle,
                    sourceRange: item.sourceRange,
                    sourceSyntax: item.sourceSyntax,
                });
                this.dispatchBlock(first, ctx, depth + 1, `list-item-continuation`, nextOrderedPath, isTight);
            }

            // Remaining children
            for (let ci = 1; ci < itemChildren.length; ci += 1) {
                this.dispatchBlock(
                    itemChildren[ci],
                    ctx,
                    depth + 1,
                    `list-item-continuation`,
                    nextOrderedPath,
                    isTight,
                );
            }
        }
    }

    // ── Table ─────────────────────────────────────────────────────────────────

    private emitTable(
        table: SemanticNode,
        ctx: FormatContext,
        listContinuationRole: string | undefined,
        contDepth: number,
        tightListContext: boolean,
    ): void {
        let marginLeft: number | undefined;
        if (listContinuationRole) {
            const contStyle = ctx.getThemeStyle(`${listContinuationRole}-${contDepth}`) as
                | Record<string, unknown>
                | undefined;
            if (typeof contStyle?.textIndent === 'number') {
                marginLeft = contStyle.textIndent as number;
            }
        }

        ctx.emitTable(table, {
            zebra: cfgBool(this.config, false, 'tables', 'zebra'),
            zebraColor: cfgStr(this.config, '#f7f9fc', 'tables', 'zebraColor'),
            headerColor: cfg<string>(this.config, 'tables', 'headerColor') || undefined,
            marginLeft,
            marginBottom: tightListContext ? cfgNum(this.config, 0.8, 'list', 'tightItemSpacingAfter') : undefined,
        });
    }

    // ── Code mode resolution ──────────────────────────────────────────────────

    protected resolveCodeModeStyle(language: string | undefined): Record<string, unknown> | undefined {
        const codeBlocksCfg = cfg<Cfg>(this.config, 'codeBlocks') || {};
        if (!codeBlocksCfg.modes) return undefined;

        const defaultMode = cfgStr(codeBlocksCfg, 'default', 'defaultMode').trim();
        const langKey = (language || '').trim().toLowerCase();
        const languageModes = cfg<Record<string, string>>(codeBlocksCfg, 'languageModes') || {};
        const mappedMode = langKey ? languageModes[langKey] : undefined;
        const modeName = (mappedMode || defaultMode).trim();

        const modes = cfg<Record<string, Cfg>>(codeBlocksCfg, 'modes') || {};
        const style = modes[modeName]?.style;
        if (!style || typeof style !== 'object') return undefined;
        return style as Record<string, unknown>;
    }
}
