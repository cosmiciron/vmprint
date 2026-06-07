import type { Box, Element, ElementStyle, ListMarkerStyle, RichLine } from '../../types';
import { LayoutProcessor } from '../layout-core';
import type { FlowBox } from '../layout-core-types';
import { LayoutUtils } from '../layout-utils';
import { resolveDocumentMicroLanePolicy, resolveMinUsableLaneWidth } from '../micro-lane-policy';
import { normalizeListElement, type NormalizedList } from '../normalized-list';
import { reflowTextElementAgainstSpatialField } from '../spatial-field-reflow';
import {
    buildHostedRegionContinuationQueue,
    createHostedRegionSessionContextBase,
    type HostedRegionSessionResult
} from './hosted-region-runtime';
import { runHostedRegionSession, runHostedRegionSessionBounded } from './hosted-region-settlement';
import { buildPackagerForElement } from './create-packagers';
import { FlowBoxPackager } from './flow-box-packager';
import { createContinuationIdentity, createElementPackagerIdentity, PackagerIdentity } from './packager-identity';
import { buildContainedSpatialMap, resolveContainedHostWidth } from './contained-field-geometry';
import type { HostedRegionActorEntry, HostedRegionActorQueue } from './region-actor-queues';
import { resolvePackagerChunkOriginWorldY } from './packager-types';
import { SpatialFieldGeometryCapability } from './spatial-field-capability';
import type {
    LayoutBox,
    PackagerContext,
    PackagerPlacementPreference,
    PackagerReshapeProfile,
    PackagerReshapeResult,
    PackagerUnit
} from './packager-types';

type ElementShaper = {
    normalizeFlowBlock(element: Element, options: { path: number[] }): any;
    shapeNormalizedFlowBlock(block: any): FlowBox;
};

type PreparedListItem = {
    marker: FlowBoxPackager | null;
    markerBoxes?: Box[];
    body: HostedRegionSessionResult;
    height: number;
    y: number;
};

type PreparedListMode = 'none' | 'rectangular' | 'spatial';

type ContainedHostFrame = {
    x: number;
    y: number;
    w: number;
    h: number;
    clipProperties: Record<string, unknown>;
};

const BLOCK_CHILD_TYPES = new Set([
    'p',
    'paragraph',
    'heading',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'table',
    'story',
    'zone-map',
    'strip',
    'list',
    'toc'
]);

function isBlockListItemChild(element: Element | undefined): boolean {
    if (!element) return false;
    const type = String(element.type || '').trim().toLowerCase();
    if (type === 'image') {
        return !!element.placement || element.properties?.display === 'block';
    }
    return BLOCK_CHILD_TYPES.has(type);
}

function toAlphaMarker(value: number, uppercase: boolean): string {
    let n = Math.max(1, Math.floor(value));
    let label = '';
    while (n > 0) {
        n -= 1;
        label = String.fromCharCode((uppercase ? 65 : 97) + (n % 26)) + label;
        n = Math.floor(n / 26);
    }
    return label;
}

function toRomanMarker(value: number, uppercase: boolean): string {
    const pairs: Array<[number, string]> = [
        [1000, 'm'],
        [900, 'cm'],
        [500, 'd'],
        [400, 'cd'],
        [100, 'c'],
        [90, 'xc'],
        [50, 'l'],
        [40, 'xl'],
        [10, 'x'],
        [9, 'ix'],
        [5, 'v'],
        [4, 'iv'],
        [1, 'i']
    ];
    let n = Math.max(1, Math.min(3999, Math.floor(value)));
    let label = '';
    for (const [amount, token] of pairs) {
        while (n >= amount) {
            label += token;
            n -= amount;
        }
    }
    return uppercase ? label.toUpperCase() : label;
}

function toMappedDigitMarker(value: number, digits: string): string {
    const chars = Array.from(digits);
    if (chars.length < 10) return String(Math.max(1, Math.floor(value)));
    return String(Math.max(1, Math.floor(value)))
        .replace(/\d/g, (digit) => chars[Number(digit)] ?? digit);
}

function toCjkDecimalMarker(value: number): string {
    return toMappedDigitMarker(value, '〇一二三四五六七八九');
}

function toCjkIdeographicMarker(value: number): string {
    const digits = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
    const units = ['', '十', '百', '千'];
    const n = Math.max(1, Math.min(9999, Math.floor(value)));
    const chars = String(n).split('').map((char) => Number(char));
    let label = '';
    let pendingZero = false;
    for (let index = 0; index < chars.length; index++) {
        const digit = chars[index]!;
        const place = chars.length - index - 1;
        if (digit === 0) {
            pendingZero = label.length > 0 && chars.slice(index + 1).some((next) => next > 0);
            continue;
        }
        if (pendingZero) {
            label += '零';
            pendingZero = false;
        }
        if (!(digit === 1 && place === 1 && label.length === 0)) {
            label += digits[digit];
        }
        label += units[place] || '';
    }
    return label || '零';
}

function toSequenceMarker(value: number, alphabet: string): string {
    const chars = Array.from(alphabet);
    if (chars.length === 0) return String(Math.max(1, Math.floor(value)));
    let n = Math.max(1, Math.floor(value));
    let label = '';
    while (n > 0) {
        n -= 1;
        label = chars[n % chars.length] + label;
        n = Math.floor(n / chars.length);
    }
    return label;
}

function generatedMarkerText(style: ListMarkerStyle, ordinal: number): string {
    switch (style) {
        case 'circle':
            return '◦';
        case 'square':
            return '▪';
        case 'arabic-indic':
            return `${toMappedDigitMarker(ordinal, '٠١٢٣٤٥٦٧٨٩')}.`;
        case 'extended-arabic-indic':
            return `${toMappedDigitMarker(ordinal, '۰۱۲۳۴۵۶۷۸۹')}.`;
        case 'devanagari':
            return `${toMappedDigitMarker(ordinal, '०१२३४५६७८९')}.`;
        case 'thai':
            return `${toMappedDigitMarker(ordinal, '๐๑๒๓๔๕๖๗๘๙')}.`;
        case 'cjk-decimal':
            return `${toCjkDecimalMarker(ordinal)}.`;
        case 'cjk-ideographic':
            return `${toCjkIdeographicMarker(ordinal)}.`;
        case 'hiragana':
            return `${toSequenceMarker(ordinal, 'あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわをん')}.`;
        case 'katakana':
            return `${toSequenceMarker(ordinal, 'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン')}.`;
        case 'lower-alpha':
            return `${toAlphaMarker(ordinal, false)}.`;
        case 'upper-alpha':
            return `${toAlphaMarker(ordinal, true)}.`;
        case 'lower-roman':
            return `${toRomanMarker(ordinal, false)}.`;
        case 'upper-roman':
            return `${toRomanMarker(ordinal, true)}.`;
        case 'decimal':
            return `${ordinal}.`;
        case 'disc':
        case 'bullet':
        default:
            return '•';
    }
}

function resolveSpatialBaseIndent(element: Element): number {
    const value = Number(element.properties?._listSpatialBaseIndent ?? 0);
    return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function resolveContainmentDirective(element: Element): Record<string, unknown> | null {
    const directive = (element.properties?.space ?? element.properties?.spatialField) as Record<string, unknown> | undefined;
    return directive?.kind === 'contain' ? directive : null;
}

function stripContainerGeometryFromMarkerStyle(style: ElementStyle): ElementStyle {
    const {
        backgroundColor: _backgroundColor,
        borderColor: _borderColor,
        height: _height,
        minHeight: _minHeight,
        maxHeight: _maxHeight,
        padding: _padding,
        paddingTop: _paddingTop,
        paddingRight: _paddingRight,
        paddingBottom: _paddingBottom,
        paddingLeft: _paddingLeft,
        borderWidth: _borderWidth,
        borderTopWidth: _borderTopWidth,
        borderRightWidth: _borderRightWidth,
        borderBottomWidth: _borderBottomWidth,
        borderLeftWidth: _borderLeftWidth,
        ...markerStyle
    } = style;
    return markerStyle;
}

function addSpatialBaseIndent(element: Element, indent: number): Element {
    const nextIndent = resolveSpatialBaseIndent(element) + Math.max(0, Number(indent || 0));
    if (nextIndent <= 0) return element;
    return {
        ...element,
        properties: {
            ...(element.properties || {}),
            _listSpatialBaseIndent: nextIndent
        }
    };
}

function projectLineBoxIntoContainedHostFrame(
    box: Box,
    hostFrame: ContainedHostFrame,
    lineYBase: number = Number(box.y || 0)
): Box {
    const sourceY = Number(box.y || 0);
    const sourceX = Number(box.x || 0);
    const props = box.properties || {};
    const lineCount = Array.isArray(box.lines) ? box.lines.length : 0;
    const lineOffsets = Array.isArray(props._lineOffsets)
        ? props._lineOffsets.map((value) => Number(value || 0) + sourceX - hostFrame.x)
        : (lineCount > 0 ? new Array(lineCount).fill(Math.max(0, sourceX - hostFrame.x)) : []);
    const lineWidths = Array.isArray(props._lineWidths)
        ? props._lineWidths.map((value) => Number(value || 0))
        : (lineCount > 0 ? new Array(lineCount).fill(Math.max(0, Number(box.w || 0))) : []);
    const sourceLineYOffsets = Array.isArray(props._lineYOffsets) ? props._lineYOffsets : [];
    const firstSourceLineY = Number(sourceLineYOffsets[0] || 0);
    const lineYOffsets = sourceLineYOffsets.length > 0
        ? sourceLineYOffsets.map((value) => Number(value || 0) - firstSourceLineY + lineYBase - hostFrame.y)
        : (lineCount > 0 ? new Array(lineCount).fill(Math.max(0, lineYBase - hostFrame.y)) : []);
    return {
        ...box,
        x: hostFrame.x,
        y: hostFrame.y,
        w: hostFrame.w,
        h: hostFrame.h,
        properties: {
            ...props,
            ...hostFrame.clipProperties,
            ...(lineOffsets.length > 0 ? { _lineOffsets: lineOffsets } : {}),
            ...(lineWidths.length > 0 ? { _lineWidths: lineWidths } : {}),
            ...(lineYOffsets.length > 0 ? { _lineYOffsets: lineYOffsets } : {})
        }
    };
}

function firstLineBaselineOffset(box: Box): number | null {
    const lines = Array.isArray(box.lines) ? box.lines : [];
    const firstLine = lines[0];
    if (!Array.isArray(firstLine) || firstLine.length === 0) return null;
    const style = box.style || {};
    const baseFontSize = Number(style.fontSize || 12);
    const maxFontSize = firstLine.reduce(
        (max, segment) => Math.max(max, Number(segment?.style?.fontSize || baseFontSize)),
        baseFontSize
    );
    const maxAscent = firstLine.reduce(
        (max, segment) => Math.max(max, Number(segment?.ascent || 0)),
        0
    );
    if (!Number.isFinite(maxAscent) || maxAscent <= 0) return null;
    const lineYOffsets = Array.isArray(box.properties?._lineYOffsets) ? box.properties._lineYOffsets : [];
    const firstLineY = Number.isFinite(Number(lineYOffsets[0])) ? Number(lineYOffsets[0]) : 0;
    return firstLineY + (maxAscent / 1000) * maxFontSize;
}

function alignMarkerBoxesToBodyBaseline(markerBoxes: Box[], bodyBoxes: Box[]): Box[] {
    if (markerBoxes.length === 0) return markerBoxes;
    const markerBox = markerBoxes.find((box) => firstLineBaselineOffset(box) !== null);
    const bodyBox = bodyBoxes.find((box) => firstLineBaselineOffset(box) !== null);
    if (!markerBox || !bodyBox) return markerBoxes;
    const markerBaseline = Number(markerBox.y || 0) + (firstLineBaselineOffset(markerBox) ?? 0);
    const bodyBaseline = Number(bodyBox.y || 0) + (firstLineBaselineOffset(bodyBox) ?? 0);
    const dy = bodyBaseline - markerBaseline;
    if (!Number.isFinite(dy) || Math.abs(dy) < 0.01) return markerBoxes;
    return markerBoxes.map((box) => ({
        ...box,
        y: Number(box.y || 0) + dy,
        properties: { ...(box.properties || {}) },
        meta: box.meta ? { ...box.meta } : box.meta
    }));
}

function cloneListWithItems(
    source: Element,
    items: Element[],
    start: number,
    itemSourceOffset: number,
    extraProperties?: Record<string, unknown>
): Element {
    return {
        ...source,
        list: {
            ...(source.list || {}),
            start
        },
        properties: {
            ...(source.properties || {}),
            _listItemSourceOffset: itemSourceOffset,
            ...(extraProperties || {})
        },
        children: items
    };
}

class FrozenListPackager implements PackagerUnit {
    readonly actorId: string;
    readonly sourceId: string;
    readonly actorKind: string;
    readonly fragmentIndex: number;
    readonly continuationOf?: string;

    constructor(
        private readonly frozenBoxes: Box[],
        private readonly frozenHeight: number,
        identity: PackagerIdentity
    ) {
        this.actorId = identity.actorId;
        this.sourceId = identity.sourceId;
        this.actorKind = identity.actorKind;
        this.fragmentIndex = identity.fragmentIndex;
        this.continuationOf = identity.continuationOf;
    }

    prepare(_availableWidth: number, _availableHeight: number, _context: PackagerContext): void {}

    prepareLookahead(_availableWidth: number, _availableHeight: number, _context: PackagerContext): void {}

    getPlacementPreference(_fullAvailableWidth: number, _context: PackagerContext): PackagerPlacementPreference | null {
        return null;
    }

    getReshapeProfile(): PackagerReshapeProfile {
        return {
            capabilities: [
                { kind: 'split', preservesIdentity: true, producesContinuation: true }
            ]
        };
    }

    emitBoxes(_availableWidth: number, _availableHeight: number, _context: PackagerContext): LayoutBox[] {
        return this.frozenBoxes.map((box) => ({
            ...box,
            properties: { ...(box.properties || {}) },
            meta: box.meta ? { ...box.meta } : box.meta
        }));
    }

    reshape(_availableHeight: number, _context: PackagerContext): PackagerReshapeResult {
        return { currentFragment: null, continuationFragment: this };
    }

    getRequiredHeight(): number {
        return this.frozenHeight;
    }

    isUnbreakable(_availableHeight: number): boolean {
        return true;
    }

    getLeadingSpacing(): number {
        return 0;
    }

    getTrailingSpacing(): number {
        return 0;
    }
}

export class ListPackager implements PackagerUnit {
    private readonly listElement: Element;
    private readonly processor: LayoutProcessor;
    private readonly identityPath: number[];
    private readonly normalizedList: NormalizedList;
    private preparedItems: PreparedListItem[] = [];
    private lastAvailableWidth: number = -1;
    private preparedMode: PreparedListMode = 'none';
    private requiredHeight: number = 0;
    private marginTop: number = 0;
    private marginBottom: number = 0;
    private listStyle: ElementStyle = {};
    private readonly continuationActorsByItem: Map<number, HostedRegionActorEntry[]>;
    private readonly suppressFirstMarker: boolean;
    private containedBackgroundBox: Box | null = null;

    readonly actorId: string;
    readonly sourceId: string;
    readonly actorKind: string;
    readonly fragmentIndex: number;
    readonly continuationOf?: string;
    readonly pageBreakBefore: boolean = false;
    readonly keepWithNext: boolean = false;

    constructor(
        listElement: Element,
        processor: LayoutProcessor,
        identity?: PackagerIdentity,
        continuationActorsByItem?: Map<number, HostedRegionActorEntry[]>,
        suppressFirstMarker?: boolean
    ) {
        this.listElement = listElement;
        this.processor = processor;
        this.normalizedList = normalizeListElement(listElement);
        this.continuationActorsByItem = continuationActorsByItem ?? new Map();
        this.suppressFirstMarker = suppressFirstMarker ?? listElement.properties?._suppressFirstMarker === true;
        const resolvedIdentity = identity ?? createElementPackagerIdentity(listElement, [0]);
        this.actorId = resolvedIdentity.actorId;
        this.sourceId = resolvedIdentity.sourceId;
        this.actorKind = resolvedIdentity.actorKind;
        this.fragmentIndex = resolvedIdentity.fragmentIndex;
        this.continuationOf = resolvedIdentity.continuationOf;
        this.identityPath = Array.isArray(resolvedIdentity.path) && resolvedIdentity.path.length ? resolvedIdentity.path : [0];
        this.refreshListFlowMetrics();
    }

    private shapeFlowElement(element: Element, path: number[]): FlowBox {
        const shaper = this.processor as unknown as ElementShaper;
        return shaper.shapeNormalizedFlowBlock(shaper.normalizeFlowBlock(element, { path }));
    }

    private refreshListFlowMetrics(): void {
        const listFlow = this.shapeFlowElement(this.listElement, this.identityPath);
        this.listStyle = listFlow.style;
        this.marginTop = listFlow.marginTop;
        this.marginBottom = listFlow.marginBottom;
    }

    private resolveListMetrics(): { indent: number; markerGap: number; markerWidth: number } {
        const fontSize = Number(this.listStyle.fontSize || (this.processor as any).config?.layout?.fontSize || 12);
        const indent = this.normalizedList.indent ?? Math.max(18, fontSize * 2);
        const markerGap = this.normalizedList.markerGap ?? Math.max(4, fontSize * 0.45);
        const markerWidth = this.normalizedList.markerWidth ?? Math.max(0, indent - markerGap);
        return {
            indent,
            markerGap: Math.min(Math.max(0, markerGap), indent),
            markerWidth: Math.min(Math.max(0, markerWidth), indent)
        };
    }

    private resolveItemSpacing(itemIndex: number): number {
        if (itemIndex >= this.normalizedList.items.length - 1) return 0;
        return Math.max(0, this.normalizedList.itemSpacing ?? 0);
    }

    private applyNestedListSpacing(element: Element): Element {
        const before = Math.max(0, this.normalizedList.nestedListSpacingBefore ?? 0);
        const after = Math.max(0, this.normalizedList.nestedListSpacingAfter ?? 0);
        if (before <= 0 && after <= 0) return element;
        const style = (element.properties?.style || {}) as ElementStyle;
        return {
            ...element,
            properties: {
                ...(element.properties || {}),
                style: {
                    ...style,
                    marginTop: LayoutUtils.validateUnit(style.marginTop ?? 0) + before,
                    marginBottom: LayoutUtils.validateUnit(style.marginBottom ?? 0) + after
                }
            }
        };
    }

    private createLeadBodyElement(
        item: Element,
        itemIndex: number,
        bodyWidth: number,
        inlineChildren: Element[]
    ): Element {
        const sourceIndex = Math.max(0, Math.floor(Number(this.listElement.properties?._listItemSourceOffset ?? 0))) + itemIndex;
        const itemStyle = {
            ...(item.properties?.style || {}),
            width: Math.max(0, bodyWidth)
        };
        return {
            ...item,
            type: 'list-item',
            children: inlineChildren,
            properties: {
                ...(item.properties || {}),
                sourceId: item.properties?.sourceId ?? `${this.sourceId}:item-${sourceIndex}`,
                style: itemStyle,
                _listItemIndex: sourceIndex,
                _listItemOrdinal: this.normalizedList.start + itemIndex,
                _listKind: this.normalizedList.kind
            }
        };
    }

    private createBodyElements(item: Element, itemIndex: number, bodyWidth: number): Element[] {
        const children = Array.isArray(item.children) ? item.children : [];
        const inlineChildren = children.filter((child) => !isBlockListItemChild(child));
        const blockChildren = children.filter(isBlockListItemChild).map((child) => this.prepareNestedBlockChild(child));
        const hasLeadContent = String(item.content || '').length > 0 || inlineChildren.length > 0 || blockChildren.length === 0;
        const elements: Element[] = [];
        if (hasLeadContent) {
            elements.push(this.createLeadBodyElement(item, itemIndex, bodyWidth, inlineChildren));
        }
        elements.push(...blockChildren);
        return elements;
    }

    private prepareNestedBlockChild(element: Element): Element {
        if (String(element.type || '').trim().toLowerCase() !== 'list') return element;
        const spacedElement = this.applyNestedListSpacing(element);
        if (this.normalizedList.levels.length === 0 && !Array.isArray(spacedElement.list?.levels)) return spacedElement;
        const childOwnsLevels = Array.isArray(spacedElement.list?.levels);
        const inheritedLevels = childOwnsLevels ? spacedElement.list!.levels : this.normalizedList.levels;
        const levelIndex = childOwnsLevels ? 0 : this.normalizedList.levelIndex + 1;
        return {
            ...spacedElement,
            properties: {
                ...(spacedElement.properties || {}),
                _listInheritedLevels: inheritedLevels.map((entry) => ({ ...entry })),
                _listLevelIndex: levelIndex
            }
        };
    }

    private createMarkerElement(item: Element, itemIndex: number, markerWidth: number): Element {
        const ordinal = this.normalizedList.start + itemIndex;
        const sourceIndex = Math.max(0, Math.floor(Number(this.listElement.properties?._listItemSourceOffset ?? 0))) + itemIndex;
        const sourceId = item.properties?.sourceId ?? `${this.sourceId}:item-${sourceIndex}`;
        const markerStyle = {
            ...stripContainerGeometryFromMarkerStyle(this.listStyle || {}),
            ...(((this.processor as any).config?.styles?.['list-marker'] as ElementStyle | undefined) || {}),
            ...this.normalizedList.markerTextStyle,
            textAlign: 'right',
            width: markerWidth,
            marginTop: 0,
            marginBottom: 0
        };
        return {
            type: 'list-marker',
            content: this.normalizedList.markerText ?? generatedMarkerText(this.normalizedList.markerStyle, ordinal),
            properties: {
                sourceId: `${sourceId}:marker`,
                style: markerStyle,
                _listItemIndex: sourceIndex,
                _listItemOrdinal: ordinal,
                _listKind: this.normalizedList.kind,
                _listMarker: true
            }
        };
    }

    private buildBodyActors(item: Element, itemIndex: number, bodyWidth: number): HostedRegionActorEntry[] {
        const continuationActors = this.continuationActorsByItem.get(itemIndex);
        if (continuationActors) return continuationActors;
        const bodyElements = this.createBodyElements(item, itemIndex, bodyWidth);
        return bodyElements.map((element, bodyIndex) => ({
            element,
            actor: buildPackagerForElement(
                element,
                bodyIndex,
                this.processor,
                bodyElements,
                undefined,
                [...this.identityPath, itemIndex, 1, bodyIndex]
            )
        }));
    }

    private createPreparedMarker(
        item: Element,
        itemIndex: number,
        markerWidth: number,
        markerX: number,
        availableWidth: number,
        availableHeight: number,
        context: PackagerContext
    ): FlowBoxPackager | null {
        if (this.suppressFirstMarker && itemIndex === 0) return null;
        const markerElement = this.createMarkerElement(item, itemIndex, markerWidth);
        const markerFlow = this.shapeFlowElement(markerElement, [...this.identityPath, itemIndex, 0]);
        markerFlow.style = {
            ...markerFlow.style,
            marginLeft: LayoutUtils.validateUnit(markerFlow.style.marginLeft ?? 0) + markerX,
            width: markerWidth
        };
        markerFlow.marginTop = 0;
        markerFlow.marginBottom = 0;
        const marker = new FlowBoxPackager(this.processor, markerFlow);
        marker.prepare(availableWidth, availableHeight, context);
        return marker;
    }

    private materializeBody(
        item: Element,
        itemIndex: number,
        bodyWidth: number,
        indent: number,
        context: PackagerContext
    ): HostedRegionSessionResult {
        const actors = this.buildBodyActors(item, itemIndex, bodyWidth);
        const bodyQueue: HostedRegionActorQueue = {
            rect: { x: 0, y: 0, width: bodyWidth },
            actors
        };
        const body = runHostedRegionSession(
            bodyQueue,
            createHostedRegionSessionContextBase(bodyWidth, this.processor, context)
        );
        return this.offsetBodyBoxes(body, indent, context);
    }

    private createSpatialLeadBodyElement(
        item: Element,
        itemIndex: number,
        availableWidth: number,
        bodyIndent: number,
        inlineChildren: Element[]
    ): Element {
        const lead = this.createLeadBodyElement(item, itemIndex, availableWidth, inlineChildren);
        const style = (lead.properties?.style || {}) as ElementStyle;
        return {
            ...lead,
            properties: {
                ...(lead.properties || {}),
                ...(resolveContainmentDirective(this.listElement)
                    ? { space: { kind: 'contain' } }
                    : {}),
                style: {
                    ...style,
                    width: Math.max(0, availableWidth),
                    paddingLeft: resolveContainmentDirective(this.listElement)
                        ? LayoutUtils.validateUnit(style.paddingLeft ?? style.padding ?? 0)
                        : LayoutUtils.validateUnit(style.paddingLeft ?? style.padding ?? 0) + bodyIndent
                }
            }
        };
    }

    private sliceSourceElement(
        element: Element,
        lines: RichLine[],
        consumedLineCount: number
    ): Element {
        const renderedText: string = (this.processor as any).getJoinedLineText(
            lines.slice(0, consumedLineCount)
        );
        const sourceText: string = (this.processor as any).getElementText(element);
        const consumedChars: number = (this.processor as any).resolveConsumedSourceChars(
            sourceText,
            renderedText
        );
        const remaining = Math.max(0, sourceText.length - consumedChars);

        let continuation: Element;
        if (Array.isArray(element.children) && element.children.length > 0) {
            continuation = {
                ...element,
                content: '',
                children: (this.processor as any).sliceElements(
                    element.children,
                    consumedChars,
                    consumedChars + remaining
                )
            };
        } else {
            continuation = {
                ...element,
                content: sourceText.slice(consumedChars)
            };
        }

        const beforeTrimLength = (this.processor as any).getElementText(continuation).length;
        const trimmed = (this.processor as any).trimLeadingContinuationWhitespace(continuation) as Element;
        const trimDelta = Math.max(
            0,
            beforeTrimLength - (this.processor as any).getElementText(trimmed).length
        );
        const sourceSliceStart = Math.max(
            0,
            Number(element.properties?._sourceSliceStart || 0) + consumedChars + trimDelta
        );

        return {
            ...trimmed,
            properties: {
                ...(trimmed.properties || {}),
                _sourceSliceStart: sourceSliceStart
            }
        } as Element;
    }

    private createMarkerBoxesAt(
        item: Element,
        itemIndex: number,
        markerWidth: number,
        desiredX: number,
        desiredLocalY: number,
        availableWidth: number,
        availableHeight: number,
        context: PackagerContext
    ): Box[] {
        if (this.suppressFirstMarker && itemIndex === 0) return [];
        const marker = this.createPreparedMarker(
            item,
            itemIndex,
            markerWidth,
            0,
            availableWidth,
            availableHeight,
            {
                ...context,
                cursorY: 0,
                margins: { ...context.margins, left: 0 }
            }
        );
        const emitted = marker?.emitBoxes(availableWidth, availableHeight, {
            ...context,
            cursorY: 0,
            margins: { ...context.margins, left: 0 }
        }) || [];
        if (emitted.length === 0) return [];
        const anchor = emitted[0]!;
        const dx = desiredX - Number(anchor.x || 0);
        const dy = desiredLocalY - Number(anchor.y || 0);
        return emitted.map((box) => ({
            ...box,
            x: Number(box.x || 0) + dx,
            y: Number(box.y || 0) + dy,
            properties: { ...(box.properties || {}) },
            meta: box.meta ? { ...box.meta } : box.meta
        }));
    }

    private tryPrepareItemsAgainstSpatialField(
        availableWidth: number,
        availableHeight: number,
        context: PackagerContext
    ): boolean {
        const spatialMap = context.spatialMap;
        if (!spatialMap) return false;
        if (spatialMap.maxObstacleBottom() <= Number(context.cursorY || 0) + 0.1) return false;

        this.refreshListFlowMetrics();
        const { indent, markerGap, markerWidth } = this.resolveListMetrics();
        const baseIndent = resolveSpatialBaseIndent(this.listElement);
        const bodyIndent = baseIndent + indent;
        const markerColumnWidth = markerWidth + markerGap;
        const usesContainmentLanes = !!resolveContainmentDirective(this.listElement);
        const containedLeadingInset = baseIndent + markerColumnWidth;
        const leadBodyIndent = bodyIndent;
        const containedHostFrame = usesContainmentLanes
            ? this.resolveContainedHostFrame(availableWidth, context)
            : null;
        const opticalUnderhang = !!((this.processor as any).config?.layout?.storyWrapOpticalUnderhang);
        const microLanePolicy = resolveDocumentMicroLanePolicy((this.processor as any).config?.layout);
        const minUsableSlotWidth = resolveMinUsableLaneWidth({
            policy: microLanePolicy,
            element: this.listElement,
            availableWidth
        });
        let cursorY = this.marginTop;
        const preparedItems: PreparedListItem[] = [];

        for (let itemIndex = 0; itemIndex < this.normalizedList.items.length; itemIndex++) {
            const item = this.normalizedList.items[itemIndex]!;
            const children = Array.isArray(item.children) ? item.children : [];
            const inlineChildren = children.filter((child) => !isBlockListItemChild(child));
            const blockChildren = children.filter(isBlockListItemChild).map((child) => this.prepareNestedBlockChild(child));
            const hasLeadContent = String(item.content || '').length > 0 || inlineChildren.length > 0 || blockChildren.length === 0;
            const itemStartY = cursorY;
            const itemBoxes: Box[] = [];
            let markerBoxes: Box[] = [];

            if (hasLeadContent) {
                const leadElement = this.createSpatialLeadBodyElement(
                    item,
                    itemIndex,
                    availableWidth,
                    leadBodyIndent,
                    inlineChildren
                );
                const leadFlow = this.shapeFlowElement(leadElement, [...this.identityPath, itemIndex, 1, 0]);
                const placed = reflowTextElementAgainstSpatialField({
                    processor: this.processor,
                    element: leadElement,
                    path: [...this.identityPath, itemIndex, 1, 0],
                    sourceFlowBox: leadFlow,
                    availableWidth,
                    currentY: Number(context.cursorY || 0) + cursorY,
                    layoutBefore: 0,
                    spatialMap,
                    leftMargin: context.margins.left,
                    pageIndex: context.pageIndex,
                    opticalUnderhang,
                    clearTopBeforeStart: true,
                    minUsableSlotWidth,
                    rejectSubMinimumSlots: microLanePolicy !== 'allow',
                    microLanePolicy,
                    ...(usesContainmentLanes ? { slotLeadingInset: containedLeadingInset } : {}),
                    ...(Number.isFinite(resolvePackagerChunkOriginWorldY(context))
                        ? { worldY: Number(resolvePackagerChunkOriginWorldY(context)) + cursorY }
                        : {})
                });
                if (!placed) return false;
                const localTop = Number(placed.box.y || 0) - Number(context.cursorY || 0);
                const lineOffsets = placed.lineOffsets.slice();
                const leadBox: Box = {
                    ...placed.box,
                    y: localTop,
                    properties: {
                        ...(placed.box.properties || {}),
                        _lineOffsets: lineOffsets,
                        _lineWidths: placed.lineWidths.slice(),
                        _lineYOffsets: placed.lineYOffsets.slice()
                    },
                    meta: placed.box.meta
                        ? {
                            ...placed.box.meta,
                            actorId: this.actorId,
                            sourceId: placed.box.meta.sourceId ?? this.sourceId
                        }
                        : placed.box.meta
                };
                itemBoxes.push(containedHostFrame
                    ? projectLineBoxIntoContainedHostFrame(leadBox, containedHostFrame, localTop)
                    : leadBox);

                const firstLineOffset = Number(lineOffsets[0] || 0);
                const firstLineY = Number(placed.lineYOffsets[0] || 0);
                const markerX = Number(context.margins.left || 0) + firstLineOffset
                    + (usesContainmentLanes ? 0 : leadBodyIndent)
                    - markerGap - markerWidth;
                const rawMarkerBoxes = this.createMarkerBoxesAt(
                    item,
                    itemIndex,
                    markerWidth,
                    markerX,
                    localTop + firstLineY,
                    availableWidth,
                    availableHeight,
                    context
                );
                const alignedRawMarkerBoxes = alignMarkerBoxesToBodyBaseline(rawMarkerBoxes, [leadBox]);
                markerBoxes = alignedRawMarkerBoxes;
                if (containedHostFrame) {
                    markerBoxes = alignedRawMarkerBoxes.map((box) => projectLineBoxIntoContainedHostFrame(
                        box,
                        containedHostFrame,
                        Number(box.y || 0)
                    ));
                }
                cursorY = Math.max(
                    cursorY,
                    localTop + placed.contentHeight + placed.marginBottom,
                    ...alignedRawMarkerBoxes.map((box) => Number(box.y || 0) + Number(box.h || 0))
                );
            }

            for (let blockIndex = 0; blockIndex < blockChildren.length; blockIndex++) {
                const childElement = addSpatialBaseIndent(blockChildren[blockIndex]!, leadBodyIndent);
                const actor = buildPackagerForElement(
                    childElement,
                    blockIndex,
                    this.processor,
                    blockChildren,
                    undefined,
                    [...this.identityPath, itemIndex, 2, blockIndex]
                );
                const childContext: PackagerContext = {
                    ...context,
                    cursorY: Number(context.cursorY || 0) + cursorY,
                    pageWidth: availableWidth,
                    contentWidthOverride: undefined,
                    spatialMap
                };
                actor.prepare(availableWidth, availableHeight, childContext);
                const emitted = actor.emitBoxes(availableWidth, availableHeight, childContext) || [];
                for (const box of emitted) {
                    itemBoxes.push({
                        ...box,
                        y: Number(box.y || 0) + cursorY,
                        properties: { ...(box.properties || {}) },
                        meta: box.meta ? { ...box.meta } : box.meta
                    });
                }
                cursorY += actor.getRequiredHeight();
            }

            const itemSpacing = this.resolveItemSpacing(itemIndex);
            const itemHeight = Math.max(0, cursorY - itemStartY) + itemSpacing;
            preparedItems.push({
                marker: null,
                markerBoxes,
                body: {
                    boxes: itemBoxes,
                    height: itemHeight
                },
                height: itemHeight,
                y: 0
            });
            cursorY += itemSpacing;
        }

        this.preparedItems = preparedItems;
        this.requiredHeight = cursorY + this.marginBottom;
        this.lastAvailableWidth = availableWidth;
        this.preparedMode = 'spatial';
        this.containedBackgroundBox = resolveContainmentDirective(this.listElement)
            ? this.createContainedBackgroundBox(availableWidth, context)
            : null;
        return true;
    }

    private resolveContainedHostFrame(availableWidth: number, context: PackagerContext): ContainedHostFrame | null {
        if (!resolveContainmentDirective(this.listElement)) return null;
        const style = (this.listElement.properties?.style || {}) as ElementStyle;
        const width = resolveContainedHostWidth(this.listElement, availableWidth);
        const height = Number(style.height);
        if (!(Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0)) return null;
        return {
            x: LayoutUtils.validateUnit(context.margins?.left ?? 0),
            y: this.marginTop,
            w: width,
            h: height,
            clipProperties: new SpatialFieldGeometryCapability(this.listElement).buildClipProperties()
        };
    }

    private createContainedBackgroundBox(availableWidth: number, context: PackagerContext): Box | null {
        const directive = resolveContainmentDirective(this.listElement);
        if (!directive) return null;
        const style = (this.listElement.properties?.style || {}) as ElementStyle;
        if (!style.backgroundColor && !style.borderColor && !style.borderWidth) return null;
        const width = resolveContainedHostWidth(this.listElement, availableWidth);
        const height = Number(style.height);
        if (!(Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0)) return null;
        const clipProperties = new SpatialFieldGeometryCapability(this.listElement).buildClipProperties();
        return {
            type: 'field-actor',
            x: LayoutUtils.validateUnit(context.margins?.left ?? 0),
            y: this.marginTop,
            w: width,
            h: height,
            lines: [],
            style: {
                ...style,
                zIndex: Number.isFinite(Number(style.zIndex)) ? Number(style.zIndex) : -1
            },
            properties: {
                ...(this.listElement.properties || {}),
                ...clipProperties,
                _containedListBackground: true
            },
            meta: {
                actorId: this.actorId,
                sourceId: `${this.sourceId}:contained-background`,
                engineKey: `${this.actorId}:contained-background`,
                sourceType: 'list-background',
                fragmentIndex: this.fragmentIndex,
                isContinuation: false
            }
        };
    }

    private offsetBodyBoxes(body: HostedRegionSessionResult, indent: number, context: PackagerContext): HostedRegionSessionResult {
        const parentLeft = LayoutUtils.validateUnit(context.margins?.left ?? 0);
        return {
            ...body,
            boxes: body.boxes.map((box) => ({
                ...box,
                x: Number(box.x || 0) + parentLeft + indent
            }))
        };
    }

    private prepareItems(availableWidth: number, availableHeight: number, context: PackagerContext): void {
        this.containedBackgroundBox = null;
        const containmentDirective = resolveContainmentDirective(this.listElement);
        if (containmentDirective) {
            const containedWidth = resolveContainedHostWidth(this.listElement, availableWidth);
            const containedMap = buildContainedSpatialMap(this.listElement);
            const containedContext: PackagerContext = {
                ...context,
                cursorY: 0,
                pageWidth: containedWidth,
                contentWidthOverride: undefined,
                spatialMap: containedMap
            };
            if (this.tryPrepareItemsAgainstSpatialField(containedWidth, availableHeight, containedContext)) {
                const style = (this.listElement.properties?.style || {}) as ElementStyle;
                const hostHeight = Number(style.height);
                if (Number.isFinite(hostHeight) && hostHeight > 0) {
                    this.requiredHeight = Math.max(
                        this.requiredHeight,
                        this.marginTop + hostHeight + this.marginBottom
                    );
                }
                return;
            }
        }
        if (this.tryPrepareItemsAgainstSpatialField(availableWidth, availableHeight, context)) return;
        if (this.preparedMode === 'rectangular' && this.lastAvailableWidth === availableWidth && this.preparedItems.length > 0) return;

        this.refreshListFlowMetrics();

        const { indent, markerGap, markerWidth } = this.resolveListMetrics();
        const bodyWidth = Math.max(0, availableWidth - indent);
        const markerX = Math.max(0, indent - markerGap - markerWidth);
        let cursorY = this.marginTop;

        this.preparedItems = this.normalizedList.items.map((item, itemIndex) => {
            const marker = this.createPreparedMarker(
                item,
                itemIndex,
                markerWidth,
                markerX,
                availableWidth,
                availableHeight,
                context
            );
            const body = this.materializeBody(item, itemIndex, bodyWidth, indent, context);
            const height = Math.max(body.height, marker?.getRequiredHeight() ?? 0) + this.resolveItemSpacing(itemIndex);
            const prepared = {
                marker,
                body,
                height,
                y: cursorY
            };
            cursorY += height;
            return prepared;
        });

        this.requiredHeight = cursorY + this.marginBottom;
        this.lastAvailableWidth = availableWidth;
        this.preparedMode = 'rectangular';
    }

    prepare(availableWidth: number, availableHeight: number, context: PackagerContext): void {
        this.prepareItems(availableWidth, availableHeight, context);
    }

    prepareLookahead(availableWidth: number, availableHeight: number, context: PackagerContext): void {
        this.prepare(availableWidth, availableHeight, context);
    }

    getPlacementPreference(_fullAvailableWidth: number, _context: PackagerContext): PackagerPlacementPreference | null {
        return null;
    }

    getReshapeProfile(): PackagerReshapeProfile {
        return {
            capabilities: [
                {
                    kind: 'split',
                    preservesIdentity: true,
                    producesContinuation: true
                },
                {
                    kind: 'morph',
                    preservesIdentity: true,
                    reflowsContent: true
                }
            ]
        };
    }

    emitBoxes(availableWidth: number, availableHeight: number, context: PackagerContext): LayoutBox[] {
        this.prepare(availableWidth, availableHeight, context);
        const boxes: Box[] = [];
        if (this.containedBackgroundBox) {
            boxes.push({
                ...this.containedBackgroundBox,
                properties: { ...(this.containedBackgroundBox.properties || {}) },
                meta: this.containedBackgroundBox.meta ? { ...this.containedBackgroundBox.meta } : this.containedBackgroundBox.meta
            });
        }
        for (const item of this.preparedItems) {
            const markerBoxes = item.markerBoxes ?? item.marker?.emitBoxes(availableWidth, availableHeight, context) ?? [];
            const bodyBoxes = item.body.boxes;
            const alignedMarkerBoxes = item.markerBoxes ? markerBoxes : alignMarkerBoxesToBodyBaseline(markerBoxes, bodyBoxes);
            for (const box of [...alignedMarkerBoxes, ...bodyBoxes]) {
                boxes.push({
                    ...box,
                    y: Number(box.y || 0) + item.y
                });
            }
        }
        return boxes;
    }

    reshape(availableHeight: number, context: PackagerContext): PackagerReshapeResult {
        const fallbackWidth = Math.max(0, context.pageWidth - context.margins.left - context.margins.right);
        this.prepare(this.lastAvailableWidth > 0 ? this.lastAvailableWidth : fallbackWidth, availableHeight, context);
        let consumed = this.marginTop;
        let splitIndex = 0;
        for (const item of this.preparedItems) {
            if (consumed + item.height > availableHeight) break;
            consumed += item.height;
            splitIndex += 1;
        }

        const partialSplit = this.trySplitItemAtBoundary(splitIndex, consumed, availableHeight, context);
        if (partialSplit) return partialSplit;

        if (splitIndex <= 0 || splitIndex >= this.normalizedList.items.length) {
            return { currentFragment: null, continuationFragment: this };
        }

        const currentItems = this.normalizedList.items.slice(0, splitIndex);
        const continuationItems = this.normalizedList.items.slice(splitIndex);
        const sourceOffset = Math.max(0, Math.floor(Number(this.listElement.properties?._listItemSourceOffset ?? 0)));
        const currentElement = cloneListWithItems(this.listElement, currentItems, this.normalizedList.start, sourceOffset);
        const continuationStart = this.normalizedList.start + splitIndex;
        const continuationElement = cloneListWithItems(this.listElement, continuationItems, continuationStart, sourceOffset + splitIndex);
        return {
            currentFragment: new ListPackager(currentElement, this.processor, {
                actorId: this.actorId,
                sourceId: this.sourceId,
                actorKind: this.actorKind,
                fragmentIndex: this.fragmentIndex,
                continuationOf: this.continuationOf,
                path: this.identityPath
            }),
            continuationFragment: new ListPackager(
                continuationElement,
                this.processor,
                createContinuationIdentity(this, this.fragmentIndex + 1)
            )
        };
    }

    private collectPreparedBoxesThrough(itemCount: number, availableWidth: number, availableHeight: number, context: PackagerContext): Box[] {
        const boxes: Box[] = [];
        for (const item of this.preparedItems.slice(0, Math.max(0, itemCount))) {
            const markerBoxes = item.markerBoxes ?? item.marker?.emitBoxes(availableWidth, availableHeight, context) ?? [];
            const bodyBoxes = item.body.boxes;
            const alignedMarkerBoxes = item.markerBoxes ? markerBoxes : alignMarkerBoxesToBodyBaseline(markerBoxes, bodyBoxes);
            for (const box of [...alignedMarkerBoxes, ...bodyBoxes]) {
                boxes.push({
                    ...box,
                    y: Number(box.y || 0) + item.y
                });
            }
        }
        return boxes;
    }

    private trySplitItemAtBoundary(
        itemIndex: number,
        consumedBeforeItem: number,
        availableHeight: number,
        context: PackagerContext
    ): PackagerReshapeResult | null {
        if (this.preparedMode === 'spatial') {
            return this.trySplitSpatialItemAtBoundary(itemIndex, consumedBeforeItem, availableHeight, context);
        }
        if (itemIndex < 0 || itemIndex >= this.normalizedList.items.length) return null;
        const remainingHeight = Math.max(0, availableHeight - consumedBeforeItem);
        if (remainingHeight <= 0) return null;

        const availableWidth = this.lastAvailableWidth > 0
            ? this.lastAvailableWidth
            : Math.max(0, context.pageWidth - context.margins.left - context.margins.right);
        const { indent, markerGap, markerWidth } = this.resolveListMetrics();
        const bodyWidth = Math.max(0, availableWidth - indent);
        const markerX = Math.max(0, indent - markerGap - markerWidth);
        const item = this.normalizedList.items[itemIndex];
        const actors = this.buildBodyActors(item, itemIndex, bodyWidth);
        const bodyQueue: HostedRegionActorQueue = {
            rect: { x: 0, y: 0, width: bodyWidth },
            actors
        };
        const bounded = runHostedRegionSessionBounded(
            bodyQueue,
            createHostedRegionSessionContextBase(bodyWidth, this.processor, context),
            remainingHeight
        );
        if (!bounded.hasOverflow || !bounded.continuation) return null;
        if (bounded.boxes.length === 0) return null;

        const leadingBody = this.offsetBodyBoxes(
            { boxes: bounded.boxes, height: bounded.height },
            indent,
            context
        );
        const marker = this.createPreparedMarker(
            item,
            itemIndex,
            markerWidth,
            markerX,
            availableWidth,
            remainingHeight,
            context
        );
        const markerBoxes = marker?.emitBoxes(availableWidth, remainingHeight, context) || [];
        const previousBoxes = this.collectPreparedBoxesThrough(itemIndex, availableWidth, availableHeight, context);
        const alignedMarkerBoxes = alignMarkerBoxesToBodyBaseline(markerBoxes, leadingBody.boxes);
        const itemBoxes = [...alignedMarkerBoxes, ...leadingBody.boxes].map((box) => ({
            ...box,
            y: Number(box.y || 0) + consumedBeforeItem
        }));
        const currentHeight = consumedBeforeItem + Math.max(leadingBody.height, marker?.getRequiredHeight() ?? 0);
        const sourceOffset = Math.max(0, Math.floor(Number(this.listElement.properties?._listItemSourceOffset ?? 0)));
        const continuationItems = this.normalizedList.items.slice(itemIndex);
        const continuationElement = cloneListWithItems(
            this.listElement,
            continuationItems,
            this.normalizedList.start + itemIndex,
            sourceOffset + itemIndex,
            { _suppressFirstMarker: true }
        );
        const continuationQueue = buildHostedRegionContinuationQueue(bodyQueue, bounded.continuation);
        return {
            currentFragment: new FrozenListPackager(
                [...previousBoxes, ...itemBoxes],
                currentHeight,
                {
                    actorId: this.actorId,
                    sourceId: this.sourceId,
                    actorKind: this.actorKind,
                    fragmentIndex: this.fragmentIndex,
                    continuationOf: this.continuationOf,
                    path: this.identityPath
                }
            ),
            continuationFragment: new ListPackager(
                continuationElement,
                this.processor,
                createContinuationIdentity(this, this.fragmentIndex + 1),
                new Map([[0, continuationQueue.actors]]),
                true
            )
        };
    }

    private trySplitSpatialItemAtBoundary(
        itemIndex: number,
        consumedBeforeItem: number,
        availableHeight: number,
        context: PackagerContext
    ): PackagerReshapeResult | null {
        const spatialMap = context.spatialMap;
        if (!spatialMap) return null;
        if (itemIndex < 0 || itemIndex >= this.normalizedList.items.length) return null;
        const remainingHeight = Math.max(0, availableHeight - consumedBeforeItem);
        if (remainingHeight <= 0) return null;

        const availableWidth = this.lastAvailableWidth > 0
            ? this.lastAvailableWidth
            : Math.max(0, context.pageWidth - context.margins.left - context.margins.right);
        const { indent, markerGap, markerWidth } = this.resolveListMetrics();
        const baseIndent = resolveSpatialBaseIndent(this.listElement);
        const bodyIndent = baseIndent + indent;
        const markerColumnWidth = markerWidth + markerGap;
        const usesContainmentLanes = !!resolveContainmentDirective(this.listElement);
        const containedLeadingInset = baseIndent + markerColumnWidth;
        const leadBodyIndent = bodyIndent;
        const containedHostFrame = usesContainmentLanes
            ? this.resolveContainedHostFrame(availableWidth, context)
            : null;
        const item = this.normalizedList.items[itemIndex];
        const children = Array.isArray(item.children) ? item.children : [];
        const inlineChildren = children.filter((child) => !isBlockListItemChild(child));
        const blockChildren = children.filter(isBlockListItemChild).map((child) => this.prepareNestedBlockChild(child));
        const hasLeadContent = String(item.content || '').length > 0 || inlineChildren.length > 0 || blockChildren.length === 0;
        const sourceOffset = Math.max(0, Math.floor(Number(this.listElement.properties?._listItemSourceOffset ?? 0)));
        const previousBoxes = this.collectPreparedBoxesThrough(itemIndex, availableWidth, availableHeight, context);
        const itemBoxes: Box[] = [];
        let cursorY = 0;

        if (hasLeadContent) {
            const leadElement = this.createSpatialLeadBodyElement(
                item,
                itemIndex,
                availableWidth,
                leadBodyIndent,
                inlineChildren
            );
            const leadFlow = this.shapeFlowElement(leadElement, [...this.identityPath, itemIndex, 1, 0]);
            const opticalUnderhang = !!((this.processor as any).config?.layout?.storyWrapOpticalUnderhang);
            const microLanePolicy = resolveDocumentMicroLanePolicy((this.processor as any).config?.layout);
            const minUsableSlotWidth = resolveMinUsableLaneWidth({
                policy: microLanePolicy,
                element: this.listElement,
                availableWidth
            });
            const placed = reflowTextElementAgainstSpatialField({
                processor: this.processor,
                element: leadElement,
                path: [...this.identityPath, itemIndex, 1, 0],
                sourceFlowBox: leadFlow,
                availableWidth,
                currentY: Number(context.cursorY || 0) + consumedBeforeItem,
                layoutBefore: 0,
                spatialMap,
                leftMargin: context.margins.left,
                pageIndex: context.pageIndex,
                opticalUnderhang,
                clearTopBeforeStart: true,
                minUsableSlotWidth,
                rejectSubMinimumSlots: microLanePolicy !== 'allow',
                microLanePolicy,
                ...(usesContainmentLanes ? { slotLeadingInset: containedLeadingInset } : {}),
                ...(Number.isFinite(resolvePackagerChunkOriginWorldY(context))
                    ? { worldY: Number(resolvePackagerChunkOriginWorldY(context)) + consumedBeforeItem }
                    : {})
            });
            if (!placed) return null;
            const localTop = Number(placed.box.y || 0) - Number(context.cursorY || 0);
            const leadBox: Box = {
                ...placed.box,
                y: localTop - consumedBeforeItem,
                properties: {
                    ...(placed.box.properties || {}),
                    _lineOffsets: placed.lineOffsets.slice(),
                    _lineWidths: placed.lineWidths.slice(),
                    _lineYOffsets: placed.lineYOffsets.slice()
                },
                meta: placed.box.meta
                    ? {
                        ...placed.box.meta,
                        actorId: this.actorId,
                        sourceId: placed.box.meta.sourceId ?? this.sourceId
                    }
                    : placed.box.meta
            };
            const firstLineOffset = Number(placed.lineOffsets[0] || 0);
            const firstLineY = Number(placed.lineYOffsets[0] || 0);
            const markerX = Number(context.margins.left || 0) + firstLineOffset
                + (usesContainmentLanes ? 0 : leadBodyIndent)
                - markerGap - markerWidth;
            const rawMarkerBoxes = this.createMarkerBoxesAt(
                item,
                itemIndex,
                markerWidth,
                markerX,
                localTop + firstLineY,
                availableWidth,
                remainingHeight,
                context
            ).map((box) => ({
                ...box,
                y: Number(box.y || 0) - consumedBeforeItem
            }));
            const emittedLeadBox = containedHostFrame
                ? projectLineBoxIntoContainedHostFrame(leadBox, containedHostFrame, Number(leadBox.y || 0))
                : leadBox;
            const alignedRawMarkerBoxes = alignMarkerBoxesToBodyBaseline(rawMarkerBoxes, [leadBox]);
            const markerBoxes = containedHostFrame
                ? alignedRawMarkerBoxes.map((box) => projectLineBoxIntoContainedHostFrame(
                    box,
                    containedHostFrame,
                    Number(box.y || 0)
                ))
                : alignedRawMarkerBoxes;
            const alignedMarkerBoxes = containedHostFrame
                ? markerBoxes
                : alignMarkerBoxesToBodyBaseline(markerBoxes, [emittedLeadBox]);
            itemBoxes.push(emittedLeadBox, ...alignedMarkerBoxes);
            cursorY = Math.max(
                cursorY,
                Number(leadBox.y || 0) + placed.contentHeight + placed.marginBottom,
                ...alignedRawMarkerBoxes.map((box) => Number(box.y || 0) + Number(box.h || 0))
            );
            if (cursorY > remainingHeight + 0.1) {
                let consumedLineCount = -1;
                for (let lineIndex = 0; lineIndex < placed.lines.length; lineIndex++) {
                    const yOff = placed.lineYOffsets.length > lineIndex
                        ? placed.lineYOffsets[lineIndex]
                        : lineIndex * placed.uniformLineHeight;
                    const lineBottom = Number(leadBox.y || 0) + yOff + placed.uniformLineHeight;
                    if (lineBottom <= remainingHeight + 0.1) consumedLineCount = lineIndex + 1;
                }
                if (consumedLineCount <= 0) return null;

                const partialYOff = placed.lineYOffsets.length >= consumedLineCount
                    ? placed.lineYOffsets[consumedLineCount - 1]!
                    : (consumedLineCount - 1) * placed.uniformLineHeight;
                const partialContentHeight = partialYOff + placed.uniformLineHeight + placed.insetV;
                const partialLeadBox: Box = {
                    ...leadBox,
                    h: partialContentHeight,
                    lines: placed.lines.slice(0, consumedLineCount),
                    properties: {
                        ...(leadBox.properties || {}),
                        _lineOffsets: placed.lineOffsets.slice(0, consumedLineCount),
                        _lineWidths: placed.lineWidths.slice(0, consumedLineCount),
                        _lineYOffsets: placed.lineYOffsets.slice(0, consumedLineCount),
                        _isLastLine: false
                    }
                };
                const emittedPartialLeadBox = containedHostFrame
                    ? projectLineBoxIntoContainedHostFrame(partialLeadBox, containedHostFrame, Number(partialLeadBox.y || 0))
                    : partialLeadBox;
                const currentBoxes = [
                    emittedPartialLeadBox,
                    ...(containedHostFrame
                        ? markerBoxes
                        : alignMarkerBoxesToBodyBaseline(markerBoxes, [emittedPartialLeadBox]))
                ].map((box) => ({
                    ...box,
                    y: Number(box.y || 0) + consumedBeforeItem
                }));
                const continuationLead = this.sliceSourceElement(leadElement, placed.lines, consumedLineCount);
                const continuationItem: Element = {
                    ...item,
                    content: continuationLead.content ?? '',
                    children: [
                        ...((Array.isArray(continuationLead.children) ? continuationLead.children : []) as Element[]),
                        ...blockChildren
                    ],
                    properties: {
                        ...(item.properties || {}),
                        ...(continuationLead.properties || {})
                    }
                };
                const continuationElement = cloneListWithItems(
                    this.listElement,
                    [continuationItem, ...this.normalizedList.items.slice(itemIndex + 1)],
                    this.normalizedList.start + itemIndex,
                    sourceOffset + itemIndex,
                    { _suppressFirstMarker: true }
                );
                const currentHeight = consumedBeforeItem + Math.max(
                    Number(partialLeadBox.y || 0) + partialContentHeight,
                    ...rawMarkerBoxes.map((box) => Number(box.y || 0) + Number(box.h || 0))
                );
                return {
                    currentFragment: new FrozenListPackager(
                        [...previousBoxes, ...currentBoxes],
                        currentHeight,
                        {
                            actorId: this.actorId,
                            sourceId: this.sourceId,
                            actorKind: this.actorKind,
                            fragmentIndex: this.fragmentIndex,
                            continuationOf: this.continuationOf,
                            path: this.identityPath
                        }
                    ),
                    continuationFragment: new ListPackager(
                        continuationElement,
                        this.processor,
                        createContinuationIdentity(this, this.fragmentIndex + 1),
                        undefined,
                        true
                    )
                };
            }
        }

        const blockActors: HostedRegionActorEntry[] = blockChildren.map((childElement, blockIndex) => {
            const spatialChild = addSpatialBaseIndent(childElement, leadBodyIndent);
            return {
                element: spatialChild,
                actor: buildPackagerForElement(
                    spatialChild,
                    blockIndex,
                    this.processor,
                    blockChildren,
                    undefined,
                    [...this.identityPath, itemIndex, 2, blockIndex]
                )
            };
        });

        for (let blockIndex = 0; blockIndex < blockActors.length; blockIndex++) {
            const entry = blockActors[blockIndex]!;
            const actor = entry.actor;
            const childContext: PackagerContext = {
                ...context,
                cursorY: Number(context.cursorY || 0) + consumedBeforeItem + cursorY,
                pageWidth: availableWidth,
                contentWidthOverride: undefined,
                spatialMap
            };
            const blockRemainingHeight = Math.max(0, remainingHeight - cursorY);
            actor.prepare(availableWidth, blockRemainingHeight, childContext);
            const requiredHeight = actor.getRequiredHeight();
            if (requiredHeight <= blockRemainingHeight + 0.1) {
                const emitted = actor.emitBoxes(availableWidth, blockRemainingHeight, childContext) || [];
                for (const box of emitted) {
                    itemBoxes.push({
                        ...box,
                        y: Number(box.y || 0) + cursorY,
                        properties: { ...(box.properties || {}) },
                        meta: box.meta ? { ...box.meta } : box.meta
                    });
                }
                cursorY += requiredHeight;
                continue;
            }

            if (blockRemainingHeight <= 0 || actor.isUnbreakable(blockRemainingHeight)) {
                if (itemBoxes.length === 0) return null;
                const continuationQueue: HostedRegionActorEntry[] = blockActors.slice(blockIndex);
                const continuationElement = cloneListWithItems(
                    this.listElement,
                    this.normalizedList.items.slice(itemIndex),
                    this.normalizedList.start + itemIndex,
                    sourceOffset + itemIndex,
                    { _suppressFirstMarker: true }
                );
                return {
                    currentFragment: new FrozenListPackager(
                        [...previousBoxes, ...itemBoxes.map((box) => ({ ...box, y: Number(box.y || 0) + consumedBeforeItem }))],
                        consumedBeforeItem + cursorY,
                        {
                            actorId: this.actorId,
                            sourceId: this.sourceId,
                            actorKind: this.actorKind,
                            fragmentIndex: this.fragmentIndex,
                            continuationOf: this.continuationOf,
                            path: this.identityPath
                        }
                    ),
                    continuationFragment: new ListPackager(
                        continuationElement,
                        this.processor,
                        createContinuationIdentity(this, this.fragmentIndex + 1),
                        new Map([[0, continuationQueue]]),
                        true
                    )
                };
            }

            const split = actor.reshape(blockRemainingHeight, childContext);
            if (!split.currentFragment || !split.continuationFragment) {
                return null;
            }
            const emitted = split.currentFragment.emitBoxes(availableWidth, blockRemainingHeight, childContext) || [];
            for (const box of emitted) {
                itemBoxes.push({
                    ...box,
                    y: Number(box.y || 0) + cursorY,
                    properties: { ...(box.properties || {}) },
                    meta: box.meta ? { ...box.meta } : box.meta
                });
            }
            cursorY += split.currentFragment.getRequiredHeight();
            const continuationQueue: HostedRegionActorEntry[] = [
                {
                    element: entry.element,
                    actor: split.continuationFragment
                },
                ...blockActors.slice(blockIndex + 1)
            ];
            const continuationElement = cloneListWithItems(
                this.listElement,
                this.normalizedList.items.slice(itemIndex),
                this.normalizedList.start + itemIndex,
                sourceOffset + itemIndex,
                { _suppressFirstMarker: true }
            );
            return {
                currentFragment: new FrozenListPackager(
                    [...previousBoxes, ...itemBoxes.map((box) => ({ ...box, y: Number(box.y || 0) + consumedBeforeItem }))],
                    consumedBeforeItem + cursorY,
                    {
                        actorId: this.actorId,
                        sourceId: this.sourceId,
                        actorKind: this.actorKind,
                        fragmentIndex: this.fragmentIndex,
                        continuationOf: this.continuationOf,
                        path: this.identityPath
                    }
                ),
                continuationFragment: new ListPackager(
                    continuationElement,
                    this.processor,
                    createContinuationIdentity(this, this.fragmentIndex + 1),
                    new Map([[0, continuationQueue]]),
                    true
                )
            };
        }

        return null;
    }

    getRequiredHeight(): number {
        return this.requiredHeight;
    }

    isUnbreakable(_availableHeight: number): boolean {
        return false;
    }

    getLeadingSpacing(): number {
        return this.marginTop;
    }

    getTrailingSpacing(): number {
        return this.marginBottom;
    }
}
