export const STANDARD_FONT_MAGIC_BYTES = [0x53, 0x46, 0x4d] as const; // "SFM"
export const STANDARD_FONT_SENTINEL_VERSION = 0x01;
export const STANDARD_FONT_SENTINEL_LENGTH = 5;

type StandardFontDefinition = {
    id: number;
    postscriptName: string;
    familyName: string;
    weight: number;
    style: 'normal' | 'italic';
};

const STANDARD_FONT_DEFINITIONS: ReadonlyArray<StandardFontDefinition> = [
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

const STANDARD_FONT_BY_ID = new Map<number, StandardFontMetadata>(
    STANDARD_FONT_DEFINITIONS.map((font) => [font.id, font])
);

const STANDARD_FONT_BY_POSTSCRIPT_NAME = new Map<string, StandardFontMetadata>(
    STANDARD_FONT_DEFINITIONS.map((font) => [font.postscriptName, font])
);

export const STANDARD_FONT_METADATA_KEY = '__vmprintStandardFont' as const;

const toUint8View = (buffer: ArrayBuffer | Uint8Array): Uint8Array =>
    buffer instanceof Uint8Array
        ? new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
        : new Uint8Array(buffer);

export const getStandardFontMetadataById = (fontId: number): StandardFontMetadata | undefined =>
    STANDARD_FONT_BY_ID.get(fontId);

export const getStandardFontMetadataByPostscriptName = (postscriptName: string): StandardFontMetadata | undefined =>
    STANDARD_FONT_BY_POSTSCRIPT_NAME.get(postscriptName);

export const createStandardFontSentinelBuffer = (fontId: StandardFontId): ArrayBuffer => {
    if (!STANDARD_FONT_BY_ID.has(fontId)) {
        throw new Error(`Unknown standard font ID 0x${fontId.toString(16)}.`);
    }

    const bytes = new Uint8Array(STANDARD_FONT_SENTINEL_LENGTH);
    bytes[0] = STANDARD_FONT_MAGIC_BYTES[0];
    bytes[1] = STANDARD_FONT_MAGIC_BYTES[1];
    bytes[2] = STANDARD_FONT_MAGIC_BYTES[2];
    bytes[3] = STANDARD_FONT_SENTINEL_VERSION;
    bytes[4] = fontId;
    return bytes.buffer;
};

export const parseStandardFontSentinelBuffer = (buffer: ArrayBuffer | Uint8Array): StandardFontMetadata | null => {
    const bytes = toUint8View(buffer);
    if (bytes.byteLength < STANDARD_FONT_SENTINEL_LENGTH) return null;

    if (
        bytes[0] !== STANDARD_FONT_MAGIC_BYTES[0] ||
        bytes[1] !== STANDARD_FONT_MAGIC_BYTES[1] ||
        bytes[2] !== STANDARD_FONT_MAGIC_BYTES[2]
    ) {
        return null;
    }

    if (bytes[3] !== STANDARD_FONT_SENTINEL_VERSION) return null;
    return getStandardFontMetadataById(bytes[4]) || null;
};

export const isStandardFontSentinelBuffer = (buffer: ArrayBuffer | Uint8Array): boolean =>
    parseStandardFontSentinelBuffer(buffer) !== null;

export const attachStandardFontMetadata = <T extends object>(font: T, metadata: StandardFontMetadata): T => {
    Object.defineProperty(font, STANDARD_FONT_METADATA_KEY, {
        value: metadata,
        enumerable: false,
        configurable: false,
        writable: false
    });
    return font;
};

export const getStandardFontMetadata = (font: unknown): StandardFontMetadata | undefined => {
    if (!font || typeof font !== 'object') return undefined;
    const maybe = (font as Record<string, unknown>)[STANDARD_FONT_METADATA_KEY];
    if (!maybe || typeof maybe !== 'object') return undefined;

    const postscriptName = String((maybe as Record<string, unknown>).postscriptName || '');
    if (!postscriptName) return undefined;
    return getStandardFontMetadataByPostscriptName(postscriptName);
};
