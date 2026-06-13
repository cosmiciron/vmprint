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

const TARGET_SOURCE_ID = 'edit-target';
const DEFAULT_VISUAL_OUTPUT_DIR = path.join(os.homedir(), 'Downloads', 'vmprint-runtime-text-edit-proof');

function roundMs(value: number): number {
    return Number(Number(value || 0).toFixed(3));
}

function countBoxes(pages: readonly any[]): number {
    return pages.reduce((total, page) => total + (Array.isArray(page?.boxes) ? page.boxes.length : 0), 0);
}

function cloneJson<T>(value: T): T {
    return JSON.parse(JSON.stringify(value));
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
            h1: { fontSize: 24, fontWeight: 700, marginBottom: 12 },
            p: { marginBottom: 10, allowLineSplit: true }
        },
        elements: [
            {
                type: 'h1',
                content: 'Runtime Text Edit Proof',
                properties: { sourceId: 'proof-heading' }
            },
            {
                type: 'p',
                content: 'Lead paragraph remains ahead of the edit target so the replay frontier can be inspected.',
                properties: { sourceId: 'lead-anchor' }
            },
            {
                type: 'p',
                content: 'Alpha target sentence. Bravo target sentence.',
                properties: {
                    sourceId: TARGET_SOURCE_ID,
                    style: {
                        backgroundColor: '#FFF4C2',
                        borderColor: '#D99A00',
                        padding: 6
                    }
                }
            },
            {
                type: 'p',
                content: 'Tail paragraph should remain after split and merge operations.',
                properties: { sourceId: 'tail-anchor' }
            }
        ]
    };
}

function makeDeleteGeometryDocument(): DocumentInput {
    return {
        documentVersion: CURRENT_DOCUMENT_VERSION,
        layout: {
            pageSize: { width: 320, height: 500 },
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
                content: 'Runtime Delete Geometry Proof',
                properties: { sourceId: 'delete-geometry-heading' }
            },
            {
                type: 'p',
                content: 'Lead anchor for geometry-changing delete.',
                properties: { sourceId: 'delete-geometry-lead' }
            },
            {
                type: 'p',
                content: 'Short target with a deliberately long removable tail that wraps across several narrow lines, making the paragraph tall enough that deleting this removable tail must reduce box height and require geometry replay.',
                properties: {
                    sourceId: TARGET_SOURCE_ID,
                    style: {
                        backgroundColor: '#FEE2E2',
                        borderColor: '#DC2626',
                        padding: 6
                    }
                }
            },
            {
                type: 'p',
                content: 'Tail anchor should move upward after the geometry-changing delete.',
                properties: { sourceId: 'delete-geometry-tail' }
            }
        ]
    };
}

function elementSummary(elements: any[]): { type: string; sourceId: string | null; content: string }[] {
    return elements.map((element: any) => ({
        type: String(element.type || ''),
        sourceId: typeof element.properties?.sourceId === 'string' ? element.properties.sourceId : null,
        content: String(element.content || '')
    }));
}

function styleStageElements(
    elements: any[],
    options: {
        targetColor: string;
        targetBorder: string;
        splitSourceId?: string;
        splitColor?: string;
        splitBorder?: string;
    }
): any[] {
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
    profileLine?: string;
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
                content: `Runtime Text Edit Visual Proof ${input.stageNumber} - ${input.title}`,
                properties: { sourceId: `visual-stage-${input.stageNumber}-heading` }
            },
            {
                type: 'p',
                content: input.description,
                properties: {
                    sourceId: `visual-stage-${input.stageNumber}-description`,
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
                    sourceId: `visual-stage-${input.stageNumber}-expected`,
                    style: {
                        backgroundColor: '#ECFDF5',
                        borderColor: '#10B981',
                        borderWidth: 1,
                        padding: 8,
                        color: '#064E3B'
                    }
                }
            },
            ...(input.profileLine ? [{
                type: 'p',
                content: input.profileLine,
                properties: {
                    sourceId: `visual-stage-${input.stageNumber}-profile`,
                    style: {
                        backgroundColor: '#F5F3FF',
                        borderColor: '#8B5CF6',
                        borderWidth: 1,
                        padding: 6,
                        color: '#4C1D95',
                        fontSize: 11
                    }
                }
            }] : []),
            {
                type: 'h2',
                content: 'Document State',
                properties: { sourceId: `visual-stage-${input.stageNumber}-state-heading` }
            },
            ...styleStageElements(input.elements, input)
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
    const ir = loadDocument(document, 'runtime-text-edit-proof');
    const engine = new LayoutEngine(toLayoutConfig(ir, false));
    await engine.waitForFonts();

    const initialStarted = performance.now();
    const initialPages = engine.simulate(ir.elements);
    const initialMs = roundMs(performance.now() - initialStarted);
    const initialTargetBoxTexts = boxTextsForSource(initialPages, TARGET_SOURCE_ID);
    const beforeElements = cloneJson(ir.elements);

    const events: any[] = [];
    const unlisten = engine.listen('layout.runtimeIntentApplied', (event: any) => events.push(event));

    const insertStarted = performance.now();
    const insertResult = engine.send('layout.applyRuntimeIntent', {
        elements: ir.elements,
        intent: {
            kind: 'text-edit',
            operation: 'insertText',
            target: { sourceId: TARGET_SOURCE_ID, sourceOffset: 6 },
            text: 'runtime '
        }
    }) as any;
    const insertMs = roundMs(performance.now() - insertStarted);
    const afterInsertElements = cloneJson(ir.elements);

    const splitOffset = String(ir.elements[2]?.content || '').indexOf('Bravo');
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
    const afterSplitElements = cloneJson(ir.elements);

    const insertedSourceId = String(splitResult?.history?.edit?.insertedSourceId || '');
    const mergeStarted = performance.now();
    const mergeResult = engine.send('layout.applyRuntimeIntent', {
        elements: ir.elements,
        intent: {
            kind: 'text-edit',
            operation: 'mergeParagraphBackward',
            target: { sourceId: insertedSourceId }
        }
    }) as any;
    const mergeMs = roundMs(performance.now() - mergeStarted);
    const afterMergeElements = cloneJson(ir.elements);

    const deleteSmallStarted = performance.now();
    const deleteSmallResult = engine.send('layout.applyRuntimeIntent', {
        elements: ir.elements,
        intent: {
            kind: 'text-edit',
            operation: 'deleteText',
            target: { sourceId: TARGET_SOURCE_ID, sourceStart: 6, sourceEnd: 14 }
        }
    }) as any;
    const deleteSmallMs = roundMs(performance.now() - deleteSmallStarted);
    const afterDeleteSmallElements = cloneJson(ir.elements);

    unlisten();

    const deleteGeometryDocument = makeDeleteGeometryDocument();
    const deleteGeometryIr = loadDocument(deleteGeometryDocument, 'runtime-text-edit-delete-geometry-proof');
    const deleteGeometryEngine = new LayoutEngine(toLayoutConfig(deleteGeometryIr, false));
    await deleteGeometryEngine.waitForFonts();
    const deleteGeometryInitialStarted = performance.now();
    const deleteGeometryInitialPages = deleteGeometryEngine.simulate(deleteGeometryIr.elements);
    const deleteGeometryInitialMs = roundMs(performance.now() - deleteGeometryInitialStarted);
    const beforeDeleteGeometryElements = cloneJson(deleteGeometryIr.elements);
    const deleteGeometryText = String(deleteGeometryIr.elements[2]?.content || '');
    const deleteGeometryStart = deleteGeometryText.indexOf(' with a deliberately');
    const deleteGeometryEnd = deleteGeometryText.indexOf('.', deleteGeometryStart);
    const deleteGeometryStarted = performance.now();
    const deleteGeometryResult = deleteGeometryEngine.send('layout.applyRuntimeIntent', {
        elements: deleteGeometryIr.elements,
        intent: {
            kind: 'text-edit',
            operation: 'deleteText',
            target: {
                sourceId: TARGET_SOURCE_ID,
                sourceStart: deleteGeometryStart,
                sourceEnd: deleteGeometryEnd
            }
        }
    }) as any;
    const deleteGeometryMs = roundMs(performance.now() - deleteGeometryStarted);
    const afterDeleteGeometryElements = cloneJson(deleteGeometryIr.elements);

    const finalElements = ir.elements.map((element: any) => ({
        type: element.type,
        sourceId: element.properties?.sourceId || null,
        content: element.content
    }));
    const finalTarget = finalElements.find((element: any) => element.sourceId === TARGET_SOURCE_ID);
    const finalSplit = finalElements.find((element: any) => element.sourceId === insertedSourceId);
    const finalPages = Array.isArray(deleteSmallResult?.pages) ? deleteSmallResult.pages : [];
    const assertions = {
        insertChanged: insertResult?.changed === true
            && insertResult?.update?.source === 'runtime-text-edit'
            && String(afterInsertElements[2]?.content || '').includes('Alpha runtime'),
        splitCreatedSibling: splitResult?.changed === true
            && !!insertedSourceId
            && splitResult?.history?.after?.sourceIds?.includes(insertedSourceId),
        mergeRemovedSibling: mergeResult?.changed === true
            && !!insertedSourceId
            && !finalSplit
            && String(finalTarget?.content || '').includes('Bravo target sentence.'),
        deleteSmallStayedContentOnly: deleteSmallResult?.kind === 'content-only'
            && deleteSmallResult?.update?.kind === 'content-only'
            && String(ir.elements[2]?.content || '') === 'Alpha target sentence. Bravo target sentence.',
        deleteGeometryUsedGeometryReplay: deleteGeometryResult?.kind === 'geometry'
            && deleteGeometryResult?.update?.kind === 'geometry'
            && String(deleteGeometryIr.elements[2]?.content || '') === 'Short target.',
        protocolEmittedEvents: events.length === 4
            && events.every((event) => event?.name === 'layout.runtimeIntentApplied'),
        insertStayedContentOnly: insertResult?.kind === 'content-only'
            && insertResult?.update?.kind === 'content-only'
            && Array.isArray(insertResult?.pageIndexes)
            && insertResult.pageIndexes.length > 0,
        structuralEditsUsedGeometryReplay: [splitResult, mergeResult].every((result) =>
            result?.kind === 'geometry'
            && Array.isArray(result?.pageIndexes)
            && result.pageIndexes.length > 0
            && result.pageIndexes.length <= Math.max(1, initialPages.length)
        )
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
                title: 'Before Runtime Edit',
                description: 'Amber marks the source-backed paragraph before any runtime text edit intent is applied.',
                expected: 'Expected: one target paragraph between the lead and tail anchors.',
                elements: beforeElements,
                targetColor: '#FFF4C2',
                targetBorder: '#D99A00',
                profileLine: `Initial layout: ${initialMs} ms, ${initialPages.length} page(s), ${countBoxes(initialPages)} boxes.`
            })
        }),
        writeVisualStage({
            outputDir: visualOutputDir,
            filePrefix: '02-after-insert',
            document: makeVisualDocument({
                stageNumber: 2,
                title: 'After insertText',
                description: 'Green marks the edited paragraph after inserting "runtime " at source offset 6.',
                expected: `Expected: target text reads "${String(afterInsertElements[2]?.content || '')}". Replay sourceIds: ${(insertResult?.update?.sourceIds || []).join(', ')}.`,
                elements: afterInsertElements,
                targetColor: '#DCFCE7',
                targetBorder: '#16A34A',
                profileLine: `Runtime intent: insertText, update kind=${insertResult?.kind}, changed pages=[${(insertResult?.pageIndexes || []).join(',') || 'none'}], measured ${insertMs} ms.`
            })
        }),
        writeVisualStage({
            outputDir: visualOutputDir,
            filePrefix: '03-after-split',
            document: makeVisualDocument({
                stageNumber: 3,
                title: 'After splitParagraph',
                description: 'Gold marks the original paragraph segment. Blue marks the deterministic split sibling created by the engine.',
                expected: `Expected: sourceIds include ${TARGET_SOURCE_ID} and ${insertedSourceId}; tail anchor remains below both paragraphs.`,
                elements: afterSplitElements,
                targetColor: '#FEF3C7',
                targetBorder: '#F59E0B',
                splitSourceId: insertedSourceId,
                splitColor: '#DBEAFE',
                splitBorder: '#2563EB',
                profileLine: `Runtime intent: splitParagraph at offset ${splitOffset}, update kind=${splitResult?.kind}, changed pages=[${(splitResult?.pageIndexes || []).join(',') || 'none'}], measured ${splitMs} ms.`
            })
        }),
        writeVisualStage({
            outputDir: visualOutputDir,
            filePrefix: '04-after-merge',
            document: makeVisualDocument({
                stageNumber: 4,
                title: 'After mergeParagraphBackward',
                description: 'Purple marks the merged paragraph after the split sibling is merged backward and removed.',
                expected: `Expected: only ${TARGET_SOURCE_ID} remains for the target; final text reads "${String(afterMergeElements[2]?.content || '')}".`,
                elements: afterMergeElements,
                targetColor: '#EDE9FE',
                targetBorder: '#7C3AED',
                profileLine: `Runtime intent: mergeParagraphBackward, update kind=${mergeResult?.kind}, changed pages=[${(mergeResult?.pageIndexes || []).join(',') || 'none'}], measured ${mergeMs} ms.`
            })
        }),
        writeVisualStage({
            outputDir: visualOutputDir,
            filePrefix: '05-after-delete-content-only',
            document: makeVisualDocument({
                stageNumber: 5,
                title: 'After deleteText content-only',
                description: 'Teal marks the paragraph after deleting the inserted "runtime " text from the same single-line box.',
                expected: `Expected: text returns to "${String(afterDeleteSmallElements[2]?.content || '')}" while update kind remains content-only.`,
                elements: afterDeleteSmallElements,
                targetColor: '#CCFBF1',
                targetBorder: '#0F766E',
                profileLine: `Runtime intent: deleteText range [6,14], update kind=${deleteSmallResult?.kind}, changed pages=[${(deleteSmallResult?.pageIndexes || []).join(',') || 'none'}], measured ${deleteSmallMs} ms.`
            })
        }),
        writeVisualStage({
            outputDir: visualOutputDir,
            filePrefix: '06-before-delete-geometry',
            document: makeVisualDocument({
                stageNumber: 6,
                title: 'Before deleteText geometry case',
                description: 'Red marks a narrow wrapped paragraph before a large delete removes most of its text.',
                expected: `Expected: target is tall before delete. Initial layout: ${deleteGeometryInitialMs} ms, ${deleteGeometryInitialPages.length} page(s), ${countBoxes(deleteGeometryInitialPages)} boxes.`,
                elements: beforeDeleteGeometryElements,
                targetColor: '#FEE2E2',
                targetBorder: '#DC2626',
                profileLine: `Delete range will remove [${deleteGeometryStart},${deleteGeometryEnd}] from the target paragraph.`
            })
        }),
        writeVisualStage({
            outputDir: visualOutputDir,
            filePrefix: '07-after-delete-geometry',
            document: makeVisualDocument({
                stageNumber: 7,
                title: 'After deleteText geometry fallback',
                description: 'Rose marks the shortened paragraph after deletion reduced line count and forced geometry replay.',
                expected: `Expected: target text reads "${String(afterDeleteGeometryElements[2]?.content || '')}" and tail anchor moves upward.`,
                elements: afterDeleteGeometryElements,
                targetColor: '#FFE4E6',
                targetBorder: '#E11D48',
                profileLine: `Runtime intent: deleteText range [${deleteGeometryStart},${deleteGeometryEnd}], update kind=${deleteGeometryResult?.kind}, changed pages=[${(deleteGeometryResult?.pageIndexes || []).join(',') || 'none'}], measured ${deleteGeometryMs} ms.`
            })
        })
    ];

    const summary = {
        generatedAt: new Date().toISOString(),
        status,
        targetSourceId: TARGET_SOURCE_ID,
        insertedSourceId,
        timing: {
            initialMs,
            insertMs,
            splitMs,
            mergeMs
            ,
            deleteSmallMs,
            deleteGeometryInitialMs,
            deleteGeometryMs
        },
        counts: {
            initialPages: initialPages.length,
            initialBoxes: countBoxes(initialPages),
            finalPages: finalPages.length,
            finalBoxes: countBoxes(finalPages),
            deleteGeometryInitialPages: deleteGeometryInitialPages.length,
            deleteGeometryInitialBoxes: countBoxes(deleteGeometryInitialPages),
            deleteGeometryFinalPages: Array.isArray(deleteGeometryResult?.pages) ? deleteGeometryResult.pages.length : 0,
            deleteGeometryFinalBoxes: countBoxes(Array.isArray(deleteGeometryResult?.pages) ? deleteGeometryResult.pages : [])
        },
        results: {
            insert: {
                kind: insertResult?.kind ?? null,
                source: insertResult?.update?.source ?? null,
                pageIndexes: insertResult?.pageIndexes ?? [],
                sourceIds: insertResult?.update?.sourceIds ?? [],
                frontier: insertResult?.update?.replayFrontier ?? null,
                edit: insertResult?.history?.edit ?? null
            },
            split: {
                kind: splitResult?.kind ?? null,
                source: splitResult?.update?.source ?? null,
                pageIndexes: splitResult?.pageIndexes ?? [],
                sourceIds: splitResult?.update?.sourceIds ?? [],
                frontier: splitResult?.update?.replayFrontier ?? null,
                edit: splitResult?.history?.edit ?? null
            },
            merge: {
                kind: mergeResult?.kind ?? null,
                source: mergeResult?.update?.source ?? null,
                pageIndexes: mergeResult?.pageIndexes ?? [],
                sourceIds: mergeResult?.update?.sourceIds ?? [],
                frontier: mergeResult?.update?.replayFrontier ?? null,
                edit: mergeResult?.history?.edit ?? null
            },
            deleteSmall: {
                kind: deleteSmallResult?.kind ?? null,
                source: deleteSmallResult?.update?.source ?? null,
                pageIndexes: deleteSmallResult?.pageIndexes ?? [],
                sourceIds: deleteSmallResult?.update?.sourceIds ?? [],
                frontier: deleteSmallResult?.update?.replayFrontier ?? null,
                edit: deleteSmallResult?.history?.edit ?? null
            },
            deleteGeometry: {
                kind: deleteGeometryResult?.kind ?? null,
                source: deleteGeometryResult?.update?.source ?? null,
                pageIndexes: deleteGeometryResult?.pageIndexes ?? [],
                sourceIds: deleteGeometryResult?.update?.sourceIds ?? [],
                frontier: deleteGeometryResult?.update?.replayFrontier ?? null,
                edit: deleteGeometryResult?.history?.edit ?? null
            }
        },
        textEvidence: {
            initialTargetBoxes: initialTargetBoxTexts,
            finalTargetBoxes: boxTextsForSource(finalPages, TARGET_SOURCE_ID),
            deleteGeometryBeforeTargetBoxes: boxTextsForSource(deleteGeometryInitialPages, TARGET_SOURCE_ID),
            deleteGeometryAfterTargetBoxes: boxTextsForSource(Array.isArray(deleteGeometryResult?.pages) ? deleteGeometryResult.pages : [], TARGET_SOURCE_ID)
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
        finalElements,
        deleteGeometryFinalElements: elementSummary(deleteGeometryIr.elements),
        events: events.map((event) => ({
            name: event?.name ?? null,
            requestName: event?.requestName ?? null,
            kind: event?.payload?.kind ?? null,
            source: event?.payload?.update?.source ?? null,
            pageIndexes: event?.payload?.pageIndexes ?? []
        })),
        assertions
    };

    const out = path.resolve('tests/output/proofs/runtime-text-edit-summary.json');
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, `${JSON.stringify(summary, null, 2)}\n`);
    console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
