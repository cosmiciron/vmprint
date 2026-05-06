import { ElementStyle } from '../types';
import { RendererLine, RendererLineSegment } from './types';
import bidiFactory from 'bidi-js';

const bidi = bidiFactory();

const mirrorSegmentText = (text: string, embeddingLevels: Uint8Array, startOffset: number): string | null => {
    let mirroredText = '';
    let changed = false;
    for (let index = 0; index < text.length; index += 1) {
        const char = text[index] || '';
        const mirroredChar = (embeddingLevels[startOffset + index] & 1)
            ? bidi.getMirroredCharacter(char)
            : null;
        mirroredText += mirroredChar || char;
        if (mirroredChar) changed = true;
    }
    return changed ? mirroredText : null;
};

const resolveMirroredItems = <T extends { seg: RendererLineSegment }>(
    items: T[],
    textParts: string[],
    embeddingLevels: Uint8Array
): T[] => {
    let offset = 0;
    let changed = false;
    const mirroredItems = items.map((item, itemIndex) => {
        const text = textParts[itemIndex] || '';
        const mirroredText = mirrorSegmentText(text, embeddingLevels, offset);
        offset += text.length;
        if (!mirroredText || mirroredText === item?.seg?.text) {
            return item;
        }
        changed = true;
        return {
            ...item,
            seg: {
                ...item.seg,
                text: mirroredText,
                glyphs: undefined,
                shapedGlyphs: undefined
            }
        };
    });
    return changed ? mirroredItems : items;
};

export const getStrongDirection = (text: string): 'ltr' | 'rtl' | 'neutral' => {
    for (const ch of text || '') {
        const cp = ch.codePointAt(0) || 0;
        const isRtl =
            (cp >= 0x0590 && cp <= 0x08FF) || // Hebrew + Arabic + Syriac + Thaana etc.
            (cp >= 0xFB1D && cp <= 0xFDFF) ||
            (cp >= 0xFE70 && cp <= 0xFEFF);
        if (isRtl) return 'rtl';
        if (/\p{L}/u.test(ch)) return 'ltr';
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

export const resolveParagraphDirection = (
    lines: RendererLine[],
    containerStyle: ElementStyle,
    layoutDirection?: string,
    defaultDirection?: string
): 'ltr' | 'rtl' => {
    const configured = String(containerStyle.direction || layoutDirection || defaultDirection);
    if (configured === 'rtl') return 'rtl';
    if (configured === 'ltr') return 'ltr';

    const paragraphText = (lines || [])
        .map((line) => Array.isArray(line) ? line.map((seg) => seg?.text || '').join('') : String(line || ''))
        .join('\n');
    const strong = getStrongDirection(paragraphText);
    return strong === 'rtl' ? 'rtl' : 'ltr';
};

export const reorderItemsForVisualBidi = <T extends { seg: RendererLineSegment; extra: number }>(
    items: T[],
    baseDirection: 'ltr' | 'rtl'
): T[] => {
    if (items.length <= 1) return items;

    const textParts: string[] = [];
    const charToItem: number[] = [];
    for (let itemIndex = 0; itemIndex < items.length; itemIndex += 1) {
        const text = items[itemIndex]?.seg?.text || '\uFFFC';
        textParts.push(text);
        for (let charIndex = 0; charIndex < text.length; charIndex += 1) {
            charToItem.push(itemIndex);
        }
    }

    const lineText = textParts.join('');
    if (lineText.length > 0) {
        const embedding = bidi.getEmbeddingLevels(lineText, baseDirection as any);
        const mirroredItems = resolveMirroredItems(items, textParts, embedding.levels);
        const visualCharIndices = bidi.getReorderedIndices(lineText, embedding);
        const seenItems = new Set<number>();
        const visualItems: T[] = [];
        for (const charIndex of visualCharIndices) {
            const itemIndex = charToItem[charIndex];
            if (itemIndex === undefined || seenItems.has(itemIndex)) continue;
            seenItems.add(itemIndex);
            visualItems.push(mirroredItems[itemIndex]);
        }
        for (let itemIndex = 0; itemIndex < items.length; itemIndex += 1) {
            if (seenItems.has(itemIndex)) continue;
            visualItems.push(mirroredItems[itemIndex]);
        }
        if (visualItems.length === items.length) {
            return baseDirection === 'rtl' ? visualItems.reverse() : visualItems;
        }
    }

    const resolveStrongDirAt = (index: number): 'ltr' | 'rtl' | 'neutral' => {
        const text = items[index]?.seg?.text || '';
        return getStrongDirection(text);
    };

    const resolvedDirs: Array<'ltr' | 'rtl'> = new Array(items.length);
    for (let i = 0; i < items.length; i++) {
        const strong = resolveStrongDirAt(i);
        if (strong !== 'neutral') {
            resolvedDirs[i] = strong;
            continue;
        }

        const segText = items[i]?.seg?.text || '';
        const segDir = (items[i]?.seg as any)?.direction as ('ltr' | 'rtl' | undefined);
        const isWhitespace = segText.trim().length === 0;

        if (!isWhitespace && segDir) {
            resolvedDirs[i] = segDir;
            continue;
        }

        let prevStrong: 'ltr' | 'rtl' | null = null;
        for (let j = i - 1; j >= 0; j--) {
            const d = resolveStrongDirAt(j);
            if (d !== 'neutral') {
                prevStrong = d;
                break;
            }
        }

        let nextStrong: 'ltr' | 'rtl' | null = null;
        for (let j = i + 1; j < items.length; j++) {
            const d = resolveStrongDirAt(j);
            if (d !== 'neutral') {
                nextStrong = d;
                break;
            }
        }

        if (prevStrong && nextStrong && prevStrong === nextStrong) {
            resolvedDirs[i] = prevStrong;
        } else if (prevStrong && nextStrong) {
            resolvedDirs[i] = baseDirection;
        } else if (prevStrong) {
            resolvedDirs[i] = prevStrong;
        } else if (nextStrong) {
            resolvedDirs[i] = nextStrong;
        } else if (segDir) {
            resolvedDirs[i] = segDir;
        } else {
            resolvedDirs[i] = baseDirection;
        }
    }

    const runs: { dir: 'ltr' | 'rtl'; items: T[] }[] = [];
    let currentRun: T[] = [];
    let currentDir: 'ltr' | 'rtl' = baseDirection;

    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const effectiveDir: 'ltr' | 'rtl' = resolvedDirs[i];

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

    if (baseDirection === 'rtl') {
        // In an RTL line, visual order is run-order reversed. Additionally, LTR runs
        // must be item-order reversed before placement because drawRichLineSegments
        // advances from the right edge toward the left.
        return runs
            .reverse()
            .flatMap((run) => run.dir === 'ltr' ? [...run.items].reverse() : run.items);
    }

    // In an LTR line, run order remains as authored, but nested RTL runs must have
    // their item order reversed so the RTL run reads correctly inside LTR context.
    return runs.flatMap((run) => run.dir === 'rtl' ? [...run.items].reverse() : run.items);
};

export const resolveVisualTextByItem = <T extends { seg: RendererLineSegment }>(
    items: T[],
    baseDirection: 'ltr' | 'rtl'
): string[] => {
    const visualTextByItem = items.map(() => '');
    if (items.length === 0) return visualTextByItem;

    const textParts: string[] = [];
    const charToItem: number[] = [];
    for (let itemIndex = 0; itemIndex < items.length; itemIndex += 1) {
        const text = items[itemIndex]?.seg?.text || '\uFFFC';
        textParts.push(text);
        for (let charIndex = 0; charIndex < text.length; charIndex += 1) {
            charToItem.push(itemIndex);
        }
    }

    const lineText = textParts.join('');
    if (!lineText) return items.map((item) => item?.seg?.text || '');

    const embedding = bidi.getEmbeddingLevels(lineText, baseDirection as any);
    const visualCharIndices = bidi.getReorderedIndices(lineText, embedding);
    for (const charIndex of visualCharIndices) {
        const itemIndex = charToItem[charIndex];
        if (itemIndex === undefined) continue;
        const char = lineText[charIndex] || '';
        const mirroredChar = (embedding.levels[charIndex] & 1)
            ? bidi.getMirroredCharacter(char)
            : null;
        visualTextByItem[itemIndex] += mirroredChar || char;
    }

    return visualTextByItem.map((text, index) => text || items[index]?.seg?.text || '');
};
