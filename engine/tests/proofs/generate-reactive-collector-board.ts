import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { LayoutEngine } from '../../src/engine/layout-engine';
import { Renderer } from '../../src/engine/renderer';
import { createEngineRuntime } from '../../src/engine/runtime';
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
            pageSize: { width: 420, height: 320 },
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
    return `${seed} `.repeat(6).trim();
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
    { id: 'three', label: 'Chapter 3: Lantern Shore', pastelBackground: '#e0f2fe', pastelBorder: '#0891b2', pastelText: '#155e75' }
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

function buildElements(): Element[] {
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
            content: 'This proof document shows a synthetic TOC-like collector built entirely from proof actors. The collector gathers labels from several publishers, grows into a numbered list, and pushes trailing body text downward.',
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
        console.warn(`[generate-reactive-collector-board] PDF skipped: ${error instanceof Error ? error.message : String(error)}`);
        return false;
    }
}

async function main(): Promise<void> {
    const outputDir = path.resolve(resolveArg('--output-dir') || DEFAULT_OUTPUT_DIR);
    const outputBase = path.join(outputDir, 'reactive-collector-board');
    const snapshotPath = path.resolve(resolveArg('--snapshot') || `${outputBase}.pages.json`);
    const pdfPath = path.resolve(resolveArg('--pdf') || `${outputBase}.pdf`);
    const skipPdf = hasFlag('--no-pdf');

    fs.mkdirSync(path.dirname(snapshotPath), { recursive: true });
    fs.mkdirSync(path.dirname(pdfPath), { recursive: true });

    const LocalFontManager = await loadLocalFontManager();
    const runtime = createEngineRuntime({ fontManager: new LocalFontManager() });
    const config = buildConfig();
    const engine = new LayoutEngine(config, runtime);
    engine.setPackagerFactory(reactiveProofPackagerFactory);
    await engine.waitForFonts();

    const pages = engine.simulate(buildElements());
    fs.writeFileSync(snapshotPath, JSON.stringify(snapshotPages(pages), null, 2) + '\n', 'utf8');
    console.log(`[generate-reactive-collector-board] snapshot=${snapshotPath}`);
    console.log(`[generate-reactive-collector-board] pages=${pages.length}`);

    if (!skipPdf) {
        const pdfWritten = await maybeRenderPdf(pages, config, pdfPath, runtime);
        if (pdfWritten) {
            console.log(`[generate-reactive-collector-board] pdf=${pdfPath}`);
        }
    }
}

main().catch((error) => {
    console.error('[generate-reactive-collector-board] FAILED', error);
    process.exit(1);
});
