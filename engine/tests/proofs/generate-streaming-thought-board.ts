import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { LayoutEngine } from '../../src/engine/layout-engine';
import { Renderer } from '../../src/engine/renderer';
import { createEngineRuntime } from '../../src/engine/runtime';
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
            pageSize: { width: 560, height: 400 },
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
            content: 'Streaming Thought Board',
            properties: {
                sourceId: 'streaming-thought-heading',
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
            content: 'This board proves that a delayed thought can unfold in many small committed stages instead of appearing all at once.',
            properties: { sourceId: 'streaming-thought-intro' }
        },
        {
            type: 'test-async-thought',
            content: '',
            properties: {
                sourceId: 'streaming-thought-actor',
                style: { marginTop: 8, marginBottom: 10 },
                _asyncThought: {
                    title: 'Thought Lobe Stream',
                    pendingLabel: 'Listening for an external chain of thought...',
                    baseHeight: 68,
                    resolvedHeight: 160,
                    geometryOnResolve: true,
                    stages: [
                        {
                            label: 'Stage 1: contact.',
                            delayMs: 320,
                            height: 74
                        },
                        {
                            label: 'Stage 2: contact established.',
                            delayMs: 320,
                            height: 82
                        },
                        {
                            label: 'Stage 3: contact established, signal stabilizing.',
                            delayMs: 320,
                            height: 92
                        },
                        {
                            label: 'Stage 4: contact established, signal stabilizing, pattern recognized.',
                            delayMs: 320,
                            height: 106
                        },
                        {
                            label: 'Stage 5: contact established, signal stabilizing, pattern recognized, confidence rising.',
                            delayMs: 320,
                            height: 122
                        },
                        {
                            label: 'Stage 6: contact established, signal stabilizing, pattern recognized, confidence rising, committed insight arrives.',
                            delayMs: 320,
                            height: 138
                        },
                        {
                            label: 'Stage 7: contact established, signal stabilizing, pattern recognized, confidence rising, committed insight arrives, geometry makes room.',
                            delayMs: 320,
                            height: 150
                        }
                    ]
                }
            }
        },
        {
            type: 'test-replay-marker',
            content: '',
            properties: {
                sourceId: 'streaming-thought-downstream',
                _testReplayMarker: {
                    title: 'Downstream Region\nShould keep shifting as thought streams in',
                    backgroundColor: '#dbeafe',
                    borderColor: '#2563eb',
                    color: '#1e3a8a',
                    height: 60
                }
            }
        },
        {
            type: 'p',
            content: 'The world slice should preserve each intermediate stage so playback can show thought becoming geometry over time, not merely jumping from pending to done.',
            properties: { sourceId: 'streaming-thought-outro' }
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
        console.warn(`[generate-streaming-thought-board] PDF skipped: ${error instanceof Error ? error.message : String(error)}`);
        return false;
    }
}

async function main(): Promise<void> {
    const outputDir = path.resolve(resolveArg('--output-dir') || DEFAULT_OUTPUT_DIR);
    const outputBase = path.join(outputDir, 'streaming-thought-board');
    const snapshotPath = path.resolve(resolveArg('--snapshot') || `${outputBase}.pages.json`);
    const timelinePath = path.resolve(resolveArg('--timeline') || `${outputBase}.timeline.json`);
    const pdfPath = path.resolve(resolveArg('--pdf') || `${outputBase}.pdf`);
    const skipPdf = hasFlag('--no-pdf');

    fs.mkdirSync(path.dirname(snapshotPath), { recursive: true });
    fs.mkdirSync(path.dirname(timelinePath), { recursive: true });
    fs.mkdirSync(path.dirname(pdfPath), { recursive: true });

    const LocalFontManager = await loadLocalFontManager();
    const runtime = createEngineRuntime({ fontManager: new LocalFontManager() });
    const config = buildConfig();
    const engine = new LayoutEngine(config, runtime);
    engine.setPackagerFactory(reactiveProofPackagerFactory);
    await engine.waitForFonts();

    const pages = await engine.simulateAsync(buildElements(), { timeoutMs: 5000, maxAsyncReplayPasses: 12 });
    const timeline = engine.getLastSimulationReportReader().get(simulationArtifactKeys.temporalPresentationTimeline) as unknown[] || [];
    fs.writeFileSync(snapshotPath, JSON.stringify(snapshotPages(pages), null, 2) + '\n', 'utf8');
    fs.writeFileSync(timelinePath, JSON.stringify(timeline, null, 2) + '\n', 'utf8');
    console.log(`[generate-streaming-thought-board] snapshot=${snapshotPath}`);
    console.log(`[generate-streaming-thought-board] timeline=${timelinePath}`);
    console.log(`[generate-streaming-thought-board] pages=${pages.length}`);

    if (!skipPdf) {
        const pdfWritten = await maybeRenderPdf(pages, config, pdfPath, runtime);
        if (pdfWritten) {
            console.log(`[generate-streaming-thought-board] pdf=${pdfPath}`);
        }
    }
}

main().catch((error) => {
    console.error('[generate-streaming-thought-board] FAILED', error);
    process.exit(1);
});
