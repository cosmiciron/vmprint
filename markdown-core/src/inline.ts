import type { Element, ElementStyle, ResolvedImage } from './types';
import type { SemanticNode } from './semantic';

// ─── Smart quotes / dashes ────────────────────────────────────────────────────

export function applySmartQuotes(text: string): string {
  let s = text.replace(/---/g, '\u2014').replace(/--/g, '\u2014');
  const chars = Array.from(s);
  const out: string[] = [];
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (ch === '"') {
      const prev = i > 0 ? chars[i - 1] : ' ';
      out.push(/[\s([{\u2014\u2013]/.test(prev) ? '\u201C' : '\u201D');
    } else if (ch === "'") {
      const prev = i > 0 ? chars[i - 1] : ' ';
      out.push(/[\s([{]/.test(prev) ? '\u2018' : '\u2019');
    } else {
      out.push(ch);
    }
  }
  return out.join('');
}

// ─── Context ─────────────────────────────────────────────────────────────────

export type InlineLinkMode = 'citation' | 'inline' | 'strip';

export type InlineContext = {
  linkMode: InlineLinkMode;
  citationStyle: 'bracket' | 'paren';
  linkMarkerFormat?: 'bracket' | 'paren' | 'superscript';
  footnoteStyle?: 'bracket' | 'superscript' | 'plain';
  dedupe: boolean;
  smartQuotes?: boolean;
  inlineCodeStyle?: Record<string, unknown>;
  linkStyle?: Record<string, unknown>;
  citationMarkerStyle?: Record<string, unknown>;
  footnoteMarkerStyle?: Record<string, unknown>;
  inlineImageStyle?: Record<string, unknown>;
  registerLink(url: string, title?: string): number;
  registerFootnote(identifier: string, content?: SemanticNode[]): number;
  resolveImage(node: SemanticNode): ResolvedImage | null;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function citationMarker(index: number, style: 'bracket' | 'paren'): string {
  return style === 'paren' ? `(${index})` : `[${index}]`;
}

// ─── Core conversion ─────────────────────────────────────────────────────────

export function inlineToElements(nodes: SemanticNode[], ctx: InlineContext): Element[] {
  const result: Element[] = [];

  for (const node of nodes) {
    switch (node.kind) {
      case 'text': {
        const raw = node.value || '';
        result.push({ type: 'text', content: ctx.smartQuotes ? applySmartQuotes(raw) : raw });
        break;
      }

      case 'inlineCode':
        result.push({
          type: 'text',
          content: node.value || '',
          properties: ctx.inlineCodeStyle ? { style: { ...ctx.inlineCodeStyle } } : undefined
        });
        break;

      case 'em':
        result.push({ type: 'inline', content: '', properties: { style: { fontStyle: 'italic' } }, children: inlineToElements(node.children || [], ctx) });
        break;

      case 'strong':
        result.push({ type: 'inline', content: '', properties: { style: { fontWeight: 700 } }, children: inlineToElements(node.children || [], ctx) });
        break;

      case 'del':
        result.push({ type: 'inline', content: '', properties: { style: { textDecoration: 'line-through' } }, children: inlineToElements(node.children || [], ctx) });
        break;

      case 'link': {
        if (ctx.linkMode === 'strip') {
          result.push(...inlineToElements(node.children || [], ctx));
          break;
        }
        if (ctx.linkMode === 'inline') {
          result.push({ type: 'inline', content: '', properties: { style: ctx.linkStyle ? { ...ctx.linkStyle } : undefined, linkTarget: (node.url || '').trim() }, children: inlineToElements(node.children || [], ctx) });
          break;
        }
        // citation mode
        result.push(...inlineToElements(node.children || [], ctx));
        const ci = ctx.registerLink(node.url || '', node.title);
        if (ci > 0) {
          const fmt = ctx.linkMarkerFormat ?? 'bracket';
          const markerText = fmt === 'superscript' ? String(ci) : citationMarker(ci, fmt === 'paren' ? 'paren' : 'bracket');
          const baseStyle: Record<string, unknown> = fmt === 'superscript' ? { fontSize: 8.5, baselineShift: 3 } : {};
          result.push({
            type: 'text',
            content: markerText,
            properties: ctx.citationMarkerStyle
              ? { style: { ...baseStyle, ...ctx.citationMarkerStyle } }
              : Object.keys(baseStyle).length > 0 ? { style: baseStyle } : undefined
          });
        }
        break;
      }

      case 'image': {
        const resolved = ctx.resolveImage(node);
        if (resolved) {
          result.push({
            type: 'image',
            content: '',
            properties: {
              style: ctx.inlineImageStyle ? { ...ctx.inlineImageStyle } : undefined,
              image: { data: resolved.data, mimeType: resolved.mimeType, fit: 'contain' },
              sourceRange: node.sourceRange,
              sourceSyntax: node.sourceSyntax
            }
          });
        }
        break;
      }

      case 'footnoteRef': {
        const fi = ctx.registerFootnote(node.identifier || node.value || '', undefined);
        if (fi > 0) {
          const ms = ctx.footnoteStyle || 'bracket';
          const markerText = ms === 'superscript' || ms === 'plain'
            ? String(fi)
            : citationMarker(fi, ctx.citationStyle);
          result.push({
            type: 'text',
            content: markerText,
            properties: {
              style: { fontSize: 8.5, baselineShift: 3, ...(ctx.footnoteMarkerStyle || {}) }
            }
          });
        }
        break;
      }

      default:
        break;
    }
  }

  return result;
}

// ─── Plain-text extraction ────────────────────────────────────────────────────

export function inlinePlainText(nodes: SemanticNode[]): string {
  let out = '';
  for (const node of nodes) {
    switch (node.kind) {
      case 'text':
      case 'inlineCode':
        out += node.value || '';
        break;
      case 'em':
      case 'strong':
      case 'del':
      case 'link':
        out += inlinePlainText(node.children || []);
        break;
      case 'image':
        out += node.alt || '';
        break;
      default:
        break;
    }
  }
  return out;
}

export function collapseTextSoftBreaks(children: SemanticNode[]): SemanticNode[] {
  return children.map((child) => {
    if (child.kind === 'text' && child.value && child.value !== '\n' && child.value.includes('\n')) {
      return { ...child, value: child.value.replace(/[ \t]*\r?\n[ \t]*/g, ' ') };
    }
    if (child.children) return { ...child, children: collapseTextSoftBreaks(child.children) };
    return child;
  });
}

// ─── Data-URI image resolution (no file access) ───────────────────────────────

function inferMime(data: Uint8Array): 'image/png' | 'image/jpeg' | null {
  if (data.length >= 8 && data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) return 'image/png';
  if (data.length >= 2 && data[0] === 0xff && data[1] === 0xd8) return 'image/jpeg';
  return null;
}

export function resolveDataUri(src: string): ResolvedImage | null {
  const match = src.match(/^data:([^;,]+);base64,([A-Za-z0-9+/=\s]+)$/i);
  if (!match) return null;

  const mimeRaw = match[1].trim().toLowerCase() === 'image/jpg' ? 'image/jpeg' : match[1].trim().toLowerCase();
  if (mimeRaw !== 'image/png' && mimeRaw !== 'image/jpeg') return null;

  const b64 = match[2].replace(/\s+/g, '');
  // Validate by checking magic bytes
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  if (inferMime(bytes) !== mimeRaw) return null;

  return { data: b64, mimeType: mimeRaw as 'image/png' | 'image/jpeg' };
}

export function makeImageResolver(
  userResolver?: (src: string) => ResolvedImage | null
): (node: SemanticNode) => ResolvedImage | null {
  const cache = new Map<string, ResolvedImage | null>();
  return (node: SemanticNode) => {
    const src = (node.src || '').trim();
    if (!src) return null;
    if (cache.has(src)) return cache.get(src)!;

    let result: ResolvedImage | null = null;
    if (/^data:/i.test(src)) {
      result = resolveDataUri(src);
    } else if (userResolver) {
      result = userResolver(src);
    }

    cache.set(src, result);
    return result;
  };
}

// ─── Style helpers for FormatContext ─────────────────────────────────────────

export function makeInlineContext(
  themeStyles: Record<string, ElementStyle>,
  config: Record<string, unknown>,
  resolveImage: (node: SemanticNode) => ResolvedImage | null,
  registerLink: (url: string, title?: string) => number,
  registerFootnote: (id: string, content?: SemanticNode[]) => number
): InlineContext {
  const linksCfg = (config.links as Record<string, unknown>) || {};
  const footnotesTop = (config.footnotes as Record<string, unknown>) || {};
  const manuscriptFootnotes = (((config.manuscript as Record<string, unknown> || {}).footnotes) as Record<string, unknown>) || {};
  const footnotesCfg = Object.keys(footnotesTop).length > 0 ? footnotesTop : manuscriptFootnotes;

  const linkMode: InlineLinkMode =
    linksCfg.mode === 'inline' ? 'inline' : linksCfg.mode === 'strip' ? 'strip' : 'citation';
  const linkMarkerFormat: 'bracket' | 'paren' | 'superscript' =
    linksCfg.markerStyle === 'superscript' ? 'superscript'
    : linksCfg.markerStyle === 'paren' ? 'paren'
    : 'bracket';
  const footnoteStyle: 'bracket' | 'superscript' | 'plain' =
    footnotesCfg.markerStyle === 'plain' ? 'plain'
    : footnotesCfg.markerStyle === 'bracket' ? 'bracket'
    : 'superscript';

  const typographyCfg = (config.typography as Record<string, unknown>) || {};

  const imgCfg = (config.images as Record<string, unknown>) || {};
  const inlineImageStyle: Record<string, unknown> = {
    width: 11, height: 11, verticalAlign: 'middle', baselineShift: -0.8,
    inlineMarginLeft: 1.2, inlineMarginRight: 1.2,
    ...(imgCfg.inlineStyle || {})
  };

  return {
    linkMode,
    citationStyle: (linksCfg.citationStyle || 'bracket') as 'bracket' | 'paren',
    linkMarkerFormat,
    footnoteStyle,
    dedupe: linksCfg.dedupe !== false,
    smartQuotes: typographyCfg.smartQuotes !== false,
    inlineCodeStyle: themeStyles['inline-code'] as Record<string, unknown> | undefined,
    linkStyle: themeStyles['link'] as Record<string, unknown> | undefined,
    citationMarkerStyle: themeStyles['citation-marker'] as Record<string, unknown> | undefined,
    footnoteMarkerStyle: themeStyles['footnote-marker'] as Record<string, unknown> | undefined,
    inlineImageStyle,
    registerLink,
    registerFootnote,
    resolveImage
  };
}
