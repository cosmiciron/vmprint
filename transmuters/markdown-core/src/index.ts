import { parse as parseYaml } from 'yaml';
import { parseMarkdownAst } from './parse';
import { normalizeToSemantic } from './semantic';
import { MarkdownFormatHandler } from './format';
import { FormatContextImpl } from './context';
import { parseTheme, deepMerge, buildLayout } from './theme';
import { makeImageResolver, inlinePlainText, collapseTextSoftBreaks } from './inline';
import type { DocumentInput, ResolvedImage } from './types';

export type { DocumentInput, Element, ElementStyle, DocumentLayout, ResolvedImage } from './types';
export type { ThemeDefinition } from './theme';
export type { MdNode, MdPosition } from './parse';
export { KEEP_WITH_NEXT_PATTERN, parseMarkdownAst } from './parse';
export type { SourceRange, SemanticNodeKind, SemanticNode, SemanticDocument } from './semantic';
export { normalizeToSemantic } from './semantic';
export { formatNumber, toAlpha, toRoman } from './numbering';
export type { FormatContext, TableEmitOptions } from './context';
export { FormatContextImpl } from './context';
export { parseTheme, deepMerge, buildLayout } from './theme';
export { makeImageResolver, inlinePlainText, collapseTextSoftBreaks } from './inline';

export const DEFAULT_MARKDOWN_CONFIG_YAML = `\
list:
  textIndentPerLevel: 16.5
  markerGap: 6
  taskMarkers:
    checked: "\\u2611"
    unchecked: "\\u2610"

links:
  mode: citation
  dedupe: true
  citationStyle: bracket
  markerStyle: superscript

references:
  enabled: true
  heading: References
  numberingStyle: decimal

footnotes:
  heading: Footnotes
  markerStyle: superscript

blockquote:
  attribution:
    enabled: true

typography:
  smartQuotes: true

images:
  frame:
    mode: "off"

tables:
  zebra: true
  zebraColor: "#f7f9fc"
  headerColor: "#eef3f8"
`;

export type TransmuteMarkdownOptions = {
  theme?: string;
  config?: string | Record<string, unknown>;
  baseConfig?: string | Record<string, unknown>;
  resolveImage?: (src: string) => ResolvedImage | null;
};

export function extractFrontmatter(markdown: string): { frontmatter: Record<string, unknown>; body: string } {
  const normalized = markdown.replace(/^\uFEFF/, '');
  const trimmedStart = normalized.replace(/^\s*/, '');
  const leadingOffset = normalized.length - trimmedStart.length;
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(trimmedStart);
  if (!match) return { frontmatter: {}, body: normalized };
  try {
    const parsed = parseYaml(match[1]) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object') return { frontmatter: {}, body: normalized };
    return { frontmatter: parsed, body: normalized.slice(leadingOffset + match[0].length) };
  } catch {
    return { frontmatter: {}, body: normalized };
  }
}

export function resolveMarkdownConfig(
  frontmatter: Record<string, unknown>,
  userConfig?: string | Record<string, unknown>,
  baseConfig?: string | Record<string, unknown>
): Record<string, unknown> {
  let config: Record<string, unknown> = {};
  const defaultSource = baseConfig ?? DEFAULT_MARKDOWN_CONFIG_YAML;
  const parsedDefaults = typeof defaultSource === 'string'
    ? (() => {
        try {
          const parsed = parseYaml(defaultSource);
          return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
            ? parsed as Record<string, unknown>
            : {};
        } catch {
          return {};
        }
      })()
    : defaultSource;
  if (parsedDefaults && typeof parsedDefaults === 'object') {
    config = parsedDefaults;
  }

  const fmConfig = { ...frontmatter };
  delete fmConfig.format;
  delete fmConfig.theme;
  deepMerge(config, fmConfig);

  if (userConfig) {
    const userObj = typeof userConfig === 'string'
      ? (() => {
          try {
            const parsed = parseYaml(userConfig);
            return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
              ? parsed as Record<string, unknown>
              : {};
          } catch {
            return {};
          }
        })()
      : userConfig;
    deepMerge(config, userObj);
  }

  return config;
}

export function transmuteMarkdown(markdown: string, options?: TransmuteMarkdownOptions): DocumentInput {
  const { frontmatter, body } = extractFrontmatter(markdown);
  const ast = parseMarkdownAst(body);
  const semantic = normalizeToSemantic(ast);
  const theme = parseTheme(options?.theme || '{}');
  const config = resolveMarkdownConfig(frontmatter, options?.config, options?.baseConfig);

  config.__footnotes = semantic.footnotes || {};

  const resolveImage = makeImageResolver(options?.resolveImage);
  const handler = new MarkdownFormatHandler();
  const ctx = new FormatContextImpl(theme, config, resolveImage);

  for (const node of semantic.children) {
    handler.handleBlock(node);
  }
  handler.flush(ctx);

  const built = buildLayout(theme.layout);

  return {
    documentVersion: '1.1',
    layout: built.layout,
    styles: theme.styles,
    elements: ctx.getElements(),
    ...(theme.header ? { header: theme.header } : (built.header ? { header: built.header } : {})),
    ...(theme.footer ? { footer: theme.footer } : (built.footer ? { footer: built.footer } : {}))
  };
}
