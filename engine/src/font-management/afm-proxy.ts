import { getStandardAfmMetrics } from './afm-tables';
import { encodeStandardFontText } from './standard-font-encoding';
import type { StandardFontMetadata } from './sentinel';

type ProxyBBox = {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
};

type ProxyGlyph = {
    id: number;
    codePoints: number[];
    advanceWidth: number;
    bbox: ProxyBBox;
};

type ProxyPosition = {
    xAdvance: number;
    xOffset: number;
    yOffset: number;
};

type ProxyLayout = {
    glyphs: ProxyGlyph[];
    positions: ProxyPosition[];
};

const EMPTY_BBOX: ProxyBBox = { minX: 0, minY: 0, maxX: 0, maxY: 0 };

class AfmFontProxy {
    public readonly unitsPerEm = 1000;
    public readonly ascent: number;
    public readonly descent: number;
    public readonly postscriptName: string;
    public readonly familyName: string;
    private readonly defaultWidth: number;

    constructor(metadata: StandardFontMetadata) {
        const metrics = getStandardAfmMetrics(metadata.postscriptName);
        this.postscriptName = metadata.postscriptName;
        this.familyName = metadata.familyName;
        this.ascent = metrics.ascent;
        this.descent = metrics.descent;
        this.defaultWidth = metrics.defaultWidth;
    }

    glyphForCodePoint(codePoint: number): ProxyGlyph {
        const run = encodeStandardFontText(this.postscriptName, Number.isInteger(codePoint) && codePoint >= 0
            ? String.fromCodePoint(codePoint)
            : '');
        const glyph = run.glyphs[0];
        if (!glyph) {
            return { id: 0, codePoints: [codePoint], advanceWidth: this.defaultWidth, bbox: EMPTY_BBOX };
        }
        const bbox = glyph.bbox;
        return {
            id: glyph.id,
            codePoints: glyph.codePoints,
            advanceWidth: glyph.advanceWidth,
            bbox: bbox ? { minX: bbox[0], minY: bbox[1], maxX: bbox[2], maxY: bbox[3] } : EMPTY_BBOX
        };
    }

    layout(text: string): ProxyLayout {
        const run = encodeStandardFontText(this.postscriptName, text);
        return {
            glyphs: run.glyphs.map((glyph) => ({
                id: glyph.id,
                codePoints: [...glyph.codePoints],
                advanceWidth: glyph.advanceWidth,
                bbox: glyph.bbox
                    ? { minX: glyph.bbox[0], minY: glyph.bbox[1], maxX: glyph.bbox[2], maxY: glyph.bbox[3] }
                    : EMPTY_BBOX
            })),
            positions: run.positions.map((pos) => ({
                xAdvance: pos.xAdvance,
                xOffset: pos.xOffset,
                yOffset: pos.yOffset
            }))
        };
    }
}

export const createAfmFontProxy = (metadata: StandardFontMetadata): any => new AfmFontProxy(metadata);

