# pressrun

**This is the hello-world bootstrap, not a product.**

It exists to show the smallest practical `@vmprint/engine` integration. If you want to understand how to wire the engine into your own project, read [`src/index.ts`](src/index.ts). It is one annotated file with no extra framework or packaging ceremony.

## Usage

```
pressrun <document.json> [output.pdf]
```

Reads a VMPrint JSON document and writes a PDF. If no output path is given, the PDF is written next to the input file.

## What it uses

| Role | Package |
|------|---------|
| Layout engine | `@vmprint/engine` |
| Font manager | `@vmprint/local-fonts` |
| PDF output | `@vmprint/context-pdf` |

`@vmprint/local-fonts` ships a bundled multilingual font collection and can also load fonts from HTTP/HTTPS URLs and data URIs. For browser-first font loading with IndexedDB caching and progress tracking, use `@vmprint/web-fonts`. For zero-embedded standard PDF fonts, use `@vmprint/standard-fonts`.

`@vmprint/context-pdf` is backed by PDFKit and streams output to a Node.js writable stream. For a browser-compatible alternative, `@vmprint/context-pdf-lite` implements the same contract.

## The integration pattern

```
document JSON
    -> loadDocument()   parse and validate
    -> VMPrintEngine    wire document + font manager
    -> engine.render()  layout and render in one call
    -> PDF
```

The font manager and context are the two plug points. Everything else is the engine doing the heavy lifting.
