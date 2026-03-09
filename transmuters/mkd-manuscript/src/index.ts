import {
  extractFrontmatter,
  parseMarkdownAst,
  normalizeToSemantic,
  resolveMarkdownConfig,
  parseTheme,
  buildLayout,
  makeImageResolver,
  FormatContextImpl,
  type DocumentInput,
  type Element,
  type ElementStyle,
  type DocumentLayout,
  type ResolvedImage
} from '@vmprint/markdown-core';
import type { Transmuter, TransmuterOptions } from '@vmprint/contracts';
import { ManuscriptFormat } from './format';
import { validateManuscriptCompliance } from './validator';

export type { DocumentInput, Element, ElementStyle, DocumentLayout, ResolvedImage };
export type { Transmuter, TransmuterOptions } from '@vmprint/contracts';

export const DEFAULT_MANUSCRIPT_CONFIG_YAML = `
manuscript:
  coverPage:
    mode: first-page-cover
  runningHeader:
    enabled: true
    format: "{surname} / {shortTitle} / {n}"
  chapter:
    pageBreakBefore: true
  sceneBreak:
    symbol: "#"
  footnotes:
    mode: endnotes
    heading: Notes
    markerStyle: superscript

links:
  mode: strip

typography:
  smartQuotes: true
`;

export const DEFAULT_MANUSCRIPT_THEME_YAML = `
layout:
  fontFamily: Tinos
  fontSize: 12
  lineHeight: 2
  pageSize: LETTER
  margins:
    top: 72
    right: 72
    bottom: 72
    left: 72
  hyphenation: "off"
  justifyEngine: legacy

styles:
  cover-title:
    textAlign: center
    fontWeight: 700
    marginTop: 216
    marginBottom: 24
  cover-line:
    textAlign: left
    marginBottom: 6
  chapter-heading:
    textAlign: center
    fontWeight: 700
    marginTop: 24
    marginBottom: 24
    keepWithNext: true
  scene-break:
    textAlign: center
    marginTop: 24
    marginBottom: 24
    hyphenation: "off"
  paragraph:
    textAlign: left
    textIndent: 36
    marginBottom: 0
  paragraph-first:
    textAlign: left
    textIndent: 0
    marginBottom: 0
  blockquote:
    textAlign: left
    fontStyle: normal
    marginTop: 12
    marginBottom: 12
    marginLeft: 36
  literary-quote:
    textAlign: left
    fontStyle: normal
    marginTop: 12
    marginBottom: 12
    marginLeft: 48
    marginRight: 48
  poem:
    textAlign: left
    lineHeight: 1.85
    marginTop: 12
    marginBottom: 12
    marginLeft: 48
    marginRight: 60
  lyrics:
    textAlign: left
    lineHeight: 1.85
    fontStyle: italic
    marginTop: 12
    marginBottom: 12
    marginLeft: 48
    marginRight: 60
  epigraph:
    textAlign: center
    fontStyle: italic
    marginTop: 18
    marginBottom: 6
    marginLeft: 48
    marginRight: 48
  epigraph-attribution:
    textAlign: right
    marginTop: 3
    marginBottom: 18
    marginLeft: 48
    marginRight: 48
    fontStyle: italic
  footnote-marker:
    fontSize: 8.5
    baselineShift: 3
  thematic-break:
    marginTop: 24
    marginBottom: 12
    borderTopWidth: 0.6
    borderTopColor: "#111111"
  notes-heading:
    textAlign: left
    fontWeight: 700
    marginTop: 12
    marginBottom: 8
  notes-item:
    textAlign: left
    marginBottom: 6
    paddingLeft: 16
    textIndent: -16

`;

export const CLASSIC_MANUSCRIPT_THEME_YAML = `
layout:
  fontFamily: Courier Prime
  fontSize: 12
  lineHeight: 2
  pageSize: LETTER
  margins:
    top: 72
    right: 72
    bottom: 72
    left: 72
  hyphenation: "off"
  justifyEngine: legacy

styles:
  cover-title:
    textAlign: center
    fontWeight: 700
    marginTop: 216
    marginBottom: 24
  cover-line:
    textAlign: left
    marginBottom: 6
  chapter-heading:
    textAlign: center
    fontWeight: 700
    marginTop: 24
    marginBottom: 24
    keepWithNext: true
  scene-break:
    textAlign: center
    marginTop: 24
    marginBottom: 24
    hyphenation: "off"
  paragraph:
    textAlign: left
    textIndent: 36
    marginBottom: 0
  paragraph-first:
    textAlign: left
    textIndent: 0
    marginBottom: 0
  blockquote:
    textAlign: left
    fontStyle: normal
    marginTop: 12
    marginBottom: 12
    marginLeft: 36
  literary-quote:
    textAlign: left
    fontStyle: normal
    marginTop: 12
    marginBottom: 12
    marginLeft: 48
    marginRight: 48
  poem:
    textAlign: left
    lineHeight: 1.85
    marginTop: 12
    marginBottom: 12
    marginLeft: 48
    marginRight: 60
  lyrics:
    textAlign: left
    lineHeight: 1.85
    fontStyle: normal
    marginTop: 12
    marginBottom: 12
    marginLeft: 48
    marginRight: 60
  epigraph:
    textAlign: center
    fontStyle: normal
    marginTop: 18
    marginBottom: 6
    marginLeft: 48
    marginRight: 48
  epigraph-attribution:
    textAlign: right
    marginTop: 3
    marginBottom: 18
    marginLeft: 48
    marginRight: 48
    fontStyle: normal
  footnote-marker:
    fontSize: 8.5
    baselineShift: 3
  thematic-break:
    marginTop: 24
    marginBottom: 12
    borderTopWidth: 0.6
    borderTopColor: "#111111"
  notes-heading:
    textAlign: left
    fontWeight: 700
    marginTop: 12
    marginBottom: 8
  notes-item:
    textAlign: left
    marginBottom: 6
    paddingLeft: 16
    textIndent: -16

`;

export type ManuscriptTransmuteOptions = TransmuterOptions & {
  resolveImage?: (src: string) => ResolvedImage | null;
};

export function transmute(markdown: string, options?: ManuscriptTransmuteOptions): DocumentInput {
  const { frontmatter, body } = extractFrontmatter(markdown);
  const ast = parseMarkdownAst(body);
  const semantic = normalizeToSemantic(ast);
  const theme = parseTheme(options?.theme ?? DEFAULT_MANUSCRIPT_THEME_YAML);
  const config = resolveMarkdownConfig(frontmatter, options?.config, DEFAULT_MANUSCRIPT_CONFIG_YAML);

  config.__nodes = semantic.children;
  config.__footnotes = semantic.footnotes || {};

  const resolveImage = makeImageResolver(options?.resolveImage);
  const handler = new ManuscriptFormat(config);
  const ctx = new FormatContextImpl(theme, config, resolveImage);

  for (const node of semantic.children) {
    handler.handleBlock(node, ctx);
  }
  handler.flush(ctx);

  const built = buildLayout(theme.layout);
  const ir: DocumentInput = {
    documentVersion: '1.0',
    layout: built.layout,
    styles: theme.styles,
    elements: ctx.getElements(),
    ...(theme.header ? { header: theme.header } : (built.header ? { header: built.header } : {})),
    ...(theme.footer ? { footer: theme.footer } : (built.footer ? { footer: built.footer } : {}))
  };

  validateManuscriptCompliance(ir, config);
  return ir;
}

export type ManuscriptTransmuter = Transmuter<string, DocumentInput, ManuscriptTransmuteOptions>;

export const transmuter: ManuscriptTransmuter = {
  transmute,
  getBoilerplate() {
    return [
      '# Manuscript Settings',
      '# manuscript:',
      '#   coverPage:',
      '#     mode: separate-cover-page  # Options: none, first-page-cover, separate-cover-page',
      '#   runningHeader:',
      '#     enabled: true',
      '#     format: "{surname} / {shortTitle} / {n}"',
      '#   chapter:',
      '#     pageBreakBefore: true',
      '#   sceneBreak:',
      '#     symbol: "#"',
      '#   footnotes:',
      '#     heading: Notes',
      '#',
      '# typography:',
      '#   smartQuotes: true',
      '#   smartDashes: true'
    ].join('\n');
  }
};
