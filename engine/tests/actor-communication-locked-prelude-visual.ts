import fs from 'node:fs';
import path from 'node:path';
import { LayoutEngine, Renderer, createEngineRuntime } from '../src';
import type { Element, LayoutConfig, Page } from '../src/engine/types';
import PdfContext from '@vmprint/context-pdf';
import { loadLocalFontManager, snapshotPages } from './harness/engine-harness';

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

function repeatedParagraph(seed: string, repeatCount: number): string {
    return `${seed} `.repeat(repeatCount).trim();
}

function buildVisualConfig(): LayoutConfig {
    return {
        layout: {
            pageSize: { width: 360, height: 480 },
            margins: { top: 24, right: 24, bottom: 24, left: 24 },
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

function buildVisualElements(): Element[] {
    return [
        {
            type: 'chapter-heading',
            content: 'Locked Prelude Precision Proof',
            properties: {
                sourceId: 'locked-prelude-heading',
                style: {
                    textAlign: 'center',
                    fontWeight: 700,
                    fontSize: 18,
                    marginTop: 0,
                    marginBottom: 18
                }
            }
        },
        {
            type: 'p',
            content: 'This proof keeps a replay marker before the collector frontier. If settling restores from a later anchored checkpoint, the marker should stay at Render Count: 1 even after the collector learns a later mature signal.',
            properties: { sourceId: 'locked-prelude-intro' }
        },
        {
            type: 'test-replay-marker',
            content: '',
            properties: {
                sourceId: 'locked-prelude-marker',
                style: { marginTop: 8, marginBottom: 10 },
                _testReplayMarker: {
                    title: 'Locked Prelude\nMust stay at Render Count: 1',
                    backgroundColor: '#fee2e2',
                    borderColor: '#dc2626',
                    color: '#7f1d1d',
                    height: 68
                }
            }
        },
        {
            type: 'test-signal-observer',
            content: '',
            properties: {
                sourceId: 'locked-prelude-collector',
                style: { marginTop: 8, marginBottom: 10 },
                _actorSignalObserve: {
                    topic: 'locked-prelude-entry',
                    title: 'Precision Collector',
                    renderMode: 'collector-list',
                    backgroundColor: '#f8fafc',
                    borderColor: '#475569',
                    color: '#0f172a',
                    baseHeight: 54,
                    growthPerSignal: 28
                }
            }
        },
        {
            type: 'p',
            content: repeatedParagraph('Early aftermath sits below the collector and should move, but the locked prelude above should not be replayed.', 7),
            properties: { sourceId: 'locked-prelude-aftermath-1' }
        },
        {
            type: 'test-signal-publisher',
            content: 'Heading Publisher\nAnchored Entry',
            properties: {
                sourceId: 'locked-prelude-publisher',
                style: {
                    height: 72,
                    marginBottom: 10,
                    paddingTop: 10,
                    paddingRight: 10,
                    paddingBottom: 10,
                    paddingLeft: 10,
                    backgroundColor: '#dbeafe',
                    borderColor: '#2563eb',
                    borderWidth: 2,
                    color: '#1e3a8a',
                    fontWeight: 700
                },
                _actorSignalPublish: {
                    topic: 'locked-prelude-entry',
                    signalKey: 'locked-prelude-entry:1',
                    payload: { label: 'Anchored Entry' }
                }
            }
        },
        {
            type: 'p',
            content: repeatedParagraph('Late aftermath proves the world resumed after the collector learned the later mature signal.', 5),
            properties: { sourceId: 'locked-prelude-aftermath-2' }
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
    const defaultBase = path.resolve(process.cwd(), 'engine', 'tests', 'output', 'actor-communication-locked-prelude-visual');
    const outputPath = path.resolve(outputArg || `${defaultBase}.pdf`);
    const snapshotPath = path.resolve(snapshotArg || `${defaultBase}.pages.json`);

    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.mkdirSync(path.dirname(snapshotPath), { recursive: true });

    const LocalFontManager = await loadLocalFontManager();
    const runtime = createEngineRuntime({ fontManager: new LocalFontManager() });
    const config = buildVisualConfig();
    const engine = new LayoutEngine(config, runtime);

    await engine.waitForFonts();
    const pages = engine.paginate(buildVisualElements());

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

    fs.writeFileSync(snapshotPath, JSON.stringify(summarizePages(pages), null, 2) + '\n', 'utf8');

    console.log(`[actor-communication-locked-prelude-visual] pdf=${outputPath}`);
    console.log(`[actor-communication-locked-prelude-visual] snapshot=${snapshotPath}`);
    console.log(`[actor-communication-locked-prelude-visual] pages=${pages.length}`);
}

main().catch((error) => {
    console.error('[actor-communication-locked-prelude-visual] FAILED', error);
    process.exit(1);
});
