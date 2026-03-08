var MkdToAstPipeline=(()=>{var l=Object.defineProperty;var s=Object.getOwnPropertyDescriptor;var u=Object.getOwnPropertyNames;var y=Object.prototype.hasOwnProperty;var b=(e,t)=>{for(var n in t)l(e,n,{get:t[n],enumerable:!0})},S=(e,t,n,i)=>{if(t&&typeof t=="object"||typeof t=="function")for(let o of u(t))!y.call(e,o)&&o!==n&&l(e,o,{get:()=>t[o],enumerable:!(i=s(t,o))||i.enumerable});return e};var T=e=>S(l({},"__esModule",{value:!0}),e);var A={};b(A,{SAMPLE_MARKDOWN:()=>m,THEME_NAMES:()=>g,pipeline:()=>B,runTransmute:()=>p});var f=`layout:\r
  fontFamily: Caladea\r
  fontSize: 11.8\r
  lineHeight: 1.5\r
  pageSize:\r
    width: 432\r
    height: 648\r
  margins:\r
    top: 72\r
    right: 64\r
    bottom: 68\r
    left: 64\r
  hyphenation: auto\r
  justifyEngine: advanced\r
  justifyStrategy: auto\r
\r
footer:\r
  default:\r
    elements:\r
      - type: paragraph\r
        content: "\\u2014 {pageNumber} \\u2014"\r
        properties:\r
          style:\r
            textAlign: center\r
            fontSize: 9\r
            color: "#8a7d6e"\r
            fontFamily: Caladea\r
            marginTop: 31\r
\r
styles:\r
  heading-1:\r
    fontSize: 22\r
    lineHeight: 1.25\r
    textAlign: center\r
    fontStyle: italic\r
    hyphenation: "off"\r
    marginTop: 54\r
    marginBottom: 34\r
    letterSpacing: 0.4\r
    keepWithNext: true\r
  heading-2:\r
    fontSize: 10.4\r
    lineHeight: 1.3\r
    textAlign: center\r
    fontWeight: 400\r
    hyphenation: "off"\r
    letterSpacing: 2.4\r
    marginTop: 22\r
    marginBottom: 18\r
    keepWithNext: true\r
  heading-3:\r
    fontSize: 11.8\r
    fontStyle: italic\r
    textAlign: left\r
    hyphenation: "off"\r
    marginTop: 12\r
    marginBottom: 6\r
    keepWithNext: true\r
  paragraph:\r
    textAlign: justify\r
    hyphenation: auto\r
    lineHeight: 1.5\r
    textIndent: 18\r
    marginBottom: 0\r
  inline-code:\r
    fontFamily: Caladea\r
    fontStyle: italic\r
    color: "#2a2218"\r
    backgroundColor: "#ffffff"\r
  code-block:\r
    fontFamily: Cousine\r
    fontSize: 9.6\r
    lineHeight: 1.42\r
    color: "#2a2218"\r
    backgroundColor: "#f8f5ef"\r
    borderWidth: 0\r
    borderRadius: 0\r
    paddingTop: 10\r
    paddingBottom: 10\r
    paddingLeft: 14\r
    paddingRight: 14\r
    marginTop: 10\r
    marginBottom: 10\r
  blockquote:\r
    textAlign: left\r
    hyphenation: "off"\r
    fontStyle: italic\r
    fontSize: 11\r
    lineHeight: 1.52\r
    color: "#2e2618"\r
    paddingLeft: 30\r
    paddingRight: 30\r
    borderLeftWidth: 0\r
    marginTop: 12\r
    marginBottom: 12\r
  blockquote-attribution:\r
    textAlign: right\r
    fontStyle: normal\r
    fontSize: 9.4\r
    color: "#7a6e5e"\r
    marginTop: 3\r
    marginBottom: 10\r
  thematic-break:\r
    width: 48\r
    marginLeft: 128\r
    borderTopWidth: 0.5\r
    borderTopColor: "#c0b09a"\r
    marginTop: 18\r
    marginBottom: 18\r
  citation-marker:\r
    fontSize: 8\r
    color: "#6a5e4e"\r
  footnote-marker:\r
    fontSize: 8\r
    baselineShift: 3\r
  footnotes-heading:\r
    fontSize: 10.4\r
    hyphenation: "off"\r
    marginTop: 12\r
    marginBottom: 6\r
  footnotes-item:\r
    textAlign: left\r
    hyphenation: "off"\r
    fontSize: 9.4\r
    lineHeight: 1.4\r
    paddingLeft: 12\r
    textIndent: -12\r
    marginBottom: 3.6\r
  references-heading:\r
    fontSize: 10.4\r
    hyphenation: "off"\r
    marginTop: 10\r
    marginBottom: 6\r
  references-item:\r
    textAlign: left\r
    hyphenation: "off"\r
    fontSize: 9.4\r
    lineHeight: 1.4\r
    paddingLeft: 12\r
    textIndent: -12\r
    marginBottom: 3.6\r
  definition-term:\r
    fontStyle: italic\r
    fontWeight: 700\r
    color: "#2a2218"\r
    keepWithNext: true\r
    marginTop: 0\r
    marginBottom: 1.4\r
  definition-desc:\r
    paddingLeft: 16\r
    marginBottom: 7\r
  table-cell:\r
    paddingTop: 5\r
    paddingBottom: 5\r
    paddingLeft: 6\r
    paddingRight: 6\r
    borderWidth: 0.45\r
    borderColor: "#b0a08a"\r
`;var d=`layout:\r
  fontFamily: Carlito\r
  fontSize: 11.1\r
  lineHeight: 1.68\r
  pageSize: A4\r
  margins:\r
    top: 84\r
    right: 76\r
    bottom: 86\r
    left: 76\r
  hyphenation: soft\r
  justifyEngine: advanced\r
  justifyStrategy: auto\r
\r
styles:\r
  heading-1:\r
    fontFamily: Caladea\r
    fontSize: 27\r
    lineHeight: 1.2\r
    color: "#101622"\r
    marginTop: 26.2\r
    marginBottom: 22\r
    hyphenation: "off"\r
    textAlign: center\r
    keepWithNext: true\r
  subheading:\r
    fontFamily: Carlito\r
    fontSize: 10.2\r
    lineHeight: 1.36\r
    color: "#6f7785"\r
    letterSpacing: 0.9\r
    textAlign: center\r
    marginTop: -8\r
    marginBottom: 28\r
    keepWithNext: true\r
  heading-2:\r
    fontFamily: Carlito\r
    fontSize: 12\r
    fontWeight: 700\r
    color: "#2f3d52"\r
    marginTop: 18.2\r
    marginBottom: 12\r
    hyphenation: "off"\r
    textAlign: left\r
  heading-3:\r
    fontFamily: Carlito\r
    fontSize: 10.8\r
    fontWeight: 700\r
    color: "#506079"\r
    marginTop: 8.2\r
    marginBottom: 8\r
    hyphenation: "off"\r
    textAlign: left\r
  paragraph:\r
    textAlign: left\r
    hyphenation: soft\r
    lineHeight: 1.7\r
    marginBottom: 11.8\r
  footnotes-heading:\r
    fontFamily: Carlito\r
  footnotes-item:\r
    fontFamily: Carlito\r
  references-heading:\r
    fontFamily: Carlito\r
  references-item:\r
    fontFamily: Carlito\r
  inline-code:\r
    fontFamily: Cousine\r
    fontSize: 9.6\r
    color: "#1f3550"\r
    backgroundColor: "#f0f3f8"\r
    borderRadius: 2\r
  code-block:\r
    fontFamily: Cousine\r
    fontSize: 9.7\r
    lineHeight: 1.36\r
    allowLineSplit: true\r
    overflowPolicy: clip\r
    color: "#1f2937"\r
    backgroundColor: "#f8fafc"\r
    borderWidth: 0.8\r
    borderColor: "#d7deea"\r
    borderRadius: 4\r
    paddingTop: 8\r
    paddingBottom: 8\r
    paddingLeft: 11\r
    paddingRight: 11\r
    marginTop: 0\r
    marginBottom: 14\r
  blockquote:\r
    textAlign: left\r
    hyphenation: "off"\r
    fontFamily: Caladea\r
    fontStyle: italic\r
    fontSize: 12\r
    lineHeight: 1.56\r
    color: "#2a3344"\r
    paddingLeft: 18\r
    paddingRight: 18\r
    borderLeftWidth: 0\r
    backgroundColor: "#ffffff"\r
    marginTop: 2.2\r
    marginBottom: 16\r
  blockquote-attribution:\r
    textAlign: right\r
    fontStyle: normal\r
    fontFamily: Carlito\r
    fontSize: 9.8\r
    color: "#677185"\r
    marginTop: 3\r
    marginBottom: 10\r
  thematic-break:\r
    width: 132\r
    marginLeft: 0\r
    borderTopWidth: 0.45\r
    borderTopColor: "#aeb9ca"\r
    opacity: 0.9\r
    marginTop: 16.2\r
    marginBottom: 24\r
  definition-term:\r
    fontWeight: 700\r
    color: "#2f3d52"\r
    keepWithNext: true\r
    marginTop: 0\r
    marginBottom: 2\r
  definition-desc:\r
    paddingLeft: 14\r
    marginBottom: 8\r
  table-cell:\r
    fontFamily: Carlito\r
    paddingTop: 5\r
    paddingBottom: 5\r
    paddingLeft: 6\r
    paddingRight: 6\r
    borderWidth: 0.6\r
    borderColor: "#bfc9d8"\r
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
