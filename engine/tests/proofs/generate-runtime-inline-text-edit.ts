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

const TARGET_SOURCE_ID = 'inline-edit-target';
const DEFAULT_VISUAL_OUTPUT_DIR = path.join(os.homedir(), 'Downloads', 'vmprint-runtime-inline-text-edit-proof');

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
            {
                type: 'h1',
                content: 'Runtime Inline Text Edit Proof',
                properties: { sourceId: 'inline-edit-heading' }
            },
            {
                type: 'p',
                content: 'Lead anchor stays above the inline edit target.',
                properties: { sourceId: 'inline-edit-lead' }
            },
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
            {
                type: 'p',
                content: 'Tail anchor verifies downstream position after split and merge.',
                properties: { sourceId: 'inline-edit-tail' }
            }
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
    elements: any[];
    targetColor: string;
    targetBorder: string;
    splitSourceId?: string;
    splitColor?: string;
    splitBorder?: string;
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
                content: `Runtime Inline Edit Visual Proof ${input.stageNumber} - ${input.title}`,
                properties: { sourceId: `inline-edit-stage-${input.stageNumber}-heading` }
            },
            {
                type: 'p',
                content: input.description,
                properties: {
                    sourceId: `inline-edit-stage-${input.stageNumber}-description`,
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
                    sourceId: `inline-edit-stage-${input.stageNumber}-expected`,
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
                    sourceId: `inline-edit-stage-${input.stageNumber}-profile`,
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
                properties: { sourceId: `inline-edit-stage-${input.stageNumber}-state-heading` }
            },
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
    const ir = loadDocument(document, 'runtime-inline-text-edit-proof');
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
            patch: {
                color: '#0F766E',
                backgroundColor: '#CCFBF1'
            }
        }
    }) as any;
    const formatMs = roundMs(performance.now() - formatStarted);
    const afterFormatElements = cloneJson(ir.elements);

    const insertStarted = performance.now();
    const insertResult = engine.send('layout.applyRuntimeIntent', {
        elements: ir.elements,
        intent: {
            kind: 'text-edit',
            operation: 'insertText',
            target: { sourceId: TARGET_SOURCE_ID, sourceOffset: rangeStart + 'range '.length },
            text: 'live '
        }
    }) as any;
    const insertMs = roundMs(performance.now() - insertStarted);
    const afterInsertElements = cloneJson(ir.elements);

    const deleteEnd = rangeStart + 'range live target'.length;
    const deleteStarted = performance.now();
    const deleteResult = engine.send('layout.applyRuntimeIntent', {
        elements: ir.elements,
        intent: {
            kind: 'text-edit',
            operation: 'deleteText',
            target: { sourceId: TARGET_SOURCE_ID, sourceStart: rangeStart, sourceEnd: deleteEnd }
        }
    }) as any;
    const deleteMs = roundMs(performance.now() - deleteStarted);
    const afterDeleteElements = cloneJson(ir.elements);

    const secondRangeStart = sourceText(ir.elements[2]).indexOf('range target');
    const secondRangeEnd = secondRangeStart + 'range target'.length;
    const formatSecondStarted = performance.now();
    const formatSecondResult = engine.send('layout.applyRuntimeIntent', {
        elements: ir.elements,
        intent: {
            kind: 'formatting',
            target: { sourceId: TARGET_SOURCE_ID, sourceStart: secondRangeStart, sourceEnd: secondRangeEnd },
            patch: {
                color: '#92400E',
                backgroundColor: '#FDE68A'
            }
        }
    }) as any;
    const formatSecondMs = roundMs(performance.now() - formatSecondStarted);
    const afterSecondFormatElements = cloneJson(ir.elements);

    const splitStarted = performance.now();
    const splitResult = engine.send('layout.applyRuntimeIntent', {
        elements: ir.elements,
        intent: {
            kind: 'text-edit',
            operation: 'splitParagraph',
            target: { sourceId: TARGET_SOURCE_ID, sourceOffset: secondRangeStart }
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
    unlisten();

    const finalPages = Array.isArray(mergeResult?.pages) ? mergeResult.pages : [];
    const assertions = {
        formatStayedContentOnly: formatResult?.kind === 'content-only',
        insertInheritedStyle: sourceText(ir.elements[2]) === 'Alpha  sentence. Bravo range target sentence.'
            && afterInsertElements[2]?.children?.some((child: any) => child.content === 'range live target' && child?.properties?.style?.backgroundColor === '#CCFBF1'),
        deleteMergedUnstyledSiblings: afterDeleteElements[2]?.children?.filter((child: any) => !child?.properties?.style?.backgroundColor).length === 1,
        splitPreservedStyledSibling: afterSplitElements[3]?.children?.some((child: any) => child.content === 'range target' && child?.properties?.style?.backgroundColor === '#FDE68A'),
        mergePreservedStyledRange: afterMergeElements[2]?.children?.some((child: any) => child.content === 'range target' && child?.properties?.style?.backgroundColor === '#FDE68A'),
        protocolEmittedEvents: events.length === 6
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
                title: 'Before inline editing',
                description: 'Slate marks the plain source-backed paragraph before range formatting creates inline children.',
                expected: `Expected: range [${rangeStart},${rangeEnd}] is plain text before formatting.`,
                elements: beforeElements,
                targetColor: '#F8FAFC',
                targetBorder: '#94A3B8',
                profileLine: `Initial layout: ${initialMs} ms, ${initialPages.length} page(s), ${countBoxes(initialPages)} boxes.`
            })
        }),
        writeVisualStage({
            outputDir: visualOutputDir,
            filePrefix: '02-after-format-range',
            document: makeVisualDocument({
                stageNumber: 2,
                title: 'After format range',
                description: 'Teal marks the selected range after paint-only range formatting converts the paragraph into inline source children.',
                expected: 'Expected: only "range target" is styled and update kind is content-only.',
                elements: afterFormatElements,
                targetColor: '#F8FAFC',
                targetBorder: '#0F766E',
                profileLine: `Runtime intent: range paint formatting, update kind=${formatResult?.kind}, measured ${formatMs} ms.`
            })
        }),
        writeVisualStage({
            outputDir: visualOutputDir,
            filePrefix: '03-after-insert-inside-range',
            document: makeVisualDocument({
                stageNumber: 3,
                title: 'After insert inside styled range',
                description: 'Teal should now cover "range live target", proving inserted text inherited the inline range style.',
                expected: `Expected: source text reads "${sourceText(afterInsertElements[2])}".`,
                elements: afterInsertElements,
                targetColor: '#F8FAFC',
                targetBorder: '#0F766E',
                profileLine: `Runtime intent: insertText inside range, update kind=${insertResult?.kind}, measured ${insertMs} ms.`
            })
        }),
        writeVisualStage({
            outputDir: visualOutputDir,
            filePrefix: '04-after-delete-styled-range',
            document: makeVisualDocument({
                stageNumber: 4,
                title: 'After delete styled range',
                description: 'The first styled range is removed; compatible unstyled text around it should merge into one source run.',
                expected: `Expected: source text reads "${sourceText(afterDeleteElements[2])}".`,
                elements: afterDeleteElements,
                targetColor: '#F8FAFC',
                targetBorder: '#64748B',
                profileLine: `Runtime intent: deleteText across styled range, update kind=${deleteResult?.kind}, measured ${deleteMs} ms.`
            })
        }),
        writeVisualStage({
            outputDir: visualOutputDir,
            filePrefix: '05-after-second-format',
            document: makeVisualDocument({
                stageNumber: 5,
                title: 'After reformat downstream range',
                description: 'Amber marks the downstream range that will be split into a new sibling paragraph.',
                expected: `Expected: second range [${secondRangeStart},${secondRangeEnd}] is styled before split.`,
                elements: afterSecondFormatElements,
                targetColor: '#FFFBEB',
                targetBorder: '#D97706',
                profileLine: `Runtime intent: second range paint formatting, update kind=${formatSecondResult?.kind}, measured ${formatSecondMs} ms.`
            })
        }),
        writeVisualStage({
            outputDir: visualOutputDir,
            filePrefix: '06-after-split-inline',
            document: makeVisualDocument({
                stageNumber: 6,
                title: 'After split inline paragraph',
                description: 'Gold marks the first paragraph; blue marks the split sibling that should retain the amber inline range.',
                expected: `Expected: split sourceId ${splitSourceId} preserves styled children.`,
                elements: afterSplitElements,
                targetColor: '#FEF3C7',
                targetBorder: '#F59E0B',
                splitSourceId,
                splitColor: '#DBEAFE',
                splitBorder: '#2563EB',
                profileLine: `Runtime intent: splitParagraph, update kind=${splitResult?.kind}, measured ${splitMs} ms.`
            })
        }),
        writeVisualStage({
            outputDir: visualOutputDir,
            filePrefix: '07-after-merge-inline',
            document: makeVisualDocument({
                stageNumber: 7,
                title: 'After merge inline paragraph',
                description: 'Purple marks the merged paragraph; the amber inline range should still be present after merge.',
                expected: `Expected: source text reads "${sourceText(afterMergeElements[2])}".`,
                elements: afterMergeElements,
                targetColor: '#EDE9FE',
                targetBorder: '#7C3AED',
                profileLine: `Runtime intent: mergeParagraphBackward, update kind=${mergeResult?.kind}, measured ${mergeMs} ms.`
            })
        })
    ];

    const summary = {
        generatedAt: new Date().toISOString(),
        status,
        targetSourceId: TARGET_SOURCE_ID,
        splitSourceId,
        timing: {
            initialMs,
            formatMs,
            insertMs,
            deleteMs,
            formatSecondMs,
            splitMs,
            mergeMs
        },
        results: {
            format: { kind: formatResult?.kind, source: formatResult?.update?.source, pageIndexes: formatResult?.pageIndexes || [] },
            insert: { kind: insertResult?.kind, source: insertResult?.update?.source, pageIndexes: insertResult?.pageIndexes || [] },
            delete: { kind: deleteResult?.kind, source: deleteResult?.update?.source, pageIndexes: deleteResult?.pageIndexes || [] },
            formatSecond: { kind: formatSecondResult?.kind, source: formatSecondResult?.update?.source, pageIndexes: formatSecondResult?.pageIndexes || [] },
            split: { kind: splitResult?.kind, source: splitResult?.update?.source, pageIndexes: splitResult?.pageIndexes || [] },
            merge: { kind: mergeResult?.kind, source: mergeResult?.update?.source, pageIndexes: mergeResult?.pageIndexes || [] }
        },
        counts: {
            initialPages: initialPages.length,
            initialBoxes: countBoxes(initialPages),
            finalPages: finalPages.length,
            finalBoxes: countBoxes(finalPages)
        },
        textEvidence: {
            afterInsert: sourceText(afterInsertElements[2]),
            afterDelete: sourceText(afterDeleteElements[2]),
            afterSplitFirst: sourceText(afterSplitElements[2]),
            afterSplitSecond: sourceText(afterSplitElements[3]),
            afterMerge: sourceText(afterMergeElements[2])
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
        finalElement: afterMergeElements[2],
        events: events.map((event) => ({
            name: event?.name,
            requestName: event?.requestName,
            kind: event?.payload?.kind,
            source: event?.payload?.update?.source,
            pageIndexes: event?.payload?.pageIndexes || []
        })),
        assertions
    };

    const outputPath = path.resolve(process.cwd(), 'tests/output/proofs/runtime-inline-text-edit-summary.json');
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
