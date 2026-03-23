# VMPrint Authoring Guide

This directory is the practical guide to authoring VMPrint documents with AST `1.1`.

Use it in this order:

1. [01-your-first-document](01-your-first-document.html)
2. [02-styles-and-text](02-styles-and-text.html)
3. [03-stories-strips-and-zones](03-stories-strips-and-zones.html)
4. [04-headers-footers-and-page-control](04-headers-footers-and-page-control.html)
5. [05-images-tables-and-overlays](05-images-tables-and-overlays.html)
6. [06-scripting](06-scripting.html)

How this guide differs from the reference:

- [AST Reference](../reference/ast.html) is the contract
- this guide is the teaching path
- the examples here prefer AST `1.1`

Design stance:

- the AST is the one public source format
- the engine normalizes it internally
- authoring should stay familiar where that helps
- authoring should resist fake DOM hierarchy where it hides the real spatial model

If you only want one takeaway before diving in:

- use normal flow for ordinary content
- use `story` for linked multi-column flow
- use `strip` for one-row aligned bands
- use `zone-map` for independent regions, including offset rectangular region fields

One more important note:

- authors work with `story`, `strip`, `zone-map`, and the rest of the AST
- the engine may think in terms of a larger continuous world underneath
- you do not need to author a raw `world-map` directly
