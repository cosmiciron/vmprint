import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type { VmprintOutputStream } from '@vmprint/contracts';
import { createEngineRuntime, LayoutEngine, LayoutUtils, Renderer, resolveDocumentPaths, toLayoutConfig } from '@vmprint/engine';
import PdfContext from '@vmprint/context-pdf';
import LocalFontManager from '@vmprint/local-fonts';
import { transmute as transmuteMkd } from '@vmprint/transmuter-mkd-mkd';
import { transmute as transmuteAcademic } from '@vmprint/transmuter-mkd-academic';
import { transmute as transmuteLiterature } from '@vmprint/transmuter-mkd-literature';
import { transmute as transmuteManuscript } from '@vmprint/transmuter-mkd-manuscript';
import { transmute as transmuteScreenplay } from '@vmprint/transmuter-mkd-screenplay';

import pkg from '../package.json';

type ResolvedImage = {
  data: string;
  mimeType: 'image/png' | 'image/jpeg';
};

type TransmuterName = 'mkd-mkd' | 'mkd-academic' | 'mkd-literature' | 'mkd-manuscript' | 'mkd-screenplay';

type CliOptions = {
  newPath?: string;
  inputPath?: string;
  as?: TransmuterName;
  outputPath?: string;
  stylePath?: string;
  onlineGuide?: boolean;
  version?: boolean;
};

const GUIDE_URL = 'https://cosmiciron.github.io/vmprint/draft2final/';
const INIT_TEMPLATE_MAP: Partial<Record<TransmuterName, string>> = {
  'mkd-manuscript': path.join('templates', 'mkd-manuscript', 'starter.md'),
  'mkd-screenplay': path.join('templates', 'mkd-screenplay', 'starter.md')
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

function loadStarterTemplate(usingName?: TransmuterName): string | undefined {
  if (!usingName) return undefined;
  const relativePath = INIT_TEMPLATE_MAP[usingName];
  if (!relativePath) return undefined;
  const candidates = [
    path.resolve(__dirname, '..', relativePath),
    path.resolve(__dirname, '..', 'dist', relativePath),
    path.resolve(process.cwd(), relativePath),
    path.resolve(process.cwd(), 'dist', relativePath),
    path.resolve(process.cwd(), 'draft2final', relativePath),
    path.resolve(process.cwd(), 'draft2final', 'dist', relativePath)
  ];
  for (const templatePath of candidates) {
    if (fs.existsSync(templatePath)) {
      return fs.readFileSync(templatePath, 'utf8');
    }
  }
  return undefined;
}

function scaffoldProject(targetPathArg: string, usingName?: TransmuterName): void {
  const targetPath = path.resolve(process.cwd(), targetPathArg);
  if (fs.existsSync(targetPath)) {
    throw new Error(`Path "${targetPathArg}" already exists.`);
  }

  const fallbackMarkdownContent = [
    '---',
    'title: Hello World',
    'author: Author Name',
    '---',
    '',
    '# Welcome to Draft2Final',
    '',
    'This is a sample document scaffolded by the CLI.',
    '',
    '## Typography',
    '',
    'By default, this uses **Caladea** for serif text and **Cousine** for `monospaced code`.',
    '',
    '### Lists',
    '',
    '- One',
    '- Two',
    '- Three',
    '',
    'Enjoy your typesetting!',
    ''
  ].join('\n');
  const markdownContent = loadStarterTemplate(usingName) ?? fallbackMarkdownContent;

  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, markdownContent, 'utf8');

  process.stdout.write(`[draft2final] Created starter file: ${targetPath}\n`);
  if (usingName === 'mkd-manuscript' || usingName === 'mkd-screenplay') {
    const shortName = usingName === 'mkd-manuscript' ? 'manuscript' : 'screenplay';
    process.stdout.write(`  To build a PDF, run:\n`);
    process.stdout.write(`    draft2final ${targetPathArg} --as ${shortName}\n`);
    return;
  }
  process.stdout.write(`  To build a PDF, run:\n`);
  process.stdout.write(`    draft2final ${targetPathArg}\n`);
}

function normalizeFormatName(value: string | undefined): TransmuterName | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase().replace(/^['"]|['"]$/g, '');
  const mapped: Record<string, TransmuterName> = {
    academic: 'mkd-academic',
    literature: 'mkd-literature',
    manuscript: 'mkd-manuscript',
    screenplay: 'mkd-screenplay'
  };
  return mapped[normalized];
}

function printHelp(): void {
  process.stdout.write(
    [
      `draft2final v${pkg.version}`,
      '',
      'Usage:',
      '  draft2final story.md',
      '  draft2final story.md --as manuscript',
      '  draft2final --new story.md --as manuscript',
      '',
      'Options:',
      '  --new <file.md>      Create a starter Markdown file',
      '  --as <format>        The type of document (manuscript, screenplay, academic, literature)',
      '  --style <name>       Choose a visual style/theme (e.g. "classic", "standard")',
      '  --output <path>      Write output file (.pdf or .json)',
      '  --online-guide       Open the user guide in your browser',
      '  --version            Show version',
      '  --help               Show this help',
      '',
      'Forms (--as):',
      '  manuscript    The gold standard for prose submissions',
      '  screenplay    Industry-standard script formatting with dual-dialogue',
      '  academic      Precise layouts for research drafts and formal papers',
      '  literature    Clean, elegant designs for poetry and prose',
      '',
      'Examples:',
      '  draft2final story.md',
      '  draft2final story.md --as manuscript',
      '  draft2final script.md --as screenplay --style classic',
      '  draft2final paper.md --as academic --output draft.pdf'
    ].join('\n') + '\n'
  );
}

function printWelcome(): void {
  const B = '\x1b[1m';
  const R = '\x1b[0m';
  const G = '\x1b[32m';
  const C = '\x1b[36m';
  const M = '\x1b[35m';
  const D = '\x1b[90m'; // Dim

  process.stdout.write(
    [
      '',
      `  ${B}${M}✦${R} ${B}${C}DRAFT 2 FINAL${R} ${D}v${pkg.version}${R}`,
      `  ${D}Industrial-strength typesetting for the discerning writer.${R}`,
      '',
      `  ${B}Turn your writings in plain text into beautifully formatted:${R}`,
      `    ${G}manuscript${R}   Novels and memoirs`,
      `    ${G}screenplay${R}   Film and stage scripts`,
      `    ${G}academic${R}     Formal research papers`,
      `    ${G}literature${R}   Literary prose and poetry`,
      '',
      `  ${B}Quick Start${R}`,
      `    ${D}1.${R} Create    ${C}draft2final --new story.md --as manuscript${R}`,
      `    ${D}2.${R} Render    ${C}draft2final story.md${R}`,
      '',
      `  ${B}Documentation${R}`,
      `    ${B}--online-guide${R}`,
      '',
      `  ${D}Type${R} --help ${D}for more options.${R}`,
      ''
    ].join('\n')
  );
}

function openExternalUrl(url: string): void {
  if (process.platform === 'win32') {
    const child = spawn('cmd', ['/c', 'start', '""', url], { stdio: 'ignore', windowsHide: true, detached: true });
    child.unref();
    return;
  }
  if (process.platform === 'darwin') {
    const child = spawn('open', [url], { stdio: 'ignore', detached: true });
    child.unref();
    return;
  }
  const child = spawn('xdg-open', [url], { stdio: 'ignore', detached: true });
  child.unref();
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {};

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === '--help') {
      printHelp();
      process.exit(0);
    }
    if (arg === '--new') {
      options.newPath = argv[++i] || 'my-project.md';
      continue;
    }
    if (arg === '--version') {
      process.stdout.write(`v${pkg.version}\n`);
      process.exit(0);
    }
    if (arg === '--online-guide') {
      options.onlineGuide = true;
      continue;
    }
    if (arg === '--as') {
      options.as = normalizeFormatName(argv[++i]);
      continue;
    }
    if (arg === '--output') {
      options.outputPath = argv[++i];
      continue;
    }
    if (arg === '--style') {
      options.stylePath = argv[++i];
      continue;
    }
    if (arg.startsWith('-')) {
      throw new Error(`Unknown option: ${arg}. Type --help for valid options.`);
    }
    if (!options.inputPath) {
      options.inputPath = arg;
      continue;
    }
    throw new Error(`Unexpected positional argument: ${arg}`);
  }

  return options;
}

function assertSupportedUsingName(usingName: string | undefined): asserts usingName is TransmuterName | undefined {
  if (!usingName) return;
  if (!['mkd-mkd', 'mkd-academic', 'mkd-literature', 'mkd-manuscript', 'mkd-screenplay'].includes(usingName)) {
    throw new Error(`Unsupported document type. Use --help to see available formats.`);
  }
}

function assertValidOptions(options: CliOptions): asserts options is CliOptions & { inputPath: string; as: TransmuterName } {
  if (!options.inputPath) {
    throw new Error('Missing input file. See --help.');
  }
  if (!options.as) {
    (options as any).as = 'mkd-mkd';
  }
  assertSupportedUsingName(options.as);
}

function mapFrontmatterValueToUsing(value: string | undefined): TransmuterName | undefined {
  return normalizeFormatName(value);
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
  if (options.as) return options.as;
  const byAs = normalizeFormatName(extractFrontmatterStringValue(markdown, 'as'));
  if (byAs) return byAs;

  return 'mkd-mkd';
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



function resolveThemeContent(
  usingName: TransmuterName,
  inputPath: string,
  markdown: string,
  cliTheme?: string
): string | undefined {
  const frontmatterTheme = extractFrontmatterStringValue(markdown, 'theme') ?? extractFrontmatterStringValue(markdown, 'style');
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
  theme?: string
): unknown {
  const options = {
    ...(resolveImage ? { resolveImage } : {}),
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

function pruneUnusedFallbacks(registry: any[], elements: any[]): void {
  const usedCodePoints = new Set<number>();

  const extract = (els: any[]) => {
    if (!els) return;
    for (const el of els) {
      if (typeof el.content === 'string') {
        const text = el.content;
        for (let i = 0; i < text.length; i++) {
          const cp = text.codePointAt(i);
          if (cp !== undefined) {
            usedCodePoints.add(cp);
            if (cp > 0xFFFF) i++;
          }
        }
      }
      if (el.children && Array.isArray(el.children)) {
        extract(el.children);
      }
    }
  };

  extract(elements);

  for (const font of registry) {
    if (font.fallback && font.enabled && font.unicodeRange) {
      let isUsed = false;
      const ranges = font.unicodeRange.split(',').map((r: string) => r.trim());
      for (const range of ranges) {
        const match = range.match(/U\+([0-9A-Fa-f]+)(?:-([0-9A-Fa-f]+))?/i);
        if (match) {
          const start = parseInt(match[1], 16);
          const end = match[2] ? parseInt(match[2], 16) : start;
          for (const cp of usedCodePoints) {
            if (cp >= start && cp <= end) {
              isUsed = true;
              break;
            }
          }
        }
        if (isUsed) break;
      }
      if (!isUsed) {
        font.enabled = false;
      }
    }
  }
}

async function renderPdf(ir: unknown, inputPath: string, outputPath: string): Promise<void> {
  const runtime = createEngineRuntime({ fontManager: new LocalFontManager() });
  const documentIR = resolveDocumentPaths(ir as never, inputPath);

  pruneUnusedFallbacks(runtime.fontRegistry, documentIR.elements);

  const config = toLayoutConfig(documentIR, false);
  const engine = new LayoutEngine(config, runtime);


  process.stdout.write(`[draft2final] Loading fonts and paginating...\n`);
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
  process.stdout.write(`[draft2final] Rendering ${pages.length} pages...\n`);
  await renderer.render(pages, context);
  await outputStream.waitForFinish();
}

async function main(): Promise<void> {
  const start = Date.now();
  const argv = process.argv.slice(2);
  if (argv.length === 0) {
    printWelcome();
    return;
  }
  const options = parseArgs(argv);
  assertSupportedUsingName(options.as);
  if (options.onlineGuide) {
    openExternalUrl(GUIDE_URL);
    process.stdout.write(`[draft2final] Opened guide: ${GUIDE_URL}\n`);
    return;
  }
  if (options.newPath) {
    scaffoldProject(options.newPath, options.as);
    return;
  }
  if (!options.inputPath) {
    throw new Error('Missing input file. See --help.');
  }

  const inputPath = path.resolve(options.inputPath);
  if (!fs.existsSync(inputPath)) {
    throw new Error(`Input file not found: ${inputPath}`);
  }

  const markdown = fs.readFileSync(inputPath, 'utf8');
  options.as = resolveUsing(options, markdown);
  if (!options.as) {
    options.as = 'mkd-mkd';
  }
  assertValidOptions(options as CliOptions & { inputPath: string; as: TransmuterName });
  const resolveImage = createFsImageResolver(inputPath);

  const theme = resolveThemeContent(options.as, inputPath, markdown, options.stylePath);

  const humanName = Object.entries({
    academic: 'mkd-academic',
    literature: 'mkd-literature',
    manuscript: 'mkd-manuscript',
    screenplay: 'mkd-screenplay'
  }).find(([_, v]) => v === options.as)?.[0] || 'plain markdown';

  process.stdout.write(`[draft2final] Transmuting as ${humanName}...\n`);
  const ir = runTransmuter(options.as, markdown, resolveImage, theme);
  const outputPath = resolveOutputPdfPath(inputPath, options.outputPath);
  const mode = getOutputMode(outputPath);

  if (mode === 'json') {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(ir, null, 2), 'utf8');
    process.stdout.write(`[draft2final] Wrote AST ${outputPath}\n`);
    return;
  }

  await renderPdf(ir, inputPath, outputPath);
  const duration = ((Date.now() - start) / 1000).toFixed(2);
  process.stdout.write(`[draft2final] Success: ${outputPath} (${duration}s)\n`);
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`[draft2final] Error: ${message}\n`);
  process.exit(1);
});

