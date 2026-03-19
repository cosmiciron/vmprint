import fs from 'node:fs';
import path from 'node:path';
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
            content: 'Same-Page Frontier Proof',
            properties: {
                sourceId: 'same-page-frontier-heading',
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
            content: 'This proof keeps the collector and the later publisher on the same page. The collector should still learn the later mature signal and resettle before any page-boundary checkpoint is needed.',
            properties: { sourceId: 'same-page-frontier-intro' }
        },
        {
            type: 'test-signal-observer',
            content: '',
            properties: {
                sourceId: 'same-page-frontier-collector',
                style: { marginTop: 12, marginBottom: 10 },
                _actorSignalObserve: {
                    topic: 'same-page-frontier-entry',
                    title: 'Same-Page Collector',
                    renderMode: 'collector-list',
                    backgroundColor: '#f8fafc',
                    borderColor: '#475569',
                    color: '#0f172a',
                    baseHeight: 56,
                    growthPerSignal: 28
                }
            }
        },
        {
            type: 'p',
            content: repeatedParagraph('Early aftermath occupies the first page so the collector must reclaim space before the page ever turns.', 8),
            properties: { sourceId: 'same-page-frontier-aftermath-1' }
        },
        {
            type: 'test-signal-publisher',
            content: 'Heading Publisher\nSame Page Entry',
            properties: {
                sourceId: 'same-page-frontier-publisher',
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
                    topic: 'same-page-frontier-entry',
                    signalKey: 'same-page-frontier-entry:1',
                    payload: { label: 'Same Page Entry' }
                }
            }
        },
        {
            type: 'p',
            content: repeatedParagraph('Late aftermath stays on the first page too, proving the settle happened at an actor boundary rather than waiting for a page checkpoint.', 6),
            properties: { sourceId: 'same-page-frontier-aftermath-2' }
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
    const defaultBase = path.resolve(process.cwd(), 'engine', 'tests', 'output', 'actor-communication-same-page-frontier-visual');
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
    const pages = engine.simulate(buildVisualElements());

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

    console.log(`[actor-communication-same-page-frontier-visual] pdf=${outputPath}`);
    console.log(`[actor-communication-same-page-frontier-visual] snapshot=${snapshotPath}`);
    console.log(`[actor-communication-same-page-frontier-visual] pages=${pages.length}`);
}

main().catch((error) => {
    console.error('[actor-communication-same-page-frontier-visual] FAILED', error);
    process.exit(1);
});
