import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

type Violation = {
    file: string;
    line: number;
    text: string;
    reason: string;
};

const ROOT = path.resolve(__dirname, '..');
const SCAN_DIRS = ['src', 'tests'];
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.mjs', '.cjs']);

const FORBIDDEN_IMPORT_RULES: Array<{ pattern: RegExp; reason: string }> = [
    {
        pattern: /from\s+['"](?:\.\.\/)+vmprint\/src(?:\/|['"])/,
        reason: 'Do not import vmprint source internals via relative paths.',
    },
    {
        pattern: /require\(\s*['"](?:\.\.\/)+vmprint\/src(?:\/|['"])/,
        reason: 'Do not require vmprint source internals via relative paths.',
    },
    {
        pattern: /from\s+['"]@vmprint\/engine\/(?!package\.json)[^'"]+['"]/,
        reason: 'Import only from "@vmprint/engine" public entrypoint.',
    },
    {
        pattern: /require\(\s*['"]@vmprint\/engine\/(?!package\.json)[^'"]+['"]/,
        reason: 'Require only from "@vmprint/engine" public entrypoint.',
    },
];

function collectFiles(target: string, out: string[]): void {
    const stat = fs.statSync(target);
    if (stat.isDirectory()) {
        for (const entry of fs.readdirSync(target)) {
            if (entry === 'dist' || entry === 'node_modules') continue;
            collectFiles(path.join(target, entry), out);
        }
        return;
    }

    const ext = path.extname(target).toLowerCase();
    if (SOURCE_EXTENSIONS.has(ext)) out.push(target);
}

function findViolations(filePath: string): Violation[] {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const lines = raw.split(/\r?\n/);
    const violations: Violation[] = [];

    for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i];
        for (const rule of FORBIDDEN_IMPORT_RULES) {
            if (!rule.pattern.test(line)) continue;
            violations.push({
                file: path.relative(ROOT, filePath),
                line: i + 1,
                text: line.trim(),
                reason: rule.reason,
            });
        }
    }

    return violations;
}

function run(): void {
    const files: string[] = [];
    for (const dir of SCAN_DIRS) {
        const resolved = path.join(ROOT, dir);
        if (!fs.existsSync(resolved)) continue;
        collectFiles(resolved, files);
    }

    const violations = files.flatMap((filePath) => findViolations(filePath));

    assert.equal(
        violations.length,
        0,
        `Boundary violation(s) detected:\n${violations
            .map((v) => `- ${v.file}:${v.line} ${v.reason}\n  ${v.text}`)
            .join('\n')}`,
    );

    process.stdout.write('[draft2final:boundary] import boundary checks passed\n');
}

run();
