/**
 * Regenerates afm-tables.ts keyed by Unicode codepoint.
 * Run from repo root: node engine/src/font-management/generate-afm-tables.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AFM_DIR = path.resolve(__dirname, '../../../node_modules/pdfkit/js/data');
const OUT_FILE = path.resolve(__dirname, 'afm-tables.ts');

// Compact Adobe Glyph List for glyphs that appear in the standard 14 AFM files.
// glyph name → Unicode codepoint (decimal).
// Sources: Adobe Glyph List specification + Unicode standard.
const AGL = {
    // ASCII punctuation / symbols
    space: 32, exclam: 33, quotedbl: 34, numbersign: 35, dollar: 36,
    percent: 37, ampersand: 38, quoteright: 39, parenleft: 40, parenright: 41,
    asterisk: 42, plus: 43, comma: 44, hyphen: 45, period: 46, slash: 47,
    colon: 58, semicolon: 59, less: 60, equal: 61, greater: 62, question: 63,
    at: 64, bracketleft: 91, backslash: 92, bracketright: 93, asciicircum: 94,
    underscore: 95, quoteleft: 96, braceleft: 123, bar: 124, braceright: 125,
    asciitilde: 126,
    // Digits
    zero: 48, one: 49, two: 50, three: 51, four: 52,
    five: 53, six: 54, seven: 55, eight: 56, nine: 57,
    // Uppercase letters A-Z
    A: 65, B: 66, C: 67, D: 68, E: 69, F: 70, G: 71, H: 72, I: 73, J: 74,
    K: 75, L: 76, M: 77, N: 78, O: 79, P: 80, Q: 81, R: 82, S: 83, T: 84,
    U: 85, V: 86, W: 87, X: 88, Y: 89, Z: 90,
    // Lowercase letters a-z
    a: 97, b: 98, c: 99, d: 100, e: 101, f: 102, g: 103, h: 104, i: 105,
    j: 106, k: 107, l: 108, m: 109, n: 110, o: 111, p: 112, q: 113, r: 114,
    s: 115, t: 116, u: 117, v: 118, w: 119, x: 120, y: 121, z: 122,
    // Latin-1 supplement (U+00A0–U+00FF)
    nbspace: 160, exclamdown: 161, cent: 162, sterling: 163, currency: 164,
    yen: 165, brokenbar: 166, section: 167, dieresis: 168, copyright: 169,
    ordfeminine: 170, guillemotleft: 171, logicalnot: 172, softhyphen: 173,
    registered: 174, macron: 175, degree: 176, plusminus: 177, twosuperior: 178,
    threesuperior: 179, acute: 180, mu: 181, paragraph: 182, periodcentered: 183,
    cedilla: 184, onesuperior: 185, ordmasculine: 186, guillemotright: 187,
    onequarter: 188, onehalf: 189, threequarters: 190, questiondown: 191,
    Agrave: 192, Aacute: 193, Acircumflex: 194, Atilde: 195, Adieresis: 196,
    Aring: 197, AE: 198, Ccedilla: 199, Egrave: 200, Eacute: 201,
    Ecircumflex: 202, Edieresis: 203, Igrave: 204, Iacute: 205, Icircumflex: 206,
    Idieresis: 207, Eth: 208, Ntilde: 209, Ograve: 210, Oacute: 211,
    Ocircumflex: 212, Otilde: 213, Odieresis: 214, multiply: 215, Oslash: 216,
    Ugrave: 217, Uacute: 218, Ucircumflex: 219, Udieresis: 220, Yacute: 221,
    Thorn: 222, germandbls: 223, agrave: 224, aacute: 225, acircumflex: 226,
    atilde: 227, adieresis: 228, aring: 229, ae: 230, ccedilla: 231, egrave: 232,
    eacute: 233, ecircumflex: 234, edieresis: 235, igrave: 236, iacute: 237,
    icircumflex: 238, idieresis: 239, eth: 240, ntilde: 241, ograve: 242,
    oacute: 243, ocircumflex: 244, otilde: 245, odieresis: 246, divide: 247,
    oslash: 248, ugrave: 249, uacute: 250, ucircumflex: 251, udieresis: 252,
    yacute: 253, thorn: 254, ydieresis: 255,
    // Windows-1252 extension characters (U+0080–U+009F range in Unicode)
    Euro: 0x20AC, quotesinglbase: 0x201A, florin: 0x0192, quotedblbase: 0x201E,
    ellipsis: 0x2026, dagger: 0x2020, daggerdbl: 0x2021, circumflex: 0x02C6,
    perthousand: 0x2030, Scaron: 0x0160, guilsinglleft: 0x2039, OE: 0x0152,
    Zcaron: 0x017D, quoteleftreversed: 0x201B,
    // Smart quotes and dashes
    quotedblleft: 0x201C, quotedblright: 0x201D,
    endash: 0x2013, emdash: 0x2014,
    tilde: 0x02DC, trademark: 0x2122,
    scaron: 0x0161, guilsinglright: 0x203A, oe: 0x0153, zcaron: 0x017E,
    Ydieresis: 0x0178,
    // Additional diacritics and accented characters
    dotlessi: 0x0131, dotaccent: 0x02D9, grave: 0x0060,
    caron: 0x02C7, breve: 0x02D8, ring: 0x02DA, ogonek: 0x02DB, hungarumlaut: 0x02DD,
    // Additional accented Latin
    Abreve: 0x0102, abreve: 0x0103, Amacron: 0x0100, amacron: 0x0101,
    Aogonek: 0x0104, aogonek: 0x0105, Cacute: 0x0106, cacute: 0x0107,
    Ccaron: 0x010C, ccaron: 0x010D, Dcaron: 0x010E, dcaron: 0x010F,
    Dcroat: 0x0110, dcroat: 0x0111, Eacute: 0x00C9, eacute: 0x00E9,
    Ecaron: 0x011A, ecaron: 0x011B, Emacron: 0x0112, emacron: 0x0113,
    Eogonek: 0x0118, eogonek: 0x0119, Edotaccent: 0x0116, edotaccent: 0x0117,
    Gbreve: 0x011E, gbreve: 0x011F, Iacute: 0x00CD, iacute: 0x00ED,
    Imacron: 0x012A, imacron: 0x012B, Iogonek: 0x012E, iogonek: 0x012F,
    Itilde: 0x0128, itilde: 0x0129, Lacute: 0x0139, lacute: 0x013A,
    Lcaron: 0x013D, lcaron: 0x013E, Lslash: 0x0141, lslash: 0x0142,
    Nacute: 0x0143, nacute: 0x0144, Ncaron: 0x0147, ncaron: 0x0148,
    Oacute: 0x00D3, oacute: 0x00F3, Ohungarumlaut: 0x0150, ohungarumlaut: 0x0151,
    Omacron: 0x014C, omacron: 0x014D, Racute: 0x0154, racute: 0x0155,
    Rcaron: 0x0158, rcaron: 0x0159, Sacute: 0x015A, sacute: 0x015B,
    Scedilla: 0x015E, scedilla: 0x015F, Tcaron: 0x0164, tcaron: 0x0165,
    Tcommaaccent: 0x0162, tcommaaccent: 0x0163,
    Uacute: 0x00DA, uacute: 0x00FA, Uhungarumlaut: 0x0170, uhungarumlaut: 0x0171,
    Umacron: 0x016A, umacron: 0x016B, Uogonek: 0x0172, uogonek: 0x0173,
    Uring: 0x016E, uring: 0x016F, Utilde: 0x0168, utilde: 0x0169,
    Yacute: 0x00DD, yacute: 0x00FD,
    Zacute: 0x0179, zacute: 0x017A, Zdotaccent: 0x017B, zdotaccent: 0x017C,
    Kcedilla: 0x0136, kcedilla: 0x0137, Lcedilla: 0x013B, lcedilla: 0x013C,
    Ncedilla: 0x0145, ncedilla: 0x0146, Rcedilla: 0x0156, rcedilla: 0x0157,
    commaaccent: 0x0326,
    // Math and symbols
    fraction: 0x2044, infinity: 0x221E, lessequal: 0x2264, greaterequal: 0x2265,
    notequal: 0x2260, summation: 0x2211, product: 0x220F, radical: 0x221A,
    integral: 0x222B, lozenge: 0x25CA, apple: 0xF8FF, fi: 0xFB01, fl: 0xFB02,
    Delta: 0x2206, Omega: 0x2126, pi: 0x03C0,
    partialdiff: 0x2202, approxequal: 0x2248, logicaland: 0x2227, logicalor: 0x2228,
    arrowleft: 0x2190, arrowup: 0x2191, arrowright: 0x2192, arrowdown: 0x2193,
    arrowboth: 0x2194, arrowupdn: 0x2195, carriagereturn: 0x21B5,
    minute: 0x2032, second: 0x2033, periodmath: 0x22C5,
    function: 0x0192, // same as florin
    bulletmath: 0x2219,
    ring: 0x02DA,
    minus: 0x2212, plusminus: 0x00B1,
    // Superscript and fractions (also in Latin-1)
    sfthyphen: 0x00AD,
    // Currency
    florin: 0x0192, Euro: 0x20AC,
    // Greek (for Symbol font)
    alpha: 0x03B1, beta: 0x03B2, gamma: 0x03B3, delta: 0x03B4, epsilon: 0x03B5,
    zeta: 0x03B6, eta: 0x03B7, theta: 0x03B8, iota: 0x03B9, kappa: 0x03BA,
    lambda: 0x03BB, nu: 0x03BD, xi: 0x03BE, omicron: 0x03BF,
    rho: 0x03C1, sigma: 0x03C3, tau: 0x03C4, upsilon: 0x03C5,
    phi: 0x03C6, chi: 0x03C7, psi: 0x03C8, omega: 0x03C9,
    Alpha: 0x0391, Beta: 0x0392, Gamma: 0x0393, Delta2: 0x0394, Epsilon: 0x0395,
    Zeta: 0x0396, Eta: 0x0397, Theta: 0x0398, Iota: 0x0399, Kappa: 0x039A,
    Lambda: 0x039B, Mu: 0x039C, Nu: 0x039D, Xi: 0x039E, Omicron: 0x039F,
    Pi: 0x03A0, Rho: 0x03A1, Sigma: 0x03A3, Tau: 0x03A4, Upsilon: 0x03A5,
    Phi: 0x03A6, Chi: 0x03A7, Psi: 0x03A8, Omega2: 0x03A9,
    // Symbol-specific
    aleph: 0x2135, Ifraktur: 0x2111, Rfraktur: 0x211C, weierstrass: 0x2118,
    circlemultiply: 0x2297, circleplus: 0x2295, emptyset: 0x2205,
    intersection: 0x2229, union: 0x222A, propersuperset: 0x2283,
    reflexsuperset: 0x2287, notsubset: 0x2284, propersubset: 0x2282,
    reflexsubset: 0x2286, element: 0x2208, notelement: 0x2209,
    angle: 0x2220, gradient: 0x2207, registerserif: 0x00AE, copyrightserif: 0x00A9,
    trademarkserif: 0x2122, radicalex: 0x203E, equivalence: 0x2261,
    arrowdblboth: 0x21D4, arrowdblleft: 0x21D0, arrowdblup: 0x21D1,
    arrowdblright: 0x21D2, arrowdbldown: 0x21D3,
    universal: 0x2200, existential: 0x2203, therefore: 0x2234,
    perpendicular: 0x22A5, clubsuit: 0x2663, diamondsuit: 0x2666,
    heartsuit: 0x2665, spadesuit: 0x2660,
    arrowupdnbse: 0x21A8, orthogonalintersection: 0x299C,
    ellipsis: 0x2026,
    // Misc
    bullet: 0x2022, triagup: 0x25B2, triagdn: 0x25BC, triaglf: 0x25C4, triagrт: 0x25BA,
    filledbox: 0x25A0, filledrect: 0x25AC, openbullet: 0x25E6,
    circle: 0x25CB, H18533: 0x25CF, H18543: 0x25AA, H18551: 0x25AB,
    lheel: 0x2E18, rheel: 0x2E19,
    // ZapfDingbats — these are a1..a207 etc, handled by code range below
};

// For ZapfDingbats: glyph names are a1..a94, a96..a112, a118..a120, etc.
// The ZapfDingbats Unicode block is U+2700-U+27FF.
// We use the code directly from AFM (which is already in ZapfDingbats encoding).
// PDFKit uses the ZapfDingbats-specific encoding so we preserve AFM C codes for it.

const FONT_ORDER = [
    'Helvetica', 'Helvetica-Bold', 'Helvetica-Oblique', 'Helvetica-BoldOblique',
    'Times-Roman', 'Times-Bold', 'Times-Italic', 'Times-BoldItalic',
    'Courier', 'Courier-Bold', 'Courier-Oblique', 'Courier-BoldOblique',
    'Symbol', 'ZapfDingbats',
];

// Dingbats code → Unicode (the standard ZapfDingbats encoding to Unicode mapping)
// Source: Unicode standard Zapf Dingbats block + standard mapping
const DINGBATS_CODE_TO_UNICODE = {};
// Build from the well-known mapping table
const DINGBATS_MAP = [
    [0x21,0x2701],[0x22,0x2702],[0x23,0x2703],[0x24,0x2704],[0x25,0x260E],[0x26,0x2706],
    [0x27,0x2707],[0x28,0x2708],[0x29,0x2709],[0x2A,0x261B],[0x2B,0x261E],[0x2C,0x270C],
    [0x2D,0x270D],[0x2E,0x270E],[0x2F,0x270F],[0x30,0x2710],[0x31,0x2711],[0x32,0x2712],
    [0x33,0x2713],[0x34,0x2714],[0x35,0x2715],[0x36,0x2716],[0x37,0x2717],[0x38,0x2718],
    [0x39,0x2719],[0x3A,0x271A],[0x3B,0x271B],[0x3C,0x271C],[0x3D,0x271D],[0x3E,0x271E],
    [0x3F,0x271F],[0x40,0x2720],[0x41,0x2721],[0x42,0x2722],[0x43,0x2723],[0x44,0x2724],
    [0x45,0x2725],[0x46,0x2726],[0x47,0x2727],[0x48,0x2605],[0x49,0x2729],[0x4A,0x272A],
    [0x4B,0x272B],[0x4C,0x272C],[0x4D,0x272D],[0x4E,0x272E],[0x4F,0x272F],[0x50,0x2730],
    [0x51,0x2731],[0x52,0x2732],[0x53,0x2733],[0x54,0x2734],[0x55,0x2735],[0x56,0x2736],
    [0x57,0x2737],[0x58,0x2738],[0x59,0x2739],[0x5A,0x273A],[0x5B,0x273B],[0x5C,0x273C],
    [0x5D,0x273D],[0x5E,0x273E],[0x5F,0x273F],[0x60,0x2740],[0x61,0x2741],[0x62,0x2742],
    [0x63,0x2743],[0x64,0x2744],[0x65,0x2745],[0x66,0x2746],[0x67,0x2747],[0x68,0x2748],
    [0x69,0x2749],[0x6A,0x274A],[0x6B,0x274B],[0x6C,0x25CF],[0x6D,0x274D],[0x6E,0x25A0],
    [0x6F,0x274F],[0x70,0x2750],[0x71,0x2751],[0x72,0x2752],[0x73,0x25B2],[0x74,0x25BC],
    [0x75,0x25C6],[0x76,0x2756],[0x77,0x25D7],[0x78,0x2758],[0x79,0x2759],[0x7A,0x275A],
    [0x7B,0x275B],[0x7C,0x275C],[0x7D,0x275D],[0x7E,0x275E],
    [0x80,0x2768],[0x81,0x2769],[0x82,0x276A],[0x83,0x276B],[0x84,0x276C],[0x85,0x276D],
    [0x86,0x276E],[0x87,0x276F],[0x88,0x2770],[0x89,0x2771],[0x8A,0x2772],[0x8B,0x2773],
    [0x8C,0x2774],[0x8D,0x2775],
    [0xA1,0x2761],[0xA2,0x2762],[0xA3,0x2763],[0xA4,0x2764],[0xA5,0x2765],[0xA6,0x2766],
    [0xA7,0x2767],[0xA8,0x2663],[0xA9,0x2666],[0xAA,0x2665],[0xAB,0x2660],[0xAC,0x2460],
    [0xAD,0x2461],[0xAE,0x2462],[0xAF,0x2463],[0xB0,0x2464],[0xB1,0x2465],[0xB2,0x2466],
    [0xB3,0x2467],[0xB4,0x2468],[0xB5,0x2469],[0xB6,0x2776],[0xB7,0x2777],[0xB8,0x2778],
    [0xB9,0x2779],[0xBA,0x277A],[0xBB,0x277B],[0xBC,0x277C],[0xBD,0x277D],[0xBE,0x277E],
    [0xBF,0x277F],[0xC0,0x2780],[0xC1,0x2781],[0xC2,0x2782],[0xC3,0x2783],[0xC4,0x2784],
    [0xC5,0x2785],[0xC6,0x2786],[0xC7,0x2787],[0xC8,0x2788],[0xC9,0x2789],[0xCA,0x278A],
    [0xCB,0x278B],[0xCC,0x278C],[0xCD,0x278D],[0xCE,0x278E],[0xCF,0x278F],[0xD0,0x2790],
    [0xD1,0x2791],[0xD2,0x2792],[0xD3,0x2793],[0xD4,0x2794],[0xD5,0x2192],[0xD6,0x2194],
    [0xD7,0x2195],[0xD8,0x2798],[0xD9,0x2799],[0xDA,0x279A],[0xDB,0x279B],[0xDC,0x279C],
    [0xDD,0x279D],[0xDE,0x279E],[0xDF,0x279F],[0xE0,0x27A0],[0xE1,0x27A1],[0xE2,0x27A2],
    [0xE3,0x27A3],[0xE4,0x27A4],[0xE5,0x27A5],[0xE6,0x27A6],[0xE7,0x27A7],[0xE8,0x27A8],
    [0xE9,0x27A9],[0xEA,0x27AA],[0xEB,0x27AB],[0xEC,0x27AC],[0xED,0x27AD],[0xEE,0x27AE],
    [0xEF,0x27AF],[0xF1,0x27B1],[0xF2,0x27B2],[0xF3,0x27B3],[0xF4,0x27B4],[0xF5,0x27B5],
    [0xF6,0x27B6],[0xF7,0x27B7],[0xF8,0x27B8],[0xF9,0x27B9],[0xFA,0x27BA],[0xFB,0x27BB],
    [0xFC,0x27BC],[0xFD,0x27BD],[0xFE,0x27BE],
];
for (const [code, uni] of DINGBATS_MAP) DINGBATS_CODE_TO_UNICODE[code] = uni;

// Symbol font: code → Unicode (Symbol encoding)
const SYMBOL_CODE_TO_UNICODE = {
    32:0x0020, 33:0x0021, 34:0x2200, 35:0x0023, 36:0x2203, 37:0x0025, 38:0x0026,
    39:0x220D, 40:0x0028, 41:0x0029, 42:0x2217, 43:0x002B, 44:0x002C, 45:0x2212,
    46:0x002E, 47:0x002F, 48:0x0030, 49:0x0031, 50:0x0032, 51:0x0033, 52:0x0034,
    53:0x0035, 54:0x0036, 55:0x0037, 56:0x0038, 57:0x0039, 58:0x003A, 59:0x003B,
    60:0x003C, 61:0x003D, 62:0x003E, 63:0x003F, 64:0x2245, 65:0x0391, 66:0x0392,
    67:0x03A7, 68:0x0394, 69:0x0395, 70:0x03A6, 71:0x0393, 72:0x0397, 73:0x0399,
    74:0x03D1, 75:0x039A, 76:0x039B, 77:0x039C, 78:0x039D, 79:0x039F, 80:0x03A0,
    81:0x0398, 82:0x03A1, 83:0x03A3, 84:0x03A4, 85:0x03A5, 86:0x03C2, 87:0x03A9,
    88:0x039E, 89:0x03A8, 90:0x0396, 91:0x005B, 92:0x2234, 93:0x005D, 94:0x22A5,
    95:0x005F, 96:0xF8E5, 97:0x03B1, 98:0x03B2, 99:0x03C7, 100:0x03B4, 101:0x03B5,
    102:0x03C6, 103:0x03B3, 104:0x03B7, 105:0x03B9, 106:0x03D5, 107:0x03BA,
    108:0x03BB, 109:0x03BC, 110:0x03BD, 111:0x03BF, 112:0x03C0, 113:0x03B8,
    114:0x03C1, 115:0x03C3, 116:0x03C4, 117:0x03C5, 118:0x03D6, 119:0x03C9,
    120:0x03BE, 121:0x03C8, 122:0x03B6, 123:0x007B, 124:0x007C, 125:0x007D,
    126:0x223C, 161:0x03D2, 162:0x2032, 163:0x2264, 164:0x2044, 165:0x221E,
    166:0x0192, 167:0x2663, 168:0x2666, 169:0x2665, 170:0x2660, 171:0x2194,
    172:0x2190, 173:0x2191, 174:0x2192, 175:0x2193, 176:0x00B0, 177:0x00B1,
    178:0x2033, 179:0x2265, 180:0x00D7, 181:0x221D, 182:0x2202, 183:0x2022,
    184:0x00F7, 185:0x2260, 186:0x2261, 187:0x2248, 188:0x2026, 189:0xF8E6,
    190:0xF8E7, 191:0x21B5, 192:0x2135, 193:0x2111, 194:0x211C, 195:0x2118,
    196:0x2297, 197:0x2295, 198:0x2205, 199:0x2229, 200:0x222A, 201:0x2283,
    202:0x2287, 203:0x2284, 204:0x2282, 205:0x2286, 206:0x2208, 207:0x2209,
    208:0x2220, 209:0x2207, 210:0x00AE, 211:0x00A9, 212:0x2122, 213:0x220F,
    214:0x221A, 215:0x22C5, 216:0x00AC, 217:0x2227, 218:0x2228, 219:0x21D4,
    220:0x21D0, 221:0x21D1, 222:0x21D2, 223:0x21D3, 224:0x25CA, 225:0x3008,
    226:0x00AE, 227:0x00A9, 228:0x2122, 229:0x2211, 230:0xF8EB, 231:0xF8EC,
    232:0xF8ED, 233:0xF8EE, 234:0xF8EF, 235:0xF8F0, 236:0xF8F1, 237:0xF8F2,
    238:0xF8F3, 239:0xF8F4, 241:0x3009, 242:0x222B, 243:0x2320, 244:0xF8F5,
    245:0x2321, 246:0xF8F6, 247:0xF8F7, 248:0xF8F8, 249:0xF8F9, 250:0xF8FA,
    251:0xF8FB, 252:0xF8FC, 253:0xF8FD, 254:0xF8FE,
};

function glyphNameToUnicode(name, fontName) {
    if (fontName === 'Symbol') return null; // Symbol uses code-based table
    if (fontName === 'ZapfDingbats') return null; // ZapfDingbats uses code-based table

    if (AGL[name] !== undefined) return AGL[name];

    // Fallback: single uppercase/lowercase letter
    if (/^[A-Za-z]$/.test(name)) return name.charCodeAt(0);

    return null;
}

function parseAfm(filePath, fontName) {
    const text = fs.readFileSync(filePath, 'utf-8');
    const lines = text.split(/\r?\n/);

    let family = '';
    let ascent = 0;
    let descent = 0;

    // glyph name → { code, width, llx, lly, urx, ury }
    const glyphsByName = {};
    const glyphsByCode = {};

    for (const line of lines) {
        if (line.startsWith('FamilyName ')) { family = line.slice(11).trim(); continue; }
        if (line.startsWith('Ascender ')) { ascent = parseInt(line.slice(9), 10); continue; }
        if (line.startsWith('Descender ')) { descent = parseInt(line.slice(10), 10); continue; }
        if (!line.startsWith('C ')) continue;

        const codeMatch = line.match(/^C\s+(-?\d+)\s*;/);
        const wMatch = line.match(/WX\s+(\d+)/);
        const nMatch = line.match(/N\s+(\S+)/);
        const bMatch = line.match(/B\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)/);

        if (!codeMatch || !wMatch || !nMatch) continue;
        const code = parseInt(codeMatch[1], 10);
        const width = parseInt(wMatch[1], 10);
        const name = nMatch[1];
        const bbox = bMatch ? [parseInt(bMatch[1]),parseInt(bMatch[2]),parseInt(bMatch[3]),parseInt(bMatch[4])] : null;

        glyphsByName[name] = { code, width, bbox };
        if (code >= 0) glyphsByCode[code] = { name, width, bbox };
    }

    // Derive defaultWidth from space
    const defaultWidth = glyphsByCode[32]?.width ?? 250;

    // Build Unicode-keyed tables
    const widthsByUnicode = {};
    const bboxByUnicode = {};

    if (fontName === 'Symbol') {
        for (const [codeStr, uni] of Object.entries(SYMBOL_CODE_TO_UNICODE)) {
            const code = parseInt(codeStr, 10);
            const g = glyphsByCode[code];
            if (!g) continue;
            widthsByUnicode[uni] = g.width;
            if (g.bbox) bboxByUnicode[uni] = g.bbox;
        }
    } else if (fontName === 'ZapfDingbats') {
        for (const [codeStr, uni] of Object.entries(DINGBATS_CODE_TO_UNICODE)) {
            const code = parseInt(codeStr, 10);
            const g = glyphsByCode[code];
            if (!g) continue;
            widthsByUnicode[uni] = g.width;
            if (g.bbox) bboxByUnicode[uni] = g.bbox;
        }
    } else {
        for (const [name, g] of Object.entries(glyphsByName)) {
            const uni = glyphNameToUnicode(name, fontName);
            if (uni === null || uni === undefined) continue;
            widthsByUnicode[uni] = g.width;
            if (g.bbox) bboxByUnicode[uni] = g.bbox;
        }
    }

    return { fontName, family, ascent, descent, defaultWidth, widthsByUnicode, bboxByUnicode };
}

function formatRecord(rec) {
    const wEntries = Object.entries(rec.widthsByUnicode)
        .sort((a, b) => a[0] - b[0])
        .map(([k, v]) => `            ${k}: ${v},`)
        .join('\n');
    const bEntries = Object.entries(rec.bboxByUnicode)
        .sort((a, b) => a[0] - b[0])
        .map(([k, v]) => `            ${k}: [${v.join(', ')}],`)
        .join('\n');

    return `    '${rec.fontName}': {
        postscriptName: '${rec.fontName}',
        familyName: '${rec.family}',
        unitsPerEm: 1000,
        ascent: ${rec.ascent},
        descent: ${rec.descent},
        defaultWidth: ${rec.defaultWidth},
        widthsByCode: {
${wEntries}
        },
        bboxByCode: {
${bEntries}
        }
    }`;
}

const fontBlocks = [];
for (const name of FONT_ORDER) {
    const afmPath = path.join(AFM_DIR, `${name}.afm`);
    if (!fs.existsSync(afmPath)) { console.error(`Missing: ${afmPath}`); process.exit(1); }
    console.log(`Parsing ${name}...`);
    const rec = parseAfm(afmPath, name);
    const wCount = Object.keys(rec.widthsByUnicode).length;
    const bCount = Object.keys(rec.bboxByUnicode).length;
    console.log(`  widths: ${wCount}, bboxes: ${bCount}`);
    fontBlocks.push(formatRecord(rec));
}

// Verify endash for Helvetica
const helveticaRec = fontBlocks[0];
const endashUni = 0x2013; // 8211
if (helveticaRec.includes(`${endashUni}: 556`)) {
    console.log('✓ Helvetica endash (U+2013) correctly mapped to width 556');
} else {
    console.warn('⚠ Helvetica endash mapping not found - check AGL');
}

const output = `import type { StandardPostscriptFontName } from './sentinel';

export type StandardAfmMetrics = {
    postscriptName: StandardPostscriptFontName;
    familyName: string;
    unitsPerEm: number;
    ascent: number;
    descent: number;
    defaultWidth: number;
    /** Keyed by Unicode codepoint */
    widthsByCode: Readonly<Record<number, number>>;
    /** Keyed by Unicode codepoint — [llx, lly, urx, ury] in font units */
    bboxByCode: Readonly<Record<number, [number, number, number, number]>>;
};

export const STANDARD_AFM_TABLES: Readonly<Record<StandardPostscriptFontName, StandardAfmMetrics>> = {
${fontBlocks.join(',\n')}
} as const;

export const getStandardAfmMetrics = (postscriptName: StandardPostscriptFontName): StandardAfmMetrics => {
    const metrics = STANDARD_AFM_TABLES[postscriptName];
    if (!metrics) {
        throw new Error(\`Unknown standard AFM table for "\${postscriptName}".\`);
    }
    return metrics;
};
`;

fs.writeFileSync(OUT_FILE, output, 'utf-8');
// Cleanup temp file
try { fs.unlinkSync(path.resolve(__dirname, '_glyph-names-tmp.txt')); } catch {}
console.log(`\nWritten: ${OUT_FILE} (${output.split('\n').length} lines)`);
