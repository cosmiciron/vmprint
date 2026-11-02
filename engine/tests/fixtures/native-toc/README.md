# Native TOC fixtures

Credit to **Gavin Morgan ([gavmor](https://github.com/gavmor))** for finding and
reporting the native TOC discovery and missing-heading bugs and supplying the
original reproduction below.

- `gavin-20-root-headings.json` is Gavin Morgan's original reproduction from
  [gavmor/vmprint at c2807b6d0c91ad5bbacfd41a27182c3b6eed04b1](https://github.com/gavmor/vmprint/blob/c2807b6d0c91ad5bbacfd41a27182c3b6eed04b1/engine/tests/fixtures/regression/77-toc-many-root-headings.json).
  Its document data is preserved: LETTER pages, 50-unit margins, native TOC,
  20 root-level h2 headings (`h0` through `h19`), keep-with-next enabled, and
  line-splittable paragraphs. It is tested with default runtime settings.
- `20-root-headings.json` is the earlier synthetic reconstruction of the report,
  retained as an independent stress case. It is not Gavin's original input.

`engine/tests/native-toc.spec.ts` checks both inputs using the public
`loadDocument` → `VMPrintEngine` → `layout()` API. Gavin's case must contain all
20 entries exactly once and each reference must match the final rendered page.
The test also exercises the runnable book in `docs/examples/native-toc/`.

- `long-split-heading.json` preserves the follow-up reproduction supplied after
  the original repair: a keep-with-next chapter precedes a long, splittable
  section heading. The initial layout splits the section tail. The regression
  requires the full title in chapter/section reading order, correct final page
  references, and deterministic completion with the default settlement budget.
