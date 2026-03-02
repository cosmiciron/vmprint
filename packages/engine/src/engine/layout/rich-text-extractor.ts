import { Element, ElementType, TextSegment } from '../types';

export const INLINE_OBJECT_CHAR = '\uFFFC';

function isInlineImageElement(element: Element): boolean {
    return element.type === 'image' && !!element.properties?.image;
}

function isInlineBoxElement(element: Element): boolean {
    return element.type === 'inline-box';
}

function isInlineObjectElement(element: Element): boolean {
    return isInlineImageElement(element) || isInlineBoxElement(element);
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
    inheritedLinkTarget?: string,
): TextSegment[] {
    const segments: TextSegment[] = [];
    const elementType = element.type as ElementType;
    const resolvedTypeStyle = params.resolveStyleForType(element.type) || {};
    const isInheritedTextLeaf = element.type === 'text' && inheritedStyle && Object.keys(inheritedStyle).length > 0;
    // Text leaves should inherit the surrounding block/inline style by default.
    // Applying the global `text` style on every text node would override heading
    // and emphasis typography back to body defaults.
    const explicitlyDefinedStyle = isInheritedTextLeaf ? {} : resolvedTypeStyle;
    const currentStyle = { ...inheritedStyle, ...explicitlyDefinedStyle, ...(element.properties?.style || {}) };
    const ownLinkTarget =
        typeof element.properties?.linkTarget === 'string' ? element.properties.linkTarget : undefined;
    const currentLinkTarget = ownLinkTarget || inheritedLinkTarget;

    if (isInlineImageElement(element)) {
        const imagePayload = element.properties?.image;
        if (!imagePayload) return segments;
        segments.push({
            text: INLINE_OBJECT_CHAR,
            style: currentStyle,
            fontFamily: currentStyle.fontFamily,
            ...(currentLinkTarget ? { linkTarget: currentLinkTarget } : {}),
            inlineObject: {
                kind: 'image',
                image: imagePayload,
            },
        });
        return segments;
    }

    if (isInlineBoxElement(element)) {
        segments.push({
            text: INLINE_OBJECT_CHAR,
            style: currentStyle,
            fontFamily: currentStyle.fontFamily,
            ...(currentLinkTarget ? { linkTarget: currentLinkTarget } : {}),
            inlineObject: {
                kind: 'box',
                text: element.content || '',
            },
        });
        return segments;
    }

    if (
        element.type === 'text' &&
        element.content !== undefined &&
        (!element.children || element.children.length === 0)
    ) {
        segments.push({
            text: params.transformContent(element.content, elementType),
            style: currentStyle,
            fontFamily: currentStyle.fontFamily,
            ...(currentLinkTarget ? { linkTarget: currentLinkTarget } : {}),
        });
        return segments;
    }

    if (element.children && element.children.length > 0) {
        for (const child of element.children) {
            segments.push(...getRichSegments(child, currentStyle, params, currentLinkTarget));
        }
    } else if (element.content !== undefined) {
        segments.push({
            text: params.transformContent(element.content, elementType),
            style: currentStyle,
            fontFamily: currentStyle.fontFamily,
            ...(currentLinkTarget ? { linkTarget: currentLinkTarget } : {}),
        });
    }

    return segments;
}
