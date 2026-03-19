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

type CollectorSpec = {
    id: string;
    topic: string;
    title: string;
    background: string;
    border: string;
    color: string;
};

type PublisherSpec = {
    id: string;
    topic: string;
    label: string;
    background: string;
    border: string;
    color: string;
};

const COLLECTORS: CollectorSpec[] = [
    {
        id: 'alpha',
        topic: 'dual-collector-alpha-entry',
        title: 'Dual Collector Alpha',
        background: '#eff6ff',
        border: '#2563eb',
        color: '#1e3a8a'
    },
    {
        id: 'beta',
        topic: 'dual-collector-beta-entry',
        title: 'Dual Collector Beta',
        background: '#fefce8',
        border: '#ca8a04',
        color: '#854d0e'
    }
];

const PUBLISHERS: PublisherSpec[] = [
    { id: 'alpha-1', topic: 'dual-collector-alpha-entry', label: 'Alpha 1: Signal Fire', background: '#dbeafe', border: '#2563eb', color: '#1e3a8a' },
    { id: 'beta-1', topic: 'dual-collector-beta-entry', label: 'Beta 1: Echo Vale', background: '#fef3c7', border: '#d97706', color: '#92400e' },
    { id: 'alpha-2', topic: 'dual-collector-alpha-entry', label: 'Alpha 2: Lantern Shore', background: '#dbeafe', border: '#2563eb', color: '#1e3a8a' },
    { id: 'beta-2', topic: 'dual-collector-beta-entry', label: 'Beta 2: Hollow Drum', background: '#fef3c7', border: '#d97706', color: '#92400e' },
    { id: 'alpha-3', topic: 'dual-collector-alpha-entry', label: 'Alpha 3: Ridge Walk', background: '#dbeafe', border: '#2563eb', color: '#1e3a8a' },
    { id: 'beta-3', topic: 'dual-collector-beta-entry', label: 'Beta 3: Quiet Port', background: '#fef3c7', border: '#d97706', color: '#92400e' }
];

function buildVisualElements(): Element[] {
    const elements: Element[] = [
        {
            type: 'chapter-heading',
            content: 'Dual In-Flow Collector Proof',
            properties: {
                sourceId: 'dual-inflow-visual-heading',
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
            content: 'This proof document places two synthetic collectors near the front of the flow. Interleaved later publishers mature on later pages, and both collectors resettle their early space before the forward march resumes.',
            properties: { sourceId: 'dual-inflow-visual-intro' }
        }
    ];

    COLLECTORS.forEach((collector, index) => {
        elements.push({
            type: 'test-signal-observer',
            content: '',
            properties: {
                sourceId: `dual-inflow-collector-${collector.id}`,
                style: {
                    marginTop: index === 0 ? 12 : 8,
                    marginBottom: 10
                },
                _actorSignalObserve: {
                    topic: collector.topic,
                    title: collector.title,
                    renderMode: 'collector-list',
                    backgroundColor: collector.background,
                    borderColor: collector.border,
                    color: collector.color,
                    baseHeight: 62,
                    growthPerSignal: 24
                }
            }
        });
    });

    elements.push({
        type: 'p',
        content: longParagraph('Shared early aftermath keeps the front of the document occupied so both dual collectors must visibly reclaim space once later mature signals appear.'),
        properties: { sourceId: 'dual-inflow-early-aftermath-1' }
    });
    elements.push({
        type: 'p',
        content: longParagraph('More early aftermath extends the first settled region so dual collector invalidation becomes easy to spot in ordinary flow.'),
        properties: { sourceId: 'dual-inflow-early-aftermath-2' }
    });
    elements.push({
        type: 'p',
        content: longParagraph('Additional front-loaded aftermath keeps the early spatial region busy before the later interleaved publishers are reached.'),
        properties: { sourceId: 'dual-inflow-front-aftermath-3' }
    });

    PUBLISHERS.forEach((publisher, index) => {
        elements.push({
            type: 'test-signal-publisher',
            content: `Heading Publisher\n${publisher.label}`,
            properties: {
                sourceId: `dual-inflow-publisher-${publisher.id}`,
                style: {
                    height: 82,
                    marginBottom: 10,
                    paddingTop: 10,
                    paddingRight: 10,
                    paddingBottom: 10,
                    paddingLeft: 10,
                    backgroundColor: publisher.background,
                    borderColor: publisher.border,
                    borderWidth: 2,
                    color: publisher.color,
                    fontWeight: 700
                },
                _actorSignalPublish: {
                    topic: publisher.topic,
                    signalKey: `dual-inflow:${publisher.id}`,
                    payload: { label: publisher.label }
                }
            }
        });
        elements.push({
            type: 'p',
            content: longParagraph(`${publisher.label} filler keeps the dual collector proof marching into later pages.`),
            properties: {
                sourceId: `dual-inflow-filler-${publisher.id}`,
                style: {
                    marginBottom: 10,
                    paddingTop: 8,
                    paddingRight: 8,
                    paddingBottom: 8,
                    paddingLeft: 8,
                    backgroundColor: publisher.background,
                    borderColor: publisher.border,
                    borderWidth: 1,
                    color: publisher.color
                }
            }
        });
        elements.push({
            type: 'p',
            content: longParagraph(`Additional ${publisher.label} filler keeps later publishers interleaved and safely downstream from both collectors.`),
            properties: {
                sourceId: `dual-inflow-filler-extra-${publisher.id}`,
                style: {
                    marginBottom: index === PUBLISHERS.length - 1 ? 14 : 10,
                    paddingTop: 8,
                    paddingRight: 8,
                    paddingBottom: 8,
                    paddingLeft: 8,
                    backgroundColor: publisher.background,
                    borderColor: publisher.border,
                    borderWidth: 1,
                    color: publisher.color
                }
            }
        });
    });

    elements.push({
        type: 'p',
        content: longParagraph('Late aftermath proves the forward march resumes only after both collector invalidations settle from their later mature traffic.'),
        properties: { sourceId: 'dual-inflow-late-aftermath' }
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
    const defaultBase = path.resolve(SCRIPT_DIR, '..', '..', 'tests', 'output', 'actor-communication-dual-inflow-visual');
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

    console.log(`[actor-communication-dual-inflow-visual] pdf=${outputPath}`);
    console.log(`[actor-communication-dual-inflow-visual] snapshot=${snapshotPath}`);
    console.log(`[actor-communication-dual-inflow-visual] pages=${pages.length}`);
}

main().catch((error) => {
    console.error('[actor-communication-dual-inflow-visual] FAILED', error);
    process.exit(1);
});
