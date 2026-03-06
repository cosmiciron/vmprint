import type { Element, ElementStyle, ResolvedImage } from './types';
import type { SemanticNode } from './semantic';
import type { ThemeDefinition } from './theme';
import { inlineToElements, applySmartQuotes, makeInlineContext } from './inline';
import { formatNumber as doFormatNumber } from './numbering';

// ─── Public interface ─────────────────────────────────────────────────────────

export interface FormatContext {
  emit(role: string, content: string | SemanticNode[], properties?: Record<string, unknown>): void;
  emitImage(imageNode: SemanticNode, properties?: Record<string, unknown>): void;
  emitTable(tableNode: SemanticNode, options?: TableEmitOptions): void;
  emitReferenceItem(numberPrefix: string, url: string, title?: string): void;
  emitRaw(element: Element): void;
  processInline(nodes: SemanticNode[]): Element[];
  formatNumber(value: number, style: 'decimal' | 'lower-alpha' | 'upper-alpha' | 'lower-roman' | 'upper-roman'): string;
  registerLink(url: string, title?: string): number;
  registeredLinkCount(): number;
  registeredLinks(): readonly { index: number; url: string; title?: string }[];
  registerFootnote(identifier: string, content?: SemanticNode[]): number;
  registeredFootnoteCount(): number;
  registeredFootnotes(): readonly { index: number; identifier: string; content?: SemanticNode[] }[];
  getThemeStyle(role: string): ElementStyle | undefined;
  readonly config: Record<string, unknown>;
}

export type TableEmitOptions = {
  zebra?: boolean;
  zebraColor?: string;
  headerColor?: string;
  marginLeft?: number;
  marginBottom?: number;
};

// ─── Implementation ───────────────────────────────────────────────────────────

export class FormatContextImpl implements FormatContext {
  private readonly elements: Element[] = [];
  private readonly links: { byUrl: Map<string, number>; entries: { index: number; url: string; title?: string }[] } = { byUrl: new Map(), entries: [] };
  private readonly footnotes: { byId: Map<string, number>; entries: { index: number; identifier: string; content?: SemanticNode[] }[] } = { byId: new Map(), entries: [] };
  private readonly themeStyles: Record<string, ElementStyle>;

  constructor(
    theme: ThemeDefinition,
    public readonly config: Record<string, unknown>,
    private readonly resolveImage: (node: SemanticNode) => ResolvedImage | null
  ) {
    this.themeStyles = theme.styles;
  }

  emit(role: string, content: string | SemanticNode[], properties?: Record<string, unknown>): void {
    let element: Element;
    if (typeof content === 'string') {
      const typoCfg = (this.config.typography as Record<string, unknown>) || {};
      const sq = typoCfg.smartQuotes !== false;
      element = { type: role, content: sq ? applySmartQuotes(content) : content, ...(properties ? { properties } : {}) };
    } else {
      const ctx = makeInlineContext(
        this.themeStyles,
        this.config,
        this.resolveImage,
        (url, title) => this.registerLink(url, title),
        (id, c) => this.registerFootnote(id, c)
      );
      const children = inlineToElements(content, ctx);
      element = { type: role, content: '', children, ...(properties ? { properties } : {}) };
    }
    this.elements.push(element);
  }

  emitImage(imageNode: SemanticNode, properties?: Record<string, unknown>): void {
    const resolved = this.resolveImage(imageNode);
    if (!resolved) {
      // Skip unresolved images — the engine rejects unknown property keys
      // and an image element with no data is invalid.
      return;
    }
    this.elements.push({
      type: 'image',
      content: '',
      properties: {
        image: { data: resolved.data, mimeType: resolved.mimeType, fit: 'contain' },
        sourceRange: imageNode.sourceRange,
        sourceSyntax: imageNode.sourceSyntax,
        ...(properties || {})
      }
    });
  }

  emitTable(tableNode: SemanticNode, optionsArg: TableEmitOptions = {}): void {
    const tablesCfg = (this.config.tables as Record<string, unknown>) || {};
    const options: TableEmitOptions = {
      zebra: tablesCfg.zebra as boolean | undefined,
      zebraColor: tablesCfg.zebraColor as string | undefined,
      headerColor: tablesCfg.headerColor as string | undefined,
      ...optionsArg
    };
    const rows = (tableNode.children || []).filter((n) => n.kind === 'tableRow');
    const alignments = Array.isArray(tableNode.align) ? tableNode.align : undefined;
    const inlineCtx = makeInlineContext(
      this.themeStyles,
      this.config,
      this.resolveImage,
      (url, title) => this.registerLink(url, title),
      (id, c) => this.registerFootnote(id, c)
    );

    const rowElements = rows.map((row, rowIndex) => {
      const cells = (row.children || []).filter((n) => n.kind === 'tableCell');
      const cellElements = cells.map((cell, cellIndex) => {
        const alignment = alignments && cellIndex < alignments.length ? alignments[cellIndex] : null;
        const isBodyRow = rowIndex > 0;
        const shouldStripe = options.zebra && isBodyRow && ((rowIndex - 1) % 2 === 1);
        const styleOverride: Record<string, unknown> = {};
        if (alignment === 'left' || alignment === 'right' || alignment === 'center') styleOverride.textAlign = alignment;
        if (shouldStripe && options.zebraColor) styleOverride.backgroundColor = options.zebraColor;
        const children = inlineToElements(cell.children || [], inlineCtx);
        const cellProps: Record<string, unknown> = { sourceRange: cell.sourceRange, sourceSyntax: cell.sourceSyntax };
        if (Object.keys(styleOverride).length > 0) cellProps.style = styleOverride;
        return { type: 'table-cell', content: '', children, properties: cellProps };
      });

      const rowProps: Record<string, unknown> = { sourceRange: row.sourceRange, sourceSyntax: row.sourceSyntax };
      if (rowIndex === 0) rowProps.semanticRole = 'header';
      return { type: 'table-row', content: '', children: cellElements, properties: rowProps };
    });

    const tableStyle: Record<string, unknown> = {};
    if (options.marginLeft !== undefined) tableStyle.marginLeft = options.marginLeft;
    if (options.marginBottom !== undefined) tableStyle.marginBottom = options.marginBottom;

    const headerCellStyle: Record<string, unknown> = { fontWeight: 700 };
    if (options.headerColor) headerCellStyle.backgroundColor = options.headerColor;

    const tableProps: Record<string, unknown> = { table: { headerRows: 1, repeatHeader: true, headerCellStyle }, sourceRange: tableNode.sourceRange, sourceSyntax: tableNode.sourceSyntax };
    if (Object.keys(tableStyle).length > 0) tableProps.style = tableStyle;

    this.elements.push({ type: 'table', content: '', children: rowElements as Element[], properties: tableProps });
  }

  emitReferenceItem(numberPrefix: string, url: string, title?: string): void {
    const linkStyle = this.themeStyles['link'] as Record<string, unknown> | undefined;
    const titlePart = title && title.trim() ? `${title.trim()}. ` : '';
    this.elements.push({
      type: 'references-item',
      content: '',
      children: [
        { type: 'text', content: `${numberPrefix}${titlePart}` },
        { type: 'inline', content: '', properties: { ...(linkStyle ? { style: linkStyle } : {}), linkTarget: url }, children: [{ type: 'text', content: url }] }
      ]
    });
  }

  emitRaw(element: Element): void {
    this.elements.push(element);
  }

  processInline(nodes: SemanticNode[]): Element[] {
    const ctx = makeInlineContext(
      this.themeStyles,
      this.config,
      this.resolveImage,
      (url, title) => this.registerLink(url, title),
      (id, c) => this.registerFootnote(id, c)
    );
    return inlineToElements(nodes, ctx);
  }

  formatNumber(value: number, style: 'decimal' | 'lower-alpha' | 'upper-alpha' | 'lower-roman' | 'upper-roman'): string {
    return doFormatNumber(value, style);
  }

  registerLink(url: string, title?: string): number {
    const normalized = (url || '').trim();
    if (!normalized) return 0;
    const linksCfg = (this.config.links as Record<string, unknown>) || {};
    const dedupe = linksCfg.dedupe !== false;
    if (dedupe) {
      const existing = this.links.byUrl.get(normalized);
      if (existing !== undefined) return existing;
    }
    const index = this.links.entries.length + 1;
    this.links.byUrl.set(normalized, index);
    this.links.entries.push({ index, url: normalized, title });
    return index;
  }

  registeredLinkCount(): number { return this.links.entries.length; }
  registeredLinks(): readonly { index: number; url: string; title?: string }[] { return this.links.entries; }

  registerFootnote(identifier: string, content?: SemanticNode[]): number {
    const id = String(identifier || '').trim().toLowerCase();
    if (!id) return 0;
    const existing = this.footnotes.byId.get(id);
    if (existing !== undefined) {
      const entry = this.footnotes.entries.find((e) => e.index === existing);
      if (entry && !entry.content && content?.length) entry.content = content;
      return existing;
    }
    const index = this.footnotes.entries.length + 1;
    this.footnotes.byId.set(id, index);
    this.footnotes.entries.push({ index, identifier: id, content });
    return index;
  }

  registeredFootnoteCount(): number { return this.footnotes.entries.length; }
  registeredFootnotes(): readonly { index: number; identifier: string; content?: SemanticNode[] }[] { return this.footnotes.entries; }

  getThemeStyle(role: string): ElementStyle | undefined { return this.themeStyles[role]; }

  getElements(): Element[] { return this.elements; }
}
