import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Context, ContextImageOptions, ContextTextOptions } from '@vmprint/contracts';
import { DocumentIR, Page } from '../../src/engine/types';
import { LayoutUtils } from '../../src/engine/layout/layout-utils';
import { resolveDocumentPaths } from '../../src/engine/document';

const COMBINING_MARK_REGEX = /[\u0300-\u036f]/;

const HARNESS_PACKAGE_ROOT = path.resolve(__dirname, '..', '..');
const HARNESS_FIXTURES_CANDIDATES = [
    path.join(HARNESS_PACKAGE_ROOT, 'tests', 'fixtures'),
    path.join(HARNESS_PACKAGE_ROOT, 'src', 'tests', 'fixtures'),
];

const resolveHarnessFixturesDir = (): string => {
    const resolved = HARNESS_FIXTURES_CANDIDATES.find((candidate) => fs.existsSync(candidate));
    if (!resolved) {
        throw new Error(
            `[engine-harness] Could not find fixtures directory. Tried: ${HARNESS_FIXTURES_CANDIDATES.join(', ')}`,
        );
    }
    return resolved;
};

export const HARNESS_ROOT = HARNESS_PACKAGE_ROOT;
export const HARNESS_FIXTURES_DIR = resolveHarnessFixturesDir();
export const HARNESS_REGRESSION_CASES_DIR = path.join(HARNESS_FIXTURES_DIR, 'regression');
export const HARNESS_DEMO_CASES_DIR = path.join(HARNESS_FIXTURES_DIR, 'demo');
const ADVANCED_LAYOUT_FIXTURE = '02-text-layout-advanced.json';

function resolveBuiltin(bundledRelPath: string, packageName: string): string {
    // In engine tests, we typically don't have the 'bundled' directory since we're
    // running against the workspace. We'll check it anyway for consistency with CLI.
    const bundledPath = path.join(__dirname, 'bundled', bundledRelPath);
    if (fs.existsSync(bundledPath)) return bundledPath;
    // Dev mode: resolve from workspace package
    return require.resolve(packageName);
}

async function loadImplementation<T>(modulePath: string | undefined, builtinPath: string): Promise<T> {
    const resolvedPath = modulePath ? path.resolve(modulePath) : builtinPath;
    const mod = await import(pathToFileURL(resolvedPath).href);
    const impl = mod.default ?? mod;
    return (impl.LocalFontManager ?? impl) as T;
}

export async function loadLocalFontManager(): Promise<any> {
    const builtinFontManager = resolveBuiltin('font-managers/local.js', '@vmprint/local-fonts');
    return await loadImplementation(undefined, builtinFontManager);
}

type TextTraceCall = { str: string; x: number; y: number };
type ImageTraceCall = { x: number; y: number; width: number; height: number };

export function loadJsonDocumentFixtures(
    casesDir: string = HARNESS_REGRESSION_CASES_DIR,
): Array<{ name: string; document: DocumentIR; filePath: string }> {
    const files = fs
        .readdirSync(casesDir)
        .filter((file) => file.toLowerCase().endsWith('.json') && !file.toLowerCase().endsWith('.snapshot.layout.json'))
        .sort((a, b) => a.localeCompare(b));

    return files.map((name) => ({
        name,
        filePath: path.join(casesDir, name),
        document: resolveDocumentPaths(
            JSON.parse(fs.readFileSync(path.join(casesDir, name), 'utf-8')),
            path.join(casesDir, name),
        ),
    }));
}

export function snapshotPages(pages: Page[]): any {
    // This snapshot shape is intentionally numeric/text-only so deep equality
    // can detect pagination and measurement drift between runs.
    return pages.map((page) => ({
        index: page.index,
        width: page.width,
        height: page.height,
        boxes: page.boxes.map((box) => ({
            type: box.type,
            x: Number(box.x.toFixed(6)),
            y: Number(box.y.toFixed(6)),
            w: Number(box.w.toFixed(6)),
            h: Number(box.h.toFixed(6)),
            lines: (box.lines || []).map((line) =>
                line.map((seg) => ({
                    text: seg.text,
                    width: Number((seg.width || 0).toFixed(6)),
                    ascent: Number((seg.ascent || 0).toFixed(6)),
                    descent: Number((seg.descent || 0).toFixed(6)),
                    fontFamily: seg.fontFamily || '',
                })),
            ),
        })),
    }));
}

function isUnsafeBoundaryChar(ch: string): boolean {
    if (!ch) return false;
    const cp = ch.codePointAt(0) || 0;
    if (cp === 0x200c || cp === 0x200d) return true;
    if (cp >= 0xfe00 && cp <= 0xfe0f) return true;
    if (cp >= 0xe0100 && cp <= 0xe01ef) return true;
    return COMBINING_MARK_REGEX.test(ch);
}

function lineBreakHasUnsafeBoundary(left: string, right: string): boolean {
    if (!left && !right) return false;
    const leftChars = Array.from(left);
    const rightChars = Array.from(right);
    const leftLast = leftChars[leftChars.length - 1] || '';
    const rightFirst = rightChars[0] || '';
    return isUnsafeBoundaryChar(leftLast) || isUnsafeBoundaryChar(rightFirst);
}

function assertFiniteBoxGeometry(pages: Page[], fixtureName: string): void {
    const epsilon = 0.75;
    pages.forEach((page, pageIdx) => {
        page.boxes.forEach((box, boxIdx) => {
            assert.ok(Number.isFinite(box.x), `${fixtureName} page=${pageIdx} box=${boxIdx}: non-finite x`);
            assert.ok(Number.isFinite(box.y), `${fixtureName} page=${pageIdx} box=${boxIdx}: non-finite y`);
            assert.ok(Number.isFinite(box.w), `${fixtureName} page=${pageIdx} box=${boxIdx}: non-finite w`);
            assert.ok(Number.isFinite(box.h), `${fixtureName} page=${pageIdx} box=${boxIdx}: non-finite h`);
            assert.ok(box.w >= 0, `${fixtureName} page=${pageIdx} box=${boxIdx}: negative width`);
            assert.ok(box.h >= 0, `${fixtureName} page=${pageIdx} box=${boxIdx}: negative height`);
            assert.ok(
                box.x >= -epsilon,
                `${fixtureName} page=${pageIdx} box=${boxIdx}: x out of bounds (${box.x.toFixed(3)})`,
            );
            assert.ok(
                box.y >= -epsilon,
                `${fixtureName} page=${pageIdx} box=${boxIdx}: y out of bounds (${box.y.toFixed(3)})`,
            );
            assert.equal(
                (box as any).children,
                undefined,
                `${fixtureName} page=${pageIdx} box=${boxIdx}: nested children found`,
            );
        });
    });
}

function assertBoxMetadata(pages: Page[], fixtureName: string): void {
    pages.forEach((page, pageIdx) => {
        page.boxes.forEach((box, boxIdx) => {
            assert.ok(box.meta, `${fixtureName} page=${pageIdx} box=${boxIdx}: missing box meta`);
            assert.equal(
                typeof box.meta?.sourceId,
                'string',
                `${fixtureName} page=${pageIdx} box=${boxIdx}: missing sourceId`,
            );
            assert.equal(
                typeof box.meta?.engineKey,
                'string',
                `${fixtureName} page=${pageIdx} box=${boxIdx}: missing engineKey`,
            );
            assert.equal(
                typeof box.meta?.sourceType,
                'string',
                `${fixtureName} page=${pageIdx} box=${boxIdx}: missing sourceType`,
            );
            assert.equal(
                typeof box.meta?.fragmentIndex,
                'number',
                `${fixtureName} page=${pageIdx} box=${boxIdx}: missing fragmentIndex`,
            );
            assert.equal(
                typeof box.meta?.isContinuation,
                'boolean',
                `${fixtureName} page=${pageIdx} box=${boxIdx}: missing isContinuation`,
            );
            assert.equal(
                box.meta?.pageIndex,
                pageIdx,
                `${fixtureName} page=${pageIdx} box=${boxIdx}: pageIndex mismatch`,
            );
            assert.ok(
                (box.meta?.sourceId || '').length > 0,
                `${fixtureName} page=${pageIdx} box=${boxIdx}: empty sourceId`,
            );
            assert.ok(
                (box.meta?.engineKey || '').length > 0,
                `${fixtureName} page=${pageIdx} box=${boxIdx}: empty engineKey`,
            );
            assert.ok(
                (box.meta?.fragmentIndex || 0) >= 0,
                `${fixtureName} page=${pageIdx} box=${boxIdx}: negative fragmentIndex`,
            );
        });
    });
}

function assertMeasuredLinesFit(pages: Page[], fixtureName: string): void {
    pages.forEach((page, pageIdx) => {
        page.boxes.forEach((box, boxIdx) => {
            if (!box.lines || box.lines.length === 0) return;
            const style = box.style || {};
            const paddingLeft = LayoutUtils.validateUnit(style.paddingLeft ?? style.padding ?? 0);
            const paddingRight = LayoutUtils.validateUnit(style.paddingRight ?? style.padding ?? 0);
            const borderLeft = LayoutUtils.validateUnit(style.borderLeftWidth ?? style.borderWidth ?? 0);
            const borderRight = LayoutUtils.validateUnit(style.borderRightWidth ?? style.borderWidth ?? 0);
            const contentWidth = box.w - paddingLeft - paddingRight - borderLeft - borderRight;
            const epsilon = 0.75;

            box.lines.forEach((line, lineIdx) => {
                let lineWidth = 0;
                line.forEach((seg, segIdx) => {
                    assert.equal(
                        typeof seg.width,
                        'number',
                        `${fixtureName} page=${pageIdx} box=${boxIdx} line=${lineIdx} seg=${segIdx}: missing width`,
                    );
                    assert.equal(
                        typeof seg.ascent,
                        'number',
                        `${fixtureName} page=${pageIdx} box=${boxIdx} line=${lineIdx} seg=${segIdx}: missing ascent`,
                    );
                    assert.equal(
                        typeof seg.descent,
                        'number',
                        `${fixtureName} page=${pageIdx} box=${boxIdx} line=${lineIdx} seg=${segIdx}: missing descent`,
                    );
                    lineWidth += seg.width || 0;

                    if (segIdx < line.length - 1) {
                        const curr = seg.text || '';
                        const next = line[segIdx + 1]?.text || '';
                        assert.equal(
                            lineBreakHasUnsafeBoundary(curr, next),
                            false,
                            `${fixtureName} page=${pageIdx} box=${boxIdx} line=${lineIdx}: grapheme split across segments`,
                        );
                    }
                });

                assert.ok(
                    lineWidth <= contentWidth + epsilon,
                    `${fixtureName} page=${pageIdx} box=${boxIdx} line=${lineIdx}: width overflow (${lineWidth} > ${contentWidth})`,
                );
            });

            const lineTexts = box.lines.map((line) => line.map((seg) => seg.text || '').join(''));
            for (let i = 0; i < lineTexts.length - 1; i++) {
                assert.equal(
                    lineBreakHasUnsafeBoundary(lineTexts[i], lineTexts[i + 1]),
                    false,
                    `${fixtureName} page=${pageIdx} box=${boxIdx}: grapheme split across wrapped lines`,
                );
            }
        });
    });
}

export function assertFlatPipelineInvariants(pages: Page[], fixtureName: string): void {
    assert.ok(Array.isArray(pages), `${fixtureName}: paginate did not return pages`);
    assert.ok(pages.length > 0, `${fixtureName}: no pages generated`);
    assertFiniteBoxGeometry(pages, fixtureName);
    assertBoxMetadata(pages, fixtureName);
    assertMeasuredLinesFit(pages, fixtureName);
}

function hasRtlChars(text: string): boolean {
    for (const ch of text || '') {
        const cp = ch.codePointAt(0) || 0;
        if ((cp >= 0x0590 && cp <= 0x08ff) || (cp >= 0xfb1d && cp <= 0xfdff) || (cp >= 0xfe70 && cp <= 0xfeff)) {
            return true;
        }
    }
    return false;
}

export function assertAdvancedLayoutSignals(pages: Page[], fixtureName: string): void {
    if (fixtureName !== ADVANCED_LAYOUT_FIXTURE) return;

    const justifyBoxes = pages
        .flatMap((page) => page.boxes)
        .filter(
            (box) =>
                box.style?.justifyEngine === 'advanced' &&
                box.style?.textAlign === 'justify' &&
                Array.isArray(box.lines) &&
                box.lines.length > 1,
        );

    assert.ok(justifyBoxes.length > 0, `${fixtureName}: expected advanced justified boxes`);
    const hasExpandedBoundary = justifyBoxes.some((box) =>
        (box.lines || []).slice(0, -1).some((line) => line.some((seg) => Number((seg as any).justifyAfter || 0) > 0)),
    );
    assert.equal(
        hasExpandedBoundary,
        true,
        `${fixtureName}: expected justifyAfter spacing on non-final justified lines`,
    );

    const softHyphenBoxes = pages
        .flatMap((page) => page.boxes)
        .filter((box) => box.style?.hyphenation === 'soft' && Array.isArray(box.lines) && box.lines.length > 1);

    assert.ok(softHyphenBoxes.length > 0, `${fixtureName}: expected soft-hyphen sample box`);
    const softHasVisibleBreak = softHyphenBoxes.some((box) => {
        const lineTexts = (box.lines || []).map((line) => line.map((seg) => seg.text || '').join(''));
        return lineTexts.slice(0, -1).some((text) => text.endsWith('-'));
    });
    assert.equal(softHasVisibleBreak, true, `${fixtureName}: expected at least one visible soft-hyphen break`);

    const containsLiteralSoftHyphen = softHyphenBoxes.some((box) =>
        (box.lines || []).some((line) => line.some((seg) => (seg.text || '').includes('\u00AD'))),
    );
    assert.equal(
        containsLiteralSoftHyphen,
        false,
        `${fixtureName}: rendered lines should not preserve literal soft-hyphen characters`,
    );
}

export function assertAdvancedRenderSignals(textTrace: TextTraceCall[], fixtureName: string): void {
    if (fixtureName !== ADVANCED_LAYOUT_FIXTURE) return;
    assert.ok(textTrace.length > 0, `${fixtureName}: expected renderer text trace for advanced checks`);
    const rtlTrace = textTrace.filter((call) => hasRtlChars(call.str));
    assert.ok(rtlTrace.length > 0, `${fixtureName}: expected rtl characters in renderer trace`);

    let hasRtlProgression = false;
    for (let i = 1; i < rtlTrace.length; i++) {
        const prev = rtlTrace[i - 1];
        const curr = rtlTrace[i];
        const sameLine = Math.abs(prev.y - curr.y) < 0.01;
        if (!sameLine) continue;
        if (curr.x < prev.x) {
            hasRtlProgression = true;
            break;
        }
    }

    assert.equal(hasRtlProgression, true, `${fixtureName}: expected rtl x progression in renderer trace`);
}

export class MockContext implements Context {
    public pagesAdded = 0;
    public textCalls = 0;
    public imageCalls = 0;
    public textTrace: TextTraceCall[] = [];
    public imageTrace: ImageTraceCall[] = [];

    constructor(
        private readonly _pageWidth: number = 1000,
        private readonly _pageHeight: number = 1000,
    ) {}

    addPage(): void {
        this.pagesAdded += 1;
    }
    end(): void {}
    async registerFont(_id: string, _buffer: Uint8Array): Promise<void> {}
    font(_family: string, _size?: number): this {
        return this;
    }
    fontSize(_size: number): this {
        return this;
    }
    save(): void {}
    restore(): void {}
    translate(_x: number, _y: number): this {
        return this;
    }
    rotate(_angle: number, _originX?: number, _originY?: number): this {
        return this;
    }
    opacity(_opacity: number): this {
        return this;
    }
    fillColor(_color: string): this {
        return this;
    }
    strokeColor(_color: string): this {
        return this;
    }
    lineWidth(_width: number): this {
        return this;
    }
    dash(_length: number, _options?: { space: number }): this {
        return this;
    }
    undash(): this {
        return this;
    }
    moveTo(_x: number, _y: number): this {
        return this;
    }
    lineTo(_x: number, _y: number): this {
        return this;
    }
    bezierCurveTo(_cp1x: number, _cp1y: number, _cp2x: number, _cp2y: number, _x: number, _y: number): this {
        return this;
    }
    rect(_x: number, _y: number, _w: number, _h: number): this {
        return this;
    }
    roundedRect(_x: number, _y: number, _w: number, _h: number, _r: number): this {
        return this;
    }
    fill(_rule?: 'nonzero' | 'evenodd'): this {
        return this;
    }
    stroke(): this {
        return this;
    }
    fillAndStroke(_fillColor?: string, _strokeColor?: string): this {
        return this;
    }
    text(_str: string, _x: number, _y: number, _options?: ContextTextOptions): this {
        this.textCalls += 1;
        this.textTrace.push({ str: _str, x: _x, y: _y });
        return this;
    }
    image(_source: string | Uint8Array, _x: number, _y: number, _options?: ContextImageOptions): this {
        this.imageCalls += 1;
        this.imageTrace.push({
            x: Number(_x),
            y: Number(_y),
            width: Number(_options?.width || 0),
            height: Number(_options?.height || 0),
        });
        return this;
    }
    getSize(): { width: number; height: number } {
        return { width: this._pageWidth, height: this._pageHeight };
    }
}
