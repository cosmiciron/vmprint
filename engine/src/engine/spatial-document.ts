import type {
    DocumentInput,
    DocumentIR,
    Element,
    ElementProperties,
    PageRegionContent,
    PageRegionDefinition,
    TableColumnSizing,
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
}

export class SpatialSourceRecoveryError extends Error {
    readonly sourcePath: string;

    constructor(message: string, sourcePath: string) {
        super(message);
        this.name = 'SpatialSourceRecoveryError';
        this.sourcePath = sourcePath;
    }
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
        fit: string;
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
    sourceDocument?: DocumentInput | DocumentIR;
    strictSourceRecovery?: boolean;
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

function buildStorySegments(children: Element[] | undefined): Element[][] {
    const sourceChildren = Array.isArray(children) ? children : [];
    const segments: Element[][] = [];
    let cursor = 0;
    while (cursor < sourceChildren.length) {
        const child = sourceChildren[cursor];
        const span = child?.properties?.columnSpan;
        const isSpan = span === 'all' || (typeof span === 'number' && Number.isFinite(span) && span >= 2);
        if (isSpan) {
            cursor += 1;
            continue;
        }

        const segment: Element[] = [];
        while (cursor < sourceChildren.length) {
            const segmentChild = sourceChildren[cursor];
            const segmentSpan = segmentChild?.properties?.columnSpan;
            const hitsSpan = segmentSpan === 'all' || (typeof segmentSpan === 'number' && Number.isFinite(segmentSpan) && segmentSpan >= 2);
            if (hitsSpan) break;
            segment.push(segmentChild);
            cursor += 1;
        }
        if (segment.length > 0) segments.push(segment);
    }
    return segments;
}

function resolveSyntheticSegmentPath(sourceDocument: DocumentInput | DocumentIR, cleanPath: string): Element | null {
    const match = cleanPath.match(/^(.*)\.children\.segment\[(\d+)\]\[(\d+)\]$/);
    if (!match) return null;
    const [, parentPath, rawSegmentIndex, rawChildIndex] = match;
    const parent = resolveSourceElement(sourceDocument, { path: parentPath });
    if (!parent) return null;
    const segments = buildStorySegments(parent.children);
    const segment = segments[Number(rawSegmentIndex)];
    const child = segment?.[Number(rawChildIndex)];
    return child ? cloneElement(child) : null;
}

function resolvePathToken(target: any, token: string): any {
    if (!token) return target;
    const match = token.match(/^([A-Za-z_][A-Za-z0-9_]*)\[(\d+)\]$/);
    if (match) {
        const [, key, rawIndex] = match;
        const next = target?.[key];
        return Array.isArray(next) ? next[Number(rawIndex)] : undefined;
    }
    return target?.[token];
}

function resolveRelativeSourceElement(baseElement: Element | null, basePath: string | undefined, targetPath: string | undefined): Element | null {
    if (!baseElement || !basePath || !targetPath) return null;
    const cleanBasePath = stripPathSuffix(basePath).trim();
    const cleanTargetPath = stripPathSuffix(targetPath).trim();
    if (!cleanBasePath || !cleanTargetPath || !cleanTargetPath.startsWith(`${cleanBasePath}.`)) return null;

    const relativePath = cleanTargetPath.slice(cleanBasePath.length + 1);
    const tokens = relativePath.split('.').filter((token) => token.length > 0);
    let current: any = baseElement;
    for (const token of tokens) {
        current = resolvePathToken(current, token);
        if (current === undefined || current === null) return null;
    }
    if (!current || typeof current !== 'object' || typeof current.type !== 'string') return null;
    return cloneElement(current as Element);
}

function resolveSourceElement(sourceDocument: DocumentInput | DocumentIR | undefined, source: SpatialSourceRef | undefined): Element | null {
    if (!sourceDocument || !source?.path) return null;
    const cleanPath = stripPathSuffix(source.path).trim();
    if (!cleanPath) return null;
    if (cleanPath.includes('.children.segment[')) {
        return resolveSyntheticSegmentPath(sourceDocument, cleanPath);
    }
    const tokens = cleanPath.split('.').filter((token) => token.length > 0);
    let current: any = sourceDocument;
    for (const token of tokens) {
        current = resolvePathToken(current, token);
        if (current === undefined || current === null) return null;
    }
    if (!current || typeof current !== 'object' || typeof current.type !== 'string') return null;
    return cloneElement(current as Element);
}

function resolveSourceElementStrict(
    options: SpatialAdaptOptions,
    source: SpatialSourceRef | undefined,
    context: string
): Element | null {
    if (!source?.path) return null;
    if (options.strictSourceRecovery) {
        throw new SpatialSourceRecoveryError(
            `[spatial-document] Strict Spatial IR mode forbids source recovery in ${context} (${source.path}).`,
            source.path
        );
    }
    return resolveSourceElement(options.sourceDocument, source);
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
    options: SpatialAdaptOptions,
    sourceElementOverride?: Element | null
): Element {
    const element = options.strictSourceRecovery
        ? createBaseElement(block.sourceType || 'p', block.content || '')
        : (
            sourceElementOverride
            ?? resolveSourceElementStrict(options, block.source, 'adaptFlowBlock')
            ?? createBaseElement(block.sourceType || 'p', block.content || '')
        );
    element.type = block.sourceType || element.type || 'p';
    if ((block.content || '').length > 0 || !Array.isArray(element.children) || element.children.length === 0) {
        element.content = block.content || '';
    }
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
    if (block.dropCap) properties.dropCap = { ...(block.dropCap as Record<string, unknown>) };
    if (block.columnSpan !== undefined) {
        properties.columnSpan = block.columnSpan;
    }
    if (block.image?.data) {
        properties.image = {
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
    const sourceElement = options.strictSourceRecovery
        ? null
        : resolveSourceElementStrict(options, obstacle.source, 'adaptBlockObstacle');
    const sourceLayout = sourceElement?.properties?.layout as Record<string, unknown> | undefined;
    element.properties = applySpatialSourceProperties({
        ...(element.properties || {}),
        style: baseStyle,
        layout: {
            ...(sourceLayout || {}),
            mode: obstacle.mode,
            align: obstacle.align,
            wrap: obstacle.wrap,
            gap: obstacle.gap,
            ...(obstacle.mode === 'story-absolute' ? { x: obstacle.resolvedX } : {})
        }
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
        properties: applySpatialSourceProperties({
            style: strip.blockStyle ? { ...strip.blockStyle } : undefined,
            zones: {
                columns: buildFixedColumns(widths),
                gap
            }
        }, strip.source)
    };
}

function adaptSpatialGridCell(cell: SpatialGridCell, options: SpatialAdaptOptions): Element {
    const sourceCell = options.strictSourceRecovery
        ? null
        : resolveSourceElementStrict(options, cell.source, 'adaptSpatialGridCell');
    const contentItems = cell.content?.items || [];
    const singleFlowBlock = contentItems.length === 1 && contentItems[0]?.kind === 'flow-block'
        ? contentItems[0] as SpatialFlowBlock
        : null;
    const element = sourceCell ?? createBaseElement('table-cell', '');

    if (singleFlowBlock) {
        const resolved = adaptFlowBlock(
            singleFlowBlock,
            options,
            resolveRelativeSourceElement(sourceCell, cell.source?.path, singleFlowBlock.source?.path)
        );
        element.type = element.type || 'table-cell';
        const resolvedHasContent = typeof resolved.content === 'string' && resolved.content.length > 0;
        const resolvedHasChildren = Array.isArray(resolved.children) && resolved.children.length > 0;
        if (resolvedHasContent || !element.content) {
            element.content = resolved.content || '';
        }
        if (resolvedHasChildren || !Array.isArray(element.children) || element.children.length === 0) {
            element.children = Array.isArray(resolved.children) ? resolved.children : [];
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
    const sourceElement = options.strictSourceRecovery
        ? null
        : resolveSourceElementStrict(options, grid.source, 'adaptSpatialGrid');
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

    const baseTable = sourceElement?.type === 'table'
        ? sourceElement
        : createBaseElement('table', '');
    baseTable.children = rows;
    baseTable.properties = applySpatialSourceProperties({
        ...(baseTable.properties || {}),
        style: {
            ...((baseTable.properties?.style as Record<string, unknown>) || {}),
            ...(grid.blockStyle || {})
        },
        table: {
            ...((baseTable.properties?.table as Record<string, unknown>) || {}),
            headerRows: grid.headerRows,
            repeatHeader: grid.repeatHeader,
            columnGap: grid.columnGap,
            rowGap: grid.rowGap,
            columns: Array.isArray(grid.columns) && grid.columns.length > 0
                ? grid.columns.map((column) => ({ ...column }))
                : Array.isArray(baseTable.properties?.table?.columns) && baseTable.properties.table.columns.length > 0
                    ? baseTable.properties.table.columns
                    : buildFixedColumns(grid.resolvedColumns.map((column) => column.width)),
            ...(grid.cellStyle ? { cellStyle: { ...grid.cellStyle } } : {}),
            ...(grid.headerCellStyle ? { headerCellStyle: { ...grid.headerCellStyle } } : {})
        }
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

            if (options.sourceDocument) {
                const sourceStory = resolveSourceElementStrict(
                    options,
                    { path: linkedStoryBasePath },
                    'spatialItemsToElements(linked-story)'
                );
                if (sourceStory?.type === 'story') {
                    out.push(sourceStory);
                    continue;
                }
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

export function spatialDocumentToElements(document: SpatialDocument, sourceDocument?: DocumentInput | DocumentIR): Element[] {
    return spatialItemsToElements(document.items || [], { sourceDocument });
}

export function spatialDocumentToElementsStrict(document: SpatialDocument): Element[] {
    return spatialItemsToElements(document.items || [], { strictSourceRecovery: true });
}

export function applySpatialDocumentPageTemplate(
    document: SpatialDocument,
    fallback: Pick<DocumentInput | DocumentIR, 'header' | 'footer'>,
    sourceDocument?: DocumentInput | DocumentIR
): Pick<DocumentInput, 'header' | 'footer'> {
    return {
        header: adaptPageRegionSet(document.pageTemplate?.header, fallback.header, { sourceDocument }),
        footer: adaptPageRegionSet(document.pageTemplate?.footer, fallback.footer, { sourceDocument })
    };
}

export function applySpatialDocumentPageTemplateStrict(
    document: SpatialDocument,
    fallback: Pick<DocumentInput | DocumentIR, 'header' | 'footer'>
): Pick<DocumentInput, 'header' | 'footer'> {
    return {
        header: adaptPageRegionSet(document.pageTemplate?.header, fallback.header, { strictSourceRecovery: true }),
        footer: adaptPageRegionSet(document.pageTemplate?.footer, fallback.footer, { strictSourceRecovery: true })
    };
}
