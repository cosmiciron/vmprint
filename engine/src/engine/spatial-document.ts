import type {
    DocumentInput,
    DocumentIR,
    Element,
    ElementProperties,
    PageRegionContent,
    PageRegionDefinition,
    TableColumnSizing,
    TraversalInteractionPolicy,
    ZoneDefinition
} from './types';

export interface SpatialSourceRef {
    path: string;
    sourceId?: string;
    semanticRole?: string;
    reflowKey?: string;
    language?: string;
    sourceSyntax?: string;
    sourceRange?: Record<string, unknown>;
    __elementProperties?: Record<string, unknown>;
}

export interface SpatialDocument {
    spatialIrVersion?: string;
    pageTemplate?: {
        header?: SpatialCompiledPageRegionSet;
        footer?: SpatialCompiledPageRegionSet;
    };
    items: SpatialZoneContentItem[];
}

export interface SpatialCompiledPageRegionSet {
    default?: SpatialCompiledPageRegion | null;
    firstPage?: SpatialCompiledPageRegion | null;
    odd?: SpatialCompiledPageRegion | null;
    even?: SpatialCompiledPageRegion | null;
}

export interface SpatialCompiledPageRegion {
    kind: 'page-region';
    role: 'header' | 'footer';
    selector: 'default' | 'firstPage' | 'odd' | 'even';
    x: number;
    y: number;
    width: number;
    height: number;
    style?: Record<string, unknown>;
    content: SpatialZoneContent;
}

export interface SpatialZoneContent {
    items: SpatialZoneContentItem[];
}

export interface SpatialFlowBlock {
    kind: 'flow-block';
    sourceType: string;
    content: string;
    children?: Element[];
    columnSpan?: 'all' | number;
    style: Record<string, unknown>;
    keepWithNext: boolean;
    pageBreakBefore: boolean;
    allowLineSplit: boolean;
    overflowPolicy: 'clip' | 'move-whole' | 'error';
    dropCap?: Record<string, unknown>;
    paginationContinuation?: Record<string, unknown>;
    pageReservationAfter?: number;
    image?: {
        data?: string;
        mimeType: string;
        intrinsicWidth: number;
        intrinsicHeight: number;
        fit: 'contain' | 'fill';
    };
    pageOverrides?: {
        header?: SpatialCompiledPageRegion | null;
        footer?: SpatialCompiledPageRegion | null;
    };
    source: SpatialSourceRef;
}

export interface SpatialBlockObstacle {
    kind: 'block-obstacle';
    resolvedX: number;
    width: number;
    height: number;
    wrap: 'around' | 'top-bottom' | 'none';
    gap: number;
    yAnchor: 'at-cursor';
    align: 'left' | 'center' | 'right';
    mode: 'float' | 'story-absolute';
    shape?: 'rect' | 'circle' | 'ellipse' | 'polygon';
    path?: string;
    exclusionAssembly?: {
        members: Array<{
            x: number;
            y: number;
            w: number;
            h: number;
            shape?: 'rect' | 'circle' | 'ellipse' | 'polygon';
            path?: string;
            zIndex?: number;
            traversalInteraction?: TraversalInteractionPolicy;
            resistance?: number;
        }>;
    };
    zIndex?: number;
    content: SpatialFlowBlock;
    source: SpatialSourceRef;
}

export interface SpatialZone {
    id?: string;
    x: number;
    width: number;
    style?: Record<string, unknown>;
    content?: SpatialZoneContent;
}

export interface SpatialZoneStrip {
    kind: 'zone-strip';
    overflow: 'linked' | 'independent';
    sourceKind: 'story' | 'zone-map';
    zones: SpatialZone[];
    content?: SpatialZoneContent;
    balance?: boolean;
    blockStyle?: Record<string, unknown>;
    frameOverflow?: 'move-whole' | 'continue';
    worldBehavior?: 'fixed' | 'spanning';
    source: SpatialSourceRef;
}

export interface SpatialResolvedColumn {
    x: number;
    width: number;
}

export interface SpatialGridCell {
    row: number;
    col: number;
    rowSpan: number;
    colSpan: number;
    resolvedX: number;
    resolvedWidth: number;
    rowGroup?: 'header' | 'body' | 'footer';
    content: SpatialZoneContent;
    style: Record<string, unknown>;
    source: SpatialSourceRef;
}

export interface SpatialGrid {
    kind: 'spatial-grid';
    resolvedColumns: SpatialResolvedColumn[];
    columns?: TableColumnSizing[];
    columnGap: number;
    rowGap: number;
    headerRows: number;
    headerRowIndices?: number[];
    hasRowSpan?: boolean;
    headerHasRowSpan?: boolean;
    repeatHeader: boolean;
    cells: SpatialGridCell[];
    blockStyle?: Record<string, unknown>;
    cellStyle?: Record<string, unknown>;
    headerCellStyle?: Record<string, unknown>;
    paginationContinuation?: Record<string, unknown>;
    pageReservationAfter?: number;
    source: SpatialSourceRef;
}

export type SpatialZoneContentItem =
    | SpatialFlowBlock
    | SpatialBlockObstacle
    | SpatialZoneStrip
    | SpatialGrid;

type SpatialAdaptOptions = {
};

function cloneElement(element: Element): Element {
    return JSON.parse(JSON.stringify(element)) as Element;
}

function clonePageRegionContent(content: PageRegionContent | null | undefined): PageRegionContent | null | undefined {
    if (content === null || content === undefined) return content;
    return {
        style: content.style ? { ...content.style } : undefined,
        elements: Array.isArray(content.elements) ? content.elements.map(cloneElement) : []
    };
}

function stripPathSuffix(path: string): string {
    const suffixIndex = path.indexOf('#');
    return suffixIndex >= 0 ? path.slice(0, suffixIndex) : path;
}

function applySpatialSourceProperties(properties: ElementProperties, source: SpatialSourceRef | undefined): ElementProperties {
    if (!source) return properties;
    if (source.sourceId) properties.sourceId = source.sourceId;
    if (source.semanticRole) properties.semanticRole = source.semanticRole;
    if (source.reflowKey) properties.reflowKey = source.reflowKey;
    return properties;
}

function adaptCompiledPageRegion(region: SpatialCompiledPageRegion | null | undefined, options: SpatialAdaptOptions): PageRegionContent | null | undefined {
    if (region === null || region === undefined) return region;
    return {
        style: region.style ? { ...region.style } : undefined,
        elements: spatialItemsToElements(region.content.items, options)
    };
}

function adaptPageRegionSet(set: SpatialCompiledPageRegionSet | undefined, fallback: PageRegionDefinition | undefined, options: SpatialAdaptOptions): PageRegionDefinition | undefined {
    if (!set) {
        return fallback ? {
            default: clonePageRegionContent(fallback.default),
            firstPage: clonePageRegionContent(fallback.firstPage),
            odd: clonePageRegionContent(fallback.odd),
            even: clonePageRegionContent(fallback.even)
        } : undefined;
    }
    return {
        default: adaptCompiledPageRegion(set.default, options),
        firstPage: adaptCompiledPageRegion(set.firstPage, options),
        odd: adaptCompiledPageRegion(set.odd, options),
        even: adaptCompiledPageRegion(set.even, options)
    };
}

function createBaseElement(type: string, content: string): Element {
    return {
        type,
        content,
        children: []
    };
}

function adaptFlowBlock(
    block: SpatialFlowBlock,
    options: SpatialAdaptOptions
): Element {
    const element = createBaseElement(block.sourceType || 'p', block.content || '');
    element.type = block.sourceType || element.type || 'p';
    element.content = block.content || '';
    if (Array.isArray(block.children) && block.children.length > 0) {
        element.children = JSON.parse(JSON.stringify(block.children));
    }
    const properties: ElementProperties = {
        ...(element.properties || {}),
        style: {
            ...((element.properties?.style as Record<string, unknown>) || {}),
            ...(block.style || {})
        },
        keepWithNext: block.keepWithNext
    };
    if (block.dropCap) element.dropCap = { ...(block.dropCap as Record<string, unknown>) } as any;
    if (block.columnSpan !== undefined) {
        element.columnSpan = block.columnSpan as any;
    }
    if (block.image?.data) {
        element.image = {
            data: block.image.data,
            mimeType: block.image.mimeType,
            fit: block.image.fit
        };
    }
    if (block.paginationContinuation) {
        properties.paginationContinuation = { ...(block.paginationContinuation as Record<string, unknown>) };
    }
    if (block.pageReservationAfter !== undefined) {
        properties.pageReservationAfter = block.pageReservationAfter;
    }
    if (block.pageOverrides) {
        properties.pageOverrides = {
            header: adaptCompiledPageRegion(block.pageOverrides.header, options),
            footer: adaptCompiledPageRegion(block.pageOverrides.footer, options)
        };
    }
    properties.style = {
        ...(properties.style || {}),
        pageBreakBefore: block.pageBreakBefore,
        allowLineSplit: block.allowLineSplit,
        overflowPolicy: block.overflowPolicy
    };
    const passthrough = block.source?.__elementProperties;
    if (passthrough && typeof passthrough === 'object') {
        if (passthrough.toc && typeof passthrough.toc === 'object') {
            properties.toc = JSON.parse(JSON.stringify(passthrough.toc));
        }
        if (passthrough.space && typeof passthrough.space === 'object') {
            properties.space = JSON.parse(JSON.stringify(passthrough.space));
        }
        if (passthrough.spatialField && typeof passthrough.spatialField === 'object') {
            properties.spatialField = JSON.parse(JSON.stringify(passthrough.spatialField));
        }
        if (typeof passthrough.onResolve === 'string') {
            properties.onResolve = passthrough.onResolve;
        }
        if (typeof passthrough.onMessage === 'string') {
            properties.onMessage = passthrough.onMessage;
        }
        if (passthrough._worldPlainOptions && typeof passthrough._worldPlainOptions === 'object') {
            properties._worldPlainOptions = JSON.parse(JSON.stringify(passthrough._worldPlainOptions));
        }
    }
    element.properties = applySpatialSourceProperties(properties, block.source);
    return element;
}

function deriveUniformGutter(zones: SpatialZone[]): number {
    if (zones.length <= 1) return 0;
    const gaps = zones.slice(1).map((zone, index) => zone.x - (zones[index].x + zones[index].width));
    return gaps.length > 0 ? Number(gaps[0] || 0) : 0;
}

function buildFixedColumns(widths: number[]): TableColumnSizing[] {
    return widths.map((width) => ({
        mode: 'fixed',
        value: Number(width || 0)
    }));
}

function adaptBlockObstacle(obstacle: SpatialBlockObstacle, options: SpatialAdaptOptions): Element {
    const element = adaptFlowBlock(obstacle.content, options);
    const baseStyle = {
        ...((element.properties?.style as Record<string, unknown>) || {}),
        width: obstacle.width,
        height: obstacle.height
    };
    element.placement = {
        mode: obstacle.mode,
        align: obstacle.align,
        wrap: obstacle.wrap,
        gap: obstacle.gap,
        ...(typeof obstacle.shape === 'string' ? { shape: obstacle.shape } : {}),
        ...(typeof obstacle.path === 'string' && obstacle.path.trim()
            ? { path: obstacle.path.trim() }
            : {}),
        ...(obstacle.exclusionAssembly?.members?.length
            ? {
                exclusionAssembly: {
                    members: obstacle.exclusionAssembly.members.map((member) => ({
                        x: member.x,
                        y: member.y,
                        w: member.w,
                        h: member.h,
                        ...(typeof member.shape === 'string' ? { shape: member.shape } : {}),
                        ...(typeof member.path === 'string' && member.path.trim()
                            ? { path: member.path.trim() }
                            : {}),
                        ...(Number.isFinite(Number(member.zIndex)) ? { zIndex: Number(member.zIndex) } : {}),
                        ...(typeof member.traversalInteraction === 'string'
                            ? { traversalInteraction: member.traversalInteraction }
                            : {}),
                        ...(member.resistance !== undefined ? { resistance: member.resistance } : {})
                    }))
                }
            }
            : {}),
        ...(Number.isFinite(Number(obstacle.zIndex)) ? { zIndex: Number(obstacle.zIndex) } : {}),
        ...(obstacle.mode === 'story-absolute' ? { x: obstacle.resolvedX } : {})
    };
    element.properties = applySpatialSourceProperties({
        ...(element.properties || {}),
        style: baseStyle
    }, obstacle.source);
    return element;
}

function adaptZoneStrip(strip: SpatialZoneStrip, options: SpatialAdaptOptions): Element {
    if (strip.overflow === 'linked') {
        const children = spatialItemsToElements(strip.content?.items || [], options);
        return {
            type: 'story',
            content: '',
            columns: Math.max(1, strip.zones.length || 1),
            gutter: deriveUniformGutter(strip.zones),
            balance: !!strip.balance,
            children,
            properties: applySpatialSourceProperties({
                style: strip.blockStyle ? { ...strip.blockStyle } : undefined
            }, strip.source)
        };
    }

    const widths = strip.zones.map((zone) => zone.width);
    const gap = deriveUniformGutter(strip.zones);
    const zones: ZoneDefinition[] = strip.zones.map((zone) => ({
        id: zone.id,
        style: zone.style ? { ...zone.style } : undefined,
        elements: spatialItemsToElements(zone.content?.items || [], options)
    }));

    return {
        type: 'zone-map',
        content: '',
        zones,
        zoneLayout: {
            columns: buildFixedColumns(widths),
            gap,
            ...(strip.frameOverflow ? { frameOverflow: strip.frameOverflow } : {}),
            ...(strip.worldBehavior ? { worldBehavior: strip.worldBehavior } : {})
        },
        properties: applySpatialSourceProperties({
            style: strip.blockStyle ? { ...strip.blockStyle } : undefined
        }, strip.source)
    };
}

function adaptSpatialGridCell(cell: SpatialGridCell, options: SpatialAdaptOptions): Element {
    const contentItems = cell.content?.items || [];
    const singleFlowBlock = contentItems.length === 1 && contentItems[0]?.kind === 'flow-block'
        ? contentItems[0] as SpatialFlowBlock
        : null;
    const element = createBaseElement('table-cell', '');

    if (singleFlowBlock) {
        const resolved = adaptFlowBlock(singleFlowBlock, options);
        element.type = element.type || 'table-cell';
        const resolvedHasContent = typeof resolved.content === 'string' && resolved.content.length > 0;
        const resolvedHasChildren = Array.isArray(resolved.children) && resolved.children.length > 0;
        if (resolvedHasContent || !element.content) {
            element.content = resolved.content || '';
        }
        if (resolvedHasChildren || !Array.isArray(element.children) || element.children.length === 0) {
            element.children = Array.isArray(resolved.children) ? resolved.children : [];
        }
        if (resolved.dropCap) {
            element.dropCap = JSON.parse(JSON.stringify(resolved.dropCap));
        }
        if (resolved.image) {
            element.image = JSON.parse(JSON.stringify(resolved.image));
        }
        element.properties = {
            ...(element.properties || {}),
            ...(resolved.properties || {})
        };
    } else if (contentItems.length > 0) {
        element.children = spatialItemsToElements(contentItems, options);
    }

    element.properties = applySpatialSourceProperties({
        ...(element.properties || {}),
        style: {
            ...((element.properties?.style as Record<string, unknown>) || {}),
            ...(cell.style || {})
        },
        colSpan: cell.colSpan,
        rowSpan: cell.rowSpan,
        semanticRole: cell.rowGroup && cell.rowGroup !== 'body' ? cell.rowGroup : element.properties?.semanticRole
    }, cell.source);
    return element;
}

function adaptSpatialGrid(grid: SpatialGrid, options: SpatialAdaptOptions): Element {
    const rowsByIndex = new Map<number, SpatialGridCell[]>();
    for (const cell of grid.cells) {
        const existing = rowsByIndex.get(cell.row) ?? [];
        existing.push(cell);
        rowsByIndex.set(cell.row, existing);
    }

    const rows = Array.from(rowsByIndex.entries())
        .sort((a, b) => a[0] - b[0])
        .map(([rowIndex, cells]) => {
            const rowGroup = cells.find((cell) => cell.rowGroup && cell.rowGroup !== 'body')?.rowGroup;
            return {
                type: 'table-row',
                content: '',
                properties: rowGroup ? { semanticRole: rowGroup } : {},
                children: cells
                    .slice()
                    .sort((a, b) => a.col - b.col)
                    .map((cell) => adaptSpatialGridCell(cell, options))
            } satisfies Element;
        });

    const baseTable = createBaseElement('table', '');
    baseTable.children = rows;
    baseTable.table = {
        headerRows: grid.headerRows,
        repeatHeader: grid.repeatHeader,
        columnGap: grid.columnGap,
        rowGap: grid.rowGap,
        columns: Array.isArray(grid.columns) && grid.columns.length > 0
            ? grid.columns.map((column) => ({ ...column }))
            : buildFixedColumns(grid.resolvedColumns.map((column) => column.width)),
        ...(grid.cellStyle ? { cellStyle: { ...grid.cellStyle } } : {}),
        ...(grid.headerCellStyle ? { headerCellStyle: { ...grid.headerCellStyle } } : {})
    };
    baseTable.properties = applySpatialSourceProperties({
        style: { ...(grid.blockStyle || {}) }
    }, grid.source);
    if (grid.paginationContinuation) {
        baseTable.properties.paginationContinuation = { ...(grid.paginationContinuation as Record<string, unknown>) };
    }
    if (grid.pageReservationAfter !== undefined) {
        baseTable.properties.pageReservationAfter = grid.pageReservationAfter;
    }
    return baseTable;
}

function spatialItemToElement(item: SpatialZoneContentItem, options: SpatialAdaptOptions): Element {
    switch (item.kind) {
        case 'flow-block':
            return adaptFlowBlock(item, options);
        case 'block-obstacle':
            return adaptBlockObstacle(item, options);
        case 'zone-strip':
            return adaptZoneStrip(item, options);
        case 'spatial-grid':
            return adaptSpatialGrid(item, options);
        default:
            throw new Error(`[spatial-document] Unsupported Spatial IR item kind "${String((item as any)?.kind)}".`);
    }
}

function getLinkedStoryBasePath(item: SpatialZoneContentItem): string | null {
    if (item.kind !== 'zone-strip' || item.overflow !== 'linked' || item.sourceKind !== 'story') return null;
    const rawPath = stripPathSuffix(item.source?.path || '').trim();
    if (!rawPath) return null;
    const segmentIndex = rawPath.indexOf('#segment-');
    return segmentIndex >= 0 ? rawPath.slice(0, segmentIndex) : rawPath;
}

function itemBelongsToLinkedStoryBase(item: SpatialZoneContentItem, basePath: string): boolean {
    const linkedBase = getLinkedStoryBasePath(item);
    if (linkedBase) return linkedBase === basePath;
    const rawPath = stripPathSuffix((item as any)?.source?.path || '').trim();
    return rawPath.startsWith(`${basePath}.children[`);
}

function adaptLinkedStoryFromSpatialItems(
    items: SpatialZoneContentItem[],
    basePath: string,
    options: SpatialAdaptOptions
): Element | null {
    const storySegments = items.filter((item) =>
        item.kind === 'zone-strip'
        && item.overflow === 'linked'
        && item.sourceKind === 'story'
        && getLinkedStoryBasePath(item) === basePath
    ) as SpatialZoneStrip[];
    if (storySegments.length === 0) return null;

    const firstSegment = storySegments[0];
    const storyChildren: Element[] = [];
    for (const item of items) {
        if (item.kind === 'zone-strip' && item.overflow === 'linked' && item.sourceKind === 'story') {
            const itemBasePath = getLinkedStoryBasePath(item);
            if (itemBasePath !== basePath) continue;
            storyChildren.push(...spatialItemsToElements(item.content?.items || [], options));
            continue;
        }
        storyChildren.push(spatialItemToElement(item, options));
    }

    return {
        type: 'story',
        content: '',
        columns: Math.max(1, firstSegment.zones.length || 1),
        gutter: deriveUniformGutter(firstSegment.zones),
        balance: !!firstSegment.balance,
        children: storyChildren,
        properties: applySpatialSourceProperties({
            style: firstSegment.blockStyle ? { ...firstSegment.blockStyle } : undefined
        }, {
            ...firstSegment.source,
            path: basePath
        })
    };
}

export function spatialItemsToElements(items: SpatialZoneContentItem[], options: SpatialAdaptOptions = {}): Element[] {
    const out: Element[] = [];
    for (let index = 0; index < (items || []).length; index += 1) {
        const item = items[index];
        const linkedStoryBasePath = getLinkedStoryBasePath(item);
        if (linkedStoryBasePath) {
            const linkedStoryItems = [item];
            while (index + 1 < items.length && itemBelongsToLinkedStoryBase(items[index + 1], linkedStoryBasePath)) {
                index += 1;
                linkedStoryItems.push(items[index]);
            }

            const adaptedStory = adaptLinkedStoryFromSpatialItems(linkedStoryItems, linkedStoryBasePath, options);
            if (adaptedStory) {
                out.push(adaptedStory);
                continue;
            }
        }

        out.push(spatialItemToElement(item, options));
    }
    return out;
}

export function spatialDocumentToElements(document: SpatialDocument): Element[] {
    return spatialItemsToElements(document.items || [], {});
}

export function spatialDocumentToElementsStrict(document: SpatialDocument): Element[] {
    return spatialItemsToElements(document.items || [], {});
}

export function applySpatialDocumentPageTemplate(
    document: SpatialDocument,
    fallback: Pick<DocumentInput | DocumentIR, 'header' | 'footer'>
): Pick<DocumentInput, 'header' | 'footer'> {
    return {
        header: adaptPageRegionSet(document.pageTemplate?.header, fallback.header, {}),
        footer: adaptPageRegionSet(document.pageTemplate?.footer, fallback.footer, {})
    };
}

export function applySpatialDocumentPageTemplateStrict(
    document: SpatialDocument,
    fallback: Pick<DocumentInput | DocumentIR, 'header' | 'footer'>
): Pick<DocumentInput, 'header' | 'footer'> {
    return {
        header: adaptPageRegionSet(document.pageTemplate?.header, fallback.header, {}),
        footer: adaptPageRegionSet(document.pageTemplate?.footer, fallback.footer, {})
    };
}
