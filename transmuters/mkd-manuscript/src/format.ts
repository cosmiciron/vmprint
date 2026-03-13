import type { Element, SemanticNode, FormatContext } from '@vmprint/markdown-core';
import { inlinePlainText, collapseTextSoftBreaks } from '@vmprint/markdown-core';

type CoverFields = Record<string, string>;

export type ManuscriptTocEntry = {
  kind: 'chapter';
  index: number;
  title: string;
  sourceRange?: SemanticNode['sourceRange'];
};

export type ManuscriptTocAst = {
  type: 'manuscript-toc';
  title?: string;
  entries: ManuscriptTocEntry[];
};

export type ManuscriptExpandingProbeGrowthEvent = {
  nodeKind: SemanticNode['kind'];
  delta: number;
  heightAfter: number;
  sourceRange?: SemanticNode['sourceRange'];
};

export type ManuscriptExpandingProbeAst = {
  type: 'manuscript-expanding-probe';
  enabled: boolean;
  label: string;
  region: {
    id: string;
    actorType: 'dependent-region';
    driver: 'chapter-count';
    chaptersObserved: number;
    growthEventCount: number;
  };
  footprint: {
    initialHeight: number;
    currentHeight: number;
    totalGrowth: number;
    marginBottom: number;
    borderWidth: number;
    paddingTop: number;
    paddingBottom: number;
    paddingLeft: number;
    paddingRight: number;
  };
  growthHistory: ManuscriptExpandingProbeGrowthEvent[];
};

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

function asNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
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
  private readonly experimentalConfig: Record<string, unknown>;
  private readonly expandingProbeConfig: Record<string, unknown>;
  private readonly staticProbeConfig: Record<string, unknown>;
  private readonly coverMode: 'first-page-cover' | 'separate-cover-page' | 'none';
  private readonly footnoteHeading: string;
  private readonly sceneBreakSymbol: string;
  private pendingBodyPageBreak = false;
  private nextParagraphIsFirst = false;
  private sawTitle = false;
  private documentTitle: string | undefined;
  private readonly tocEntries: ManuscriptTocEntry[] = [];
  private expandingProbeElement: Element | undefined;
  private expandingProbeHeight = 0;
  private expandingProbeLabel = 'EXPANDING PROBE REGION';
  private expandingProbeMarginBottom = 18;
  private expandingProbeBorderWidth = 1;
  private expandingProbePaddingTop = 8;
  private expandingProbePaddingBottom = 8;
  private expandingProbePaddingLeft = 10;
  private expandingProbePaddingRight = 10;
  private expandingProbeSourceId = 'probe:expanding-box';
  private expandingProbeChapterCount = 0;
  private expandingProbeTotalGrowth = 0;
  private readonly expandingProbeGrowthHistory: ManuscriptExpandingProbeGrowthEvent[] = [];
  private staticProbeInserted = false;

  constructor(private readonly config: Record<string, unknown>) {
    this.footnotes = asRecord(config.__footnotes) as Record<string, SemanticNode[]>;
    this.manuscriptConfig = asRecord(config.manuscript);
    this.coverConfig = asRecord(this.manuscriptConfig.coverPage);
    this.chapterConfig = asRecord(this.manuscriptConfig.chapter);
    this.sceneBreakConfig = asRecord(this.manuscriptConfig.sceneBreak);
    this.experimentalConfig = asRecord(this.manuscriptConfig.experimental);
    this.expandingProbeConfig = asRecord(this.experimentalConfig.expandingProbe);
    this.staticProbeConfig = asRecord(this.experimentalConfig.staticProbe);
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
        this.documentTitle = inlinePlainText(node.children || []).trim() || undefined;
        const consumed = this.handleTitleAndCover(node, buffer[i + 1], ctx);
        if (consumed) i += 1;
        continue;
      }

      if (node.kind === 'h2') {
        const insertedExpandingProbe = this.emitExpandingProbeIfNeeded(ctx, node);
        const insertedStaticProbe = this.emitStaticProbeIfNeeded(ctx, node);
        this.growExpandingProbeForNode(node);
        this.tocEntries.push({
          kind: 'chapter',
          index: this.tocEntries.length + 1,
          title: inlinePlainText(node.children || []).trim(),
          sourceRange: node.sourceRange
        });
        const style: Record<string, unknown> = {};
        if (asBool(this.chapterConfig.pageBreakBefore, true) && !insertedStaticProbe && !insertedExpandingProbe) {
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
        this.growExpandingProbeForNode(node);
        this.emitWithProperties(ctx, 'scene-break', this.resolveSceneBreakText(node), node);
        this.nextParagraphIsFirst = false;
        continue;
      }

      if (node.kind === 'hr') {
        this.growExpandingProbeForNode(node);
        this.emitWithProperties(ctx, 'scene-break', this.sceneBreakSymbol, node);
        this.nextParagraphIsFirst = true;
        continue;
      }

      if (node.kind === 'code') {
        this.growExpandingProbeForNode(node);
        this.handleCodeDisplay(node, ctx);
        this.nextParagraphIsFirst = false;
        continue;
      }

      if (node.kind === 'blockquote') {
        this.growExpandingProbeForNode(node);
        this.handleBlockquote(node, ctx);
        this.nextParagraphIsFirst = false;
        continue;
      }

      if (node.kind === 'p') {
        this.growExpandingProbeForNode(node);
        const role = this.nextParagraphIsFirst ? 'paragraph-first' : 'paragraph';
        this.emitWithProperties(ctx, role, collapseTextSoftBreaks(node.children || []), node);
        this.nextParagraphIsFirst = false;
        continue;
      }

      if (node.kind === 'ul' || node.kind === 'ol') {
        this.growExpandingProbeForNode(node);
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

  getTocAst(): ManuscriptTocAst {
    return {
      type: 'manuscript-toc',
      ...(this.documentTitle ? { title: this.documentTitle } : {}),
      entries: this.tocEntries.slice()
    };
  }

  getExpandingProbeAst(): ManuscriptExpandingProbeAst {
    return {
      type: 'manuscript-expanding-probe',
      enabled: !!this.expandingProbeElement,
      label: this.expandingProbeLabel,
      region: {
        id: this.expandingProbeSourceId,
        actorType: 'dependent-region',
        driver: 'chapter-count',
        chaptersObserved: this.expandingProbeChapterCount,
        growthEventCount: this.expandingProbeGrowthHistory.length
      },
      footprint: {
        initialHeight: asNumber(this.expandingProbeConfig.initialHeight, 72),
        currentHeight: this.expandingProbeHeight,
        totalGrowth: this.expandingProbeTotalGrowth,
        marginBottom: this.expandingProbeMarginBottom,
        borderWidth: this.expandingProbeBorderWidth,
        paddingTop: this.expandingProbePaddingTop,
        paddingBottom: this.expandingProbePaddingBottom,
        paddingLeft: this.expandingProbePaddingLeft,
        paddingRight: this.expandingProbePaddingRight
      },
      growthHistory: this.expandingProbeGrowthHistory.slice()
    };
  }

  private emitExpandingProbe(ctx: FormatContext): void {
    if (!asBool(this.expandingProbeConfig.enabled, false)) return;

    this.expandingProbeHeight = Math.max(0, asNumber(this.expandingProbeConfig.initialHeight, 72));
    this.expandingProbeLabel = asString(this.expandingProbeConfig.label, 'EXPANDING PROBE REGION');
    this.expandingProbeMarginBottom = asNumber(this.expandingProbeConfig.marginBottom, 18);
    this.expandingProbeBorderWidth = asNumber(this.expandingProbeConfig.borderWidth, 1);
    this.expandingProbePaddingTop = asNumber(this.expandingProbeConfig.paddingTop, 8);
    this.expandingProbePaddingBottom = asNumber(this.expandingProbeConfig.paddingBottom, 8);
    this.expandingProbePaddingLeft = asNumber(this.expandingProbeConfig.paddingLeft, 10);
    this.expandingProbePaddingRight = asNumber(this.expandingProbeConfig.paddingRight, 10);
    this.expandingProbeSourceId = asString(this.expandingProbeConfig.sourceId, 'probe:expanding-box');
    this.expandingProbeChapterCount = 0;
    this.expandingProbeTotalGrowth = 0;
    this.expandingProbeGrowthHistory.length = 0;
    const style: Record<string, unknown> = {
      height: this.expandingProbeHeight,
      marginBottom: this.expandingProbeMarginBottom,
      backgroundColor: asString(this.expandingProbeConfig.backgroundColor, '#fef3c7'),
      borderWidth: this.expandingProbeBorderWidth,
      borderColor: asString(this.expandingProbeConfig.borderColor, '#d97706'),
      paddingTop: this.expandingProbePaddingTop,
      paddingBottom: this.expandingProbePaddingBottom,
      paddingLeft: this.expandingProbePaddingLeft,
      paddingRight: this.expandingProbePaddingRight
    };

    this.expandingProbeElement = {
      type: 'expanding-probe-region',
      content: this.expandingProbeLabel,
      properties: {
        sourceId: this.expandingProbeSourceId,
        style,
        _expandingProbe: {
          enabled: true,
          initialHeight: this.expandingProbeHeight
        }
      }
    };
    this.syncExpandingProbeMetadata();
    ctx.emitRaw(this.expandingProbeElement);
  }

  private emitExpandingProbeIfNeeded(ctx: FormatContext, node: SemanticNode): boolean {
    if (this.expandingProbeElement || !asBool(this.expandingProbeConfig.enabled, false)) return false;

    this.emitExpandingProbe(ctx);
    const element = this.expandingProbeElement as Element | undefined;
    if (!element) return false;

    const props = element.properties || {};
    const style = ((props.style as Record<string, unknown>) || {});
    if (this.pendingBodyPageBreak) {
      style.pageBreakBefore = true;
      this.pendingBodyPageBreak = false;
    }
    props.style = style;
    props.sourceId = this.expandingProbeSourceId;
    props.sourceRange = node.sourceRange;
    props.sourceSyntax = node.sourceSyntax;
    element.properties = props;
    this.syncExpandingProbeMetadata();
    return true;
  }

  private emitStaticProbeIfNeeded(ctx: FormatContext, node: SemanticNode): boolean {
    if (this.staticProbeInserted || !asBool(this.staticProbeConfig.enabled, false)) return false;

    this.staticProbeInserted = true;
    const style: Record<string, unknown> = {
      textIndent: 0,
      textAlign: 'center',
      fontWeight: 700,
      height: Math.max(0, asNumber(this.staticProbeConfig.height, 144)),
      marginTop: Math.max(0, asNumber(this.staticProbeConfig.marginTop, 0)),
      marginBottom: Math.max(0, asNumber(this.staticProbeConfig.marginBottom, 24)),
      backgroundColor: asString(this.staticProbeConfig.backgroundColor, '#f59e0b'),
      borderWidth: Math.max(0, asNumber(this.staticProbeConfig.borderWidth, 2)),
      borderColor: asString(this.staticProbeConfig.borderColor, '#9a3412'),
      paddingTop: Math.max(0, asNumber(this.staticProbeConfig.paddingTop, 12)),
      paddingBottom: Math.max(0, asNumber(this.staticProbeConfig.paddingBottom, 12)),
      paddingLeft: Math.max(0, asNumber(this.staticProbeConfig.paddingLeft, 12)),
      paddingRight: Math.max(0, asNumber(this.staticProbeConfig.paddingRight, 12))
    };
    if (this.pendingBodyPageBreak) {
      style.pageBreakBefore = true;
      this.pendingBodyPageBreak = false;
    }
    ctx.emitRaw({
      type: 'paragraph',
      content: asString(this.staticProbeConfig.label, 'STATIC PROBE BOX'),
      properties: {
        sourceRange: node.sourceRange,
        sourceSyntax: node.sourceSyntax,
        sourceId: asString(this.staticProbeConfig.sourceId, 'probe:static-box'),
        style,
        _staticProbe: {
          enabled: true
        }
      }
    });
    return true;
  }

  private growExpandingProbeForNode(node: SemanticNode): void {
    if (!this.expandingProbeElement) return;

    if (node.kind === 'h2') {
      this.expandingProbeChapterCount += 1;
    }

    let delta = asNumber(this.expandingProbeConfig.growthPerBlock, 0);
    if (node.kind === 'h2') delta += asNumber(this.expandingProbeConfig.growthPerChapter, 12);
    if (node.kind === 'h2') {
      const percent = asNumber(this.expandingProbeConfig.growthPercentPerChapter, 0);
      if (percent > 0) {
        delta += this.expandingProbeHeight * percent;
      }
    }
    if (node.kind === 'p') delta += asNumber(this.expandingProbeConfig.growthPerParagraph, 0);
    if (node.kind === 'blockquote' || node.kind === 'code') {
      delta += asNumber(this.expandingProbeConfig.growthPerDisplayBlock, 0);
    }

    if (!Number.isFinite(delta) || delta <= 0) return;

    this.expandingProbeHeight += delta;
    this.expandingProbeTotalGrowth += delta;
    const props = this.expandingProbeElement.properties || {};
    const style = (props.style as Record<string, unknown>) || {};
    style.height = this.expandingProbeHeight;
    props.style = style;
    this.expandingProbeElement.properties = props;
    this.expandingProbeGrowthHistory.push({
      nodeKind: node.kind,
      delta,
      heightAfter: this.expandingProbeHeight,
      sourceRange: node.sourceRange
    });
    this.syncExpandingProbeMetadata();
  }

  private syncExpandingProbeMetadata(): void {
    if (!this.expandingProbeElement) return;

    const props = this.expandingProbeElement.properties || {};
    props.sourceId = this.expandingProbeSourceId;
    props._expandingProbe = {
      ...((props._expandingProbe as Record<string, unknown>) || {}),
      enabled: true,
      sourceId: this.expandingProbeSourceId,
      driver: 'chapter-count',
      chaptersObserved: this.expandingProbeChapterCount,
      growthEventCount: this.expandingProbeGrowthHistory.length,
      heightSnapshots: this.expandingProbeGrowthHistory.map((entry) => entry.heightAfter),
      initialHeight: asNumber(this.expandingProbeConfig.initialHeight, 72),
      currentHeight: this.expandingProbeHeight,
      totalGrowth: this.expandingProbeTotalGrowth
    };
    props._regionActor = {
      id: this.expandingProbeSourceId,
      actorType: 'dependent-region',
      driver: 'chapter-count',
      chaptersObserved: this.expandingProbeChapterCount,
      growthEventCount: this.expandingProbeGrowthHistory.length,
      currentHeight: this.expandingProbeHeight
    };
    this.expandingProbeElement.properties = props;
  }
}
