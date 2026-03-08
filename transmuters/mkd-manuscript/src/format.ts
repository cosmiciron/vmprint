import type { Element, SemanticNode, FormatContext } from '@vmprint/markdown-core';
import { inlinePlainText, collapseTextSoftBreaks } from '@vmprint/markdown-core';

type CoverFields = Record<string, string>;

function normalizeKey(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, '-');
}

function parseKeyValueLine(node: SemanticNode): { key: string; value: string } | null {
  const text = inlinePlainText(node.children || []).trim();
  const match = /^([^:]+):\s*(.+)$/.exec(text);
  if (!match) return null;
  return { key: normalizeKey(match[1]), value: match[2].trim() };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asBool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function asString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim().length > 0 ? value : fallback;
}

function formatWordCount(raw: string): string {
  const digits = raw.replace(/[^\d]/g, '');
  if (!digits) return raw;
  const count = Number(digits);
  if (!Number.isFinite(count) || count <= 0) return raw;
  const rounded = Math.round(count / 1000) * 1000;
  return `${rounded.toLocaleString('en-US')} words`;
}

export class ManuscriptFormat {
  private readonly footnotes: Record<string, SemanticNode[]>;
  private readonly manuscriptConfig: Record<string, unknown>;
  private readonly coverConfig: Record<string, unknown>;
  private readonly chapterConfig: Record<string, unknown>;
  private readonly sceneBreakConfig: Record<string, unknown>;
  private readonly coverMode: 'first-page-cover' | 'separate-cover-page' | 'none';
  private readonly footnoteHeading: string;
  private readonly sceneBreakSymbol: string;
  private pendingBodyPageBreak = false;
  private nextParagraphIsFirst = false;
  private sawTitle = false;

  constructor(private readonly config: Record<string, unknown>) {
    this.footnotes = asRecord(config.__footnotes) as Record<string, SemanticNode[]>;
    this.manuscriptConfig = asRecord(config.manuscript);
    this.coverConfig = asRecord(this.manuscriptConfig.coverPage);
    this.chapterConfig = asRecord(this.manuscriptConfig.chapter);
    this.sceneBreakConfig = asRecord(this.manuscriptConfig.sceneBreak);
    this.coverMode = asString(this.coverConfig.mode, 'first-page-cover') as 'first-page-cover' | 'separate-cover-page' | 'none';
    this.footnoteHeading = asString(asRecord(this.manuscriptConfig.footnotes).heading, 'Notes');
    this.sceneBreakSymbol = asString(this.sceneBreakConfig.symbol, '#');
  }

  handleBlock(_node: SemanticNode, _ctx: FormatContext): void {
    // Buffered processing happens in flush() to enable lookahead/consumption.
  }

  flush(ctx: FormatContext): void {
    const buffer = (this.config.__nodes as SemanticNode[]) || [];

    for (let i = 0; i < buffer.length; i++) {
      const node = buffer[i];

      if (node.kind === 'h1' && !this.sawTitle) {
        this.sawTitle = true;
        const consumed = this.handleTitleAndCover(node, buffer[i + 1], ctx);
        if (consumed) i += 1;
        continue;
      }

      if (node.kind === 'h2') {
        const style: Record<string, unknown> = {};
        if (asBool(this.chapterConfig.pageBreakBefore, true)) {
          style.pageBreakBefore = true;
          style.marginTop = 216;
        }
        if (this.pendingBodyPageBreak) {
          style.pageBreakBefore = true;
          this.pendingBodyPageBreak = false;
        }
        this.emitWithProperties(ctx, 'chapter-heading', node.children || [], node, style);
        this.nextParagraphIsFirst = true;
        continue;
      }

      if (node.kind === 'h3' || node.kind === 'h4' || node.kind === 'h5' || node.kind === 'h6') {
        this.emitWithProperties(ctx, 'scene-break', this.resolveSceneBreakText(node), node);
        this.nextParagraphIsFirst = false;
        continue;
      }

      if (node.kind === 'hr') {
        this.emitWithProperties(ctx, 'scene-break', this.sceneBreakSymbol, node);
        this.nextParagraphIsFirst = true;
        continue;
      }

      if (node.kind === 'code') {
        this.handleCodeDisplay(node, ctx);
        this.nextParagraphIsFirst = false;
        continue;
      }

      if (node.kind === 'blockquote') {
        this.handleBlockquote(node, ctx);
        this.nextParagraphIsFirst = false;
        continue;
      }

      if (node.kind === 'p') {
        const role = this.nextParagraphIsFirst ? 'paragraph-first' : 'paragraph';
        this.emitWithProperties(ctx, role, collapseTextSoftBreaks(node.children || []), node);
        this.nextParagraphIsFirst = false;
        continue;
      }

      if (node.kind === 'ul' || node.kind === 'ol') {
        let orderedIndex = typeof node.start === 'number' && Number.isFinite(node.start) ? node.start : 1;
        for (const item of node.children || []) {
          const firstPara = (item.children || []).find((child) => child.kind === 'p');
          if (!firstPara) continue;
          const marker = node.kind === 'ol' ? `${orderedIndex}. ` : '- ';
          this.emitWithProperties(ctx, 'paragraph', collapseTextSoftBreaks([{ kind: 'text', value: marker } as SemanticNode, ...(firstPara.children || [])]), item);
          if (node.kind === 'ol') orderedIndex += 1;
        }
        this.nextParagraphIsFirst = false;
        continue;
      }
    }

    if (ctx.registeredFootnoteCount() > 0) {
      ctx.emit('notes-heading', this.footnoteHeading, {
        style: { pageBreakBefore: true }
      });

      for (const entry of ctx.registeredFootnotes()) {
        const fallback = [{ kind: 'text', value: `[missing footnote: ${entry.identifier}]` } as SemanticNode];
        const content = entry.content || this.footnotes[entry.identifier] || fallback;
        ctx.emit('notes-item', collapseTextSoftBreaks([{ kind: 'text', value: `${entry.index}. ` } as SemanticNode, ...content]));
      }
    }
  }

  private emitWithProperties(
    ctx: FormatContext,
    role: string,
    content: string | SemanticNode[],
    node?: SemanticNode,
    style?: Record<string, unknown>,
    extraProps?: Record<string, unknown>
  ): void {
    const properties: Record<string, unknown> = {
      sourceRange: node?.sourceRange,
      sourceSyntax: node?.sourceSyntax,
      ...(extraProps || {})
    };

    if (style && Object.keys(style).length > 0) {
      properties.style = style;
    }

    if (this.pendingBodyPageBreak && !role.startsWith('cover-')) {
      properties.style = { ...(properties.style as Record<string, unknown> || {}), pageBreakBefore: true };
      this.pendingBodyPageBreak = false;
    }

    ctx.emit(role, content, properties);
  }

  private handleTitleAndCover(titleNode: SemanticNode, nextNode: SemanticNode | undefined, ctx: FormatContext): boolean {
    if (this.coverMode === 'none') {
      this.emitWithProperties(ctx, 'chapter-heading', titleNode.children || [], titleNode);
      this.nextParagraphIsFirst = true;
      return false;
    }

    const fields: CoverFields = {};
    if (nextNode?.kind === 'ul') {
      for (const item of nextNode.children || []) {
        const firstPara = (item.children || []).find((child) => child.kind === 'p');
        if (!firstPara) continue;
        const parsed = parseKeyValueLine(firstPara);
        if (!parsed) continue;
        fields[parsed.key] = parsed.value;
      }
    }

    const authorValue = fields['author'] || '';
    const rawWordCount = fields['word-count'] || '';
    this.emitCoverHeaderRow(authorValue, rawWordCount, titleNode, ctx);

    const personalKeys = ['address', 'phone', 'email'] as const;
    for (const key of personalKeys) {
      if (fields[key]) {
        this.emitWithProperties(ctx, 'cover-line', fields[key], titleNode, undefined, {
          _coverKey: key,
          _coverValue: fields[key],
          pageOverrides: { header: null, footer: null }
        });
      }
    }

    this.emitWithProperties(ctx, 'cover-title', titleNode.children || [], titleNode, undefined, {
      pageOverrides: { header: null, footer: null }
    });

    const byline = fields['byline'] || fields['author'] || '';
    if (byline) {
      this.emitWithProperties(ctx, 'cover-line', `By ${byline}`, titleNode, { textAlign: 'center' }, {
        _coverKey: fields['byline'] ? 'byline' : 'byline-derived',
        _coverValue: byline,
        pageOverrides: { header: null, footer: null }
      });
    }

    const footerKeys = ['agent', 'rights'] as const;
    const footerCount = footerKeys.filter((key) => !!fields[key]).length;
    const footerMarginTop = footerCount > 1 ? 132 : 180;
    let isFirstFooter = true;
    for (const key of footerKeys) {
      if (fields[key]) {
        const style = isFirstFooter && this.coverMode === 'separate-cover-page'
          ? { marginTop: footerMarginTop }
          : undefined;
        this.emitWithProperties(ctx, 'cover-line', fields[key], titleNode, style, {
          _coverKey: key,
          _coverValue: fields[key],
          pageOverrides: { header: null, footer: null }
        });
        isFirstFooter = false;
      }
    }

    if (this.coverMode === 'separate-cover-page') {
      this.pendingBodyPageBreak = true;
    }

    return nextNode?.kind === 'ul';
  }

  private emitCoverHeaderRow(author: string, rawWordCount: string, titleNode: SemanticNode, ctx: FormatContext): void {
    const wordCountText = rawWordCount ? formatWordCount(rawWordCount) : '';
    const authorCell: Element = {
      type: 'table-cell',
      content: '',
      children: [{ type: 'text', content: author }],
      properties: { style: { textAlign: 'left' } }
    };
    const wordCountCell: Element = {
      type: 'table-cell',
      content: '',
      children: [{ type: 'text', content: wordCountText }],
      properties: { style: { textAlign: 'right' } }
    };
    ctx.emitRaw({
      type: 'table',
      content: '',
      children: [{ type: 'table-row', content: '', children: [authorCell, wordCountCell] }],
      properties: {
        table: { headerRows: 0, columnGap: 0, columns: [{ mode: 'flex', fr: 1 }, { mode: 'flex', fr: 1 }] },
        style: { marginBottom: 6 },
        _coverKey: 'author',
        _coverValue: author,
        _coverFields: { author, 'word-count': rawWordCount },
        sourceRange: titleNode.sourceRange,
        pageOverrides: { header: null, footer: null }
      }
    });
  }

  private handleCodeDisplay(node: SemanticNode, ctx: FormatContext): void {
    const lang = String(node.language || '').trim().toLowerCase();
    const map: Record<string, string> = {
      poem: 'poem',
      lyrics: 'lyrics',
      epigraph: 'epigraph',
      extract: 'literary-quote'
    };

    const role = map[lang] || 'literary-quote';
    if (role === 'epigraph') {
      this.emitEpigraphFromRaw(node.value || '', node, ctx);
      return;
    }

    this.emitWithProperties(ctx, role, node.value || '', node);
  }

  private handleBlockquote(node: SemanticNode, ctx: FormatContext): void {
    const paragraphs = (node.children || []).filter((child) => child.kind === 'p');
    if (paragraphs.length === 0) return;

    const rawParagraphs = paragraphs.map((para) => inlinePlainText(para.children || []));
    const firstRaw = rawParagraphs[0].trim();
    const markerMatch = /^\[(poem|lyrics|epigraph)\](?:\s*\n([\s\S]*))?$/i.exec(firstRaw);

    if (markerMatch) {
      const marked = markerMatch[1].toLowerCase();
      const remainder = (markerMatch[2] || '').trim();
      let startIndex = 0;
      if (remainder.length > 0) {
        rawParagraphs[0] = remainder;
      } else {
        startIndex = 1;
      }
      const usableRaw = rawParagraphs.slice(startIndex);
      if (usableRaw.length === 0) return;
      if (marked === 'epigraph') {
        this.emitEpigraphFromRaw(usableRaw.join('\n\n'), node, ctx);
        return;
      }
      this.emitWithProperties(ctx, marked, usableRaw.join('\n\n'), node);
      return;
    }

    const merged: SemanticNode[] = [];
    paragraphs.forEach((para, index) => {
      if (index > 0) merged.push({ kind: 'text', value: '\n' });
      merged.push(...(para.children || []));
    });
    this.emitWithProperties(ctx, 'blockquote', collapseTextSoftBreaks(merged), node);
  }

  private emitEpigraphFromRaw(raw: string, node: SemanticNode, ctx: FormatContext): void {
    const lines = raw.split(/\r?\n/);
    let attribution = '';
    if (lines.length > 0) {
      const last = lines[lines.length - 1].trim();
      const attrMatch = /^[-\u2014\u2013]{2}\s+(.+)$/.exec(last);
      if (attrMatch) {
        attribution = attrMatch[1].trim();
        lines.pop();
      }
    }

    const body = lines.join('\n').trimEnd();
    this.emitWithProperties(ctx, 'epigraph', body, node, attribution ? { keepWithNext: true } : undefined);
    if (attribution) {
      this.emitWithProperties(ctx, 'epigraph-attribution', attribution, node);
    }
  }

  private resolveSceneBreakText(node: SemanticNode): string {
    const headingText = inlinePlainText(node.children || []).trim();
    if (!headingText) return this.sceneBreakSymbol;
    if (/^[#*\-_.\s]+$/.test(headingText)) return this.sceneBreakSymbol;
    return headingText;
  }
}
