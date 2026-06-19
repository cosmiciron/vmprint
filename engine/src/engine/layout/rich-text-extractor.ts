import { Element, ElementType, TextSegment } from '../types';

export const INLINE_OBJECT_CHAR = '\uFFFC';

function isInlineImageElement(element: Element): boolean {
    return element.type === 'image';
}

function isInlineBoxElement(element: Element): boolean {
    return element.type === 'inline-box';
}

function isInlineObjectElement(element: Element): boolean {
    return isInlineImageElement(element) || isInlineBoxElement(element);
}

const INHERITABLE_RICH_STYLE_KEYS = new Set([
    'fontFamily',
    'fontSize',
    'fontWeight',
    'fontStyle',
    'lineHeight',
    'lineHeightPx',
    'letterSpacing',
    'textAlign',
    'color',
    'lang',
    'direction',
    'hyphenation',
    'hyphenateCaps',
    'hyphenMinWordLength',
    'hyphenMinPrefix',
    'hyphenMinSuffix',
    'justifyEngine',
    'justifyStrategy'
]);

function pickInheritableRichStyle(style: Record<string, any> | undefined): Record<string, any> {
    const out: Record<string, any> = {};
    if (!style) return out;
    for (const key of INHERITABLE_RICH_STYLE_KEYS) {
        if (style[key] !== undefined) out[key] = style[key];
    }
    return out;
}

function readInlineMargin(value: unknown): number {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
}

function applyWrapperInlineMargins(segments: TextSegment[], style: Record<string, any>): TextSegment[] {
    if (segments.length === 0) return segments;
    const marginLeft = readInlineMargin(style.inlineMarginLeft);
    const marginRight = readInlineMargin(style.inlineMarginRight);
    if (marginLeft === 0 && marginRight === 0) return segments;

    const next = segments.slice();
    if (marginLeft !== 0) {
        const firstIndex = next.findIndex((segment) => segment.text !== '');
        if (firstIndex >= 0) {
            const first = next[firstIndex];
            next[firstIndex] = {
                ...first,
                style: {
                    ...(first.style || {}),
                    inlineMarginLeft: readInlineMargin(first.style?.inlineMarginLeft) + marginLeft
                }
            };
        }
    }
    if (marginRight !== 0) {
        for (let index = next.length - 1; index >= 0; index--) {
            const last = next[index];
            if (last.text === '') continue;
            next[index] = {
                ...last,
                style: {
                    ...(last.style || {}),
                    inlineMarginRight: readInlineMargin(last.style?.inlineMarginRight) + marginRight
                }
            };
            break;
        }
    }
    return next;
}

export function getElementText(element: Element): string {
    if (isInlineObjectElement(element)) {
        return INLINE_OBJECT_CHAR;
    }

    if (element.content) {
        if (element.content === '\n') return '\n';
        return element.content.replace(/[\r\t]+/g, ' ');
    }

    if (element.children) {
        return element.children.map((child) => getElementText(child)).join('');
    }

    return '';
}

export function sliceElements(elements: Element[], start: number, end: number): Element[] {
    let currentPos = 0;
    const result: Element[] = [];

    for (const element of elements) {
        const elementText = getElementText(element);
        const elementLength = elementText.length;
        const elementEnd = currentPos + elementLength;

        if (elementEnd > start && currentPos < end) {
            const sliceStart = Math.max(0, start - currentPos);
            const sliceEnd = Math.min(elementLength, end - currentPos);

            if (element.children && element.children.length > 0) {
                const slicedChildren = sliceElements(element.children, sliceStart, sliceEnd);
                result.push({ ...element, children: slicedChildren, content: '' });
            } else if (isInlineObjectElement(element)) {
                result.push({ ...element, children: [] });
            } else {
                result.push({ ...element, content: elementText.substring(sliceStart, sliceEnd), children: [] });
            }
        }
        currentPos = elementEnd;
    }
    return result;
}

export function getNodeText(node: any): string {
    if (node.value) return node.value;
    if (node.children) {
        return node.children.map((c: any) => getNodeText(c)).join('');
    }
    return '';
}

export function getRichSegments(
    element: Element,
    inheritedStyle: any,
    params: {
        transformContent: (text: string, elementType: ElementType) => string;
        resolveStyleForType: (type: string) => Record<string, any>;
    },
    inheritedLinkTarget?: string
): TextSegment[] {
    const startingOffset = Number.isFinite(Number(element.properties?._sourceSliceStart))
        ? Math.max(0, Number(element.properties._sourceSliceStart))
        : 0;
    const cursor = { value: startingOffset };
    return getRichSegmentsAtOffset(element, inheritedStyle, params, cursor, inheritedLinkTarget);
}

function getRichSegmentsAtOffset(
    element: Element,
    inheritedStyle: any,
    params: {
        transformContent: (text: string, elementType: ElementType) => string;
        resolveStyleForType: (type: string) => Record<string, any>;
    },
    cursor: { value: number },
    inheritedLinkTarget?: string
): TextSegment[] {
    const segments: TextSegment[] = [];
    const elementType = element.type as ElementType;
    const resolvedTypeStyle = params.resolveStyleForType(element.type) || {};
    const isInheritedTextLeaf = element.type === 'text' && inheritedStyle && Object.keys(inheritedStyle).length > 0;
    // Text leaves should inherit the surrounding block/inline style by default.
    // Applying the global `text` style on every text node would override heading
    // and emphasis typography back to body defaults.
    const explicitlyDefinedStyle = isInheritedTextLeaf ? {} : resolvedTypeStyle;
    const inheritedTextStyle = pickInheritableRichStyle(inheritedStyle);
    const currentStyle = { ...inheritedTextStyle, ...explicitlyDefinedStyle, ...(element.properties?.style || {}) };
    const ownLinkTarget = typeof element.properties?.linkTarget === 'string' ? element.properties.linkTarget : undefined;
    const currentLinkTarget = ownLinkTarget || inheritedLinkTarget;

    if (isInlineImageElement(element)) {
        const imagePayload = element.image;
        const sourceStart = cursor.value;
        const sourceEnd = sourceStart + INLINE_OBJECT_CHAR.length;
        cursor.value = sourceEnd;
        segments.push({
            text: INLINE_OBJECT_CHAR,
            sourceStart,
            sourceEnd,
            style: currentStyle,
            fontFamily: currentStyle.fontFamily,
            ...(currentLinkTarget ? { linkTarget: currentLinkTarget } : {}),
            inlineObject: imagePayload ? {
                kind: 'image',
                image: imagePayload
            } : {
                kind: 'box',
                text: '',
                replaced: true
            }
        });
        return segments;
    }

    if (isInlineBoxElement(element)) {
        const sourceStart = cursor.value;
        const sourceEnd = sourceStart + INLINE_OBJECT_CHAR.length;
        cursor.value = sourceEnd;
        segments.push({
            text: INLINE_OBJECT_CHAR,
            sourceStart,
            sourceEnd,
            style: currentStyle,
            fontFamily: currentStyle.fontFamily,
            ...(currentLinkTarget ? { linkTarget: currentLinkTarget } : {}),
            inlineObject: {
                kind: 'box',
                text: element.content || ''
            }
        });
        return segments;
    }

    if (element.type === 'text' && element.content !== undefined && (!element.children || element.children.length === 0)) {
        const text = params.transformContent(element.content, elementType);
        const sourceStart = cursor.value;
        const sourceEnd = sourceStart + text.length;
        cursor.value = sourceEnd;
        segments.push({
            text,
            sourceStart,
            sourceEnd,
            style: currentStyle,
            fontFamily: currentStyle.fontFamily,
            ...(currentLinkTarget ? { linkTarget: currentLinkTarget } : {})
        });
        return segments;
    }

    if (element.children && element.children.length > 0) {
        const childInheritedStyle = pickInheritableRichStyle(currentStyle);
        const childSegments: TextSegment[] = [];
        for (const child of element.children) {
            childSegments.push(...getRichSegmentsAtOffset(child, childInheritedStyle, params, cursor, currentLinkTarget));
        }
        segments.push(...applyWrapperInlineMargins(childSegments, currentStyle));
    } else if (element.content !== undefined) {
        const text = params.transformContent(element.content, elementType);
        const sourceStart = cursor.value;
        const sourceEnd = sourceStart + text.length;
        cursor.value = sourceEnd;
        segments.push({
            text,
            sourceStart,
            sourceEnd,
            style: currentStyle,
            fontFamily: currentStyle.fontFamily,
            ...(currentLinkTarget ? { linkTarget: currentLinkTarget } : {})
        });
    }

    return segments;
}
