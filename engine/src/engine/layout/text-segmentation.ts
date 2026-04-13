const ARABIC_SCRIPT_RE = /\p{Script=Arabic}/u;
const COMBINING_MARK_RE = /^\p{M}+$/u;
const DECIMAL_DIGIT_RE = /\p{Nd}/u;

const LEFT_STICKY_PUNCTUATION = new Set([
    '.', ',', '!', '?', ':', ';',
    '\u060C', // Arabic comma
    '\u061B', // Arabic semicolon
    '\u061F', // Arabic question mark
    '\u0964',
    '\u0965',
    ')', ']', '}',
    '%',
    '"',
    '\u201D',
    '\u2019',
    '\u00BB',
    '\u203A',
    '\u2026'
]);

const ARABIC_NO_SPACE_TRAILING_PUNCTUATION = new Set([
    ':',
    '.',
    '\u060C',
    '\u061B'
]);

const NUMERIC_JOINERS = new Set([
    ':',
    '-',
    '/',
    '\u00D7',
    ',',
    '.',
    '%',
    '+',
    '\u2013',
    '\u2014'
]);

const TRAILING_NUMERIC_BOUNDARY_PUNCTUATION_RE = /^[)\]}]$/u;

const hasNonAscii = (text: string): boolean => {
    for (let i = 0; i < text.length; i += 1) {
        if ((text.charCodeAt(i) & 0xFF80) !== 0) return true;
    }
    return false;
};

const containsArabicScript = (text: string): boolean => {
    if (!hasNonAscii(text)) return false;
    return ARABIC_SCRIPT_RE.test(text);
};

const endsWithArabicNoSpacePunctuation = (text: string): boolean => {
    if (!text || text.length === 0) return false;
    const lastChar = text[text.length - 1] || '';
    if (!ARABIC_NO_SPACE_TRAILING_PUNCTUATION.has(lastChar)) return false;
    return containsArabicScript(text);
};

const isLeftStickyPunctuationSegment = (text: string): boolean => {
    if (!text) return false;
    let sawPunctuation = false;
    for (const ch of text) {
        if (LEFT_STICKY_PUNCTUATION.has(ch)) {
            sawPunctuation = true;
            continue;
        }
        if (sawPunctuation && COMBINING_MARK_RE.test(ch)) continue;
        return false;
    }
    return sawPunctuation;
};

export const isNumericRunSegment = (text: string): boolean => {
    if (!text) return false;
    let hasDigit = false;
    let sawNonAscii = false;

    for (let i = 0; i < text.length; i += 1) {
        const code = text.charCodeAt(i);
        if (code >= 48 && code <= 57) {
            hasDigit = true;
            continue;
        }
        if (code < 128) {
            if (NUMERIC_JOINERS.has(text[i] || '')) continue;
            return false;
        }
        sawNonAscii = true;
        break;
    }

    if (!sawNonAscii) return hasDigit;

    hasDigit = false;
    for (const ch of text) {
        if (NUMERIC_JOINERS.has(ch) || DECIMAL_DIGIT_RE.test(ch)) {
            if (DECIMAL_DIGIT_RE.test(ch)) hasDigit = true;
            continue;
        }
        return false;
    }
    return hasDigit;
};

const splitLeadingSpaceAndMarks = (text: string): { space: string; marks: string } | null => {
    if (text.length < 2 || text[0] !== ' ') return null;
    const marks = text.slice(1);
    if (!COMBINING_MARK_RE.test(marks)) return null;
    return { space: ' ', marks };
};

/**
 * Normalizes tiny word/grapheme segments so the layout core sees stable,
 * human-meaningful runs for wrapping and bidi-sensitive punctuation.
 *
 * This is core text-layout behavior. Browser delegates may have been the first
 * consumer, but the helper itself should stay neutral because it operates on
 * authored text segments rather than browser APIs.
 */
export const normalizeTextSegments = (segments: string[]): string[] => {
    if (segments.length <= 1) return segments;

    let needsPass1 = false;
    for (const seg of segments) {
        if (seg.length >= 2 && seg[0] === ' ' && hasNonAscii(seg)) {
            needsPass1 = true;
            break;
        }
    }

    const normalized: string[] = needsPass1 ? [] : segments;
    if (needsPass1) {
        for (let i = 0; i < segments.length; i += 1) {
            const current = segments[i] || '';
            const split = splitLeadingSpaceAndMarks(current);
            if (split && i + 1 < segments.length && containsArabicScript(segments[i + 1] || '')) {
                normalized.push(split.space);
                segments[i + 1] = split.marks + (segments[i + 1] || '');
                continue;
            }
            normalized.push(current);
        }
    }

    const merged: string[] = [];
    let prevIsNumeric = false;
    for (const current of normalized) {
        const previous = merged[merged.length - 1];
        if (previous !== undefined && previous.trim().length > 0) {
            if (prevIsNumeric && TRAILING_NUMERIC_BOUNDARY_PUNCTUATION_RE.test(current)) {
                merged.push(current);
                prevIsNumeric = false;
                continue;
            }
            if (isLeftStickyPunctuationSegment(current)) {
                merged[merged.length - 1] = previous + current;
                continue;
            }
            if (endsWithArabicNoSpacePunctuation(previous) && containsArabicScript(current)) {
                merged[merged.length - 1] = previous + current;
                prevIsNumeric = false;
                continue;
            }
            const currIsNumeric = isNumericRunSegment(current);
            if (prevIsNumeric && currIsNumeric) {
                merged[merged.length - 1] = previous + current;
                continue;
            }
            prevIsNumeric = currIsNumeric;
        } else {
            prevIsNumeric = isNumericRunSegment(current);
        }
        merged.push(current);
    }

    return merged;
};

export const segmentTextRun = (text: string, segmenter: { segment(input: string): Iterable<{ segment: string }> }): string[] => {
    const segments = Array.from(segmenter.segment(text), (entry) => entry.segment);
    return normalizeTextSegments(segments);
};
