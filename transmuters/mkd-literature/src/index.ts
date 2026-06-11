import {
  transmuteMarkdown,
  type DocumentInput,
  type Element,
  type ElementStyle,
  type DocumentLayout,
  type ResolvedImage
} from '@vmprint/markdown-core';
import type { Transmuter, TransmuterOptions } from '@vmprint/contracts';

export type { DocumentInput, Element, ElementStyle, DocumentLayout, ResolvedImage };
export type { Transmuter, TransmuterOptions } from '@vmprint/contracts';

export const DEFAULT_LITERATURE_CONFIG_YAML = `
list:
  textIndentPerLevel: 15
  markerGap: 5
  itemSpacingAfter: 3.6
  tightItemSpacingAfter: 1.2
  continuationIndentLevels: 0
  unorderedMarkers:
    - "\u2014"
    - "\u2014"
    - "\u2014"
  orderedMarkers:
    - upper-roman
    - decimal
    - lower-alpha
  taskMarkers:
    checked: "[done]"
    unchecked: "[ ]"

links:
  mode: citation
  dedupe: true
  citationStyle: bracket

references:
  enabled: true
  heading: Notes
  numberingStyle: lower-roman
  includeLinkTitle: true

blockquote:
  attribution:
    enabled: true
    markerPattern: '^[-\u2014\u2013]{1,2}\s+'

title:
  subheading:
    enabled: false
    markerPattern: '^::\s+'
    requireMarker: true
    stripMarker: true
    applyToFirstH1Only: true
    keepWithNext: true

images:
  blockStyle:
    width: 286
    marginTop: 5.4
    marginBottom: 5
    borderWidth: 0
    borderRadius: 0
    paddingTop: 0
    paddingBottom: 0
    paddingLeft: 0
    paddingRight: 0
  frame:
    mode: "off"
    markerPattern: '\b(frame|framed)\b'
    style: {}

captions:
  pattern: '^(Plate|Figure|Fig\.|Source)\s+([0-9]+|[IVXLC]+)\b'
  blockquoteUnderImageAsFigureCaption: false
  style:
    textAlign: left
    hyphenation: "off"
    fontStyle: italic
    fontSize: 9.8
    lineHeight: 1.3
    color: "#47443f"
    marginTop: 0
    marginBottom: 9

tables:
  zebra: false
  headerColor: "#f3f4f6"

codeBlocks:
  defaultMode: extract
  languageModes:
    verse: verse
    poetry: verse
    poem: verse
    extract: extract
    archive: extract
    epigraph: epigraph
    letter: letter
    marginalia: marginalia
  modes:
    verse:
      style:
        fontFamily: Caladea
        fontStyle: italic
        fontSize: 11.6
        lineHeight: 1.58
        textAlign: left
        color: "#252422"
        backgroundColor: "#ffffff"
        borderWidth: 0
        borderLeftWidth: 0
        borderLeftColor: "#96928a"
        paddingTop: 6
        paddingBottom: 6
        paddingLeft: 18
        paddingRight: 8
        marginTop: 0.4
        marginBottom: 10
    extract:
      style:
        fontFamily: Caladea
        fontStyle: italic
        fontSize: 11.2
        lineHeight: 1.5
        textAlign: left
        color: "#2a2a2a"
        backgroundColor: "#ffffff"
        borderWidth: 0
        borderLeftWidth: 0
        borderLeftColor: "#8d8a84"
        paddingTop: 6
        paddingBottom: 6
        paddingLeft: 14
        paddingRight: 8
        marginTop: 0
        marginBottom: 10
    epigraph:
      style:
        fontFamily: Caladea
        fontStyle: italic
        fontSize: 11
        lineHeight: 1.5
        textAlign: center
        color: "#2f2c28"
        backgroundColor: "#ffffff"
        borderWidth: 0
        paddingTop: 5
        paddingBottom: 5
        paddingLeft: 20
        paddingRight: 20
        marginTop: 1.4
        marginBottom: 10
    letter:
      style:
        fontFamily: Caladea
        fontStyle: normal
        fontSize: 11.2
        lineHeight: 1.5
        textAlign: left
        color: "#252525"
        backgroundColor: "#ffffff"
        borderWidth: 0
        borderColor: "#cfcbc2"
        paddingTop: 7
        paddingBottom: 7
        paddingLeft: 10
        paddingRight: 10
        marginTop: 0
        marginBottom: 10
    marginalia:
      style:
        fontFamily: Caladea
        fontStyle: italic
        fontSize: 10.6
        lineHeight: 1.45
        textAlign: left
        color: "#3a3732"
        backgroundColor: "#ffffff"
        borderWidth: 0
        borderLeftWidth: 0
        borderLeftColor: "#b1a795"
        paddingTop: 5
        paddingBottom: 5
        paddingLeft: 10
        paddingRight: 6
        marginTop: 0
        marginBottom: 8
`;

export const DEFAULT_LITERATURE_THEME_YAML = `
layout:
  fontFamily: Caladea
  fontSize: 10.6
  lineHeight: 1.52
  pageSize:
    width: 396
    height: 612
  margins:
    top: 64
    right: 54
    bottom: 62
    left: 54
  hyphenation: soft
  justifyEngine: advanced
  justifyStrategy: auto

footer:
  default:
    elements:
      - type: paragraph
        content: "{pageNumber}"
        properties:
          style:
            textAlign: center
            fontSize: 9
            color: "#666666"
            fontFamily: Caladea
            marginTop: 31

styles:
  paragraph:
    textAlign: left
    marginBottom: 8.6
    hyphenation: "off"
    justifyEngine: legacy
  heading-1:
    fontSize: 20.8
    marginTop: 9.4
    marginBottom: 9
    hyphenation: "off"
    textAlign: left
  heading-2:
    fontSize: 16.2
    marginTop: 5.4
    marginBottom: 7
    hyphenation: "off"
    textAlign: left
  heading-3:
    fontSize: 13.9
    marginTop: 5.4
    marginBottom: 6
    hyphenation: "off"
    textAlign: left
  inline-code:
    fontFamily: Caladea
    fontStyle: italic
    fontSize: 11
    backgroundColor: "#ffffff"
  blockquote:
    textAlign: left
    fontStyle: italic
    fontSize: 10.4
    lineHeight: 1.45
    color: "#2b2a28"
    paddingLeft: 18
    paddingRight: 8
    borderLeftWidth: 0
    marginTop: 0
    marginBottom: 9
  blockquote-attribution:
    textAlign: right
    fontStyle: normal
    fontSize: 9.8
    color: "#47443f"
    marginTop: 2
    marginBottom: 7
  references-heading:
    hyphenation: "off"
    textAlign: left
    fontSize: 12.4
    marginTop: 3.4
    marginBottom: 5
  references-item:
    textAlign: left
    hyphenation: "off"
    lineHeight: 1.3
    fontSize: 9.8
    marginBottom: 3
    paddingLeft: 12
    textIndent: -12
  list-item-ordered-0:
    textAlign: left
    hyphenation: "off"
    justifyEngine: legacy
    marginBottom: 3.6
  list-item-ordered-1:
    textAlign: left
    hyphenation: "off"
    justifyEngine: legacy
    marginBottom: 3.2
  list-item-unordered-0:
    textAlign: left
    hyphenation: "off"
    justifyEngine: legacy
    marginBottom: 3.6
  list-item-unordered-1:
    textAlign: left
    hyphenation: "off"
    justifyEngine: legacy
    marginBottom: 3.2
  definition-term:
    fontStyle: italic
    fontWeight: 700
    keepWithNext: true
    marginTop: 0
    marginBottom: 1.2
  definition-desc:
    paddingLeft: 14
    marginTop: 0
    marginBottom: 5.4
  table-cell:
    paddingTop: 4
    paddingBottom: 4
    paddingLeft: 5
    paddingRight: 5
    borderWidth: 0.6
    borderColor: "#111111"
`;

export type LiteratureTransmuteOptions = TransmuterOptions & {
  resolveImage?: (src: string) => ResolvedImage | null;
};

export function transmute(markdown: string, options?: LiteratureTransmuteOptions): DocumentInput {
  return transmuteMarkdown(markdown, {
    theme: options?.theme ?? DEFAULT_LITERATURE_THEME_YAML,
    config: options?.config,
    baseConfig: DEFAULT_LITERATURE_CONFIG_YAML,
    resolveImage: options?.resolveImage
  });
}

export type LiteratureTransmuter = Transmuter<string, DocumentInput, LiteratureTransmuteOptions>;

export const transmuter: LiteratureTransmuter = {
  transmute,
  getBoilerplate() {
    return [
      '# Literature Settings',
      '# literature:',
      '#   dropCap:',
      '#     enabled: true',
      '#     lines: 3',
      '#',
      '# typography:',
      '#   smartQuotes: true'
    ].join('\n');
  }
};
