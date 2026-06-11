#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {
  createEngineRuntime,
  LayoutEngine,
  LayoutUtils,
  Renderer,
  resolveDocumentPaths,
  toLayoutConfig
} from '@vmprint/engine';
import LocalFontManager from '@vmprint/local-fonts';

// Import contexts directly using workspace packages
import PdfContext from '@vmprint/context-pdf';
import PdfLiteContext from '@vmprint/context-pdf-lite';
import CanvasContext from '@vmprint/context-canvas';

type ContextType = 'pdf' | 'pdf-lite' | 'canvas';

type CliOptions = {
  inputPath?: string;
  outputPath?: string;
  contextType?: ContextType;
  help?: boolean;
};

class NodeWriteStreamAdapter {
  private readonly stream: fs.WriteStream;

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

function printHelp(): void {
  process.stdout.write(
    [
      'vmprint-context-test',
      '',
      'Usage:',
      '  npm run dev -- tmp-sample.json --context pdf --out out.pdf',
      '',
      'Options:',
      '  --context <type>        Context to run the document against (pdf, pdf-lite, canvas)',
      '  --out <path>            Output path (for canvas, prefix used for .svg pages)',
      '  --help                  Show this help',
    ].join('\n') + '\n'
  );
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {};

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }
    if (arg === '--out' || arg === '--output') {
      options.outputPath = argv[++i];
      continue;
    }
    if (arg === '--context') {
      const val = argv[++i]?.toLowerCase();
      if (val === 'pdf' || val === 'pdf-lite' || val === 'canvas') {
        options.contextType = val as ContextType;
      } else {
        throw new Error(`Unknown context type: ${val}`);
      }
      continue;
    }
    if (arg.startsWith('-')) {
      throw new Error(`Unknown option: ${arg}`);
    }
    if (!options.inputPath) {
      options.inputPath = arg;
      continue;
    }
    throw new Error(`Unexpected positional argument: ${arg}`);
  }

  return options;
}

function assertValidOptions(options: CliOptions): asserts options is CliOptions & { inputPath: string; contextType: ContextType } {
  if (options.help) return;
  if (!options.inputPath) throw new Error('Missing input JSON path as first positional argument.');
  if (!options.contextType) throw new Error('Missing --context (pdf, pdf-lite, canvas).');
}

function resolveOutputPath(options: CliOptions & { inputPath: string }): string {
  if (options.outputPath) {
    return path.resolve(options.outputPath);
  }
  const parsed = path.parse(options.inputPath);
  const ext = options.contextType === 'canvas' ? '' : '.pdf';
  return path.resolve(parsed.dir, `${parsed.name}-${options.contextType}${ext}`);
}

async function renderDocument(document: Record<string, unknown>, inputPath: string, outputPath: string, contextType: ContextType): Promise<void> {
  const runtime = createEngineRuntime({ fontManager: new LocalFontManager() });
  const documentIR = resolveDocumentPaths(document as never, inputPath);
  const config = toLayoutConfig(documentIR, false);
  const engine = new LayoutEngine(config, runtime);

  process.stdout.write('[dev-cli] Loading fonts and paginating...\n');
  await engine.waitForFonts();
  const pages = engine.simulate(documentIR.elements);

  const { width, height } = LayoutUtils.getPageDimensions(config);
  
  process.stdout.write(`[dev-cli] Rendering ${pages.length} pages with context: ${contextType}...\n`);
  
  const renderer = new Renderer(config, false, runtime);

  if (contextType === 'pdf') {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    const context = new PdfContext({
      size: [width, height],
      margins: { top: 0, left: 0, right: 0, bottom: 0 },
      autoFirstPage: false,
      bufferPages: false
    });
    const outputStream = new NodeWriteStreamAdapter(outputPath);
    context.pipe(outputStream);
    await renderer.render(pages, context);
    await outputStream.waitForFinish();
    process.stdout.write(`[dev-cli] Wrote PDF: ${outputPath}\n`);

  } else if (contextType === 'pdf-lite') {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    // PdfLiteContext currently ignores options.size named aliases when dimensions are explicit strings,
    // so we pass explicit [width, height]. Also it auto-opens first page but handles it correctly.
    const context = new PdfLiteContext({
      size: [width, height],
      autoFirstPage: false, 
      bufferPages: false
    });
    const outputStream = new NodeWriteStreamAdapter(outputPath);
    context.pipe(outputStream);
    await renderer.render(pages, context);
    await outputStream.waitForFinish();
    process.stdout.write(`[dev-cli] Wrote PDF Lite: ${outputPath}\n`);
    
  } else if (contextType === 'canvas') {
    const isDir = outputPath && fs.existsSync(outputPath) && fs.statSync(outputPath).isDirectory();
    let baseDir = path.dirname(outputPath);
    let baseName = path.parse(outputPath).name;
    
    if (isDir) {
       baseDir = outputPath;
       baseName = 'output';
    } else {
       fs.mkdirSync(baseDir, { recursive: true });
    }

    const context = new CanvasContext({
      size: [width, height],
      autoFirstPage: false,
      textRenderMode: 'glyph-path' // Use best path for tests
    });
    
    // Canvas context is in-memory
    await renderer.render(pages, context);
    
    const svgPages = context.toSvgPages();
    for (let i = 0; i < svgPages.length; i++) {
        const svgPath = path.join(baseDir, `${baseName}-page${i + 1}.svg`);
        fs.writeFileSync(svgPath, svgPages[i], 'utf8');
        process.stdout.write(`[dev-cli] Wrote Canvas SVG: ${svgPath}\n`);
    }
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }
  assertValidOptions(options);

  const inputPath = path.resolve(options.inputPath);
  if (!fs.existsSync(inputPath)) throw new Error(`Input file not found: ${inputPath}`);

  const outputPath = resolveOutputPath(options);
  const documentStr = fs.readFileSync(inputPath, 'utf8');
  const document = JSON.parse(documentStr);

  process.stdout.write(`[dev-cli] Testing context: ${options.contextType}\n`);

  await renderDocument(document, inputPath, outputPath, options.contextType!);
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`[dev-cli] Error: ${message}\n`);
  process.exit(1);
});
