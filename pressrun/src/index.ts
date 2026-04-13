#!/usr/bin/env node

/**
 * pressrun - minimal bootstrap for @vmprint/engine
 *
 * This file is the smallest practical end-to-end integration. Read it top to
 * bottom and you will understand how to bootstrap the VMPrint engine inside
 * your own project without any extra packaging ceremony.
 *
 * Usage:
 *   pressrun <document.json> [output.pdf]
 *
 * If no output path is given, the PDF is written next to the input file
 * with the same name and a .pdf extension.
 */

import fs from 'node:fs';
import path from 'node:path';

// VMPrintEngine drives layout and rendering.
// loadDocument parses and validates the JSON document before handing it to the engine.
import { VMPrintEngine, loadDocument } from '@vmprint/engine';

// LocalFontManager ships a bundled multilingual font collection (Noto Sans,
// Arimo, Cousine, and others) and can also load fonts from HTTP/HTTPS URLs
// and data URIs. It is the right default for Node.js environments.
//
// For browser-first font loading with IndexedDB caching and progress
// tracking, use WebFontManager. For zero-embedded standard PDF fonts
// (Helvetica, Times, Courier), use StandardFontManager.
import LocalFontManager from '@vmprint/local-fonts';

// PdfContext is the PDFKit-backed rendering target. It implements the Context
// interface the engine renders into, and streams a fully-formed PDF to any
// Node.js writable stream.
//
// For a lighter browser-compatible alternative backed by jsPDF, see
// @vmprint/context-pdf-lite. Both implement the same interface.
import PdfContext from '@vmprint/context-pdf';

class NodeWriteStreamAdapter {
    constructor(private readonly stream: fs.WriteStream) {}

    write(chunk: Uint8Array | string): void {
        this.stream.write(chunk);
    }

    end(): void {
        this.stream.end();
    }

    waitForFinish(): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            if (this.stream.writableFinished) {
                resolve();
                return;
            }
            this.stream.once('finish', resolve);
            this.stream.once('error', reject);
        });
    }
}

const [inputArg, outputArg] = process.argv.slice(2);

if (!inputArg) {
    console.error('Usage: pressrun <document.json> [output.pdf]');
    process.exit(1);
}

const inputPath = path.resolve(inputArg);
const outputPath = outputArg
    ? path.resolve(outputArg)
    : inputPath.replace(/\.json$/i, '') + '.pdf';

if (!fs.existsSync(inputPath)) {
    console.error(`pressrun: file not found: ${inputPath}`);
    process.exit(1);
}

async function main() {
    // Read the VMPrint document from disk, then parse and validate it.
    // loadDocument accepts a raw JSON string or a pre-parsed object.
    // The second argument is used only in error messages.
    const document = loadDocument(fs.readFileSync(inputPath, 'utf8'), inputPath);

    // Create the engine with the document and a font manager.
    const engine = new VMPrintEngine(document, new LocalFontManager());

    // Open a write stream for the output PDF. The context streams the PDF to it
    // as pages are rendered.
    const { width, height } = engine.info.pageSize;
    const outputStream = new NodeWriteStreamAdapter(fs.createWriteStream(outputPath));
    const context = new PdfContext({
        size: [width, height],
        // Margins are already baked into the positioned boxes by the engine.
        margins: { top: 0, right: 0, bottom: 0, left: 0 },
        autoFirstPage: false,
        bufferPages: false
    });
    context.pipe(outputStream);

    // render() handles font loading, layout, and rendering in one call.
    // Call layout() first if you need to inspect the pages before rendering.
    await engine.render(context);

    console.log(
        `pressrun: wrote ${engine.info.pageCount} page(s) to ${path.relative(process.cwd(), outputPath)}`
    );
}

main().catch((error) => {
    console.error('pressrun:', error instanceof Error ? error.message : error);
    process.exit(1);
});
