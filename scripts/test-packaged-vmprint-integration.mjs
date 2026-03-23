import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

function requireFile(filePath) {
    if (!fs.existsSync(filePath)) {
        throw new Error(`Missing required build artifact: ${filePath}`);
    }
}

class MemoryOutputStream {
    constructor() {
        this.chunks = [];
        this.finishPromise = new Promise((resolve) => {
            this.resolveFinish = resolve;
        });
        this.finished = false;
    }

    write(chunk) {
        const bufferChunk = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        this.chunks.push(bufferChunk);
    }

    end() {
        if (this.finished) return;
        this.finished = true;
        this.resolveFinish();
    }

    waitForFinish() {
        return this.finishPromise;
    }

    toBuffer() {
        return Buffer.concat(this.chunks);
    }
}

async function main() {
    const engineDist = path.join(repoRoot, 'engine', 'dist', 'index.js');
    const standardFontsDist = path.join(repoRoot, 'font-managers', 'standard', 'dist', 'index.js');
    const pdfLiteDist = path.join(repoRoot, 'contexts', 'pdf-lite', 'dist', 'index.js');

    requireFile(engineDist);
    requireFile(standardFontsDist);
    requireFile(pdfLiteDist);

    const engine = await import(pathToFileURL(engineDist).href);
    const standardFonts = await import(pathToFileURL(standardFontsDist).href);
    const pdfLite = await import(pathToFileURL(pdfLiteDist).href);

    const documentInput = {
        documentVersion: '1.1',
        layout: {
            pageSize: 'LETTER',
            margins: { top: 54, right: 54, bottom: 54, left: 54 },
            fontFamily: 'Helvetica',
            fontSize: 12,
            lineHeight: 1.4
        },
        fonts: {
            regular: 'Helvetica',
            bold: 'Helvetica-Bold',
            italic: 'Helvetica-Oblique',
            boldItalic: 'Helvetica-BoldOblique'
        },
        styles: {
            p: {
                fontFamily: 'Helvetica',
                fontSize: 12,
                lineHeight: 1.4
            }
        },
        elements: [
            {
                type: 'p',
                content: 'VMPrint packaged integration smoke test.',
                properties: {
                    sourceId: 'smoke-paragraph'
                }
            }
        ]
    };

    const runtime = engine.createEngineRuntime({
        fontManager: new standardFonts.StandardFontManager()
    });
    const resolved = engine.resolveDocumentPaths(documentInput, 'packaged-integration-smoke.json');
    const config = engine.toLayoutConfig(resolved, false);

    const layoutEngine = new engine.LayoutEngine(config, runtime);
    await layoutEngine.waitForFonts();
    const pages = layoutEngine.simulate(resolved.elements);
    if (pages.length === 0) {
        throw new Error('Expected at least one page from smoke test document.');
    }

    const pageSize = engine.LayoutUtils.getPageDimensions(config);
    const context = new pdfLite.PdfLiteContext({
        size: [pageSize.width, pageSize.height],
        margins: { top: 0, right: 0, bottom: 0, left: 0 },
        autoFirstPage: false,
        bufferPages: false
    });

    const output = new MemoryOutputStream();
    context.pipe(output);

    const renderer = new engine.Renderer(config, false, runtime);
    await renderer.render(pages, context);
    await output.waitForFinish();

    const pdfBytes = output.toBuffer();
    if (pdfBytes.length === 0) {
        throw new Error('Smoke test produced an empty PDF payload.');
    }

    console.log(`[packaged-integration] OK: ${pages.length} page(s), ${pdfBytes.length} bytes`);
}

main().catch((error) => {
    console.error('[packaged-integration] FAIL:', error);
    process.exit(1);
});
