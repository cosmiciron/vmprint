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

type CollectorPublisherSpec = {
    id: string;
    label: string;
    pastelBackground: string;
    pastelBorder: string;
    pastelText: string;
};

const COLLECTOR_PUBLISHERS: CollectorPublisherSpec[] = [
    { id: 'one', label: 'Chapter 1: Signal Fire', pastelBackground: '#dbeafe', pastelBorder: '#2563eb', pastelText: '#1e3a8a' },
    { id: 'two', label: 'Chapter 2: Echo Valley', pastelBackground: '#fef3c7', pastelBorder: '#d97706', pastelText: '#92400e' },
    { id: 'three', label: 'Chapter 3: Lantern Shore', pastelBackground: '#e0f2fe', pastelBorder: '#0891b2', pastelText: '#155e75' },
    { id: 'four', label: 'Chapter 4: Ridge of Glass', pastelBackground: '#fce7f3', pastelBorder: '#db2777', pastelText: '#9d174d' },
    { id: 'five', label: 'Chapter 5: Hollow Drum', pastelBackground: '#ede9fe', pastelBorder: '#7c3aed', pastelText: '#5b21b6' },
    { id: 'six', label: 'Chapter 6: Cedar Crossing', pastelBackground: '#dcfce7', pastelBorder: '#16a34a', pastelText: '#166534' },
    { id: 'seven', label: 'Chapter 7: Quiet Port', pastelBackground: '#fae8ff', pastelBorder: '#c026d3', pastelText: '#86198f' },
    { id: 'eight', label: 'Chapter 8: Ember Rain', pastelBackground: '#fee2e2', pastelBorder: '#dc2626', pastelText: '#991b1b' }
];

function buildCollectorPublisherSection(spec: CollectorPublisherSpec): Element[] {
    return [
        {
            type: 'test-signal-publisher',
            content: `Heading Publisher\n${spec.label}`,
            properties: {
                sourceId: `collector-visual-publisher-${spec.id}`,
                style: {
                    height: 82,
                    marginBottom: 10,
                    paddingTop: 10,
                    paddingRight: 10,
                    paddingBottom: 10,
                    paddingLeft: 10,
                    backgroundColor: spec.pastelBackground,
                    borderColor: spec.pastelBorder,
                    borderWidth: 2,
                    color: spec.pastelText,
                    fontWeight: 700
                },
                _actorSignalPublish: {
                    topic: 'collector-entry',
                    payload: { label: spec.label }
                }
            }
        },
        {
            type: 'p',
            content: longParagraph(`${spec.label} filler text keeps the collector test moving forward.`),
            properties: {
                sourceId: `collector-visual-filler-${spec.id}`,
                style: {
                    marginBottom: 10,
                    paddingTop: 8,
                    paddingRight: 8,
                    paddingBottom: 8,
                    paddingLeft: 8,
                    backgroundColor: spec.pastelBackground,
                    borderColor: spec.pastelBorder,
                    borderWidth: 1,
                    color: spec.pastelText
                }
            }
        }
    ];
}

function buildVisualElements(): Element[] {
    const elements: Element[] = [
        {
            type: 'chapter-heading',
            content: 'Synthetic Collector Visual Proof',
            properties: {
                sourceId: 'collector-visual-heading',
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
            content: 'This proof document shows a synthetic TOC-like collector built entirely from Test actors. The collector gathers labels from many publishers, grows into a numbered list, spans pages, and pushes the trailing body text downward.',
            properties: { sourceId: 'collector-visual-intro' }
        }
    ];

    for (const spec of COLLECTOR_PUBLISHERS) {
        elements.push(...buildCollectorPublisherSection(spec));
    }

    elements.push(
        {
            type: 'test-signal-observer',
            content: '',
            properties: {
                sourceId: 'collector-visual-observer',
                style: {
                    marginTop: 12,
                    marginBottom: 12
                },
                _actorSignalObserve: {
                    topic: 'collector-entry',
                    title: 'Synthetic Collector',
                    renderMode: 'collector-list',
                    backgroundColor: '#f8fafc',
                    borderColor: '#475569',
                    color: '#0f172a',
                    baseHeight: 100,
                    growthPerSignal: 34
                }
            }
        },
        {
            type: 'p',
            content: longParagraph('Trailing aftermath text should appear only after the collector has finished claiming space, proving that the collector has real spatial consequence in ordinary flow.'),
            properties: {
                sourceId: 'collector-visual-aftermath'
            }
        }
    );

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
    const defaultBase = path.resolve(SCRIPT_DIR, '..', '..', 'tests', 'output', 'actor-communication-collector-visual');
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

    console.log(`[actor-communication-collector-visual] pdf=${outputPath}`);
    console.log(`[actor-communication-collector-visual] snapshot=${snapshotPath}`);
    console.log(`[actor-communication-collector-visual] pages=${pages.length}`);
}

main().catch((error) => {
    console.error('[actor-communication-collector-visual] FAILED', error);
    process.exit(1);
});
