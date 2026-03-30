import type { Element, StoryFloatAlign, StoryFloatShape, StoryLayoutDirective, StoryWrapMode } from '../types';

export type NormalizedStoryChildKind =
    | 'flow'
    | 'column-span'
    | 'story-absolute'
    | 'float-image'
    | 'float-block'
    | 'block-image';

export interface NormalizedStoryLayout {
    mode?: 'float' | 'story-absolute';
    x: number;
    y: number;
    align: StoryFloatAlign;
    wrap: StoryWrapMode;
    gap: number;
    shape: StoryFloatShape;
}

export interface NormalizedStoryChild {
    childIndex: number;
    element: Element;
    kind: NormalizedStoryChildKind;
    layout?: NormalizedStoryLayout;
}

export interface NormalizedStory {
    sourceElement: Element;
    columns: number;
    gutter: number;
    balance: boolean;
    children: NormalizedStoryChild[];
}

function normalizeLayout(layout?: StoryLayoutDirective): NormalizedStoryLayout | undefined {
    if (!layout) return undefined;
    return {
        mode: layout.mode,
        x: Math.max(0, Number(layout.x ?? 0)),
        y: Math.max(0, Number(layout.y ?? 0)),
        align: (layout.align ?? 'left') as StoryFloatAlign,
        wrap: (layout.wrap ?? 'around') as StoryWrapMode,
        gap: Math.max(0, Number(layout.gap ?? 0)),
        shape: (layout.shape ?? 'rect') as StoryFloatShape
    };
}

function classifyChild(element: Element, layout?: NormalizedStoryLayout): NormalizedStoryChildKind {
    const span = element.columnSpan;
    if (span === 'all' || (typeof span === 'number' && Number.isFinite(span) && span > 1)) {
        return 'column-span';
    }
    if (layout?.mode === 'story-absolute') return 'story-absolute';
    if (layout?.mode === 'float' && element.image) return 'float-image';
    if (layout?.mode === 'float' && !element.image) return 'float-block';
    if (element.image && !layout?.mode) return 'block-image';
    return 'flow';
}

export function normalizeStoryElement(element: Element): NormalizedStory {
    const rawColumns = Math.max(1, Math.floor(Number(element.columns || 1)));
    const rawGutter = Math.max(0, Number(element.gutter ?? 0));
    const rawBalance = (element as any).balance ?? element.properties?.balance;
    const balance = rawBalance === true || rawBalance === 'true' || rawBalance === 1;
    const children = (element.children ?? []).map((child, childIndex) => {
        const layout = normalizeLayout(child.placement as StoryLayoutDirective | undefined);
        return {
            childIndex,
            element: child,
            kind: classifyChild(child, layout),
            layout
        };
    });

    return {
        sourceElement: element,
        columns: rawColumns,
        gutter: rawGutter,
        balance,
        children
    };
}
