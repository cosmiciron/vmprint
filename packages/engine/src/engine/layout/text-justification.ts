import { ElementStyle, RichLine } from '../types';
import { LAYOUT_DEFAULTS } from './defaults';

function isPunctuationOnly(text: string): boolean {
    if (!text) return true;
    return /^[\s.,;:!?ï¼Œã€‚ï¼›ï¼šï¼ï¼Ÿã€ï¼ˆï¼‰()ã€Šã€‹ã€ã€‘'"â€œâ€â€˜â€™â€¦\-]+$/u.test(text);
}

function lineHasAnyWhitespace(line: RichLine): boolean {
    return line.some((seg) => /\s/u.test(seg.text || ''));
}

function lineEndsWithForcedBreak(line: RichLine): boolean {
    if (!Array.isArray(line) || line.length === 0) return false;
    return !!line[line.length - 1]?.forcedBreakAfter;
}

function shouldStretchBoundary(
    left: string,
    right: string,
    lineHasWhitespaceFlag: boolean,
    strategy: string,
    isCjkOrThaiCluster: (text: string) => boolean,
): boolean {
    if (!left || !right) return false;
    if (/\s$/u.test(left) || /^\s/u.test(right)) return true;
    if (strategy === 'space') return false;

    if (isPunctuationOnly(left) || isPunctuationOnly(right)) return false;
    if (strategy === 'inter-character') {
        return isCjkOrThaiCluster(left) || isCjkOrThaiCluster(right);
    }

    if (lineHasWhitespaceFlag) return false;
    return isCjkOrThaiCluster(left) || isCjkOrThaiCluster(right);
}

export function applyAdvancedJustification(params: {
    lines: RichLine[];
    maxWidth: number;
    textIndent: number;
    baseStyle?: ElementStyle | Record<string, any>;
    layoutJustifyStrategy?: string;
    resolveLineWidth?: (lineIndex: number, fallbackWidth: number) => number;
    isCjkOrThaiCluster: (text: string) => boolean;
}): RichLine[] {
    const lines = params.lines;
    if (!Array.isArray(lines) || lines.length === 0) return lines;
    const strategy = String(
        params.baseStyle?.justifyStrategy || params.layoutJustifyStrategy || LAYOUT_DEFAULTS.textLayout.justifyStrategy,
    );

    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
        const line = lines[lineIdx];
        line.forEach((seg) => {
            seg.justifyAfter = 0;
        });

        const isLastLine = lineIdx === lines.length - 1;
        if (isLastLine) continue;
        if (lineEndsWithForcedBreak(line)) continue;

        const resolvedWidth = params.resolveLineWidth
            ? params.resolveLineWidth(lineIdx, params.maxWidth)
            : params.maxWidth;
        const available = resolvedWidth - (lineIdx === 0 ? params.textIndent : 0);
        const lineWidth = line.reduce((acc, seg) => acc + (seg.width || 0), 0);
        const extra = available - lineWidth;
        if (extra <= LAYOUT_DEFAULTS.wrapTolerance) continue;

        const hasWhitespace = lineHasAnyWhitespace(line);
        const boundaries: number[] = [];
        for (let i = 0; i < line.length - 1; i++) {
            if ((line[i] as any).inlineObject || (line[i + 1] as any).inlineObject) continue;
            const left = line[i]?.text || '';
            const right = line[i + 1]?.text || '';
            if (shouldStretchBoundary(left, right, hasWhitespace, strategy, params.isCjkOrThaiCluster)) {
                boundaries.push(i);
            }
        }

        if (boundaries.length === 0) continue;
        const perBoundary = extra / boundaries.length;
        for (const idx of boundaries) {
            const seg = line[idx];
            seg.justifyAfter = (seg.justifyAfter || 0) + perBoundary;
        }
    }

    return lines;
}
