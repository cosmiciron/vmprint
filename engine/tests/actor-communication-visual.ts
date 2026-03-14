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
    return `${seed} `.repeat(48).trim();
}

type PublisherVisualSpec = {
    id: string;
    name: string;
    label: string;
    bodySeed: string;
    topic: string;
    pastelBackground: string;
    pastelBorder: string;
    pastelText: string;
};

const PUBLISHER_SPECS: PublisherVisualSpec[] = [
    {
        id: 'alpha',
        name: 'Publisher Alpha',
        label: 'Alpha Ridge',
        bodySeed: 'Alpha ridge filler body text keeps the world moving forward.',
        topic: 'outline-entry',
        pastelBackground: '#dbeafe',
        pastelBorder: '#2563eb',
        pastelText: '#1e3a8a'
    },
    {
        id: 'beta',
        name: 'Publisher Beta',
        label: 'Beta Hollow',
        bodySeed: 'Beta hollow filler body text forces the publishers to spread across pages.',
        topic: 'outline-entry',
        pastelBackground: '#fef3c7',
        pastelBorder: '#d97706',
        pastelText: '#92400e'
    },
    {
        id: 'gamma',
        name: 'Publisher Gamma',
        label: 'Gamma Harbour',
        bodySeed: 'Gamma harbour filler body text keeps the observer safely downstream.',
        topic: 'outline-entry',
        pastelBackground: '#e0f2fe',
        pastelBorder: '#0891b2',
        pastelText: '#155e75'
    },
    {
        id: 'delta',
        name: 'Publisher Delta',
        label: 'Delta Lantern',
        bodySeed: 'Delta lantern filler body text gives the observer enough incoming traffic to become visibly larger.',
        topic: 'outline-entry',
        pastelBackground: '#fce7f3',
        pastelBorder: '#db2777',
        pastelText: '#9d174d'
    }
];

function buildPublisherSection(spec: PublisherVisualSpec): Element[] {
    const publisherStyle = {
        height: 138,
        marginBottom: 12,
        paddingTop: 12,
        paddingRight: 12,
        paddingBottom: 12,
        paddingLeft: 12,
        backgroundColor: spec.pastelBackground,
        borderColor: spec.pastelBorder,
        borderWidth: 2,
        color: spec.pastelText,
        fontWeight: 700
    };

    const fillerStyle = {
        marginBottom: 12,
        paddingTop: 10,
        paddingRight: 10,
        paddingBottom: 10,
        paddingLeft: 10,
        backgroundColor: spec.pastelBackground,
        borderColor: spec.pastelBorder,
        borderWidth: 1,
        color: spec.pastelText
    };

    return [
        {
            type: 'test-signal-publisher',
            content: `${spec.name}\nTopic: ${spec.topic}\nLabel: ${spec.label}`,
            properties: {
                sourceId: `proof-publisher-${spec.id}`,
                style: publisherStyle,
                _actorSignalPublish: {
                    topic: spec.topic,
                    payload: { label: spec.label }
                }
            }
        },
        {
            type: 'p',
            content: longParagraph(spec.bodySeed),
            properties: {
                sourceId: `proof-filler-${spec.id}`,
                style: fillerStyle
            }
        }
    ];
}

function buildVisualElements(): Element[] {
    const observerStyle = {
        marginTop: 10,
        marginBottom: 10
    };

    const elements: Element[] = [
        {
            type: 'chapter-heading',
            content: 'Actor Communication Visual Proof',
            properties: {
                sourceId: 'visual-proof-heading',
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
            content: 'This proof document shows multiple publisher actors emitting normalized signals into one observing actor. The observer reacts by growing its own footprint and crossing page boundaries while preserving deterministic layout.',
            properties: { sourceId: 'visual-proof-intro' }
        },
        {
            type: 'test-signal-observer',
            content: '',
            properties: {
                sourceId: 'proof-observer',
                style: observerStyle,
                _actorSignalObserve: {
                    topic: 'outline-entry',
                    title: 'Observed Outline Entries',
                    publishTopic: 'observer-summary',
                    backgroundColor: '#dcfce7',
                    borderColor: '#15803d',
                    color: '#14532d',
                    baseHeight: 120,
                    growthPerSignal: 70
                }
            }
        },
        {
            type: 'test-signal-follower',
            content: '',
            properties: {
                sourceId: 'proof-follower',
                style: {
                    marginTop: 10,
                    marginBottom: 10
                },
                _actorSignalFollow: {
                    topic: 'observer-summary',
                    title: 'Follower Shifted By Observer Summary',
                    backgroundColor: '#ede9fe',
                    borderColor: '#7c3aed',
                    color: '#4c1d95',
                    baseHeight: 84,
                    indentPerSignal: 18
                }
            }
        },
        {
            type: 'p',
            content: longParagraph('Observer aftermath text proves that the growing observer is part of ordinary layout flow rather than a disconnected debug overlay.'),
            properties: { sourceId: 'visual-proof-outro' }
        }
    ];

    for (const spec of PUBLISHER_SPECS) {
        elements.splice(elements.length - 3, 0, ...buildPublisherSection(spec));
    }

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
    const defaultBase = path.resolve(process.cwd(), 'engine', 'tests', 'output', 'actor-communication-visual');
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

    console.log(`[actor-communication-visual] pdf=${outputPath}`);
    console.log(`[actor-communication-visual] snapshot=${snapshotPath}`);
    console.log(`[actor-communication-visual] pages=${pages.length}`);
}

main().catch((error) => {
    console.error('[actor-communication-visual] FAILED', error);
    process.exit(1);
});
