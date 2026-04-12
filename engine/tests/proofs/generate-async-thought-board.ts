import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { LayoutEngine } from '../../src/engine/layout-engine';
import { Renderer } from '../../src/engine/renderer';
import { createPrintEngineRuntime } from '../../src/font-management/runtime';
import { simulationArtifactKeys } from '../../src/engine/layout/simulation-report';
import type { Element, LayoutConfig, Page } from '../../src/engine/types';
import { loadLocalFontManager, snapshotPages } from '../harness/engine-harness';
import { reactiveProofPackagerFactory } from '../support/reactive-proof-packager-factory';

class NodeWriteStreamAdapter {
    private stream: fs.WriteStream;

    constructor(outputPath: string) {
        this.stream = fs.createWriteStream(outputPath);
    }

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

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUTPUT_DIR = path.resolve(SCRIPT_DIR, '..', 'output', 'proofs');

function buildConfig(): LayoutConfig {
    return {
        layout: {
            pageSize: { width: 520, height: 360 },
            margins: { top: 20, right: 20, bottom: 20, left: 20 },
            fontFamily: 'Arimo',
            fontSize: 12,
            lineHeight: 1.2
        },
        fonts: {
            regular: 'Arimo'
        },
        styles: {
            p: {
                marginBottom: 8,
                allowLineSplit: true,
                orphans: 2,
                widows: 2
            }
        }
    };
}

function buildElements(): Element[] {
    return [
        {
            type: 'chapter-heading',
            content: 'Async Thought Board',
            properties: {
                sourceId: 'async-thought-heading',
                style: {
                    textAlign: 'center',
                    fontWeight: 700,
                    fontSize: 18,
                    marginTop: 0,
                    marginBottom: 16
                }
            }
        },
        {
            type: 'p',
            content: 'This board proves that VMPrint can wait for an external thought, replay deterministically, and present both the pending and resolved states as part of one temporal sequence.',
            properties: { sourceId: 'async-thought-intro' }
        },
        {
            type: 'test-async-thought',
            content: '',
            properties: {
                sourceId: 'async-thought-actor',
                style: { marginTop: 8, marginBottom: 10 },
                _asyncThought: {
                    title: 'Thought Lobe A',
                    pendingLabel: 'Thinking... waiting on a delayed external thought.',
                    resolvedLabel: 'Resolved: the delayed thought returned a committed insight.',
                    delayMs: 2000,
                    baseHeight: 72,
                    resolvedHeight: 132,
                    geometryOnResolve: true
                }
            }
        },
        {
            type: 'test-replay-marker',
            content: '',
            properties: {
                sourceId: 'async-thought-downstream',
                _testReplayMarker: {
                    title: 'Downstream Region\nShould shift after async resolve',
                    backgroundColor: '#dbeafe',
                    borderColor: '#2563eb',
                    color: '#1e3a8a',
                    height: 60
                }
            }
        },
        {
            type: 'p',
            content: 'Trailing content should move only after the async result becomes part of the committed world state.',
            properties: { sourceId: 'async-thought-outro' }
        }
    ];
}

function resolveArg(flag: string): string | undefined {
    const index = process.argv.indexOf(flag);
    if (index === -1) return undefined;
    return process.argv[index + 1];
}

function hasFlag(flag: string): boolean {
    return process.argv.includes(flag);
}

async function maybeRenderPdf(pages: Page[], config: LayoutConfig, outputPath: string, runtime: ReturnType<typeof createEngineRuntime>): Promise<boolean> {
    try {
        const mod = await import('@vmprint/context-pdf-lite');
        const PdfContext = mod.default ?? mod;
        const context = new PdfContext({
            size: [config.layout.pageSize.width, config.layout.pageSize.height],
            margins: { top: 0, left: 0, right: 0, bottom: 0 },
            autoFirstPage: false,
            bufferPages: false
        });
        const outputStream = new NodeWriteStreamAdapter(outputPath);
        context.pipe(outputStream as any);

        const renderer = new Renderer(config, false, runtime);
        await renderer.render(pages, context);
        await outputStream.waitForFinish();
        return true;
    } catch (error) {
        console.warn(`[generate-async-thought-board] PDF skipped: ${error instanceof Error ? error.message : String(error)}`);
        return false;
    }
}

async function main(): Promise<void> {
    const outputDir = path.resolve(resolveArg('--output-dir') || DEFAULT_OUTPUT_DIR);
    const outputBase = path.join(outputDir, 'async-thought-board');
    const snapshotPath = path.resolve(resolveArg('--snapshot') || `${outputBase}.pages.json`);
    const timelinePath = path.resolve(resolveArg('--timeline') || `${outputBase}.timeline.json`);
    const pdfPath = path.resolve(resolveArg('--pdf') || `${outputBase}.pdf`);
    const skipPdf = hasFlag('--no-pdf');

    fs.mkdirSync(path.dirname(snapshotPath), { recursive: true });
    fs.mkdirSync(path.dirname(timelinePath), { recursive: true });
    fs.mkdirSync(path.dirname(pdfPath), { recursive: true });

    const LocalFontManager = await loadLocalFontManager();
    const runtime = createPrintEngineRuntime({ fontManager: new LocalFontManager() });
    const config = buildConfig();
    const engine = new LayoutEngine(config, runtime);
    engine.setPackagerFactory(reactiveProofPackagerFactory);
    await engine.waitForFonts();

    const pages = await engine.simulateAsync(buildElements(), { timeoutMs: 4000, maxAsyncReplayPasses: 6 });
    const timeline = engine.getLastSimulationReportReader().get(simulationArtifactKeys.temporalPresentationTimeline) as unknown[] || [];
    fs.writeFileSync(snapshotPath, JSON.stringify(snapshotPages(pages), null, 2) + '\n', 'utf8');
    fs.writeFileSync(timelinePath, JSON.stringify(timeline, null, 2) + '\n', 'utf8');
    console.log(`[generate-async-thought-board] snapshot=${snapshotPath}`);
    console.log(`[generate-async-thought-board] timeline=${timelinePath}`);
    console.log(`[generate-async-thought-board] pages=${pages.length}`);

    if (!skipPdf) {
        const pdfWritten = await maybeRenderPdf(pages, config, pdfPath, runtime);
        if (pdfWritten) {
            console.log(`[generate-async-thought-board] pdf=${pdfPath}`);
        }
    }
}

main().catch((error) => {
    console.error('[generate-async-thought-board] FAILED', error);
    process.exit(1);
});
