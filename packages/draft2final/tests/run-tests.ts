import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseMarkdownAst } from '../src/markdown';
import { normalizeToSemantic } from '../src/semantic';
import { compileToVmprint } from '../src/build';
import { getFormatModule, listFormats } from '../src/formats';
import { Draft2FinalError } from '../src/errors';
import { LayoutEngine, createEngineRuntime, toLayoutConfig, resolveDocumentPaths } from '@vmprint/engine';
import { LocalFontManager } from '@vmprint/local-fonts';
import { runLayoutSnapshotTests } from './layout-snapshots';

const ONE_PIXEL_PNG_BASE64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO9Wl9kAAAAASUVORK5CYII=';

function flattenElementText(element: any): string {
    const own = typeof element?.content === 'string' ? element.content : '';
    const childText = Array.isArray(element?.children)
        ? element.children.map((child: any) => flattenElementText(child)).join('')
        : '';
    return own + childText;
}

function flattenBoxText(box: any): string {
    if (typeof box?.content === 'string' && box.content.length > 0) {
        return box.content;
    }
    if (!Array.isArray(box?.lines)) return '';
    return box.lines.map((line: any[]) => line.map((seg: any) => String(seg?.text || '')).join('')).join('\n');
}

function containsPropertyKey(value: unknown, key: string): boolean {
    if (Array.isArray(value)) {
        return value.some((entry) => containsPropertyKey(entry, key));
    }
    if (!value || typeof value !== 'object') return false;
    for (const [entryKey, entryValue] of Object.entries(value as Record<string, unknown>)) {
        if (entryKey === key) return true;
        if (containsPropertyKey(entryValue, key)) return true;
    }
    return false;
}

async function paginateIr(documentInput: any, inputPath: string): Promise<any[]> {
    const ir = resolveDocumentPaths(documentInput, inputPath);
    const config = toLayoutConfig(ir, false);
    const runtime = createEngineRuntime({ fontManager: new LocalFontManager() });
    const engine = new LayoutEngine(config, runtime);
    await engine.waitForFonts();
    return engine.paginate(ir.elements);
}

function testSemanticMapping(): void {
    const inputPath = path.resolve('tests/fixtures/markdown-sample.md');
    const markdown = fs.readFileSync(inputPath, 'utf-8');
    const ast = parseMarkdownAst(markdown, inputPath);
    const semantic = normalizeToSemantic(ast, inputPath);

    assert.equal(semantic.type, 'Document');
    assert.ok(semantic.children.some((node) => node.kind === 'h1'));
    assert.ok(semantic.children.some((node) => node.kind === 'p'));
    assert.ok(semantic.children.some((node) => node.kind === 'ul' || node.kind === 'ol'));
    assert.ok(semantic.children.some((node) => node.kind === 'blockquote'));
    assert.ok(semantic.children.some((node) => node.kind === 'hr'));
    assert.ok(semantic.children.some((node) => node.kind === 'code'));
    assert.ok(semantic.children.some((node) => node.kind === 'table'));
}

function testUnsupportedSyntax(): void {
    const markdown = '<div>Unsupported HTML block</div>';
    const inputPath = 'unsupported.md';
    assert.throws(() => parseMarkdownAst(markdown, inputPath));
}

function testFormatCompileAndIrEmission(): void {
    const markdown = '# H1\n\nParagraph';
    const inputPath = 'inline.md';
    const result = compileToVmprint(markdown, inputPath);
    const ir = result.ir;

    assert.equal(ir.layout.fontFamily.length > 0, true);
    assert.equal(result.format, 'markdown');
    assert.ok(ir.styles.paragraph);
    assert.ok(ir.styles['heading-1']);
    assert.ok(Array.isArray(ir.elements));
    assert.ok(ir.elements.length >= 2);
}

function testFormatHandlerRoles(): void {
    for (const name of listFormats()) {
        const format = getFormatModule(name);
        const handler = format.createHandler({});
        const roles = handler.roles();
        assert.ok(Array.isArray(roles), `${name}: roles() should return an array`);
        assert.ok(roles.length > 0, `${name}: roles() should be non-empty`);
        assert.ok(
            roles.every((r) => typeof r === 'string'),
            `${name}: all roles should be strings`,
        );
    }
}

function testBlockquotePreservesInlineStyling(): void {
    const markdown = '> One with **bold**.\n>\n> Two with `code` and a [link](https://example.com).\n';
    const inputPath = 'blockquote-inline.md';
    const ir = compileToVmprint(markdown, inputPath).ir;

    const quotes = ir.elements.filter((element) => element.type === 'blockquote');
    assert.ok(quotes.length > 0, 'expected blockquote elements');
    const serialized = JSON.stringify(quotes);
    assert.ok(serialized.includes('"fontWeight":700'), 'expected bold style in blockquote');
    assert.equal(ir.styles['inline-code']?.fontFamily, 'Cousine');
    assert.ok(serialized.includes('[1]'), 'expected citation marker in blockquote');
}

function testReferenceStyleLinksCompileToCitationsAndReferences(): void {
    const markdown = [
        'Primary source [OpenAI][oa] and direct [link](https://example.com).',
        '',
        '[oa]: https://openai.com "OpenAI"',
    ].join('\n');

    const inputPath = 'reference-links.md';
    const ir = compileToVmprint(markdown, inputPath).ir;
    const serialized = JSON.stringify(ir.elements);

    assert.ok(serialized.includes('[1]'), 'expected first citation marker');
    assert.ok(serialized.includes('[2]'), 'expected second citation marker');
    assert.ok(serialized.includes('"references-heading"'), 'expected references heading');
    assert.ok(serialized.includes('1. OpenAI. '), 'expected first references prefix');
    assert.ok(serialized.includes('"linkTarget":"https://openai.com"'), 'expected clickable first reference URL');
    assert.ok(serialized.includes('2. '), 'expected second references prefix');
    assert.ok(serialized.includes('"linkTarget":"https://example.com"'), 'expected clickable second reference URL');
}

function testFormatMarginDefaults(): void {
    const markdown = '# Title\n\nParagraph with a [link](https://example.com).';
    const inputPath = 'flavor.md';

    const defaultResult = compileToVmprint(markdown, inputPath);
    const academicResult = compileToVmprint(markdown, inputPath, { format: 'academic' });

    assert.equal(defaultResult.ir.layout.fontFamily, 'Caladea');
    assert.equal(academicResult.ir.layout.fontFamily, 'Caladea');
    assert.equal(defaultResult.ir.layout.margins.left, 80);
    assert.equal(academicResult.ir.layout.margins.left, 72);
}

function testHeadingInlineEmphasisKeepsHeadingScale(): void {
    const markdown = '# From *The Orchard Beyond Midnight*';
    const inputPath = 'heading-emphasis.md';
    const ir = compileToVmprint(markdown, inputPath, { format: 'literature' }).ir;
    const heading = ir.elements.find((element) => element.type === 'heading-1');

    assert.ok(heading, 'expected h1 element');
    const serialized = JSON.stringify(heading);
    assert.ok(serialized.includes('"fontStyle":"italic"'), 'expected inline emphasis style');
    assert.equal(serialized.includes('"fontSize":10.6'), false, 'inline emphasis should not reset to body font size');
}

function testUnorderedMarkersAreDepthBased(): void {
    const markdown = ['- first', '- second', '- third', '  - nested one', '  - nested two'].join('\n');
    const inputPath = 'unordered-depth.md';
    const ir = compileToVmprint(markdown, inputPath, { format: 'literature' }).ir;

    const unordered = ir.elements.filter((element) => String(element.type).startsWith('list-item-unordered-'));
    assert.ok(unordered.length >= 5, 'expected emitted unordered list rows');

    const topLevelDepth = Math.min(
        ...unordered
            .map((element) => {
                const parts = String(element.type).split('-');
                return Number(parts[parts.length - 1]);
            })
            .filter((value) => Number.isFinite(value)),
    );
    const topLevel = unordered.filter((element) => String(element.type).endsWith(`-${topLevelDepth}`));
    assert.ok(topLevel.length >= 3, 'expected top-level unordered rows');

    const markerTexts = topLevel.map((element) => element.children?.[0]?.content || '').filter(Boolean);
    assert.ok(markerTexts.length >= 3, 'expected top-level markers');
    assert.equal(new Set(markerTexts).size, 1, 'expected identical marker for same-depth siblings');
}

function testFlavorContinuationIndentPolicy(): void {
    const markdown = ['1. One', '', '   continuation', '', '2. Two'].join('\n');
    const inputPath = 'continuation-indent.md';

    const defaultIr = compileToVmprint(markdown, inputPath).ir;
    const literatureIr = compileToVmprint(markdown, inputPath, { format: 'literature' }).ir;

    const defaultCont = defaultIr.elements.find((element) =>
        String(element.type).startsWith('list-item-continuation-'),
    ) as any;
    const literatureCont = literatureIr.elements.find((element) =>
        String(element.type).startsWith('list-item-continuation-'),
    ) as any;

    assert.ok(defaultCont, 'expected default continuation element');
    assert.ok(literatureCont, 'expected literature continuation element');

    const defaultIndent = defaultCont?.properties?.style?.textIndent;
    const literatureIndent = literatureCont?.properties?.style?.textIndent;

    assert.ok(typeof defaultIndent === 'number', 'expected default continuation indentation');
    assert.ok(typeof literatureIndent === 'number', 'expected literature continuation indentation');
    assert.ok(defaultIndent > literatureIndent, 'expected literature continuation indentation to be reduced');
}

function testLiteratureCodeBlockModes(): void {
    const markdown = ['```verse', 'line one', 'line two', '```', '', '```extract', 'archive line', '```'].join('\n');
    const inputPath = 'literature-code-modes.md';
    const ir = compileToVmprint(markdown, inputPath, { format: 'literature' }).ir;

    const blocks = ir.elements.filter((element) => element.type === 'code-block');
    assert.equal(blocks.length, 2, 'expected two code-block elements');

    const verseStyle = blocks[0].properties?.style as Record<string, unknown>;
    const extractStyle = blocks[1].properties?.style as Record<string, unknown>;
    assert.equal(verseStyle.fontSize, 11.6);
    assert.equal(extractStyle.fontSize, 11.2);
    assert.equal(verseStyle.paddingLeft, 18);
    assert.equal(extractStyle.paddingLeft, 14);
}

function testAcademicTheoremCodeBlockMode(): void {
    const markdown = ['```theorem', 'Theorem (Test): Stable motif index converges.', '```'].join('\n');
    const inputPath = 'academic-theorem-mode.md';
    const ir = compileToVmprint(markdown, inputPath, { format: 'academic' }).ir;

    const block = ir.elements.find((element) => element.type === 'code-block');
    assert.ok(block, 'expected academic theorem block');
    const style = (block?.properties?.style || {}) as Record<string, unknown>;
    assert.equal(style.fontFamily, 'Caladea');
    assert.equal(style.fontStyle, 'italic');
    assert.equal(style.borderLeftWidth, 0);
    assert.equal(style.borderWidth, 0);
    assert.equal(style.backgroundColor, '#ffffff');
    assert.equal(style.paddingLeft, 12);
}

function testTaskListMarkersRenderAsPrintMarkers(): void {
    const markdown = ['- [x] done', '- [ ] pending'].join('\n');
    const inputPath = 'task-list.md';

    const defaultIr = compileToVmprint(markdown, inputPath).ir;
    const academicIr = compileToVmprint(markdown, inputPath, { format: 'academic' }).ir;

    const defaultRows = defaultIr.elements.filter((element) => String(element.type).startsWith('list-item-unordered-'));
    const academicRows = academicIr.elements.filter((element) =>
        String(element.type).startsWith('list-item-unordered-'),
    );
    assert.ok(defaultRows.length >= 2, 'expected default task rows');
    assert.ok(academicRows.length >= 2, 'expected academic task rows');

    const defaultMarkers = defaultRows.slice(0, 2).map((element) => element.children?.[0]?.content || '');
    const academicMarkers = academicRows.slice(0, 2).map((element) => element.children?.[0]?.content || '');
    assert.ok(defaultMarkers[0].startsWith('\u2611'), 'expected checked task marker in default flavor');
    assert.ok(defaultMarkers[1].startsWith('\u2610'), 'expected unchecked task marker in default flavor');
    assert.ok(academicMarkers[0].startsWith('[x]'), 'expected checked task marker in academic flavor');
    assert.ok(academicMarkers[1].startsWith('[ ]'), 'expected unchecked task marker in academic flavor');
}

function testDefinitionListFallbackRendersDtDd(): void {
    const markdown = ['Signal lock', ': The line-break pattern remains deterministic across reruns.'].join('\n');
    const inputPath = 'definition-fallback.md';
    const ir = compileToVmprint(markdown, inputPath).ir;

    const hasTerm = ir.elements.some((element) => element.type === 'definition-term');
    const hasDesc = ir.elements.some((element) => element.type === 'definition-desc');
    assert.equal(hasTerm, true, 'expected definition term element');
    assert.equal(hasDesc, true, 'expected definition description element');
}

function testFlavorOrderedMarkerStyles(): void {
    const markdown = ['1. Top', '   1. Nested', '      1. Deep', '2. Top two'].join('\n');
    const inputPath = 'ordered-marker-style.md';

    const literatureIr = compileToVmprint(markdown, inputPath, { format: 'literature' }).ir;
    const ordered = literatureIr.elements.filter((element) => String(element.type).startsWith('list-item-ordered-'));
    assert.ok(ordered.length >= 3, 'expected ordered list output');

    const topLevel = ordered.find((element) => String(element.type).endsWith('-0'));
    assert.ok(topLevel, 'expected top-level ordered marker');
    const topMarker = topLevel?.children?.[0]?.content || '';
    assert.ok(topMarker.startsWith('I.'), 'expected upper-roman marker for literature top-level ordered lists');
}

function testReferencePolicyByFlavor(): void {
    const markdown = 'Alpha [A](https://a.example) and beta [B](https://b.example).';
    const inputPath = 'reference-policy.md';

    const literatureIr = compileToVmprint(markdown, inputPath, { format: 'literature' }).ir;
    const serialized = JSON.stringify(literatureIr.elements);
    assert.ok(serialized.includes('[1]'), 'expected citation marker');
    assert.ok(serialized.includes('"references-heading"'), 'expected notes/references heading');
    assert.ok(serialized.includes('i. '), 'expected lower-roman numbering prefix in literature notes');
    assert.ok(serialized.includes('"linkTarget":"https://a.example"'), 'expected clickable literature note URL');
}

function testLeadInParagraphKeepsWithFollowingDisplayBlock(): void {
    const markdown = ['When evening settled, one of them recited:', '', '```verse', 'line one', 'line two', '```'].join(
        '\n',
    );
    const inputPath = 'lead-in-keep-with-next.md';
    const ir = compileToVmprint(markdown, inputPath, { format: 'literature' }).ir;

    const leadIn = ir.elements.find(
        (element) =>
            element.type === 'paragraph' &&
            JSON.stringify(element).includes('When evening settled, one of them recited:'),
    );
    assert.ok(leadIn, 'expected lead-in paragraph');
    assert.equal(leadIn?.properties?.keepWithNext, true, 'expected lead-in paragraph keepWithNext');
}

function testMarkdownImageLocalFileCompiles(): void {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'draft2final-image-local-'));
    const markdownPath = path.join(dir, 'doc.md');
    const imagePath = path.join(dir, 'tiny.png');
    fs.writeFileSync(imagePath, Buffer.from(ONE_PIXEL_PNG_BASE64, 'base64'));

    const markdown = '![A tiny pixel](./tiny.png "Tiny")\n';
    const ir = compileToVmprint(markdown, markdownPath).ir;
    const imageElement = ir.elements.find((element) => element.type === 'image');

    assert.ok(imageElement, 'expected image element');
    assert.equal(imageElement?.properties?.image?.mimeType, 'image/png');
    assert.equal(typeof imageElement?.properties?.image?.data, 'string');
    assert.equal(imageElement?.properties?.image?.data.length > 0, true, 'expected embedded base64 payload');
}

function testMarkdownImageDataUriCompiles(): void {
    const markdown = `![Inline pixel](data:image/png;base64,${ONE_PIXEL_PNG_BASE64} "Inline data")\n`;
    const inputPath = path.resolve('tests/fixtures/image-data-uri.md');
    const ir = compileToVmprint(markdown, inputPath).ir;
    const imageElement = ir.elements.find((element) => element.type === 'image');

    assert.ok(imageElement, 'expected image element');
    assert.equal(imageElement?.properties?.image?.mimeType, 'image/png');
    assert.equal(imageElement?.properties?.image?.data, ONE_PIXEL_PNG_BASE64);
}

function testMarkdownImageRemoteUrlFailsClearly(): void {
    const markdown = '![Remote](https://example.com/image.png)\n';
    const inputPath = 'remote-image.md';

    assert.throws(
        () => compileToVmprint(markdown, inputPath),
        (error: unknown) => {
            assert.ok(error instanceof Draft2FinalError, 'expected Draft2FinalError');
            assert.equal((error as Draft2FinalError).stage, 'format');
            assert.ok((error as Draft2FinalError).message.includes('Remote HTTP/HTTPS images are not supported'));
            return true;
        },
    );
}

function testMarkdownImageMissingLocalFileFailsClearly(): void {
    const markdown = '![Missing](./missing-image.png)\n';
    const inputPath = path.resolve('tests/fixtures/missing-image.md');

    assert.throws(
        () => compileToVmprint(markdown, inputPath),
        (error: unknown) => {
            assert.ok(error instanceof Draft2FinalError, 'expected Draft2FinalError');
            assert.equal((error as Draft2FinalError).stage, 'format');
            assert.ok((error as Draft2FinalError).message.includes('Image file not found'));
            return true;
        },
    );
}

function testOpenSourceFlavorFigureCaptionAndImageFrame(): void {
    const markdown = [
        `![Pipeline](data:image/png;base64,${ONE_PIXEL_PNG_BASE64} "Pipeline frame")`,
        '> Figure 1. Pipeline overview for README open-source output.',
    ].join('\n');
    const inputPath = 'opensource-figure-caption.md';

    const ir = compileToVmprint(markdown, inputPath, {
        theme: 'opensource',
        images: {
            frame: {
                mode: 'all',
                style: {
                    borderWidth: 0.65,
                    borderColor: '#8d99aa',
                    borderRadius: 0,
                    paddingTop: 11,
                    paddingRight: 11,
                    paddingBottom: 11,
                    paddingLeft: 11,
                    backgroundColor: '#fdfdfc',
                },
            },
        },
        captions: {
            blockquoteUnderImageAsFigureCaption: true,
            blockquoteStyle: { textAlign: 'center', fontStyle: 'italic' },
        },
    }).ir;

    const imageElement = ir.elements.find((element) => element.type === 'image');
    assert.ok(imageElement, 'expected image element');
    const imageStyle = (imageElement?.properties?.style || {}) as Record<string, unknown>;
    assert.equal(imageStyle.borderWidth, 0.65, 'expected opensource frame border on block image');
    assert.equal(imageStyle.backgroundColor, '#fdfdfc', 'expected opensource frame background on block image');
    assert.equal(imageElement?.properties?.keepWithNext, true, 'expected image to keep with figure caption');

    const hasBlockquote = ir.elements.some((element) => element.type === 'blockquote');
    assert.equal(hasBlockquote, false, 'expected blockquote directly under image to be treated as figure caption');

    const captionElement = ir.elements.find((element) => element.type === 'paragraph');
    assert.ok(captionElement, 'expected emitted caption paragraph');
    const captionStyle = (captionElement?.properties?.style || {}) as Record<string, unknown>;
    assert.equal(captionStyle.textAlign, 'center', 'expected centered opensource figure caption');
    assert.equal(captionStyle.fontStyle, 'italic', 'expected italic opensource figure caption');
}

function testOpenSourceFlavorTitleSubheading(): void {
    const markdown = ['# VMPrint', ':: Publication-grade layout for open-source docs.', '', 'First paragraph.'].join(
        '\n',
    );
    const inputPath = 'opensource-subheading.md';
    const ir = compileToVmprint(markdown, inputPath, {
        theme: 'opensource',
        title: { subheading: { enabled: true } },
    }).ir;

    const subheading = ir.elements.find((element) => element.type === 'subheading');
    assert.ok(subheading, 'expected emitted opensource title subheading');
    const subheadingText = flattenElementText(subheading);
    assert.equal(subheadingText.includes('::'), false, 'expected subheading marker to be stripped');
    assert.ok(subheadingText.includes('Publication-grade layout for open-source docs.'), 'expected subheading text');
}

function testOpenSourceFlavorLinksRenderAsFootnotes(): void {
    const markdown = 'Read the [documentation](https://example.com/docs "Docs").';
    const inputPath = 'opensource-footnotes.md';
    const ir = compileToVmprint(markdown, inputPath, {
        theme: 'opensource',
        references: { heading: 'Footnotes' },
    }).ir;
    const serialized = JSON.stringify(ir.elements);

    assert.ok(serialized.includes('[1]'), 'expected footnote marker for hyperlink');
    assert.ok(serialized.includes('"references-heading"'), 'expected footnotes heading element');
    assert.ok(serialized.includes('Footnotes'), 'expected opensource footnotes heading text');
    assert.ok(
        serialized.includes('"linkTarget":"https://example.com/docs"'),
        'expected clickable hyperlink target in footnote entry',
    );
}

function testScreenplayFormatCompileAndSemanticMapping(): void {
    const markdown = [
        '# The Last Patch',
        '',
        '- by: Mira Quell',
        '- email: mira@example.com',
        '- address: 123 Writer Lane, Los Angeles, CA 90028',
        '',
        '## INT. APARTMENT - NIGHT',
        '',
        'Rain taps against the window.',
        '',
        '> @Jane',
        '> (whispering)',
        '> We should leave now.',
        '',
        '### CUT TO:',
    ].join('\n');

    const inputPath = 'screenplay.md';
    const result = compileToVmprint(markdown, inputPath, { format: 'screenplay' });
    const ir = result.ir;

    assert.equal(result.format, 'screenplay');
    assert.ok(ir.styles['title']);
    assert.ok(ir.styles['title-meta']);
    assert.ok(ir.styles['title-contact']);
    assert.ok(ir.styles['scene-heading']);
    assert.ok(ir.styles['action']);
    assert.ok(ir.styles['character']);
    assert.ok(ir.styles['parenthetical']);
    assert.ok(ir.styles['dialogue']);
    assert.ok(ir.styles['transition']);
    assert.ok(ir.styles['more']);

    const emittedTypes = new Set(ir.elements.map((element) => element.type));
    assert.ok(emittedTypes.has('title'));
    assert.ok(emittedTypes.has('title-meta'));
    assert.ok(emittedTypes.has('title-contact'));
    assert.ok(emittedTypes.has('scene-heading'));
    assert.ok(emittedTypes.has('action'));
    assert.ok(emittedTypes.has('character'));
    assert.ok(emittedTypes.has('parenthetical'));
    assert.ok(emittedTypes.has('dialogue'));
    assert.ok(emittedTypes.has('transition'));

    const dialogue = ir.elements.find((element) => element.type === 'dialogue');
    assert.ok(dialogue, 'expected dialogue element');
    const continuation = dialogue?.properties?.paginationContinuation as Record<string, any> | undefined;
    assert.equal(continuation?.enabled, true, 'expected continuation metadata enabled');
    assert.equal(continuation?.markerAfterSplit?.content, '(MORE)', 'expected (MORE) split marker');
    assert.equal(continuation?.markerBeforeContinuation?.content, "JANE (CONT'D)", 'expected continued cue marker');

    const title = ir.elements.find((element) => element.type === 'title');
    const titleDirectives = (title?.properties?.layoutDirectives || {}) as Record<string, unknown>;
    assert.equal(titleDirectives.suppressPageNumber, true, 'expected title page suppression marker');
    const firstScene = ir.elements.find((element) => element.type === 'scene-heading');
    const firstSceneStyle = (firstScene?.properties?.style || {}) as Record<string, unknown>;
    assert.equal(firstSceneStyle.pageBreakBefore, true, 'expected standalone title page break before first scene');
}

function testScreenplayDialogueWrappingParagraphsAndHardBreaks(): void {
    const markdown = [
        '## INT. TEST ROOM - NIGHT',
        '',
        '> @Maya',
        '> This line is intentionally wrapped in source',
        '> but should be a single wrapped paragraph in output.',
        '>',
        '> New paragraph starts here.',
        '> Keep this manual break\\',
        '> on the next line.',
    ].join('\n');

    const inputPath = 'screenplay-dialogue-wrapping.md';
    const result = compileToVmprint(markdown, inputPath, { format: 'screenplay' });
    const dialogue = result.ir.elements.find((element) => element.type === 'dialogue');
    assert.ok(dialogue, 'expected screenplay dialogue element');

    const content = flattenElementText(dialogue);
    assert.ok(
        content.includes(
            'This line is intentionally wrapped in source but should be a single wrapped paragraph in output.',
        ),
        'expected source line wraps to collapse into one dialogue paragraph',
    );
    assert.ok(
        content.includes('\n\nNew paragraph starts here.'),
        'expected blank quoted line to create a paragraph break',
    );
    assert.ok(
        content.includes('Keep this manual break\non the next line.'),
        'expected explicit Markdown hard break to be preserved inside dialogue paragraph',
    );
}

function testScreenplayInlineStylingInActionAndTitle(): void {
    const markdown = [
        '# The *Last* **Patch**',
        '',
        '## INT. TEST ROOM - DAY',
        '',
        'A **critical** drift appears in *node thirty-one*.',
    ].join('\n');

    const inputPath = 'screenplay-inline-action-title.md';
    const result = compileToVmprint(markdown, inputPath, { format: 'screenplay' });

    const title = result.ir.elements.find((element) => element.type === 'title');
    assert.ok(title, 'expected screenplay title element');
    const titleSerialized = JSON.stringify(title);
    assert.ok(titleSerialized.includes('"fontStyle":"italic"'), 'expected italic inline style in title');
    assert.ok(titleSerialized.includes('"fontWeight":700'), 'expected bold inline style in title');

    const action = result.ir.elements.find((element) => element.type === 'action');
    assert.ok(action, 'expected screenplay action element');
    const actionSerialized = JSON.stringify(action);
    assert.ok(actionSerialized.includes('"fontStyle":"italic"'), 'expected italic inline style in action');
    assert.ok(actionSerialized.includes('"fontWeight":700'), 'expected bold inline style in action');
}

function testScreenplayInlineStylingInDialogue(): void {
    const markdown = ['## INT. TEST ROOM - NIGHT', '', '> @Maya', '> We need **deterministic** rollback *now*.'].join(
        '\n',
    );

    const inputPath = 'screenplay-inline-dialogue.md';
    const result = compileToVmprint(markdown, inputPath, { format: 'screenplay' });

    const dialogue = result.ir.elements.find((element) => element.type === 'dialogue');
    assert.ok(dialogue, 'expected screenplay dialogue element');
    const serialized = JSON.stringify(dialogue);
    assert.ok(serialized.includes('deterministic'), 'expected dialogue text to include bold term');
    assert.ok(serialized.includes('rollback'), 'expected dialogue text to include italic term');
    assert.ok(serialized.includes('"fontWeight":700'), 'expected bold inline style in dialogue');
    assert.ok(serialized.includes('"fontStyle":"italic"'), 'expected italic inline style in dialogue');
}

function testScreenplayDefaultIndustryGeometryProfile(): void {
    const markdown = [
        '# Industry Sample',
        '',
        '- written by: A. Writer',
        '- email: writer@example.com',
        '',
        '## INT. TEST LAB - DAY',
        '',
        '> @Mira',
        '> One line.',
    ].join('\n');

    const inputPath = 'screenplay-industry-geometry.md';
    const result = compileToVmprint(markdown, inputPath, { format: 'screenplay' });
    const ir = result.ir;

    assert.equal(ir.layout.pageSize, 'LETTER');
    assert.equal(ir.layout.lineHeight, 1);
    assert.equal(ir.layout.pageNumberFormat, '{n}.');
    assert.equal(ir.layout.pageNumberOffset, 36);

    const titleStyle = (ir.styles['title'] || {}) as Record<string, unknown>;
    assert.equal(titleStyle.marginLeft, -36);
    assert.equal(titleStyle.marginTop, 180);
    assert.equal(titleStyle.width, 468);
    assert.equal(titleStyle.textAlign, 'center');

    const metaStyle = (ir.styles['title-meta'] || {}) as Record<string, unknown>;
    assert.equal(metaStyle.marginLeft, -36);
    assert.equal(metaStyle.marginTop, 0);
    assert.equal(metaStyle.width, 468);

    const contactStyle = (ir.styles['title-contact'] || {}) as Record<string, unknown>;
    assert.equal(contactStyle.marginLeft, -36);
    assert.equal(contactStyle.marginTop, 0);
    assert.equal(contactStyle.width, 468);

    const characterStyle = (ir.styles['character'] || {}) as Record<string, unknown>;
    assert.equal(characterStyle.marginLeft, 158.4);
    assert.equal(characterStyle.width, 165.6);

    const parentheticalStyle = (ir.styles['parenthetical'] || {}) as Record<string, unknown>;
    assert.equal(parentheticalStyle.marginLeft, 115.2);
    assert.equal(parentheticalStyle.width, 172.8);

    const dialogueStyle = (ir.styles['dialogue'] || {}) as Record<string, unknown>;
    assert.equal(dialogueStyle.marginLeft, 72);
    assert.equal(dialogueStyle.width, 252);
}

function testScreenplayContinuationCarriesParentheticalMetadata(): void {
    const markdown = [
        '## INT. TEST ROOM - NIGHT',
        '',
        '> @Mira',
        '> (under her breath)',
        '> This is a very long dialogue block that should need continuation markers once pagination happens.',
        '> This sentence repeats to ensure enough length for split behavior in layout.',
        '> This sentence repeats to ensure enough length for split behavior in layout.',
        '> This sentence repeats to ensure enough length for split behavior in layout.',
        '> This sentence repeats to ensure enough length for split behavior in layout.',
    ].join('\n');

    const inputPath = 'screenplay-cont-parenthetical.md';
    const ir = compileToVmprint(markdown, inputPath, { format: 'screenplay' }).ir;
    const dialogue = ir.elements.find((element) => element.type === 'dialogue');
    assert.ok(dialogue, 'expected dialogue element');

    const continuation = dialogue?.properties?.paginationContinuation as Record<string, any> | undefined;
    assert.ok(Array.isArray(continuation?.markersBeforeContinuation), 'expected markersBeforeContinuation array');
    assert.equal(
        continuation?.markersBeforeContinuation?.length,
        2,
        'expected cue + parenthetical continuation markers',
    );
    assert.equal(continuation?.markersBeforeContinuation?.[0]?.type, 'character');
    assert.equal(continuation?.markersBeforeContinuation?.[1]?.type, 'parenthetical');
    assert.equal(continuation?.markersBeforeContinuation?.[1]?.content, '(under her breath)');
}

function testScreenplayDualDialogueCuePairMapsToDualRoles(): void {
    const markdown = [
        '## INT. DUAL ROOM - NIGHT',
        '',
        '> @Maya^',
        '> We hold the line.',
        '',
        '> @Rho^',
        '> We ship before dawn.',
    ].join('\n');

    const inputPath = 'screenplay-dual-dialogue.md';
    const ir = compileToVmprint(markdown, inputPath, { format: 'screenplay' }).ir;
    const emittedTypes = new Set(ir.elements.map((element) => element.type));
    assert.equal(emittedTypes.has('character-dual-left'), true, 'expected dual-left character role');
    assert.equal(emittedTypes.has('dialogue-dual-left'), true, 'expected dual-left dialogue role');
    assert.equal(emittedTypes.has('character-dual-right'), true, 'expected dual-right character role');
    assert.equal(emittedTypes.has('dialogue-dual-right'), true, 'expected dual-right dialogue role');
    assert.equal(
        containsPropertyKey(ir.elements, 'screenplay'),
        false,
        'expected no screenplay metadata in emitted VMPrint elements',
    );
}

async function testScreenplayLayoutGoldenContinuationSignature(): Promise<void> {
    const inputPath = path.resolve('tests/fixtures/screenplay-production-layout-sample.md');
    const markdown = fs.readFileSync(inputPath, 'utf-8');
    const ir = compileToVmprint(markdown, inputPath, { format: 'screenplay' }).ir;
    const pages = await paginateIr(ir, inputPath);

    assert.equal(pages.length, 4, 'expected stable screenplay pagination page count');

    const page2 = pages[1];
    const page3 = pages[2];
    assert.ok(page2, 'expected page 2');
    assert.ok(page3, 'expected page 3');

    const page2More = page2.boxes.find((box: any) => box.type === 'more');
    assert.ok(page2More, 'expected (MORE) marker on split page');
    assert.equal(flattenBoxText(page2More), '(MORE)', 'expected exact (MORE) marker text');

    const contCue = page3.boxes.find((box: any) => box.type === 'character' && flattenBoxText(box).includes("CONT'D"));
    assert.ok(contCue, 'expected continuation cue on next page');

    const contParenthetical = page3.boxes.find((box: any) => box.type === 'parenthetical');
    assert.ok(contParenthetical, 'expected continuation parenthetical on next page');

    const contDialogue = page3.boxes.find((box: any) => box.type === 'dialogue');
    assert.ok(contDialogue, 'expected continuation dialogue on next page');

    assert.ok(contCue.y < contParenthetical.y, 'expected continuation cue before parenthetical');
    assert.ok(contParenthetical.y < contDialogue.y, 'expected continuation parenthetical before dialogue');
}

function testCliIntegrationMarkdown(): void {
    const fixturePath = path.resolve('tests/fixtures/markdown-sample.md');
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'draft2final-'));
    const outPath = path.join(outDir, 'out.pdf');

    execFileSync(
        process.execPath,
        [
            path.join(path.dirname(require.resolve('tsx/package.json')), 'dist/cli.mjs'),
            'src/cli.ts',
            'build',
            fixturePath,
            '-o',
            outPath,
            '--format',
            'markdown',
        ],
        { cwd: path.resolve('.'), stdio: 'pipe' },
    );

    const stat = fs.statSync(outPath);
    assert.ok(stat.size > 0);
}

function testCliIntegrationScreenplay(): void {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'draft2final-'));
    const fixturePath = path.join(outDir, 'screenplay.md');
    const outPath = path.join(outDir, 'screenplay.pdf');

    fs.writeFileSync(
        fixturePath,
        [
            '# Parking Lot',
            '',
            '## EXT. PARKING LOT - DAWN',
            '',
            'A battered sedan idles in fog.',
            '',
            '> @Maya',
            '> Keep the engine running.',
            '',
            '### SMASH CUT TO:',
        ].join('\n'),
    );

    execFileSync(
        process.execPath,
        [
            path.join(path.dirname(require.resolve('tsx/package.json')), 'dist/cli.mjs'),
            'src/cli.ts',
            'build',
            fixturePath,
            '-o',
            outPath,
            '--format',
            'screenplay',
        ],
        { cwd: path.resolve('.'), stdio: 'pipe' },
    );

    const stat = fs.statSync(outPath);
    assert.ok(stat.size > 0);
}

function testCliIntegrationMarkdownDebug(): void {
    const fixturePath = path.resolve('tests/fixtures/markdown-sample.md');
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'draft2final-'));
    const outPath = path.join(outDir, 'out-debug.pdf');

    execFileSync(
        process.execPath,
        [
            path.join(path.dirname(require.resolve('tsx/package.json')), 'dist/cli.mjs'),
            'src/cli.ts',
            'build',
            fixturePath,
            '-o',
            outPath,
            '--format',
            'markdown',
            '--debug',
        ],
        { cwd: path.resolve('.'), stdio: 'pipe' },
    );

    const stat = fs.statSync(outPath);
    assert.ok(stat.size > 0);
}

async function run(): Promise<void> {
    testSemanticMapping();
    testUnsupportedSyntax();
    testFormatCompileAndIrEmission();
    testFormatHandlerRoles();
    await runLayoutSnapshotTests();
    testBlockquotePreservesInlineStyling();
    testReferenceStyleLinksCompileToCitationsAndReferences();
    testFormatMarginDefaults();
    testHeadingInlineEmphasisKeepsHeadingScale();
    testUnorderedMarkersAreDepthBased();
    testFlavorContinuationIndentPolicy();
    testLiteratureCodeBlockModes();
    testAcademicTheoremCodeBlockMode();
    testTaskListMarkersRenderAsPrintMarkers();
    testDefinitionListFallbackRendersDtDd();
    testFlavorOrderedMarkerStyles();
    testReferencePolicyByFlavor();
    testLeadInParagraphKeepsWithFollowingDisplayBlock();
    testMarkdownImageLocalFileCompiles();
    testMarkdownImageDataUriCompiles();
    testMarkdownImageRemoteUrlFailsClearly();
    testMarkdownImageMissingLocalFileFailsClearly();
    testOpenSourceFlavorFigureCaptionAndImageFrame();
    testOpenSourceFlavorTitleSubheading();
    testOpenSourceFlavorLinksRenderAsFootnotes();
    testScreenplayFormatCompileAndSemanticMapping();
    testScreenplayDialogueWrappingParagraphsAndHardBreaks();
    testScreenplayInlineStylingInActionAndTitle();
    testScreenplayInlineStylingInDialogue();
    testScreenplayDefaultIndustryGeometryProfile();
    testScreenplayContinuationCarriesParentheticalMetadata();
    testScreenplayDualDialogueCuePairMapsToDualRoles();
    await testScreenplayLayoutGoldenContinuationSignature();
    testCliIntegrationMarkdown();
    testCliIntegrationScreenplay();
    testCliIntegrationMarkdownDebug();
    process.stdout.write('[draft2final:test] all tests passed\n');
}

void run();
