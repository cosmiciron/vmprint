import type { FallbackFontSource, FontConfig } from './font-manager';

export type VerticalTextMetrics = {
    ascent: number;
    descent: number;
};

export type MeasureTextOptions = {
    letterSpacing?: number;
    direction?: 'ltr' | 'rtl';
    scriptClass?: string;
    lineHeight?: number;
    lineHeightMode?: 'print' | 'css';
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

export interface TextDelegateState {
    faceCache: Record<string, unknown>;
    loadingPromises: Record<string, Promise<unknown>>;
}

export interface TextDelegate {
    measure(text: string, font: any, fontSize: number, options?: MeasureTextOptions): MeasuredTextResult;
    getVerticalMetrics(font: any): VerticalTextMetrics;
    supportsCluster(font: any, cluster: string): boolean;
    estimateTextBoundsMetrics(font: any, text: string): VerticalTextMetrics | null;
    resolveFamilyAlias(family: string): string;
    getFontRegistrySnapshot(): FontConfig[];
    getEnabledFallbackFonts(): FallbackFontSource[];
    getFontsByFamily(family: string): FontConfig[];
    getFallbackFamilies(): string[];
    loadFace(src: string, state: TextDelegateState): Promise<any>;
    getCachedFace(src: string, state: TextDelegateState): any;
    getFaceCacheKey(face: any): string;
}

export type TextMeasurer = TextDelegate;
