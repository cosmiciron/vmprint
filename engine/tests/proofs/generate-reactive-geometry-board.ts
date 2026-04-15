import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { LayoutEngine } from '../../src/engine/layout-engine';
import { ContextRenderer } from '../../src/engine/context-renderer';
import { createPrintEngineRuntime } from '../../src/font-management/runtime';
import type { Element, LayoutConfig, Page } from '../../src/engine/types';
import { simulationArtifactKeys } from '../../src/engine/layout/simulation-report';
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
            pageSize: { width: 520, height: 460 },
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
            content: 'Actor Activation Board: Geometry',
            properties: {
                sourceId: 'activation-geometry-heading',
                style: {
                    textAlign: 'center',
                    fontWeight: 700,
                    fontSize: 18,
                    marginTop: 0,
                    marginBottom: 14
                }
            }
        },
        {
            type: 'p',
            content: 'Pinned actor grows after wake. Upstream stays fixed. Downstream replays.',
            properties: { sourceId: 'activation-geometry-intro' }
        },
        {
            type: 'test-replay-marker',
            content: '',
            properties: {
                sourceId: 'activation-geometry-prelude',
                style: { marginTop: 6, marginBottom: 8 },
                _testReplayMarker: {
                    title: 'Upstream Marker\nMust stay at Render Count: 1',
                    backgroundColor: '#fee2e2',
                    borderColor: '#dc2626',
                    color: '#7f1d1d',
                    height: 60
                }
            }
        },
        {
            type: 'test-signal-observer',
            content: '',
            properties: {
                sourceId: 'activation-geometry-observer',
                style: { marginTop: 8, marginBottom: 8 },
                _actorSignalObserve: {
                    topic: 'activation-geometry-entry',
                    title: 'Pinned Geometry Actor\nState: grows after wake\nUpdate: geometry',
                    renderMode: 'collector-list',
                    backgroundColor: '#fef3c7',
                    borderColor: '#d97706',
                    color: '#92400e',
                    emptyLabel: 'Dormant -> no committed labels yet',
                    baseHeight: 70,
                    growthPerSignal: 46
                }
            }
        },
        {
            type: 'test-replay-marker',
            content: '',
            properties: {
                sourceId: 'activation-geometry-downstream',
                style: { marginTop: 6, marginBottom: 8 },
                _testReplayMarker: {
                    title: 'Downstream Marker\nShould replay after settle',
                    backgroundColor: '#dbeafe',
                    borderColor: '#2563eb',
                    color: '#1e3a8a',
                    height: 60
                }
            }
        },
        {
            type: 'p',
            content: 'Downstream Region\nThis zone should shift after resettlement.\nReplay marker below proves the shift happened.',
            properties: {
                sourceId: 'activation-geometry-bridge',
                style: {
                    marginBottom: 8,
                    paddingTop: 10,
                    paddingRight: 10,
                    paddingBottom: 10,
                    paddingLeft: 10,
                    backgroundColor: '#f3f4f6',
                    borderColor: '#9ca3af',
                    borderWidth: 1,
                    color: '#374151',
                    height: 76
                }
            }
        },
        {
            type: 'test-signal-publisher',
            content: 'Event Source Tile\nTopic: activation-geometry-entry\nCommitted Label: Wake the actor',
            properties: {
                sourceId: 'activation-geometry-publisher',
                style: {
                    height: 78,
                    marginBottom: 8,
                    paddingTop: 10,
                    paddingRight: 10,
                    paddingBottom: 10,
                    paddingLeft: 10,
                    backgroundColor: '#dcfce7',
                    borderColor: '#16a34a',
                    borderWidth: 2,
                    color: '#166534',
                    fontWeight: 700
                },
                _actorSignalPublish: {
                    topic: 'activation-geometry-entry',
                    signalKey: 'activation-geometry-entry:1',
                    payload: { label: 'Wake the actor' }
                }
            }
        },
        {
            type: 'p',
            content: 'Expected Result\nGeometry actor grows.\nUpstream marker stays at 1.\nDownstream marker increments.',
            properties: {
                sourceId: 'activation-geometry-outro',
                style: {
                    marginBottom: 0,
                    paddingTop: 10,
                    paddingRight: 10,
                    paddingBottom: 10,
                    paddingLeft: 10,
                    backgroundColor: '#eef2ff',
                    borderColor: '#6366f1',
                    borderWidth: 1,
                    color: '#3730a3',
                    height: 70
                }
            }
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

        const renderer = new ContextRenderer(config, false, runtime);
        await renderer.render(pages, context);
        await outputStream.waitForFinish();
        return true;
    } catch (error) {
        console.warn(`[generate-reactive-geometry-board] PDF skipped: ${error instanceof Error ? error.message : String(error)}`);
        return false;
    }
}

async function main(): Promise<void> {
    const outputDir = path.resolve(resolveArg('--output-dir') || DEFAULT_OUTPUT_DIR);
    const outputBase = path.join(outputDir, 'reactive-geometry-board');
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

    const pages = engine.simulate(buildElements());
    const timeline = engine.getLastSimulationReportReader().get(simulationArtifactKeys.temporalPresentationTimeline) as unknown[] || [];
    fs.writeFileSync(snapshotPath, JSON.stringify(snapshotPages(pages), null, 2) + '\n', 'utf8');
    fs.writeFileSync(timelinePath, JSON.stringify(timeline, null, 2) + '\n', 'utf8');
    console.log(`[generate-reactive-geometry-board] snapshot=${snapshotPath}`);
    console.log(`[generate-reactive-geometry-board] timeline=${timelinePath}`);
    console.log(`[generate-reactive-geometry-board] pages=${pages.length}`);

    if (!skipPdf) {
        const pdfWritten = await maybeRenderPdf(pages, config, pdfPath, runtime);
        if (pdfWritten) {
            console.log(`[generate-reactive-geometry-board] pdf=${pdfPath}`);
        }
    }
}

main().catch((error) => {
    console.error('[generate-reactive-geometry-board] FAILED', error);
    process.exit(1);
});
