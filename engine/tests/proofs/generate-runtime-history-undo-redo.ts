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

const TARGET_SOURCE_ID = 'history-target';
const DEFAULT_VISUAL_OUTPUT_DIR = path.join(os.homedir(), 'Downloads', 'vmprint-runtime-history-undo-redo-proof');

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
            { type: 'h1', content: 'Runtime History Undo Redo Proof', properties: { sourceId: 'history-heading' } },
            { type: 'p', content: 'Lead anchor stays above the history target.', properties: { sourceId: 'history-lead' } },
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
            { type: 'p', content: 'Tail anchor verifies downstream geometry.', properties: { sourceId: 'history-tail' } }
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
            { type: 'h1', content: `Runtime History Visual Proof ${input.stageNumber} - ${input.title}`, properties: { sourceId: `history-stage-${input.stageNumber}-heading` } },
            {
                type: 'p',
                content: input.description,
                properties: { sourceId: `history-stage-${input.stageNumber}-description`, style: { backgroundColor: '#F8FAFC', borderColor: '#CBD5E1', borderWidth: 1, padding: 8, color: '#334155' } }
            },
            {
                type: 'p',
                content: input.expected,
                properties: { sourceId: `history-stage-${input.stageNumber}-expected`, style: { backgroundColor: '#ECFDF5', borderColor: '#10B981', borderWidth: 1, padding: 8, color: '#064E3B' } }
            },
            {
                type: 'p',
                content: input.profileLine,
                properties: { sourceId: `history-stage-${input.stageNumber}-profile`, style: { backgroundColor: '#F5F3FF', borderColor: '#8B5CF6', borderWidth: 1, padding: 6, color: '#4C1D95', fontSize: 11 } }
            },
            { type: 'h2', content: 'Document State', properties: { sourceId: `history-stage-${input.stageNumber}-state-heading` } },
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
    const repoRoot = fs.existsSync(path.resolve(process.cwd(), 'cli/package.json'))
        ? process.cwd()
        : path.resolve(process.cwd(), '..');
    const result = spawnSync('npm', [
        'run', 'dev', '--workspace=cli', '--',
        '--input', inputPath,
        '--output', outputPath,
        '--emit-layout', layoutPath,
        '--profile-layout',
        '--debug'
    ], {
        cwd: repoRoot,
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

function timed<T>(fn: () => T): { value: T; ms: number } {
    const started = performance.now();
    const value = fn();
    return { value, ms: roundMs(performance.now() - started) };
}

async function main(): Promise<void> {
    const LocalFontManager = await loadLocalFontManager();
    setDefaultEngineRuntime(createPrintEngineRuntime({ fontManager: new LocalFontManager() }));

    const visualOutputDir = process.env.VMPRINT_HISTORY_PROOF_DIR || DEFAULT_VISUAL_OUTPUT_DIR;
    const document = makeDocument();
    const ir = loadDocument(document, 'runtime-history-undo-redo-proof');
    const engine = new LayoutEngine(toLayoutConfig(ir, false));
    const events: any[] = [];
    engine.listen('layout.runtimeIntentUndone', (event) => events.push(event));
    engine.listen('layout.runtimeIntentRedone', (event) => events.push(event));
    await engine.waitForFonts();

    const initialStarted = performance.now();
    const initialPages = engine.simulate(ir.elements);
    const initialMs = roundMs(performance.now() - initialStarted);
    const beforeElements = cloneJson(ir.elements);

    const insert = timed(() => engine.send('layout.applyRuntimeIntent', {
        elements: ir.elements,
        intent: {
            kind: 'text-edit',
            operation: 'insertText',
            target: { sourceId: TARGET_SOURCE_ID, sourceOffset: 'Alpha '.length },
            text: 'runtime '
        }
    }) as any);
    const afterInsertElements = cloneJson(ir.elements);

    const undoInsert = timed(() => engine.send('layout.undoRuntimeIntent', {
        elements: ir.elements,
        entry: insert.value
    }) as any);
    const afterUndoInsertElements = cloneJson(ir.elements);

    const redoInsert = timed(() => engine.send('layout.redoRuntimeIntent', {
        elements: ir.elements,
        entry: insert.value
    }) as any);
    const afterRedoInsertElements = cloneJson(ir.elements);

    const rangeStart = sourceText(ir.elements[2]).indexOf('range target');
    const rangeEnd = rangeStart + 'range target'.length;
    const format = timed(() => engine.send('layout.applyRuntimeIntent', {
        elements: ir.elements,
        intent: {
            kind: 'formatting',
            target: { sourceId: TARGET_SOURCE_ID, sourceStart: rangeStart, sourceEnd: rangeEnd },
            patch: {
                color: '#0F766E',
                backgroundColor: '#CCFBF1'
            }
        }
    }) as any);
    const afterFormatElements = cloneJson(ir.elements);

    const undoFormat = timed(() => engine.send('layout.undoRuntimeIntent', {
        elements: ir.elements,
        entry: format.value
    }) as any);
    const afterUndoFormatElements = cloneJson(ir.elements);

    engine.send('layout.redoRuntimeIntent', {
        elements: ir.elements,
        entry: format.value
    });
    const split = timed(() => engine.send('layout.applyRuntimeIntent', {
        elements: ir.elements,
        intent: {
            kind: 'text-edit',
            operation: 'splitParagraph',
            target: { sourceId: TARGET_SOURCE_ID, sourceOffset: sourceText(ir.elements[2]).indexOf('Bravo') }
        }
    }) as any);
    const splitSourceId = String(split.value?.history?.edit?.insertedSourceId || '');
    const afterSplitElements = cloneJson(ir.elements);

    const undoSplit = timed(() => engine.send('layout.undoRuntimeIntent', {
        elements: ir.elements,
        entry: split.value
    }) as any);
    const afterUndoSplitElements = cloneJson(ir.elements);

    const redoSplit = timed(() => engine.send('layout.redoRuntimeIntent', {
        elements: ir.elements,
        entry: split.value
    }) as any);
    const afterRedoSplitElements = cloneJson(ir.elements);

    const visualStages = [
        writeVisualStage({
            outputDir: visualOutputDir,
            filePrefix: '01-before',
            document: makeVisualDocument({
                stageNumber: 1,
                title: 'Before history edits',
                description: 'Slate marks the source-backed paragraph before any runtime intent is applied.',
                expected: 'Expected: plain paragraph with one target source between lead and tail anchors.',
                profileLine: `Initial layout: ${initialMs} ms, ${initialPages.length} page(s), ${countBoxes(initialPages)} boxes.`,
                elements: beforeElements,
                targetColor: '#F8FAFC',
                targetBorder: '#94A3B8'
            })
        }),
        writeVisualStage({
            outputDir: visualOutputDir,
            filePrefix: '02-after-insert',
            document: makeVisualDocument({
                stageNumber: 2,
                title: 'After insertText',
                description: 'Green marks the paragraph after inserting "runtime ".',
                expected: `Expected: text reads "${sourceText(afterInsertElements[2])}".`,
                profileLine: `Runtime intent: insertText, update kind=${insert.value?.kind}, measured ${insert.ms} ms.`,
                elements: afterInsertElements,
                targetColor: '#DCFCE7',
                targetBorder: '#16A34A'
            })
        }),
        writeVisualStage({
            outputDir: visualOutputDir,
            filePrefix: '03-after-undo-insert',
            document: makeVisualDocument({
                stageNumber: 3,
                title: 'After undo insertText',
                description: 'Amber marks the target restored from the history before snapshot.',
                expected: `Expected: text returns to "${sourceText(afterUndoInsertElements[2])}".`,
                profileLine: `Runtime intent: undo insertText, update kind=${undoInsert.value?.kind}, source=${undoInsert.value?.update?.source}, measured ${undoInsert.ms} ms.`,
                elements: afterUndoInsertElements,
                targetColor: '#FEF3C7',
                targetBorder: '#F59E0B'
            })
        }),
        writeVisualStage({
            outputDir: visualOutputDir,
            filePrefix: '04-after-redo-insert-and-format',
            document: makeVisualDocument({
                stageNumber: 4,
                title: 'After redo insert plus format',
                description: 'Teal marks the styled inline range after redo restored the insert and formatting applied.',
                expected: 'Expected: insert redo and paint-only range format are both content-only updates.',
                profileLine: `Runtime intent: redo kind=${redoInsert.value?.kind}; format kind=${format.value?.kind}, measured ${roundMs(redoInsert.ms + format.ms)} ms.`,
                elements: afterFormatElements,
                targetColor: '#ECFEFF',
                targetBorder: '#0F766E'
            })
        }),
        writeVisualStage({
            outputDir: visualOutputDir,
            filePrefix: '05-after-undo-format',
            document: makeVisualDocument({
                stageNumber: 5,
                title: 'After undo format',
                description: 'Blue-gray marks the paragraph after the formatting history before snapshot is restored.',
                expected: 'Expected: styled inline range disappears while inserted text remains.',
                profileLine: `Runtime intent: undo format, update kind=${undoFormat.value?.kind}, source=${undoFormat.value?.update?.source}, measured ${undoFormat.ms} ms.`,
                elements: afterUndoFormatElements,
                targetColor: '#E2E8F0',
                targetBorder: '#64748B'
            })
        }),
        writeVisualStage({
            outputDir: visualOutputDir,
            filePrefix: '06-after-split',
            document: makeVisualDocument({
                stageNumber: 6,
                title: 'After splitParagraph',
                description: 'Gold marks the first paragraph; blue marks the split sibling.',
                expected: `Expected: split sibling sourceId ${splitSourceId} appears after the target.`,
                profileLine: `Runtime intent: splitParagraph, update kind=${split.value?.kind}, measured ${split.ms} ms.`,
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
            filePrefix: '07-after-undo-split',
            document: makeVisualDocument({
                stageNumber: 7,
                title: 'After undo splitParagraph',
                description: 'Purple marks the merged-back paragraph after structural history undo.',
                expected: 'Expected: split sibling is removed and the original target source is restored.',
                profileLine: `Runtime intent: undo splitParagraph, update kind=${undoSplit.value?.kind}, source=${undoSplit.value?.update?.source}, measured ${undoSplit.ms} ms.`,
                elements: afterUndoSplitElements,
                targetColor: '#EDE9FE',
                targetBorder: '#7C3AED'
            })
        }),
        writeVisualStage({
            outputDir: visualOutputDir,
            filePrefix: '08-after-redo-split',
            document: makeVisualDocument({
                stageNumber: 8,
                title: 'After redo splitParagraph',
                description: 'Gold and blue return after structural history redo restores the after snapshot.',
                expected: `Expected: split sibling ${splitSourceId} is back and tail remains downstream.`,
                profileLine: `Runtime intent: redo splitParagraph, update kind=${redoSplit.value?.kind}, source=${redoSplit.value?.update?.source}, measured ${redoSplit.ms} ms.`,
                elements: afterRedoSplitElements,
                targetColor: '#FEF3C7',
                targetBorder: '#F59E0B',
                splitSourceId,
                splitColor: '#DBEAFE',
                splitBorder: '#2563EB'
            })
        })
    ];

    const assertions = {
        insertContentOnly: insert.value?.kind === 'content-only',
        undoInsertContentOnly: undoInsert.value?.kind === 'content-only',
        redoInsertContentOnly: redoInsert.value?.kind === 'content-only',
        formatContentOnly: format.value?.kind === 'content-only',
        undoFormatContentOnly: undoFormat.value?.kind === 'content-only',
        splitGeometry: split.value?.kind === 'geometry',
        undoSplitGeometry: undoSplit.value?.kind === 'geometry',
        redoSplitGeometry: redoSplit.value?.kind === 'geometry',
        undoInsertRestoredText: sourceText(afterUndoInsertElements[2]) === 'Alpha range target sentence. Bravo range target sentence.',
        undoSplitRemovedSibling: String(afterUndoSplitElements[3]?.properties?.sourceId || '') === 'history-tail',
        redoSplitRestoredSibling: String(afterRedoSplitElements[3]?.properties?.sourceId || '') === splitSourceId,
        protocolEmittedHistoryEvents: events.length === 6
    };
    const status = Object.values(assertions).every(Boolean) ? 'pass' : 'gap';
    const summary = {
        generatedAt: new Date().toISOString(),
        status,
        targetSourceId: TARGET_SOURCE_ID,
        splitSourceId,
        timing: {
            initialMs,
            insertMs: insert.ms,
            undoInsertMs: undoInsert.ms,
            redoInsertMs: redoInsert.ms,
            formatMs: format.ms,
            undoFormatMs: undoFormat.ms,
            splitMs: split.ms,
            undoSplitMs: undoSplit.ms,
            redoSplitMs: redoSplit.ms
        },
        results: {
            insert: { kind: insert.value?.kind, source: insert.value?.update?.source, pageIndexes: insert.value?.pageIndexes || [] },
            undoInsert: { kind: undoInsert.value?.kind, source: undoInsert.value?.update?.source, pageIndexes: undoInsert.value?.pageIndexes || [] },
            redoInsert: { kind: redoInsert.value?.kind, source: redoInsert.value?.update?.source, pageIndexes: redoInsert.value?.pageIndexes || [] },
            format: { kind: format.value?.kind, source: format.value?.update?.source, pageIndexes: format.value?.pageIndexes || [] },
            undoFormat: { kind: undoFormat.value?.kind, source: undoFormat.value?.update?.source, pageIndexes: undoFormat.value?.pageIndexes || [] },
            split: { kind: split.value?.kind, source: split.value?.update?.source, pageIndexes: split.value?.pageIndexes || [] },
            undoSplit: { kind: undoSplit.value?.kind, source: undoSplit.value?.update?.source, pageIndexes: undoSplit.value?.pageIndexes || [] },
            redoSplit: { kind: redoSplit.value?.kind, source: redoSplit.value?.update?.source, pageIndexes: redoSplit.value?.pageIndexes || [] }
        },
        counts: {
            initialPages: initialPages.length,
            initialBoxes: countBoxes(initialPages),
            finalPages: Array.isArray(redoSplit.value?.pages) ? redoSplit.value.pages.length : 0,
            finalBoxes: Array.isArray(redoSplit.value?.pages) ? countBoxes(redoSplit.value.pages) : 0
        },
        textEvidence: {
            before: sourceText(beforeElements[2]),
            afterInsert: sourceText(afterInsertElements[2]),
            afterUndoInsert: sourceText(afterUndoInsertElements[2]),
            afterSplitFirst: sourceText(afterSplitElements[2]),
            afterSplitSecond: sourceText(afterSplitElements[3]),
            afterUndoSplit: sourceText(afterUndoSplitElements[2]),
            afterRedoSplitFirst: sourceText(afterRedoSplitElements[2]),
            afterRedoSplitSecond: sourceText(afterRedoSplitElements[3])
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
        events: events.map((event) => ({
            name: event?.name,
            requestName: event?.requestName,
            kind: event?.payload?.kind,
            source: event?.payload?.update?.source,
            pageIndexes: event?.payload?.pageIndexes || []
        })),
        assertions
    };

    const outputPath = fs.existsSync(path.resolve(process.cwd(), 'engine/tests'))
        ? path.resolve(process.cwd(), 'engine/tests/output/proofs/runtime-history-undo-redo-summary.json')
        : path.resolve(process.cwd(), 'tests/output/proofs/runtime-history-undo-redo-summary.json');
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
