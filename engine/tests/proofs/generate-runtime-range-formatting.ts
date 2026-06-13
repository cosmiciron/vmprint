import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';

import {
    CURRENT_DOCUMENT_VERSION,
    LayoutEngine,
    loadDocument,
    setDefaultEngineRuntime,
    toLayoutConfig,
    type DocumentInput
} from '../../src';
import { createPrintEngineRuntime } from '../../src/font-management/runtime';
import { loadLocalFontManager } from '../harness/engine-harness';

const TARGET_SOURCE_ID = 'range-format-target';
const DEFAULT_VISUAL_OUTPUT_DIR = path.join(os.homedir(), 'Downloads', 'vmprint-runtime-range-formatting-proof');

function roundMs(value: number): number {
    return Number(Number(value || 0).toFixed(3));
}

function cloneJson<T>(value: T): T {
    return JSON.parse(JSON.stringify(value));
}

function countBoxes(pages: readonly any[]): number {
    return pages.reduce((total, page) => total + (Array.isArray(page?.boxes) ? page.boxes.length : 0), 0);
}

function sourceText(element: any): string {
    if (typeof element?.content === 'string' && element.content) return element.content;
    if (Array.isArray(element?.children)) {
        return element.children.map((child: any) => sourceText(child)).join('');
    }
    return '';
}

function boxTextsForSource(pages: readonly any[], sourceId: string): string[] {
    const texts: string[] = [];
    for (const page of pages || []) {
        for (const box of page?.boxes || []) {
            const actual = String(box?.meta?.sourceId || box?.sourceId || '');
            if (actual !== sourceId && !actual.endsWith(`:${sourceId}`)) continue;
            const value = Array.isArray(box?.lines)
                ? box.lines
                    .flatMap((line: any[]) => Array.isArray(line) ? line : [])
                    .map((segment: any) => String(segment?.text || ''))
                    .join('')
                    .trim()
                : String(box?.text || box?.content || '').trim();
            if (value) texts.push(value);
        }
    }
    return texts;
}

function makeDocument(): DocumentInput {
    return {
        documentVersion: CURRENT_DOCUMENT_VERSION,
        layout: {
            pageSize: { width: 360, height: 520 },
            margins: { top: 48, right: 48, bottom: 48, left: 48 },
            fontFamily: 'Arimo',
            fontSize: 14,
            lineHeight: 1.35,
            progression: {
                policy: 'fixed-tick-count',
                maxTicks: 300,
                tickRateHz: 120
            }
        },
        fonts: { regular: 'Arimo' },
        styles: {
            h1: { fontSize: 18, fontWeight: 700, marginBottom: 10 },
            p: { marginBottom: 10, allowLineSplit: true }
        },
        elements: [
            {
                type: 'h1',
                content: 'Runtime Range Formatting Proof',
                properties: { sourceId: 'range-format-heading' }
            },
            {
                type: 'p',
                content: 'Lead anchor remains above the formatted target.',
                properties: { sourceId: 'range-format-lead' }
            },
            {
                type: 'p',
                content: 'Alpha range target sentence. Bravo range target sentence stays nearby.',
                properties: {
                    sourceId: TARGET_SOURCE_ID,
                    style: {
                        backgroundColor: '#F8FAFC',
                        borderColor: '#94A3B8',
                        borderWidth: 1,
                        padding: 6
                    }
                }
            },
            {
                type: 'p',
                content: 'Tail anchor shows whether formatting replay moved downstream content.',
                properties: { sourceId: 'range-format-tail' }
            }
        ]
    };
}

function styleWholeTarget(elements: any[], targetColor: string, targetBorder: string): any[] {
    return elements.map((element) => {
        const next = cloneJson(element);
        if (String(next?.properties?.sourceId || '') === TARGET_SOURCE_ID) {
            next.properties = {
                ...(next.properties || {}),
                style: {
                    ...(next.properties?.style || {}),
                    backgroundColor: targetColor,
                    borderColor: targetBorder,
                    borderWidth: 1,
                    padding: 6
                }
            };
        }
        return next;
    });
}

function makeVisualDocument(input: {
    stageNumber: number;
    title: string;
    description: string;
    expected: string;
    elements: any[];
    targetColor: string;
    targetBorder: string;
    profileLine: string;
}): DocumentInput {
    return {
        documentVersion: CURRENT_DOCUMENT_VERSION,
        layout: {
            pageSize: 'LETTER',
            margins: { top: 58, right: 64, bottom: 58, left: 64 },
            fontFamily: 'Arimo',
            fontSize: 12.5,
            lineHeight: 1.35,
            progression: {
                policy: 'fixed-tick-count',
                maxTicks: 300,
                tickRateHz: 120
            }
        },
        fonts: { regular: 'Arimo' },
        styles: {
            h1: { fontSize: 22, fontWeight: 700, marginBottom: 10 },
            h2: { fontSize: 13, fontWeight: 700, marginTop: 10, marginBottom: 6 },
            p: { marginBottom: 9, allowLineSplit: true }
        },
        elements: [
            {
                type: 'h1',
                content: `Runtime Range Formatting Visual Proof ${input.stageNumber} - ${input.title}`,
                properties: { sourceId: `range-format-stage-${input.stageNumber}-heading` }
            },
            {
                type: 'p',
                content: input.description,
                properties: {
                    sourceId: `range-format-stage-${input.stageNumber}-description`,
                    style: {
                        backgroundColor: '#F8FAFC',
                        borderColor: '#CBD5E1',
                        borderWidth: 1,
                        padding: 8,
                        color: '#334155'
                    }
                }
            },
            {
                type: 'p',
                content: input.expected,
                properties: {
                    sourceId: `range-format-stage-${input.stageNumber}-expected`,
                    style: {
                        backgroundColor: '#ECFDF5',
                        borderColor: '#10B981',
                        borderWidth: 1,
                        padding: 8,
                        color: '#064E3B'
                    }
                }
            },
            {
                type: 'p',
                content: input.profileLine,
                properties: {
                    sourceId: `range-format-stage-${input.stageNumber}-profile`,
                    style: {
                        backgroundColor: '#F5F3FF',
                        borderColor: '#8B5CF6',
                        borderWidth: 1,
                        padding: 6,
                        color: '#4C1D95',
                        fontSize: 11
                    }
                }
            },
            {
                type: 'h2',
                content: 'Document State',
                properties: { sourceId: `range-format-stage-${input.stageNumber}-state-heading` }
            },
            ...styleWholeTarget(input.elements, input.targetColor, input.targetBorder)
        ]
    };
}

function runVmprintCli(inputPath: string, outputPath: string, layoutPath: string): {
    ok: boolean;
    stdout: string;
    stderr: string;
    status: number | null;
} {
    const vmprintRoot = path.resolve(process.cwd(), '..');
    const result = spawnSync('npm', [
        'run',
        'dev',
        '--workspace=cli',
        '--',
        '--input',
        inputPath,
        '--output',
        outputPath,
        '--emit-layout',
        layoutPath,
        '--profile-layout',
        '--debug'
    ], {
        cwd: vmprintRoot,
        encoding: 'utf8'
    });
    return {
        ok: result.status === 0,
        stdout: result.stdout || '',
        stderr: result.stderr || '',
        status: result.status
    };
}

function writeVisualStage(input: {
    outputDir: string;
    filePrefix: string;
    document: DocumentInput;
}): {
    jsonPath: string;
    pdfPath: string;
    layoutPath: string;
    ok: boolean;
    stdout: string;
    stderr: string;
    status: number | null;
} {
    const stageDir = path.join(input.outputDir, 'stages');
    fs.mkdirSync(stageDir, { recursive: true });
    const jsonPath = path.join(stageDir, `${input.filePrefix}.json`);
    const pdfPath = path.join(stageDir, `${input.filePrefix}.pdf`);
    const layoutPath = path.join(stageDir, `${input.filePrefix}.layout.json`);
    fs.writeFileSync(jsonPath, `${JSON.stringify(input.document, null, 2)}\n`);
    const cli = runVmprintCli(jsonPath, pdfPath, layoutPath);
    return {
        jsonPath,
        pdfPath,
        layoutPath,
        ...cli
    };
}

async function main(): Promise<void> {
    const LocalFontManager = await loadLocalFontManager();
    setDefaultEngineRuntime(createPrintEngineRuntime({ fontManager: new LocalFontManager() }));

    const document = makeDocument();
    const ir = loadDocument(document, 'runtime-range-formatting-proof');
    const engine = new LayoutEngine(toLayoutConfig(ir, false));
    await engine.waitForFonts();

    const initialStarted = performance.now();
    const initialPages = engine.simulate(ir.elements);
    const initialMs = roundMs(performance.now() - initialStarted);
    const beforeElements = cloneJson(ir.elements);

    const targetText = String(ir.elements[2]?.content || '');
    const rangeStart = targetText.indexOf('range target');
    const rangeEnd = rangeStart + 'range target'.length;
    const events: any[] = [];
    const unlisten = engine.listen('layout.runtimeIntentApplied', (event: any) => events.push(event));

    const paintStarted = performance.now();
    const paintResult = engine.send('layout.applyRuntimeIntent', {
        elements: ir.elements,
        intent: {
            kind: 'formatting',
            target: { sourceId: TARGET_SOURCE_ID, sourceStart: rangeStart, sourceEnd: rangeEnd },
            patch: {
                color: '#0F766E',
                backgroundColor: '#CCFBF1'
            }
        }
    }) as any;
    const paintMs = roundMs(performance.now() - paintStarted);
    const afterPaintElements = cloneJson(ir.elements);

    const geometryStarted = performance.now();
    const geometryResult = engine.send('layout.applyRuntimeIntent', {
        elements: ir.elements,
        intent: {
            kind: 'formatting',
            target: { sourceId: TARGET_SOURCE_ID, sourceStart: rangeStart, sourceEnd: rangeEnd },
            patch: {
                fontSize: 24,
                fontWeight: 700,
                backgroundColor: '#FDE68A',
                color: '#92400E'
            }
        }
    }) as any;
    const geometryMs = roundMs(performance.now() - geometryStarted);
    const afterGeometryElements = cloneJson(ir.elements);
    unlisten();

    const finalPages = Array.isArray(geometryResult?.pages) ? geometryResult.pages : [];
    const finalTarget = ir.elements[2] as any;
    const finalText = sourceText(finalTarget);
    const rangeChildren = Array.isArray(finalTarget?.children) ? finalTarget.children : [];
    const assertions = {
        rangeOffsetsResolved: rangeStart >= 0 && rangeEnd > rangeStart,
        paintStayedContentOnly: paintResult?.kind === 'content-only'
            && paintResult?.update?.kind === 'content-only'
            && paintResult?.update?.source === 'runtime-formatting',
        metricFormattingUsedGeometryReplay: geometryResult?.kind === 'geometry'
            && geometryResult?.update?.kind === 'geometry'
            && geometryResult?.update?.source === 'runtime-formatting'
            && !!geometryResult?.update?.replayFrontier,
        sourceTreePreservedText: finalText === targetText,
        rangeStylePersistedInSource: rangeChildren.some((child: any) => child?.properties?.style?.fontSize === 24),
        protocolEmittedEvents: events.length === 2
            && events.every((event) => event?.name === 'layout.runtimeIntentApplied')
    };
    const status = Object.values(assertions).every(Boolean) ? 'pass' : 'gap';

    const visualOutputDir = path.resolve(process.argv.includes('--visual-output-dir')
        ? String(process.argv[process.argv.indexOf('--visual-output-dir') + 1] || DEFAULT_VISUAL_OUTPUT_DIR)
        : DEFAULT_VISUAL_OUTPUT_DIR);
    fs.mkdirSync(visualOutputDir, { recursive: true });
    const visualStages = [
        writeVisualStage({
            outputDir: visualOutputDir,
            filePrefix: '01-before',
            document: makeVisualDocument({
                stageNumber: 1,
                title: 'Before range formatting',
                description: 'Slate marks the source-backed paragraph before any range formatting intent is applied.',
                expected: `Expected: the text range [${rangeStart},${rangeEnd}] is still plain source text.`,
                elements: beforeElements,
                targetColor: '#F8FAFC',
                targetBorder: '#94A3B8',
                profileLine: `Initial layout: ${initialMs} ms, ${initialPages.length} page(s), ${countBoxes(initialPages)} boxes.`
            })
        }),
        writeVisualStage({
            outputDir: visualOutputDir,
            filePrefix: '02-after-paint-range',
            document: makeVisualDocument({
                stageNumber: 2,
                title: 'After paint-only formatTextRange',
                description: 'Teal marks the selected text range after applying color and backgroundColor.',
                expected: 'Expected: range paint is visible while paragraph geometry remains unchanged.',
                elements: afterPaintElements,
                targetColor: '#F8FAFC',
                targetBorder: '#0F766E',
                profileLine: `Runtime intent: range formatting paint, update kind=${paintResult?.kind}, changed pages=[${(paintResult?.pageIndexes || []).join(',') || 'none'}], measured ${paintMs} ms.`
            })
        }),
        writeVisualStage({
            outputDir: visualOutputDir,
            filePrefix: '03-after-metric-range',
            document: makeVisualDocument({
                stageNumber: 3,
                title: 'After metric formatTextRange',
                description: 'Amber marks the same range after applying larger bold text that changes measured layout.',
                expected: 'Expected: source text is preserved as inline children and geometry replay is reported.',
                elements: afterGeometryElements,
                targetColor: '#FFFBEB',
                targetBorder: '#D97706',
                profileLine: `Runtime intent: range formatting metrics, update kind=${geometryResult?.kind}, changed pages=[${(geometryResult?.pageIndexes || []).join(',') || 'none'}], measured ${geometryMs} ms.`
            })
        })
    ];

    const summary = {
        generatedAt: new Date().toISOString(),
        status,
        targetSourceId: TARGET_SOURCE_ID,
        range: { start: rangeStart, end: rangeEnd },
        timing: {
            initialMs,
            paintMs,
            geometryMs
        },
        counts: {
            initialPages: initialPages.length,
            initialBoxes: countBoxes(initialPages),
            finalPages: finalPages.length,
            finalBoxes: countBoxes(finalPages)
        },
        results: {
            paint: {
                kind: paintResult?.kind,
                source: paintResult?.update?.source,
                pageIndexes: paintResult?.pageIndexes || [],
                sourceIds: paintResult?.update?.sourceIds || [],
                frontier: paintResult?.update?.replayFrontier || null
            },
            geometry: {
                kind: geometryResult?.kind,
                source: geometryResult?.update?.source,
                pageIndexes: geometryResult?.pageIndexes || [],
                sourceIds: geometryResult?.update?.sourceIds || [],
                frontier: geometryResult?.update?.replayFrontier || null
            }
        },
        textEvidence: {
            initialTargetBoxes: boxTextsForSource(initialPages, TARGET_SOURCE_ID),
            finalTargetBoxes: boxTextsForSource(finalPages, TARGET_SOURCE_ID),
            finalSourceText: finalText
        },
        visualProof: {
            outputDir: visualOutputDir,
            stages: visualStages.map((stage) => ({
                jsonPath: stage.jsonPath,
                pdfPath: stage.pdfPath,
                layoutPath: stage.layoutPath,
                ok: stage.ok,
                status: stage.status,
                stdout: stage.stdout.trim().split('\n').filter(Boolean),
                stderr: stage.stderr.trim().split('\n').filter(Boolean)
            }))
        },
        finalElement: finalTarget,
        events: events.map((event) => ({
            name: event?.name,
            requestName: event?.requestName,
            kind: event?.payload?.kind,
            source: event?.payload?.update?.source,
            pageIndexes: event?.payload?.pageIndexes || []
        })),
        assertions
    };

    const outputPath = path.resolve(process.cwd(), 'tests/output/proofs/runtime-range-formatting-summary.json');
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${JSON.stringify(summary, null, 2)}\n`);
    console.log(JSON.stringify(summary, null, 2));
    if (status !== 'pass' || visualStages.some((stage) => !stage.ok)) {
        process.exitCode = 1;
    }
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
