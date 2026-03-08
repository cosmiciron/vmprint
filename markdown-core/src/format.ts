import type { SemanticNode } from './semantic';
import type { FormatContext } from './context';
import { inlinePlainText } from './inline';

// ─── Rule types ───────────────────────────────────────────────────────────────

type MatchCondition = {
  kind?: string | string[];
  content?: RegExp;
  previousKind?: string | string[];
  depth?: number | { min?: number; max?: number };
  hasImage?: boolean;
};

type RuleAction = {
  role?: string;
  properties?: Record<string, unknown>;
  processor?: string;
};

type FormatRule = {
  name?: string;
  match: MatchCondition;
  action: RuleAction;
};

type HandlerState = {
  previousNode: SemanticNode | null;
  depth: number;
  buffer: SemanticNode[];
  bufferIndex: number;
};

type BlockProcessor = {
  handle(node: SemanticNode, ctx: FormatContext, rule: FormatRule, state: HandlerState, handler: MarkdownFormatHandler): boolean;
};

// ─── Processors ───────────────────────────────────────────────────────────────

const SubheadingProcessor: BlockProcessor = {
  handle(node, ctx, _rule, _state, _handler) {
    const children = node.children || [];
    const first = children[0];
    let stripped: SemanticNode[];
    if (first?.kind === 'text' && first.value?.startsWith('::')) {
      stripped = [{ ...first, value: first.value.slice(2).trimStart() }, ...children.slice(1)];
    } else {
      stripped = children;
    }
    ctx.emit('subheading', stripped, { sourceRange: node.sourceRange, sourceSyntax: node.sourceSyntax, keepWithNext: true });
    return true;
  }
};

const BlockquoteProcessor: BlockProcessor = {
  handle(node, ctx, rule, _state, handler) {
    const role = rule.action.role || 'blockquote';
    for (const child of node.children || []) {
      if (child.kind === 'p') {
        ctx.emit(role, child.children || [], { sourceRange: child.sourceRange, sourceSyntax: child.sourceSyntax });
      } else {
        handler.dispatch(child, ctx);
      }
    }
    return true;
  }
};

const ListProcessor: BlockProcessor = {
  handle(node, ctx, _rule, _state, handler) {
    const isOrdered = node.kind === 'ol';
    const items = (node.children || []).filter((n) => n.kind === 'li');
    const listCfg = (ctx.config.list as Record<string, unknown>) || {};
    const taskMarkers = (listCfg.taskMarkers as Record<string, string>) || {};

    items.forEach((item, index) => {
      let marker: string;
      if (isOrdered) {
        const roman = ['I.', 'II.', 'III.', 'IV.', 'V.'];
        marker = (roman[index] || `${index + 1}.`) + '  ';
      } else {
        const checked = taskMarkers.checked || '☑';
        const unchecked = taskMarkers.unchecked || '☐';
        if (item.checked === true) marker = `${checked}  `;
        else if (item.checked === false) marker = `${unchecked}  `;
        else marker = '• ';
      }

      const children = item.children || [];
      if (children.length > 0 && children[0].kind === 'p') {
        const first = children[0];
        const role = isOrdered ? 'list-item-ordered-0' : 'list-item-unordered-0';
        ctx.emit(role, [{ kind: 'text', value: marker } as SemanticNode, ...(first.children || [])], {
          sourceRange: item.sourceRange, sourceSyntax: item.sourceSyntax
        });
        for (let i = 1; i < children.length; i++) {
          const child = children[i];
          if (child.kind === 'p') {
            const indent = typeof listCfg.textIndentPerLevel === 'number' ? listCfg.textIndentPerLevel : 17.5;
            ctx.emit('list-item-continuation-1', child.children || [], {
              sourceRange: child.sourceRange, sourceSyntax: child.sourceSyntax, style: { textIndent: indent }
            });
          } else {
            handler.dispatch(child, ctx);
          }
        }
      }
    });
    return true;
  }
};

const CodeBlockProcessor: BlockProcessor = {
  handle(node, ctx, rule, _state, _handler) {
    const codeBlocksCfg = (ctx.config.codeBlocks as Record<string, unknown>) || {};
    const modes = (codeBlocksCfg.modes as Record<string, unknown>) || {};
    const lang = (node.language || '').trim().toLowerCase();
    const modeCfg = (lang ? modes[lang] : undefined) as Record<string, unknown> | undefined;
    const modeStyle = modeCfg?.style || modeCfg;
    ctx.emit(rule.action.role || 'code-block', node.value || '', {
      sourceRange: node.sourceRange, sourceSyntax: node.sourceSyntax, language: node.language,
      ...(modeStyle && typeof modeStyle === 'object' && Object.keys(modeStyle).length > 0 ? { style: modeStyle } : {})
    });
    return true;
  }
};

const TableProcessor: BlockProcessor = {
  handle(node, ctx, _rule, _state, _handler) {
    ctx.emitTable(node);
    return true;
  }
};

const ImageProcessor: BlockProcessor = {
  handle(node, ctx, _rule, state, _handler) {
    const imageNode = node.kind === 'image' ? node : (node.children?.find((n) => n.kind === 'image'));
    if (!imageNode) return false;

    const imgCfg = (ctx.config.images as Record<string, unknown>) || {};
    const blockStyle = (imgCfg.blockStyle as Record<string, unknown>) || {};
    const frameCfg = (imgCfg.frame as Record<string, unknown>) || {};
    const markerPattern = (frameCfg.markerPattern as string) || '\\b(frame|framed)\\b';
    const alt = (imageNode.alt || '').toLowerCase();
    const val = (imageNode.value || '').toLowerCase();
    const hasFrame = new RegExp(markerPattern, 'i').test(alt) || new RegExp(markerPattern, 'i').test(val);
    const shouldFrame = frameCfg.mode === 'all' || (hasFrame && frameCfg.mode !== 'off');
    const frameStyle = shouldFrame ? ((frameCfg.style as Record<string, unknown>) || {}) : {};

    // Look-ahead for caption
    let keepWithNext = false;
    let captionBq: SemanticNode | null = null;
    const buf = state.buffer;
    const idx = state.bufferIndex;
    if (buf && idx < buf.length - 1) {
      const next = buf[idx + 1];
      const captionCfg = (ctx.config.captions as Record<string, unknown>) || {};
      if (next.kind === 'p') {
        const nextText = inlinePlainText(next.children || []);
        const pat = (captionCfg.pattern as string) || '^(Figure|Fig\\.)\\s+';
        if (new RegExp(pat).test(nextText)) keepWithNext = true;
      } else if (next.kind === 'blockquote' && captionCfg.blockquoteUnderImageAsFigureCaption) {
        keepWithNext = true;
        captionBq = next;
      }
    }

    ctx.emitImage(imageNode, {
      sourceRange: node.sourceRange, sourceSyntax: node.sourceSyntax,
      style: { ...blockStyle, ...frameStyle }, keepWithNext
    });

    if (captionBq) {
      const captionCfg = (ctx.config.captions as Record<string, unknown>) || {};
      const captionStyle = (captionCfg.blockquoteStyle as Record<string, unknown>) || {};
      for (const child of captionBq.children || []) {
        if (child.kind === 'p') ctx.emit('paragraph', child.children || [], { sourceRange: child.sourceRange, sourceSyntax: child.sourceSyntax, style: captionStyle });
      }
      state.bufferIndex++;
    }
    return true;
  }
};

const DefinitionListProcessor: BlockProcessor = {
  handle(node, ctx, _rule, _state, handler) {
    for (const child of node.children || []) handler.dispatch(child, ctx);
    return true;
  }
};

// ─── Rules ────────────────────────────────────────────────────────────────────

const RULES: FormatRule[] = [
  { match: { kind: 'h1' }, action: { role: 'heading-1' } },
  { match: { kind: 'h2' }, action: { role: 'heading-2' } },
  { match: { kind: 'h3' }, action: { role: 'heading-3' } },
  { match: { kind: 'h4' }, action: { role: 'heading-4' } },
  { match: { kind: 'h5' }, action: { role: 'heading-5' } },
  { match: { kind: 'h6' }, action: { role: 'heading-6' } },
  { name: 'subheading', match: { kind: 'p', previousKind: 'h1', depth: 0, content: /::/ }, action: { processor: 'subheading' } },
  { match: { kind: ['ul', 'ol'] }, action: { processor: 'list' } },
  { match: { kind: 'dl' }, action: { processor: 'dl' } },
  { match: { kind: 'blockquote' }, action: { processor: 'blockquote', role: 'blockquote' } },
  { match: { kind: 'code' }, action: { processor: 'code', role: 'code-block' } },
  { match: { kind: 'table' }, action: { processor: 'table' } },
  { name: 'image-paragraph', match: { kind: 'p', hasImage: true }, action: { processor: 'image' } },
  { name: 'lead-in-paragraph', match: { kind: 'p', content: /:$/ }, action: { role: 'paragraph', properties: { keepWithNext: true } } },
  { match: { kind: 'p' }, action: { role: 'paragraph' } },
  { match: { kind: 'dt' }, action: { role: 'definition-term' } },
  { match: { kind: 'dd' }, action: { role: 'definition-desc' } },
  { match: { kind: 'hr' }, action: { role: 'thematic-break' } }
];

const PROCESSORS: Record<string, BlockProcessor> = {
  subheading: SubheadingProcessor,
  list: ListProcessor,
  dl: DefinitionListProcessor,
  blockquote: BlockquoteProcessor,
  code: CodeBlockProcessor,
  table: TableProcessor,
  image: ImageProcessor
};

// ─── Handler ──────────────────────────────────────────────────────────────────

export class MarkdownFormatHandler {
  private readonly buffer: SemanticNode[] = [];
  private state: HandlerState = { previousNode: null, depth: 0, buffer: [], bufferIndex: 0 };

  handleBlock(node: SemanticNode): void {
    this.buffer.push(node);
  }

  flush(ctx: FormatContext): void {
    this.state.buffer = this.buffer;
    for (let i = 0; i < this.buffer.length; i++) {
      this.state.bufferIndex = i;
      this.processSingle(this.buffer[i], ctx);
      i = this.state.bufferIndex;
    }
    this.emitReferences(ctx);
    this.emitFootnotes(ctx);
  }

  dispatch(node: SemanticNode, ctx: FormatContext): boolean {
    const prevDepth = this.state.depth;
    for (const rule of RULES) {
      if (this.matches(node, rule.match)) {
        if (rule.action.processor) {
          const proc = PROCESSORS[rule.action.processor];
          if (proc) {
            this.state.depth++;
            const handled = proc.handle(node, ctx, rule, this.state, this);
            this.state.depth = prevDepth;
            if (handled) return true;
          }
          continue;
        }
        if (rule.action.role) {
          ctx.emit(rule.action.role, node.children || [], {
            sourceRange: node.sourceRange, sourceSyntax: node.sourceSyntax, ...(rule.action.properties || {})
          });
          return true;
        }
      }
    }
    return false;
  }

  private processSingle(node: SemanticNode, ctx: FormatContext): void {
    this.dispatch(node, ctx);
    this.state.previousNode = node;
  }

  private matches(node: SemanticNode, match: MatchCondition): boolean {
    if (match.kind) {
      const kinds = Array.isArray(match.kind) ? match.kind : [match.kind];
      if (!kinds.includes(node.kind)) return false;
    }
    if (match.previousKind) {
      if (!this.state.previousNode) return false;
      const pk = Array.isArray(match.previousKind) ? match.previousKind : [match.previousKind];
      if (!pk.includes(this.state.previousNode.kind)) return false;
    }
    if (match.content) {
      if (!match.content.test(inlinePlainText(node.children || []))) return false;
    }
    if (match.depth !== undefined) {
      if (typeof match.depth === 'number') {
        if (this.state.depth !== match.depth) return false;
      } else {
        if (match.depth.min !== undefined && this.state.depth < match.depth.min) return false;
        if (match.depth.max !== undefined && this.state.depth > match.depth.max) return false;
      }
    }
    if (match.hasImage !== undefined) {
      const has = (node.children || []).some((c) => c.kind === 'image');
      if (has !== match.hasImage) return false;
    }
    return true;
  }

  private emitReferences(ctx: FormatContext): void {
    if (ctx.registeredLinkCount() === 0) return;
    const refCfg = (ctx.config.references as Record<string, unknown>) || {};
    const heading = (refCfg.heading as string) || 'References';
    const numStyle = (refCfg.numberingStyle as string) || 'decimal';
    ctx.emit('thematic-break', '');
    ctx.emit('references-heading', heading);
    for (const entry of ctx.registeredLinks()) {
      ctx.emitReferenceItem(`${ctx.formatNumber(entry.index, numStyle as Parameters<FormatContext['formatNumber']>[1])}. `, entry.url, entry.title);
    }
  }

  private emitFootnotes(ctx: FormatContext): void {
    if (ctx.registeredFootnoteCount() === 0) return;
    const footnoteCfg = (ctx.config.footnotes as Record<string, unknown>) || {};
    const fnHeading = (footnoteCfg.heading as string) || 'Footnotes';
    const storedFootnotes = (ctx.config.__footnotes as Record<string, unknown>) || {};
    ctx.emit('thematic-break', '');
    ctx.emit('footnotes-heading', fnHeading);
    for (const entry of ctx.registeredFootnotes()) {
      const fallback = [{ kind: 'text', value: `[missing footnote: ${entry.identifier}]` } as SemanticNode];
      const content = (entry.content as SemanticNode[] | undefined)
        || (storedFootnotes[entry.identifier] as SemanticNode[] | undefined)
        || fallback;
      ctx.emit('footnotes-item', [{ kind: 'text', value: `${entry.index}. ` } as SemanticNode, ...content]);
    }
  }
}
