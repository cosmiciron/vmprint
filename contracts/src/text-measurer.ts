export type VerticalTextMetrics = {
    ascent: number;
    descent: number;
};

export type MeasureTextOptions = {
    letterSpacing?: number;
    direction?: 'ltr' | 'rtl';
    scriptClass?: string;
};

export type MeasuredTextResult = {
    width: number;
    glyphs: Array<{ char: string; x: number; y: number }>;
    shapedGlyphs?: Array<{
        id: number;
        codePoints: number[];
        xAdvance: number;
        xOffset: number;
        yOffset: number;
    }>;
    ascent: number;
    descent: number;
};

export interface TextMeasurer {
    measure(text: string, font: any, fontSize: number, options?: MeasureTextOptions): MeasuredTextResult;
    getVerticalMetrics(font: any): VerticalTextMetrics;
    supportsCluster(font: any, cluster: string): boolean;
}
