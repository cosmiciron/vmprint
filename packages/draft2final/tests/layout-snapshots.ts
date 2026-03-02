import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { compileToVmprint } from '../src/build';
import { listFormatThemes, listFormats } from '../src/formats';
import { LayoutEngine, createEngineRuntime, toLayoutConfig, resolveDocumentPaths } from '@vmprint/engine';
import { LocalFontManager } from '@vmprint/local-fonts';

type LayoutSnapshotCase = {
    name: string;
    fixturePath: string;
    format: string;
    theme?: string;
    config?: Record<string, unknown>;
};

type LayoutSnapshotSegment = {
    text: string;
    width: number;
    ascent: number;
    descent: number;
    fontFamily: string;
};

type LayoutSnapshotBox = {
    type: string;
    x: number;
    y: number;
    w: number;
    h: number;
    lines: LayoutSnapshotSegment[][];
};

type LayoutSnapshotPage = {
    index: number;
    width: number;
    height: number;
    boxes: LayoutSnapshotBox[];
};

const LAYOUT_SNAPSHOT_CASES: LayoutSnapshotCase[] = [
    {
        name: 'markdown-default-layout',
        fixturePath: path.resolve('tests/fixtures/markdown-layout-sample.md'),
        format: 'markdown',
        theme: 'default',
    },
    {
        name: 'markdown-opensource-layout',
        fixturePath: path.resolve('tests/fixtures/markdown-opensource-layout-sample.md'),
        format: 'markdown',
        theme: 'opensource',
        config: {
            title: { subheading: { enabled: true } },
        },
    },
    {
        name: 'literature-default-layout',
        fixturePath: path.resolve('tests/fixtures/markdown-literature-layout-sample.md'),
        format: 'literature',
        theme: 'default',
    },
    {
        name: 'academic-default-layout',
        fixturePath: path.resolve('tests/fixtures/markdown-academic-layout-sample.md'),
        format: 'academic',
        theme: 'default',
    },
    {
        name: 'screenplay-default-layout',
        fixturePath: path.resolve('tests/fixtures/screenplay-sample.md'),
        format: 'screenplay',
    },
    {
        name: 'screenplay-production-layout',
        fixturePath: path.resolve('tests/fixtures/screenplay-production-layout-sample.md'),
        format: 'screenplay',
        theme: 'production',
    },
];

function round6(value: number): number {
    return Number(value.toFixed(6));
}

function snapshotPages(pages: any[]): LayoutSnapshotPage[] {
    return pages.map((page) => ({
        index: page.index,
        width: page.width,
        height: page.height,
        boxes: (page.boxes || []).map((box: any) => ({
            type: String(box.type),
            x: round6(Number(box.x || 0)),
            y: round6(Number(box.y || 0)),
            w: round6(Number(box.w || 0)),
            h: round6(Number(box.h || 0)),
            lines: (box.lines || []).map((line: any[]) =>
                line.map((seg: any) => ({
                    text: String(seg?.text || ''),
                    width: round6(Number(seg?.width || 0)),
                    ascent: round6(Number(seg?.ascent || 0)),
                    descent: round6(Number(seg?.descent || 0)),
                    fontFamily: String(seg?.fontFamily || ''),
                })),
            ),
        })),
    }));
}

function shouldUpdateSnapshots(): boolean {
    return (
        process.argv.includes('--update-layout-snapshots') || process.env.DRAFT2FINAL_UPDATE_LAYOUT_SNAPSHOTS === '1'
    );
}

function matrixKey(format: string, theme?: string): string {
    return `${format}:${theme || 'default'}`;
}

function assertSnapshotMatrixCoverage(): void {
    const knownFormats = new Set(listFormats());
    const supportedThemeKeys = new Set<string>();
    for (const format of knownFormats) {
        const themes = listFormatThemes(format);
        for (const theme of themes) {
            supportedThemeKeys.add(matrixKey(format, theme));
        }
    }

    const coveredKeys = new Set<string>();
    for (const testCase of LAYOUT_SNAPSHOT_CASES) {
        assert.ok(
            knownFormats.has(testCase.format),
            `snapshot case "${testCase.name}" uses unknown format "${testCase.format}"`,
        );

        const supportedThemes = new Set(listFormatThemes(testCase.format));
        const resolvedTheme = testCase.theme || 'default';
        assert.ok(
            supportedThemes.has(resolvedTheme),
            `snapshot case "${testCase.name}" uses unknown theme "${resolvedTheme}" for format "${testCase.format}"`,
        );

        const key = matrixKey(testCase.format, testCase.theme);
        assert.equal(
            coveredKeys.has(key),
            false,
            `duplicate snapshot coverage for format/theme pair "${key}" (case "${testCase.name}")`,
        );
        coveredKeys.add(key);
    }

    const missingKeys = [...supportedThemeKeys].filter((key) => !coveredKeys.has(key)).sort();
    assert.equal(
        missingKeys.length,
        0,
        `layout snapshot coverage missing for supported format/theme pairs: ${missingKeys.join(', ')}`,
    );
}

function resolveSnapshotPath(fixturePath: string): string {
    const ext = path.extname(fixturePath);
    return fixturePath.slice(0, fixturePath.length - ext.length) + '.snapshot.layout.json';
}

async function buildLayoutSnapshot(testCase: LayoutSnapshotCase): Promise<LayoutSnapshotPage[]> {
    const markdown = fs.readFileSync(testCase.fixturePath, 'utf-8');
    // For screenplay: pass theme as flavor (screenplay uses listFlavors/compile-with-flavor)
    const flavor = testCase.theme && testCase.theme !== 'default' ? testCase.theme : undefined;
    const cliFlags: Record<string, unknown> = {
        format: testCase.format,
        theme: testCase.theme,
        flavor,
        ...(testCase.config ?? {}),
    };
    const documentInput = compileToVmprint(markdown, testCase.fixturePath, cliFlags).ir;
    const ir = resolveDocumentPaths(documentInput, testCase.fixturePath);
    const config = toLayoutConfig(ir, false);
    const runtime = createEngineRuntime({ fontManager: new LocalFontManager() });
    const engine = new LayoutEngine(config, runtime);
    await engine.waitForFonts();

    const pagesA = engine.paginate(ir.elements);
    const pagesB = engine.paginate(ir.elements);
    const snapshotA = snapshotPages(pagesA);
    const snapshotB = snapshotPages(pagesB);

    assert.deepEqual(
        snapshotA,
        snapshotB,
        `${testCase.name}: repeated paginate calls produced different layout output`,
    );

    return snapshotA;
}

function writeSnapshot(snapshotPath: string, data: LayoutSnapshotPage[]): void {
    fs.writeFileSync(snapshotPath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
}

function assertSnapshot(testCase: LayoutSnapshotCase, actual: LayoutSnapshotPage[], updateSnapshots: boolean): void {
    const snapshotPath = resolveSnapshotPath(testCase.fixturePath);

    if (!fs.existsSync(snapshotPath)) {
        if (!updateSnapshots) {
            throw new Error(
                `${testCase.name}: snapshot missing at ${snapshotPath}. Re-run tests with --update-layout-snapshots to create it.`,
            );
        }

        writeSnapshot(snapshotPath, actual);
        return;
    }

    if (updateSnapshots) {
        writeSnapshot(snapshotPath, actual);
        return;
    }

    const expectedRaw = fs.readFileSync(snapshotPath, 'utf-8');
    const expected = JSON.parse(expectedRaw) as LayoutSnapshotPage[];
    assert.deepEqual(actual, expected, `${testCase.name}: layout snapshot mismatch (${snapshotPath})`);
}

export async function runLayoutSnapshotTests(): Promise<void> {
    assertSnapshotMatrixCoverage();
    const updateSnapshots = shouldUpdateSnapshots();
    for (const testCase of LAYOUT_SNAPSHOT_CASES) {
        const actual = await buildLayoutSnapshot(testCase);
        assertSnapshot(testCase, actual, updateSnapshots);
    }
}
