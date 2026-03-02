import type { Element } from '@vmprint/engine';
import type { SemanticNode } from '../../semantic';
import type { ResolvedImage } from './image';

export type InlineLinkMode = 'citation' | 'inline';

export type InlineLinkOptions = {
    mode: InlineLinkMode;
    citationStyle: 'bracket' | 'paren';
    dedupe: boolean;
};

export type InlineContext = {
    linkMode: InlineLinkMode;
    citationStyle: 'bracket' | 'paren';
    dedupe: boolean;
    inlineCodeStyle?: Record<string, unknown>;
    linkStyle?: Record<string, unknown>;
    citationMarkerStyle?: Record<string, unknown>;
    inlineImageStyle?: Record<string, unknown>;
    registerLink(url: string, title?: string): number;
    resolveImage(node: SemanticNode): ResolvedImage;
};

const INLINE_CONTAINER_TYPE = 'inline';

function formatCitationMarker(index: number, style: 'bracket' | 'paren'): string {
    return style === 'paren' ? `(${index})` : `[${index}]`;
}

export function inlineToElements(nodes: SemanticNode[], ctx: InlineContext): Element[] {
    const result: Element[] = [];

    for (const node of nodes) {
        switch (node.kind) {
            case 'text':
                result.push({ type: 'text', content: node.value || '' });
                break;

            case 'inlineCode':
                result.push({
                    type: 'text',
                    content: node.value || '',
                    properties: ctx.inlineCodeStyle ? { style: { ...ctx.inlineCodeStyle } } : undefined,
                });
                break;

            case 'em':
                result.push({
                    type: INLINE_CONTAINER_TYPE,
                    content: '',
                    properties: { style: { fontStyle: 'italic' } },
                    children: inlineToElements(node.children || [], ctx),
                });
                break;

            case 'strong':
                result.push({
                    type: INLINE_CONTAINER_TYPE,
                    content: '',
                    properties: { style: { fontWeight: 700 } },
                    children: inlineToElements(node.children || [], ctx),
                });
                break;

            case 'link':
                if (ctx.linkMode === 'inline') {
                    result.push({
                        type: INLINE_CONTAINER_TYPE,
                        content: '',
                        properties: {
                            style: ctx.linkStyle ? { ...ctx.linkStyle } : undefined,
                            linkTarget: (node.url || '').trim(),
                        },
                        children: inlineToElements(node.children || [], ctx),
                    });
                    break;
                }
                // citation mode
                result.push(...inlineToElements(node.children || [], ctx));
                {
                    const citationIndex = ctx.registerLink(node.url || '', node.title);
                    if (citationIndex > 0) {
                        result.push({
                            type: 'text',
                            content: formatCitationMarker(citationIndex, ctx.citationStyle),
                            properties: ctx.citationMarkerStyle ? { style: { ...ctx.citationMarkerStyle } } : undefined,
                        });
                    }
                }
                break;

            case 'image': {
                const resolvedImage = ctx.resolveImage(node);
                result.push({
                    type: 'image',
                    content: '',
                    properties: {
                        style: ctx.inlineImageStyle ? { ...ctx.inlineImageStyle } : undefined,
                        image: {
                            data: resolvedImage.data,
                            mimeType: resolvedImage.mimeType,
                            fit: 'contain',
                        },
                        sourceRange: node.sourceRange,
                        sourceSyntax: node.sourceSyntax,
                    },
                });
                break;
            }

            default:
                break;
        }
    }

    return result;
}

export function inlinePlainText(nodes: SemanticNode[]): string {
    let out = '';
    for (const node of nodes) {
        switch (node.kind) {
            case 'text':
            case 'inlineCode':
                out += node.value || '';
                break;
            case 'em':
            case 'strong':
            case 'link':
                out += inlinePlainText(node.children || []);
                break;
            case 'image':
                out += node.alt || '';
                break;
            default:
                break;
        }
    }
    return out;
}
