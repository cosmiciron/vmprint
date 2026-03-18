# VMPrint Authoring Guide

This directory is the practical guide to authoring VMPrint documents with AST `1.1`.

Use it in this order:

1. [01-your-first-document.md](c:\Users\cosmic\Projects\vmprint\documents\authoring\01-your-first-document.md)
2. [02-styles-and-text.md](c:\Users\cosmic\Projects\vmprint\documents\authoring\02-styles-and-text.md)
3. [03-stories-strips-and-zones.md](c:\Users\cosmic\Projects\vmprint\documents\authoring\03-stories-strips-and-zones.md)
4. [04-headers-footers-and-page-control.md](c:\Users\cosmic\Projects\vmprint\documents\authoring\04-headers-footers-and-page-control.md)
5. [05-images-tables-and-overlays.md](c:\Users\cosmic\Projects\vmprint\documents\authoring\05-images-tables-and-overlays.md)

How this guide differs from the reference:

- [AST-REFERENCE.md](c:\Users\cosmic\Projects\vmprint\documents\AST-REFERENCE.md) is the contract
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
