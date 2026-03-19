import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LayoutEngine, Renderer, createEngineRuntime } from '../../src';
import type { Element, LayoutConfig, Page } from '../../src/engine/types';
import PdfContext from '@vmprint/context-pdf';
import { experimentFactory } from '../packagers/experiment-factory';
import { loadStandardFontManager, snapshotPages } from '../../tests/harness/engine-harness';

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
            pageSize: { width: 720, height: 420 },
            margins: { top: 20, right: 20, bottom: 20, left: 20 },
            fontFamily: 'Courier',
            fontSize: 12,
            lineHeight: 1.2
        },
        fonts: {
            regular: 'Courier'
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
    return `${seed} `.repeat(90).trim();
}

function buildVisualElements(frameCount: number, currentFrame: number): Element[] {
    return [
        {
            type: 'test-clock-cooking',
            content: '',
            properties: {
                sourceId: `clock-cooking-actor-${currentFrame}`,
                style: {
                    marginTop: 4,
                    marginBottom: 6
                },
                _clockCooking: {
                    title: `UFO WAVE TRACK  FRAME ${currentFrame.toString().padStart(2, '0')}/${frameCount.toString().padStart(2, '0')}`,
                    emptyLabel: 'Scene is dormant.',
                    baseHeight: 288,
                    growthPerStage: 8,
                maxStages: currentFrame,
                pathStages: frameCount,
                sceneMode: 'ascii-diorama',
                sceneWidth: 62,
                sceneHeight: 16,
                    fontFamily: 'Courier'
                }
            }
        },
        {
            type: 'test-replay-marker',
            content: '',
            properties: {
                sourceId: `clock-cooking-downstream-${currentFrame}`,
                _testReplayMarker: {
                    title: 'DOWNSTREAM REPLAY',
                    backgroundColor: '#eef2ff',
                    borderColor: '#4338ca',
                    color: '#312e81',
                    height: 32
                }
            }
        },
        {
            type: 'p',
            content: 'telemetry ballast keeps a committed downstream region available for replay',
            properties: {
                sourceId: `clock-cooking-ballast-${currentFrame}`,
                style: {
                    fontFamily: 'Courier',
                    fontSize: 8,
                    lineHeight: 1.05,
                    color: '#64748b',
                    marginTop: 4,
                    marginBottom: 0
                }
            }
        },
        { type: 'p', content: longParagraph(`Frame ${currentFrame} ballast one keeps pagination finalization meaningful while the UFO cooker accumulates later committed state.`) },
        { type: 'p', content: longParagraph(`Frame ${currentFrame} ballast two preserves downstream replay pressure so the visual frame reflects a deeper settled slice.`) },
        { type: 'p', content: longParagraph(`Frame ${currentFrame} ballast three prevents the proof from collapsing into a trivial one-pass single-page layout.`) }
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
    const defaultBase = path.resolve(SCRIPT_DIR, '..', '..', 'tests', 'output', 'actor-clock-cooking-visual');
    const outputPath = path.resolve(outputArg || `${defaultBase}.pdf`);
    const snapshotPath = path.resolve(snapshotArg || `${defaultBase}.pages.json`);

    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.mkdirSync(path.dirname(snapshotPath), { recursive: true });

    const StandardFontManager = await loadStandardFontManager();
    const runtime = createEngineRuntime({ fontManager: new StandardFontManager() });
    const engine = new LayoutEngine(buildVisualConfig(), runtime);
    engine.setPackagerFactory(experimentFactory);
    await engine.waitForFonts();

    const frameCount = 10;
    const pages: Page[] = [];
    for (let currentFrame = 1; currentFrame <= frameCount; currentFrame++) {
        const framePages = engine.simulate(buildVisualElements(frameCount, currentFrame));
        const cookerPage = framePages.find((page) => page.boxes.some((box) => box.type === 'test-clock-cooking')) || framePages[0];
        pages.push(cookerPage);
    }

    const context = new PdfContext({
        size: [720, 420],
        margins: { top: 0, left: 0, right: 0, bottom: 0 },
        autoFirstPage: false,
        bufferPages: false
    });
    const outputStream = new NodeWriteStreamAdapter(outputPath);
    context.pipe(outputStream as any);

    const renderer = new Renderer(buildVisualConfig(), false, runtime);
    await renderer.render(pages, context);
    await outputStream.waitForFinish();

    fs.writeFileSync(snapshotPath, JSON.stringify(summarizePages(pages), null, 2) + '\n', 'utf8');

    console.log(`[actor-clock-cooking-visual] pdf=${outputPath}`);
    console.log(`[actor-clock-cooking-visual] snapshot=${snapshotPath}`);
    console.log(`[actor-clock-cooking-visual] pages=${pages.length}`);
}

main().catch((error) => {
    console.error('[actor-clock-cooking-visual] FAILED', error);
    process.exit(1);
});
