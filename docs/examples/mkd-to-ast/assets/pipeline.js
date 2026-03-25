var MkdToAstPipeline=(()=>{var l=Object.defineProperty;var s=Object.getOwnPropertyDescriptor;var u=Object.getOwnPropertyNames;var y=Object.prototype.hasOwnProperty;var b=(e,t)=>{for(var n in t)l(e,n,{get:t[n],enumerable:!0})},S=(e,t,n,i)=>{if(t&&typeof t=="object"||typeof t=="function")for(let o of u(t))!y.call(e,o)&&o!==n&&l(e,o,{get:()=>t[o],enumerable:!(i=s(t,o))||i.enumerable});return e};var T=e=>S(l({},"__esModule",{value:!0}),e);var A={};b(A,{SAMPLE_MARKDOWN:()=>m,THEME_NAMES:()=>g,pipeline:()=>B,runTransmute:()=>p});var f=`layout:
  fontFamily: Caladea
  fontSize: 11.8
  lineHeight: 1.5
  pageSize:
    width: 432
    height: 648
  margins:
    top: 72
    right: 64
    bottom: 68
    left: 64
  hyphenation: auto
  justifyEngine: advanced
  justifyStrategy: auto

footer:
  default:
    elements:
      - type: paragraph
        content: "\\u2014 {pageNumber} \\u2014"
        properties:
          style:
            textAlign: center
            fontSize: 9
            color: "#8a7d6e"
            fontFamily: Caladea
            marginTop: 31

styles:
  heading-1:
    fontSize: 22
    lineHeight: 1.25
    textAlign: center
    fontStyle: italic
    hyphenation: "off"
    marginTop: 54
    marginBottom: 34
    letterSpacing: 0.4
    keepWithNext: true
  heading-2:
    fontSize: 10.4
    lineHeight: 1.3
    textAlign: center
    fontWeight: 400
    hyphenation: "off"
    letterSpacing: 2.4
    marginTop: 22
    marginBottom: 18
    keepWithNext: true
  heading-3:
    fontSize: 11.8
    fontStyle: italic
    textAlign: left
    hyphenation: "off"
    marginTop: 12
    marginBottom: 6
    keepWithNext: true
  paragraph:
    textAlign: justify
    hyphenation: auto
    lineHeight: 1.5
    textIndent: 18
    marginBottom: 0
  inline-code:
    fontFamily: Caladea
    fontStyle: italic
    color: "#2a2218"
    backgroundColor: "#ffffff"
  code-block:
    fontFamily: Cousine
    fontSize: 9.6
    lineHeight: 1.42
    color: "#2a2218"
    backgroundColor: "#f8f5ef"
    borderWidth: 0
    borderRadius: 0
    paddingTop: 10
    paddingBottom: 10
    paddingLeft: 14
    paddingRight: 14
    marginTop: 10
    marginBottom: 10
  blockquote:
    textAlign: left
    hyphenation: "off"
    fontStyle: italic
    fontSize: 11
    lineHeight: 1.52
    color: "#2e2618"
    paddingLeft: 30
    paddingRight: 30
    borderLeftWidth: 0
    marginTop: 12
    marginBottom: 12
  blockquote-attribution:
    textAlign: right
    fontStyle: normal
    fontSize: 9.4
    color: "#7a6e5e"
    marginTop: 3
    marginBottom: 10
  thematic-break:
    width: 48
    marginLeft: 128
    borderTopWidth: 0.5
    borderTopColor: "#c0b09a"
    marginTop: 18
    marginBottom: 18
  citation-marker:
    fontSize: 8
    color: "#6a5e4e"
  footnote-marker:
    fontSize: 8
    baselineShift: 3
  footnotes-heading:
    fontSize: 10.4
    hyphenation: "off"
    marginTop: 12
    marginBottom: 6
  footnotes-item:
    textAlign: left
    hyphenation: "off"
    fontSize: 9.4
    lineHeight: 1.4
    paddingLeft: 12
    textIndent: -12
    marginBottom: 3.6
  references-heading:
    fontSize: 10.4
    hyphenation: "off"
    marginTop: 10
    marginBottom: 6
  references-item:
    textAlign: left
    hyphenation: "off"
    fontSize: 9.4
    lineHeight: 1.4
    paddingLeft: 12
    textIndent: -12
    marginBottom: 3.6
  definition-term:
    fontStyle: italic
    fontWeight: 700
    color: "#2a2218"
    keepWithNext: true
    marginTop: 0
    marginBottom: 1.4
  definition-desc:
    paddingLeft: 16
    marginBottom: 7
  table-cell:
    paddingTop: 5
    paddingBottom: 5
    paddingLeft: 6
    paddingRight: 6
    borderWidth: 0.45
    borderColor: "#b0a08a"
`;var d=`layout:
  fontFamily: Carlito
  fontSize: 11.1
  lineHeight: 1.68
  pageSize: A4
  margins:
    top: 84
    right: 76
    bottom: 86
    left: 76
  hyphenation: soft
  justifyEngine: advanced
  justifyStrategy: auto

styles:
  heading-1:
    fontFamily: Caladea
    fontSize: 27
    lineHeight: 1.2
    color: "#101622"
    marginTop: 26.2
    marginBottom: 22
    hyphenation: "off"
    textAlign: center
    keepWithNext: true
  subheading:
    fontFamily: Carlito
    fontSize: 10.2
    lineHeight: 1.36
    color: "#6f7785"
    letterSpacing: 0.9
    textAlign: center
    marginTop: -8
    marginBottom: 28
    keepWithNext: true
  heading-2:
    fontFamily: Carlito
    fontSize: 12
    fontWeight: 700
    color: "#2f3d52"
    marginTop: 18.2
    marginBottom: 12
    hyphenation: "off"
    textAlign: left
  heading-3:
    fontFamily: Carlito
    fontSize: 10.8
    fontWeight: 700
    color: "#506079"
    marginTop: 8.2
    marginBottom: 8
    hyphenation: "off"
    textAlign: left
  paragraph:
    textAlign: left
    hyphenation: soft
    lineHeight: 1.7
    marginBottom: 11.8
  footnotes-heading:
    fontFamily: Carlito
  footnotes-item:
    fontFamily: Carlito
  references-heading:
    fontFamily: Carlito
  references-item:
    fontFamily: Carlito
  inline-code:
    fontFamily: Cousine
    fontSize: 9.6
    color: "#1f3550"
    backgroundColor: "#f0f3f8"
    borderRadius: 2
  code-block:
    fontFamily: Cousine
    fontSize: 9.7
    lineHeight: 1.36
    allowLineSplit: true
    overflowPolicy: clip
    color: "#1f2937"
    backgroundColor: "#f8fafc"
    borderWidth: 0.8
    borderColor: "#d7deea"
    borderRadius: 4
    paddingTop: 8
    paddingBottom: 8
    paddingLeft: 11
    paddingRight: 11
    marginTop: 0
    marginBottom: 14
  blockquote:
    textAlign: left
    hyphenation: "off"
    fontFamily: Caladea
    fontStyle: italic
    fontSize: 12
    lineHeight: 1.56
    color: "#2a3344"
    paddingLeft: 18
    paddingRight: 18
    borderLeftWidth: 0
    backgroundColor: "#ffffff"
    marginTop: 2.2
    marginBottom: 16
  blockquote-attribution:
    textAlign: right
    fontStyle: normal
    fontFamily: Carlito
    fontSize: 9.8
    color: "#677185"
    marginTop: 3
    marginBottom: 10
  thematic-break:
    width: 132
    marginLeft: 0
    borderTopWidth: 0.45
    borderTopColor: "#aeb9ca"
    opacity: 0.9
    marginTop: 16.2
    marginBottom: 24
  definition-term:
    fontWeight: 700
    color: "#2f3d52"
    keepWithNext: true
    marginTop: 0
    marginBottom: 2
  definition-desc:
    paddingLeft: 14
    marginBottom: 8
  table-cell:
    fontFamily: Carlito
    paddingTop: 5
    paddingBottom: 5
    paddingLeft: 6
    paddingRight: 6
    borderWidth: 0.6
    borderColor: "#bfc9d8"
`;var C=void 0,a={default:C,opensource:d,novel:f},g=Object.keys(a);var m=`# Getting Started with VMPrint

VMPrint is a **deterministic** document layout engine. You write Markdown, and it produces
a bit-perfect document \u2014 identical on every run.

## Core Concepts

The pipeline has three stages:

1. **Source** \u2014 Markdown with optional YAML frontmatter
2. **IR** \u2014 \`DocumentInput\`: a typed JSON structure the engine understands
3. **Output** \u2014 Paginated PDF via the layout engine

## Syntax Support

Tables are flattened into typed element trees:

| Element      | Role in AST                   |
|--------------|-------------------------------|
| Heading      | \`heading-1\` \u2026 \`heading-6\` |
| Paragraph    | \`paragraph\`                 |
| Code fence   | \`code-block\`                |
| Blockquote   | \`blockquote\`                |

Blockquotes and attributions are first-class:

> VMPrint is designed around a single invariant: given the same input, you always get the same output.
> \u2014 Design Notes

---

Links become citation markers in the AST.[^1]

[^1]: Footnotes are collected and emitted as a numbered list at document end.
`;function p(e,t){let n=window.VMPrintTransmuter,i=a[t]??a.default,o=performance.now(),r=n.transmute(e,{theme:i}),h=performance.now()-o,c=Array.isArray(r.elements)?r.elements.length:0;return{json:JSON.stringify(r,null,2),elementCount:c,ms:h}}var B={SAMPLE_MARKDOWN:m,THEME_NAMES:g,runTransmute:p};return T(A);})();
