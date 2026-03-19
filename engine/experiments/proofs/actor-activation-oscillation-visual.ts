import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LayoutEngine, Renderer, createEngineRuntime } from '../../src';
import type { Element, LayoutConfig, Page } from '../../src/engine/types';
import PdfContext from '@vmprint/context-pdf';
import { experimentFactory } from '../packagers/experiment-factory';
import { loadLocalFontManager, snapshotPages } from '../../tests/harness/engine-harness';

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

function buildVisualConfig(): LayoutConfig {
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

function buildOscillationProbeElements(): Element[] {
    return [
        {
            type: 'test-signal-observer',
            content: '',
            properties: {
                sourceId: 'activation-oscillation-observer',
                style: { marginTop: 8, marginBottom: 8 },
                _actorSignalObserve: {
                    topic: 'activation-oscillation-entry',
                    title: 'Oscillation Probe',
                    renderMode: 'collector-list',
                    backgroundColor: '#fee2e2',
                    borderColor: '#dc2626',
                    color: '#7f1d1d',
                    baseHeight: 60,
                    growthPerSignal: 0,
                    oscillateHeights: [96, 132]
                }
            }
        },
        {
            type: 'test-replay-marker',
            content: '',
            properties: {
                sourceId: 'activation-oscillation-marker',
                style: { marginTop: 6, marginBottom: 8 },
                _testReplayMarker: {
                    title: 'Downstream Marker',
                    backgroundColor: '#dbeafe',
                    borderColor: '#2563eb',
                    color: '#1e3a8a',
                    height: 52
                }
            }
        },
        {
            type: 'p',
            content: 'Downstream Region\nStable committed space makes the loop meaningful.',
            properties: {
                sourceId: 'activation-oscillation-filler-1',
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
                    height: 72
                }
            }
        },
        {
            type: 'test-signal-publisher',
            content: 'Event Source Tile\nTopic: activation-oscillation-entry\nCommitted Label: Frozen fact',
            properties: {
                sourceId: 'activation-oscillation-publisher',
                style: {
                    height: 72,
                    marginBottom: 8,
                    paddingTop: 10,
                    paddingRight: 10,
                    paddingBottom: 10,
                    paddingLeft: 10,
                    backgroundColor: '#ecfccb',
                    borderColor: '#65a30d',
                    borderWidth: 2,
                    color: '#365314',
                    fontWeight: 700
                },
                _actorSignalPublish: {
                    topic: 'activation-oscillation-entry',
                    signalKey: 'activation-oscillation-entry:1',
                    payload: { label: 'Frozen fact' }
                }
            }
        }
    ];
}

function buildDiagnosticElements(errorMessage: string): Element[] {
    return [
        {
            type: 'chapter-heading',
            content: 'Actor Activation Board: Oscillation Stop',
            properties: {
                sourceId: 'activation-oscillation-heading',
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
            content: 'This board intentionally drives a reactive geometry loop on unchanged committed facts. The engine must stop deterministically instead of silently churning.',
            properties: { sourceId: 'activation-oscillation-intro' }
        },
        {
            type: 'p',
            content: 'State Trail\n1. Dormant actor\n2. Signal wake\n3. Geometry proposal A\n4. Resettle\n5. Geometry proposal B\n6. Resettle\n7. Deterministic stop',
            properties: {
                sourceId: 'activation-oscillation-state-trail',
                style: {
                    marginBottom: 10,
                    paddingTop: 10,
                    paddingRight: 10,
                    paddingBottom: 10,
                    paddingLeft: 10,
                    backgroundColor: '#fef3c7',
                    borderColor: '#d97706',
                    borderWidth: 2,
                    color: '#92400e',
                    fontWeight: 700
                }
            }
        },
        {
            type: 'p',
            content: `Engine Stop Reason\n${errorMessage}`,
            properties: {
                sourceId: 'activation-oscillation-stop-reason',
                style: {
                    marginBottom: 10,
                    paddingTop: 10,
                    paddingRight: 10,
                    paddingBottom: 10,
                    paddingLeft: 10,
                    backgroundColor: '#fee2e2',
                    borderColor: '#dc2626',
                    borderWidth: 2,
                    color: '#7f1d1d',
                    fontWeight: 700
                }
            }
        },
        {
            type: 'p',
            content: 'Expected Result\nBoard ends in hard stop state.\nNo endless replay.',
            properties: { sourceId: 'activation-oscillation-outro' }
        }
    ];
}

function summarizePages(pages: Page[]): unknown {
    return snapshotPages(pages);
}

function resolveArg(flag: string): string | undefined {
    const index = process.argv.indexOf(flag);
    if (index === -1) return undefined;
    return process.argv[index + 1];
}

async function main(): Promise<void> {
    const outputArg = resolveArg('--output');
    const snapshotArg = resolveArg('--snapshot');
    const defaultBase = path.resolve(SCRIPT_DIR, '..', '..', 'tests', 'output', 'actor-activation-oscillation-visual');
    const outputPath = path.resolve(outputArg || `${defaultBase}.pdf`);
    const snapshotPath = path.resolve(snapshotArg || `${defaultBase}.pages.json`);

    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.mkdirSync(path.dirname(snapshotPath), { recursive: true });

    const LocalFontManager = await loadLocalFontManager();
    const runtime = createEngineRuntime({ fontManager: new LocalFontManager() });
    const config = buildVisualConfig();
    const engine = new LayoutEngine(config, runtime);
    engine.setPackagerFactory(experimentFactory);
    await engine.waitForFonts();

    let errorMessage = 'No stop was triggered.';
    try {
        engine.simulate(buildOscillationProbeElements());
        errorMessage = 'Unexpectedly completed without a deterministic stop.';
    } catch (error) {
        errorMessage = error instanceof Error ? error.message : String(error);
    }

    const pages = engine.simulate(buildDiagnosticElements(errorMessage));

    const context = new PdfContext({
        size: [520, 360],
        margins: { top: 0, left: 0, right: 0, bottom: 0 },
        autoFirstPage: false,
        bufferPages: false
    });
    const outputStream = new NodeWriteStreamAdapter(outputPath);
    context.pipe(outputStream as any);

    const renderer = new Renderer(config, false, runtime);
    await renderer.render(pages, context);
    await outputStream.waitForFinish();

    fs.writeFileSync(snapshotPath, JSON.stringify(summarizePages(pages), null, 2) + '\n', 'utf8');

    console.log(`[actor-activation-oscillation-visual] pdf=${outputPath}`);
    console.log(`[actor-activation-oscillation-visual] snapshot=${snapshotPath}`);
    console.log(`[actor-activation-oscillation-visual] pages=${pages.length}`);
}

main().catch((error) => {
    console.error('[actor-activation-oscillation-visual] FAILED', error);
    process.exit(1);
});
