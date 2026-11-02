# Native table of contents for a book

Thanks to **Gavin Morgan ([gavmor](https://github.com/gavmor))** for finding and
reporting the native TOC bugs and providing the original reproduction. His book
use case prompted the repair and this example; see the
[changelog](../../../CHANGELOG.md#unreleased) for the fixes and regression scope.

Use `loadDocument`, `VMPrintEngine`, and `LocalFontManager`, then await
`engine.layout()`. That is the intended Node.js API for a native table of
contents, including headings inside two-column stories and contents spanning
multiple pages. Layout performs its own settlement; one awaited call returns
final page references.

This example requires the native TOC repair in commit `c9b928e` or a descendant.
It is available in this source checkout; these instructions do not imply that
an npm release containing the repair has been published.

## Run from the repository root

```sh
npm install
npm run build
node docs/examples/native-toc/layout.mjs
```

The runner loads [book.json](book.json), lays it out, and prints every contents
line followed by the page counts. With the bundled Arimo fonts, the example
produces **42 entries, 19 document pages, and 2 contents pages**. It contains six
stories with chapter and section headings, both paragraph-first and
heading-first stories, headings on later story fragments, and a wrapped title.

To run Gavin's original reproduction through the same public API:

```sh
node docs/examples/native-toc/layout.mjs engine/tests/fixtures/native-toc/gavin-20-root-headings.json
```

That input produces **20 entries across 6 document pages**, including
`Section 18  5`. The regression checks every entry against the heading's final
rendered page, rather than assuming the old pagination remains correct.

## Minimal integration

[layout.mjs](layout.mjs) uses the public packages directly:

```js
import { readFile } from 'node:fs/promises';
import { VMPrintEngine, loadDocument } from '@vmprint/engine';
import { LocalFontManager } from '@vmprint/local-fonts';

const source = await readFile('book.json', 'utf8');
const document = loadDocument(source, 'book.json');
const engine = new VMPrintEngine(document, new LocalFontManager());
const pages = await engine.layout();

const tocLines = pages.flatMap(page => page.boxes
  .filter(box => box.type === 'toc')
  .flatMap(box => (box.lines ?? []).map(line =>
    line.map(segment => segment.text ?? '').join(''))));
console.log(tocLines.join('\n'));
```

To generate a PDF, pass a rendering context to `await engine.render(context)`
after layout. The engine reuses the cached pages; see the
[engine API example](../../../engine/README.md#primary-api) for context setup.

## Authoring the contents and headings

Place one native `toc` before the material it indexes:

```json
{
  "type": "toc",
  "content": "",
  "properties": {
    "sourceId": "book-contents",
    "toc": {
      "title": "Contents",
      "levelFilter": [1, 2],
      "style": { "fontSize": 10, "lineHeight": 1.4 }
    }
  }
}
```

Use ordinary `h1` and `h2` elements for chapters and sections. Give each heading
a unique `properties.sourceId`. Inside a story, put those same elements in
`children`:

```json
{
  "type": "story",
  "columns": 2,
  "gutter": 18,
  "children": [
    { "type": "p", "content": "An opening paragraph may precede the heading." },
    {
      "type": "h1",
      "content": "Chapter One",
      "properties": { "sourceId": "chapter-one" }
    },
    {
      "type": "h2",
      "content": "First section",
      "properties": { "sourceId": "chapter-one-section-one" }
    },
    { "type": "p", "content": "Section body..." }
  ]
}
```

The full [book.json](book.json) includes heading and paragraph styles.
`keepWithNext: true` remains enabled on headings. The native TOC discovers the
headings, preserves their reading order across columns, and continues its
remaining text onto later pages automatically. Leave its height automatic so
wrapped titles contribute their measured height.

Page references are one-based physical page numbers, including the contents
pages. Read all `toc` boxes in page order and use their shaped `lines`, as above.
Use a complete `layout()` call for final contents: `stopAtPage` can stop before
all the headings have been discovered.

No runtime-cap override, author-side second layout pass, or scripting handler
is needed to populate the native TOC.

## Regression checks

```sh
npm run test:toc --prefix engine
```

This checks Gavin's pinned original input, this example, larger heading sets,
wrapped multi-page contents, grouped placement, rollback/replay, and repeated-run
determinism. The original fixture's provenance is recorded in the
[fixture notes](../../../engine/tests/fixtures/native-toc/README.md).

## Long headings at a page boundary

A keep-with-next chapter can be followed by a section heading that allows line
splitting. The TOC uses the complete section title and the page where that
heading starts, even if only its first lines fit beside the chapter. Entries
remain in chapter/section reading order. The engine retains its settlement
budget across pagination replays and reports an error if geometry fails to
stabilize.

Run the saved follow-up reproduction after rebuilding the engine:

```sh
node docs/examples/native-toc/layout.mjs engine/tests/fixtures/native-toc/long-split-heading.json
```

The regression expects two entries, the complete long section title, and two
document pages. This requires the follow-up long-heading repair in addition to
`c9b928e`; use a source build containing both repairs.
