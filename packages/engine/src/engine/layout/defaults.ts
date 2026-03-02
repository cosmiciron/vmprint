import { OverflowPolicy } from '../types';

export const PAGE_SIZE_POINTS = {
    LETTER: { width: 612, height: 792 },
    A4: { width: 595, height: 842 },
} as const;

export const PAGE_SIZE_FALLBACK = 'A4' as const;

export const LAYOUT_DEFAULTS = {
    overflowPolicy: 'clip' as OverflowPolicy,
    orphans: 2,
    widows: 2,
    minEffectiveHeight: 1.0,
    wrapTolerance: 1e-8,
    storyWrapOpticalUnderhang: false,
    pageNumber: {
        startPage: 1,
        format: '{n}.',
        fontSize: 10,
        color: 'black',
        offset: 40,
        position: 'bottom' as const,
        alignment: 'center' as const,
    },
    textLayout: {
        lang: 'und',
        direction: 'auto' as const,
        hyphenation: 'off' as const,
        hyphenateCaps: false,
        hyphenMinWordLength: 6,
        hyphenMinPrefix: 3,
        hyphenMinSuffix: 2,
        justifyEngine: 'legacy' as const,
        justifyStrategy: 'auto' as const,
    },
    opticalScaling: {
        neutral: 1.0,
        defaultScriptClass: 'latin',
        factors: {
            latin: 1.0,
            cjk: 0.92,
            korean: 0.92,
            thai: 0.96,
            devanagari: 0.95,
            arabic: 0.95,
            cyrillic: 1.0,
            default: 1.0,
        } as Record<string, number>,
    },
} as const;
