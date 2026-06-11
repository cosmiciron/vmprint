import { FontConfig } from '@vmprint/contracts';

export const LOCAL_FONT_ROOT = 'assets/fonts';

const resolveLocalFontUrl = (relativePath: string): string => {
    return `${LOCAL_FONT_ROOT}/${relativePath}`;
};

export const LOCAL_FONT_ALIASES: Record<string, string> = {
    // Common Western document families
    'times': 'Tinos',
    'times new roman': 'Tinos',
    'timesnewroman': 'Tinos',
    'times-roman': 'Tinos',
    'courier': 'Cousine',
    'courier new': 'Cousine',
    'couriernew': 'Cousine',
    'arial': 'Arimo',
    'helvetica': 'Arimo',
    'helvetica neue': 'Arimo',
    'helveticaneue': 'Arimo',
    'calibri': 'Carlito',
    'cambria': 'Caladea',
    'segoe ui': 'Carlito',
    'sans-serif': 'Noto Sans',
    'sans serif': 'Noto Sans',
    'serif': 'Tinos',
    'monospace': 'Cousine',
    'symbol': 'Noto Sans Symbols 2',
    'zapfdingbats': 'Noto Sans Symbols 2',
    'zapf dingbats': 'Noto Sans Symbols 2',

    // Common CJK naming variants mapped to bundled Noto families
    'microsoft yahei': 'Noto Sans SC',
    'simhei': 'Noto Sans SC',
    'heiti': 'Noto Sans SC',
    'heiti sc': 'Noto Sans SC',
    'songti': 'Noto Serif SC',
    'songti sc': 'Noto Serif SC',
    'simsun': 'Noto Serif SC',
    'stsong': 'Noto Serif SC',
    'kaiti': 'Noto Sans SC',
    'kai': 'Noto Sans SC',
    'hiragino sans': 'Noto Sans JP',
    'yu gothic': 'Noto Sans JP',
    'malgun gothic': 'Noto Sans KR',
    'apple sd gothic neo': 'Noto Sans KR',
    'noto sans cjk sc': 'Noto Sans SC',
    'noto sans cjk jp': 'Noto Sans JP',
    'noto sans cjk kr': 'Noto Sans KR',
    'noto serif sc': 'Noto Serif SC',
    'noto serif cjk sc': 'Noto Serif SC',
    'simsun serif': 'Noto Serif SC',

    // Other scripts
    'hebrew': 'Noto Sans Hebrew',
    'bengali': 'Noto Sans Bengali',
    'greek': 'Noto Sans Greek',
    'cyrillic': 'Noto Sans Cyrillic'
};

export const LOCAL_FONT_REGISTRY: FontConfig[] = [
    // Arimo static baseline
    { name: 'Arimo Regular', family: 'Arimo', weight: 400, style: 'normal', src: resolveLocalFontUrl('Arimo/Arimo-Regular.ttf'), unicodeRange: 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+2000-201F,U+2074,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD', enabled: true, fallback: false },
    { name: 'Arimo Bold', family: 'Arimo', weight: 700, style: 'normal', src: resolveLocalFontUrl('Arimo/Arimo-Bold.ttf'), unicodeRange: 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+2000-201F,U+2074,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD', enabled: true, fallback: false },
    { name: 'Arimo Italic', family: 'Arimo', weight: 400, style: 'italic', src: resolveLocalFontUrl('Arimo/Arimo-Italic.ttf'), unicodeRange: 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+2000-201F,U+2074,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD', enabled: true, fallback: false },
    { name: 'Arimo Bold Italic', family: 'Arimo', weight: 700, style: 'italic', src: resolveLocalFontUrl('Arimo/Arimo-BoldItalic.ttf'), unicodeRange: 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+2000-201F,U+2074,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD', enabled: true, fallback: false },

    // Noto Sans static baseline (Latin)
    { name: 'Noto Sans Regular', family: 'Noto Sans', weight: 400, style: 'normal', src: resolveLocalFontUrl('NotoSans/NotoSans-Regular.ttf'), unicodeRange: 'U+0000-024F,U+1E00-1EFF,U+2000-206F,U+20A0-20CF,U+2100-214F,U+2190-21FF,U+2C60-2C7F,U+A720-A7FF', enabled: true, fallback: false },
    { name: 'Noto Sans Bold', family: 'Noto Sans', weight: 700, style: 'normal', src: resolveLocalFontUrl('NotoSans/NotoSans-Bold.ttf'), unicodeRange: 'U+0000-024F,U+1E00-1EFF,U+2000-206F,U+20A0-20CF,U+2100-214F,U+2190-21FF,U+2C60-2C7F,U+A720-A7FF', enabled: true, fallback: false },
    { name: 'Noto Sans Italic', family: 'Noto Sans', weight: 400, style: 'italic', src: resolveLocalFontUrl('NotoSans/NotoSans-Italic.ttf'), unicodeRange: 'U+0000-024F,U+1E00-1EFF,U+2000-206F,U+20A0-20CF,U+2100-214F,U+2190-21FF,U+2C60-2C7F,U+A720-A7FF', enabled: true, fallback: false },
    { name: 'Noto Sans Bold Italic', family: 'Noto Sans', weight: 700, style: 'italic', src: resolveLocalFontUrl('NotoSans/NotoSans-BoldItalic.ttf'), unicodeRange: 'U+0000-024F,U+1E00-1EFF,U+2000-206F,U+20A0-20CF,U+2100-214F,U+2190-21FF,U+2C60-2C7F,U+A720-A7FF', enabled: true, fallback: false },

    // Greek & Cyrillic (Complementing Noto Sans baseline)
    // Greek and Cyrillic are natively supported by the standard Noto Sans font bundled with the engine.

    // Carlito (Calibri-compatible)
    { name: 'Carlito Regular', family: 'Carlito', weight: 400, style: 'normal', src: resolveLocalFontUrl('Carlito/Carlito-Regular.ttf'), unicodeRange: 'U+0000-024F,U+1E00-1EFF,U+2000-206F,U+20A0-20CF,U+2100-214F,U+2190-21FF,U+2C60-2C7F,U+A720-A7FF', enabled: true, fallback: false },
    { name: 'Carlito Bold', family: 'Carlito', weight: 700, style: 'normal', src: resolveLocalFontUrl('Carlito/Carlito-Bold.ttf'), unicodeRange: 'U+0000-024F,U+1E00-1EFF,U+2000-206F,U+20A0-20CF,U+2100-214F,U+2190-21FF,U+2C60-2C7F,U+A720-A7FF', enabled: true, fallback: false },
    { name: 'Carlito Italic', family: 'Carlito', weight: 400, style: 'italic', src: resolveLocalFontUrl('Carlito/Carlito-Italic.ttf'), unicodeRange: 'U+0000-024F,U+1E00-1EFF,U+2000-206F,U+20A0-20CF,U+2100-214F,U+2190-21FF,U+2C60-2C7F,U+A720-A7FF', enabled: true, fallback: false },
    { name: 'Carlito Bold Italic', family: 'Carlito', weight: 700, style: 'italic', src: resolveLocalFontUrl('Carlito/Carlito-BoldItalic.ttf'), unicodeRange: 'U+0000-024F,U+1E00-1EFF,U+2000-206F,U+20A0-20CF,U+2100-214F,U+2190-21FF,U+2C60-2C7F,U+A720-A7FF', enabled: true, fallback: false },

    // Caladea (Cambria-compatible)
    { name: 'Caladea Regular', family: 'Caladea', weight: 400, style: 'normal', src: resolveLocalFontUrl('Caladea/Caladea-Regular.ttf'), unicodeRange: 'U+0000-024F,U+1E00-1EFF,U+2000-206F,U+20A0-20CF,U+2100-214F,U+2190-21FF,U+2C60-2C7F,U+A720-A7FF', enabled: true, fallback: false },
    { name: 'Caladea Bold', family: 'Caladea', weight: 700, style: 'normal', src: resolveLocalFontUrl('Caladea/Caladea-Bold.ttf'), unicodeRange: 'U+0000-024F,U+1E00-1EFF,U+2000-206F,U+20A0-20CF,U+2100-214F,U+2190-21FF,U+2C60-2C7F,U+A720-A7FF', enabled: true, fallback: false },
    { name: 'Caladea Italic', family: 'Caladea', weight: 400, style: 'italic', src: resolveLocalFontUrl('Caladea/Caladea-Italic.ttf'), unicodeRange: 'U+0000-024F,U+1E00-1EFF,U+2000-206F,U+20A0-20CF,U+2100-214F,U+2190-21FF,U+2C60-2C7F,U+A720-A7FF', enabled: true, fallback: false },
    { name: 'Caladea Bold Italic', family: 'Caladea', weight: 700, style: 'italic', src: resolveLocalFontUrl('Caladea/Caladea-BoldItalic.ttf'), unicodeRange: 'U+0000-024F,U+1E00-1EFF,U+2000-206F,U+20A0-20CF,U+2100-214F,U+2190-21FF,U+2C60-2C7F,U+A720-A7FF', enabled: true, fallback: false },

    // Tinos
    { name: 'Tinos Regular', family: 'Tinos', weight: 400, style: 'normal', src: resolveLocalFontUrl('Tinos/Tinos-Regular.ttf'), unicodeRange: 'U+0000-024F,U+1E00-1EFF,U+2000-206F,U+20A0-20CF,U+2100-214F,U+2190-21FF,U+2C60-2C7F,U+A720-A7FF', enabled: true, fallback: false },
    { name: 'Tinos Bold', family: 'Tinos', weight: 700, style: 'normal', src: resolveLocalFontUrl('Tinos/Tinos-Bold.ttf'), unicodeRange: 'U+0000-024F,U+1E00-1EFF,U+2000-206F,U+20A0-20CF,U+2100-214F,U+2190-21FF,U+2C60-2C7F,U+A720-A7FF', enabled: true, fallback: false },
    { name: 'Tinos Italic', family: 'Tinos', weight: 400, style: 'italic', src: resolveLocalFontUrl('Tinos/Tinos-Italic.ttf'), unicodeRange: 'U+0000-024F,U+1E00-1EFF,U+2000-206F,U+20A0-20CF,U+2100-214F,U+2190-21FF,U+2C60-2C7F,U+A720-A7FF', enabled: true, fallback: false },
    { name: 'Tinos Bold Italic', family: 'Tinos', weight: 700, style: 'italic', src: resolveLocalFontUrl('Tinos/Tinos-BoldItalic.ttf'), unicodeRange: 'U+0000-024F,U+1E00-1EFF,U+2000-206F,U+20A0-20CF,U+2100-214F,U+2190-21FF,U+2C60-2C7F,U+A720-A7FF', enabled: true, fallback: false },

    // Cousine
    { name: 'Cousine Regular', family: 'Cousine', weight: 400, style: 'normal', src: resolveLocalFontUrl('Cousine/Cousine-Regular.ttf'), unicodeRange: 'U+0000-024F,U+1E00-1EFF,U+2000-206F,U+20A0-20CF,U+2100-214F,U+2190-21FF,U+2C60-2C7F,U+A720-A7FF', enabled: true, fallback: false },
    { name: 'Cousine Bold', family: 'Cousine', weight: 700, style: 'normal', src: resolveLocalFontUrl('Cousine/Cousine-Bold.ttf'), unicodeRange: 'U+0000-024F,U+1E00-1EFF,U+2000-206F,U+20A0-20CF,U+2100-214F,U+2190-21FF,U+2C60-2C7F,U+A720-A7FF', enabled: true, fallback: false },
    { name: 'Cousine Italic', family: 'Cousine', weight: 400, style: 'italic', src: resolveLocalFontUrl('Cousine/Cousine-Italic.ttf'), unicodeRange: 'U+0000-024F,U+1E00-1EFF,U+2000-206F,U+20A0-20CF,U+2100-214F,U+2190-21FF,U+2C60-2C7F,U+A720-A7FF', enabled: true, fallback: false },
    { name: 'Cousine Bold Italic', family: 'Cousine', weight: 700, style: 'italic', src: resolveLocalFontUrl('Cousine/Cousine-BoldItalic.ttf'), unicodeRange: 'U+0000-024F,U+1E00-1EFF,U+2000-206F,U+20A0-20CF,U+2100-214F,U+2190-21FF,U+2C60-2C7F,U+A720-A7FF', enabled: true, fallback: false },

    // Courier Prime
    { name: 'Courier Prime Regular', family: 'Courier Prime', weight: 400, style: 'normal', src: resolveLocalFontUrl('CourierPrime/CourierPrime-Regular.ttf'), unicodeRange: 'U+0000-00FF', enabled: true, fallback: false },
    { name: 'Courier Prime Bold', family: 'Courier Prime', weight: 700, style: 'normal', src: resolveLocalFontUrl('CourierPrime/CourierPrime-Bold.ttf'), unicodeRange: 'U+0000-00FF', enabled: true, fallback: false },
    { name: 'Courier Prime Italic', family: 'Courier Prime', weight: 400, style: 'italic', src: resolveLocalFontUrl('CourierPrime/CourierPrime-Italic.ttf'), unicodeRange: 'U+0000-00FF', enabled: true, fallback: false },
    { name: 'Courier Prime Bold Italic', family: 'Courier Prime', weight: 700, style: 'italic', src: resolveLocalFontUrl('CourierPrime/CourierPrime-BoldItalic.ttf'), unicodeRange: 'U+0000-00FF', enabled: true, fallback: false },

    // Major Fallbacks (CJK)
    // Noto Serif SC — CJK serif family, used as primary font by mkd-zh-manuscript.
    // Registered as fallback: true (same pattern as other CJK families) so the engine
    // can also use it as a supplementary serif face in mixed-script documents. The
    // unicodeRange mirrors Noto Sans SC so the two families cover the same CJK blocks.
    { name: 'Noto Serif SC Regular', family: 'Noto Serif SC', weight: 400, style: 'normal', src: resolveLocalFontUrl('NotoSerifSC/NotoSerifSC-Regular.ttf'), unicodeRange: 'U+4E00-9FFF,U+3000-303F,U+FF00-FFEF', enabled: true, fallback: false },
    { name: 'Noto Serif SC Bold', family: 'Noto Serif SC', weight: 700, style: 'normal', src: resolveLocalFontUrl('NotoSerifSC/NotoSerifSC-Bold.ttf'), unicodeRange: 'U+4E00-9FFF,U+3000-303F,U+FF00-FFEF', enabled: true, fallback: false },
    { name: 'Noto Sans SC Regular', family: 'Noto Sans SC', weight: 400, style: 'normal', src: resolveLocalFontUrl('NotoSansSC/NotoSansSC-Regular.ttf'), unicodeRange: 'U+4E00-9FFF,U+3000-303F,U+FF00-FFEF', enabled: true, fallback: true },
    { name: 'Noto Sans SC Bold', family: 'Noto Sans SC', weight: 700, style: 'normal', src: resolveLocalFontUrl('NotoSansSC/NotoSansSC-Bold.ttf'), unicodeRange: 'U+4E00-9FFF,U+3000-303F,U+FF00-FFEF', enabled: true, fallback: true },
    { name: 'Noto Sans JP Regular', family: 'Noto Sans JP', weight: 400, style: 'normal', src: resolveLocalFontUrl('NotoSansJP/NotoSansJP-Regular.ttf'), unicodeRange: 'U+3040-309F,U+30A0-30FF', enabled: true, fallback: true },
    { name: 'Noto Sans JP Bold', family: 'Noto Sans JP', weight: 700, style: 'normal', src: resolveLocalFontUrl('NotoSansJP/NotoSansJP-Bold.ttf'), unicodeRange: 'U+3040-309F,U+30A0-30FF', enabled: true, fallback: true },
    { name: 'Noto Sans KR Regular', family: 'Noto Sans KR', weight: 400, style: 'normal', src: resolveLocalFontUrl('NotoSansKR/NotoSansKR-Regular.ttf'), unicodeRange: 'U+AC00-D7AF,U+1100-11FF,U+3130-318F,U+A960-A97F,U+D7B0-D7FF', enabled: true, fallback: true },
    { name: 'Noto Sans KR Bold', family: 'Noto Sans KR', weight: 700, style: 'normal', src: resolveLocalFontUrl('NotoSansKR/NotoSansKR-Bold.ttf'), unicodeRange: 'U+AC00-D7AF,U+1100-11FF,U+3130-318F,U+A960-A97F,U+D7B0-D7FF', enabled: true, fallback: true },

    // Middle East & India
    { name: 'Noto Sans Arabic Regular', family: 'Noto Sans Arabic', weight: 400, style: 'normal', src: resolveLocalFontUrl('NotoSansArabic/NotoSansArabic-Regular.ttf'), unicodeRange: 'U+0600-06FF,U+0750-077F,U+08A0-08FF,U+FB50-FDFF,U+FE70-FEFF', enabled: true, fallback: true },
    { name: 'Noto Sans Arabic Bold', family: 'Noto Sans Arabic', weight: 700, style: 'normal', src: resolveLocalFontUrl('NotoSansArabic/NotoSansArabic-Bold.ttf'), unicodeRange: 'U+0600-06FF,U+0750-077F,U+08A0-08FF,U+FB50-FDFF,U+FE70-FEFF', enabled: true, fallback: true },
    { name: 'Noto Sans Hebrew Regular', family: 'Noto Sans Hebrew', weight: 400, style: 'normal', src: resolveLocalFontUrl('NotoSansHebrew/NotoSansHebrew-Regular.ttf'), unicodeRange: 'U+0590-05FF', enabled: true, fallback: true },
    { name: 'Noto Sans Hebrew Bold', family: 'Noto Sans Hebrew', weight: 700, style: 'normal', src: resolveLocalFontUrl('NotoSansHebrew/NotoSansHebrew-Bold.ttf'), unicodeRange: 'U+0590-05FF', enabled: true, fallback: true },
    { name: 'Noto Sans Devanagari Regular', family: 'Noto Sans Devanagari', weight: 400, style: 'normal', src: resolveLocalFontUrl('NotoSansDevanagari/NotoSansDevanagari-Regular.ttf'), unicodeRange: 'U+0900-097F,U+A8E0-A8FF', enabled: true, fallback: true },
    { name: 'Noto Sans Bengali Regular', family: 'Noto Sans Bengali', weight: 400, style: 'normal', src: resolveLocalFontUrl('NotoSansBengali/NotoSansBengali-Regular.ttf'), unicodeRange: 'U+0980-09FF', enabled: true, fallback: true },
    { name: 'Noto Sans Tamil Regular', family: 'Noto Sans Tamil', weight: 400, style: 'normal', src: resolveLocalFontUrl('NotoSansTamil/NotoSansTamil-Regular.ttf'), unicodeRange: 'U+0B80-0BFF', enabled: true, fallback: true },
    { name: 'Noto Sans Telugu Regular', family: 'Noto Sans Telugu', weight: 400, style: 'normal', src: resolveLocalFontUrl('NotoSansTelugu/NotoSansTelugu-Regular.ttf'), unicodeRange: 'U+0C00-0C7F', enabled: true, fallback: true },
    { name: 'Noto Sans Malayalam Regular', family: 'Noto Sans Malayalam', weight: 400, style: 'normal', src: resolveLocalFontUrl('NotoSansMalayalam/NotoSansMalayalam-Regular.ttf'), unicodeRange: 'U+0D00-0D7F', enabled: true, fallback: true },
    { name: 'Noto Sans Gujarati Regular', family: 'Noto Sans Gujarati', weight: 400, style: 'normal', src: resolveLocalFontUrl('NotoSansGujarati/NotoSansGujarati-Regular.ttf'), unicodeRange: 'U+0A80-0AFF', enabled: true, fallback: true },
    { name: 'Noto Sans Kannada Regular', family: 'Noto Sans Kannada', weight: 400, style: 'normal', src: resolveLocalFontUrl('NotoSansKannada/NotoSansKannada-Regular.ttf'), unicodeRange: 'U+0C80-0CFF', enabled: true, fallback: true },
    { name: 'Noto Sans Gurmukhi Regular', family: 'Noto Sans Gurmukhi', weight: 400, style: 'normal', src: resolveLocalFontUrl('NotoSansGurmukhi/NotoSansGurmukhi-Regular.ttf'), unicodeRange: 'U+0A00-0A7F', enabled: true, fallback: true },

    // Southeast Asia
    { name: 'Noto Sans Thai Regular', family: 'Noto Sans Thai', weight: 400, style: 'normal', src: resolveLocalFontUrl('NotoSansThai/NotoSansThai-Regular.ttf'), unicodeRange: 'U+0E00-0E7F', enabled: true, fallback: true },
    { name: 'Noto Sans Thai Bold', family: 'Noto Sans Thai', weight: 700, style: 'normal', src: resolveLocalFontUrl('NotoSansThai/NotoSansThai-Bold.ttf'), unicodeRange: 'U+0E00-0E7F', enabled: true, fallback: true },
    { name: 'Noto Sans Khmer Regular', family: 'Noto Sans Khmer', weight: 400, style: 'normal', src: resolveLocalFontUrl('NotoSansKhmer/NotoSansKhmer-Regular.ttf'), unicodeRange: 'U+1780-17FF', enabled: true, fallback: true },
    { name: 'Noto Sans Lao Regular', family: 'Noto Sans Lao', weight: 400, style: 'normal', src: resolveLocalFontUrl('NotoSansLao/NotoSansLao-Regular.ttf'), unicodeRange: 'U+0E80-0EFF', enabled: true, fallback: true },
    { name: 'Noto Sans Sinhala Regular', family: 'Noto Sans Sinhala', weight: 400, style: 'normal', src: resolveLocalFontUrl('NotoSansSinhala/NotoSansSinhala-Regular.ttf'), unicodeRange: 'U+0D80-0DFF', enabled: true, fallback: true },

    // Others
    { name: 'Noto Sans Armenian Regular', family: 'Noto Sans Armenian', weight: 400, style: 'normal', src: resolveLocalFontUrl('NotoSansArmenian/NotoSansArmenian-Regular.ttf'), unicodeRange: 'U+0530-058F', enabled: true, fallback: true },
    { name: 'Noto Sans Georgian Regular', family: 'Noto Sans Georgian', weight: 400, style: 'normal', src: resolveLocalFontUrl('NotoSansGeorgian/NotoSansGeorgian-Regular.ttf'), unicodeRange: 'U+10A0-10FF', enabled: true, fallback: true },
    { name: 'Noto Sans Ethiopic Regular', family: 'Noto Sans Ethiopic', weight: 400, style: 'normal', src: resolveLocalFontUrl('NotoSansEthiopic/NotoSansEthiopic-Regular.ttf'), unicodeRange: 'U+1200-137F', enabled: true, fallback: true },

    // Symbols
    { name: 'Noto Sans Symbols 2 Regular', family: 'Noto Sans Symbols 2', weight: 400, style: 'normal', src: resolveLocalFontUrl('NotoSansSymbol/NotoSansSymbols2-Regular.ttf'), unicodeRange: 'U+2000-2BFF,U+FB00-FFFF', enabled: true, fallback: true }
];
