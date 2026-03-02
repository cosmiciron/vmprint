import { ElementStyle, RichLine, TextSegment } from '../types';
import { LAYOUT_DEFAULTS } from './defaults';

export type WrapSegmentToken = {
    kind: 'segment';
    segment: TextSegment;
    font: any;
    fontSize: number;
    locale?: string;
    allowMerge: boolean;
    hyphenationStyle?: ElementStyle | Record<string, any>;
};

export type WrapToken = { kind: 'newline' } | WrapSegmentToken;

type ScriptSegment = { text: string; fontName?: string; fontObject?: any };
type ScriptRun = { text: string; isCJK: boolean };

export function buildRichWrapTokens(params: {
    flattenedSegments: TextSegment[];
    defaultFontSize: number;
    primaryStyle: ElementStyle;
    advancedJustify: boolean;
    direction: string;
    preserveDirectionalBoundaries: boolean;
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
                hyphenationStyle: (inlineSeg.style || params.primaryStyle) as ElementStyle,
            });
            continue;
        }

        const locale = params.getSegmenterLocale((seg.style || params.primaryStyle) as ElementStyle);
        const scriptSegments = params.segmentTextByFont(seg.text, seg.fontFamily, locale);
        for (const scriptSeg of scriptSegments) {
            const scriptRuns = params.splitByScriptType(scriptSeg.text);

            for (const run of scriptRuns) {
                const segmenter = params.makeWordSegmenter(locale, run.isCJK);
                const subSegments = segmenter.segment(run.text);

                for (const { segment } of subSegments) {
                    const rawSubSeg = {
                        ...seg,
                        text: segment,
                        fontFamily: scriptSeg.fontName || seg.fontFamily,
                    };

                    const richSubSeg = params.transformSegment(rawSubSeg, rawSubSeg.fontFamily);
                    const textValue = richSubSeg.text || '';
                    if (textValue.trim().length > 0) {
                        const scriptClass = params.getScriptClass(textValue);
                        const optScale = params.getOpticalScale(scriptClass);
                        if (optScale !== 1.0) {
                            const currentStyle = richSubSeg.style || {};
                            const baseSize = Number(currentStyle.fontSize || params.defaultFontSize);
                            const scaledSize = baseSize * optScale;
                            if (scaledSize !== baseSize) {
                                richSubSeg.style = {
                                    ...currentStyle,
                                    fontSize: scaledSize,
                                };
                            }
                        }
                    }
                    const preserveBoundaries =
                        params.advancedJustify ||
                        params.preserveDirectionalBoundaries ||
                        (params.direction === 'auto' && params.hasRtlScript(richSubSeg.text || '')) ||
                        ((richSubSeg.style as any)?.textAlign === 'justify' &&
                            params.isAdvancedJustifyEnabled(richSubSeg.style as any));

                    const resolved = params.resolveRichFontInfo(richSubSeg, params.defaultFontSize);
                    tokens.push({
                        kind: 'segment',
                        segment: richSubSeg,
                        font: resolved.font,
                        fontSize: resolved.fontSize,
                        locale,
                        allowMerge: !preserveBoundaries,
                        hyphenationStyle: (richSubSeg.style || seg.style || params.primaryStyle) as ElementStyle,
                    });
                }
            }
        }
    }

    return tokens;
}

export function wrapTokenStream(params: {
    tokens: WrapToken[];
    maxWidth: number;
    textIndent: number;
    letterSpacing: number;
    fallbackFont: any;
    hyphenate: boolean;
    createEmptyMeasuredSegment: (font: any) => TextSegment;
    measureText: (
        text: string,
        font: any,
        fontSize: number,
        letterSpacing: number,
        populateSegment: TextSegment,
    ) => number;
    appendSegmentToLine: (
        line: TextSegment[],
        segment: TextSegment,
        segmentWidth: number,
        allowMerge: boolean,
    ) => TextSegment[];
    getLineWidthLimit: (totalWidth: number, lineIndex: number, firstLineIndent: number) => number;
    tryHyphenateSegmentToFit: (
        seg: TextSegment,
        font: any,
        fontSize: number,
        letterSpacing: number,
        availableWidth: number,
        style?: ElementStyle | Record<string, any>,
    ) => { head: TextSegment; headWidth: number; tail: TextSegment; tailWidth: number } | null;
    splitToGraphemes: (text: string, locale?: string) => string[];
    transformSegment: (segment: TextSegment, fontFamily?: string) => TextSegment;
    resolveRichFontInfo: (seg: TextSegment, defaultFontSize: number) => { font: any; fontSize: number };
}): RichLine[] {
    const fitsWidth = (lineWidth: number, segWidth: number, limit: number) =>
        lineWidth + segWidth <= limit + LAYOUT_DEFAULTS.wrapTolerance;

    const finalLines: RichLine[] = [];
    let currentLine: TextSegment[] = [];
    let currentLineWidth = 0;
    // Cache the current line's width limit; recomputed only when a line is pushed.
    let cachedLineWidthLimit = params.getLineWidthLimit(params.maxWidth, 0, params.textIndent);
    const markCurrentLineForcedBreak = () => {
        if (currentLine.length === 0) return;
        const lastIdx = currentLine.length - 1;
        currentLine[lastIdx] = {
            ...currentLine[lastIdx],
            forcedBreakAfter: true,
        };
    };
    const getCurrentLineWidthLimit = (): number => cachedLineWidthLimit;
    const pushCurrentLine = () => {
        finalLines.push(
            currentLine.length > 0 ? currentLine : [params.createEmptyMeasuredSegment(params.fallbackFont)],
        );
        currentLine = [];
        currentLineWidth = 0;
        cachedLineWidthLimit = params.getLineWidthLimit(params.maxWidth, finalLines.length, params.textIndent);
    };
    const pushSegmentToLine = (segment: TextSegment, segmentWidth: number, allowMerge: boolean) => {
        currentLine = params.appendSegmentToLine(currentLine, segment, segmentWidth, allowMerge);
        currentLineWidth += segmentWidth;
    };

    for (const token of params.tokens) {
        if (token.kind === 'newline') {
            markCurrentLineForcedBreak();
            pushCurrentLine();
            continue;
        }

        const segmentWidth = params.measureText(
            token.segment.text,
            token.font,
            token.fontSize,
            params.letterSpacing,
            token.segment,
        );
        const lineWidthLimit = getCurrentLineWidthLimit();

        if (fitsWidth(currentLineWidth, segmentWidth, lineWidthLimit)) {
            pushSegmentToLine(token.segment, segmentWidth, token.allowMerge);
            continue;
        }

        if (params.hyphenate) {
            const remainingWidth = lineWidthLimit - currentLineWidth;
            const hyphenated = params.tryHyphenateSegmentToFit(
                token.segment,
                token.font,
                token.fontSize,
                params.letterSpacing,
                remainingWidth,
                token.hyphenationStyle,
            );

            if (hyphenated) {
                pushSegmentToLine(hyphenated.head, hyphenated.headWidth, false);
                if (currentLine.length > 0) {
                    pushCurrentLine();
                }

                if (fitsWidth(0, hyphenated.tailWidth, getCurrentLineWidthLimit())) {
                    currentLine = [hyphenated.tail];
                    currentLineWidth = hyphenated.tailWidth;
                } else {
                    for (const grapheme of params.splitToGraphemes(hyphenated.tail.text, token.locale)) {
                        const graphemeSegment = params.transformSegment(
                            { ...hyphenated.tail, text: grapheme },
                            hyphenated.tail.fontFamily,
                        );
                        const graphemeFont = params.resolveRichFontInfo(graphemeSegment, token.fontSize);
                        const graphemeWidth = params.measureText(
                            graphemeSegment.text,
                            graphemeFont.font,
                            graphemeFont.fontSize,
                            params.letterSpacing,
                            graphemeSegment,
                        );

                        if (!fitsWidth(currentLineWidth, graphemeWidth, getCurrentLineWidthLimit())) {
                            if (currentLine.length > 0) pushCurrentLine();
                        }
                        pushSegmentToLine(graphemeSegment, graphemeWidth, false);
                    }
                }
                continue;
            }
        }

        if (currentLine.length > 0) {
            pushCurrentLine();
        }

        if (token.segment.text.trim() === '' && token.segment.text !== '\n') {
            currentLine = [];
            currentLineWidth = 0;
            continue;
        }

        if (segmentWidth > getCurrentLineWidthLimit()) {
            for (const grapheme of params.splitToGraphemes(token.segment.text, token.locale)) {
                const graphemeSegment = params.transformSegment(
                    { ...token.segment, text: grapheme },
                    token.segment.fontFamily,
                );
                const graphemeFont = params.resolveRichFontInfo(graphemeSegment, token.fontSize);
                const graphemeWidth = params.measureText(
                    graphemeSegment.text,
                    graphemeFont.font,
                    graphemeFont.fontSize,
                    params.letterSpacing,
                    graphemeSegment,
                );

                if (!fitsWidth(currentLineWidth, graphemeWidth, getCurrentLineWidthLimit())) {
                    if (currentLine.length > 0) pushCurrentLine();
                }
                pushSegmentToLine(graphemeSegment, graphemeWidth, token.allowMerge);
            }
        } else {
            currentLine = [token.segment];
            currentLineWidth = segmentWidth;
        }
    }

    if (currentLine.length > 0) finalLines.push(currentLine);
    return finalLines.length > 0 ? finalLines : [[params.createEmptyMeasuredSegment(params.fallbackFont)]];
}
