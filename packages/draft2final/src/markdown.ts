import { remark } from 'remark';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import { Draft2FinalError } from './errors';

export type MdPosition = {
    start?: { line: number; column: number };
    end?: { line: number; column: number };
};

export type MdNode = {
    type: string;
    children?: MdNode[];
    value?: string;
    lang?: string;
    depth?: number;
    ordered?: boolean;
    start?: number;
    spread?: boolean;
    url?: string;
    alt?: string;
    title?: string;
    checked?: boolean | null;
    identifier?: string;
    referenceType?: string;
    align?: Array<'left' | 'right' | 'center' | null>;
    position?: MdPosition;
};

export const KEEP_WITH_NEXT_PATTERN = /^\s*<!--\s*keep-with-next\s*-->\s*$/i;

const UNSUPPORTED_NODE_TYPES = new Set<string>(['footnoteDefinition', 'footnoteReference', 'footnote', 'delete']);

function failUnsupported(inputPath: string, node: MdNode, detail?: string): never {
    const loc = node.position?.start ? `:${node.position.start.line}:${node.position.start.column}` : '';
    throw new Draft2FinalError('parse', `${inputPath}${loc}`, detail || `Unsupported Markdown syntax: ${node.type}`, 3);
}

function validateSupportedSubset(inputPath: string, node: MdNode): void {
    if (UNSUPPORTED_NODE_TYPES.has(node.type)) {
        failUnsupported(inputPath, node);
    }
    if (node.type === 'html') {
        if (!KEEP_WITH_NEXT_PATTERN.test(node.value || '')) {
            failUnsupported(inputPath, node);
        }
    }

    if (node.type === 'list' && node.children) {
        for (const child of node.children) {
            if (child.type !== 'listItem') {
                failUnsupported(inputPath, child, `Unsupported list child node: ${child.type}`);
            }
        }
    }

    if (node.children) {
        for (const child of node.children) {
            validateSupportedSubset(inputPath, child);
        }
    }
}

export function parseMarkdownAst(markdown: string, inputPath: string): MdNode {
    try {
        const processor = remark().use(remarkParse).use(remarkGfm);
        const ast = processor.parse(markdown) as unknown as MdNode;
        validateSupportedSubset(inputPath, ast);
        return ast;
    } catch (error: unknown) {
        if (error instanceof Draft2FinalError) {
            throw error;
        }

        const message = error instanceof Error ? error.message : String(error);
        throw new Draft2FinalError('parse', inputPath, `Failed to parse Markdown: ${message}`, 3, { cause: error });
    }
}
