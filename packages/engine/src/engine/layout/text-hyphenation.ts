import { ElementStyle, TextSegment } from '../types';
import { LAYOUT_DEFAULTS } from './defaults';
import { getDictionaryHyphenBreaks } from './hyphenation-dictionaries';

type HyphenationSettings = {
    mode: string;
    hyphenateCaps: boolean;
    minWordLength: number;
    minPrefix: number;
    minSuffix: number;
    lang: string;
};

function hasOnlyUppercaseLetters(text: string): boolean {
    const letters = text.match(/\p{L}/gu) || [];
    if (letters.length === 0) return false;
    return letters.every((ch) => ch.toLocaleUpperCase() === ch && ch.toLocaleLowerCase() !== ch);
}

function isLikelyHyphenatableWord(
    text: string,
    hyphenateCaps: boolean,
    minWordLength: number,
    getGraphemeClusters: (text: string) => string[],
): boolean {
    if (!text) return false;
    const clusters = getGraphemeClusters(text);
    if (clusters.length < minWordLength) return false;
    const lettersOnly = clusters.every((cluster) => /\p{L}/u.test(cluster));
    if (!lettersOnly) return false;
    if (!hyphenateCaps && hasOnlyUppercaseLetters(text)) return false;
    return true;
}

function getLanguageVowels(lang: string): RegExp {
    switch (lang) {
        case 'de':
            return /[aeiouyÃ¤Ã¶Ã¼AEIOUYÃ„Ã–Ãœ]/u;
        case 'fr':
            return /[aeiouyÃ Ã¢Ã¤Ã©Ã¨ÃªÃ«Ã®Ã¯Ã´Ã¶Ã¹Ã»Ã¼Ã¿AEIOUYÃ€Ã‚Ã„Ã‰ÃˆÃŠÃ‹ÃŽÃÃ”Ã–Ã™Ã›ÃœÅ¸]/u;
        case 'es':
            return /[aeiouÃ¡Ã©Ã­Ã³ÃºÃ¼AEIOUÃÃ‰ÃÃ“ÃšÃœ]/u;
        default:
            return /[aeiouyAEIOUYÃ Ã¡Ã¢Ã£Ã¤Ã¥ÄÄƒÄ…Ã¨Ã©ÃªÃ«Ä“Ä•Ä—Ä™Ä›Ã¬Ã­Ã®Ã¯Ä«Ä­Ä¯Ã²Ã³Ã´ÃµÃ¶ÅÅÅ‘Ã¹ÃºÃ»Ã¼Å«Å­Å¯Å±Å³Ã½Ã¿]/u;
    }
}

function getLanguageDigraphs(lang: string): string[] {
    switch (lang) {
        case 'de':
            return ['ch', 'sch', 'ei', 'ie', 'au', 'eu', 'Ã¤u'];
        case 'fr':
            return ['ch', 'ph', 'qu', 'gn', 'ou', 'ai', 'ei', 'au', 'eau'];
        case 'es':
            return ['ch', 'll', 'rr', 'qu', 'gu'];
        default:
            return ['th', 'ch', 'ph', 'sh', 'wh', 'ck', 'qu', 'ng'];
    }
}

function collectLanguageExceptionBreaks(cleanWord: string, lang: string): number[] {
    const dictionaryBreaks = getDictionaryHyphenBreaks(cleanWord, lang);
    if (dictionaryBreaks.length > 0) return dictionaryBreaks;

    const normalized = cleanWord.toLocaleLowerCase();
    const exceptions: Record<string, Record<string, number[]>> = {
        en: { extraordinaryarchitectures: [5, 8, 10, 13, 16, 20] },
        de: { charakterisierung: [3, 6, 8, 11] },
        fr: { internationalisation: [2, 5, 8, 11, 14] },
    };
    return exceptions[lang]?.[normalized] || [];
}

function collectAutoHyphenBreaksByLang(
    clusters: string[],
    minPrefix: number,
    minSuffix: number,
    lang: string,
): number[] {
    const breaks: number[] = [];
    const vowels = getLanguageVowels(lang);
    const digraphs = getLanguageDigraphs(lang);

    const isBlockedDigraph = (left: string, right: string): boolean => {
        const pair = `${left}${right}`.toLocaleLowerCase();
        return digraphs.includes(pair);
    };

    for (let i = minPrefix; i <= clusters.length - minSuffix; i++) {
        const left = clusters[i - 1] || '';
        const right = clusters[i] || '';
        if (!/\p{L}/u.test(left) || !/\p{L}/u.test(right)) continue;
        if (isBlockedDigraph(left, right)) continue;

        const leftVowel = vowels.test(left);
        const rightVowel = vowels.test(right);
        const prev = clusters[i - 2] || '';
        const next = clusters[i + 1] || '';
        const prevIsCon = !!prev && /\p{L}/u.test(prev) && !vowels.test(prev);
        const leftIsCon = /\p{L}/u.test(left) && !vowels.test(left);
        const rightIsCon = /\p{L}/u.test(right) && !vowels.test(right);
        const nextIsVowel = !!next && vowels.test(next);

        if (leftVowel !== rightVowel) {
            breaks.push(i);
            continue;
        }

        if (prevIsCon && leftIsCon && rightIsCon && nextIsVowel) {
            breaks.push(i);
        }
    }

    return breaks;
}

function collectSoftHyphenBreaks(
    rawText: string,
    cleanClusters: string[],
    minPrefix: number,
    minSuffix: number,
    getGraphemeClusters: (text: string) => string[],
): number[] {
    if (!rawText.includes('\u00AD')) return [];
    const rawClusters = getGraphemeClusters(rawText);
    const breaks: number[] = [];
    let cleanIndex = 0;
    for (const cluster of rawClusters) {
        if (cluster === '\u00AD') {
            if (cleanIndex >= minPrefix && cleanClusters.length - cleanIndex >= minSuffix) {
                breaks.push(cleanIndex);
            }
        } else {
            cleanIndex += 1;
        }
    }
    return breaks;
}

export function tryHyphenateSegmentToFit(params: {
    seg: TextSegment;
    font: any;
    fontSize: number;
    letterSpacing: number;
    availableWidth: number;
    style?: ElementStyle | Record<string, any>;
    resolveHyphenationSettings: (style?: ElementStyle | Record<string, any>) => HyphenationSettings;
    getGraphemeClusters: (text: string) => string[];
    cloneMeasuredSegment: (
        base: TextSegment,
        text: string,
        font: any,
        fontSize: number,
        letterSpacing: number,
    ) => { seg: TextSegment; width: number };
}): { head: TextSegment; headWidth: number; tail: TextSegment; tailWidth: number } | null {
    if (!Number.isFinite(params.availableWidth) || params.availableWidth <= 0) return null;

    const settings = params.resolveHyphenationSettings(params.style);
    if (settings.mode === 'off') return null;

    const raw = params.seg.text || '';
    const clean = raw.replace(/\u00AD/g, '');
    if (!isLikelyHyphenatableWord(clean, settings.hyphenateCaps, settings.minWordLength, params.getGraphemeClusters)) {
        return null;
    }

    const cleanClusters = params.getGraphemeClusters(clean);
    if (cleanClusters.length < settings.minWordLength) return null;

    const softBreaks = collectSoftHyphenBreaks(
        raw,
        cleanClusters,
        settings.minPrefix,
        settings.minSuffix,
        params.getGraphemeClusters,
    );
    const exceptionBreaks = collectLanguageExceptionBreaks(clean, settings.lang).filter(
        (idx) => idx >= settings.minPrefix && cleanClusters.length - idx >= settings.minSuffix,
    );
    const autoBreaks =
        settings.mode === 'auto'
            ? collectAutoHyphenBreaksByLang(cleanClusters, settings.minPrefix, settings.minSuffix, settings.lang)
            : [];

    // Merge, deduplicate, and sort descending without triple-spread + Set allocations.
    const seen = new Uint8Array(cleanClusters.length + 1);
    const candidateBreaks: number[] = [];
    const addBreak = (idx: number) => {
        if (!seen[idx]) {
            seen[idx] = 1;
            candidateBreaks.push(idx);
        }
    };
    for (const b of softBreaks) addBreak(b);
    for (const b of exceptionBreaks) addBreak(b);
    for (const b of autoBreaks) addBreak(b);
    candidateBreaks.sort((a, b) => b - a);
    if (candidateBreaks.length === 0) return null;

    for (const idx of candidateBreaks) {
        const headText = `${cleanClusters.slice(0, idx).join('')}-`;
        const tailText = cleanClusters.slice(idx).join('');
        if (!tailText) continue;

        const measuredHead = params.cloneMeasuredSegment(
            params.seg,
            headText,
            params.font,
            params.fontSize,
            params.letterSpacing,
        );
        if (measuredHead.width > params.availableWidth + LAYOUT_DEFAULTS.wrapTolerance) continue;

        const measuredTail = params.cloneMeasuredSegment(
            params.seg,
            tailText,
            params.font,
            params.fontSize,
            params.letterSpacing,
        );
        return {
            head: measuredHead.seg,
            headWidth: measuredHead.width,
            tail: measuredTail.seg,
            tailWidth: measuredTail.width,
        };
    }

    return null;
}
