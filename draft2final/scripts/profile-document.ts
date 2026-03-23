import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import {
  createEngineRuntime,
  LayoutEngine,
  LayoutUtils,
  Renderer,
  resolveDocumentPaths,
  toLayoutConfig
} from '@vmprint/engine';
import PdfContext from '@vmprint/context-pdf';
import LocalFontManager from '@vmprint/local-fonts';
import { transmute as transmuteMkd } from '@vmprint/transmuter-mkd-mkd';
import { transmute as transmuteAcademic } from '@vmprint/transmuter-mkd-academic';
import { transmute as transmuteLiterature } from '@vmprint/transmuter-mkd-literature';
import {
  transmuteWithArtifacts as transmuteManuscriptWithArtifacts
} from '@vmprint/transmuter-mkd-manuscript';
import { transmute as transmuteScreenplay } from '@vmprint/transmuter-mkd-screenplay';

type TransmuterName = 'mkd-mkd' | 'mkd-academic' | 'mkd-literature' | 'mkd-manuscript' | 'mkd-screenplay';

type CliOptions = {
  inputPath: string;
  as?: TransmuterName;
  repeatCount: number;
  warmupCount: number;
  renderPdf: boolean;
  outputPath?: string;
};

type RunMetric = {
  transmuteMs: number;
  fontMs: number;
  layoutMs: number;
  renderMs: number;
  totalMs: number;
  pages: number;
  boxes: number;
  tocEntries?: number;
  probeEnabled?: boolean;
  probeGrowthEvents?: number;
  speculativeBranchCalls?: number;
  speculativeBranchMs?: number;
  speculativeBranchAcceptedCalls?: number;
  speculativeBranchRollbackCalls?: number;
  speculativeBranchByReason?: Record<string, {
    calls: number;
    ms: number;
    acceptedCalls: number;
    rollbackCalls: number;
  }>;
  keepPlanCalls?: number;
  keepPlanMs?: number;
  observerCheckpointSweepCalls?: number;
  observerSettleCalls?: number;
  paginationPlacementPrepCalls?: number;
  paginationPlacementPrepMs?: number;
  actorMeasurementCalls?: number;
  actorMeasurementMs?: number;
  actorMeasurementByKind?: Record<string, { calls: number; ms: number }>;
  actorPreparedDispatchCalls?: number;
  actorPreparedDispatchMs?: number;
  flowMaterializeCalls?: number;
  flowMaterializeMs?: number;
  flowResolveLinesCalls?: number;
  flowResolveLinesMs?: number;
  flowBuildTokensCalls?: number;
  flowBuildTokensMs?: number;
  flowWrapStreamCalls?: number;
  flowWrapStreamMs?: number;
  flowBidiSplitCalls?: number;
  flowBidiSplitMs?: number;
  flowScriptSplitCalls?: number;
  flowScriptSplitMs?: number;
  flowWordSegmentCalls?: number;
  flowWordSegmentMs?: number;
  wrapOverflowTokenCalls?: number;
  wrapOverflowTokenMs?: number;
  wrapHyphenationAttemptCalls?: number;
  wrapHyphenationAttemptMs?: number;
  wrapHyphenationSuccessCalls?: number;
  wrapGraphemeFallbackCalls?: number;
  wrapGraphemeFallbackMs?: number;
  wrapGraphemeFallbackSegments?: number;
  textMeasurementCacheHits?: number;
  textMeasurementCacheMisses?: number;
  flowResolveSignatureCalls?: number;
  flowResolveSignatureUniqueCalls?: number;
  flowResolveSignatureRepeatedCalls?: number;
  flowResolveSignatureContinuationCalls?: number;
  flowResolveSignatureRepeatedContinuationCalls?: number;
  simpleProseEligibleCalls?: number;
  simpleProseIneligibleInlineObjectCalls?: number;
  simpleProseIneligibleMixedStyleCalls?: number;
  simpleProseIneligibleComplexScriptCalls?: number;
  simpleProseIneligibleRichStructureCalls?: number;
  keepWithNextResolutionCalls?: number;
  keepWithNextResolutionMs?: number;
  wholeFormationOverflowCalls?: number;
  wholeFormationOverflowMs?: number;
  keepWithNextActionCalls?: number;
  keepWithNextActionMs?: number;
  actorPlacementCalls?: number;
  actorPlacementMs?: number;
  actorOverflowCalls?: number;
  actorOverflowMs?: number;
  genericSplitCalls?: number;
  genericSplitMs?: number;
  boundaryCheckpointCalls?: number;
  boundaryCheckpointMs?: number;
  checkpointRecordCalls?: number;
  checkpointRecordMs?: number;
  observerBoundaryCheckCalls?: number;
  observerBoundaryCheckMs?: number;
};

function normalizeFormatName(value: string | undefined): TransmuterName | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase().replace(/^['"]|['"]$/g, '');
  const mapped: Record<string, TransmuterName> = {
    academic: 'mkd-academic',
    literature: 'mkd-literature',
    manuscript: 'mkd-manuscript',
    screenplay: 'mkd-screenplay',
    markdown: 'mkd-mkd'
  };
  return mapped[normalized] ?? ([
    'mkd-mkd',
    'mkd-academic',
    'mkd-literature',
    'mkd-manuscript',
    'mkd-screenplay'
  ].includes(normalized) ? normalized as TransmuterName : undefined);
}

function extractFrontmatterStringValue(markdown: string, key: string): string | undefined {
  const normalized = markdown.replace(/^\uFEFF/, '');
  const trimmedStart = normalized.replace(/^\s*/, '');
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(trimmedStart);
  if (!match) return undefined;
  const re = new RegExp(`^\\s*${key}\\s*:\\s*(.+?)\\s*$`, 'mi');
  const field = re.exec(match[1]);
  return field?.[1];
}

function resolveUsing(markdown: string, cliAs?: TransmuterName): TransmuterName {
  if (cliAs) return cliAs;
  const byAs = normalizeFormatName(extractFrontmatterStringValue(markdown, 'as'));
  if (byAs) return byAs;
  const byFormat = normalizeFormatName(extractFrontmatterStringValue(markdown, 'format'));
  if (byFormat) return byFormat;
  return 'mkd-mkd';
}

function parseArgs(argv: string[]): CliOptions {
  let inputPath = '';
  let as: TransmuterName | undefined;
  let repeatCount = 3;
  let warmupCount = 1;
  let renderPdf = false;
  let outputPath: string | undefined;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--as') {
      as = normalizeFormatName(argv[++i]);
      continue;
    }
    if (arg.startsWith('--repeat=')) {
      repeatCount = Math.max(1, Number.parseInt(arg.split('=')[1] || '3', 10) || 3);
      continue;
    }
    if (arg.startsWith('--warmup=')) {
      warmupCount = Math.max(0, Number.parseInt(arg.split('=')[1] || '1', 10) || 0);
      continue;
    }
    if (arg === '--render-pdf') {
      renderPdf = true;
      continue;
    }
    if (arg === '--output') {
      outputPath = argv[++i];
      continue;
    }
    if (!arg.startsWith('-') && !inputPath) {
      inputPath = arg;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!inputPath) {
    throw new Error('Usage: npm run profile:document --workspace=draft2final -- <input.md> [--as manuscript] [--repeat=3] [--warmup=1] [--render-pdf] [--output out.pdf]');
  }

  return {
    inputPath: path.resolve(inputPath),
    as,
    repeatCount,
    warmupCount,
    renderPdf,
    outputPath: outputPath ? path.resolve(outputPath) : undefined
  };
}

function createFsImageResolver(markdownPath: string): (src: string) => { data: string; mimeType: 'image/png' | 'image/jpeg' } | null {
  const baseDir = path.dirname(markdownPath);
  return (src: string) => {
    if (!src || /^data:/i.test(src) || /^https?:\/\//i.test(src)) return null;
    const resolvedPath = path.isAbsolute(src) ? src : path.resolve(baseDir, src);
    if (!fs.existsSync(resolvedPath)) return null;
    const ext = path.extname(resolvedPath).toLowerCase();
    const mimeType = ext === '.png'
      ? 'image/png'
      : ext === '.jpg' || ext === '.jpeg'
        ? 'image/jpeg'
        : null;
    if (!mimeType) return null;
    return {
      data: fs.readFileSync(resolvedPath).toString('base64'),
      mimeType
    };
  };
}

function transmuteDocument(name: TransmuterName, markdown: string, markdownPath: string) {
  const resolveImage = createFsImageResolver(markdownPath);
  if (name === 'mkd-mkd') return { document: transmuteMkd(markdown, { resolveImage }) };
  if (name === 'mkd-academic') return { document: transmuteAcademic(markdown, { resolveImage }) };
  if (name === 'mkd-literature') return { document: transmuteLiterature(markdown, { resolveImage }) };
  if (name === 'mkd-screenplay') return { document: transmuteScreenplay(markdown, { resolveImage }) };
  const result = transmuteManuscriptWithArtifacts(markdown, { resolveImage });
  return {
    document: result.document,
    artifacts: result.artifacts
  };
}

async function renderToPdf(outputPath: string, config: ReturnType<typeof toLayoutConfig>, runtime: ReturnType<typeof createEngineRuntime>, pages: any[]): Promise<void> {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const { width, height } = LayoutUtils.getPageDimensions(config);
  const context = new PdfContext({
    size: [width, height],
    margins: { top: 0, left: 0, right: 0, bottom: 0 },
    autoFirstPage: false,
    bufferPages: false
  });
  const stream = fs.createWriteStream(outputPath);
  context.pipe({
    write: (chunk: Uint8Array | string) => {
      stream.write(chunk);
    },
    end: () => {
      stream.end();
    }
  });
  const done = new Promise<void>((resolve, reject) => {
    stream.once('finish', resolve);
    stream.once('error', reject);
  });
  const renderer = new Renderer(config, false, runtime);
  await renderer.render(pages, context);
  await done;
}

function average(values: number[]): number {
  return Number((values.reduce((acc, value) => acc + value, 0) / Math.max(values.length, 1)).toFixed(2));
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const markdown = fs.readFileSync(options.inputPath, 'utf8');
  const usingName = resolveUsing(markdown, options.as);
  const runs: RunMetric[] = [];

  for (let runIndex = 0; runIndex < options.warmupCount + options.repeatCount; runIndex += 1) {
    const startedAt = performance.now();
    const transmuted = transmuteDocument(usingName, markdown, options.inputPath);
    const transmuteMs = performance.now() - startedAt;

    const runtime = createEngineRuntime({ fontManager: new LocalFontManager() });
    const documentIR = resolveDocumentPaths(transmuted.document as never, options.inputPath);
    const config = toLayoutConfig(documentIR, false);
    const engine = new LayoutEngine(config, runtime);

    const fontStartedAt = performance.now();
    await engine.waitForFonts();
    const fontMs = performance.now() - fontStartedAt;

    const layoutStartedAt = performance.now();
    const pages = engine.simulate(documentIR.elements);
    const layoutMs = performance.now() - layoutStartedAt;

    let renderMs = 0;
    if (options.renderPdf) {
      const outputPath = options.outputPath
        ?? path.resolve(path.dirname(options.inputPath), `${path.parse(options.inputPath).name}.profile.pdf`);
      const renderStartedAt = performance.now();
      await renderToPdf(outputPath, config, runtime, pages);
      renderMs = performance.now() - renderStartedAt;
    }

    if (runIndex < options.warmupCount) continue;

    const profile = engine.getLastSimulationReportReader?.()?.report?.profile;
    runs.push({
      transmuteMs: Number(transmuteMs.toFixed(2)),
      fontMs: Number(fontMs.toFixed(2)),
      layoutMs: Number(layoutMs.toFixed(2)),
      renderMs: Number(renderMs.toFixed(2)),
      totalMs: Number((transmuteMs + fontMs + layoutMs + renderMs).toFixed(2)),
      pages: pages.length,
      boxes: pages.reduce((acc: number, page: { boxes: unknown[] }) => acc + page.boxes.length, 0),
      tocEntries: transmuted.artifacts?.tocAst?.entries?.length,
      probeEnabled: transmuted.artifacts?.expandingProbeAst?.enabled,
      probeGrowthEvents: transmuted.artifacts?.expandingProbeAst?.growthHistory?.length,
      speculativeBranchCalls: profile?.speculativeBranchCalls,
      speculativeBranchMs: profile?.speculativeBranchMs ? Number(profile.speculativeBranchMs.toFixed(2)) : 0,
      speculativeBranchAcceptedCalls: profile?.speculativeBranchAcceptedCalls,
      speculativeBranchRollbackCalls: profile?.speculativeBranchRollbackCalls,
      speculativeBranchByReason: profile?.speculativeBranchByReason
        ? JSON.parse(JSON.stringify(profile.speculativeBranchByReason))
        : undefined,
      keepPlanCalls: profile?.keepWithNextPlanCalls,
      keepPlanMs: profile?.keepWithNextPlanMs ? Number(profile.keepWithNextPlanMs.toFixed(2)) : 0,
      observerCheckpointSweepCalls: profile?.observerCheckpointSweepCalls,
      observerSettleCalls: profile?.observerSettleCalls,
      paginationPlacementPrepCalls: profile?.paginationPlacementPrepCalls,
      paginationPlacementPrepMs: profile?.paginationPlacementPrepMs ? Number(profile.paginationPlacementPrepMs.toFixed(2)) : 0,
      actorMeasurementCalls: profile?.actorMeasurementCalls,
      actorMeasurementMs: profile?.actorMeasurementMs ? Number(profile.actorMeasurementMs.toFixed(2)) : 0,
      actorMeasurementByKind: profile?.actorMeasurementByKind
        ? JSON.parse(JSON.stringify(profile.actorMeasurementByKind))
        : undefined,
      actorPreparedDispatchCalls: profile?.actorPreparedDispatchCalls,
      actorPreparedDispatchMs: profile?.actorPreparedDispatchMs ? Number(profile.actorPreparedDispatchMs.toFixed(2)) : 0,
      flowMaterializeCalls: profile?.flowMaterializeCalls,
      flowMaterializeMs: profile?.flowMaterializeMs ? Number(profile.flowMaterializeMs.toFixed(2)) : 0,
      flowResolveLinesCalls: profile?.flowResolveLinesCalls,
      flowResolveLinesMs: profile?.flowResolveLinesMs ? Number(profile.flowResolveLinesMs.toFixed(2)) : 0,
      flowBuildTokensCalls: profile?.flowBuildTokensCalls,
      flowBuildTokensMs: profile?.flowBuildTokensMs ? Number(profile.flowBuildTokensMs.toFixed(2)) : 0,
      flowWrapStreamCalls: profile?.flowWrapStreamCalls,
      flowWrapStreamMs: profile?.flowWrapStreamMs ? Number(profile.flowWrapStreamMs.toFixed(2)) : 0,
      flowBidiSplitCalls: profile?.flowBidiSplitCalls,
      flowBidiSplitMs: profile?.flowBidiSplitMs ? Number(profile.flowBidiSplitMs.toFixed(2)) : 0,
      flowScriptSplitCalls: profile?.flowScriptSplitCalls,
      flowScriptSplitMs: profile?.flowScriptSplitMs ? Number(profile.flowScriptSplitMs.toFixed(2)) : 0,
      flowWordSegmentCalls: profile?.flowWordSegmentCalls,
      flowWordSegmentMs: profile?.flowWordSegmentMs ? Number(profile.flowWordSegmentMs.toFixed(2)) : 0,
      wrapOverflowTokenCalls: profile?.wrapOverflowTokenCalls,
      wrapOverflowTokenMs: profile?.wrapOverflowTokenMs ? Number(profile.wrapOverflowTokenMs.toFixed(2)) : 0,
      wrapHyphenationAttemptCalls: profile?.wrapHyphenationAttemptCalls,
      wrapHyphenationAttemptMs: profile?.wrapHyphenationAttemptMs ? Number(profile.wrapHyphenationAttemptMs.toFixed(2)) : 0,
      wrapHyphenationSuccessCalls: profile?.wrapHyphenationSuccessCalls,
      wrapGraphemeFallbackCalls: profile?.wrapGraphemeFallbackCalls,
      wrapGraphemeFallbackMs: profile?.wrapGraphemeFallbackMs ? Number(profile.wrapGraphemeFallbackMs.toFixed(2)) : 0,
      wrapGraphemeFallbackSegments: profile?.wrapGraphemeFallbackSegments,
      textMeasurementCacheHits: profile?.textMeasurementCacheHits,
      textMeasurementCacheMisses: profile?.textMeasurementCacheMisses,
      flowResolveSignatureCalls: profile?.flowResolveSignatureCalls,
      flowResolveSignatureUniqueCalls: profile?.flowResolveSignatureUniqueCalls,
      flowResolveSignatureRepeatedCalls: profile?.flowResolveSignatureRepeatedCalls,
      flowResolveSignatureContinuationCalls: profile?.flowResolveSignatureContinuationCalls,
      flowResolveSignatureRepeatedContinuationCalls: profile?.flowResolveSignatureRepeatedContinuationCalls,
      simpleProseEligibleCalls: profile?.simpleProseEligibleCalls,
      simpleProseIneligibleInlineObjectCalls: profile?.simpleProseIneligibleInlineObjectCalls,
      simpleProseIneligibleMixedStyleCalls: profile?.simpleProseIneligibleMixedStyleCalls,
      simpleProseIneligibleComplexScriptCalls: profile?.simpleProseIneligibleComplexScriptCalls,
      simpleProseIneligibleRichStructureCalls: profile?.simpleProseIneligibleRichStructureCalls,
      keepWithNextResolutionCalls: profile?.keepWithNextResolutionCalls,
      keepWithNextResolutionMs: profile?.keepWithNextResolutionMs ? Number(profile.keepWithNextResolutionMs.toFixed(2)) : 0,
      wholeFormationOverflowCalls: profile?.wholeFormationOverflowCalls,
      wholeFormationOverflowMs: profile?.wholeFormationOverflowMs ? Number(profile.wholeFormationOverflowMs.toFixed(2)) : 0,
      keepWithNextActionCalls: profile?.keepWithNextActionCalls,
      keepWithNextActionMs: profile?.keepWithNextActionMs ? Number(profile.keepWithNextActionMs.toFixed(2)) : 0,
      actorPlacementCalls: profile?.actorPlacementCalls,
      actorPlacementMs: profile?.actorPlacementMs ? Number(profile.actorPlacementMs.toFixed(2)) : 0,
      actorOverflowCalls: profile?.actorOverflowCalls,
      actorOverflowMs: profile?.actorOverflowMs ? Number(profile.actorOverflowMs.toFixed(2)) : 0,
      genericSplitCalls: profile?.genericSplitCalls,
      genericSplitMs: profile?.genericSplitMs ? Number(profile.genericSplitMs.toFixed(2)) : 0,
      boundaryCheckpointCalls: profile?.boundaryCheckpointCalls,
      boundaryCheckpointMs: profile?.boundaryCheckpointMs ? Number(profile.boundaryCheckpointMs.toFixed(2)) : 0,
      checkpointRecordCalls: profile?.checkpointRecordCalls,
      checkpointRecordMs: profile?.checkpointRecordMs ? Number(profile.checkpointRecordMs.toFixed(2)) : 0,
      observerBoundaryCheckCalls: profile?.observerBoundaryCheckCalls,
      observerBoundaryCheckMs: profile?.observerBoundaryCheckMs ? Number(profile.observerBoundaryCheckMs.toFixed(2)) : 0
    });
  }

  const summary = {
    inputPath: options.inputPath,
    format: usingName,
    warmupCount: options.warmupCount,
    repeatCount: options.repeatCount,
    renderPdf: options.renderPdf,
    pages: runs[0]?.pages ?? 0,
    boxes: runs[0]?.boxes ?? 0,
    averages: {
      transmuteMs: average(runs.map((run) => run.transmuteMs)),
      fontMs: average(runs.map((run) => run.fontMs)),
      layoutMs: average(runs.map((run) => run.layoutMs)),
      renderMs: average(runs.map((run) => run.renderMs)),
      totalMs: average(runs.map((run) => run.totalMs))
    },
    manuscriptArtifacts: usingName === 'mkd-manuscript'
      ? {
        tocEntries: runs[0]?.tocEntries ?? 0,
        probeEnabled: runs[0]?.probeEnabled ?? false,
        probeGrowthEvents: runs[0]?.probeGrowthEvents ?? 0
      }
      : undefined,
    profile: {
      speculativeBranchCalls: average(runs.map((run) => run.speculativeBranchCalls ?? 0)),
      speculativeBranchMs: average(runs.map((run) => run.speculativeBranchMs ?? 0)),
      speculativeBranchAcceptedCalls: average(runs.map((run) => run.speculativeBranchAcceptedCalls ?? 0)),
      speculativeBranchRollbackCalls: average(runs.map((run) => run.speculativeBranchRollbackCalls ?? 0)),
      speculativeBranchByReason: runs[0]?.speculativeBranchByReason ?? {},
      keepPlanCalls: average(runs.map((run) => run.keepPlanCalls ?? 0)),
      keepPlanMs: average(runs.map((run) => run.keepPlanMs ?? 0)),
      observerCheckpointSweepCalls: average(runs.map((run) => run.observerCheckpointSweepCalls ?? 0)),
      observerSettleCalls: average(runs.map((run) => run.observerSettleCalls ?? 0)),
      paginationPlacementPrepCalls: average(runs.map((run) => run.paginationPlacementPrepCalls ?? 0)),
      paginationPlacementPrepMs: average(runs.map((run) => run.paginationPlacementPrepMs ?? 0)),
      actorMeasurementCalls: average(runs.map((run) => run.actorMeasurementCalls ?? 0)),
      actorMeasurementMs: average(runs.map((run) => run.actorMeasurementMs ?? 0)),
      actorMeasurementByKind: runs[0]?.actorMeasurementByKind ?? {},
      actorPreparedDispatchCalls: average(runs.map((run) => run.actorPreparedDispatchCalls ?? 0)),
      actorPreparedDispatchMs: average(runs.map((run) => run.actorPreparedDispatchMs ?? 0)),
      flowMaterializeCalls: average(runs.map((run) => run.flowMaterializeCalls ?? 0)),
      flowMaterializeMs: average(runs.map((run) => run.flowMaterializeMs ?? 0)),
      flowResolveLinesCalls: average(runs.map((run) => run.flowResolveLinesCalls ?? 0)),
      flowResolveLinesMs: average(runs.map((run) => run.flowResolveLinesMs ?? 0)),
      flowBuildTokensCalls: average(runs.map((run) => run.flowBuildTokensCalls ?? 0)),
      flowBuildTokensMs: average(runs.map((run) => run.flowBuildTokensMs ?? 0)),
      flowWrapStreamCalls: average(runs.map((run) => run.flowWrapStreamCalls ?? 0)),
      flowWrapStreamMs: average(runs.map((run) => run.flowWrapStreamMs ?? 0)),
      flowBidiSplitCalls: average(runs.map((run) => run.flowBidiSplitCalls ?? 0)),
      flowBidiSplitMs: average(runs.map((run) => run.flowBidiSplitMs ?? 0)),
      flowScriptSplitCalls: average(runs.map((run) => run.flowScriptSplitCalls ?? 0)),
      flowScriptSplitMs: average(runs.map((run) => run.flowScriptSplitMs ?? 0)),
      flowWordSegmentCalls: average(runs.map((run) => run.flowWordSegmentCalls ?? 0)),
      flowWordSegmentMs: average(runs.map((run) => run.flowWordSegmentMs ?? 0)),
      wrapOverflowTokenCalls: average(runs.map((run) => run.wrapOverflowTokenCalls ?? 0)),
      wrapOverflowTokenMs: average(runs.map((run) => run.wrapOverflowTokenMs ?? 0)),
      wrapHyphenationAttemptCalls: average(runs.map((run) => run.wrapHyphenationAttemptCalls ?? 0)),
      wrapHyphenationAttemptMs: average(runs.map((run) => run.wrapHyphenationAttemptMs ?? 0)),
      wrapHyphenationSuccessCalls: average(runs.map((run) => run.wrapHyphenationSuccessCalls ?? 0)),
      wrapGraphemeFallbackCalls: average(runs.map((run) => run.wrapGraphemeFallbackCalls ?? 0)),
      wrapGraphemeFallbackMs: average(runs.map((run) => run.wrapGraphemeFallbackMs ?? 0)),
      wrapGraphemeFallbackSegments: average(runs.map((run) => run.wrapGraphemeFallbackSegments ?? 0)),
      textMeasurementCacheHits: average(runs.map((run) => run.textMeasurementCacheHits ?? 0)),
      textMeasurementCacheMisses: average(runs.map((run) => run.textMeasurementCacheMisses ?? 0)),
      flowResolveSignatureCalls: average(runs.map((run) => run.flowResolveSignatureCalls ?? 0)),
      flowResolveSignatureUniqueCalls: average(runs.map((run) => run.flowResolveSignatureUniqueCalls ?? 0)),
      flowResolveSignatureRepeatedCalls: average(runs.map((run) => run.flowResolveSignatureRepeatedCalls ?? 0)),
      flowResolveSignatureContinuationCalls: average(runs.map((run) => run.flowResolveSignatureContinuationCalls ?? 0)),
      flowResolveSignatureRepeatedContinuationCalls: average(runs.map((run) => run.flowResolveSignatureRepeatedContinuationCalls ?? 0)),
      simpleProseEligibleCalls: average(runs.map((run) => run.simpleProseEligibleCalls ?? 0)),
      simpleProseIneligibleInlineObjectCalls: average(runs.map((run) => run.simpleProseIneligibleInlineObjectCalls ?? 0)),
      simpleProseIneligibleMixedStyleCalls: average(runs.map((run) => run.simpleProseIneligibleMixedStyleCalls ?? 0)),
      simpleProseIneligibleComplexScriptCalls: average(runs.map((run) => run.simpleProseIneligibleComplexScriptCalls ?? 0)),
      simpleProseIneligibleRichStructureCalls: average(runs.map((run) => run.simpleProseIneligibleRichStructureCalls ?? 0)),
      keepWithNextResolutionCalls: average(runs.map((run) => run.keepWithNextResolutionCalls ?? 0)),
      keepWithNextResolutionMs: average(runs.map((run) => run.keepWithNextResolutionMs ?? 0)),
      wholeFormationOverflowCalls: average(runs.map((run) => run.wholeFormationOverflowCalls ?? 0)),
      wholeFormationOverflowMs: average(runs.map((run) => run.wholeFormationOverflowMs ?? 0)),
      keepWithNextActionCalls: average(runs.map((run) => run.keepWithNextActionCalls ?? 0)),
      keepWithNextActionMs: average(runs.map((run) => run.keepWithNextActionMs ?? 0)),
      actorPlacementCalls: average(runs.map((run) => run.actorPlacementCalls ?? 0)),
      actorPlacementMs: average(runs.map((run) => run.actorPlacementMs ?? 0)),
      actorOverflowCalls: average(runs.map((run) => run.actorOverflowCalls ?? 0)),
      actorOverflowMs: average(runs.map((run) => run.actorOverflowMs ?? 0)),
      genericSplitCalls: average(runs.map((run) => run.genericSplitCalls ?? 0)),
      genericSplitMs: average(runs.map((run) => run.genericSplitMs ?? 0)),
      boundaryCheckpointCalls: average(runs.map((run) => run.boundaryCheckpointCalls ?? 0)),
      boundaryCheckpointMs: average(runs.map((run) => run.boundaryCheckpointMs ?? 0)),
      checkpointRecordCalls: average(runs.map((run) => run.checkpointRecordCalls ?? 0)),
      checkpointRecordMs: average(runs.map((run) => run.checkpointRecordMs ?? 0)),
      observerBoundaryCheckCalls: average(runs.map((run) => run.observerBoundaryCheckCalls ?? 0)),
      observerBoundaryCheckMs: average(runs.map((run) => run.observerBoundaryCheckMs ?? 0))
    },
    runs
  };

  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  process.stderr.write(`[profile-document] ${message}\n`);
  process.exit(1);
});
