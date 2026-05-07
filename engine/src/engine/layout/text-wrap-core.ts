import { ElementStyle, RichLine, TextSegment } from '../types';
import { LAYOUT_DEFAULTS } from './defaults';
import { isNumericRunSegment, segmentTextRun } from './text-segmentation';

export type WrapSegmentToken = {
    kind: 'segment';
    segment: TextSegment;
    font: any;
    fontSize: number;
    locale?: string;
    allowMerge: boolean;
    hyphenationStyle?: ElementStyle | Record<string, any>;
    noLineStart?: boolean;
    noLineEnd?: boolean;
    trackingAfter?: number;
};

export type WrapToken = { kind: 'newline' } | WrapSegmentToken;

// UAX #14 line break classes CL, CP, EX, IS: characters forbidden at line start.
const FORBIDDEN_LINE_START_RE = /^[,\.!?;:%\)\]\}"'\u201D\u2019\u203A\u00BB\u2026\u2014\u2013\u060C\u061B\u061F]+$/;
// UAX #14 line break classes OP/QU: opening punctuation forbidden at line end.
const FORBIDDEN_LINE_END_RE = /^[\(\[\{"'\u201C\u2018\u2039\u00AB]+$/;

function isForbiddenLineStart(text: string): boolean {
    return FORBIDDEN_LINE_START_RE.test(text);
}

function isForbiddenLineEnd(text: string): boolean {
    return FORBIDDEN_LINE_END_RE.test(text);
}

function protectNoLineStartCarryTokens(tokens: WrapToken[]): WrapToken[] {
    for (let index = 1; index < tokens.length; index++) {
        const token = tokens[index]!;
        const previous = tokens[index - 1]!;
        if (
            token.kind === 'segment' &&
            token.noLineStart &&
            previous.kind === 'segment' &&
            isNumericRunSegment(previous.segment.text || '')
        ) {
            previous.allowMerge = false;
        }
    }
    return tokens;
}

type ScriptSegment = { text: string; fontName?: string; fontObject?: any };
type ScriptRun = { text: string; isCJK: boolean };
type BidiDirectionRun = { text: string; direction: 'ltr' | 'rtl' };

const SIMPLE_LATIN_WRAP_RE = /^[\u0009\u0020-\u007E\u00A0-\u00FF\u2010-\u201F\u2026]*$/u;
const RTL_BASE_LTR_TRAILING_NEUTRAL_RE = /^(.+?)([.!?:;]+)$/u;
const ASCII_PUNCTUATION_ATOM_RE = /^[\u0021-\u002F\u003A-\u0040\u005B-\u0060\u007B-\u007E]+$/u;

function tokenizeSimpleLatinSegment(text: string): string[] {
    return text.match(/\s+|[^\s]+/g) ?? [];
}

function isLtrAtomSegment(text: string): boolean {
    return isNumericRunSegment(text) || ASCII_PUNCTUATION_ATOM_RE.test(text);
}

function splitRtlBaseLtrTrailingNeutral(text: string, enabled: boolean): string[] {
    if (!enabled || !text || isNumericRunSegment(text)) return [text];
    const match = text.match(RTL_BASE_LTR_TRAILING_NEUTRAL_RE);
    if (!match || !match[1] || !match[2]) return [text];
    return [match[1], match[2]];
}

function sliceSegmentByOffsets(
    segment: TextSegment,
    startOffset: number,
    endOffset: number,
    text: string,
    fontFamily?: string
): TextSegment {
    const next: TextSegment = {
        ...segment,
        text,
        ...(fontFamily ? { fontFamily } : {})
    };

    if (Number.isFinite(Number(segment.sourceStart))) {
        const absoluteStart = Number(segment.sourceStart) + Math.max(0, startOffset);
        next.sourceStart = absoluteStart;
        next.sourceEnd = absoluteStart + Math.max(0, endOffset - startOffset);
    }

    return next;
}

function assignSequentialSourceRange(
    segment: TextSegment,
    cursor: { value: number },
    sourceText: string
): TextSegment {
    if (!Number.isFinite(Number(segment.sourceStart))) {
        return segment;
    }

    const sourceStart = cursor.value;
    const sourceEnd = sourceStart + sourceText.length;
    cursor.value = sourceEnd;
    return {
        ...segment,
        sourceStart,
        sourceEnd
    };
}

function resolveSegmentLetterSpacing(segment: TextSegment, fallback: number): number {
    const value = Number(segment?.style?.letterSpacing);
    return Number.isFinite(value) ? value : fallback;
}

function hasSegmentLetterSpacing(segment: TextSegment): boolean {
    const value = Number(segment?.style?.letterSpacing);
    return Number.isFinite(value) && value !== 0;
}

function splitToCodePointSegments(text: string): string[] {
    return Array.from(text);
}

export function buildRichWrapTokens(params: {
    flattenedSegments: TextSegment[];
    defaultFontSize: number;
    primaryStyle: ElementStyle;
    advancedJustify: boolean;
    direction: string;
    baseDirection: 'ltr' | 'rtl';
    preserveDirectionalBoundaries: boolean;
    splitByBidiDirection: (text: string, baseDirection: string) => BidiDirectionRun[];
    segmentTextByFont: (text: string, preferredFamily?: string, preferredLocale?: string) => ScriptSegment[];
    splitByScriptType: (text: string) => ScriptRun[];
    getScriptClass: (text: string) => string;
    getOpticalScale: (scriptClass: string) => number;
    getSegmenterLocale: (style?: ElementStyle | Record<string, any>) => string | undefined;
    makeWordSegmenter: (locale: string | undefined, isCJK: boolean) => any;
    transformSegment: (segment: TextSegment, fontFamily?: string) => TextSegment;
    hasRtlScript: (text: string) => boolean;
    isAdvancedJustifyEnabled: (style?: ElementStyle | Record<string, any>) => boolean;
    resolveRichFontInfo: (seg: TextSegment, defaultFontSize: number) => { font: any; fontSize: number };
    isolateBidiRunBoundaries?: boolean;
    onBidiSplit?: (durationMs: number) => void;
    onScriptSplit?: (durationMs: number) => void;
    onWordSegment?: (durationMs: number) => void;
}): WrapToken[] {
    const tokens: WrapToken[] = [];

    for (const seg of params.flattenedSegments) {
        if (seg.text === '\n') {
            tokens.push({ kind: 'newline' });
            continue;
        }
        if (seg.inlineObject) {
            const inlineSeg = params.transformSegment({ ...seg }, seg.fontFamily);
            const resolved = params.resolveRichFontInfo(inlineSeg, params.defaultFontSize);
            tokens.push({
                kind: 'segment',
                segment: inlineSeg,
                font: resolved.font,
                fontSize: resolved.fontSize,
                locale: params.getSegmenterLocale((inlineSeg.style || params.primaryStyle) as ElementStyle),
                allowMerge: false,
                hyphenationStyle: (inlineSeg.style || params.primaryStyle) as ElementStyle
            });
            continue;
        }

        const locale = params.getSegmenterLocale((seg.style || params.primaryStyle) as ElementStyle);
        const canUseSimpleLatinPath =
            !params.advancedJustify &&
            !params.preserveDirectionalBoundaries &&
            params.baseDirection === 'ltr' &&
            SIMPLE_LATIN_WRAP_RE.test(seg.text);

        if (canUseSimpleLatinPath) {
            const segmentHasLetterSpacing = hasSegmentLetterSpacing(seg);
            const simpleSubSegments = segmentHasLetterSpacing
                ? splitToCodePointSegments(seg.text)
                : tokenizeSimpleLatinSegment(seg.text);
            if (simpleSubSegments.length > 0) {
                let simpleOffset = 0;
                for (let segmentIndex = 0; segmentIndex < simpleSubSegments.length; segmentIndex++) {
                    const segment = simpleSubSegments[segmentIndex] || '';
                    const startOffset = simpleOffset;
                    const endOffset = startOffset + segment.length;
                    const richSubSeg = params.transformSegment(
                        sliceSegmentByOffsets(seg, startOffset, endOffset, segment, seg.fontFamily),
                        seg.fontFamily
                    );
                    simpleOffset = endOffset;
                    const resolved = params.resolveRichFontInfo(richSubSeg, params.defaultFontSize);
                    const noLineEnd = isForbiddenLineEnd(richSubSeg.text || '');
                    tokens.push({
                        kind: 'segment',
                        segment: richSubSeg,
                        font: resolved.font,
                        fontSize: resolved.fontSize,
                        locale,
                        allowMerge: !segmentHasLetterSpacing && !noLineEnd,
                        hyphenationStyle: (richSubSeg.style || seg.style || params.primaryStyle) as ElementStyle,
                        noLineStart: isForbiddenLineStart(richSubSeg.text || ''),
                        noLineEnd,
                        trackingAfter: segmentHasLetterSpacing && segmentIndex < simpleSubSegments.length - 1
                            ? resolveSegmentLetterSpacing(richSubSeg, 0)
                            : 0
                    });
                }
                continue;
            }
        }

        const scriptSegments = params.segmentTextByFont(seg.text, seg.fontFamily, locale);
        let scriptOffset = 0;
        for (const scriptSeg of scriptSegments) {
            const scriptStartOffset = scriptOffset;
            const scriptEndOffset = scriptStartOffset + scriptSeg.text.length;
            const scriptBaseSeg = sliceSegmentByOffsets(
                seg,
                scriptStartOffset,
                scriptEndOffset,
                scriptSeg.text,
                scriptSeg.fontName || seg.fontFamily
            );
            scriptOffset = scriptEndOffset;
            const bidiT0 = params.onBidiSplit ? performance.now() : 0;
            const bidiRuns = params.splitByBidiDirection(scriptSeg.text, params.baseDirection);
            if (params.onBidiSplit) params.onBidiSplit(performance.now() - bidiT0);
            let bidiOffset = 0;
            for (const bidiRun of bidiRuns) {
                const bidiStartOffset = bidiOffset;
                const bidiEndOffset = bidiStartOffset + bidiRun.text.length;
                const bidiBaseSeg = sliceSegmentByOffsets(
                    scriptBaseSeg,
                    bidiStartOffset,
                    bidiEndOffset,
                    bidiRun.text,
                    scriptBaseSeg.fontFamily
                );
                bidiOffset = bidiEndOffset;
                const scriptT0 = params.onScriptSplit ? performance.now() : 0;
                const scriptRuns = params.splitByScriptType(bidiRun.text);
                if (params.onScriptSplit) params.onScriptSplit(performance.now() - scriptT0);

                let runOffset = 0;
                for (const run of scriptRuns) {
                    const runStartOffset = runOffset;
                    const runEndOffset = runStartOffset + run.text.length;
                    const runBaseSeg = sliceSegmentByOffsets(
                        bidiBaseSeg,
                        runStartOffset,
                        runEndOffset,
                        run.text,
                        bidiBaseSeg.fontFamily
                    );
                    runOffset = runEndOffset;
                    const segmenter = params.makeWordSegmenter(locale, run.isCJK);
                    const wordT0 = params.onWordSegment ? performance.now() : 0;
                    const subSegments = segmentTextRun(run.text, segmenter);
                    if (params.onWordSegment) params.onWordSegment(performance.now() - wordT0);

                    let subOffset = 0;
                    for (const segment of subSegments) {
                        const subStartOffset = subOffset;
                        const subEndOffset = subStartOffset + segment.length;
                        const rawSubSegHasLetterSpacing = hasSegmentLetterSpacing(runBaseSeg);
                        const measuredSegments = rawSubSegHasLetterSpacing
                            ? splitToCodePointSegments(segment)
                            : splitRtlBaseLtrTrailingNeutral(
                                segment,
                                !!params.isolateBidiRunBoundaries
                                    && params.baseDirection === 'rtl'
                                    && bidiRun.direction === 'ltr'
                            );
                        let measuredSegmentOffset = 0;
                        for (let measuredIndex = 0; measuredIndex < measuredSegments.length; measuredIndex++) {
                            const measuredSegment = measuredSegments[measuredIndex] || '';
                            const measuredStartOffset = subStartOffset + measuredSegmentOffset;
                            const measuredEndOffset = measuredStartOffset + measuredSegment.length;
                            measuredSegmentOffset += measuredSegment.length;
                            const rawSubSeg = sliceSegmentByOffsets(
                                runBaseSeg,
                                measuredStartOffset,
                                measuredEndOffset,
                                measuredSegment,
                                scriptSeg.fontName || seg.fontFamily
                            );

                            const richSubSeg = params.transformSegment(rawSubSeg, rawSubSeg.fontFamily);
                            const textValue = richSubSeg.text || '';
                            const numericAtom = isNumericRunSegment(textValue);
                            let preserveBidiTokenBoundary = false;
                            if (textValue.trim().length > 0) {
                                const scriptClass = params.getScriptClass(textValue);
                                richSubSeg.scriptClass = scriptClass;
                                richSubSeg.direction = (numericAtom || isLtrAtomSegment(textValue)) ? 'ltr' : bidiRun.direction;
                                preserveBidiTokenBoundary = !!params.isolateBidiRunBoundaries && (
                                    scriptClass !== 'latin' ||
                                    bidiRun.direction !== params.baseDirection ||
                                    params.hasRtlScript(textValue)
                                );

                                const optScale = params.getOpticalScale(scriptClass);
                                if (optScale !== 1.0) {
                                    const currentStyle = richSubSeg.style || {};
                                    const baseSize = Number(currentStyle.fontSize || params.defaultFontSize);
                                    const scaledSize = baseSize * optScale;
                                    if (scaledSize !== baseSize) {
                                        richSubSeg.style = {
                                            ...currentStyle,
                                            fontSize: scaledSize
                                        };
                                    }
                                }
                            } else {
                                // Inherit BIDI run direction for spaces/empty tokens
                                richSubSeg.direction = bidiRun.direction;
                            }
                            const preserveBoundaries =
                                params.advancedJustify ||
                                params.preserveDirectionalBoundaries ||
                                preserveBidiTokenBoundary ||
                                (params.direction === 'auto' && params.hasRtlScript(richSubSeg.text || '')) ||
                                ((richSubSeg.style as any)?.textAlign === 'justify' && params.isAdvancedJustifyEnabled(richSubSeg.style as any));
                            const noLineEnd = isForbiddenLineEnd(richSubSeg.text || '');

                            const resolved = params.resolveRichFontInfo(richSubSeg, params.defaultFontSize);
                            tokens.push({
                                kind: 'segment',
                                segment: richSubSeg,
                                font: resolved.font,
                                fontSize: resolved.fontSize,
                                locale,
                                allowMerge: !preserveBoundaries && !rawSubSegHasLetterSpacing && !noLineEnd,
                                hyphenationStyle: (richSubSeg.style || seg.style || params.primaryStyle) as ElementStyle,
                                noLineStart: isForbiddenLineStart(richSubSeg.text || ''),
                                noLineEnd,
                                trackingAfter: rawSubSegHasLetterSpacing && measuredIndex < measuredSegments.length - 1
                                    ? resolveSegmentLetterSpacing(richSubSeg, 0)
                                    : 0
                            });
                        }
                        subOffset = subEndOffset;
                    }
                }
            }
        }
    }

    return protectNoLineStartCarryTokens(tokens);
}

export function wrapTokenStream(params: {
    tokens: WrapToken[];
    maxWidth: number;
    textIndent: number;
    letterSpacing: number;
    fallbackFont: any;
    hyphenate: boolean;
    createEmptyMeasuredSegment: (font: any) => TextSegment;
    measureText: (text: string, font: any, fontSize: number, letterSpacing: number, populateSegment: TextSegment) => number;
    appendSegmentToLine: (line: TextSegment[], segment: TextSegment, segmentWidth: number, allowMerge: boolean) => TextSegment[];
    getLineWidthLimit: (totalWidth: number, lineIndex: number, firstLineIndent: number) => number;
    tryHyphenateSegmentToFit: (
        seg: TextSegment,
        font: any,
        fontSize: number,
        letterSpacing: number,
        availableWidth: number,
        style?: ElementStyle | Record<string, any>
    ) => { head: TextSegment; headWidth: number; tail: TextSegment; tailWidth: number } | null;
    splitToGraphemes: (text: string, locale?: string) => string[];
    transformSegment: (segment: TextSegment, fontFamily?: string) => TextSegment;
    resolveRichFontInfo: (seg: TextSegment, defaultFontSize: number) => { font: any; fontSize: number };
    shouldStopAfterLine?: (nextLineIndex: number) => boolean;
    onOverflowToken?: (durationMs: number) => void;
    onHyphenationAttempt?: (durationMs: number, succeeded: boolean) => void;
    onGraphemeFallback?: (durationMs: number, graphemeCount: number) => void;
}): RichLine[] {
    const fitsWidth = (lineWidth: number, segWidth: number, limit: number) =>
        (lineWidth + segWidth) <= (limit + LAYOUT_DEFAULTS.wrapTolerance);

    const finalLines: RichLine[] = [];
    let currentLine: TextSegment[] = [];
    let currentLineWidth = 0;
    const lineEndForbiddenSegments = new WeakSet<TextSegment>();
    // Cache the current line's width limit; recomputed only when a line is pushed.
    let cachedLineWidthLimit = params.getLineWidthLimit(params.maxWidth, 0, params.textIndent);
    let stopRequested = false;
    const markCurrentLineForcedBreak = () => {
        if (currentLine.length === 0) return;
        const lastIdx = currentLine.length - 1;
        currentLine[lastIdx] = {
            ...currentLine[lastIdx],
            forcedBreakAfter: true
        };
    };
    const getCurrentLineWidthLimit = (): number => cachedLineWidthLimit;
    const pushCurrentLine = () => {
        finalLines.push(currentLine.length > 0 ? currentLine : [params.createEmptyMeasuredSegment(params.fallbackFont)]);
        currentLine = [];
        currentLineWidth = 0;
        const nextLineIndex = finalLines.length;
        if (params.shouldStopAfterLine?.(nextLineIndex)) {
            stopRequested = true;
            return;
        }
        cachedLineWidthLimit = params.getLineWidthLimit(params.maxWidth, finalLines.length, params.textIndent);
    };
    const pushSegmentToLine = (segment: TextSegment, segmentWidth: number, allowMerge: boolean, noLineEnd = false) => {
        currentLine = params.appendSegmentToLine(currentLine, segment, segmentWidth, allowMerge);
        if (noLineEnd && currentLine.length > 0) {
            lineEndForbiddenSegments.add(currentLine[currentLine.length - 1]!);
        }
        currentLineWidth += segmentWidth;
    };
    const moveTrailingLineEndForbiddenToNextLine = (
        segment: TextSegment,
        segmentWidth: number,
        allowMerge: boolean,
        noLineEnd = false
    ): boolean => {
        if (currentLine.length <= 1) return false;
        const last = currentLine[currentLine.length - 1]!;
        if (!lineEndForbiddenSegments.has(last)) return false;

        const originalLine = currentLine.slice();
        const originalLineWidth = currentLineWidth;
        const carryWidth = Number(last.width || 0);
        const nextLineLimit = params.getLineWidthLimit(params.maxWidth, finalLines.length + 1, params.textIndent);
        if (!fitsWidth(carryWidth, segmentWidth, nextLineLimit)) {
            return false;
        }

        currentLine = currentLine.slice(0, -1);
        currentLineWidth -= carryWidth;
        if (currentLine.length === 0) {
            currentLine = originalLine;
            currentLineWidth = originalLineWidth;
            return false;
        }

        pushCurrentLine();
        if (stopRequested) return true;
        currentLine = [last];
        currentLineWidth = carryWidth;
        pushSegmentToLine(segment, segmentWidth, allowMerge, noLineEnd);
        return true;
    };
    const movePreviousClusterToNextLine = (
        segment: TextSegment,
        segmentWidth: number,
        allowMerge: boolean
    ): boolean => {
        if (currentLine.length === 0) return false;

        const originalLine = currentLine.slice();
        const originalLineWidth = currentLineWidth;
        const carry: TextSegment[] = [];
        let carryWidth = 0;

        while (currentLine.length > 0) {
            const previous = currentLine.pop()!;
            const previousWidth = Number(previous.width || 0);
            currentLineWidth -= previousWidth;
            if ((previous.text || '').trim().length === 0) {
                continue;
            }
            carry.unshift(previous);
            carryWidth += previousWidth;
            break;
        }

        if (carry.length === 0 || currentLine.length === 0) {
            currentLine = originalLine;
            currentLineWidth = originalLineWidth;
            return false;
        }

        const nextLineLimit = params.getLineWidthLimit(params.maxWidth, finalLines.length + 1, params.textIndent);
        if (!fitsWidth(carryWidth, segmentWidth, nextLineLimit)) {
            currentLine = originalLine;
            currentLineWidth = originalLineWidth;
            return false;
        }

        pushCurrentLine();
        if (stopRequested) return true;
        currentLine = carry;
        currentLineWidth = carryWidth;
        pushSegmentToLine(segment, segmentWidth, allowMerge);
        return true;
    };

    for (const token of params.tokens) {
        if (stopRequested) break;

        if (token.kind === 'newline') {
            markCurrentLineForcedBreak();
            pushCurrentLine();
            if (stopRequested) break;
            continue;
        }

        const segmentLetterSpacing = resolveSegmentLetterSpacing(token.segment, params.letterSpacing);
        const measuredSegmentWidth = params.measureText(token.segment.text, token.font, token.fontSize, segmentLetterSpacing, token.segment);
        const segmentWidth = measuredSegmentWidth + (Number.isFinite(Number(token.trackingAfter)) ? Number(token.trackingAfter) : 0);
        if (token.trackingAfter) {
            token.segment.width = segmentWidth;
        }
        const lineWidthLimit = getCurrentLineWidthLimit();

        if (fitsWidth(currentLineWidth, segmentWidth, lineWidthLimit)) {
            pushSegmentToLine(token.segment, segmentWidth, token.allowMerge, token.noLineEnd);
            continue;
        }

        const overflowT0 = params.onOverflowToken ? performance.now() : 0;
        if (params.hyphenate) {
            const remainingWidth = lineWidthLimit - currentLineWidth;
            const hyphenT0 = params.onHyphenationAttempt ? performance.now() : 0;
            const hyphenated = params.tryHyphenateSegmentToFit(
                token.segment,
                token.font,
                token.fontSize,
                segmentLetterSpacing,
                remainingWidth,
                token.hyphenationStyle
            );
            if (params.onHyphenationAttempt) params.onHyphenationAttempt(performance.now() - hyphenT0, !!hyphenated);

            if (hyphenated) {
                pushSegmentToLine(hyphenated.head, hyphenated.headWidth, false);
                if (currentLine.length > 0) {
                    pushCurrentLine();
                    if (stopRequested) break;
                }

                if (fitsWidth(0, hyphenated.tailWidth, getCurrentLineWidthLimit())) {
                    currentLine = [hyphenated.tail];
                    currentLineWidth = hyphenated.tailWidth;
                } else {
                    const graphemeT0 = params.onGraphemeFallback ? performance.now() : 0;
                    const graphemes = params.splitToGraphemes(hyphenated.tail.text, token.locale);
                    const graphemeCursor = {
                        value: Number.isFinite(Number(hyphenated.tail.sourceStart))
                            ? Number(hyphenated.tail.sourceStart)
                            : 0
                    };
                    for (const grapheme of graphemes) {
                        const graphemeSegment = params.transformSegment(
                            assignSequentialSourceRange(
                                { ...hyphenated.tail, text: grapheme },
                                graphemeCursor,
                                grapheme
                            ),
                            hyphenated.tail.fontFamily
                        );
                        const graphemeFont = params.resolveRichFontInfo(graphemeSegment, token.fontSize);
                        const graphemeLetterSpacing = resolveSegmentLetterSpacing(graphemeSegment, segmentLetterSpacing);
                        const graphemeWidth = params.measureText(
                            graphemeSegment.text,
                            graphemeFont.font,
                            graphemeFont.fontSize,
                            graphemeLetterSpacing,
                            graphemeSegment
                        );

                        if (!fitsWidth(currentLineWidth, graphemeWidth, getCurrentLineWidthLimit())) {
                            if (currentLine.length > 0) {
                                pushCurrentLine();
                                if (stopRequested) break;
                            }
                        }
                        pushSegmentToLine(graphemeSegment, graphemeWidth, false);
                    }
                    if (params.onGraphemeFallback) params.onGraphemeFallback(performance.now() - graphemeT0, graphemes.length);
                }
                if (params.onOverflowToken) params.onOverflowToken(performance.now() - overflowT0);
                continue;
            }
        }

        if (currentLine.length > 0) {
            if (moveTrailingLineEndForbiddenToNextLine(token.segment, segmentWidth, token.allowMerge, token.noLineEnd)) {
                if (stopRequested) break;
                continue;
            }
            if (token.noLineEnd) {
                pushCurrentLine();
                if (stopRequested) break;
                currentLine = [token.segment];
                currentLineWidth = segmentWidth;
                lineEndForbiddenSegments.add(currentLine[0]!);
                continue;
            }
            if (token.noLineStart) {
                if (movePreviousClusterToNextLine(token.segment, segmentWidth, token.allowMerge)) {
                    if (stopRequested) break;
                    continue;
                }
                // Fallback: append closing punctuation onto the current line rather
                // than letting it widow at the start of the next line. This can
                // still overfill only when the carried cluster itself cannot fit.
                pushSegmentToLine(token.segment, segmentWidth, token.allowMerge, token.noLineEnd);
                pushCurrentLine();
                if (stopRequested) break;
                continue;
            }
            pushCurrentLine();
            if (stopRequested) break;
        }

        if (token.segment.text.trim() === '' && token.segment.text !== '\n') {
            currentLine = [];
            currentLineWidth = 0;
            continue;
        }

        if (segmentWidth > getCurrentLineWidthLimit()) {
            const graphemeT0 = params.onGraphemeFallback ? performance.now() : 0;
            const graphemes = params.splitToGraphemes(token.segment.text, token.locale);
            const graphemeCursor = {
                value: Number.isFinite(Number(token.segment.sourceStart))
                    ? Number(token.segment.sourceStart)
                    : 0
            };
            for (const grapheme of graphemes) {
                const graphemeSegment = params.transformSegment(
                    assignSequentialSourceRange(
                        { ...token.segment, text: grapheme },
                        graphemeCursor,
                        grapheme
                    ),
                    token.segment.fontFamily
                );
                const graphemeFont = params.resolveRichFontInfo(graphemeSegment, token.fontSize);
                const graphemeLetterSpacing = resolveSegmentLetterSpacing(graphemeSegment, segmentLetterSpacing);
                const graphemeWidth = params.measureText(
                    graphemeSegment.text,
                    graphemeFont.font,
                    graphemeFont.fontSize,
                    graphemeLetterSpacing,
                    graphemeSegment
                );

                if (!fitsWidth(currentLineWidth, graphemeWidth, getCurrentLineWidthLimit())) {
                    if (currentLine.length > 0) {
                        pushCurrentLine();
                        if (stopRequested) break;
                    }
                }
                pushSegmentToLine(graphemeSegment, graphemeWidth, token.allowMerge);
            }
            if (params.onGraphemeFallback) params.onGraphemeFallback(performance.now() - graphemeT0, graphemes.length);
        } else {
            currentLine = [token.segment];
            currentLineWidth = segmentWidth;
        }
        if (params.onOverflowToken) params.onOverflowToken(performance.now() - overflowT0);
    }

    if (!stopRequested && currentLine.length > 0) pushCurrentLine();
    return finalLines.length > 0 ? finalLines : [[params.createEmptyMeasuredSegment(params.fallbackFont)]];
}
