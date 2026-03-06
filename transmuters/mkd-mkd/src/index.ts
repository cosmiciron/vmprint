import { parse as parseYaml } from 'yaml';
import { parseMarkdownAst } from './parse';
import { normalizeToSemantic } from './semantic';
import { MarkdownFormatHandler } from './format';
import { FormatContextImpl } from './context';
import { parseTheme, deepMerge, buildLayout } from './theme';
import { makeImageResolver } from './inline';
import { defaultTheme } from './themes/default.yaml';
import { opensourceTheme } from './themes/opensource.yaml';
import { novelTheme } from './themes/novel.yaml';
import type { DocumentInput, ResolvedImage } from './types';

export type { DocumentInput, Element, ElementStyle, DocumentLayout, ResolvedImage } from './types';
export type { ThemeDefinition } from './theme';

/** All bundled themes keyed by name. Compatible with draft2final markdown themes. */
export const themes: Record<string, string> = {
  default: defaultTheme,
  opensource: opensourceTheme,
  novel: novelTheme
};

const bundledThemes = themes;

// ─── Default config ───────────────────────────────────────────────────────────

// Same behavioral defaults as draft2final's markdown/config.defaults.yaml
const DEFAULT_CONFIG_YAML = `\
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

// ─── API ─────────────────────────────────────────────────────────────────────

export type TransmuteOptions = {
  /**
   * Theme definition as a YAML string (layout + styles blocks).
   * Compatible with any draft2final theme. Defaults to the bundled 'default' theme.
   */
  theme?: string;

  /**
   * Behavioral configuration as a YAML string or a plain object.
   * Merged over format defaults and document frontmatter.
   */
  config?: string | Record<string, unknown>;

  /**
   * Resolve non-data-URI image sources (e.g. relative file paths in a custom env).
   * Called with the raw src value. Return null to emit a placeholder element.
   * Data URIs (data:image/...) are always resolved inline without calling this.
   */
  resolveImage?: (src: string) => ResolvedImage | null;
};

// ─── Frontmatter extraction ───────────────────────────────────────────────────

function extractFrontmatter(markdown: string): { frontmatter: Record<string, unknown>; body: string } {
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

// ─── Config resolution ────────────────────────────────────────────────────────

function resolveConfig(
  frontmatter: Record<string, unknown>,
  userConfig?: string | Record<string, unknown>
): Record<string, unknown> {
  // Start from hardcoded defaults
  let config: Record<string, unknown> = {};
  try {
    const parsed = parseYaml(DEFAULT_CONFIG_YAML) as Record<string, unknown>;
    if (parsed && typeof parsed === 'object') config = parsed;
  } catch { /* ignore */ }

  // Merge frontmatter (exclude format/theme selection keys)
  const fmConfig = { ...frontmatter };
  delete fmConfig.format;
  delete fmConfig.theme;
  deepMerge(config, fmConfig);

  // Merge user-supplied config
  if (userConfig) {
    const userObj = typeof userConfig === 'string'
      ? (() => {
          try {
            const p = parseYaml(userConfig);
            return (p && typeof p === 'object' && !Array.isArray(p)) ? p as Record<string, unknown> : {};
          } catch { return {}; }
        })()
      : userConfig;
    deepMerge(config, userObj);
  }

  return config;
}

// ─── Main transmute function ──────────────────────────────────────────────────

/**
 * Transmute a Markdown string into a VMPrint DocumentInput JSON object.
 *
 * @param markdown - Input Markdown (may include YAML frontmatter)
 * @param options  - Theme, config, and image resolver options
 * @returns        - A DocumentInput ready to feed directly into the VMPrint engine
 */
export function transmute(markdown: string, options?: TransmuteOptions): DocumentInput {
  // 1. Extract frontmatter
  const { frontmatter, body } = extractFrontmatter(markdown);

  // 2. Parse markdown → remark AST → SemanticDocument
  const ast = parseMarkdownAst(body);
  const semantic = normalizeToSemantic(ast);

  // 3. Resolve theme
  const themeYaml = options?.theme ?? bundledThemes[String(frontmatter.theme || 'default')] ?? defaultTheme;
  const theme = parseTheme(themeYaml);

  // 4. Resolve config (defaults → frontmatter → user config)
  const config = resolveConfig(frontmatter, options?.config);

  // Store footnotes in config for flush step
  config.__footnotes = semantic.footnotes || {};

  // 5. Build image resolver
  const resolveImage = makeImageResolver(options?.resolveImage);

  // 6. Run format handler
  const handler = new MarkdownFormatHandler();
  const ctx = new FormatContextImpl(theme, config, resolveImage);

  for (const node of semantic.children) {
    handler.handleBlock(node);
  }
  handler.flush(ctx);

  return {
    documentVersion: '1.0',
    layout: buildLayout(theme.layout),
    styles: theme.styles,
    elements: ctx.getElements()
  };
}

