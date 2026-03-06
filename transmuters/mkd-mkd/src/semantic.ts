import type { MdNode } from './parse';
import { KEEP_WITH_NEXT_PATTERN } from './parse';

export type SourceRange = {
  lineStart: number;
  colStart: number;
  lineEnd: number;
  colEnd: number;
};

export type SemanticNodeKind =
  | 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6'
  | 'p'
  | 'ul' | 'ol' | 'li'
  | 'dl' | 'dt' | 'dd'
  | 'code'
  | 'blockquote'
  | 'hr'
  | 'table' | 'tableRow' | 'tableCell'
  | 'text' | 'em' | 'strong' | 'del' | 'inlineCode' | 'link' | 'image' | 'footnoteRef';

export type SemanticNode = {
  kind: SemanticNodeKind;
  children?: SemanticNode[];
  value?: string;
  src?: string;
  alt?: string;
  url?: string;
  title?: string;
  identifier?: string;
  referenceType?: string;
  start?: number;
  spread?: boolean;
  checked?: boolean | null;
  listTight?: boolean;
  language?: string;
  align?: Array<'left' | 'right' | 'center' | null>;
  keepWithNext?: boolean;
  sourceRange?: SourceRange;
  sourceSyntax?: string;
};

export type SemanticDocument = {
  type: 'Document';
  children: SemanticNode[];
  footnotes?: Record<string, SemanticNode[]>;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function toSource(node: MdNode, syntax?: string): { sourceRange?: SourceRange; sourceSyntax?: string } {
  const s = node.position?.start;
  const e = node.position?.end;
  return {
    sourceRange: s && e ? { lineStart: s.line, colStart: s.column, lineEnd: e.line, colEnd: e.column } : undefined,
    sourceSyntax: syntax
  };
}

type DefinitionMap = Map<string, { url: string; title?: string }>;

function normalizeId(v?: string): string {
  return (v || '').trim().toLowerCase();
}

function collectDefinitions(nodes: MdNode[]): DefinitionMap {
  const map: DefinitionMap = new Map();
  for (const node of nodes) {
    if (node.type === 'definition' && node.identifier && node.url) {
      map.set(normalizeId(node.identifier), { url: node.url, title: node.title });
    }
  }
  return map;
}

function flattenText(nodes: SemanticNode[]): string {
  let out = '';
  for (const n of nodes) {
    if (n.kind === 'text' || n.kind === 'inlineCode') out += n.value || '';
    else if (n.children) out += flattenText(n.children);
  }
  return out;
}

function collectFootnotes(nodes: MdNode[], defs: DefinitionMap): Record<string, SemanticNode[]> {
  const out: Record<string, SemanticNode[]> = {};
  for (const node of nodes) {
    if (node.type !== 'footnoteDefinition') continue;
    const id = normalizeId(node.identifier || node.label);
    if (!id) continue;
    const blocks = mapBlocks(node.children || [], defs);
    const inlines: SemanticNode[] = [];
    blocks.forEach((block, i) => {
      if (block.kind === 'p') inlines.push(...(block.children || []));
      else if (block.kind === 'code') inlines.push({ kind: 'text', value: block.value || '' });
      else inlines.push({ kind: 'text', value: flattenText(block.children || []) });
      if (i < blocks.length - 1) inlines.push({ kind: 'text', value: '\n\n' });
    });
    out[id] = inlines;
  }
  return out;
}

// ─── Inline mapping ──────────────────────────────────────────────────────────

function mapInline(node: MdNode, defs: DefinitionMap): SemanticNode[] {
  switch (node.type) {
    case 'text':
      return [{ kind: 'text', value: node.value || '', ...toSource(node, 'text') }];
    case 'emphasis':
      return [{ kind: 'em', children: mapInlines(node.children || [], defs), ...toSource(node, 'emphasis') }];
    case 'strong':
      return [{ kind: 'strong', children: mapInlines(node.children || [], defs), ...toSource(node, 'strong') }];
    case 'delete':
      return [{ kind: 'del', children: mapInlines(node.children || [], defs), ...toSource(node, 'delete') }];
    case 'inlineCode':
      return [{ kind: 'inlineCode', value: node.value || '', ...toSource(node, 'inlineCode') }];
    case 'link':
      return [{ kind: 'link', url: node.url || '', title: node.title, children: mapInlines(node.children || [], defs), ...toSource(node, 'link') }];
    case 'linkReference': {
      const def = defs.get(normalizeId(node.identifier));
      if (!def) throw new Error(`Missing link definition: ${node.identifier || '(unknown)'}`);
      return [{ kind: 'link', url: def.url, title: def.title, identifier: node.identifier, referenceType: node.referenceType, children: mapInlines(node.children || [], defs), ...toSource(node, 'linkReference') }];
    }
    case 'footnoteReference':
      return [{ kind: 'footnoteRef', identifier: node.identifier || node.label || '', value: node.identifier || node.label || '', ...toSource(node, 'footnoteReference') }];
    case 'image':
      return [{ kind: 'image', src: node.url || '', alt: node.alt || '', title: node.title, ...toSource(node, 'image') }];
    case 'imageReference': {
      const def = defs.get(normalizeId(node.identifier));
      if (!def) throw new Error(`Missing image definition: ${node.identifier || '(unknown)'}`);
      return [{ kind: 'image', src: def.url, alt: node.alt || '', title: node.title || def.title, identifier: node.identifier, referenceType: node.referenceType, ...toSource(node, 'imageReference') }];
    }
    case 'break':
      return [{ kind: 'text', value: '\n', ...toSource(node, 'break') }];
    default:
      return [];
  }
}

function mapInlines(nodes: MdNode[], defs: DefinitionMap): SemanticNode[] {
  return nodes.flatMap((n) => mapInline(n, defs));
}

// ─── Block mapping ───────────────────────────────────────────────────────────

function flattenMdText(nodes: MdNode[]): string {
  let v = '';
  for (const n of nodes) {
    if (n.type === 'text' || n.type === 'inlineCode') v += n.value || '';
    else if (n.type === 'break') v += '\n';
    else if (n.children) v += flattenMdText(n.children);
  }
  return v;
}

function tryDefinitionList(node: MdNode): SemanticNode | null {
  if (node.type !== 'paragraph') return null;
  const raw = flattenMdText(node.children || []);
  const match = raw.match(/^([^\n]+)\n:\s+([\s\S]+)$/);
  if (!match) return null;
  const term = match[1].trim();
  const desc = match[2].trim();
  if (!term || !desc) return null;
  return {
    kind: 'dl',
    children: [
      { kind: 'dt', children: [{ kind: 'text', value: term }] },
      { kind: 'dd', children: [{ kind: 'text', value: desc }] }
    ],
    ...toSource(node, 'definitionListFallback')
  };
}

function mapBlock(node: MdNode, defs: DefinitionMap): SemanticNode[] {
  switch (node.type) {
    case 'heading': {
      const level = Math.min(6, Math.max(1, node.depth || 1));
      return [{ kind: `h${level}` as SemanticNodeKind, children: mapInlines(node.children || [], defs), ...toSource(node, `h${level}`) }];
    }
    case 'paragraph': {
      const dl = tryDefinitionList(node);
      if (dl) return [dl];
      return [{ kind: 'p', children: mapInlines(node.children || [], defs), ...toSource(node, 'paragraph') }];
    }
    case 'list':
      return [{
        kind: node.ordered ? 'ol' : 'ul',
        children: (node.children || []).map((item) => ({
          kind: 'li' as SemanticNodeKind,
          children: mapBlocks(item.children || [], defs),
          checked: item.checked,
          spread: item.spread,
          ...toSource(item, 'listItem')
        })),
        start: node.ordered ? node.start || 1 : undefined,
        spread: node.spread,
        listTight: node.spread === false,
        ...toSource(node, node.ordered ? 'orderedList' : 'unorderedList')
      }];
    case 'code':
      return [{ kind: 'code', value: node.value || '', language: node.lang || undefined, ...toSource(node, 'codeFence') }];
    case 'blockquote':
      return [{ kind: 'blockquote', children: mapBlocks(node.children || [], defs), ...toSource(node, 'blockquote') }];
    case 'thematicBreak':
      return [{ kind: 'hr', ...toSource(node, 'thematicBreak') }];
    case 'table': {
      const align = Array.isArray(node.align)
        ? node.align.map((v) => (v === 'left' || v === 'right' || v === 'center' ? v : null))
        : undefined;
      return [{
        kind: 'table',
        align,
        children: (node.children || []).map((row) => ({
          kind: 'tableRow' as SemanticNodeKind,
          children: (row.children || []).map((cell) => ({
            kind: 'tableCell' as SemanticNodeKind,
            children: mapInlines(cell.children || [], defs),
            ...toSource(cell, 'tableCell')
          })),
          ...toSource(row, 'tableRow')
        })),
        ...toSource(node, 'table')
      }];
    }
    case 'definition':
    case 'footnoteDefinition':
      return [];
    default:
      return [];
  }
}

function mapBlocks(nodes: MdNode[], defs: DefinitionMap): SemanticNode[] {
  const out: SemanticNode[] = [];
  let pendingKeepWithNext = false;
  for (const node of nodes) {
    if (node.type === 'html') {
      if (KEEP_WITH_NEXT_PATTERN.test(node.value || '')) pendingKeepWithNext = true;
      continue;
    }
    const mapped = mapBlock(node, defs);
    if (pendingKeepWithNext && mapped.length > 0) {
      mapped[0] = { ...mapped[0], keepWithNext: true };
      pendingKeepWithNext = false;
    }
    out.push(...mapped);
  }
  return out;
}

export function normalizeToSemantic(ast: MdNode): SemanticDocument {
  const defs = collectDefinitions(ast.children || []);
  const footnotes = collectFootnotes(ast.children || [], defs);
  return {
    type: 'Document',
    children: mapBlocks(ast.children || [], defs),
    footnotes
  };
}
