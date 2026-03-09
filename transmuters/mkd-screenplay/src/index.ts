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
import { ScreenplayFormat } from './format';

export type { DocumentInput, Element, ElementStyle, DocumentLayout, ResolvedImage };
export type { Transmuter, TransmuterOptions } from '@vmprint/contracts';

export const DEFAULT_SCREENPLAY_CONFIG_YAML = `
# Screenplay format defaults
# Industry-standard screenplays do not use hyperlinks or citation markers.
# All link markup is rendered as plain text (the display text only, no URL
# annotation and no [n] reference marker).
links:
  mode: strip
`;

export const DEFAULT_SCREENPLAY_THEME_YAML = `
layout:
  pageSize: LETTER
  margins:
    top: 72
    right: 72
    bottom: 72
    left: 108
  fontFamily: Courier Prime
  fontSize: 12
  lineHeight: 1
  pageNumberStart: 2

header:
  default:
    elements:
      - type: paragraph
        content: "{pageNumber}."
        properties:
          style:
            textAlign: right
            fontSize: 12
            color: "#111111"
            fontFamily: Courier Prime
            marginTop: 36

styles:
  text:
    fontFamily: Courier Prime
    fontSize: 12
    lineHeight: 1
    color: "#111111"
  title:
    fontFamily: Courier Prime
    fontSize: 12
    lineHeight: 1
    color: "#111111"
    textAlign: center
    marginLeft: -36
    width: 468
    marginTop: 180
    marginBottom: 12
    pageBreakBefore: true
    keepWithNext: true
  title-meta:
    fontFamily: Courier Prime
    fontSize: 12
    lineHeight: 1
    color: "#111111"
    textAlign: center
    marginLeft: -36
    width: 468
    marginTop: 0
    marginBottom: 0
  title-contact:
    fontFamily: Courier Prime
    fontSize: 12
    lineHeight: 1
    color: "#111111"
    textAlign: left
    marginLeft: -36
    width: 468
    marginTop: 0
    marginBottom: 0
  scene-heading:
    fontFamily: Courier Prime
    fontSize: 12
    lineHeight: 1
    color: "#111111"
    marginTop: 0
    marginBottom: 12
    keepWithNext: true
  action:
    fontFamily: Courier Prime
    fontSize: 12
    lineHeight: 1
    color: "#111111"
    allowLineSplit: true
    orphans: 2
    widows: 2
    marginTop: 0
    marginBottom: 12
  character:
    fontFamily: Courier Prime
    fontSize: 12
    lineHeight: 1
    color: "#111111"
    marginLeft: 158.4
    width: 165.6
    marginTop: 0
    marginBottom: 0
    keepWithNext: true
  parenthetical:
    fontFamily: Courier Prime
    fontSize: 12
    lineHeight: 1
    color: "#111111"
    marginLeft: 115.2
    width: 172.8
    marginTop: 0
    marginBottom: 0
    keepWithNext: true
  dialogue:
    fontFamily: Courier Prime
    fontSize: 12
    lineHeight: 1
    color: "#111111"
    marginLeft: 72
    width: 252
    allowLineSplit: true
    orphans: 2
    widows: 2
    marginTop: 0
    marginBottom: 12
  character-dual-left:
    fontFamily: Courier Prime
    fontSize: 12
    lineHeight: 1
    color: "#111111"
    marginLeft: 54
    width: 150
    marginTop: 0
    marginBottom: 0
    keepWithNext: true
  parenthetical-dual-left:
    fontFamily: Courier Prime
    fontSize: 12
    lineHeight: 1
    color: "#111111"
    marginLeft: 36
    width: 162
    marginTop: 0
    marginBottom: 0
    keepWithNext: true
  dialogue-dual-left:
    fontFamily: Courier Prime
    fontSize: 12
    lineHeight: 1
    color: "#111111"
    marginLeft: 0
    width: 204
    allowLineSplit: true
    orphans: 2
    widows: 2
    marginTop: 0
    marginBottom: 12
  character-dual-right:
    fontFamily: Courier Prime
    fontSize: 12
    lineHeight: 1
    color: "#111111"
    marginLeft: 282
    width: 150
    marginTop: 0
    marginBottom: 0
    keepWithNext: true
  parenthetical-dual-right:
    fontFamily: Courier Prime
    fontSize: 12
    lineHeight: 1
    color: "#111111"
    marginLeft: 264
    width: 162
    marginTop: 0
    marginBottom: 0
    keepWithNext: true
  dialogue-dual-right:
    fontFamily: Courier Prime
    fontSize: 12
    lineHeight: 1
    color: "#111111"
    marginLeft: 228
    width: 204
    allowLineSplit: true
    orphans: 2
    widows: 2
    marginTop: 0
    marginBottom: 12
  transition:
    fontFamily: Courier Prime
    fontSize: 12
    lineHeight: 1
    color: "#111111"
    textAlign: right
    marginTop: 0
    marginBottom: 12
  intertitle:
    fontFamily: Courier Prime
    fontSize: 12
    lineHeight: 1
    color: "#111111"
    textAlign: center
    marginTop: 0
    marginBottom: 10
  insert:
    fontFamily: Courier Prime
    fontSize: 12
    lineHeight: 1
    color: "#111111"
    marginTop: 0
    marginBottom: 12
  more:
    fontFamily: Courier Prime
    fontSize: 12
    lineHeight: 1
    color: "#111111"
    textAlign: right
    marginLeft: 72
    width: 252
    marginTop: 0
    marginBottom: 0
  beat:
    fontFamily: Courier Prime
    fontSize: 12
    lineHeight: 1
    color: "#111111"
    borderTopWidth: 0.7
    borderTopColor: "#111111"
    marginTop: 0
    marginBottom: 12
`;

export type ScreenplayTransmuteOptions = TransmuterOptions & {
  resolveImage?: (src: string) => ResolvedImage | null;
};

export function transmute(markdown: string, options?: ScreenplayTransmuteOptions): DocumentInput {
  const { frontmatter, body } = extractFrontmatter(markdown);
  const ast = parseMarkdownAst(body);
  const semantic = normalizeToSemantic(ast);
  const theme = parseTheme(options?.theme ?? DEFAULT_SCREENPLAY_THEME_YAML);
  const config = resolveMarkdownConfig(frontmatter, options?.config, DEFAULT_SCREENPLAY_CONFIG_YAML);

  const resolveImage = makeImageResolver(options?.resolveImage);
  const handler = new ScreenplayFormat(config);
  const ctx = new FormatContextImpl(theme, config, resolveImage);

  for (const node of semantic.children) {
    handler.handleBlock(node, ctx);
  }
  handler.flush(ctx);

  const built = buildLayout(theme.layout);
  return {
    documentVersion: '1.0',
    layout: built.layout,
    styles: theme.styles,
    elements: ctx.getElements(),
    ...(theme.header ? { header: theme.header } : (built.header ? { header: built.header } : {})),
    ...(theme.footer ? { footer: theme.footer } : (built.footer ? { footer: built.footer } : {}))
  };
}

export type ScreenplayTransmuter = Transmuter<string, DocumentInput, ScreenplayTransmuteOptions>;

export const transmuter: ScreenplayTransmuter = {
  transmute,
  getBoilerplate() {
    return [
      '# Screenplay Settings',
      '# screenplay:',
      '#   includeTitlePage: true',
      '#',
      '# typography:',
      '#   smartQuotes: true'
    ].join('\n');
  }
};
