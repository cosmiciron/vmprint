import { getStandardAfmMetrics } from './afm-tables';
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
    private readonly widthsByCode: Readonly<Record<number, number>>;
    private readonly bboxByCode: Readonly<Record<number, [number, number, number, number]>>;

    constructor(metadata: StandardFontMetadata) {
        const metrics = getStandardAfmMetrics(metadata.postscriptName);
        this.postscriptName = metadata.postscriptName;
        this.familyName = metadata.familyName;
        this.ascent = metrics.ascent;
        this.descent = metrics.descent;
        this.defaultWidth = metrics.defaultWidth;
        this.widthsByCode = metrics.widthsByCode;
        this.bboxByCode = metrics.bboxByCode;
    }

    private bboxForCodePoint(codePoint: number): ProxyBBox {
        const b = this.bboxByCode[codePoint];
        if (!b) return EMPTY_BBOX;
        return { minX: b[0], minY: b[1], maxX: b[2], maxY: b[3] };
    }

    glyphForCodePoint(codePoint: number): ProxyGlyph {
        if (!Number.isInteger(codePoint) || codePoint < 0) {
            return { id: 0, codePoints: [codePoint], advanceWidth: this.defaultWidth, bbox: EMPTY_BBOX };
        }

        const width = this.widthsByCode[codePoint];
        if (!Number.isFinite(width)) {
            return { id: 0, codePoints: [codePoint], advanceWidth: this.defaultWidth, bbox: EMPTY_BBOX };
        }

        return {
            id: codePoint + 1,
            codePoints: [codePoint],
            advanceWidth: width,
            bbox: this.bboxForCodePoint(codePoint)
        };
    }

    layout(text: string): ProxyLayout {
        const glyphs: ProxyGlyph[] = [];
        const positions: ProxyPosition[] = [];

        for (const character of text || '') {
            const codePoint = character.codePointAt(0);
            if (codePoint === undefined) continue;
            const glyph = this.glyphForCodePoint(codePoint);
            glyphs.push(glyph);
            positions.push({
                xAdvance: glyph.advanceWidth,
                xOffset: 0,
                yOffset: 0
            });
        }

        return { glyphs, positions };
    }
}

export const createAfmFontProxy = (metadata: StandardFontMetadata): any => new AfmFontProxy(metadata);

