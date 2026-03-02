import { TextSegment } from '../types';

const graphemeSegmenterCache = new Map<string, any>();

export class StyleSignatureCache {
    private cache = new WeakMap<object, string>();

    private serializeStyleValue(value: any): string {
        if (value === null) return 'null';
        if (value === undefined) return 'undefined';

        const valueType = typeof value;
        if (valueType === 'number' || valueType === 'boolean' || valueType === 'bigint') return String(value);
        if (valueType === 'string') return JSON.stringify(value);
        if (valueType !== 'object') return JSON.stringify(String(value));

        if (Array.isArray(value)) {
            return `[${value.map((item) => this.serializeStyleValue(item)).join(',')}]`;
        }

        const record = value as Record<string, any>;
        const keys = Object.keys(record).sort();
        return `{${keys.map((key) => `${JSON.stringify(key)}:${this.serializeStyleValue(record[key])}`).join(',')}}`;
    }

    getStyleSignature(style?: Record<string, any>): string {
        if (!style || typeof style !== 'object') return '';
        const styleObj = style as object;
        const cached = this.cache.get(styleObj);
        if (cached !== undefined) return cached;

        const signature = this.serializeStyleValue(style);
        this.cache.set(styleObj, signature);
        return signature;
    }

    areStylesEquivalent(left?: Record<string, any>, right?: Record<string, any>): boolean {
        return this.getStyleSignature(left) === this.getStyleSignature(right);
    }
}

export function splitToGraphemes(
    text: string,
    locale: string | undefined,
    fallbackSplit: (value: string) => string[],
): string[] {
    if (!text) return [];
    try {
        const graphemes: string[] = [];
        const cacheKey = locale || 'und';
        let segmenter = graphemeSegmenterCache.get(cacheKey);
        if (!segmenter) {
            segmenter = new (Intl as any).Segmenter(locale, { granularity: 'grapheme' });
            graphemeSegmenterCache.set(cacheKey, segmenter);
        }
        for (const { segment } of segmenter.segment(text) as any) {
            graphemes.push(segment);
        }
        return graphemes;
    } catch {
        return fallbackSplit(text);
    }
}

export function appendSegmentToLine(
    line: TextSegment[],
    nextSegment: TextSegment,
    segmentWidth: number,
    allowMerge: boolean,
    areStylesEquivalent: (left?: Record<string, any>, right?: Record<string, any>) => boolean,
): TextSegment[] {
    const last = line[line.length - 1];
    const canMerge =
        allowMerge &&
        !!last &&
        last.fontFamily === nextSegment.fontFamily &&
        areStylesEquivalent(last.style, nextSegment.style);

    if (!canMerge) {
        line.push(nextSegment);
        return line;
    }

    const newLast = { ...last };
    newLast.width = (newLast.width || 0) + segmentWidth;
    const lastWidthOffset = (newLast.width || 0) - segmentWidth;
    newLast.text += nextSegment.text;

    if (newLast.glyphs && nextSegment.glyphs) {
        // Detach from the measurement cache's shared array reference before mutating.
        newLast.glyphs = newLast.glyphs.slice();
        for (let gi = 0; gi < nextSegment.glyphs.length; gi++) {
            const g = nextSegment.glyphs[gi];
            newLast.glyphs.push({ char: g.char, x: g.x + lastWidthOffset, y: g.y });
        }
    }

    line[line.length - 1] = newLast;
    return line;
}

export function getLineWidthLimit(totalWidth: number, lineIndex: number, firstLineIndent: number): number {
    return totalWidth - (lineIndex === 0 ? firstLineIndent : 0);
}

export function flattenSegmentsByHardBreak(segments: TextSegment[]): TextSegment[] {
    const flattened: TextSegment[] = [];
    for (const seg of segments) {
        const parts = seg.text.split('\n');
        parts.forEach((part, idx) => {
            if (part || idx < parts.length - 1) {
                flattened.push({ ...seg, text: part });
            }
            if (idx < parts.length - 1) {
                flattened.push({ text: '\n', style: {} } as any);
            }
        });
    }
    return flattened;
}
