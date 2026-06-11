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
import {
  ZhManuscriptFormat,
  type ZhManuscriptExpandingProbeAst,
  type ZhManuscriptTocAst,
  type ZhManuscriptTocEntry
} from './format';
import { validateZhManuscriptCompliance } from './validator';

export type { DocumentInput, Element, ElementStyle, DocumentLayout, ResolvedImage };
export type { Transmuter, TransmuterOptions } from '@vmprint/contracts';
export type { ZhManuscriptExpandingProbeAst, ZhManuscriptTocAst, ZhManuscriptTocEntry } from './format';

export const DEFAULT_ZH_MANUSCRIPT_CONFIG_YAML = `
manuscript:
  coverPage:
    mode: first-page-cover
  runningHeader:
    enabled: true
    # Tokens: {shortTitle} book title, {author} full name, {surname} surname only, {n} page number
    format: "{shortTitle}　{n}"
  chapter:
    pageBreakBefore: true
  sceneBreak:
    symbol: "※"
  footnotes:
    mode: endnotes
    heading: 注释
    markerStyle: superscript

links:
  mode: strip

typography:
  smartQuotes: true
`;

export const DEFAULT_ZH_MANUSCRIPT_THEME_YAML = `
layout:
  fontFamily: Noto Serif SC
  fontSize: 11
  lineHeight: 1.75
  pageSize: A4
  margins:
    top: 85
    right: 90
    bottom: 85
    left: 90
  hyphenation: "off"
  justifyEngine: legacy

styles:
  # Cover page — clean title-page feel, everything centered
  cover-title:
    textAlign: center
    fontWeight: 700
    fontSize: 26
    marginTop: 160
    marginBottom: 32
  cover-line:
    textAlign: center
    fontSize: 9.5
    marginBottom: 9
  # Chapter heading — left-aligned, prominent but not padded to death
  chapter-heading:
    textAlign: left
    fontWeight: 700
    fontSize: 20
    marginTop: 72
    marginBottom: 30
    keepWithNext: true
  scene-break:
    textAlign: center
    marginTop: 32
    marginBottom: 32
    hyphenation: "off"
  # Body — 2em indent on every paragraph (Chinese convention), no gap between paragraphs
  paragraph:
    textAlign: justify
    textIndent: 22
    marginBottom: 0
  paragraph-first:
    textAlign: justify
    textIndent: 22
    marginBottom: 0
  blockquote:
    textAlign: justify
    fontStyle: normal
    marginTop: 14
    marginBottom: 14
    marginLeft: 22
  literary-quote:
    textAlign: justify
    fontStyle: normal
    marginTop: 14
    marginBottom: 14
    marginLeft: 44
    marginRight: 44
  poem:
    textAlign: left
    lineHeight: 1.75
    marginTop: 14
    marginBottom: 14
    marginLeft: 44
    marginRight: 60
  lyrics:
    textAlign: left
    lineHeight: 1.75
    fontStyle: normal
    marginTop: 14
    marginBottom: 14
    marginLeft: 44
    marginRight: 60
  epigraph:
    textAlign: center
    fontStyle: normal
    marginTop: 22
    marginBottom: 6
    marginLeft: 44
    marginRight: 44
  epigraph-attribution:
    textAlign: right
    marginTop: 4
    marginBottom: 22
    marginLeft: 44
    marginRight: 44
    fontStyle: normal
  footnote-marker:
    fontSize: 8
    baselineShift: 2.5
  thematic-break:
    marginTop: 28
    marginBottom: 14
    borderTopWidth: 0.5
    borderTopColor: "#555555"
  notes-heading:
    textAlign: left
    fontWeight: 700
    marginTop: 14
    marginBottom: 10
  notes-item:
    textAlign: left
    marginBottom: 7
    paddingLeft: 16
    textIndent: -16

`;

export type ZhManuscriptTransmuteOptions = TransmuterOptions & {
  resolveImage?: (src: string) => ResolvedImage | null;
};

export type ZhManuscriptTransmuteArtifacts = {
  tocAst: ZhManuscriptTocAst;
  expandingProbeAst: ZhManuscriptExpandingProbeAst;
};

export type ZhManuscriptTransmuteResult = {
  document: DocumentInput;
  artifacts: ZhManuscriptTransmuteArtifacts;
};

export function transmute(markdown: string, options?: ZhManuscriptTransmuteOptions): DocumentInput {
  return transmuteWithArtifacts(markdown, options).document;
}

export function transmuteWithArtifacts(markdown: string, options?: ZhManuscriptTransmuteOptions): ZhManuscriptTransmuteResult {
  const { frontmatter, body } = extractFrontmatter(markdown);
  const ast = parseMarkdownAst(body);
  const semantic = normalizeToSemantic(ast);
  const theme = parseTheme(options?.theme ?? DEFAULT_ZH_MANUSCRIPT_THEME_YAML);
  const config = resolveMarkdownConfig(frontmatter, options?.config, DEFAULT_ZH_MANUSCRIPT_CONFIG_YAML);

  config.__nodes = semantic.children;
  config.__footnotes = semantic.footnotes || {};

  const resolveImage = makeImageResolver(options?.resolveImage);
  const handler = new ZhManuscriptFormat(config);
  const ctx = new FormatContextImpl(theme, config, resolveImage);

  for (const node of semantic.children) {
    handler.handleBlock(node, ctx);
  }
  handler.flush(ctx);

  const built = buildLayout(theme.layout);
  const document: DocumentInput = {
    documentVersion: '1.1',
    layout: built.layout,
    styles: theme.styles,
    elements: ctx.getElements(),
    ...(theme.header ? { header: theme.header } : (built.header ? { header: built.header } : {})),
    ...(theme.footer ? { footer: theme.footer } : (built.footer ? { footer: built.footer } : {}))
  };

  validateZhManuscriptCompliance(document, config);
  return {
    document,
    artifacts: {
      tocAst: handler.getTocAst(),
      expandingProbeAst: handler.getExpandingProbeAst()
    }
  };
}

export type ZhManuscriptTransmuter = Transmuter<string, DocumentInput, ZhManuscriptTransmuteOptions>;

export const transmuter: ZhManuscriptTransmuter = {
  transmute,
  getBoilerplate() {
    return [
      '# 中文稿件设置 / Chinese Manuscript Settings',
      '# manuscript:',
      '#   coverPage:',
      '#     mode: first-page-cover  # 选项: none, first-page-cover, separate-cover-page',
      '#   runningHeader:',
      '#     enabled: true',
      '#     format: "{author} / {shortTitle} / {n}"',
      '#   chapter:',
      '#     pageBreakBefore: true',
      '#   sceneBreak:',
      '#     symbol: "※"',
      '#   footnotes:',
      '#     heading: 注释',
      '#',
      '# typography:',
      '#   smartQuotes: true'
    ].join('\n');
  }
};
