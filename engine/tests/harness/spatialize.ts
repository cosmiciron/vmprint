import { parseEmbeddedImagePayloadCached, LayoutUtils, solveTrackSizing } from '../../src';
import type {
  DocumentIR,
  Element,
  EmbeddedImagePayload,
  LayoutConfig,
  PageRegionContent,
  PageRegionDefinition,
  SpatialDocument,
  StoryLayoutDirective,
  TableColumnSizing,
  ZoneDefinition
} from '../../src';

interface SourceRef {
  path: string;
  sourceId?: string;
  semanticRole?: string;
  reflowKey?: string;
  language?: string;
  sourceSyntax?: string;
  sourceRange?: Record<string, unknown>;
}

export interface SpatialDocumentFixture extends SpatialDocument {
  spatialIrVersion: '0.1';
  source: {
    fixture: string;
    documentVersion: string;
    irVersion: string;
  };
  pageGeometry: {
    pageWidth: number;
    pageHeight: number;
    contentX: number;
    contentY: number;
    contentWidth: number;
    contentHeight: number;
    margins: LayoutConfig['layout']['margins'];
  };
  pageTemplate: {
    header?: CompiledPageRegionSet;
    footer?: CompiledPageRegionSet;
  };
  items: ZoneContentItem[];
  notes: {
    coordinateSpace: 'zone.x is parent-relative';
    provisionalFields: string[];
  };
}

interface CompiledPageRegionSet {
  default?: CompiledPageRegion | null;
  firstPage?: CompiledPageRegion | null;
  odd?: CompiledPageRegion | null;
  even?: CompiledPageRegion | null;
}

interface CompiledPageRegion {
  kind: 'page-region';
  role: 'header' | 'footer';
  selector: 'default' | 'firstPage' | 'odd' | 'even';
  x: number;
  y: number;
  width: number;
  height: number;
  style?: Record<string, unknown>;
  content: ZoneContent;
}

interface ZoneContent {
  items: ZoneContentItem[];
}

type ZoneContentItem = FlowBlock | BlockObstacle | ZoneStrip | SpatialGrid;

interface SpatialZone {
  id?: string;
  x: number;
  width: number;
  style?: Record<string, unknown>;
  content?: ZoneContent;
}

interface ZoneStrip {
  kind: 'zone-strip';
  overflow: 'linked' | 'independent';
  sourceKind: 'story' | 'zone-map';
  zones: SpatialZone[];
  content?: ZoneContent;
  balance?: boolean;
  blockStyle?: Record<string, unknown>;
  source: SourceRef;
}

interface SpatialGrid {
  kind: 'spatial-grid';
  resolvedColumns: ResolvedColumn[];
  columns?: TableColumnSizing[];
  columnGap: number;
  rowGap: number;
  headerRows: number;
  repeatHeader: boolean;
  cells: GridCell[];
  blockStyle?: Record<string, unknown>;
  cellStyle?: Record<string, unknown>;
  headerCellStyle?: Record<string, unknown>;
  paginationContinuation?: Record<string, unknown>;
  pageReservationAfter?: number;
  source: SourceRef;
}

interface ResolvedColumn {
  x: number;
  width: number;
}

interface GridCell {
  row: number;
  col: number;
  rowSpan: number;
  colSpan: number;
  resolvedX: number;
  resolvedWidth: number;
  rowGroup?: 'header' | 'body';
  content: ZoneContent;
  style: Record<string, unknown>;
  source: SourceRef;
}

interface FlowBlock {
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
  pageOverrides?: {
    header?: CompiledPageRegion | null;
    footer?: CompiledPageRegion | null;
  };
  image?: EmbeddedImageDescriptor;
  source: SourceRef;
}

interface EmbeddedImageDescriptor {
  data?: string;
  mimeType: string;
  intrinsicWidth: number;
  intrinsicHeight: number;
  fit: 'contain' | 'fill';
}

interface BlockObstacle {
  kind: 'block-obstacle';
  resolvedX: number;
  width: number;
  height: number;
  wrap: 'around' | 'top-bottom' | 'none';
  gap: number;
  yAnchor: 'at-cursor';
  align: 'left' | 'center' | 'right';
  mode: 'float' | 'story-absolute';
  content: FlowBlock;
  source: SourceRef;
}

interface NormalizeContext {
  document: DocumentIR;
  fixtureName: string;
  pageGeometry: SpatialDocumentFixture['pageGeometry'];
}

interface ContentScope {
  contentWidth: number;
  path: string;
}

interface TrackSizingDefinition {
  mode: 'fixed' | 'auto' | 'flex';
  value?: number;
  fr?: number;
  min?: number;
  max?: number;
  basis?: number;
  minContent?: number;
  maxContent?: number;
  grow?: number;
  shrink?: number;
}

const PROVISIONAL_FIELDS = [
  'ZoneStrip.content for linked strips',
  'ZoneStrip.balance',
  'ZoneStrip.blockStyle',
  'SpatialZone.style',
  'SpatialGrid.blockStyle',
  'CompiledPageRegion.kind',
  'FlowBlock.image',
  'BlockObstacle.align',
  'BlockObstacle.mode',
  'Node.source provenance'
] as const;

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function toRecord(value: unknown): Record<string, unknown> | undefined {
  return isObject(value) ? value : undefined;
}

function toStyleRecord(value: unknown): Record<string, unknown> {
  return isObject(value) ? { ...value } : {};
}

function normalizeTrackDefinitions(columns: unknown, fallbackCount: number): TrackSizingDefinition[] {
  if (Array.isArray(columns) && columns.length > 0) {
    return columns.map((column) => {
      const record = isObject(column) ? column : {};
      const mode = record.mode === 'fixed' || record.mode === 'auto' || record.mode === 'flex'
        ? record.mode
        : 'flex';
      return {
        ...record,
        mode
      } as TrackSizingDefinition;
    });
  }

  return Array.from({ length: fallbackCount }, () => ({ mode: 'flex', fr: 1 }));
}

function deepSortObject<T>(value: T): T {
  if (Array.isArray(value)) return value.map((entry) => deepSortObject(entry)) as T;
  if (!isObject(value)) return value;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort((left, right) => left.localeCompare(right))) {
    const next = value[key];
    if (next === undefined) continue;
    out[key] = deepSortObject(next);
  }
  return out as T;
}

function mergeStyle(document: DocumentIR, element: Element, extraStyle?: Record<string, unknown>): Record<string, unknown> {
  return deepSortObject({
    ...(document.styles?.[element.type] || {}),
    ...(element.properties?.style || {}),
    ...(extraStyle || {})
  });
}

function buildSourceRef(element: Element, elementPath: string): SourceRef {
  const properties = element.properties || {};
  const source: SourceRef = { path: elementPath };
  if (typeof properties.sourceId === 'string' && properties.sourceId.trim()) source.sourceId = properties.sourceId;
  if (typeof properties.semanticRole === 'string' && properties.semanticRole.trim()) source.semanticRole = properties.semanticRole;
  if (typeof properties.reflowKey === 'string' && properties.reflowKey.trim()) source.reflowKey = properties.reflowKey;
  if (typeof properties.language === 'string' && properties.language.trim()) source.language = properties.language;
  if (typeof properties.sourceSyntax === 'string' && properties.sourceSyntax.trim()) source.sourceSyntax = properties.sourceSyntax;
  if (isObject(properties.sourceRange)) source.sourceRange = { ...properties.sourceRange };
  return source;
}

function getPageGeometry(document: DocumentIR, config: LayoutConfig): SpatialDocumentFixture['pageGeometry'] {
  const dimensions = LayoutUtils.getPageDimensions(config);
  const margins = config.layout.margins;
  return {
    pageWidth: dimensions.width,
    pageHeight: dimensions.height,
    contentX: margins.left,
    contentY: margins.top,
    contentWidth: Math.max(0, dimensions.width - margins.left - margins.right),
    contentHeight: Math.max(0, dimensions.height - margins.top - margins.bottom),
    margins: { ...margins }
  };
}

function computeOuterWidth(parentContentWidth: number, style?: Record<string, unknown>): number {
  const marginLeft = LayoutUtils.validateUnit(style?.marginLeft ?? 0);
  const marginRight = LayoutUtils.validateUnit(style?.marginRight ?? 0);
  if (style?.width !== undefined) return Math.max(0, LayoutUtils.validateUnit(style.width));
  return Math.max(0, parentContentWidth - marginLeft - marginRight);
}

function computeContentWidth(parentContentWidth: number, style?: Record<string, unknown>): number {
  const outerWidth = computeOuterWidth(parentContentWidth, style);
  const insets = LayoutUtils.getHorizontalInsets(style || {});
  return Math.max(0, outerWidth - insets);
}

function resolveObstacleDimensions(style: Record<string, unknown>, image?: EmbeddedImagePayload): { width: number; height: number } {
  const width = style.width !== undefined ? LayoutUtils.validateUnit(style.width) : 0;
  if (style.height !== undefined) {
    return {
      width: Math.max(0, width),
      height: Math.max(0, LayoutUtils.validateUnit(style.height))
    };
  }
  if (image && width > 0) {
    const parsed = parseEmbeddedImagePayloadCached(image);
    return {
      width,
      height: width * (parsed.intrinsicHeight / Math.max(1, parsed.intrinsicWidth))
    };
  }
  return { width: Math.max(0, width), height: 0 };
}

function resolveFloatX(align: 'left' | 'center' | 'right', obstacleWidth: number, zoneWidth: number, gap: number): number {
  if (align === 'right') return Math.max(0, zoneWidth - obstacleWidth - gap);
  if (align === 'center') return Math.max(0, (zoneWidth - obstacleWidth) / 2);
  return 0;
}

function compileEmbeddedImage(image?: EmbeddedImagePayload): EmbeddedImageDescriptor | undefined {
  if (!image) return undefined;
  const parsed = parseEmbeddedImagePayloadCached(image);
  return deepSortObject({
    data: parsed.base64Data,
    mimeType: parsed.mimeType,
    intrinsicWidth: parsed.intrinsicWidth,
    intrinsicHeight: parsed.intrinsicHeight,
    fit: parsed.fit
  });
}

function compilePageRegions(context: NormalizeContext, role: 'header' | 'footer', definition?: PageRegionDefinition): CompiledPageRegionSet | undefined {
  if (!definition) return undefined;
  const pageWidth = context.pageGeometry.pageWidth;
  const margins = context.pageGeometry.margins;
  const insetTop = role === 'header'
    ? LayoutUtils.validateUnit(context.document.layout.headerInsetTop ?? 0)
    : LayoutUtils.validateUnit(context.document.layout.footerInsetTop ?? 0);
  const insetBottom = role === 'header'
    ? LayoutUtils.validateUnit(context.document.layout.headerInsetBottom ?? 0)
    : LayoutUtils.validateUnit(context.document.layout.footerInsetBottom ?? 0);
  const regionWidth = Math.max(0, pageWidth - margins.left - margins.right);
  const regionHeight = role === 'header'
    ? Math.max(0, margins.top - insetTop - insetBottom)
    : Math.max(0, margins.bottom - insetTop - insetBottom);
  const regionY = role === 'header'
    ? insetTop
    : context.pageGeometry.pageHeight - margins.bottom + insetTop;

  const compileOne = (
    selector: 'default' | 'firstPage' | 'odd' | 'even',
    region: PageRegionContent | null | undefined
  ): CompiledPageRegion | null | undefined => {
    if (region === undefined) return undefined;
    if (region === null) return null;
    const style = toStyleRecord(region.style);
    return deepSortObject({
      kind: 'page-region',
      role,
      selector,
      x: margins.left,
      y: regionY,
      width: regionWidth,
      height: regionHeight,
      style: Object.keys(style).length > 0 ? style : undefined,
      content: normalizeZoneContent(region.elements || [], context, {
        contentWidth: computeContentWidth(regionWidth, style),
        path: `${role}.${selector}.elements`
      })
    });
  };

  return deepSortObject({
    default: compileOne('default', definition.default),
    firstPage: compileOne('firstPage', definition.firstPage),
    odd: compileOne('odd', definition.odd),
    even: compileOne('even', definition.even)
  });
}

function compilePageOverrides(context: NormalizeContext, rawOverrides: unknown): FlowBlock['pageOverrides'] | undefined {
  if (!isObject(rawOverrides)) return undefined;
  const pageWidth = context.pageGeometry.pageWidth;
  const margins = context.pageGeometry.margins;
  const compileOne = (role: 'header' | 'footer', region: unknown): CompiledPageRegion | null | undefined => {
    if (region === undefined) return undefined;
    if (region === null) return null;
    if (!isObject(region)) return undefined;
    const pageRegion = region as unknown as PageRegionContent;
    const insetTop = role === 'header'
      ? LayoutUtils.validateUnit(context.document.layout.headerInsetTop ?? 0)
      : LayoutUtils.validateUnit(context.document.layout.footerInsetTop ?? 0);
    const insetBottom = role === 'header'
      ? LayoutUtils.validateUnit(context.document.layout.headerInsetBottom ?? 0)
      : LayoutUtils.validateUnit(context.document.layout.footerInsetBottom ?? 0);
    const width = Math.max(0, pageWidth - margins.left - margins.right);
    const height = role === 'header'
      ? Math.max(0, margins.top - insetTop - insetBottom)
      : Math.max(0, margins.bottom - insetTop - insetBottom);
    const y = role === 'header'
      ? insetTop
      : context.pageGeometry.pageHeight - margins.bottom + insetTop;
    const style = toStyleRecord(pageRegion.style);
    return deepSortObject({
      kind: 'page-region',
      role,
      selector: 'default',
      x: margins.left,
      y,
      width,
      height,
      style: Object.keys(style).length > 0 ? style : undefined,
      content: normalizeZoneContent(pageRegion.elements || [], context, {
        contentWidth: computeContentWidth(width, style),
        path: `pageOverrides.${role}.elements`
      })
    });
  };
  const compiled = deepSortObject({
    header: compileOne('header', rawOverrides.header),
    footer: compileOne('footer', rawOverrides.footer)
  });
  return Object.keys(compiled).length > 0 ? compiled : undefined;
}

function createFlowBlock(element: Element, context: NormalizeContext, scope: ContentScope): FlowBlock {
  const style = mergeStyle(context.document, element);
  const properties = toRecord(element.properties) || {};
  return deepSortObject({
    kind: 'flow-block',
    sourceType: element.type,
    content: element.content || '',
    children: Array.isArray(element.children) && element.children.length > 0
      ? JSON.parse(JSON.stringify(element.children))
      : undefined,
    columnSpan: element.columnSpan === 'all'
      ? 'all'
      : (typeof element.columnSpan === 'number' ? element.columnSpan : undefined),
    style,
    keepWithNext: Boolean(properties.keepWithNext ?? style.keepWithNext),
    pageBreakBefore: Boolean(style.pageBreakBefore),
    allowLineSplit: style.allowLineSplit !== false,
    overflowPolicy: (style.overflowPolicy as FlowBlock['overflowPolicy']) || 'clip',
    dropCap: isObject(element.dropCap) ? deepSortObject({ ...element.dropCap }) : undefined,
    paginationContinuation: isObject(properties.paginationContinuation)
      ? deepSortObject({ ...properties.paginationContinuation })
      : undefined,
    pageReservationAfter: properties.pageReservationAfter !== undefined
      ? Math.max(0, LayoutUtils.validateUnit(properties.pageReservationAfter))
      : undefined,
    pageOverrides: compilePageOverrides(context, properties.pageOverrides),
    image: compileEmbeddedImage(element.image),
    source: buildSourceRef(element, scope.path)
  });
}

function createBlockObstacle(element: Element, context: NormalizeContext, scope: ContentScope): BlockObstacle {
  const style = mergeStyle(context.document, element);
  const layout = (element.placement || {}) as StoryLayoutDirective;
  const gap = Math.max(0, LayoutUtils.validateUnit(layout?.gap ?? 0));
  const align = (layout?.align || 'left') as BlockObstacle['align'];
  const mode = (layout?.mode || 'float') as BlockObstacle['mode'];
  const dimensions = resolveObstacleDimensions(style, element.image);
  const resolvedX = mode === 'story-absolute'
    ? Math.max(0, LayoutUtils.validateUnit(layout?.x ?? 0))
    : resolveFloatX(align, dimensions.width, scope.contentWidth, gap);
  return deepSortObject({
    kind: 'block-obstacle',
    resolvedX,
    width: dimensions.width,
    height: dimensions.height,
    wrap: (layout?.wrap || 'around') as BlockObstacle['wrap'],
    gap,
    yAnchor: 'at-cursor',
    align,
    mode,
    content: createFlowBlock(element, context, scope),
    source: buildSourceRef(element, scope.path)
  });
}

function isBlockObstacle(element: Element): boolean {
  const mode = String(element.placement?.mode || '');
  return mode === 'float' || mode === 'story-absolute';
}

function normalizeZoneContent(elements: Element[], context: NormalizeContext, scope: ContentScope): ZoneContent {
  const items: ZoneContentItem[] = [];
  for (let index = 0; index < elements.length; index += 1) {
    const element = elements[index];
    const nextScope = { contentWidth: scope.contentWidth, path: `${scope.path}[${index}]` };
    const normalized = normalizeElement(element, context, nextScope);
    if (Array.isArray(normalized)) items.push(...normalized);
    else items.push(normalized);
  }
  return deepSortObject({ items });
}

function normalizeElement(element: Element, context: NormalizeContext, scope: ContentScope): ZoneContentItem | ZoneContentItem[] {
  if (element.type === 'story') return normalizeStory(element, context, scope);
  if (element.type === 'zone-map') return normalizeZoneMap(element, context, scope);
  if (element.type === 'table') return normalizeTable(element, context, scope);
  if (isBlockObstacle(element)) return createBlockObstacle(element, context, scope);
  return createFlowBlock(element, context, scope);
}

function normalizeStory(element: Element, context: NormalizeContext, scope: ContentScope): ZoneContentItem[] {
  const blockStyle = mergeStyle(context.document, element);
  const storyWidth = computeContentWidth(scope.contentWidth, blockStyle);
  const columns = Math.max(1, Math.trunc(Number(element.columns || 1)));
  const gutter = Math.max(0, LayoutUtils.validateUnit(element.gutter ?? 0));
  const balance = Boolean(element.balance ?? element.properties?.balance);
  const columnWidth = columns <= 1
    ? storyWidth
    : Math.max(0, (storyWidth - (gutter * Math.max(0, columns - 1))) / columns);
  const zones = Array.from({ length: columns }, (_, index) => ({
    x: index * (columnWidth + gutter),
    width: columnWidth
  }));
  const children = Array.isArray(element.children) ? element.children : [];

  if (columns <= 1) {
    return [deepSortObject({
      kind: 'zone-strip',
      overflow: 'linked',
      sourceKind: 'story',
      zones,
      content: normalizeZoneContent(children, context, {
        contentWidth: columnWidth,
        path: `${scope.path}.children`
      }),
      balance,
      blockStyle: Object.keys(blockStyle).length > 0 ? blockStyle : undefined,
      source: buildSourceRef(element, scope.path)
    })];
  }

  const output: ZoneContentItem[] = [];
  let segmentIndex = 0;
  let cursor = 0;
  while (cursor < children.length) {
    const child = children[cursor];
    const columnSpan = child.columnSpan;
    const isSpan = columnSpan === 'all' || (typeof columnSpan === 'number' && Number.isFinite(columnSpan) && columnSpan >= 2);
    if (isSpan) {
      output.push(createFlowBlock(child, context, {
        contentWidth: storyWidth,
        path: `${scope.path}.children[${cursor}]`
      }));
      cursor += 1;
      continue;
    }
    const segmentChildren: Element[] = [];
    while (cursor < children.length) {
      const segmentChild = children[cursor];
      const segmentSpan = segmentChild.columnSpan;
      const hitsSpan = segmentSpan === 'all' || (typeof segmentSpan === 'number' && Number.isFinite(segmentSpan) && segmentSpan >= 2);
      if (hitsSpan) break;
      segmentChildren.push(segmentChild);
      cursor += 1;
    }
    if (segmentChildren.length === 0) continue;
    output.push(deepSortObject({
      kind: 'zone-strip',
      overflow: 'linked',
      sourceKind: 'story',
      zones,
      content: normalizeZoneContent(segmentChildren, context, {
        contentWidth: columnWidth,
        path: `${scope.path}.children.segment[${segmentIndex}]`
      }),
      balance,
      blockStyle: segmentIndex === 0 && Object.keys(blockStyle).length > 0 ? blockStyle : undefined,
      source: buildSourceRef(element, `${scope.path}#segment-${segmentIndex}`)
    }));
    segmentIndex += 1;
  }
  return output;
}

function normalizeZoneMap(element: Element, context: NormalizeContext, scope: ContentScope): ZoneStrip {
  const blockStyle = mergeStyle(context.document, element);
  const mapWidth = computeContentWidth(scope.contentWidth, blockStyle);
  const zoneOptions = element.zoneLayout || {};
  const gap = Math.max(0, LayoutUtils.validateUnit(zoneOptions.gap ?? 0));
  const declaredZones = Array.isArray(element.zones) ? element.zones : [];
  const trackDefinitions = normalizeTrackDefinitions(zoneOptions.columns, declaredZones.length || 1);
  const solved = solveTrackSizing({
    containerWidth: mapWidth,
    tracks: trackDefinitions,
    gap
  });
  const zones = declaredZones.map((zone: ZoneDefinition, index: number) => {
    const x = solved.sizes.slice(0, index).reduce((sum, entry) => sum + entry, 0) + (index * gap);
    const width = solved.sizes[index] ?? 0;
    return deepSortObject({
      id: zone.id,
      x,
      width,
      style: zone.style ? { ...zone.style } : undefined,
      content: normalizeZoneContent(zone.elements || [], context, {
        contentWidth: computeContentWidth(width, zone.style || {}),
        path: `${scope.path}.zones[${index}].elements`
      })
    });
  });
  return deepSortObject({
    kind: 'zone-strip',
    overflow: 'independent',
    sourceKind: 'zone-map',
    zones,
    blockStyle: Object.keys(blockStyle).length > 0 ? blockStyle : undefined,
    source: buildSourceRef(element, scope.path)
  });
}

function stripCellWrapper(cell: Element): Element {
  return {
    ...cell,
    properties: {
      ...(cell.properties || {}),
      style: {
        ...(cell.properties?.style || {})
      }
    }
  };
}

function countRowColumns(row: Element): number {
  const children = Array.isArray(row.children) ? row.children : [];
  return children.reduce((sum, child) => sum + Math.max(1, Math.trunc(Number(child.properties?.colSpan || 1))), 0);
}

function normalizeTable(element: Element, context: NormalizeContext, scope: ContentScope): SpatialGrid {
  const blockStyle = mergeStyle(context.document, element);
  const tableWidth = computeContentWidth(scope.contentWidth, blockStyle);
  const tableOptions = element.table || {};
  const columnGap = Math.max(0, LayoutUtils.validateUnit(tableOptions.columnGap ?? 0));
  const rowGap = Math.max(0, LayoutUtils.validateUnit(tableOptions.rowGap ?? 0));
  const headerRows = Math.max(0, Math.trunc(Number(tableOptions.headerRows || 0)));
  const repeatHeader = Boolean(tableOptions.repeatHeader);
  const rows = Array.isArray(element.children) ? element.children : [];
  const maxExplicitColumns = Math.max(1, ...rows.map((row) => countRowColumns(row)));
  const trackDefinitions = normalizeTrackDefinitions(tableOptions.columns, maxExplicitColumns);
  const solved = solveTrackSizing({
    containerWidth: tableWidth,
    tracks: trackDefinitions,
    gap: columnGap
  });

  const resolvedColumns: ResolvedColumn[] = solved.sizes.map((width, index) => ({
    x: solved.sizes.slice(0, index).reduce((sum, entry) => sum + entry, 0) + (index * columnGap),
    width
  }));

  const cells: GridCell[] = [];
  const occupied = new Map<string, boolean>();
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    const children = Array.isArray(row.children) ? row.children : [];
    let currentColumn = 0;
    for (let cellIndex = 0; cellIndex < children.length; cellIndex += 1) {
      while (occupied.get(`${rowIndex}:${currentColumn}`)) currentColumn += 1;
      const cell = children[cellIndex];
      const rowSpan = Math.max(1, Math.trunc(Number(cell.properties?.rowSpan || 1)));
      const colSpan = Math.max(1, Math.trunc(Number(cell.properties?.colSpan || 1)));
      for (let rowOffset = 0; rowOffset < rowSpan; rowOffset += 1) {
        for (let colOffset = 0; colOffset < colSpan; colOffset += 1) {
          occupied.set(`${rowIndex + rowOffset}:${currentColumn + colOffset}`, true);
        }
      }
      const startX = resolvedColumns[currentColumn]?.x ?? 0;
      const spanColumns = resolvedColumns.slice(currentColumn, currentColumn + colSpan);
      const spanWidth = spanColumns.reduce((sum, column) => sum + column.width, 0) + (Math.max(0, colSpan - 1) * columnGap);
      const extraCellStyle = rowIndex < headerRows
        ? toStyleRecord(tableOptions.headerCellStyle)
        : toStyleRecord(tableOptions.cellStyle);
      const mergedCellStyle = mergeStyle(context.document, cell, extraCellStyle);
      cells.push(deepSortObject({
        row: rowIndex,
        col: currentColumn,
        rowSpan,
        colSpan,
        resolvedX: startX,
        resolvedWidth: spanWidth,
        rowGroup: rowIndex < headerRows ? 'header' : 'body',
        content: normalizeZoneContent([stripCellWrapper(cell)], context, {
          contentWidth: computeContentWidth(spanWidth, mergedCellStyle),
          path: `${scope.path}.children[${rowIndex}].children[${cellIndex}]`
        }),
        style: mergedCellStyle,
        source: buildSourceRef(cell, `${scope.path}.children[${rowIndex}].children[${cellIndex}]`)
      }));
      currentColumn += colSpan;
    }
  }

  return deepSortObject({
    kind: 'spatial-grid',
    resolvedColumns,
    columns: Array.isArray(trackDefinitions) && trackDefinitions.length > 0
      ? trackDefinitions.map((column) => deepSortObject({ ...column }))
      : undefined,
    columnGap,
    rowGap,
    headerRows,
    repeatHeader,
    cells,
    blockStyle: Object.keys(blockStyle).length > 0 ? blockStyle : undefined,
    cellStyle: isObject(tableOptions.cellStyle) ? deepSortObject(toStyleRecord(tableOptions.cellStyle)) : undefined,
    headerCellStyle: isObject(tableOptions.headerCellStyle) ? deepSortObject(toStyleRecord(tableOptions.headerCellStyle)) : undefined,
    paginationContinuation: isObject(element.properties?.paginationContinuation)
      ? deepSortObject({ ...(element.properties?.paginationContinuation as Record<string, unknown>) })
      : undefined,
    pageReservationAfter: element.properties?.pageReservationAfter !== undefined
      ? Math.max(0, LayoutUtils.validateUnit(element.properties.pageReservationAfter))
      : undefined,
    source: buildSourceRef(element, scope.path)
  });
}

export function createSpatialDocumentFixture(document: DocumentIR, fixtureName: string, config: LayoutConfig): SpatialDocumentFixture {
  const pageGeometry = getPageGeometry(document, config);
  const context: NormalizeContext = { document, fixtureName, pageGeometry };
  return deepSortObject({
    spatialIrVersion: '0.1',
    source: {
      fixture: fixtureName,
      documentVersion: document.documentVersion,
      irVersion: document.irVersion
    },
    pageGeometry,
    pageTemplate: {
      header: compilePageRegions(context, 'header', document.header),
      footer: compilePageRegions(context, 'footer', document.footer)
    },
    items: normalizeZoneContent(document.elements, context, {
      contentWidth: pageGeometry.contentWidth,
      path: 'elements'
    }).items,
    notes: {
      coordinateSpace: 'zone.x is parent-relative',
      provisionalFields: [...PROVISIONAL_FIELDS]
    }
  });
}
