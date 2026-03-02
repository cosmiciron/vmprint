import { TextSegment } from '../types';
import { LayoutUtils } from './layout-utils';

export function resolvePlainLayoutInfo(params: {
    segText: string;
    baseFontObj: any;
    familyName?: string;
    fallbackFont: any;
    defaultFontSize: number;
    transformSegment: (segment: TextSegment, fontFamily?: string) => TextSegment;
    resolveLoadedFamilyFont: (familyName: string, weight: number | string, style?: string) => any;
    baseFontFamily: string;
    getScriptClass: (text: string) => string;
    getOpticalScale: (scriptClass: string) => number;
}): { font: any; fontSize: number; segment: TextSegment } {
    const transformed = params.transformSegment(
        { text: params.segText, fontFamily: params.familyName },
        params.familyName,
    );
    const style = transformed.style || {};
    const resolvedWeight = LayoutUtils.normalizeFontWeight(style.fontWeight);
    const resolvedStyle = LayoutUtils.normalizeFontStyle(style.fontStyle);
    let resolvedFontSize = Number(style.fontSize || params.defaultFontSize);

    let resolvedFont = params.baseFontObj || params.fallbackFont;
    if (!resolvedFont) {
        const resolvedFamily = params.familyName || params.baseFontFamily;
        resolvedFont = params.resolveLoadedFamilyFont(resolvedFamily, resolvedWeight, resolvedStyle);
    } else if ((resolvedWeight !== 400 || resolvedStyle !== 'normal') && params.familyName) {
        resolvedFont = params.resolveLoadedFamilyFont(params.familyName, resolvedWeight, resolvedStyle);
    }

    if (params.baseFontObj && params.segText.trim()) {
        const scriptClass = params.getScriptClass(params.segText);
        const optScale = params.getOpticalScale(scriptClass);
        if (optScale !== 1.0) {
            resolvedFontSize *= optScale;
            if (!transformed.style) transformed.style = {};
            transformed.style.fontSize = resolvedFontSize;
        }
    }

    return { font: resolvedFont, fontSize: resolvedFontSize, segment: transformed };
}

export function resolveRichFontInfo(
    seg: TextSegment,
    defaultFontSize: number,
    baseFontFamily: string,
    resolveLoadedFamilyFont: (familyName: string, weight: number | string, style?: string) => any,
): { font: any; fontSize: number } {
    const style = seg.style || {};
    const resolvedWeight = LayoutUtils.normalizeFontWeight(style.fontWeight);
    const resolvedStyle = LayoutUtils.normalizeFontStyle(style.fontStyle);
    const fontSize = Number(style.fontSize || defaultFontSize);
    const familyName = seg.fontFamily || baseFontFamily;
    const font = resolveLoadedFamilyFont(familyName, resolvedWeight, resolvedStyle);
    return { font, fontSize };
}
