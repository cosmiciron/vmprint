import { jsPDF } from 'jspdf';
import * as fontkit from 'fontkit';
import { Buffer } from 'buffer';
import {
    Context,
    ContextFactoryOptions,
    ContextFontRegistrationOptions,
    ContextImageOptions,
    ContextShapedGlyph,
    ContextTextOptions,
    VmprintOutputStream,
    ContextPageSize,
} from '@vmprint/contracts';

// ---------------------------------------------------------------------------
// Standard-font PostScript name → jsPDF {family, fontStyle}
// The 14 built-in PDF fonts are available in jsPDF without embedding.
// ---------------------------------------------------------------------------
type JsPdfFontInfo = { family: string; fontStyle: string };

const POSTSCRIPT_TO_JSPDF: Record<string, JsPdfFontInfo> = {
    'Helvetica': { family: 'helvetica', fontStyle: 'normal' },
    'Helvetica-Bold': { family: 'helvetica', fontStyle: 'bold' },
    'Helvetica-Oblique': { family: 'helvetica', fontStyle: 'italic' },
    'Helvetica-BoldOblique': { family: 'helvetica', fontStyle: 'bolditalic' },
    'Times-Roman': { family: 'times', fontStyle: 'normal' },
    'Times-Bold': { family: 'times', fontStyle: 'bold' },
    'Times-Italic': { family: 'times', fontStyle: 'italic' },
    'Times-BoldItalic': { family: 'times', fontStyle: 'bolditalic' },
    'Courier': { family: 'courier', fontStyle: 'normal' },
    'Courier-Bold': { family: 'courier', fontStyle: 'bold' },
    'Courier-Oblique': { family: 'courier', fontStyle: 'italic' },
    'Courier-BoldOblique': { family: 'courier', fontStyle: 'bolditalic' },
    'Symbol': { family: 'symbol', fontStyle: 'normal' },
    'ZapfDingbats': { family: 'zapfdingbats', fontStyle: 'normal' },
};

const WIN_ANSI_UNICODE_TO_BYTE: Readonly<Record<number, number>> = {
    0x20ac: 128,
    0x201a: 130,
    0x0192: 131,
    0x201e: 132,
    0x2026: 133,
    0x2020: 134,
    0x2021: 135,
    0x02c6: 136,
    0x2030: 137,
    0x0160: 138,
    0x2039: 139,
    0x0152: 140,
    0x017d: 142,
    0x2018: 145,
    0x2019: 146,
    0x201c: 147,
    0x201d: 148,
    0x2022: 149,
    0x2013: 150,
    0x2014: 151,
    0x02dc: 152,
    0x2122: 153,
    0x0161: 154,
    0x203a: 155,
    0x0153: 156,
    0x017e: 158,
    0x0178: 159
};

const DINGBATS_CODE_TO_UNICODE: Readonly<Record<number, number>> = {
    0x21: 0x2701, 0x22: 0x2702, 0x23: 0x2703, 0x24: 0x2704, 0x25: 0x260e, 0x26: 0x2706,
    0x27: 0x2707, 0x28: 0x2708, 0x29: 0x2709, 0x2a: 0x261b, 0x2b: 0x261e, 0x2c: 0x270c,
    0x2d: 0x270d, 0x2e: 0x270e, 0x2f: 0x270f, 0x30: 0x2710, 0x31: 0x2711, 0x32: 0x2712,
    0x33: 0x2713, 0x34: 0x2714, 0x35: 0x2715, 0x36: 0x2716, 0x37: 0x2717, 0x38: 0x2718,
    0x39: 0x2719, 0x3a: 0x271a, 0x3b: 0x271b, 0x3c: 0x271c, 0x3d: 0x271d, 0x3e: 0x271e,
    0x3f: 0x271f, 0x40: 0x2720, 0x41: 0x2721, 0x42: 0x2722, 0x43: 0x2723, 0x44: 0x2724,
    0x45: 0x2725, 0x46: 0x2726, 0x47: 0x2727, 0x48: 0x2605, 0x49: 0x2729, 0x4a: 0x272a,
    0x4b: 0x272b, 0x4c: 0x272c, 0x4d: 0x272d, 0x4e: 0x272e, 0x4f: 0x272f, 0x50: 0x2730,
    0x51: 0x2731, 0x52: 0x2732, 0x53: 0x2733, 0x54: 0x2734, 0x55: 0x2735, 0x56: 0x2736,
    0x57: 0x2737, 0x58: 0x2738, 0x59: 0x2739, 0x5a: 0x273a, 0x5b: 0x273b, 0x5c: 0x273c,
    0x5d: 0x273d, 0x5e: 0x273e, 0x5f: 0x273f, 0x60: 0x2740, 0x61: 0x2741, 0x62: 0x2742,
    0x63: 0x2743, 0x64: 0x2744, 0x65: 0x2745, 0x66: 0x2746, 0x67: 0x2747, 0x68: 0x2748,
    0x69: 0x2749, 0x6a: 0x274a, 0x6b: 0x274b, 0x6c: 0x25cf, 0x6d: 0x274d, 0x6e: 0x25a0,
    0x6f: 0x274f, 0x70: 0x2750, 0x71: 0x2751, 0x72: 0x2752, 0x73: 0x25b2, 0x74: 0x25bc,
    0x75: 0x25c6, 0x76: 0x2756, 0x77: 0x25d7, 0x78: 0x2758, 0x79: 0x2759, 0x7a: 0x275a,
    0x7b: 0x275b, 0x7c: 0x275c, 0x7d: 0x275d, 0x7e: 0x275e, 0x80: 0x2768, 0x81: 0x2769,
    0x82: 0x276a, 0x83: 0x276b, 0x84: 0x276c, 0x85: 0x276d, 0x86: 0x276e, 0x87: 0x276f,
    0x88: 0x2770, 0x89: 0x2771, 0x8a: 0x2772, 0x8b: 0x2773, 0x8c: 0x2774, 0x8d: 0x2775,
    0xa1: 0x2761, 0xa2: 0x2762, 0xa3: 0x2763, 0xa4: 0x2764, 0xa5: 0x2765, 0xa6: 0x2766,
    0xa7: 0x2767, 0xa8: 0x2663, 0xa9: 0x2666, 0xaa: 0x2665, 0xab: 0x2660, 0xac: 0x2460,
    0xad: 0x2461, 0xae: 0x2462, 0xaf: 0x2463, 0xb0: 0x2464, 0xb1: 0x2465, 0xb2: 0x2466,
    0xb3: 0x2467, 0xb4: 0x2468, 0xb5: 0x2469, 0xb6: 0x2776, 0xb7: 0x2777, 0xb8: 0x2778,
    0xb9: 0x2779, 0xba: 0x277a, 0xbb: 0x277b, 0xbc: 0x277c, 0xbd: 0x277d, 0xbe: 0x277e,
    0xbf: 0x277f, 0xc0: 0x2780, 0xc1: 0x2781, 0xc2: 0x2782, 0xc3: 0x2783, 0xc4: 0x2784,
    0xc5: 0x2785, 0xc6: 0x2786, 0xc7: 0x2787, 0xc8: 0x2788, 0xc9: 0x2789, 0xca: 0x278a,
    0xcb: 0x278b, 0xcc: 0x278c, 0xcd: 0x278d, 0xce: 0x278e, 0xcf: 0x278f, 0xd0: 0x2790,
    0xd1: 0x2791, 0xd2: 0x2792, 0xd3: 0x2793, 0xd4: 0x2794, 0xd5: 0x2192, 0xd6: 0x2194,
    0xd7: 0x2195, 0xd8: 0x2798, 0xd9: 0x2799, 0xda: 0x279a, 0xdb: 0x279b, 0xdc: 0x279c,
    0xdd: 0x279d, 0xde: 0x279e, 0xdf: 0x279f, 0xe0: 0x27a0, 0xe1: 0x27a1, 0xe2: 0x27a2,
    0xe3: 0x27a3, 0xe4: 0x27a4, 0xe5: 0x27a5, 0xe6: 0x27a6, 0xe7: 0x27a7, 0xe8: 0x27a8,
    0xe9: 0x27a9, 0xea: 0x27aa, 0xeb: 0x27ab, 0xec: 0x27ac, 0xed: 0x27ad, 0xee: 0x27ae,
    0xef: 0x27af, 0xf1: 0x27b1, 0xf2: 0x27b2, 0xf3: 0x27b3, 0xf4: 0x27b4, 0xf5: 0x27b5,
    0xf6: 0x27b6, 0xf7: 0x27b7, 0xf8: 0x27b8, 0xf9: 0x27b9, 0xfa: 0x27ba, 0xfb: 0x27bb,
    0xfc: 0x27bc, 0xfd: 0x27bd, 0xfe: 0x27be
};

const SYMBOL_CODE_TO_UNICODE: Readonly<Record<number, number>> = {
    32: 0x0020, 33: 0x0021, 34: 0x2200, 35: 0x0023, 36: 0x2203, 37: 0x0025, 38: 0x0026,
    39: 0x220d, 40: 0x0028, 41: 0x0029, 42: 0x2217, 43: 0x002b, 44: 0x002c, 45: 0x2212,
    46: 0x002e, 47: 0x002f, 48: 0x0030, 49: 0x0031, 50: 0x0032, 51: 0x0033, 52: 0x0034,
    53: 0x0035, 54: 0x0036, 55: 0x0037, 56: 0x0038, 57: 0x0039, 58: 0x003a, 59: 0x003b,
    60: 0x003c, 61: 0x003d, 62: 0x003e, 63: 0x003f, 64: 0x2245, 65: 0x0391, 66: 0x0392,
    67: 0x03a7, 68: 0x0394, 69: 0x0395, 70: 0x03a6, 71: 0x0393, 72: 0x0397, 73: 0x0399,
    74: 0x03d1, 75: 0x039a, 76: 0x039b, 77: 0x039c, 78: 0x039d, 79: 0x039f, 80: 0x03a0,
    81: 0x0398, 82: 0x03a1, 83: 0x03a3, 84: 0x03a4, 85: 0x03a5, 86: 0x03c2, 87: 0x03a9,
    88: 0x039e, 89: 0x03a8, 90: 0x0396, 91: 0x005b, 92: 0x2234, 93: 0x005d, 94: 0x22a5,
    95: 0x005f, 96: 0xf8e5, 97: 0x03b1, 98: 0x03b2, 99: 0x03c7, 100: 0x03b4, 101: 0x03b5,
    102: 0x03c6, 103: 0x03b3, 104: 0x03b7, 105: 0x03b9, 106: 0x03d5, 107: 0x03ba,
    108: 0x03bb, 109: 0x03bc, 110: 0x03bd, 111: 0x03bf, 112: 0x03c0, 113: 0x03b8,
    114: 0x03c1, 115: 0x03c3, 116: 0x03c4, 117: 0x03c5, 118: 0x03d6, 119: 0x03c9,
    120: 0x03be, 121: 0x03c8, 122: 0x03b6, 123: 0x007b, 124: 0x007c, 125: 0x007d,
    126: 0x223c, 161: 0x03d2, 162: 0x2032, 163: 0x2264, 164: 0x2044, 165: 0x221e,
    166: 0x0192, 167: 0x2663, 168: 0x2666, 169: 0x2665, 170: 0x2660, 171: 0x2194,
    172: 0x2190, 173: 0x2191, 174: 0x2192, 175: 0x2193, 176: 0x00b0, 177: 0x00b1,
    178: 0x2033, 179: 0x2265, 180: 0x00d7, 181: 0x221d, 182: 0x2202, 183: 0x2022,
    184: 0x00f7, 185: 0x2260, 186: 0x2261, 187: 0x2248, 188: 0x2026, 189: 0xf8e6,
    190: 0xf8e7, 191: 0x21b5, 192: 0x2135, 193: 0x2111, 194: 0x211c, 195: 0x2118,
    196: 0x2297, 197: 0x2295, 198: 0x2205, 199: 0x2229, 200: 0x222a, 201: 0x2283,
    202: 0x2287, 203: 0x2284, 204: 0x2282, 205: 0x2286, 206: 0x2208, 207: 0x2209,
    208: 0x2220, 209: 0x2207, 210: 0x00ae, 211: 0x00a9, 212: 0x2122, 213: 0x220f,
    214: 0x221a, 215: 0x22c5, 216: 0x00ac, 217: 0x2227, 218: 0x2228, 219: 0x21d4,
    220: 0x21d0, 221: 0x21d1, 222: 0x21d2, 223: 0x21d3, 224: 0x25ca, 225: 0x3008,
    226: 0x00ae, 227: 0x00a9, 228: 0x2122, 229: 0x2211, 230: 0xf8eb, 231: 0xf8ec,
    232: 0xf8ed, 233: 0xf8ee, 234: 0xf8ef, 235: 0xf8f0, 236: 0xf8f1, 237: 0xf8f2,
    238: 0xf8f3, 239: 0xf8f4, 241: 0x3009, 242: 0x222b, 243: 0x2320, 244: 0xf8f5,
    245: 0x2321, 246: 0xf8f6, 247: 0xf8f7, 248: 0xf8f8, 249: 0xf8f9, 250: 0xf8fa,
    251: 0xf8fb, 252: 0xf8fc, 253: 0xf8fd, 254: 0xf8fe
};

const WIN_ANSI_FONTS = new Set([
    'Helvetica',
    'Helvetica-Bold',
    'Helvetica-Oblique',
    'Helvetica-BoldOblique',
    'Times-Roman',
    'Times-Bold',
    'Times-Italic',
    'Times-BoldItalic',
    'Courier',
    'Courier-Bold',
    'Courier-Oblique',
    'Courier-BoldOblique'
]);

function reverseMap(input: Readonly<Record<number, number>>): Readonly<Record<number, number>> {
    const out: Record<number, number> = {};
    for (const [byteString, codePoint] of Object.entries(input)) {
        const byte = Number(byteString);
        if (out[codePoint] === undefined) {
            out[codePoint] = byte;
        }
    }
    return out;
}

const SYMBOL_UNICODE_TO_BYTE = reverseMap(SYMBOL_CODE_TO_UNICODE);
const DINGBATS_UNICODE_TO_BYTE = reverseMap(DINGBATS_CODE_TO_UNICODE);

function encodeSupportedStandardFontByte(postscriptName: string, codePoint: number): number | undefined {
    if (WIN_ANSI_FONTS.has(postscriptName)) {
        const mapped = WIN_ANSI_UNICODE_TO_BYTE[codePoint];
        if (mapped !== undefined) return mapped;
        if (codePoint >= 0x20 && codePoint <= 0x7e) return codePoint;
        if (codePoint >= 0xa0 && codePoint <= 0xff) return codePoint;
        return undefined;
    }
    if (postscriptName === 'Symbol') {
        return SYMBOL_UNICODE_TO_BYTE[codePoint];
    }
    if (postscriptName === 'ZapfDingbats') {
        return DINGBATS_UNICODE_TO_BYTE[codePoint];
    }
    return undefined;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolvePageFormat(size: ContextPageSize): string | number[] {
    if (typeof size === 'string') {
        return size.toLowerCase();
    }
    if (Array.isArray(size)) {
        return size;
    }
    return [size.width, size.height];
}

/**
 * Derive jsPDF orientation from the page size.
 * Named string sizes default to portrait.
 * For explicit dimensions, width > height means landscape.
 */
function resolveOrientation(size: ContextPageSize): 'portrait' | 'landscape' {
    if (typeof size === 'string') return 'portrait';
    const w = Array.isArray(size) ? size[0] : size.width;
    const h = Array.isArray(size) ? size[1] : size.height;
    return w > h ? 'landscape' : 'portrait';
}

/**
 * Parses a CSS color string to [r, g, b] in 0–255 range.
 * Handles '#RRGGBB', '#RGB', and a handful of named colors.
 * Unknown strings fall back to black.
 */
function parseColor(color: string): [number, number, number] {
    const s = (color ?? '').trim();
    if (s.startsWith('#')) {
        if (s.length === 7) {
            return [
                parseInt(s.slice(1, 3), 16),
                parseInt(s.slice(3, 5), 16),
                parseInt(s.slice(5, 7), 16),
            ];
        }
        if (s.length === 4) {
            return [
                parseInt(s[1] + s[1], 16),
                parseInt(s[2] + s[2], 16),
                parseInt(s[3] + s[3], 16),
            ];
        }
    }
    const named: Record<string, [number, number, number]> = {
        black: [0, 0, 0], white: [255, 255, 255],
        red: [255, 0, 0], green: [0, 128, 0], blue: [0, 0, 255],
        gray: [128, 128, 128], grey: [128, 128, 128],
        silver: [192, 192, 192],
    };
    return named[s.toLowerCase()] ?? [0, 0, 0];
}

function mimeToImageFormat(mimeType?: string): string {
    const m = (mimeType ?? '').toLowerCase();
    if (m.includes('png')) return 'PNG';
    if (m.includes('gif')) return 'GIF';
    if (m.includes('bmp')) return 'BMP';
    if (m.includes('webp')) return 'WEBP';
    return 'JPEG';
}

function shapedGlyphsToText(glyphs: ContextShapedGlyph[]): string {
    const chars: string[] = [];
    for (const glyph of glyphs) {
        for (const cp of glyph.codePoints ?? []) {
            if (Number.isFinite(cp) && cp > 0) {
                chars.push(String.fromCodePoint(cp));
            }
        }
    }
    return chars.join('');
}

function isRtlScript(text: string): boolean {
    // Basic check for Arabic, Hebrew, and other RTL ranges.
    return /[\u0590-\u05FF\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/.test(text);
}

// ---------------------------------------------------------------------------
// PdfLiteContext
// ---------------------------------------------------------------------------

/**
 * A lightweight PDF rendering context backed by jsPDF.
 *
 * Architecture notes
 * ------------------
 * • jsPDF does not stream output — the complete PDF is generated at end().
 *   pipe() stores the VmprintOutputStream reference; end() writes the full
 *   ArrayBuffer to it in one shot.
 *
 * • jsPDF always opens the first page automatically. The renderer calls
 *   addPage() for every page including the first, so the first call is a
 *   no-op here.
 *
 * • Standard-font handling mirrors the PDFKit context exactly: when
 *   registerFont() receives a standardFontPostScriptName, the font id is
 *   mapped to the corresponding jsPDF built-in name and no binary data is
 *   registered. Custom fonts are base64-encoded and registered via
 *   addFileToVFS / addFont.
 *
 * • Transforms (translate, rotate) and graphics state (save, restore,
 *   opacity) are delegated to jsPDF's setCurrentTransformationMatrix /
 *   saveGraphicsState / restoreGraphicsState / setGState. jsPDF sets up an
 *   initial page CTM that flips the y-axis so that all subsequent cm
 *   operators (and these helpers) operate in the same y-down user space
 *   that the PDFKit context exposes.
 *
 * • Path building (moveTo / lineTo / bezierCurveTo / rect / roundedRect)
 *   uses jsPDF's public path API. fill() / stroke() / fillAndStroke() close
 *   the path and paint it. The rounded-rect approximation uses cubic Bézier
 *   curves at k ≈ 0.5523 (the standard quarter-circle approximation).
 */
export class PdfLiteContext implements Context {
    private readonly doc: jsPDF;
    private readonly pageWidth: number;
    private readonly pageHeight: number;

    /** Maps engine font-id → jsPDF {family, fontStyle}. */
    private readonly fontInfoById = new Map<string, JsPdfFontInfo>();
    private readonly standardPostscriptNameById = new Map<string, string>();
    private readonly fontkitFonts = new Map<string, any>();

    private pagesAdded = 0;
    private outputStream: VmprintOutputStream | null = null;
    private isEnded = false;

    constructor(options: ContextFactoryOptions) {
        const format = resolvePageFormat(options.size);
        this.doc = new jsPDF({
            unit: 'pt',
            format: format as any,
            orientation: resolveOrientation(options.size),
            compress: true,
            putOnlyUsedFonts: true,
        });
        const ps = this.doc.internal.pageSize;
        this.pageWidth = typeof ps.getWidth === 'function' ? ps.getWidth() : (ps as any).width;
        this.pageHeight = typeof ps.getHeight === 'function' ? ps.getHeight() : (ps as any).height;
    }

    // -------------------------------------------------------------------------
    // Document lifecycle
    // -------------------------------------------------------------------------

    addPage(): void {
        if (this.pagesAdded === 0) {
            // jsPDF always opens one page in the constructor; consume it.
            this.pagesAdded = 1;
            return;
        }
        this.doc.addPage();
        this.pagesAdded++;
    }

    pipe(stream: VmprintOutputStream): void {
        // jsPDF cannot stream incrementally; store the destination for end().
        this.outputStream = stream;
    }

    end(): void {
        if (this.isEnded) return;
        this.isEnded = true;
        const buf = this.doc.output('arraybuffer');
        if (this.outputStream) {
            this.outputStream.write(new Uint8Array(buf));
            this.outputStream.end();
        }
    }

    // -------------------------------------------------------------------------
    // Font management
    // -------------------------------------------------------------------------

    async registerFont(
        id: string,
        buffer: Uint8Array,
        options?: ContextFontRegistrationOptions
    ): Promise<void> {
        if (options?.standardFontPostScriptName) {
            // Standard font: map to jsPDF built-in; no binary registration needed.
            const jsPdfFont = POSTSCRIPT_TO_JSPDF[options.standardFontPostScriptName]
                ?? { family: 'helvetica', fontStyle: 'normal' };
            this.fontInfoById.set(id, jsPdfFont);
            this.standardPostscriptNameById.set(id, options.standardFontPostScriptName);
            return;
        }
        this.standardPostscriptNameById.delete(id);

        // Custom font: base64-encode and register with jsPDF's virtual file-system.
        // Identity-H encoding is required to activate jsPDF's built-in subsetter:
        // it collects used glyph IDs via pdfEscape16 and encodes only those glyphs
        // at output time via font.metadata.subset.encode(glyIdsUsed).
        try {
            const fontBuffer = Buffer.from(buffer);
            const base64 = fontBuffer.toString('base64');
            const filename = `${id}.ttf`;
            this.doc.addFileToVFS(filename, base64);
            this.doc.addFont(filename, id, 'normal', 400, 'Identity-H');
            this.fontInfoById.set(id, { family: id, fontStyle: 'normal' });

            // Store fontkit object for path drawing (SVG approach for bidi/shaped text).
            const fkFont = fontkit.create(fontBuffer);
            this.fontkitFonts.set(id, fkFont);
        } catch (e: unknown) {
            throw new Error(`[PdfLiteContext] Failed to register font "${id}": ${String(e)}`);
        }
    }

    private sanitizeStandardFontText(str: string): string {
        const currentFont = this.doc.getFont();
        const postscriptName = [...this.standardPostscriptNameById.values()].find((value) => {
            const info = POSTSCRIPT_TO_JSPDF[value];
            return info?.family === currentFont.fontName && info?.fontStyle === currentFont.fontStyle;
        });

        if (!postscriptName) return str;
        const bytes: number[] = [];
        for (const character of str || '') {
            const codePoint = character.codePointAt(0);
            if (codePoint === undefined) continue;
            const encodedByte = encodeSupportedStandardFontByte(postscriptName, codePoint) ?? 0x20;
            bytes.push(encodedByte);
        }
        return String.fromCharCode(...bytes);
    }

    font(family: string, size?: number): this {
        // Look up by engine font id first, then fall back to a direct PostScript
        // name lookup (overlay scripts pass names like 'Helvetica-Bold' directly,
        // which jsPDF doesn't recognise — it uses lowercase 'helvetica'/'bold').
        const info = this.fontInfoById.get(family) ?? POSTSCRIPT_TO_JSPDF[family];
        if (info) {
            this.doc.setFont(info.family, info.fontStyle);
        } else {
            this.doc.setFont(family);
        }
        if (size !== undefined) {
            this.doc.setFontSize(size);
        }
        return this;
    }

    fontSize(size: number): this {
        this.doc.setFontSize(size);
        return this;
    }

    // -------------------------------------------------------------------------
    // Graphics state
    // -------------------------------------------------------------------------

    save(): void {
        this.doc.saveGraphicsState();
    }

    restore(): void {
        this.doc.restoreGraphicsState();
    }

    /**
     * Concatenates a matrix to the current transformation matrix.
     * jsPDF sets up an initial y-flip CTM at page start, so [a b c d e f]
     * here is in the same y-down user space as the PDFKit context.
     */
    private applyTransform(
        a: number, b: number,
        c: number, d: number,
        e: number, f: number
    ): void {
        const doc = this.doc as any;
        if (typeof doc.Matrix === 'function') {
            this.doc.setCurrentTransformationMatrix(doc.Matrix(a, b, c, d, e, f));
        } else if (typeof doc.setCurrentTransformationMatrix === 'function') {
            // Fallback: write cm directly if Matrix factory is unavailable.
            doc.internal?.write?.(`${a} ${b} ${c} ${d} ${e} ${f} cm`);
        }
    }

    translate(x: number, y: number): this {
        this.applyTransform(1, 0, 0, 1, x, y);
        return this;
    }

    rotate(angle: number, originX?: number, originY?: number): this {
        const rad = (angle * Math.PI) / 180;
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);
        const ox = originX ?? 0;
        const oy = originY ?? 0;
        // Rotation matrix in y-down user space (matches PDFKit's convention).
        this.applyTransform(
            cos, sin, -sin, cos,
            ox - ox * cos + oy * sin,
            oy - ox * sin - oy * cos
        );
        return this;
    }

    opacity(opacity: number): this {
        const doc = this.doc as any;
        if (typeof doc.GState === 'function') {
            this.doc.setGState(doc.GState({ opacity, 'stroke-opacity': opacity }));
        }
        return this;
    }

    // -------------------------------------------------------------------------
    // Color and line style
    // -------------------------------------------------------------------------

    fillColor(color: string): this {
        const [r, g, b] = parseColor(color);
        this.doc.setFillColor(r, g, b);
        // jsPDF separates shape-fill color from text color; keep them in sync.
        this.doc.setTextColor(r, g, b);
        return this;
    }

    strokeColor(color: string): this {
        const [r, g, b] = parseColor(color);
        this.doc.setDrawColor(r, g, b);
        return this;
    }

    lineWidth(width: number): this {
        this.doc.setLineWidth(width);
        return this;
    }

    dash(length: number, options?: { space: number }): this {
        const space = options?.space ?? length;
        (this.doc as any).setLineDash?.([length, space], 0);
        return this;
    }

    undash(): this {
        (this.doc as any).setLineDash?.([], 0);
        return this;
    }

    // -------------------------------------------------------------------------
    // Path construction
    // -------------------------------------------------------------------------

    moveTo(x: number, y: number): this {
        this.doc.moveTo(x, y);
        return this;
    }

    lineTo(x: number, y: number): this {
        this.doc.lineTo(x, y);
        return this;
    }

    bezierCurveTo(
        cp1x: number, cp1y: number,
        cp2x: number, cp2y: number,
        x: number, y: number
    ): this {
        this.doc.curveTo(cp1x, cp1y, cp2x, cp2y, x, y);
        return this;
    }

    circle(x: number, y: number, r: number): this {
        this.doc.circle(x, y, r, null);
        return this;
    }

    rect(x: number, y: number, w: number, h: number): this {
        this.doc.moveTo(x, y);
        this.doc.lineTo(x + w, y);
        this.doc.lineTo(x + w, y + h);
        this.doc.lineTo(x, y + h);
        (this.doc as any).close();
        return this;
    }

    // Cubic Bézier approximation constant for a quarter-circle arc.
    private static readonly K = 0.5522848;

    roundedRect(x: number, y: number, w: number, h: number, r: number): this {
        const k = PdfLiteContext.K * r;
        this.doc.moveTo(x + r, y);
        this.doc.lineTo(x + w - r, y);
        this.doc.curveTo(x + w - r + k, y, x + w, y + r - k, x + w, y + r);
        this.doc.lineTo(x + w, y + h - r);
        this.doc.curveTo(x + w, y + h - r + k, x + w - r + k, y + h, x + w - r, y + h);
        this.doc.lineTo(x + r, y + h);
        this.doc.curveTo(x + r - k, y + h, x, y + h - r + k, x, y + h - r);
        this.doc.lineTo(x, y + r);
        this.doc.curveTo(x, y + r - k, x + r - k, y, x + r, y);
        (this.doc as any).close();
        return this;
    }

    clip(rule?: 'nonzero' | 'evenodd'): this {
        if (rule === 'evenodd') {
            this.doc.clipEvenOdd();
        } else {
            this.doc.clip();
        }
        this.doc.discardPath();
        return this;
    }

    // -------------------------------------------------------------------------
    // Path painting
    // -------------------------------------------------------------------------

    fill(rule?: 'nonzero' | 'evenodd'): this {
        if (rule === 'evenodd' && typeof (this.doc as any).fillEvenOdd === 'function') {
            (this.doc as any).fillEvenOdd();
        } else {
            this.doc.fill();
        }
        return this;
    }

    stroke(): this {
        this.doc.stroke();
        return this;
    }

    fillAndStroke(fillColor?: string, strokeColor?: string): this {
        if (fillColor) {
            const [r, g, b] = parseColor(fillColor);
            this.doc.setFillColor(r, g, b);
        }
        if (strokeColor) {
            const [r, g, b] = parseColor(strokeColor);
            this.doc.setDrawColor(r, g, b);
        }
        this.doc.fillStroke();
        return this;
    }

    // -------------------------------------------------------------------------
    // Text
    // -------------------------------------------------------------------------

    text(str: string, x: number, y: number, options?: ContextTextOptions): this {
        const effectiveText = this.sanitizeStandardFontText(str);

        // Apply character spacing if provided.
        const charSpacing = options?.characterSpacing;
        if (charSpacing !== undefined) {
            (this.doc as any).setCharSpace?.(charSpacing);
        }

        const textOpts: Record<string, unknown> = {};
        if (options?.align) textOpts['align'] = options.align;
        // Do NOT pass width as maxWidth — the engine pre-measures every segment;
        // allowing jsPDF to re-wrap would break the layout.

        // Baseline alignment:
        // The engine always supplies `ascent` (0–1000 normalized) on every
        // context.text() call.  jsPDF's default text anchor is the alphabetic
        // baseline (y = baseline), whereas the engine passes y = top of em box.
        // Shift y down by (ascent/1000 * fontSize) to align the baseline.
        const jsPdfY = y + ((options?.ascent ?? 0) / 1000) * this.doc.getFontSize();

        this.doc.text(effectiveText, x, jsPdfY, textOpts as any);

        if (charSpacing !== undefined) {
            (this.doc as any).setCharSpace?.(0);
        }
        return this;
    }

    showShapedGlyphs(
        fontId: string,
        fontSize: number,
        color: string,
        x: number,
        y: number,
        ascent: number,
        glyphs: ContextShapedGlyph[]
    ): this {
        if (!glyphs || glyphs.length === 0) return this;

        // Implementation choice: for simple text (like Latin), we still want to use
        // PDF text operators where possible (lite and searchable). However, for
        // bidi/RTL text where per-glyph positioning is critical, we use the "SVG approach":
        // drawing glyph paths directly into the PDF. This mirrors the canvas context behavior.
        const fkFont = this.fontkitFonts.get(fontId);
        const reconstructedText = shapedGlyphsToText(glyphs);
        const containsBidi = isRtlScript(reconstructedText); // Or check for other RTL scripts

        if (fkFont && containsBidi) {
            return this.drawShapedGlyphsAsPaths(fontId, fontSize, color, x, y, ascent, glyphs);
        }

        // Fallback or lightweight mode: Rebuild a Unicode string and let jsPDF handle it.
        if (!reconstructedText) return this;

        this.font(fontId, fontSize);
        this.fillColor(color);

        const docAny = this.doc as any;
        const arabic = containsBidi;
        const previousR2L = typeof docAny.getR2L === 'function' ? docAny.getR2L() : undefined;

        let text = reconstructedText;
        const textOpts: Record<string, unknown> = {};
        if (arabic) {
            textOpts['isInputRtl'] = true;
            textOpts['isOutputRtl'] = true;
            textOpts['isSymmetricSwapping'] = true;
            if (typeof docAny.processArabic === 'function') {
                text = docAny.processArabic(text);
            }
        }

        const jsPdfY = y + (ascent / 1000) * fontSize;

        try {
            if (arabic && typeof docAny.setR2L === 'function') {
                docAny.setR2L(true);
            }
            this.doc.text(text, x, jsPdfY, textOpts as any);
        } finally {
            if (typeof previousR2L === 'boolean' && typeof docAny.setR2L === 'function') {
                docAny.setR2L(previousR2L);
            }
        }

        return this;
    }

    private drawShapedGlyphsAsPaths(
        fontId: string,
        fontSize: number,
        color: string,
        x: number,
        y: number,
        ascent: number,
        glyphs: ContextShapedGlyph[]
    ): this {
        const fkFont = this.fontkitFonts.get(fontId);
        if (!fkFont) return this;

        this.fillColor(color);

        const upm = fkFont.unitsPerEm || 1000;
        const scale = fontSize / upm;
        const baselineY = y + (ascent / 1000) * fontSize;
        const docAny = this.doc as any;
        const write = typeof docAny.internal?.write === 'function'
            ? (segment: string) => docAny.internal.write(segment)
            : null;
        if (!write) return this;

        const format = (value: number): string => Number(value.toFixed(6)).toString();
        const mapPoint = (px: number, py: number, tx: number, ty: number): [number, number] => {
            const userX = tx + scale * px;
            const userY = ty - scale * py;
            return [userX, this.pageHeight - userY];
        };

        let penX = 0;
        for (const sg of glyphs) {
            const glyph = fkFont.getGlyph(sg.id);
            if (glyph?.path) {
                const tx = x + penX + (sg.xOffset || 0);
                const ty = baselineY - (sg.yOffset || 0);

                let curX = 0;
                let curY = 0;
                for (const cmd of glyph.path.commands) {
                    const name = (cmd as any).command ?? (cmd as any).type;
                    const args = (cmd as any).args ?? [];
                    switch (name) {
                        case 'moveTo':
                        case 'M': {
                            const [px, py] = args.length ? args : [(cmd as any).x, (cmd as any).y];
                            const [mx, my] = mapPoint(px, py, tx, ty);
                            write(`${format(mx)} ${format(my)} m`);
                            curX = px; curY = py;
                            break;
                        }
                        case 'lineTo':
                        case 'L': {
                            const [px, py] = args.length ? args : [(cmd as any).x, (cmd as any).y];
                            const [lx, ly] = mapPoint(px, py, tx, ty);
                            write(`${format(lx)} ${format(ly)} l`);
                            curX = px; curY = py;
                            break;
                        }
                        case 'quadraticCurveTo':
                        case 'Q': {
                            const [qcx, qcy, px, py] = args.length
                                ? args
                                : [(cmd as any).cp1x, (cmd as any).cp1y, (cmd as any).x, (cmd as any).y];
                            // Quadratic to cubic Bezier conversion for jsPDF.
                            const cp1x = curX + (2 / 3) * (qcx - curX);
                            const cp1y = curY + (2 / 3) * (qcy - curY);
                            const cp2x = px + (2 / 3) * (qcx - px);
                            const cp2y = py + (2 / 3) * (qcy - py);
                            const [c1x, c1y] = mapPoint(cp1x, cp1y, tx, ty);
                            const [c2x, c2y] = mapPoint(cp2x, cp2y, tx, ty);
                            const [ex, ey] = mapPoint(px, py, tx, ty);
                            write(`${format(c1x)} ${format(c1y)} ${format(c2x)} ${format(c2y)} ${format(ex)} ${format(ey)} c`);
                            curX = px; curY = py;
                            break;
                        }
                        case 'bezierCurveTo':
                        case 'C': {
                            const [cp1x, cp1y, cp2x, cp2y, px, py] = args.length
                                ? args
                                : [(cmd as any).cp1x, (cmd as any).cp1y, (cmd as any).cp2x, (cmd as any).cp2y, (cmd as any).x, (cmd as any).y];
                            const [c1x, c1y] = mapPoint(cp1x, cp1y, tx, ty);
                            const [c2x, c2y] = mapPoint(cp2x, cp2y, tx, ty);
                            const [ex, ey] = mapPoint(px, py, tx, ty);
                            write(`${format(c1x)} ${format(c1y)} ${format(c2x)} ${format(c2y)} ${format(ex)} ${format(ey)} c`);
                            curX = px; curY = py;
                            break;
                        }
                        case 'closePath':
                        case 'Z':
                            write('h');
                            break;
                    }
                }
                write('f');
            }
            penX += sg.xAdvance || 0;
        }

        return this;
    }

    // -------------------------------------------------------------------------
    // Images
    // -------------------------------------------------------------------------

    image(source: string | Uint8Array, x: number, y: number, options?: ContextImageOptions): this {
        const format = mimeToImageFormat(options?.mimeType);
        const w = options?.width ?? 0;
        const h = options?.height ?? 0;
        try {
            if (typeof source === 'string') {
                this.doc.addImage(source, format, x, y, w, h);
            } else {
                const base64 = Buffer.from(source).toString('base64');
                const dataUrl = `data:${options?.mimeType ?? 'image/jpeg'};base64,${base64}`;
                this.doc.addImage(dataUrl, format, x, y, w, h);
            }
        } catch {
            // Image embedding failures are non-fatal for the lite context.
        }
        return this;
    }

    // -------------------------------------------------------------------------
    // Page dimensions
    // -------------------------------------------------------------------------

    getSize(): { width: number; height: number } {
        return { width: this.pageWidth, height: this.pageHeight };
    }
}

export default PdfLiteContext;
