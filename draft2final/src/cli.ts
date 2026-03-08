import fs from 'node:fs';
import path from 'node:path';
import type { VmprintOutputStream } from '@vmprint/contracts';
import { createEngineRuntime, LayoutEngine, LayoutUtils, Renderer, resolveDocumentPaths, toLayoutConfig } from '@vmprint/engine';
import PdfContext from '@vmprint/context-pdf';
import LocalFontManager from '@vmprint/local-fonts';
import { transmute as transmuteMkd } from '@vmprint/transmuter-mkd-mkd';
import { transmute as transmuteAcademic } from '@vmprint/transmuter-mkd-academic';
import { transmute as transmuteLiterature } from '@vmprint/transmuter-mkd-literature';
import { transmute as transmuteManuscript } from '@vmprint/transmuter-mkd-manuscript';
import { transmute as transmuteScreenplay } from '@vmprint/transmuter-mkd-screenplay';

type ResolvedImage = {
  data: string;
  mimeType: 'image/png' | 'image/jpeg';
};

type TransmuterName = 'mkd-mkd' | 'mkd-academic' | 'mkd-literature' | 'mkd-manuscript' | 'mkd-screenplay';

type CliOptions = {
  inputPath?: string;
  using?: TransmuterName;
  outPath?: string;
  configPath?: string;
  themePath?: string;
};

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

function printHelp(): void {
  process.stdout.write(
    [
      'Usage:',
      '  draft2final <input.md> [--using <mkd-mkd|mkd-academic|mkd-literature|mkd-manuscript|mkd-screenplay>] [options]',
      '',
      'Options:',
      '  -o, --out <path>      Write output file (.pdf for PDF, .json for AST; default: <input>.pdf)',
      '  --config <path>       YAML config override file',
      '  --theme <path|name>   YAML theme file path or theme name under themes/<using>/',
      '  -h, --help            Show this help',
      '',
      'Defaults:',
      '  If --using is omitted, frontmatter is checked: using, transmuter, then format',
      '  Loads user-editable config file: config/<using>.config.yaml (if present)',
      '',
      'Examples:',
      '  draft2final sample.md --using mkd-academic --out sample.pdf',
      '  draft2final sample.md --using mkd-academic --out sample.json',
      '  draft2final screenplay.md --using mkd-screenplay --theme ./themes/studio.yaml',
      '  draft2final manuscript.md --using mkd-manuscript --config ./my-manuscript.config.yaml'
    ].join('\n') + '\n'
  );
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {};

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === '-h' || arg === '--help') {
      printHelp();
      process.exit(0);
    }
    if (arg === '--using') {
      options.using = argv[++i] as TransmuterName;
      continue;
    }
    if (arg === '-o' || arg === '--out') {
      options.outPath = argv[++i];
      continue;
    }
    if (arg === '--config') {
      options.configPath = argv[++i];
      continue;
    }
    if (arg === '--theme') {
      options.themePath = argv[++i];
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

function assertValidOptions(options: CliOptions): asserts options is CliOptions & { inputPath: string; using: TransmuterName } {
  if (!options.inputPath) {
    throw new Error('Missing input file. See --help.');
  }
  if (!options.using) {
    throw new Error('Missing transmuter. Pass --using or set frontmatter format/using/transmuter.');
  }
  if (!['mkd-mkd', 'mkd-academic', 'mkd-literature', 'mkd-manuscript', 'mkd-screenplay'].includes(options.using)) {
    throw new Error(`Unsupported transmuter "${options.using}".`);
  }
}

function mapFrontmatterValueToUsing(value: string | undefined): TransmuterName | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase().replace(/^['"]|['"]$/g, '');
  const mapped: Record<string, TransmuterName> = {
    'mkd-mkd': 'mkd-mkd',
    'mkd-academic': 'mkd-academic',
    'mkd-literature': 'mkd-literature',
    'mkd-manuscript': 'mkd-manuscript',
    'mkd-screenplay': 'mkd-screenplay',
    markdown: 'mkd-mkd',
    academic: 'mkd-academic',
    literature: 'mkd-literature',
    manuscript: 'mkd-manuscript',
    screenplay: 'mkd-screenplay'
  };
  return mapped[normalized];
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

function resolveUsing(options: CliOptions, markdown: string): TransmuterName | undefined {
  if (options.using) return options.using;
  const byUsing = mapFrontmatterValueToUsing(extractFrontmatterStringValue(markdown, 'using'));
  if (byUsing) return byUsing;
  const byTransmuter = mapFrontmatterValueToUsing(extractFrontmatterStringValue(markdown, 'transmuter'));
  if (byTransmuter) return byTransmuter;
  return mapFrontmatterValueToUsing(extractFrontmatterStringValue(markdown, 'format'));
}

function cleanScalar(value: string): string {
  return value.trim().replace(/^['"]|['"]$/g, '');
}

function createFsImageResolver(markdownPath: string): (src: string) => ResolvedImage | null {
  const baseDir = path.dirname(markdownPath);
  return (src: string): ResolvedImage | null => {
    if (!src || /^data:/i.test(src) || /^https?:\/\//i.test(src)) return null;

    let resolvedPath: string;
    if (/^file:\/\//i.test(src)) {
      try {
        const parsed = new URL(src);
        resolvedPath = decodeURIComponent(parsed.pathname);
        if (/^\/[A-Za-z]:\//.test(resolvedPath)) resolvedPath = resolvedPath.slice(1);
      } catch {
        return null;
      }
    } else {
      resolvedPath = path.isAbsolute(src) ? src : path.resolve(baseDir, src);
    }

    if (!fs.existsSync(resolvedPath)) return null;

    const ext = path.extname(resolvedPath).toLowerCase();
    const mimeType = ext === '.png'
      ? 'image/png'
      : ext === '.jpg' || ext === '.jpeg'
      ? 'image/jpeg'
      : null;
    if (!mimeType) return null;

    const data = fs.readFileSync(resolvedPath).toString('base64');
    return { data, mimeType };
  };
}

function loadDefaultConfig(usingName: TransmuterName): string | undefined {
  const configPath = path.resolve(__dirname, '..', 'config', `${usingName}.config.yaml`);
  if (!fs.existsSync(configPath)) return undefined;
  return fs.readFileSync(configPath, 'utf8');
}

function resolveThemeContent(
  usingName: TransmuterName,
  inputPath: string,
  markdown: string,
  cliTheme?: string
): string | undefined {
  const frontmatterTheme = extractFrontmatterStringValue(markdown, 'theme');
  const rawTheme = cliTheme ?? frontmatterTheme;
  if (!rawTheme) return undefined;
  const themeValue = cleanScalar(rawTheme);
  if (!themeValue) return undefined;

  const rootDir = path.resolve(__dirname, '..');
  const directCandidates = [
    path.resolve(themeValue),
    path.resolve(path.dirname(inputPath), themeValue)
  ];
  for (const candidate of directCandidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return fs.readFileSync(candidate, 'utf8');
    }
  }

  const hasExt = /\.(ya?ml)$/i.test(themeValue);
  const themeCandidates = hasExt
    ? [path.resolve(rootDir, 'themes', usingName, themeValue)]
    : [
        path.resolve(rootDir, 'themes', usingName, `${themeValue}.yaml`),
        path.resolve(rootDir, 'themes', usingName, `${themeValue}.yml`)
      ];
  for (const candidate of themeCandidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return fs.readFileSync(candidate, 'utf8');
    }
  }

  // Keep old sample compatibility: frontmatter theme "default" can defer to transmuter defaults.
  if (!cliTheme && themeValue.toLowerCase() === 'default') {
    return undefined;
  }

  throw new Error(
    `Theme "${themeValue}" not found. Checked: ${[...directCandidates, ...themeCandidates].join(', ')}`
  );
}

function runTransmuter(
  name: TransmuterName,
  markdown: string,
  resolveImage?: (src: string) => ResolvedImage | null,
  config?: string,
  theme?: string
): unknown {
  const options = {
    ...(resolveImage ? { resolveImage } : {}),
    ...(config ? { config } : {}),
    ...(theme ? { theme } : {})
  };
  if (name === 'mkd-mkd') return transmuteMkd(markdown, options);
  if (name === 'mkd-academic') return transmuteAcademic(markdown, options);
  if (name === 'mkd-literature') return transmuteLiterature(markdown, options);
  if (name === 'mkd-manuscript') return transmuteManuscript(markdown, options);
  return transmuteScreenplay(markdown, options);
}

function resolveOutputPdfPath(inputPath: string, outPath?: string): string {
  if (outPath) return path.resolve(outPath);
  const parsed = path.parse(inputPath);
  return path.resolve(parsed.dir, `${parsed.name}.pdf`);
}

function getOutputMode(outputPath: string): 'pdf' | 'json' {
  const ext = path.extname(outputPath).toLowerCase();
  if (ext === '.json') return 'json';
  if (ext === '.pdf' || ext === '') return 'pdf';
  throw new Error(`Unsupported output extension "${ext}". Use .pdf or .json.`);
}

async function renderPdf(ir: unknown, inputPath: string, outputPath: string): Promise<void> {
  const runtime = createEngineRuntime({ fontManager: new LocalFontManager() });
  const documentIR = resolveDocumentPaths(ir as never, inputPath);
  const config = toLayoutConfig(documentIR, false);
  const engine = new LayoutEngine(config, runtime);
  await engine.waitForFonts();
  const pages = engine.paginate(documentIR.elements);

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  const { width, height } = LayoutUtils.getPageDimensions(config);
  const context = new PdfContext({
    size: [width, height],
    margins: { top: 0, left: 0, right: 0, bottom: 0 },
    autoFirstPage: false,
    bufferPages: false
  });
  const outputStream = new NodeWriteStreamAdapter(outputPath);
  context.pipe(outputStream);

  const renderer = new Renderer(config, false, runtime);
  await renderer.render(pages, context);
  await outputStream.waitForFinish();
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (!options.inputPath) {
    throw new Error('Missing input file. See --help.');
  }

  const inputPath = path.resolve(options.inputPath);
  const markdown = fs.readFileSync(inputPath, 'utf8');
  options.using = resolveUsing(options, markdown);
  if (!options.using) {
    throw new Error('Unable to determine transmuter. Pass --using or add frontmatter: format/using/transmuter.');
  }
  assertValidOptions(options as CliOptions & { inputPath: string; using: TransmuterName });
  const resolveImage = createFsImageResolver(inputPath);

  const defaultConfig = loadDefaultConfig(options.using);
  const config = options.configPath
    ? fs.readFileSync(path.resolve(options.configPath), 'utf8')
    : defaultConfig;
  const theme = resolveThemeContent(options.using, inputPath, markdown, options.themePath);

  const ir = runTransmuter(options.using, markdown, resolveImage, config, theme);
  const outputPath = resolveOutputPdfPath(inputPath, options.outPath);
  const mode = getOutputMode(outputPath);

  if (mode === 'json') {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(ir, null, 2), 'utf8');
    process.stdout.write(`[draft2final] Wrote AST ${outputPath}\n`);
    return;
  }

  await renderPdf(ir, inputPath, outputPath);
  process.stdout.write(`[draft2final] Wrote ${outputPath}\n`);
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`[draft2final] Error: ${message}\n`);
  process.exit(1);
});

