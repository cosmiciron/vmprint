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

function buildVisualConfig(): LayoutConfig {
    return {
        layout: {
            pageSize: { width: 360, height: 260 },
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

function longParagraph(seed: string): string {
    return `${seed} `.repeat(40).trim();
}

type PublisherSpec = {
    id: string;
    label: string;
    background: string;
    border: string;
    color: string;
};

const PUBLISHERS: PublisherSpec[] = [
    { id: 'one', label: 'Chapter 1: Signal Fire', background: '#dbeafe', border: '#2563eb', color: '#1e3a8a' },
    { id: 'two', label: 'Chapter 2: Echo Valley', background: '#fef3c7', border: '#d97706', color: '#92400e' },
    { id: 'three', label: 'Chapter 3: Lantern Shore', background: '#e0f2fe', border: '#0891b2', color: '#155e75' },
    { id: 'four', label: 'Chapter 4: Ridge of Glass', background: '#fce7f3', border: '#db2777', color: '#9d174d' }
];

function buildVisualElements(): Element[] {
    const elements: Element[] = [
        {
            type: 'chapter-heading',
            content: 'Synthetic In-Flow Collector Proof',
            properties: {
                sourceId: 'inflow-collector-visual-heading',
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
            content: 'This proof document places a synthetic collector near the front of the flow. Later publishers emit mature signals on later pages, and the collector resettles earlier space without restarting the whole document.',
            properties: { sourceId: 'inflow-collector-visual-intro' }
        },
        {
            type: 'test-signal-observer',
            content: '',
            properties: {
                sourceId: 'inflow-collector-visual-collector',
                style: {
                    marginTop: 12,
                    marginBottom: 12
                },
                _actorSignalObserve: {
                    topic: 'inflow-collector-entry',
                    title: 'Synthetic In-Flow Collector',
                    renderMode: 'collector-list',
                    backgroundColor: '#f8fafc',
                    borderColor: '#475569',
                    color: '#0f172a',
                    baseHeight: 72,
                    growthPerSignal: 30
                }
            }
        },
        {
            type: 'p',
            content: longParagraph('Trailing aftermath text lives near the front and should be pushed down once the collector learns from later mature signals.'),
            properties: { sourceId: 'inflow-collector-aftermath-1' }
        },
        {
            type: 'p',
            content: longParagraph('More aftermath text extends the early spatial region so the collector resettling becomes visually obvious in ordinary flow.'),
            properties: { sourceId: 'inflow-collector-aftermath-2' }
        },
        {
            type: 'p',
            content: longParagraph('Still more aftermath text keeps the early region occupied before the later publishers are encountered.'),
            properties: { sourceId: 'inflow-collector-aftermath-3' }
        }
    ];

    for (const spec of PUBLISHERS) {
        elements.push({
            type: 'test-signal-publisher',
            content: `Heading Publisher\n${spec.label}`,
            properties: {
                sourceId: `inflow-collector-publisher-${spec.id}`,
                style: {
                    height: 82,
                    marginBottom: 10,
                    paddingTop: 10,
                    paddingRight: 10,
                    paddingBottom: 10,
                    paddingLeft: 10,
                    backgroundColor: spec.background,
                    borderColor: spec.border,
                    borderWidth: 2,
                    color: spec.color,
                    fontWeight: 700
                },
                _actorSignalPublish: {
                    topic: 'inflow-collector-entry',
                    signalKey: `inflow-collector-entry:${spec.id}`,
                    payload: { label: spec.label }
                }
            }
        });
        elements.push({
            type: 'p',
            content: longParagraph(`${spec.label} filler text keeps the collector proof marching forward into later pages.`),
            properties: {
                sourceId: `inflow-collector-filler-${spec.id}`,
                style: {
                    marginBottom: 10,
                    paddingTop: 8,
                    paddingRight: 8,
                    paddingBottom: 8,
                    paddingLeft: 8,
                    backgroundColor: spec.background,
                    borderColor: spec.border,
                    borderWidth: 1,
                    color: spec.color
                }
            }
        });
        elements.push({
            type: 'p',
            content: longParagraph(`Additional ${spec.label} filler text keeps the publishers safely downstream from the collector.`),
            properties: {
                sourceId: `inflow-collector-filler-extra-${spec.id}`,
                style: {
                    marginBottom: 10,
                    paddingTop: 8,
                    paddingRight: 8,
                    paddingBottom: 8,
                    paddingLeft: 8,
                    backgroundColor: spec.background,
                    borderColor: spec.border,
                    borderWidth: 1,
                    color: spec.color
                }
            }
        });
    }

    elements.push({
        type: 'p',
        content: longParagraph('Late aftermath text proves the forward march resumes after the world settles from the collector invalidation.'),
        properties: { sourceId: 'inflow-collector-late-aftermath' }
    });

    return elements;
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
    const defaultBase = path.resolve(process.cwd(), 'engine', 'tests', 'output', 'actor-communication-inflow-collector-visual');
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

    console.log(`[actor-communication-inflow-collector-visual] pdf=${outputPath}`);
    console.log(`[actor-communication-inflow-collector-visual] snapshot=${snapshotPath}`);
    console.log(`[actor-communication-inflow-collector-visual] pages=${pages.length}`);
}

main().catch((error) => {
    console.error('[actor-communication-inflow-collector-visual] FAILED', error);
    process.exit(1);
});
