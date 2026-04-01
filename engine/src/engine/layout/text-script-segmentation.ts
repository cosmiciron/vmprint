export type ScriptFontSegment = { text: string; fontName?: string; fontObject?: any };

import bidiFactory from 'bidi-js';
const bidi = bidiFactory();
export function isCJKChar(code: number): boolean {
    return (code >= 0x4E00 && code <= 0x9FFF) ||
        (code >= 0x3400 && code <= 0x4DBF) ||
        (code >= 0x20000 && code <= 0x2A6DF) ||
        (code >= 0x3040 && code <= 0x30FF) ||
        (code >= 0x3000 && code <= 0x303F) ||
        (code >= 0xFF00 && code <= 0xFFEF);
}

export function isThaiChar(code: number): boolean {
    return code >= 0x0E00 && code <= 0x0E7F;
}

function isHiraganaOrKatakanaChar(code: number): boolean {
    return (code >= 0x3040 && code <= 0x309F) || (code >= 0x30A0 && code <= 0x30FF);
}

function isHangulChar(code: number): boolean {
    return (code >= 0xAC00 && code <= 0xD7AF) ||
        (code >= 0x1100 && code <= 0x11FF) ||
        (code >= 0x3130 && code <= 0x318F) ||
        (code >= 0xA960 && code <= 0xA97F) ||
        (code >= 0xD7B0 && code <= 0xD7FF);
}

function isCjkIdeograph(code: number): boolean {
    return (code >= 0x4E00 && code <= 0x9FFF) ||
        (code >= 0x3400 && code <= 0x4DBF) ||
        (code >= 0x20000 && code <= 0x2A6DF);
}

function normalizeLocale(locale?: string): string {
    return String(locale || '').trim().toLowerCase();
}

function reorderFamiliesByPreference(families: string[], preferredFamilies: string[]): string[] {
    if (preferredFamilies.length === 0) return families;
    const preferredSet = new Set(preferredFamilies);
    const familySet = new Set(families);
    const preferred = preferredFamilies.filter((family) => familySet.has(family));
    const rest = families.filter((family) => !preferredSet.has(family));
    return [...preferred, ...rest];
}

function reorderFallbacksPreservingBase(
    baseFamily: string,
    fallbackFamilies: string[],
    preferredFamilies: string[]
): string[] {
    return [
        baseFamily,
        ...reorderFamiliesByPreference(
            fallbackFamilies.filter((family) => family !== baseFamily),
            preferredFamilies.filter((family) => family !== baseFamily)
        )
    ];
}

function deriveLocalePreferredFamilies(locale: string): string[] {
    if (locale.startsWith('ja')) return ['Noto Sans JP'];
    if (locale.startsWith('th')) return ['Noto Sans Thai'];
    if (locale.startsWith('ko')) return ['Noto Sans KR'];
    if (locale.startsWith('zh')) return ['Noto Sans SC'];
    return [];
}

function deriveClusterPreferredFamilies(cluster: string, locale: string): string[] {
    const code = cluster.codePointAt(0) || 0;

    if (isThaiChar(code)) return ['Noto Sans Thai'];
    if (isHiraganaOrKatakanaChar(code)) return ['Noto Sans JP'];
    if (isHangulChar(code)) return ['Noto Sans KR'];

    if (isCjkIdeograph(code)) {
        if (locale.startsWith('ja')) return ['Noto Sans JP', 'Noto Sans SC', 'Noto Sans KR'];
        if (locale.startsWith('ko')) return ['Noto Sans KR', 'Noto Sans SC', 'Noto Sans JP'];
        if (locale.startsWith('zh')) return ['Noto Sans SC', 'Noto Sans JP', 'Noto Sans KR'];
        return ['Noto Sans SC', 'Noto Sans JP', 'Noto Sans KR'];
    }

    return [];
}

export function hasRtlScript(text: string): boolean {
    for (const ch of text || '') {
        const cp = ch.codePointAt(0) || 0;
        const isRtl =
            (cp >= 0x0590 && cp <= 0x08FF) ||
            (cp >= 0xFB1D && cp <= 0xFDFF) ||
            (cp >= 0xFE70 && cp <= 0xFEFF);
        if (isRtl) return true;
    }
    return false;
}

export function getStrongDirection(text: string): 'ltr' | 'rtl' | 'neutral' {
    for (const ch of text || '') {
        const cp = ch.codePointAt(0) || 0;
        const isRtl =
            (cp >= 0x0590 && cp <= 0x08FF) ||
            (cp >= 0xFB1D && cp <= 0xFDFF) ||
            (cp >= 0xFE70 && cp <= 0xFEFF);
        if (isRtl) return 'rtl';
        // Fast code-point check for common letter ranges before falling back to regex.
        if ((cp >= 0x41 && cp <= 0x5A) ||   // A-Z
            (cp >= 0x61 && cp <= 0x7A) ||   // a-z
            (cp >= 0xC0 && cp <= 0x024F) || // Latin Extended
            (cp >= 0x0370 && cp <= 0x03FF) || // Greek
            (cp >= 0x0400 && cp <= 0x04FF) || // Cyrillic
            (cp >= 0x0900 && cp <= 0x097F) || // Devanagari
            (cp >= 0x4E00 && cp <= 0x9FFF) || // CJK Unified
            (cp >= 0xAC00 && cp <= 0xD7AF) || // Hangul
            (cp >= 0x3040 && cp <= 0x30FF)) { // Hiragana/Katakana
            return 'ltr';
        }
        if (cp > 0x20 && /\p{L}/u.test(ch)) return 'ltr';
    }
    return 'neutral';
}

export function resolveBaseDirection(
    text: string,
    requestedDirection: string | undefined,
    fallbackDirection: 'ltr' | 'rtl' = 'ltr'
): 'ltr' | 'rtl' {
    if (requestedDirection === 'rtl') return 'rtl';
    if (requestedDirection === 'ltr') return 'ltr';
    const strong = getStrongDirection(text);
    if (strong === 'rtl') return 'rtl';
    if (strong === 'ltr') return 'ltr';
    return fallbackDirection;
}

export function splitByBidiDirection(text: string, baseDirection: string): { text: string; direction: 'ltr' | 'rtl' }[] {
    if (!text) return [];

    const bidiBase = resolveBaseDirection(text, baseDirection);
    const embedding = bidi.getEmbeddingLevels(text, bidiBase as any);

    const runs: { text: string; direction: 'ltr' | 'rtl' }[] = [];
    let currentLevel = embedding.levels[0];
    let currentStart = 0;

    for (let i = 1; i < text.length; i++) {
        if (embedding.levels[i] !== currentLevel) {
            runs.push({
                text: text.substring(currentStart, i),
                direction: currentLevel % 2 === 1 ? 'rtl' : 'ltr'
            });
            currentStart = i;
            currentLevel = embedding.levels[i];
        }
    }

    if (currentStart < text.length) {
        runs.push({
            text: text.substring(currentStart, text.length),
            direction: currentLevel % 2 === 1 ? 'rtl' : 'ltr'
        });
    }

    // Post-process neutral runs (spaces/punctuation). Embedding levels can leave
    // neutrals at the paragraph level in mixed text, which fragments LTR phrases
    // in RTL paragraphs (e.g. one run per word + neutral spaces), then run-level
    // reordering reverses the phrase word order. Reassign neutral runs using
    // neighboring strong runs, then merge adjacent same-direction runs.
    const resolved = runs.map((run) => ({ ...run }));
    for (let i = 0; i < resolved.length; i++) {
        const strong = getStrongDirection(resolved[i].text);
        if (strong !== 'neutral') {
            resolved[i].direction = strong;
            continue;
        }

        const prevStrong = (() => {
            for (let j = i - 1; j >= 0; j--) {
                const d = getStrongDirection(resolved[j].text);
                if (d !== 'neutral') return d;
            }
            return null;
        })();
        const nextStrong = (() => {
            for (let j = i + 1; j < resolved.length; j++) {
                const d = getStrongDirection(resolved[j].text);
                if (d !== 'neutral') return d;
            }
            return null;
        })();

        if (prevStrong && nextStrong && prevStrong === nextStrong) {
            resolved[i].direction = prevStrong;
        } else if (prevStrong) {
            resolved[i].direction = prevStrong;
        } else if (nextStrong) {
            resolved[i].direction = nextStrong;
        } else {
            resolved[i].direction = bidiBase === 'rtl' ? 'rtl' : 'ltr';
        }
    }

    const merged: { text: string; direction: 'ltr' | 'rtl' }[] = [];
    for (const run of resolved) {
        const last = merged[merged.length - 1];
        if (last && last.direction === run.direction) {
            last.text += run.text;
        } else {
            merged.push({ ...run });
        }
    }

    return merged;
}

export function splitByScriptType(
    text: string,
    getGraphemeClusters: (value: string) => string[],
    isCJK: (code: number) => boolean
): { text: string; isCJK: boolean }[] {
    if (!text) return [];

    // Fast path: if all code points are in the Basic Latin + Latin Extended range,
    // skip the grapheme segmenter entirely and return the text as a single non-CJK run.
    let allLatin = true;
    for (let i = 0; i < text.length; i++) {
        const cp = text.charCodeAt(i);
        if (cp > 0x024F) { allLatin = false; break; }
    }
    if (allLatin) return [{ text, isCJK: false }];

    const clusters = getGraphemeClusters(text);
    if (clusters.length === 0) return [];

    const result: { text: string; isCJK: boolean }[] = [];
    let currentTypeIsCJK: boolean | null = null;
    let currentText = '';

    for (const cluster of clusters) {
        const cp = cluster.codePointAt(0) || 0;
        const cjk = isCJK(cp);

        if (currentTypeIsCJK === null) {
            currentTypeIsCJK = cjk;
            currentText = cluster;
            continue;
        }

        if (cjk !== currentTypeIsCJK) {
            result.push({ text: currentText, isCJK: currentTypeIsCJK });
            currentTypeIsCJK = cjk;
            currentText = cluster;
            continue;
        }

        currentText += cluster;
    }

    if (currentText.length > 0 && currentTypeIsCJK !== null) {
        result.push({ text: currentText, isCJK: currentTypeIsCJK });
    }

    return result;
}

export function getScriptClass(
    text: string,
    isCJK: (code: number) => boolean,
    defaultScriptClass: string
): string {
    for (let i = 0; i < text.length; i++) {
        const code = text.codePointAt(i) || 0;
        if (code <= 0x20) continue;

        if ((code >= 0xAC00 && code <= 0xD7AF) ||
            (code >= 0x1100 && code <= 0x11FF) ||
            (code >= 0x3130 && code <= 0x318F) ||
            (code >= 0xA960 && code <= 0xA97F) ||
            (code >= 0xD7B0 && code <= 0xD7FF)) {
            return 'korean';
        }

        if (isCJK(code)) return 'cjk';
        if (code >= 0x0E00 && code <= 0x0E7F) return 'thai';
        if (code >= 0x0900 && code <= 0x097F) return 'devanagari';

        if ((code >= 0x0600 && code <= 0x06FF) ||
            (code >= 0x0750 && code <= 0x077F) ||
            (code >= 0xFB50 && code <= 0xFDFF) ||
            (code >= 0xFE70 && code <= 0xFEFF)) {
            return 'arabic';
        }

        if (code >= 0x0400 && code <= 0x04FF) return 'cyrillic';
        if (code <= 0x024F) return 'latin';
        if (code > 0xFFFF) i++;
    }
    return defaultScriptClass;
}

export function segmentTextByFont(params: {
    text: string;
    preferredFamily?: string;
    preferredLocale?: string;
    baseFontFamily: string;
    fallbackFamilies: string[];
    getGraphemeClusters: (value: string) => string[];
    resolveLoadedFamilyFont: (familyName: string, weight: number, style?: string) => any;
    fontSupportsCluster: (font: any, cluster: string) => boolean;
    /** Optional shared cache to avoid re-resolving fonts across multiple calls within the same layout pass. */
    sharedFontCache?: Map<string, any | null>;
}): ScriptFontSegment[] {
    const clusters = params.getGraphemeClusters(params.text);
    if (clusters.length === 0) return [];

    const baseFamily = params.preferredFamily || params.baseFontFamily;
    const locale = normalizeLocale(params.preferredLocale);
    const fallbackOrder = params.fallbackFamilies.filter((family) => family !== baseFamily);
    const localePreferredFamilies = deriveLocalePreferredFamilies(locale);
    const familyOrder = reorderFallbacksPreservingBase(baseFamily, fallbackOrder, localePreferredFamilies);

    const resolveRegularFont = (family: string): any | null => {
        try {
            return params.resolveLoadedFamilyFont(family, 400);
        } catch {
            return null;
        }
    };

    const familyFontCache = params.sharedFontCache ?? new Map<string, any | null>();
    const getFamilyFont = (family: string): any | null => {
        if (!familyFontCache.has(family)) {
            familyFontCache.set(family, resolveRegularFont(family));
        }
        return familyFontCache.get(family) || null;
    };

    const segments: ScriptFontSegment[] = [];
    let currentFamily: string | undefined = undefined;
    let currentFont: any = null;
    let currentText = '';

    const pushCurrent = () => {
        if (!currentText) return;
        segments.push({ text: currentText, fontName: currentFamily, fontObject: currentFont || undefined });
        currentText = '';
    };

    // Cache the last cluster's preferred-families key → reordered family list.
    // Consecutive clusters of the same script type share the same ordering, avoiding
    // per-cluster Set construction and two filter passes for every character.
    let lastClusterPrefKey = '';
    let lastPreferredFamilyOrder: string[] = familyOrder;

    for (const cluster of clusters) {
        let assignedFamily: string | undefined;
        let assignedFont: any = null;

        // Keep neutral whitespace with the current run to avoid fragmenting
        // mixed-script phrases (notably RTL words separated by spaces).
        if (/^\s+$/u.test(cluster) && currentFamily !== undefined) {
            assignedFamily = currentFamily;
            assignedFont = currentFont;
        }
        if (!assignedFamily) {
            const clusterPreferredFamilies = deriveClusterPreferredFamilies(cluster, locale);
            const clusterPrefKey = clusterPreferredFamilies.join('|');
            let preferredFamilyOrder: string[];
            if (clusterPrefKey === lastClusterPrefKey) {
                preferredFamilyOrder = lastPreferredFamilyOrder;
            } else {
                preferredFamilyOrder = reorderFallbacksPreservingBase(baseFamily, fallbackOrder, clusterPreferredFamilies);
                lastClusterPrefKey = clusterPrefKey;
                lastPreferredFamilyOrder = preferredFamilyOrder;
            }

            for (const family of preferredFamilyOrder) {
                const familyFont = getFamilyFont(family);
                if (!familyFont) continue;
                if (params.fontSupportsCluster(familyFont, cluster)) {
                    assignedFamily = family;
                    assignedFont = family === params.baseFontFamily ? null : familyFont;
                    break;
                }
            }

            if (!assignedFamily) {
                assignedFamily = baseFamily;
                assignedFont = baseFamily === params.baseFontFamily ? null : getFamilyFont(baseFamily);
            }
        }

        if (assignedFamily !== currentFamily || assignedFont !== currentFont) {
            pushCurrent();
            currentFamily = assignedFamily;
            currentFont = assignedFont;
        }

        currentText += cluster;
    }

    pushCurrent();
    return segments;
}

