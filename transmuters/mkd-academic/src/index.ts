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

export const DEFAULT_ACADEMIC_CONFIG_YAML = `
list:
  textIndentPerLevel: 16
  markerGap: 5
  itemSpacingAfter: 3.2
  tightItemSpacingAfter: 0.9
  continuationIndentLevels: 0
  unorderedMarkers:
    - "\u2022"
    - "\u25E6"
    - "\u25AA"
  orderedMarkers:
    - decimal
    - lower-alpha
    - lower-roman
    - upper-alpha
  taskMarkers:
    checked: "[x]"
    unchecked: "[ ]"

links:
  mode: citation
  dedupe: true
  citationStyle: bracket

references:
  enabled: true
  heading: References
  numberingStyle: decimal
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
    marginTop: 0
    marginBottom: 8
    borderWidth: 0.6
    borderColor: "#6f6f6f"
    borderRadius: 0
  frame:
    mode: "off"
    markerPattern: '\b(frame|framed)\b'
    style: {}

captions:
  pattern: '^(Figure|Fig\.|Table|Plate|Source)\s+([0-9]+|[IVXLC]+)\b'
  blockquoteUnderImageAsFigureCaption: false
  style:
    textAlign: left
    hyphenation: "off"
    fontStyle: normal
    fontSize: 10
    lineHeight: 1.3
    color: "#242424"
    marginTop: 0
    marginBottom: 11

tables:
  zebra: false
  headerColor: "#f3f4f6"

codeBlocks:
  defaultMode: listing
  languageModes:
    text: listing
    pseudocode: listing
    theorem: theorem
    lemma: lemma
    proposition: proposition
    corollary: corollary
    proof: proof
    remark: remark
    example: example
  modes:
    listing:
      style:
        fontFamily: Cousine
        fontSize: 9.6
        lineHeight: 1.28
        backgroundColor: "#ffffff"
        borderWidth: 0
        borderColor: "#9a9a9a"
        borderRadius: 0
        paddingTop: 5
        paddingBottom: 5
        paddingLeft: 7
        paddingRight: 7
        marginTop: 0
        marginBottom: 8
    theorem:
      style:
        fontFamily: Caladea
        fontStyle: italic
        fontSize: 10.8
        lineHeight: 1.44
        textAlign: left
        color: "#1f1f1f"
        backgroundColor: "#ffffff"
        borderWidth: 0
        borderLeftWidth: 0
        borderLeftColor: "#6f6f6f"
        paddingTop: 6
        paddingBottom: 6
        paddingLeft: 12
        paddingRight: 6
        marginTop: 0
        marginBottom: 8
    lemma:
      style:
        fontFamily: Caladea
        fontStyle: italic
        fontSize: 10.8
        lineHeight: 1.44
        textAlign: left
        color: "#1f1f1f"
        backgroundColor: "#ffffff"
        borderWidth: 0
        borderLeftWidth: 0
        borderLeftColor: "#7b7b7b"
        paddingTop: 6
        paddingBottom: 6
        paddingLeft: 12
        paddingRight: 6
        marginTop: 0
        marginBottom: 8
    proposition:
      style:
        fontFamily: Caladea
        fontStyle: italic
        fontSize: 10.8
        lineHeight: 1.44
        textAlign: left
        color: "#1f1f1f"
        backgroundColor: "#ffffff"
        borderWidth: 0
        borderLeftWidth: 0
        borderLeftColor: "#555555"
        paddingTop: 6
        paddingBottom: 6
        paddingLeft: 12
        paddingRight: 6
        marginTop: 0
        marginBottom: 8
    corollary:
      style:
        fontFamily: Caladea
        fontStyle: italic
        fontSize: 10.8
        lineHeight: 1.44
        textAlign: left
        color: "#1f1f1f"
        backgroundColor: "#ffffff"
        borderWidth: 0
        borderLeftWidth: 0
        borderLeftColor: "#8a8a8a"
        paddingTop: 6
        paddingBottom: 6
        paddingLeft: 12
        paddingRight: 6
        marginTop: 0
        marginBottom: 8
    proof:
      style:
        fontFamily: Caladea
        fontStyle: normal
        fontSize: 10.7
        lineHeight: 1.45
        textAlign: left
        color: "#1d1d1d"
        backgroundColor: "#ffffff"
        borderWidth: 0
        borderLeftWidth: 0
        borderLeftColor: "#8b8b8b"
        paddingTop: 6
        paddingBottom: 6
        paddingLeft: 10
        paddingRight: 6
        marginTop: 0
        marginBottom: 8
    remark:
      style:
        fontFamily: Caladea
        fontStyle: normal
        fontSize: 10.6
        lineHeight: 1.44
        textAlign: left
        color: "#222222"
        backgroundColor: "#ffffff"
        borderWidth: 0
        borderLeftWidth: 0
        borderLeftColor: "#9a9a9a"
        paddingTop: 6
        paddingBottom: 6
        paddingLeft: 10
        paddingRight: 6
        marginTop: 0
        marginBottom: 8
    example:
      style:
        fontFamily: Caladea
        fontStyle: normal
        fontSize: 10.7
        lineHeight: 1.45
        textAlign: left
        color: "#1f1f1f"
        backgroundColor: "#ffffff"
        borderWidth: 0
        borderLeftWidth: 0
        borderLeftColor: "#8b857a"
        paddingTop: 6
        paddingBottom: 6
        paddingLeft: 10
        paddingRight: 6
        marginTop: 0
        marginBottom: 8
`;

export const DEFAULT_ACADEMIC_THEME_YAML = `
layout:
  fontFamily: Caladea
  fontSize: 10.8
  lineHeight: 1.5
  pageSize: LETTER
  margins:
    top: 72
    right: 72
    bottom: 72
    left: 72
  hyphenation: auto
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
            color: "#4f4f4f"
            fontFamily: Caladea
            marginTop: 31

styles:
  # -- Body text --------------------------------------------------------------
  paragraph:
    textAlign: left
    marginBottom: 8

  # -- Headings ---------------------------------------------------------------
  # H1 = document title only; no top margin needed (sits at page top).
  heading-1:
    fontSize: 20
    lineHeight: 1.15
    fontWeight: 700
    hyphenation: "off"
    textAlign: left
    marginTop: 0
    marginBottom: 18

  # H2 = numbered section headings (Abstract, 1. Background, …).
  # 14pt bold is the accepted weight for single-column academic papers
  # at 10–11pt body size (IEEE, APA, Chicago A-level heading).
  heading-2:
    fontSize: 14
    lineHeight: 1.25
    fontWeight: 700
    hyphenation: "off"
    textAlign: left
    marginTop: 18
    marginBottom: 8

  # H3 = subsection headings — bold italic per Chicago/APA convention.
  heading-3:
    fontSize: 12
    lineHeight: 1.3
    fontWeight: 700
    fontStyle: italic
    hyphenation: "off"
    textAlign: left
    marginTop: 10
    marginBottom: 5

  # -- Structural elements ----------------------------------------------------
  thematic-break:
    borderTopWidth: 0.6
    borderTopColor: "#4a4a4a"
    marginTop: 6
    marginBottom: 14

  citation-marker:
    fontSize: 8.2
    color: "#1a1a1a"

  code-block:
    fontFamily: Cousine
    fontSize: 9.6
    lineHeight: 1.28
    backgroundColor: "#ffffff"
    borderWidth: 0
    borderColor: "#9a9a9a"
    borderRadius: 0
    paddingTop: 5
    paddingBottom: 5
    paddingLeft: 7
    paddingRight: 7
    marginTop: 0
    marginBottom: 8
  inline-code:
    fontFamily: Cousine
    fontSize: 9.6
    backgroundColor: "#ffffff"
  blockquote:
    textAlign: left
    fontStyle: normal
    fontSize: 10.6
    lineHeight: 1.45
    color: "#202020"
    paddingLeft: 18
    paddingRight: 18
    borderLeftWidth: 0
    marginTop: 0
    marginBottom: 9
  blockquote-attribution:
    textAlign: right
    fontStyle: italic
    fontSize: 10.2
    color: "#3f3f3f"
    marginTop: 2
    marginBottom: 7
  references-heading:
    hyphenation: "off"
    textAlign: left
    fontSize: 14
    fontWeight: 700
    lineHeight: 1.25
    marginTop: 18
    marginBottom: 8
  references-item:
    textAlign: left
    hyphenation: "off"
    fontSize: 10.4
    lineHeight: 1.42
    paddingLeft: 14
    textIndent: -14
    marginBottom: 4
  definition-term:
    fontWeight: 700
    keepWithNext: true
    marginTop: 0
    marginBottom: 1.5
  definition-desc:
    paddingLeft: 14
    marginTop: 0
    marginBottom: 7
  table-cell:
    paddingTop: 4
    paddingBottom: 4
    paddingLeft: 5
    paddingRight: 5
    borderWidth: 0.6
    borderColor: "#111111"
`;

export type AcademicTransmuteOptions = TransmuterOptions & {
  resolveImage?: (src: string) => ResolvedImage | null;
};

export function transmute(markdown: string, options?: AcademicTransmuteOptions): DocumentInput {
  return transmuteMarkdown(markdown, {
    theme: options?.theme ?? DEFAULT_ACADEMIC_THEME_YAML,
    config: options?.config,
    baseConfig: DEFAULT_ACADEMIC_CONFIG_YAML,
    resolveImage: options?.resolveImage
  });
}

export type AcademicTransmuter = Transmuter<string, DocumentInput, AcademicTransmuteOptions>;

export const transmuter: AcademicTransmuter = {
  transmute
};