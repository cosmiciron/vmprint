import { ElementStyle } from '../types';
import { RendererLine, RendererLineSegment } from './types';

export const getStrongDirection = (text: string): 'ltr' | 'rtl' | 'neutral' => {
    for (const ch of text || '') {
        const cp = ch.codePointAt(0) || 0;
        const isRtl =
            (cp >= 0x0590 && cp <= 0x08FF) || // Hebrew + Arabic + Syriac + Thaana etc.
            (cp >= 0xFB1D && cp <= 0xFDFF) ||
            (cp >= 0xFE70 && cp <= 0xFEFF);
        if (isRtl) return 'rtl';
        if (/\p{L}|\p{N}/u.test(ch)) return 'ltr';
    }
    return 'neutral';
};

export const resolveLineDirection = (
    line: RendererLine,
    containerStyle: ElementStyle,
    layoutDirection?: string,
    defaultDirection?: string
): 'ltr' | 'rtl' => {
    const configured = String(containerStyle.direction || layoutDirection || defaultDirection);
    if (configured === 'rtl') return 'rtl';
    if (configured === 'ltr') return 'ltr';

    // auto: first strong character decides base paragraph direction.
    const lineText = Array.isArray(line)
        ? line.map((seg) => seg?.text || '').join('')
        : String(line || '');
    const strong = getStrongDirection(lineText);
    return strong === 'rtl' ? 'rtl' : 'ltr';
};

export const reorderItemsForRtl = <T extends { seg: RendererLineSegment; extra: number }>(items: T[]): T[] => {
    if (items.length <= 1) return items;

    const runs: { dir: 'ltr' | 'rtl'; items: T[] }[] = [];
    let currentRun: T[] = [];
    let currentDir: 'ltr' | 'rtl' = 'rtl';

    for (const item of items) {
        // Prefer the pre-computed BIDI direction from the layout engine (set by splitByBidiDirection).
        // Fall back to Unicode text-sniffing for segments that weren't BIDI-tagged (e.g. plain string lines).
        const segDir = (item.seg as any)?.direction as ('ltr' | 'rtl' | undefined);
        const effectiveDir: 'ltr' | 'rtl' = segDir
            ? segDir
            : (():'ltr' | 'rtl' => {
                const detected = getStrongDirection(item.seg?.text || '');
                return detected === 'neutral' ? currentDir : detected;
            })();

        if (currentRun.length === 0) {
            currentRun = [item];
            currentDir = effectiveDir;
            continue;
        }

        if (effectiveDir !== currentDir) {
            runs.push({ dir: currentDir, items: currentRun });
            currentRun = [item];
            currentDir = effectiveDir;
            continue;
        }

        currentRun.push(item);
    }

    if (currentRun.length > 0) runs.push({ dir: currentDir, items: currentRun });

    // In an RTL line, visual order is run-order reversed. Additionally, LTR runs
    // must be item-order reversed before placement because drawRichLineSegments
    // advances from the right edge toward the left.
    return runs
        .reverse()
        .flatMap((run) => run.dir === 'ltr' ? [...run.items].reverse() : run.items);
};
