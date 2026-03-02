import type { DocumentInput } from '@vmprint/engine';
import type { SemanticDocument } from '../../semantic';
import type { FormatHandler } from './format-handler';
import type { ThemeDefinition } from './theme-loader';
import { FormatContextImpl } from './format-context';

/**
 * Central compile function. Feeds the semantic document through the format handler,
 * then assembles the final DocumentInput with the theme styles and collected elements.
 */
export function compile(
    document: SemanticDocument,
    handler: FormatHandler,
    theme: ThemeDefinition,
    config: Record<string, unknown>,
    layout: DocumentInput['layout'],
    inputPath: string,
): DocumentInput {
    const ctx = new FormatContextImpl(theme, config, inputPath);

    for (const node of document.children) {
        handler.handleBlock(node, ctx);
    }

    handler.flush(ctx);

    return {
        documentVersion: '1.0',
        layout,
        styles: theme.styles,
        elements: ctx.getElements(),
    };
}
