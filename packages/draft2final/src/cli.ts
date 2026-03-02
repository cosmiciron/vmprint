import fs from 'node:fs';
import path from 'node:path';
import { Command, CommanderError } from 'commander';
import { buildMarkdownToPdf, compileToVmprint } from './build';
import { Draft2FinalError, formatDiagnostic } from './errors';
import { listFormatThemes, listFormats } from './formats';

const program = new Command();

program
    .name('draft2final')
    .description('Convert Markdown to PDF using the vmprint layout engine.')
    .version(process.env.npm_package_version || '0.1.0')
    .exitOverride();

function handleBuildError(error: unknown, formatName: string): void {
    if (error instanceof Draft2FinalError) {
        if (error.message.startsWith('Unknown format')) {
            process.stderr.write(`[draft2final] available formats: ${listFormats().join(', ')}\n`);
        } else if (error.message.includes('Unknown theme')) {
            const available = listFormatThemes(formatName);
            process.stderr.write(`[draft2final] available themes for "${formatName}": ${available.join(', ')}\n`);
        }
        process.stderr.write(`${formatDiagnostic(error)}\n`);
        process.exitCode = error.exitCode;
        return;
    }
    const message = error instanceof Error ? error.message : String(error);
    const wrapped = new Draft2FinalError('cli', 'unknown', message, 1, { cause: error });
    process.stderr.write(`${formatDiagnostic(wrapped)}\n`);
    process.exitCode = 1;
}

program
    .command('build')
    .description('Build a Markdown file into a PDF.')
    .argument('<input>', 'Input Markdown file')
    .option('-o, --output <path>', 'Output path (.pdf for PDF, .json for AST; omit to print AST to stdout)')
    .option('--format <name>', 'Document format (overrides frontmatter)')
    .option('--theme <name>', 'Theme name (overrides frontmatter)')
    .option('-d, --debug', 'Embed layout debug boxes in the output PDF', false)
    .option('--ast', 'Output the compiled document AST as JSON instead of rendering a PDF', false)
    .action(
        async (
            inputArg: string,
            options: { output?: string; format?: string; theme?: string; debug: boolean; ast: boolean },
        ) => {
            const inputPath = path.resolve(inputArg);
            const cliFlags: Record<string, unknown> = {};
            if (options.format) cliFlags.format = options.format;
            if (options.theme) cliFlags.theme = options.theme;

            let markdown: string;
            try {
                markdown = fs.readFileSync(inputPath, 'utf-8');
            } catch (error: unknown) {
                const message = error instanceof Error ? error.message : String(error);
                const err = new Draft2FinalError('parse', inputPath, `Failed to read input file: ${message}`, 3, {
                    cause: error,
                });
                process.stderr.write(`${formatDiagnostic(err)}\n`);
                process.exitCode = 3;
                return;
            }

            if (options.ast) {
                // AST-only mode: compile and emit JSON, no PDF rendering
                try {
                    const result = compileToVmprint(markdown, inputPath, cliFlags);
                    const json = JSON.stringify(result.ir, null, 2);

                    if (options.output) {
                        const outputPath = path.resolve(options.output);
                        fs.mkdirSync(path.dirname(outputPath), { recursive: true });
                        fs.writeFileSync(outputPath, json, 'utf-8');
                        process.stderr.write(`[draft2final] Wrote AST JSON to ${outputPath}\n`);
                    } else {
                        process.stdout.write(json + '\n');
                    }
                    process.exitCode = 0;
                } catch (error: unknown) {
                    handleBuildError(error, options.format || 'markdown');
                }
                return;
            }

            // PDF mode: -o is required and must end in .pdf
            const outputPath = options.output;
            if (!outputPath) {
                process.stderr.write(`[draft2final] -o/--output is required when not using --ast\n`);
                process.exitCode = 2;
                return;
            }

            if (path.extname(outputPath).toLowerCase() !== '.pdf') {
                process.stderr.write(`[draft2final] Output path must end with .pdf\n`);
                process.exitCode = 2;
                return;
            }

            try {
                await buildMarkdownToPdf(markdown, inputPath, outputPath, cliFlags, options.debug);
                process.stdout.write(`[draft2final] Wrote PDF ${path.resolve(outputPath)}\n`);
                process.exitCode = 0;
            } catch (error: unknown) {
                handleBuildError(error, options.format || 'markdown');
            }
        },
    );

async function run(): Promise<void> {
    try {
        await program.parseAsync();
    } catch (err) {
        if (err instanceof CommanderError) {
            if (err.code === 'commander.helpDisplayed' || err.code === 'commander.version') {
                process.exitCode = 0;
            } else {
                process.exitCode = 2;
            }
        } else {
            throw err;
        }
    }
}

void run();
