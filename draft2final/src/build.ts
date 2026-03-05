import path from 'node:path';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { LayoutEngine, Renderer, resolveDocumentPaths, toLayoutConfig, createEngineRuntime, LayoutUtils } from '@vmprint/engine';
import type { DocumentInput } from '@vmprint/engine';
import { VmprintOutputStream } from '@vmprint/contracts';
import PdfContext from '@vmprint/context-pdf';
import { parseMarkdownAst } from './markdown';
import { normalizeToSemantic, SemanticDocument } from './semantic';
import { getFormatModule } from './formats';
import { compile, resolveConfig, loadTheme } from './formats/compiler';
import { Draft2FinalError } from './errors';
import { validateManuscriptCompliance } from './formats/manuscript/validator';

type OverlayProvider = {
  backdrop?: (page: unknown, context: unknown) => void;
  overlay?: (page: unknown, context: unknown) => void;
};
// ─── Implementation loading ─────────────────────────────────────────────────────

class NodeWriteStreamAdapter implements VmprintOutputStream {
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

function resolveBuiltin(bundledRelPath: string, packageName: string): string {
  const bundledPath = path.join(__dirname, 'bundled', bundledRelPath);
  if (fs.existsSync(bundledPath)) return bundledPath;
  // Dev mode (tsx src/): bundled dir not present, resolve from workspace package
  return require.resolve(packageName);
}

async function loadImplementation<T>(modulePath: string): Promise<T> {
  const unwrap = (mod: any): T => mod?.default?.default ?? mod?.default ?? mod;

  try {
    const mod = await import(modulePath);
    return unwrap(mod);
  } catch (error) {
    if (path.isAbsolute(modulePath)) {
      const mod = await import(pathToFileURL(modulePath).href);
      return unwrap(mod);
    }
    throw error;
  }
}
// ─── Frontmatter extraction ───────────────────────────────────────────────────

function extractFrontmatter(markdown: string): { frontmatter: Record<string, unknown>; body: string } {
  const normalized = markdown.replace(/^\uFEFF/, '');
  const trimmedStart = normalized.replace(/^\s*/, '');
  const leadingOffset = normalized.length - trimmedStart.length;
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(trimmedStart);
  if (!match) return { frontmatter: {}, body: normalized };
  try {
    const parsed = parseYaml(match[1]) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object') return { frontmatter: {}, body: normalized };
    return { frontmatter: parsed, body: normalized.slice(leadingOffset + match[0].length) };
  } catch {
    return { frontmatter: {}, body: normalized };
  }
}

function ensureOverlayProvider(candidate: unknown, modulePath: string): OverlayProvider {
  if (!candidate || typeof candidate !== 'object') {
    throw new Draft2FinalError('render', modulePath, `Overlay module "${modulePath}" must export an object.`, 4);
  }

  const overlay = candidate as OverlayProvider;
  if (overlay.backdrop !== undefined && typeof overlay.backdrop !== 'function') {
    throw new Draft2FinalError('render', modulePath, `Overlay module "${modulePath}" has invalid backdrop export (expected function).`, 4);
  }
  if (overlay.overlay !== undefined && typeof overlay.overlay !== 'function') {
    throw new Draft2FinalError('render', modulePath, `Overlay module "${modulePath}" has invalid overlay export (expected function).`, 4);
  }
  if (!overlay.backdrop && !overlay.overlay) {
    throw new Draft2FinalError('render', modulePath, `Overlay module "${modulePath}" must export backdrop() and/or overlay() function.`, 4);
  }

  return overlay;
}

// ─── Layout defaults ──────────────────────────────────────────────────────────

function buildLayout(themeLayout: Partial<DocumentInput['layout']> | undefined): DocumentInput['layout'] {
  const defaults: Partial<DocumentInput['layout']> = {
    fontFamily: 'Caladea',
    fontSize: 11,
    lineHeight: 1.5,
    pageSize: 'LETTER',
    margins: { top: 72, right: 72, bottom: 72, left: 72 }
  };
  return { ...defaults, ...(themeLayout || {}) } as DocumentInput['layout'];
}

// ─── Public compile API ───────────────────────────────────────────────────────

export type BuildResult = {
  format: string;
  theme: string;
  syntax: SemanticDocument;
  ir: DocumentInput;
};

export function compileToVmprint(
  markdown: string,
  inputPath: string,
  cliFlags: Record<string, unknown> = {}
): BuildResult {
  const { frontmatter, body } = extractFrontmatter(markdown);
  const formatName = String(cliFlags.format ?? frontmatter.format ?? 'markdown');
  const themeName = String(cliFlags.theme ?? frontmatter.theme ?? 'default');
  const ast = parseMarkdownAst(body, inputPath, {
    allowFootnotes: formatName === 'manuscript' || formatName === 'markdown'
  });
  const syntax = normalizeToSemantic(ast, inputPath);
  const format = getFormatModule(formatName);

  const config = resolveConfig(format.pluginDir, frontmatter, cliFlags, themeName);
  if (formatName === 'manuscript') {
    config.__nodes = syntax.children;
    config.__footnotes = syntax.footnotes || {};
  } else if (formatName === 'markdown') {
    config.__footnotes = syntax.footnotes || {};
  }
  const theme = loadTheme(format.pluginDir, themeName);
  const layout = buildLayout(theme.layout);
  const ir = compile(syntax, format.createHandler(config), theme, config, layout, inputPath);
  if (formatName === 'manuscript') {
    validateManuscriptCompliance(ir, config);
  }

  return { format: formatName, theme: themeName, syntax, ir };
}

// ─── PDF rendering ────────────────────────────────────────────────────────────

async function renderVmprintPdf(
  ir: DocumentInput,
  inputPath: string,
  outputPdfPath: string,
  debug: boolean = false,
  overlayModulePath?: string
): Promise<void> {
  const resolvedOutput = path.resolve(outputPdfPath);
  const outputDir = path.dirname(resolvedOutput);

  try {
    fs.mkdirSync(outputDir, { recursive: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Draft2FinalError('write', resolvedOutput, `Failed to prepare output directory: ${message}`, 5, { cause: error });
  }

  try {
    const builtinFontManager = resolveBuiltin('font-managers/local/index.js', '@vmprint/local-fonts');
    const FontManagerClass = await loadImplementation<new (...args: any[]) => any>(builtinFontManager);

    const documentIR = resolveDocumentPaths(ir, inputPath);
    const runtime = createEngineRuntime({ fontManager: new FontManagerClass() });
    const config = toLayoutConfig(documentIR, debug);
    const engine = new LayoutEngine(config, runtime);
    await engine.waitForFonts();
    const pages = engine.paginate(documentIR.elements);
    const overlay = overlayModulePath
      ? ensureOverlayProvider(await loadImplementation<OverlayProvider>(overlayModulePath), overlayModulePath)
      : undefined;

    const { width, height } = LayoutUtils.getPageDimensions(config);
    const context = new PdfContext({
      size: [width, height],
      margins: { top: 0, left: 0, right: 0, bottom: 0 },
      autoFirstPage: false,
      bufferPages: false
    });
    const outputStream = new NodeWriteStreamAdapter(resolvedOutput);
    context.pipe(outputStream);

    const renderer = new Renderer(config, debug, runtime, overlay as any);
    await renderer.render(pages, context);
    await outputStream.waitForFinish();
  } catch (error: unknown) {
    if (error instanceof Draft2FinalError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new Draft2FinalError('render', resolvedOutput, `Failed to render PDF: ${message}`, 4, { cause: error });
  }

  try {
    const stat = fs.statSync(resolvedOutput);
    if (!stat.isFile() || stat.size <= 0) {
      throw new Error('Rendered PDF file was empty.');
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Draft2FinalError('write', resolvedOutput, `Failed to verify output file: ${message}`, 5, { cause: error });
  }
}

export async function buildMarkdownToPdf(
  markdown: string,
  inputPath: string,
  outputPdfPath: string,
  cliFlags: Record<string, unknown> = {},
  debug: boolean = false,
  overlayModulePath?: string
): Promise<BuildResult> {
  const result = compileToVmprint(markdown, inputPath, cliFlags);
  await renderVmprintPdf(result.ir, inputPath, outputPdfPath, debug, overlayModulePath);
  return result;
}
