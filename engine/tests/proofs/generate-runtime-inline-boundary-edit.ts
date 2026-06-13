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

const TARGET_SOURCE_ID = 'inline-boundary-target';
const DEFAULT_VISUAL_OUTPUT_DIR = path.join(os.homedir(), 'Downloads', 'vmprint-runtime-inline-boundary-edit-proof');

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
    if (Array.isArray(element?.children)) return element.children.map((child: any) => sourceText(child)).join('');
    return '';
}

function makeDocument(): DocumentInput {
    return {
        documentVersion: CURRENT_DOCUMENT_VERSION,
        layout: {
            pageSize: 'LETTER',
            margins: { top: 72, right: 72, bottom: 72, left: 72 },
            fontFamily: 'Arimo',
            fontSize: 13,
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
            p: { marginBottom: 10, allowLineSplit: true }
        },
        elements: [
            { type: 'h1', content: 'Runtime Inline Boundary Edit Proof', properties: { sourceId: 'inline-boundary-heading' } },
            { type: 'p', content: 'Lead anchor for styled-boundary editing.', properties: { sourceId: 'inline-boundary-lead' } },
            {
                type: 'p',
                content: 'Alpha range target sentence. Bravo range target sentence.',
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
            { type: 'p', content: 'Tail anchor verifies downstream geometry.', properties: { sourceId: 'inline-boundary-tail' } }
        ]
    };
}

function styleTargets(elements: any[], options: {
    targetColor: string;
    targetBorder: string;
    splitSourceId?: string;
    splitColor?: string;
    splitBorder?: string;
}): any[] {
    return elements.map((element) => {
        const sourceId = String(element?.properties?.sourceId || '');
        const next = cloneJson(element);
        if (sourceId === TARGET_SOURCE_ID) {
            next.properties = {
                ...(next.properties || {}),
                style: {
                    ...(next.properties?.style || {}),
                    backgroundColor: options.targetColor,
                    borderColor: options.targetBorder,
                    borderWidth: 1,
                    padding: 6
                }
            };
        }
        if (options.splitSourceId && sourceId === options.splitSourceId) {
            next.properties = {
                ...(next.properties || {}),
                style: {
                    ...(next.properties?.style || {}),
                    backgroundColor: options.splitColor || '#DBEAFE',
                    borderColor: options.splitBorder || '#2563EB',
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
    profileLine: string;
    elements: any[];
    targetColor: string;
    targetBorder: string;
    splitSourceId?: string;
    splitColor?: string;
    splitBorder?: string;
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
            { type: 'h1', content: `Runtime Inline Boundary Proof ${input.stageNumber} - ${input.title}`, properties: { sourceId: `inline-boundary-stage-${input.stageNumber}-heading` } },
            {
                type: 'p',
                content: input.description,
                properties: { sourceId: `inline-boundary-stage-${input.stageNumber}-description`, style: { backgroundColor: '#F8FAFC', borderColor: '#CBD5E1', borderWidth: 1, padding: 8, color: '#334155' } }
            },
            {
                type: 'p',
                content: input.expected,
                properties: { sourceId: `inline-boundary-stage-${input.stageNumber}-expected`, style: { backgroundColor: '#ECFDF5', borderColor: '#10B981', borderWidth: 1, padding: 8, color: '#064E3B' } }
            },
            {
                type: 'p',
                content: input.profileLine,
                properties: { sourceId: `inline-boundary-stage-${input.stageNumber}-profile`, style: { backgroundColor: '#F5F3FF', borderColor: '#8B5CF6', borderWidth: 1, padding: 6, color: '#4C1D95', fontSize: 11 } }
            },
            { type: 'h2', content: 'Document State', properties: { sourceId: `inline-boundary-stage-${input.stageNumber}-state-heading` } },
            ...styleTargets(input.elements, input)
        ]
    };
}

function runVmprintCli(inputPath: string, outputPath: string, layoutPath: string): {
    ok: boolean;
    stdout: string;
    stderr: string;
    status: number | null;
} {
    const result = spawnSync('npm', [
        'run', 'dev', '--workspace=cli', '--',
        '--input', inputPath,
        '--output', outputPath,
        '--emit-layout', layoutPath,
        '--profile-layout',
        '--debug'
    ], {
        cwd: path.resolve(process.cwd(), '..'),
        encoding: 'utf8'
    });
    return {
        ok: result.status === 0,
        stdout: result.stdout || '',
        stderr: result.stderr || '',
        status: result.status
    };
}

function writeVisualStage(input: { outputDir: string; filePrefix: string; document: DocumentInput }) {
    const stageDir = path.join(input.outputDir, 'stages');
    fs.mkdirSync(stageDir, { recursive: true });
    const jsonPath = path.join(stageDir, `${input.filePrefix}.json`);
    const pdfPath = path.join(stageDir, `${input.filePrefix}.pdf`);
    const layoutPath = path.join(stageDir, `${input.filePrefix}.layout.json`);
    fs.writeFileSync(jsonPath, `${JSON.stringify(input.document, null, 2)}\n`);
    return { jsonPath, pdfPath, layoutPath, ...runVmprintCli(jsonPath, pdfPath, layoutPath) };
}

async function main(): Promise<void> {
    const LocalFontManager = await loadLocalFontManager();
    setDefaultEngineRuntime(createPrintEngineRuntime({ fontManager: new LocalFontManager() }));

    const document = makeDocument();
    const ir = loadDocument(document, 'runtime-inline-boundary-edit-proof');
    const engine = new LayoutEngine(toLayoutConfig(ir, false));
    await engine.waitForFonts();

    const initialStarted = performance.now();
    const initialPages = engine.simulate(ir.elements);
    const initialMs = roundMs(performance.now() - initialStarted);
    const beforeElements = cloneJson(ir.elements);

    const originalText = String(ir.elements[2]?.content || '');
    const rangeStart = originalText.indexOf('range target');
    const rangeEnd = rangeStart + 'range target'.length;
    const events: any[] = [];
    const unlisten = engine.listen('layout.runtimeIntentApplied', (event: any) => events.push(event));

    const formatStarted = performance.now();
    const formatResult = engine.send('layout.applyRuntimeIntent', {
        elements: ir.elements,
        intent: {
            kind: 'formatting',
            target: { sourceId: TARGET_SOURCE_ID, sourceStart: rangeStart, sourceEnd: rangeEnd },
            patch: { color: '#92400E', backgroundColor: '#FDE68A' }
        }
    }) as any;
    const formatMs = roundMs(performance.now() - formatStarted);
    const afterFormatElements = cloneJson(ir.elements);

    const splitOffset = rangeStart + 'range '.length;
    const splitStarted = performance.now();
    const splitResult = engine.send('layout.applyRuntimeIntent', {
        elements: ir.elements,
        intent: {
            kind: 'text-edit',
            operation: 'splitParagraph',
            target: { sourceId: TARGET_SOURCE_ID, sourceOffset: splitOffset }
        }
    }) as any;
    const splitMs = roundMs(performance.now() - splitStarted);
    const splitSourceId = String(splitResult?.history?.edit?.insertedSourceId || '');
    const afterSplitElements = cloneJson(ir.elements);

    const mergeStarted = performance.now();
    const mergeResult = engine.send('layout.applyRuntimeIntent', {
        elements: ir.elements,
        intent: {
            kind: 'text-edit',
            operation: 'mergeParagraphBackward',
            target: { sourceId: splitSourceId }
        }
    }) as any;
    const mergeMs = roundMs(performance.now() - mergeStarted);
    const afterMergeElements = cloneJson(ir.elements);

    const deleteStarted = performance.now();
    const deleteResult = engine.send('layout.applyRuntimeIntent', {
        elements: ir.elements,
        intent: {
            kind: 'text-edit',
            operation: 'deleteText',
            target: {
                sourceId: TARGET_SOURCE_ID,
                sourceStart: rangeStart - 'ha '.length,
                sourceEnd: rangeStart + 'range '.length
            }
        }
    }) as any;
    const deleteMs = roundMs(performance.now() - deleteStarted);
    const afterDeleteElements = cloneJson(ir.elements);
    unlisten();

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
                title: 'Before boundary edit',
                description: 'Slate marks the plain source-backed paragraph before styling and boundary edits.',
                expected: `Expected: range [${rangeStart},${rangeEnd}] is plain text.`,
                profileLine: `Initial layout: ${initialMs} ms, ${initialPages.length} page(s), ${countBoxes(initialPages)} boxes.`,
                elements: beforeElements,
                targetColor: '#F8FAFC',
                targetBorder: '#94A3B8'
            })
        }),
        writeVisualStage({
            outputDir: visualOutputDir,
            filePrefix: '02-after-format',
            document: makeVisualDocument({
                stageNumber: 2,
                title: 'After format range',
                description: 'Amber marks the styled range that will be split through the middle.',
                expected: 'Expected: only "range target" is styled.',
                profileLine: `Runtime intent: format range, update kind=${formatResult?.kind}, measured ${formatMs} ms.`,
                elements: afterFormatElements,
                targetColor: '#FFFBEB',
                targetBorder: '#D97706'
            })
        }),
        writeVisualStage({
            outputDir: visualOutputDir,
            filePrefix: '03-after-split-through-range',
            document: makeVisualDocument({
                stageNumber: 3,
                title: 'After split through styled range',
                description: 'The split cuts between "range " and "target"; both resulting fragments should keep amber styling.',
                expected: `Expected: first text "${sourceText(afterSplitElements[2])}", second text "${sourceText(afterSplitElements[3])}".`,
                profileLine: `Runtime intent: splitParagraph inside styled range, update kind=${splitResult?.kind}, measured ${splitMs} ms.`,
                elements: afterSplitElements,
                targetColor: '#FEF3C7',
                targetBorder: '#F59E0B',
                splitSourceId,
                splitColor: '#DBEAFE',
                splitBorder: '#2563EB'
            })
        }),
        writeVisualStage({
            outputDir: visualOutputDir,
            filePrefix: '04-after-merge-styled-fragments',
            document: makeVisualDocument({
                stageNumber: 4,
                title: 'After merge styled fragments',
                description: 'The merge should recombine compatible styled fragments into one amber range.',
                expected: `Expected: text returns to "${sourceText(afterMergeElements[2])}".`,
                profileLine: `Runtime intent: mergeParagraphBackward, update kind=${mergeResult?.kind}, measured ${mergeMs} ms.`,
                elements: afterMergeElements,
                targetColor: '#EDE9FE',
                targetBorder: '#7C3AED'
            })
        }),
        writeVisualStage({
            outputDir: visualOutputDir,
            filePrefix: '05-after-cross-boundary-delete',
            document: makeVisualDocument({
                stageNumber: 5,
                title: 'After cross-boundary delete',
                description: 'The delete removes the end of an unstyled run and the start of the styled run, leaving the styled suffix.',
                expected: `Expected: remaining text reads "${sourceText(afterDeleteElements[2])}".`,
                profileLine: `Runtime intent: deleteText across boundary, update kind=${deleteResult?.kind}, measured ${deleteMs} ms.`,
                elements: afterDeleteElements,
                targetColor: '#F8FAFC',
                targetBorder: '#64748B'
            })
        })
    ];

    const finalPages = Array.isArray(deleteResult?.pages) ? deleteResult.pages : [];
    const assertions = {
        formatStayedContentOnly: formatResult?.kind === 'content-only',
        splitThroughRangeUsedGeometry: splitResult?.kind === 'geometry',
        splitPreservedFirstStyledFragment: afterSplitElements[2]?.children?.some((child: any) => child.content === 'range ' && child?.properties?.style?.backgroundColor === '#FDE68A'),
        splitPreservedSecondStyledFragment: afterSplitElements[3]?.children?.some((child: any) => child.content === 'target' && child?.properties?.style?.backgroundColor === '#FDE68A'),
        mergeRecombinedStyledFragments: afterMergeElements[2]?.children?.some((child: any) => child.content === 'range target' && child?.properties?.style?.backgroundColor === '#FDE68A'),
        crossBoundaryDeleteStayedContentOnly: deleteResult?.kind === 'content-only',
        crossBoundaryDeletePreservedStyledSuffix: afterDeleteElements[2]?.children?.some((child: any) => child.content === 'target' && child?.properties?.style?.backgroundColor === '#FDE68A'),
        protocolEmittedEvents: events.length === 4
    };
    const status = Object.values(assertions).every(Boolean) ? 'pass' : 'gap';
    const summary = {
        generatedAt: new Date().toISOString(),
        status,
        targetSourceId: TARGET_SOURCE_ID,
        splitSourceId,
        timing: { initialMs, formatMs, splitMs, mergeMs, deleteMs },
        results: {
            format: { kind: formatResult?.kind, source: formatResult?.update?.source, pageIndexes: formatResult?.pageIndexes || [] },
            split: { kind: splitResult?.kind, source: splitResult?.update?.source, pageIndexes: splitResult?.pageIndexes || [] },
            merge: { kind: mergeResult?.kind, source: mergeResult?.update?.source, pageIndexes: mergeResult?.pageIndexes || [] },
            delete: { kind: deleteResult?.kind, source: deleteResult?.update?.source, pageIndexes: deleteResult?.pageIndexes || [] }
        },
        counts: {
            initialPages: initialPages.length,
            initialBoxes: countBoxes(initialPages),
            finalPages: finalPages.length,
            finalBoxes: countBoxes(finalPages)
        },
        textEvidence: {
            afterSplitFirst: sourceText(afterSplitElements[2]),
            afterSplitSecond: sourceText(afterSplitElements[3]),
            afterMerge: sourceText(afterMergeElements[2]),
            afterDelete: sourceText(afterDeleteElements[2])
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
        finalElement: afterDeleteElements[2],
        events: events.map((event) => ({
            name: event?.name,
            requestName: event?.requestName,
            kind: event?.payload?.kind,
            source: event?.payload?.update?.source,
            pageIndexes: event?.payload?.pageIndexes || []
        })),
        assertions
    };

    const outputPath = path.resolve(process.cwd(), 'tests/output/proofs/runtime-inline-boundary-edit-summary.json');
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
