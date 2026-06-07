import type { Element, ElementStyle, ListKind, ListLayoutOptions, ListLevelOptions, ListMarkerStyle } from '../types';
import { LayoutUtils } from './layout-utils';

export interface NormalizedList {
    sourceElement: Element;
    kind: ListKind;
    markerStyle: ListMarkerStyle;
    markerText?: string;
    markerTextStyle: ElementStyle;
    start: number;
    indent?: number;
    markerWidth?: number;
    markerGap?: number;
    itemSpacing?: number;
    nestedListSpacingBefore?: number;
    nestedListSpacingAfter?: number;
    levels: ListLevelOptions[];
    levelIndex: number;
    items: Element[];
}

export function isListElement(element: Element | undefined): boolean {
    return element?.type === 'list';
}

export function isListItemElement(element: Element | undefined): boolean {
    return element?.type === 'list-item';
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function mergeListOptions(...entries: Array<ListLayoutOptions | Record<string, unknown>>): ListLayoutOptions {
    const merged: ListLayoutOptions = {};
    const markerTextStyle: ElementStyle = {};
    for (const entry of entries) {
        if (!isPlainObject(entry)) continue;
        Object.assign(merged, entry);
        if (isPlainObject(entry.markerTextStyle)) {
            Object.assign(markerTextStyle, entry.markerTextStyle);
        }
    }
    if (Object.keys(markerTextStyle).length > 0) {
        merged.markerTextStyle = markerTextStyle;
    }
    return merged;
}

function resolveListOptions(element: Element): ListLayoutOptions {
    const structural = element.list && typeof element.list === 'object' ? element.list : {};
    const legacyProperties = element.properties?.list && typeof element.properties.list === 'object'
        ? element.properties.list
        : {};
    const inheritedLevels = Array.isArray(element.properties?._listInheritedLevels)
        ? element.properties._listInheritedLevels
        : [];
    const structuralLevels = Array.isArray(structural.levels) ? structural.levels : null;
    const levels = structuralLevels ?? inheritedLevels;
    const levelIndex = Math.max(0, Math.floor(Number(element.properties?._listLevelIndex ?? 0)));
    const levelDefaults = levels[levelIndex] && typeof levels[levelIndex] === 'object'
        ? levels[levelIndex]
        : {};
    return mergeListOptions(legacyProperties, levelDefaults, structural);
}

function resolveListLevels(element: Element, options: ListLayoutOptions): ListLevelOptions[] {
    const structuralLevels = Array.isArray(options.levels) ? options.levels : null;
    const inheritedLevels = Array.isArray(element.properties?._listInheritedLevels)
        ? element.properties._listInheritedLevels
        : [];
    return (structuralLevels ?? inheritedLevels)
        .filter((entry): entry is ListLevelOptions => !!entry && typeof entry === 'object')
        .map((entry) => ({ ...entry }));
}

function normalizeKind(value: unknown): ListKind {
    return value === 'ordered' ? 'ordered' : 'unordered';
}

function normalizeMarkerStyle(kind: ListKind, value: unknown): ListMarkerStyle {
    const raw = String(value || '').trim();
    switch (raw) {
        case 'disc':
        case 'bullet':
        case 'circle':
        case 'square':
        case 'decimal':
        case 'arabic-indic':
        case 'extended-arabic-indic':
        case 'devanagari':
        case 'thai':
        case 'cjk-decimal':
        case 'cjk-ideographic':
        case 'hiragana':
        case 'katakana':
        case 'lower-alpha':
        case 'upper-alpha':
        case 'lower-roman':
        case 'upper-roman':
            return raw;
        default:
            return kind === 'ordered' ? 'decimal' : 'disc';
    }
}

export function normalizeListElement(element: Element): NormalizedList {
    const options = resolveListOptions(element);
    const kind = normalizeKind(options.kind);
    const markerStyle = normalizeMarkerStyle(kind, options.markerStyle);
    const markerText = typeof options.markerText === 'string' ? options.markerText : undefined;
    const start = Math.max(1, Math.floor(Number(options.start ?? 1)));
    const items = (element.children || []).filter(isListItemElement);
    const levels = resolveListLevels(element, options);
    const levelIndex = Math.max(0, Math.floor(Number(element.properties?._listLevelIndex ?? 0)));
    return {
        sourceElement: element,
        kind,
        markerStyle,
        markerText,
        markerTextStyle: options.markerTextStyle && typeof options.markerTextStyle === 'object'
            ? { ...options.markerTextStyle }
            : {},
        start,
        indent: options.indent !== undefined ? Math.max(0, LayoutUtils.validateUnit(options.indent)) : undefined,
        markerWidth: options.markerWidth !== undefined ? Math.max(0, LayoutUtils.validateUnit(options.markerWidth)) : undefined,
        markerGap: options.markerGap !== undefined ? Math.max(0, LayoutUtils.validateUnit(options.markerGap)) : undefined,
        itemSpacing: options.itemSpacing !== undefined ? Math.max(0, LayoutUtils.validateUnit(options.itemSpacing)) : undefined,
        nestedListSpacingBefore: options.nestedListSpacingBefore !== undefined ? Math.max(0, LayoutUtils.validateUnit(options.nestedListSpacingBefore)) : undefined,
        nestedListSpacingAfter: options.nestedListSpacingAfter !== undefined ? Math.max(0, LayoutUtils.validateUnit(options.nestedListSpacingAfter)) : undefined,
        levels,
        levelIndex,
        items
    };
}
