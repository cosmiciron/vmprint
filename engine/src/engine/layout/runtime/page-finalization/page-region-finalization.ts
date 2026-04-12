import { Box, LayoutConfig, Page, PageRegionContent, PageRegionDefinition } from '../../../types';
import { LayoutUtils } from '../../layout-utils';
import type { PageSurface } from '../session/session-lifecycle-types';
import type { Collaborator, CollaboratorHost } from '../session/session-runtime-types';
import type { PageOverrideState } from '../session/session-state-types';
import type { ActorSignal } from '../../actor-event-bus';
import type { LayoutBox, ObservationResult, PackagerContext, PackagerReshapeResult, PackagerUnit } from '../../packagers/packager-types';

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
        sourceType: 'header' | 'footer',
        actorId?: string
    ) => Box[];
};

export class PageRegionCollaborator implements Collaborator {
    private reactiveRegionSequence = 0;

    constructor(
        private readonly config: LayoutConfig,
        private readonly callbacks: FinalizePagesCallbacks
    ) { }

    onPageFinalized(surface: PageSurface, host: CollaboratorHost): void {
        const page: Page = surface.finalize();
        const baseline = resolveBaselineRegions(this.config, page.index);
        const override = findWinningPageOverride(page);
        const resolved = applyPageOverride(baseline, override);
        const usesLogical = regionContainsLogicalPageNumber(resolved.header) || regionContainsLogicalPageNumber(resolved.footer);
        const logicalNumber = host.allocateLogicalPageNumber(usesLogical);
        const physicalPageNumber = page.index + 1;

        const headerRect = getHeaderRect(this.config, page);
        const footerRect = getFooterRect(this.config, page);

        const headerActor = createReactivePageRegionActor(
            resolved.header,
            headerRect,
            page.index,
            physicalPageNumber,
            logicalNumber,
            'header',
            this.callbacks,
            ++this.reactiveRegionSequence
        );
        const footerActor = createReactivePageRegionActor(
            resolved.footer,
            footerRect,
            page.index,
            physicalPageNumber,
            logicalNumber,
            'footer',
            this.callbacks,
            ++this.reactiveRegionSequence
        );
        const headerMaterialized = resolved.header
            ? materializePageTokens(resolved.header, physicalPageNumber, logicalNumber)
            : null;
        const footerMaterialized = resolved.footer
            ? materializePageTokens(resolved.footer, physicalPageNumber, logicalNumber)
            : null;
        const headerContent = headerActor
            ? headerActor.emitCurrentBoxes()
            : (headerMaterialized ? this.callbacks.layoutRegion(headerMaterialized, headerRect, page.index, 'header') : []);
        const footerContent = footerActor
            ? footerActor.emitCurrentBoxes()
            : (footerMaterialized ? this.callbacks.layoutRegion(footerMaterialized, footerRect, page.index, 'footer') : []);

        const capture = host.createPageCaptureState({
            pageIndex: page.index,
            worldTopY: page.index * page.height,
            pageWidth: page.width,
            pageHeight: page.height,
            margins: this.config.layout.margins,
            headerRect,
            footerRect
        });

        if (headerContent.length > 0) {
            surface.boxes.push(...headerContent);
        }
        if (footerContent.length > 0) {
            surface.boxes.push(...footerContent);
        }

        if (headerActor) {
            host.notifyActorSpawn(headerActor);
        }
        if (footerActor) {
            host.notifyActorSpawn(footerActor);
        }

        host.recordPageCapture({
            pageIndex: page.index,
            physicalPageNumber,
            logicalPageNumber: logicalNumber,
            usesLogicalNumbering: usesLogical,
            renderRevision: 0,
            capture
        });

        host.recordPageFinalization({
            pageIndex: page.index,
            physicalPageNumber,
            logicalPageNumber: logicalNumber,
            usesLogicalNumbering: usesLogical,
            resolvedRegions: resolved,
            overrideSourceId: findOverrideSourceId(page, override),
            headerOverride: resolveOverrideState(override?.header),
            footerOverride: resolveOverrideState(override?.footer),
            renderedHeader: headerContent.length > 0,
            renderedFooter: footerContent.length > 0,
            capture,
            worldSpace: capture.worldSpace,
            viewport: capture.viewport
        });
    }

    onSimulationStart(host: CollaboratorHost): void {
        this.reactiveRegionSequence = 0;
        host.resetLogicalPageNumbering(Number(this.config.layout.pageNumberStart ?? 1));
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

type RegionElement = { content?: string; children?: any[]; slots?: Array<{ elements?: any[] }>; zones?: Array<{ elements?: any[] }> };

function hasLogicalPageNumberTokenInText(text: string): boolean {
    return text.includes('{logicalPageNumber}') || text.includes('{pageNumber}');
}

function elementContainsLogicalPageNumber(element: RegionElement): boolean {
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

function elementContainsTotalPages(element: RegionElement): boolean {
    if (typeof element.content === 'string' && element.content.includes('{totalPages}')) return true;
    if (Array.isArray(element.children) && element.children.some((child) => elementContainsTotalPages(child))) return true;
    if (Array.isArray(element.slots) && element.slots.some((slot) => Array.isArray(slot.elements) && slot.elements.some((child) => elementContainsTotalPages(child)))) return true;
    if (Array.isArray(element.zones) && element.zones.some((zone) => Array.isArray(zone.elements) && zone.elements.some((child) => elementContainsTotalPages(child)))) return true;
    return false;
}

export function regionContainsTotalPages(content: PageRegionContent | null): boolean {
    if (!content) return false;
    return (content.elements || []).some((element) => elementContainsTotalPages(element));
}

function replaceToken(text: string, token: string, value: string): string {
    return text.split(token).join(value);
}

function replacePageTokens(text: string, physicalPageNumber: number, logicalPageNumber: number | null, totalPageCount?: number): string {
    let out = replaceToken(text, '{physicalPageNumber}', String(physicalPageNumber));
    const logicalValue = logicalPageNumber === null ? '' : String(logicalPageNumber);
    out = replaceToken(out, '{logicalPageNumber}', logicalValue);
    out = replaceToken(out, '{pageNumber}', logicalValue);
    if (totalPageCount !== undefined) {
        out = replaceToken(out, '{totalPages}', String(totalPageCount));
    }
    return out;
}

function cloneElementWithPageTokens<T extends { content?: string; children?: T[]; slots?: Array<{ elements?: T[] }>; zones?: Array<{ elements?: T[] }> }>(
    element: T,
    physicalPageNumber: number,
    logicalPageNumber: number | null,
    totalPageCount?: number
): T {
    return {
        ...element,
        ...(typeof element.content === 'string'
            ? { content: replacePageTokens(element.content, physicalPageNumber, logicalPageNumber, totalPageCount) }
            : {}),
        ...(Array.isArray(element.children)
            ? {
                children: element.children.map((child) =>
                    cloneElementWithPageTokens(child, physicalPageNumber, logicalPageNumber, totalPageCount)
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
                                cloneElementWithPageTokens(child, physicalPageNumber, logicalPageNumber, totalPageCount)
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
                                cloneElementWithPageTokens(child, physicalPageNumber, logicalPageNumber, totalPageCount)
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
    logicalPageNumber: number | null,
    totalPageCount?: number
): PageRegionContent | null {
    if (!content) return null;
    return {
        ...content,
        elements: content.elements.map((element) =>
            cloneElementWithPageTokens(element, physicalPageNumber, logicalPageNumber, totalPageCount)
        )
    };
}

function materializeReactivePageTokens(
    content: PageRegionContent | null,
    physicalPageNumber: number,
    logicalPageNumber: number | null,
    totalPageCount: number | null
): PageRegionContent | null {
    if (!content) return null;
    return {
        ...content,
        elements: content.elements.map((element) =>
            cloneElementWithPageTokens(
                element,
                physicalPageNumber,
                logicalPageNumber,
                totalPageCount ?? 0
            )
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

type PageRegionActorSourceType = 'header' | 'footer';

class ReactivePageRegionActor implements PackagerUnit {
    readonly actorKind = 'page-region';
    readonly fragmentIndex = 0;
    readonly pageBreakBefore = false;
    readonly keepWithNext = false;
    private readonly sourceType: PageRegionActorSourceType;
    private readonly pageIndex: number;
    private readonly physicalPageNumber: number;
    private readonly logicalPageNumber: number | null;
    private readonly content: PageRegionContent;
    private readonly rect: RegionRect;
    private readonly callbacks: FinalizePagesCallbacks;
    private totalPageCount: number | null = null;
    private lastSeenSignalSequence = -1;

    constructor(input: {
        actorId: string;
        sourceId: string;
        sourceType: PageRegionActorSourceType;
        pageIndex: number;
        physicalPageNumber: number;
        logicalPageNumber: number | null;
        content: PageRegionContent;
        rect: RegionRect;
        callbacks: FinalizePagesCallbacks;
    }) {
        this.actorId = input.actorId;
        this.sourceId = input.sourceId;
        this.sourceType = input.sourceType;
        this.pageIndex = input.pageIndex;
        this.physicalPageNumber = input.physicalPageNumber;
        this.logicalPageNumber = input.logicalPageNumber;
        this.content = input.content;
        this.rect = input.rect;
        this.callbacks = input.callbacks;
    }

    readonly actorId: string;
    readonly sourceId: string;

    prepare(_availableWidth: number, _availableHeight: number, _context: PackagerContext): void { }

    emitBoxes(_availableWidth: number, _availableHeight: number, _context: PackagerContext): LayoutBox[] | null {
        return this.emitCurrentBoxes();
    }

    updateCommittedState(context: PackagerContext): ObservationResult | null {
        const latest = readLatestPaginationFinalizedSignal(context.readActorSignals('pagination:finalized'));
        if (!latest) {
            return null;
        }
        if (latest.sequence === this.lastSeenSignalSequence) {
            return { changed: false, geometryChanged: false, updateKind: 'none' };
        }
        this.lastSeenSignalSequence = latest.sequence;
        const nextTotal = normalizePublishedTotalPageCount(latest);
        const changed = nextTotal !== this.totalPageCount;
        this.totalPageCount = nextTotal;
        return {
            changed,
            geometryChanged: false,
            updateKind: changed ? 'content-only' : 'none'
        };
    }

    getCommittedSignalSubscriptions(): readonly string[] {
        return ['pagination:finalized'];
    }

    reshape(_availableHeight: number, _context: PackagerContext): PackagerReshapeResult {
        return {
            currentFragment: this,
            continuationFragment: null
        };
    }

    getRequiredHeight(): number {
        return this.rect.h;
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

    emitCurrentBoxes(): LayoutBox[] {
        const content = materializeReactivePageTokens(
            this.content,
            this.physicalPageNumber,
            this.logicalPageNumber,
            this.totalPageCount
        );
        if (!content) return [];
        return this.callbacks.layoutRegion(content, this.rect, this.pageIndex, this.sourceType, this.actorId);
    }
}

function createReactivePageRegionActor(
    content: PageRegionContent | null,
    rect: RegionRect,
    pageIndex: number,
    physicalPageNumber: number,
    logicalPageNumber: number | null,
    sourceType: PageRegionActorSourceType,
    callbacks: FinalizePagesCallbacks,
    sequence: number
): ReactivePageRegionActor | null {
    if (!content || !regionContainsTotalPages(content)) {
        return null;
    }
    return new ReactivePageRegionActor({
        actorId: `system:${sourceType}:reactive-region:${pageIndex}:${sequence}`,
        sourceId: `system:${sourceType}:reactive-region:${pageIndex}`,
        sourceType,
        pageIndex,
        physicalPageNumber,
        logicalPageNumber,
        content,
        rect,
        callbacks
    });
}

function readLatestPaginationFinalizedSignal(signals: readonly ActorSignal[]): ActorSignal | null {
    if (!signals.length) return null;
    return signals[signals.length - 1] ?? null;
}

function normalizePublishedTotalPageCount(signal: ActorSignal): number | null {
    const total = signal.payload?.totalPageCount;
    if (!Number.isFinite(total)) return null;
    return Math.max(0, Math.floor(Number(total)));
}

export function finalizePagesWithCallbacks(
    pages: Page[],
    config: LayoutConfig,
    callbacks: FinalizePagesCallbacks
): Page[] {
    const totalPageCount = pages.length;
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

        const headerContent = materializePageTokens(resolved.header, physicalPageNumber, logicalNumber, totalPageCount);
        const footerContent = materializePageTokens(resolved.footer, physicalPageNumber, logicalNumber, totalPageCount);

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
