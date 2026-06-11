#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { VMPrintEngine, LayoutUtils, resolveDocumentPaths } from '@vmprint/engine';
import PdfContext from '@vmprint/context-pdf';
import LocalFontManager from '@vmprint/local-fonts';

type KnownTransmuterName = 'mkd-mkd' | 'mkd-academic' | 'mkd-literature' | 'mkd-manuscript' | 'mkd-screenplay' | 'mkd-zh-manuscript';

type CliOptions = {
  inputPath?: string;
  outputPath?: string;
  transmuter?: string;
  as?: KnownTransmuterName;
  themePath?: string;
  configPath?: string;
  help?: boolean;
};

type ResolvedImage = {
  data: string;
  mimeType: 'image/png' | 'image/jpeg';
};

type DocumentInput = Record<string, unknown>;

type MarkdownTransmuterOptions = {
  theme?: string;
  config?: string;
  resolveImage?: (src: string) => ResolvedImage | null;
};

type LoadedTransmuterModule = {
  transmute?: (input: string, options?: MarkdownTransmuterOptions) => DocumentInput;
  default?: {
    transmute?: (input: string, options?: MarkdownTransmuterOptions) => DocumentInput;
  };
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

const BUILTIN_TRANSMUTERS: Record<KnownTransmuterName, string> = {
  'mkd-mkd': path.resolve(__dirname, '..', '..', 'mkd-mkd', 'src', 'index.ts'),
  'mkd-academic': path.resolve(__dirname, '..', '..', 'mkd-academic', 'src', 'index.ts'),
  'mkd-literature': path.resolve(__dirname, '..', '..', 'mkd-literature', 'src', 'index.ts'),
  'mkd-manuscript': path.resolve(__dirname, '..', '..', 'mkd-manuscript', 'src', 'index.ts'),
  'mkd-screenplay': path.resolve(__dirname, '..', '..', 'mkd-screenplay', 'src', 'index.ts'),
  'mkd-zh-manuscript': path.resolve(__dirname, '..', '..', 'mkd-zh-manuscript', 'src', 'index.ts')
};

const TRANSMUTER_NAME_ALIASES: Record<string, KnownTransmuterName> = {
  markdown: 'mkd-mkd',
  academic: 'mkd-academic',
  literature: 'mkd-literature',
  manuscript: 'mkd-manuscript',
  screenplay: 'mkd-screenplay',
  'zh-manuscript': 'mkd-zh-manuscript',
  'mkd-mkd': 'mkd-mkd',
  'mkd-academic': 'mkd-academic',
  'mkd-literature': 'mkd-literature',
  'mkd-manuscript': 'mkd-manuscript',
  'mkd-screenplay': 'mkd-screenplay',
  'mkd-zh-manuscript': 'mkd-zh-manuscript'
};

function printHelp(): void {
  process.stdout.write(
    [
      'vmprint-transmute',
      '',
      'Usage:',
      '  npm run dev:transmute -- <input.md> [options]',
      '  npm run dev:transmute -- <input.md> --as mkd-mkd --theme ./theme.yaml --out ./out.pdf',
      '  npm run dev:transmute -- <input.md> --transmuter ./mkd-mkd/src/index.ts --out ./out.json',
      '',
      'Options:',
      '  --as <name>             Built-in local transmuter: markdown, academic, literature, manuscript, screenplay',
      '  --transmuter <path>     Path to a local transmuter module',
      '  --theme <path>          Theme YAML file passed through as a string',
      '  --config <path>         Config YAML file passed through as a string',
      '  --out <path>            Output path (.pdf or .json)',
      '  --help                  Show this help',
      '',
      'Notes:',
      '  If --out ends with .json, the transmuted DocumentInput is written directly.',
      '  If --out ends with .pdf, the tool renders the document through VMPrint.'
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
    if (arg === '--theme') {
      options.themePath = argv[++i];
      continue;
    }
    if (arg === '--config') {
      options.configPath = argv[++i];
      continue;
    }
    if (arg === '--transmuter') {
      options.transmuter = argv[++i];
      continue;
    }
    if (arg === '--as') {
      options.as = normalizeAsName(argv[++i]);
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

function normalizeAsName(value: string | undefined): KnownTransmuterName | undefined {
  if (!value) return undefined;
  return TRANSMUTER_NAME_ALIASES[value.trim().toLowerCase()];
}

function assertValidOptions(options: CliOptions): asserts options is CliOptions & { inputPath: string } {
  if (options.help) return;
  if (!options.inputPath) throw new Error('Missing input markdown path.');
  if (options.as && options.transmuter) throw new Error('Use either --as or --transmuter, not both.');
  if (options.as && !(options.as in BUILTIN_TRANSMUTERS)) throw new Error(`Unsupported --as value: ${options.as}`);
}

function resolveOutputPath(inputPath: string, outPath?: string): string {
  if (outPath) return path.resolve(outPath);
  const parsed = path.parse(inputPath);
  return path.resolve(parsed.dir, `${parsed.name}.pdf`);
}

function getOutputMode(outputPath: string): 'json' | 'pdf' {
  const ext = path.extname(outputPath).toLowerCase();
  if (ext === '.json') return 'json';
  if (ext === '.pdf' || ext === '') return 'pdf';
  throw new Error(`Unsupported output extension "${ext}". Use .json or .pdf.`);
}

function loadTextFile(filePath: string | undefined, label: string): string | undefined {
  if (!filePath) return undefined;
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) throw new Error(`${label} file not found: ${resolved}`);
  return fs.readFileSync(resolved, 'utf8');
}

function createFsImageResolver(markdownPath: string): (src: string) => ResolvedImage | null {
  const baseDir = path.dirname(markdownPath);
  return (src: string): ResolvedImage | null => {
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

function resolveTransmuterModulePath(options: CliOptions): string {
  if (options.transmuter) return path.resolve(options.transmuter);
  if (options.as) return BUILTIN_TRANSMUTERS[options.as];
  return BUILTIN_TRANSMUTERS['mkd-mkd'];
}

async function loadTransmuter(modulePath: string): Promise<(input: string, options?: MarkdownTransmuterOptions) => DocumentInput> {
  const mod = await import(pathToFileURL(modulePath).href) as LoadedTransmuterModule;
  const candidate = 'transmute' in mod
    ? mod.transmute
    : mod.default?.transmute;
  if (typeof candidate !== 'function') {
    throw new Error(`Transmuter module "${modulePath}" must export a transmute(markdown, options) function.`);
  }
  return candidate;
}

async function renderPdf(document: DocumentInput, inputPath: string, outputPath: string): Promise<void> {
  const documentIR = resolveDocumentPaths(document as never, inputPath);
  const engine = new VMPrintEngine(documentIR as never, new LocalFontManager());

  process.stdout.write('[vmprint-transmute] Loading fonts and paginating...\n');
  const pages = await engine.layout();

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  const { width, height } = LayoutUtils.getPageDimensions(engine.config as never);
  const context = new PdfContext({
    size: [width, height],
    margins: { top: 0, left: 0, right: 0, bottom: 0 },
    autoFirstPage: false,
    bufferPages: false
  });
  const outputStream = new NodeWriteStreamAdapter(outputPath);
  context.pipe(outputStream);

  process.stdout.write(`[vmprint-transmute] Rendering ${pages.length} pages...\n`);
  await engine.render(context);
  await outputStream.waitForFinish();
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

  const outputPath = resolveOutputPath(inputPath, options.outputPath);
  const mode = getOutputMode(outputPath);
  const markdown = fs.readFileSync(inputPath, 'utf8');
  const theme = loadTextFile(options.themePath, 'Theme');
  const config = loadTextFile(options.configPath, 'Config');
  const transmuterPath = resolveTransmuterModulePath(options);
  const transmute = await loadTransmuter(transmuterPath);

  process.stdout.write(`[vmprint-transmute] Using transmuter: ${transmuterPath}\n`);
  if (theme) process.stdout.write(`[vmprint-transmute] Theme: ${path.resolve(options.themePath as string)}\n`);
  if (config) process.stdout.write(`[vmprint-transmute] Config: ${path.resolve(options.configPath as string)}\n`);

  const document = transmute(markdown, {
    ...(theme ? { theme } : {}),
    ...(config ? { config } : {}),
    resolveImage: createFsImageResolver(inputPath)
  });

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  if (mode === 'json') {
    fs.writeFileSync(outputPath, JSON.stringify(document, null, 2), 'utf8');
    process.stdout.write(`[vmprint-transmute] Wrote DocumentInput JSON: ${outputPath}\n`);
    return;
  }

  await renderPdf(document, inputPath, outputPath);
  process.stdout.write(`[vmprint-transmute] Wrote PDF: ${outputPath}\n`);
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`[vmprint-transmute] Error: ${message}\n`);
  process.exit(1);
});
