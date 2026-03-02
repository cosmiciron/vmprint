import { ElementStyle } from '../types';
import { RendererLine, RendererLineSegment } from './types';

export const getStrongDirection = (text: string): 'ltr' | 'rtl' | 'neutral' => {
    for (const ch of text || '') {
        const cp = ch.codePointAt(0) || 0;
        const isRtl =
            (cp >= 0x0590 && cp <= 0x08ff) || // Hebrew + Arabic + Syriac + Thaana etc.
            (cp >= 0xfb1d && cp <= 0xfdff) ||
            (cp >= 0xfe70 && cp <= 0xfeff);
        if (isRtl) return 'rtl';
        if (/\p{L}|\p{N}/u.test(ch)) return 'ltr';
    }
    return 'neutral';
};

export const resolveLineDirection = (
    line: RendererLine,
    containerStyle: ElementStyle,
    layoutDirection?: string,
    defaultDirection?: string,
): 'ltr' | 'rtl' => {
    const configured = String(containerStyle.direction || layoutDirection || defaultDirection);
    if (configured === 'rtl') return 'rtl';
    if (configured === 'ltr') return 'ltr';

    // auto: first strong character decides base paragraph direction.
    const lineText = Array.isArray(line) ? line.map((seg) => seg?.text || '').join('') : String(line || '');
    const strong = getStrongDirection(lineText);
    return strong === 'rtl' ? 'rtl' : 'ltr';
};

export const reorderItemsForRtl = <T extends { seg: RendererLineSegment; extra: number }>(items: T[]): T[] => {
    if (items.length <= 1) return items;

    const runs: T[][] = [];
    let currentRun: T[] = [];
    let currentDir: 'ltr' | 'rtl' = 'rtl';

    for (const item of items) {
        const dir = getStrongDirection(item.seg?.text || '');
        const effectiveDir: 'ltr' | 'rtl' = dir === 'neutral' ? currentDir : dir;

        if (currentRun.length === 0) {
            currentRun = [item];
            currentDir = effectiveDir;
            continue;
        }

        if (effectiveDir !== currentDir) {
            runs.push(currentRun);
            currentRun = [item];
            currentDir = effectiveDir;
            continue;
        }

        currentRun.push(item);
    }

    if (currentRun.length > 0) runs.push(currentRun);
    return runs.reverse().flatMap((run) => run);
};
