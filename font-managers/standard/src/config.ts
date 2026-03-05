import type { FontConfig } from '@vmprint/contracts';
import type { StandardFontId } from '@vmprint/engine';

export const STANDARD_FONT_SRC_PREFIX = 'standard-font://';

type StandardFontConfigEntry = {
    id: StandardFontId;
    name: string;
    family: string;
    weight: number;
    style: 'normal' | 'italic';
};

const STANDARD_FONT_ENTRIES: ReadonlyArray<StandardFontConfigEntry> = [
    { id: 0x00, name: 'Helvetica Regular', family: 'Helvetica', weight: 400, style: 'normal' },
    { id: 0x01, name: 'Helvetica Bold', family: 'Helvetica', weight: 700, style: 'normal' },
    { id: 0x02, name: 'Helvetica Oblique', family: 'Helvetica', weight: 400, style: 'italic' },
    { id: 0x03, name: 'Helvetica Bold Oblique', family: 'Helvetica', weight: 700, style: 'italic' },
    { id: 0x04, name: 'Times Roman', family: 'Times', weight: 400, style: 'normal' },
    { id: 0x05, name: 'Times Bold', family: 'Times', weight: 700, style: 'normal' },
    { id: 0x06, name: 'Times Italic', family: 'Times', weight: 400, style: 'italic' },
    { id: 0x07, name: 'Times Bold Italic', family: 'Times', weight: 700, style: 'italic' },
    { id: 0x08, name: 'Courier Regular', family: 'Courier', weight: 400, style: 'normal' },
    { id: 0x09, name: 'Courier Bold', family: 'Courier', weight: 700, style: 'normal' },
    { id: 0x0a, name: 'Courier Oblique', family: 'Courier', weight: 400, style: 'italic' },
    { id: 0x0b, name: 'Courier Bold Oblique', family: 'Courier', weight: 700, style: 'italic' },
    { id: 0x0c, name: 'Symbol Regular', family: 'Symbol', weight: 400, style: 'normal' },
    { id: 0x0d, name: 'ZapfDingbats Regular', family: 'ZapfDingbats', weight: 400, style: 'normal' }
] as const;

const buildStandardFontSrc = (id: StandardFontId): string =>
    `${STANDARD_FONT_SRC_PREFIX}${id.toString(16).padStart(2, '0')}`;

export const STANDARD_FONT_REGISTRY: FontConfig[] = STANDARD_FONT_ENTRIES.map((font) => ({
    name: font.name,
    family: font.family,
    weight: font.weight,
    style: font.style,
    src: buildStandardFontSrc(font.id),
    enabled: true,
    fallback: false
}));

export const STANDARD_FONT_SRC_TO_ID: Readonly<Record<string, StandardFontId>> = STANDARD_FONT_ENTRIES
    .reduce<Record<string, StandardFontId>>((acc, font) => {
        acc[buildStandardFontSrc(font.id)] = font.id;
        return acc;
    }, {});

export const normalizeFamilyKey = (family: string): string => String(family || '')
    .trim()
    .toLowerCase()
    .replace(/["']/g, '')
    .replace(/\s+/g, ' ');

export const STANDARD_FONT_ALIASES: Readonly<Record<string, string>> = {
    // Helvetica family
    'helvetica': 'Helvetica',
    'helvetica-bold': 'Helvetica',
    'helvetica-oblique': 'Helvetica',
    'helvetica-boldoblique': 'Helvetica',
    'arial': 'Helvetica',
    'sans-serif': 'Helvetica',
    'sans serif': 'Helvetica',

    // Times family
    'times': 'Times',
    'times roman': 'Times',
    'times-roman': 'Times',
    'times new roman': 'Times',
    'timesnewroman': 'Times',
    'times-bold': 'Times',
    'times-italic': 'Times',
    'times-bolditalic': 'Times',
    'serif': 'Times',

    // Courier family
    'courier': 'Courier',
    'courier new': 'Courier',
    'couriernew': 'Courier',
    'courier-bold': 'Courier',
    'courier-oblique': 'Courier',
    'courier-boldoblique': 'Courier',
    'monospace': 'Courier',

    // Symbol + Dingbats
    'symbol': 'Symbol',
    'zapfdingbats': 'ZapfDingbats',
    'zapf dingbats': 'ZapfDingbats',

    // Metric-compatible open-source families (used by LocalFontManager)
    'arimo': 'Helvetica',
    'tinos': 'Times',
    'cousine': 'Courier',
    'carlito': 'Helvetica',
    'caladea': 'Times',
    'noto sans': 'Helvetica',
    'courier prime': 'Courier'
} as const;

