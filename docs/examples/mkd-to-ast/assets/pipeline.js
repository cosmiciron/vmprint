var MkdToAstPipeline=(()=>{var s=Object.defineProperty;var m=Object.getOwnPropertyDescriptor;var p=Object.getOwnPropertyNames;var g=Object.prototype.hasOwnProperty;var h=(t,e)=>{for(var n in e)s(t,n,{get:e[n],enumerable:!0})},y=(t,e,n,o)=>{if(e&&typeof e=="object"||typeof e=="function")for(let r of p(e))!g.call(t,r)&&r!==n&&s(t,r,{get:()=>e[r],enumerable:!(o=m(e,r))||o.enumerable});return t};var f=t=>y(s({},"__esModule",{value:!0}),t);var M={};h(M,{SAMPLE_MARKDOWN:()=>i,THEME_NAMES:()=>u,pipeline:()=>w,runTransmute:()=>l});var i=`# Getting Started with VMPrint

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
`,u=["default","opensource","novel"];function l(t,e){let n=window.VMPrintTransmuter,o=n.themes[e]??n.themes.default,r=performance.now(),a=n.transmute(t,{theme:o}),c=performance.now()-r,d=Array.isArray(a.elements)?a.elements.length:0;return{json:JSON.stringify(a,null,2),elementCount:d,ms:c}}var w={SAMPLE_MARKDOWN:i,THEME_NAMES:u,runTransmute:l};return f(M);})();
