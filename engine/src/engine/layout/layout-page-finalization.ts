import { Box, LayoutConfig, Page, PageRegionContent, PageRegionDefinition } from '../types';
import { LayoutUtils } from './layout-utils';
import {
    LayoutSession,
} from './layout-session';
import type { LayoutCollaborator, PageOverrideState, PageSurface } from './layout-session-types';

type RegionRect = {
    x: number;
    y: number;
    w: number;
    h: number;
};

type FinalizePagesCallbacks = {
    layoutRegion: (
        content: PageRegionContent,
        rect: RegionRect,
        pageIndex: number,
        sourceType: 'header' | 'footer'
    ) => Box[];
};

export class PageRegionCollaborator implements LayoutCollaborator {
    constructor(
        private readonly config: LayoutConfig,
        private readonly callbacks: FinalizePagesCallbacks
    ) { }

    onPageFinalized(surface: PageSurface, session: LayoutSession): void {
        const page: Page = surface.finalize();
        const baseline = resolveBaselineRegions(this.config, page.index);
        const override = findWinningPageOverride(page);
        const resolved = applyPageOverride(baseline, override);
        const usesLogical = regionContainsLogicalPageNumber(resolved.header) || regionContainsLogicalPageNumber(resolved.footer);
        const logicalNumber = session.allocateLogicalPageNumber(usesLogical);
        const physicalPageNumber = page.index + 1;

        const headerContent = materializePageTokens(resolved.header, physicalPageNumber, logicalNumber);
        const footerContent = materializePageTokens(resolved.footer, physicalPageNumber, logicalNumber);
        const headerRect = getHeaderRect(this.config, page);
        const footerRect = getFooterRect(this.config, page);
        const viewport = session.sessionWorldRuntime.createViewportDescriptor({
            pageIndex: page.index,
            pageWidth: page.width,
            pageHeight: page.height,
            margins: this.config.layout.margins,
            headerRect,
            footerRect
        });
        const worldSpace = session.sessionWorldRuntime.createWorldSpace(page.index, page.width, page.height);

        if (headerContent) {
            surface.boxes.push(
                ...this.callbacks.layoutRegion(headerContent, headerRect, page.index, 'header')
            );
        }
        if (footerContent) {
            surface.boxes.push(
                ...this.callbacks.layoutRegion(footerContent, footerRect, page.index, 'footer')
            );
        }

        session.recordPageFinalization({
            pageIndex: page.index,
            physicalPageNumber,
            logicalPageNumber: logicalNumber,
            usesLogicalNumbering: usesLogical,
            resolvedRegions: resolved,
            overrideSourceId: findOverrideSourceId(page, override),
            headerOverride: resolveOverrideState(override?.header),
            footerOverride: resolveOverrideState(override?.footer),
            renderedHeader: !!headerContent,
            renderedFooter: !!footerContent,
            worldSpace,
            viewport
        });
    }

    onSimulationStart(session: LayoutSession): void {
        session.resetLogicalPageNumbering(Number(this.config.layout.pageNumberStart ?? 1));
    }
}

export type ResolvedRegions = {
    header: PageRegionContent | null;
    footer: PageRegionContent | null;
};

export type PageOverrideCandidate = {
    header?: PageRegionContent | null;
    footer?: PageRegionContent | null;
};

export function resolveOverrideState(value: unknown): PageOverrideState {
    if (value === undefined) return 'inherit';
    if (value === null) return 'suppress';
    return 'replace';
}

function resolveRegionDefinition(
    definition: PageRegionDefinition | undefined,
    pageIndex: number
): PageRegionContent | null {
    if (!definition) return null;
    if (pageIndex === 0 && definition.firstPage !== undefined) {
        return definition.firstPage ?? null;
    }
    const physicalPageNumber = pageIndex + 1;
    if ((physicalPageNumber % 2) === 1 && definition.odd !== undefined) {
        return definition.odd;
    }
    if ((physicalPageNumber % 2) === 0 && definition.even !== undefined) {
        return definition.even;
    }
    return definition.default ?? null;
}

export function resolveBaselineRegions(config: LayoutConfig, pageIndex: number): ResolvedRegions {
    return {
        header: resolveRegionDefinition(config.header, pageIndex),
        footer: resolveRegionDefinition(config.footer, pageIndex)
    };
}

export function findWinningPageOverride(page: Page): PageOverrideCandidate | null {
    const seen = new Set<string>();
    let firstCandidate: PageOverrideCandidate | null = null;

    for (const box of page.boxes) {
        const overrides = box.properties?.pageOverrides as PageOverrideCandidate | undefined;
        if (!overrides) continue;

        const candidateKey = String(box.meta?.engineKey || box.meta?.sourceId || '');
        if (candidateKey && seen.has(candidateKey)) continue;
        if (candidateKey) seen.add(candidateKey);

        const candidate: PageOverrideCandidate = {
            ...(overrides.header !== undefined ? { header: overrides.header } : {}),
            ...(overrides.footer !== undefined ? { footer: overrides.footer } : {})
        };
        if (candidate.header === undefined && candidate.footer === undefined) continue;
        if (!firstCandidate) firstCandidate = candidate;
        if (box.meta?.isContinuation !== true) {
            return candidate;
        }
    }

    return firstCandidate;
}

export function applyPageOverride(base: ResolvedRegions, override: PageOverrideCandidate | null): ResolvedRegions {
    if (!override) return base;
    return {
        header: override.header !== undefined ? (override.header ?? null) : base.header,
        footer: override.footer !== undefined ? (override.footer ?? null) : base.footer
    };
}

export function findOverrideSourceId(page: Page, winningOverride: PageOverrideCandidate | null): string | null {
    if (!winningOverride) return null;

    for (const box of page.boxes || []) {
        const overrides = box.properties?.pageOverrides;
        if (!overrides) continue;
        const sameHeader = overrides.header === winningOverride.header;
        const sameFooter = overrides.footer === winningOverride.footer;
        if (!sameHeader && !sameFooter) continue;
        return box.meta?.sourceId ?? null;
    }

    return null;
}

function hasLogicalPageNumberTokenInText(text: string): boolean {
    return text.includes('{logicalPageNumber}') || text.includes('{pageNumber}');
}

function elementContainsLogicalPageNumber(element: { content?: string; children?: any[]; slots?: Array<{ elements?: any[] }>; zones?: Array<{ elements?: any[] }> }): boolean {
    if (typeof element.content === 'string' && hasLogicalPageNumberTokenInText(element.content)) return true;
    if (Array.isArray(element.children) && element.children.some((child) => elementContainsLogicalPageNumber(child))) {
        return true;
    }
    if (Array.isArray(element.slots) && element.slots.some((slot) => Array.isArray(slot.elements) && slot.elements.some((child) => elementContainsLogicalPageNumber(child)))) {
        return true;
    }
    if (Array.isArray(element.zones) && element.zones.some((zone) => Array.isArray(zone.elements) && zone.elements.some((child) => elementContainsLogicalPageNumber(child)))) {
        return true;
    }
    return false;
}

export function regionContainsLogicalPageNumber(content: PageRegionContent | null): boolean {
    if (!content) return false;
    return (content.elements || []).some((element) => elementContainsLogicalPageNumber(element));
}

function replaceToken(text: string, token: string, value: string): string {
    return text.split(token).join(value);
}

function replacePageTokens(text: string, physicalPageNumber: number, logicalPageNumber: number | null): string {
    let out = replaceToken(text, '{physicalPageNumber}', String(physicalPageNumber));
    const logicalValue = logicalPageNumber === null ? '' : String(logicalPageNumber);
    out = replaceToken(out, '{logicalPageNumber}', logicalValue);
    out = replaceToken(out, '{pageNumber}', logicalValue);
    return out;
}

function cloneElementWithPageTokens<T extends { content?: string; children?: T[]; slots?: Array<{ elements?: T[] }>; zones?: Array<{ elements?: T[] }> }>(
    element: T,
    physicalPageNumber: number,
    logicalPageNumber: number | null
): T {
    return {
        ...element,
        ...(typeof element.content === 'string'
            ? { content: replacePageTokens(element.content, physicalPageNumber, logicalPageNumber) }
            : {}),
        ...(Array.isArray(element.children)
            ? {
                children: element.children.map((child) =>
                    cloneElementWithPageTokens(child, physicalPageNumber, logicalPageNumber)
                )
            }
            : {}),
        ...(Array.isArray(element.slots)
            ? {
                slots: element.slots.map((slot) => ({
                    ...slot,
                    ...(Array.isArray(slot.elements)
                        ? {
                            elements: slot.elements.map((child) =>
                                cloneElementWithPageTokens(child, physicalPageNumber, logicalPageNumber)
                            )
                        }
                        : {})
                }))
            }
            : {}),
        ...(Array.isArray(element.zones)
            ? {
                zones: element.zones.map((zone) => ({
                    ...zone,
                    ...(Array.isArray(zone.elements)
                        ? {
                            elements: zone.elements.map((child) =>
                                cloneElementWithPageTokens(child, physicalPageNumber, logicalPageNumber)
                            )
                        }
                        : {})
                }))
            }
            : {})
    };
}

function materializePageTokens(
    content: PageRegionContent | null,
    physicalPageNumber: number,
    logicalPageNumber: number | null
): PageRegionContent | null {
    if (!content) return null;
    return {
        ...content,
        elements: content.elements.map((element) =>
            cloneElementWithPageTokens(element, physicalPageNumber, logicalPageNumber)
        )
    };
}

function getHeaderRect(config: LayoutConfig, page: Page): RegionRect {
    const margins = config.layout.margins;
    const insetTop = LayoutUtils.validateUnit(config.layout.headerInsetTop ?? 0);
    const insetBottom = LayoutUtils.validateUnit(config.layout.headerInsetBottom ?? 0);
    return {
        x: margins.left,
        y: insetTop,
        w: Math.max(0, page.width - margins.left - margins.right),
        h: Math.max(0, margins.top - insetTop - insetBottom)
    };
}

function getFooterRect(config: LayoutConfig, page: Page): RegionRect {
    const margins = config.layout.margins;
    const insetTop = LayoutUtils.validateUnit(config.layout.footerInsetTop ?? 0);
    const insetBottom = LayoutUtils.validateUnit(config.layout.footerInsetBottom ?? 0);
    return {
        x: margins.left,
        y: page.height - margins.bottom + insetTop,
        w: Math.max(0, page.width - margins.left - margins.right),
        h: Math.max(0, margins.bottom - insetTop - insetBottom)
    };
}

export function finalizePagesWithCallbacks(
    pages: Page[],
    config: LayoutConfig,
    callbacks: FinalizePagesCallbacks
): Page[] {
    const resolvedPerPage = pages.map((page) => {
        const baseline = resolveBaselineRegions(config, page.index);
        const override = findWinningPageOverride(page);
        return applyPageOverride(baseline, override);
    });

    let logicalPageNumber = Math.max(0, Math.floor(Number(config.layout.pageNumberStart ?? 1)) - 1);
    const logicalNumbers = resolvedPerPage.map((regions) => {
        const usesLogical = regionContainsLogicalPageNumber(regions.header) || regionContainsLogicalPageNumber(regions.footer);
        if (!usesLogical) return null;
        logicalPageNumber += 1;
        return logicalPageNumber;
    });

    return pages.map((page, index) => {
        const physicalPageNumber = page.index + 1;
        const logicalNumber = logicalNumbers[index];
        const resolved = resolvedPerPage[index];

        const headerContent = materializePageTokens(resolved.header, physicalPageNumber, logicalNumber);
        const footerContent = materializePageTokens(resolved.footer, physicalPageNumber, logicalNumber);

        const extraBoxes: Box[] = [];
        if (headerContent) {
            extraBoxes.push(...callbacks.layoutRegion(headerContent, getHeaderRect(config, page), page.index, 'header'));
        }
        if (footerContent) {
            extraBoxes.push(...callbacks.layoutRegion(footerContent, getFooterRect(config, page), page.index, 'footer'));
        }

        if (extraBoxes.length === 0) return page;
        return {
            ...page,
            boxes: [...page.boxes, ...extraBoxes]
        };
    });
}
