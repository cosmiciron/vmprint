import fs from 'node:fs';
import path from 'node:path';
import { transmute as transmuteMkd } from '../transmuters/mkd-mkd/src/index';
import { transmute as transmuteAcademic } from '../transmuters/mkd-academic/src/index';
import { transmute as transmuteLiterature } from '../transmuters/mkd-literature/src/index';
import { transmute as transmuteManuscript } from '../transmuters/mkd-manuscript/src/index';
import { transmute as transmuteScreenplay } from '../transmuters/mkd-screenplay/src/index';
import type { DocumentInput, ResolvedImage } from '../transmuters/markdown-core/src';

type TransmuterName = 'mkd-mkd' | 'mkd-academic' | 'mkd-literature' | 'mkd-manuscript' | 'mkd-screenplay';

type CliOptions = {
  inputPath?: string;
  using?: TransmuterName;
  outPath?: string;
  configPath?: string;
  themePath?: string;
  pretty: boolean;
};

function printHelp(): void {
  process.stdout.write(
    [
      'Usage:',
      '  npm run transmute -- <input.md> --using <mkd-mkd|mkd-academic|mkd-literature|mkd-manuscript|mkd-screenplay> [options]',
      '',
      'Options:',
      '  -o, --out <path>      Write JSON output to file (default: stdout)',
      '  --config <path>       YAML config override file',
      '  --theme <path>        YAML theme override file',
      '  --pretty              Pretty-print JSON (default)',
      '  --compact             Compact JSON output',
      '  -h, --help            Show this help',
      '',
      'Examples:',
      '  npm run transmute -- sample.md --using mkd-academic --out sample.ast.json',
      '  npm run transmute -- sample.md --using mkd-literature --theme my.theme.yaml --config my.config.yaml',
      '  npm run transmute -- manuscript.md --using mkd-manuscript --out manuscript.ast.json',
      '  npm run transmute -- screenplay.md --using mkd-screenplay --out screenplay.ast.json'
    ].join('\n') + '\n'
  );
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { pretty: true };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === '-h' || arg === '--help') {
      printHelp();
      process.exit(0);
    }
    if (arg === '--pretty') {
      options.pretty = true;
      continue;
    }
    if (arg === '--compact') {
      options.pretty = false;
      continue;
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
    throw new Error('Missing --using <mkd-mkd|mkd-academic|mkd-literature|mkd-manuscript|mkd-screenplay>.');
  }
  if (!['mkd-mkd', 'mkd-academic', 'mkd-literature', 'mkd-manuscript', 'mkd-screenplay'].includes(options.using)) {
    throw new Error(`Unsupported transmuter "${options.using}".`);
  }
}

function runTransmuter(
  name: TransmuterName,
  markdown: string,
  resolveImage?: (src: string) => ResolvedImage | null,
  config?: string,
  theme?: string
): DocumentInput {
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

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  assertValidOptions(options);

  const inputPath = path.resolve(options.inputPath);
  const markdown = fs.readFileSync(inputPath, 'utf8');
  const config = options.configPath ? fs.readFileSync(path.resolve(options.configPath), 'utf8') : undefined;
  const theme = options.themePath ? fs.readFileSync(path.resolve(options.themePath), 'utf8') : undefined;
  const resolveImage = createFsImageResolver(inputPath);

  const output = runTransmuter(options.using, markdown, resolveImage, config, theme);
  const json = JSON.stringify(output, null, options.pretty ? 2 : 0);

  if (options.outPath) {
    const outPath = path.resolve(options.outPath);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, json, 'utf8');
    process.stdout.write(`[transmute] Wrote ${outPath}\n`);
    return;
  }

  process.stdout.write(json + '\n');
}

try {
  main();
} catch (error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`[transmute] Error: ${message}\n`);
  process.exit(1);
}
