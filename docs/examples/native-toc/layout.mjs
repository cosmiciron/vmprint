import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { VMPrintEngine, loadDocument } from '@vmprint/engine';
import { LocalFontManager } from '@vmprint/local-fonts';

const inputPath = process.argv[2] ? resolve(process.argv[2]) : new URL('./book.json', import.meta.url);
const source = await readFile(inputPath, 'utf8');
const document = loadDocument(source, String(inputPath));
const engine = new VMPrintEngine(document, new LocalFontManager());
const pages = await engine.layout();

// A continued TOC has multiple boxes. Read their shaped lines in page order.
const tocPages = pages.filter(page => page.boxes.some(box => box.type === 'toc'));
const contents = tocPages.flatMap(page => page.boxes
    .filter(box => box.type === 'toc')
    .flatMap(box => (box.lines ?? []).map(line => line.map(segment => segment.text ?? '').join(''))));
console.log(contents.join('\n'));
console.log(`\n${pages.length} document pages; ${tocPages.length} contents pages.`);
