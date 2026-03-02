export type ScriptFontSegment = { text: string; fontName?: string; fontObject?: any };

export function isCJKChar(code: number): boolean {
    return (
        (code >= 0x4e00 && code <= 0x9fff) ||
        (code >= 0x3400 && code <= 0x4dbf) ||
        (code >= 0x20000 && code <= 0x2a6df) ||
        (code >= 0x3040 && code <= 0x30ff) ||
        (code >= 0x3000 && code <= 0x303f) ||
        (code >= 0xff00 && code <= 0xffef)
    );
}

export function isThaiChar(code: number): boolean {
    return code >= 0x0e00 && code <= 0x0e7f;
}

function isHiraganaOrKatakanaChar(code: number): boolean {
    return (code >= 0x3040 && code <= 0x309f) || (code >= 0x30a0 && code <= 0x30ff);
}

function isHangulChar(code: number): boolean {
    return (
        (code >= 0xac00 && code <= 0xd7af) ||
        (code >= 0x1100 && code <= 0x11ff) ||
        (code >= 0x3130 && code <= 0x318f) ||
        (code >= 0xa960 && code <= 0xa97f) ||
        (code >= 0xd7b0 && code <= 0xd7ff)
    );
}

function isCjkIdeograph(code: number): boolean {
    return (
        (code >= 0x4e00 && code <= 0x9fff) || (code >= 0x3400 && code <= 0x4dbf) || (code >= 0x20000 && code <= 0x2a6df)
    );
}

function normalizeLocale(locale?: string): string {
    return String(locale || '')
        .trim()
        .toLowerCase();
}

function reorderFamiliesByPreference(families: string[], preferredFamilies: string[]): string[] {
    if (preferredFamilies.length === 0) return families;
    const preferredSet = new Set(preferredFamilies);
    const preferred = families.filter((family) => preferredSet.has(family));
    const rest = families.filter((family) => !preferredSet.has(family));
    return [...preferred, ...rest];
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
            (cp >= 0x0590 && cp <= 0x08ff) || (cp >= 0xfb1d && cp <= 0xfdff) || (cp >= 0xfe70 && cp <= 0xfeff);
        if (isRtl) return true;
    }
    return false;
}

export function splitByScriptType(
    text: string,
    getGraphemeClusters: (value: string) => string[],
    isCJK: (code: number) => boolean,
): { text: string; isCJK: boolean }[] {
    if (!text) return [];

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

export function getScriptClass(text: string, isCJK: (code: number) => boolean, defaultScriptClass: string): string {
    for (let i = 0; i < text.length; i++) {
        const code = text.codePointAt(i) || 0;
        if (code <= 0x20) continue;

        if (
            (code >= 0xac00 && code <= 0xd7af) ||
            (code >= 0x1100 && code <= 0x11ff) ||
            (code >= 0x3130 && code <= 0x318f) ||
            (code >= 0xa960 && code <= 0xa97f) ||
            (code >= 0xd7b0 && code <= 0xd7ff)
        ) {
            return 'korean';
        }

        if (isCJK(code)) return 'cjk';
        if (code >= 0x0e00 && code <= 0x0e7f) return 'thai';
        if (code >= 0x0900 && code <= 0x097f) return 'devanagari';

        if (
            (code >= 0x0600 && code <= 0x06ff) ||
            (code >= 0x0750 && code <= 0x077f) ||
            (code >= 0xfb50 && code <= 0xfdff) ||
            (code >= 0xfe70 && code <= 0xfeff)
        ) {
            return 'arabic';
        }

        if (code >= 0x0400 && code <= 0x04ff) return 'cyrillic';
        if (code <= 0x024f) return 'latin';
        if (code > 0xffff) i++;
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
}): ScriptFontSegment[] {
    const clusters = params.getGraphemeClusters(params.text);
    if (clusters.length === 0) return [];

    const baseFamily = params.preferredFamily || params.baseFontFamily;
    const locale = normalizeLocale(params.preferredLocale);
    const fallbackOrder = params.fallbackFamilies.filter((family) => family !== baseFamily);
    const localePreferredFamilies = deriveLocalePreferredFamilies(locale);
    const familyOrder = [baseFamily, ...reorderFamiliesByPreference(fallbackOrder, localePreferredFamilies)];

    const resolveRegularFont = (family: string): any | null => {
        try {
            return params.resolveLoadedFamilyFont(family, 400);
        } catch {
            return null;
        }
    };

    const familyFontCache = new Map<string, any | null>();
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

        const clusterPreferredFamilies = deriveClusterPreferredFamilies(cluster, locale);
        const clusterPrefKey = clusterPreferredFamilies.join('|');
        let preferredFamilyOrder: string[];
        if (clusterPrefKey === lastClusterPrefKey) {
            preferredFamilyOrder = lastPreferredFamilyOrder;
        } else {
            preferredFamilyOrder = reorderFamiliesByPreference(familyOrder, clusterPreferredFamilies);
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
