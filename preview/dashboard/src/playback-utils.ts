export type PreviewProofTextFragment = {
    text: string;
    width?: number;
    ascent?: number;
    descent?: number;
    fontFamily?: string;
    opacity?: number;
};

export type PreviewProofBox = {
    type: string;
    x: number;
    y: number;
    w: number;
    h: number;
    backgroundColor?: string;
    borderColor?: string;
    color?: string;
    borderWidth?: number;
    sourceId?: string;
    engineKey?: string;
    fragmentIndex?: number;
    opacity?: number;
    transitionKind?: 'stable' | 'geometry' | 'content-swap' | 'content-append' | 'enter' | 'exit';
    lines?: PreviewProofTextFragment[][];
};

export type PreviewProofPage = {
    index: number;
    width: number;
    height: number;
    boxes: PreviewProofBox[];
};

export type PreviewTimelineFrame = {
    captureIndex: number;
    tick: number;
    pageCount: number;
    pages: PreviewProofPage[];
};

export type PreviewProofArtifact = {
    id: string;
    title: string;
    description?: string;
    pages: PreviewProofPage[];
    timeline?: PreviewTimelineFrame[];
    preferredFrameDurationMs?: number;
};

export type PreviewTransitionSummary = {
    stableCount: number;
    geometryCount: number;
    contentSwapCount: number;
    contentAppendCount: number;
    enteringCount: number;
    exitingCount: number;
};

export type RenderProofPageOptions = {
    scale?: number;
    backgroundColor?: string;
    paperColor?: string;
    debugTransitions?: boolean;
};

const resolve2dContext = (target: HTMLCanvasElement | OffscreenCanvas): CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D => {
    const context = target.getContext('2d');
    if (!context) throw new Error('[VMPrintPreviewDashboard] Unable to resolve a 2D canvas context.');
    return context;
};

const collectLineText = (fragments: PreviewProofTextFragment[] | undefined): string =>
    (fragments || []).map((fragment) => fragment.text || '').join('');

const cloneLineFragments = (lines: PreviewProofTextFragment[][] | undefined): PreviewProofTextFragment[][] =>
    (lines || []).map((line) => line.map((fragment) => ({ ...fragment })));

const normalizeOpacity = (value: number | undefined, fallback = 1): number =>
    typeof value === 'number' ? Math.max(0, Math.min(1, value)) : fallback;

const cloneProofPage = (page: PreviewProofPage): PreviewProofPage => ({
    index: page.index,
    width: page.width,
    height: page.height,
    boxes: (page.boxes || []).map((box) => ({
        ...box,
        lines: cloneLineFragments(box.lines)
    }))
});

const pickBoxPalette = (box: PreviewProofBox): { stroke: string; fill: string; text: string; lineWidth: number; font: string; headingFont?: string } => {
    if (box.backgroundColor || box.borderColor || box.color || box.borderWidth) {
        return {
            stroke: box.borderColor || 'rgba(17, 24, 39, 0.22)',
            fill: box.backgroundColor || 'transparent',
            text: box.color || '#111827',
            lineWidth: typeof box.borderWidth === 'number' ? box.borderWidth : 1,
            font: '13px "Aptos", "Trebuchet MS", sans-serif'
        };
    }

    const text = collectLineText(box.lines?.[0]).toLowerCase();
    const type = box.type.toLowerCase();
    if (type.includes('clock') || text.includes('ufo wave track')) {
        return { stroke: '#f39c12', fill: '#fff4d6', text: '#8a4b00', lineWidth: 1.5, font: '12px "Cascadia Code", Consolas, monospace' };
    }
    if (type.includes('chapter-heading') || text.includes('actor activation board')) {
        return { stroke: '#111827', fill: 'transparent', text: '#111827', lineWidth: 0, font: '600 14px "Aptos", "Trebuchet MS", sans-serif', headingFont: '600 16px "Aptos", "Trebuchet MS", sans-serif' };
    }
    if (text.includes('event source') || text.includes('collector')) {
        return { stroke: '#4aa366', fill: '#e7f7ea', text: '#205b33', lineWidth: 1.25, font: '13px "Aptos", "Trebuchet MS", sans-serif' };
    }
    if (text.includes('expected result') || text.includes('downstream marker')) {
        return { stroke: '#5f7cf9', fill: '#eef1ff', text: '#2b3b93', lineWidth: 1.25, font: '13px "Aptos", "Trebuchet MS", sans-serif' };
    }
    if (text.includes('replay marker') || text.includes('engine stop reason') || text.includes('upstream marker')) {
        return { stroke: '#d85d5d', fill: '#ffeceb', text: '#8e2c2c', lineWidth: 1.25, font: '13px "Aptos", "Trebuchet MS", sans-serif' };
    }
    return { stroke: '#e2b14d', fill: '#fff8df', text: '#6d4d11', lineWidth: 1.25, font: '13px "Aptos", "Trebuchet MS", sans-serif' };
};

export const renderPreviewProofPageToCanvas = (
    page: PreviewProofPage,
    target: HTMLCanvasElement | OffscreenCanvas,
    options?: RenderProofPageOptions
): void => {
    const scale = options?.scale ?? 1.5;
    const paperColor = options?.paperColor ?? '#fffdf8';
    const backdrop = options?.backgroundColor ?? '#ece4d5';
    const context = resolve2dContext(target);
    const canvas = context.canvas as HTMLCanvasElement | OffscreenCanvas;

    canvas.width = Math.round(page.width * scale);
    canvas.height = Math.round(page.height * scale);
    if ('style' in canvas) {
        canvas.style.width = `${page.width}px`;
        canvas.style.height = `${page.height}px`;
    }

    context.setTransform(scale, 0, 0, scale, 0, 0);
    context.clearRect(0, 0, page.width, page.height);
    context.fillStyle = backdrop;
    context.fillRect(0, 0, page.width, page.height);
    context.fillStyle = paperColor;
    context.fillRect(0, 0, page.width, page.height);

    for (const box of page.boxes) {
        const palette = pickBoxPalette(box);
        const opacity = typeof box.opacity === 'number' ? Math.max(0, Math.min(1, box.opacity)) : 1;
        const debugStroke = options?.debugTransitions
            ? ({
                stable: '#10b981',
                geometry: '#f59e0b',
                'content-append': '#38bdf8',
                'content-swap': '#fb7185',
                enter: '#a78bfa',
                exit: '#f97316'
            }[box.transitionKind || 'stable'] || '#10b981')
            : null;

        context.save();
        context.globalAlpha = opacity;
        if (palette.fill !== 'transparent') {
            context.fillStyle = palette.fill;
            context.fillRect(box.x, box.y, box.w, box.h);
        }
        if (palette.lineWidth > 0) {
            context.strokeStyle = debugStroke || palette.stroke;
            context.lineWidth = debugStroke ? Math.max(2, palette.lineWidth + 0.75) : palette.lineWidth;
            context.strokeRect(box.x, box.y, box.w, box.h);
        }
        if (debugStroke) {
            context.strokeStyle = debugStroke;
            context.setLineDash([5, 4]);
            context.lineWidth = 1.25;
            context.strokeRect(box.x + 2, box.y + 2, Math.max(0, box.w - 4), Math.max(0, box.h - 4));
            context.setLineDash([]);
        }

        const lines = box.lines || [];
        const insetX = box.x + 10;
        let cursorY = box.y + 16;
        for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
            context.fillStyle = palette.text;
            context.font = lineIndex === 0 && palette.headingFont ? palette.headingFont : palette.font;
            context.textBaseline = 'top';
            let cursorX = insetX;
            for (const fragment of lines[lineIndex] || []) {
                const fragmentOpacity = normalizeOpacity(fragment.opacity, 1);
                if (fragmentOpacity <= 0 || !fragment.text) continue;
                context.save();
                context.globalAlpha = opacity * fragmentOpacity;
                context.fillText(fragment.text, cursorX, cursorY);
                if (options?.debugTransitions && fragmentOpacity < 0.999) {
                    const width = fragment.width || context.measureText(fragment.text).width;
                    context.strokeStyle = box.transitionKind === 'content-append' ? '#38bdf8' : '#fb7185';
                    context.lineWidth = 1;
                    context.strokeRect(cursorX - 1, cursorY - 1, width + 2, 15);
                }
                context.restore();
                cursorX += fragment.width || context.measureText(fragment.text).width;
            }
            cursorY += lineIndex === 0 && palette.headingFont ? 21 : 16;
            if (cursorY > box.y + box.h - 12) break;
        }
        context.restore();
    }
};

const resolveBoxMatchKey = (box: PreviewProofBox, fallbackIndex: number): string =>
    String(box.engineKey || '') || `${String(box.sourceId || '')}:${String(box.fragmentIndex ?? 0)}:${box.type}:${fallbackIndex}`;

const lerp = (from: number, to: number, alpha: number): number => from + (to - from) * alpha;
const lineSignature = (lines: PreviewProofTextFragment[][] | undefined): string =>
    (lines || []).map((line) => line.map((fragment) => fragment.text || '').join('')).join('\n');
const flattenLinesText = (lines: PreviewProofTextFragment[][] | undefined): string =>
    (lines || []).map((line) => collectLineText(line)).join('\n');

type ContentTransitionAnalysis =
    | { kind: 'stable' }
    | { kind: 'append'; lines: PreviewProofTextFragment[][] }
    | { kind: 'replace' };

const composeAppendLines = (
    stablePrefix: string,
    targetLines: PreviewProofTextFragment[][] | undefined,
    alpha: number
): PreviewProofTextFragment[][] => {
    const targetTexts = (targetLines || []).map((line) => collectLineText(line));
    const composed: PreviewProofTextFragment[][] = [];
    let stableRemaining = stablePrefix.length;

    for (const lineText of targetTexts) {
        if (!lineText) {
            composed.push([]);
            if (stableRemaining > 0) stableRemaining = Math.max(0, stableRemaining - 1);
            continue;
        }

        const stableCount = Math.max(0, Math.min(lineText.length, stableRemaining));
        const lineFragments: PreviewProofTextFragment[] = [];
        const stableText = lineText.slice(0, stableCount);
        const appendedText = lineText.slice(stableCount);
        if (stableText) lineFragments.push({ text: stableText, opacity: 1 });
        if (appendedText) lineFragments.push({ text: appendedText, opacity: alpha });
        composed.push(lineFragments);
        stableRemaining = Math.max(0, stableRemaining - (lineText.length + 1));
    }
    return composed;
};

const analyzeContentTransition = (
    fromLines: PreviewProofTextFragment[][] | undefined,
    toLines: PreviewProofTextFragment[][] | undefined,
    alpha: number
): ContentTransitionAnalysis => {
    if (lineSignature(fromLines) === lineSignature(toLines)) {
        return { kind: 'stable' };
    }
    const fromFlat = flattenLinesText(fromLines);
    const toFlat = flattenLinesText(toLines);
    if (fromFlat && toFlat.startsWith(fromFlat)) {
        return { kind: 'append', lines: composeAppendLines(fromFlat, toLines, alpha) };
    }
    return { kind: 'replace' };
};

const hasMeaningfulGeometryDelta = (fromBox: PreviewProofBox, toBox: PreviewProofBox): boolean => {
    const epsilon = 0.5;
    return (
        Math.abs(fromBox.x - toBox.x) > epsilon ||
        Math.abs(fromBox.y - toBox.y) > epsilon ||
        Math.abs(fromBox.w - toBox.w) > epsilon ||
        Math.abs(fromBox.h - toBox.h) > epsilon
    );
};

export const summarizePreviewTransition = (fromPage: PreviewProofPage, toPage: PreviewProofPage): PreviewTransitionSummary => {
    const summary: PreviewTransitionSummary = {
        stableCount: 0,
        geometryCount: 0,
        contentSwapCount: 0,
        contentAppendCount: 0,
        enteringCount: 0,
        exitingCount: 0
    };

    const nextBoxesByKey = new Map<string, PreviewProofBox>();
    (toPage.boxes || []).forEach((box, index) => nextBoxesByKey.set(resolveBoxMatchKey(box, index), box));

    const seenKeys = new Set<string>();
    (fromPage.boxes || []).forEach((box, index) => {
        const key = resolveBoxMatchKey(box, index);
        seenKeys.add(key);
        const nextBox = nextBoxesByKey.get(key);
        if (!nextBox) {
            summary.exitingCount += 1;
            return;
        }
        const contentTransition = analyzeContentTransition(box.lines, nextBox.lines, 1);
        const geometryChanged = hasMeaningfulGeometryDelta(box, nextBox);
        if (contentTransition.kind === 'append') summary.contentAppendCount += 1;
        else if (contentTransition.kind === 'replace') summary.contentSwapCount += 1;
        else if (geometryChanged) summary.geometryCount += 1;
        else summary.stableCount += 1;
    });

    (toPage.boxes || []).forEach((box, index) => {
        const key = resolveBoxMatchKey(box, index);
        if (!seenKeys.has(key)) summary.enteringCount += 1;
    });

    return summary;
};

export const interpolatePreviewProofPages = (fromPage: PreviewProofPage, toPage: PreviewProofPage, alpha: number): PreviewProofPage => {
    const clamped = Math.max(0, Math.min(1, alpha));
    if (clamped <= 0) return cloneProofPage(fromPage);
    if (clamped >= 1) return cloneProofPage(toPage);

    const nextBoxesByKey = new Map<string, PreviewProofBox>();
    (toPage.boxes || []).forEach((box, index) => nextBoxesByKey.set(resolveBoxMatchKey(box, index), box));

    const mergedBoxes: PreviewProofBox[] = [];
    const seenKeys = new Set<string>();

    (fromPage.boxes || []).forEach((box, index) => {
        const key = resolveBoxMatchKey(box, index);
        const nextBox = nextBoxesByKey.get(key);
        seenKeys.add(key);
        if (!nextBox) {
            mergedBoxes.push({ ...box, opacity: 1 - clamped, transitionKind: 'exit', lines: cloneLineFragments(box.lines) });
            return;
        }

        const contentTransition = analyzeContentTransition(box.lines, nextBox.lines, clamped);
        const geometryChanged = hasMeaningfulGeometryDelta(box, nextBox);
        if (contentTransition.kind === 'append') {
            mergedBoxes.push({
                ...box,
                x: lerp(box.x, nextBox.x, clamped),
                y: lerp(box.y, nextBox.y, clamped),
                w: lerp(box.w, nextBox.w, clamped),
                h: lerp(box.h, nextBox.h, clamped),
                opacity: 1,
                transitionKind: 'content-append',
                lines: cloneLineFragments(contentTransition.lines)
            });
            return;
        }
        if (contentTransition.kind === 'replace') {
            mergedBoxes.push({ ...box, opacity: 1 - clamped, transitionKind: 'content-swap', lines: cloneLineFragments(box.lines) });
            mergedBoxes.push({ ...nextBox, opacity: clamped, transitionKind: 'content-swap', lines: cloneLineFragments(nextBox.lines) });
            return;
        }
        mergedBoxes.push({
            ...box,
            x: lerp(box.x, nextBox.x, clamped),
            y: lerp(box.y, nextBox.y, clamped),
            w: lerp(box.w, nextBox.w, clamped),
            h: lerp(box.h, nextBox.h, clamped),
            opacity: 1,
            transitionKind: geometryChanged ? 'geometry' : 'stable',
            lines: cloneLineFragments(nextBox.lines)
        });
    });

    (toPage.boxes || []).forEach((box, index) => {
        const key = resolveBoxMatchKey(box, index);
        if (!seenKeys.has(key)) {
            mergedBoxes.push({ ...box, opacity: clamped, transitionKind: 'enter', lines: cloneLineFragments(box.lines) });
        }
    });

    return {
        index: fromPage.index,
        width: lerp(fromPage.width, toPage.width, clamped),
        height: lerp(fromPage.height, toPage.height, clamped),
        boxes: mergedBoxes
    };
};
