
export const STANDARD_FONT_MAGIC_BYTES = [0x53, 0x46, 0x4d] as const; // "SFM"
export const STANDARD_FONT_SENTINEL_VERSION = 0x01;
export const STANDARD_FONT_SENTINEL_LENGTH = 5;

export type StandardFontDefinition = {
    id: number;
    postscriptName: string;
    familyName: string;
    weight: number;
    style: 'normal' | 'italic';
};

export const STANDARD_FONT_DEFINITIONS: ReadonlyArray<StandardFontDefinition> = [
    { id: 0x00, postscriptName: 'Helvetica', familyName: 'Helvetica', weight: 400, style: 'normal' },
    { id: 0x01, postscriptName: 'Helvetica-Bold', familyName: 'Helvetica', weight: 700, style: 'normal' },
    { id: 0x02, postscriptName: 'Helvetica-Oblique', familyName: 'Helvetica', weight: 400, style: 'italic' },
    { id: 0x03, postscriptName: 'Helvetica-BoldOblique', familyName: 'Helvetica', weight: 700, style: 'italic' },
    { id: 0x04, postscriptName: 'Times-Roman', familyName: 'Times', weight: 400, style: 'normal' },
    { id: 0x05, postscriptName: 'Times-Bold', familyName: 'Times', weight: 700, style: 'normal' },
    { id: 0x06, postscriptName: 'Times-Italic', familyName: 'Times', weight: 400, style: 'italic' },
    { id: 0x07, postscriptName: 'Times-BoldItalic', familyName: 'Times', weight: 700, style: 'italic' },
    { id: 0x08, postscriptName: 'Courier', familyName: 'Courier', weight: 400, style: 'normal' },
    { id: 0x09, postscriptName: 'Courier-Bold', familyName: 'Courier', weight: 700, style: 'normal' },
    { id: 0x0a, postscriptName: 'Courier-Oblique', familyName: 'Courier', weight: 400, style: 'italic' },
    { id: 0x0b, postscriptName: 'Courier-BoldOblique', familyName: 'Courier', weight: 700, style: 'italic' },
    { id: 0x0c, postscriptName: 'Symbol', familyName: 'Symbol', weight: 400, style: 'normal' },
    { id: 0x0d, postscriptName: 'ZapfDingbats', familyName: 'ZapfDingbats', weight: 400, style: 'normal' }
] as const;

export type StandardFontId = (typeof STANDARD_FONT_DEFINITIONS)[number]['id'];
export type StandardPostscriptFontName = (typeof STANDARD_FONT_DEFINITIONS)[number]['postscriptName'];
export type StandardFontMetadata = Readonly<StandardFontDefinition>;

const STANDARD_FONT_BY_POSTSCRIPT_NAME = new Map<string, StandardFontMetadata>(
    STANDARD_FONT_DEFINITIONS.map((font) => [font.postscriptName, font])
);

export const getStandardFontMetadataByPostscriptName = (postscriptName: string): StandardFontMetadata | undefined =>
    STANDARD_FONT_BY_POSTSCRIPT_NAME.get(postscriptName);
