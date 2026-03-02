import { Draft2FinalError } from './errors';
import { MdNode, KEEP_WITH_NEXT_PATTERN } from './markdown';

export type SourceRange = {
    lineStart: number;
    colStart: number;
    lineEnd: number;
    colEnd: number;
};

export type WithSource = {
    sourceRange?: SourceRange;
    sourceSyntax?: string;
};

export type SemanticNodeKind =
    | 'h1'
    | 'h2'
    | 'h3'
    | 'h4'
    | 'h5'
    | 'h6'
    | 'p'
    | 'ul'
    | 'ol'
    | 'li'
    | 'dl'
    | 'dt'
    | 'dd'
    | 'code'
    | 'blockquote'
    | 'hr'
    | 'table'
    | 'tableRow'
    | 'tableCell'
    | 'text'
    | 'em'
    | 'strong'
    | 'inlineCode'
    | 'link'
    | 'image';

export type SemanticNode = WithSource & {
    kind: SemanticNodeKind;
    children?: SemanticNode[];
    value?: string;
    src?: string;
    alt?: string;
    url?: string;
    title?: string;
    identifier?: string;
    referenceType?: string;
    start?: number;
    spread?: boolean;
    checked?: boolean | null;
    listTight?: boolean;
    language?: string;
    align?: Array<'left' | 'right' | 'center' | null>;
    keepWithNext?: boolean;
};

export type SemanticDocument = WithSource & {
    type: 'Document';
    children: SemanticNode[];
};

function toSource(node: MdNode, syntax?: string): WithSource {
    const start = node.position?.start;
    const end = node.position?.end;
    let sourceRange: SourceRange | undefined;

    if (start && end) {
        sourceRange = {
            lineStart: start.line,
            colStart: start.column,
            lineEnd: end.line,
            colEnd: end.column,
        };
    }

    return {
        sourceRange,
        sourceSyntax: syntax,
    };
}

type DefinitionMap = Map<string, { url: string; title?: string }>;

function normalizeIdentifier(value?: string): string {
    return (value || '').trim().toLowerCase();
}

function collectDefinitions(nodes: MdNode[]): DefinitionMap {
    const map: DefinitionMap = new Map();
    for (const node of nodes) {
        if (node.type === 'definition' && node.identifier && node.url) {
            map.set(normalizeIdentifier(node.identifier), {
                url: node.url,
                title: node.title,
            });
        }
    }
    return map;
}

function mapInline(node: MdNode, inputPath: string, definitions: DefinitionMap): SemanticNode[] {
    switch (node.type) {
        case 'text':
            return [{ kind: 'text', value: node.value || '', ...toSource(node, 'text') }];
        case 'emphasis':
            return [
                {
                    kind: 'em',
                    children: mapInlines(node.children || [], inputPath, definitions),
                    ...toSource(node, 'emphasis'),
                },
            ];
        case 'strong':
            return [
                {
                    kind: 'strong',
                    children: mapInlines(node.children || [], inputPath, definitions),
                    ...toSource(node, 'strong'),
                },
            ];
        case 'inlineCode':
            return [{ kind: 'inlineCode', value: node.value || '', ...toSource(node, 'inlineCode') }];
        case 'link':
            return [
                {
                    kind: 'link',
                    url: node.url || '',
                    title: node.title,
                    children: mapInlines(node.children || [], inputPath, definitions),
                    ...toSource(node, 'link'),
                },
            ];
        case 'linkReference': {
            const identifier = normalizeIdentifier(node.identifier);
            const definition = definitions.get(identifier);
            if (!definition) {
                throw new Draft2FinalError(
                    'normalize',
                    inputPath,
                    `Missing link definition for reference: ${node.identifier || '(unknown)'}`,
                    3,
                );
            }

            return [
                {
                    kind: 'link',
                    url: definition.url,
                    title: definition.title,
                    identifier: node.identifier,
                    referenceType: node.referenceType,
                    children: mapInlines(node.children || [], inputPath, definitions),
                    ...toSource(node, 'linkReference'),
                },
            ];
        }
        case 'image':
            return [
                {
                    kind: 'image',
                    src: node.url || '',
                    alt: node.alt || '',
                    title: node.title,
                    ...toSource(node, 'image'),
                },
            ];
        case 'imageReference': {
            const identifier = normalizeIdentifier(node.identifier);
            const definition = definitions.get(identifier);
            if (!definition) {
                throw new Draft2FinalError(
                    'normalize',
                    inputPath,
                    `Missing image definition for reference: ${node.identifier || '(unknown)'}`,
                    3,
                );
            }

            return [
                {
                    kind: 'image',
                    src: definition.url,
                    alt: node.alt || '',
                    title: node.title || definition.title,
                    identifier: node.identifier,
                    referenceType: node.referenceType,
                    ...toSource(node, 'imageReference'),
                },
            ];
        }
        case 'break':
            return [{ kind: 'text', value: '\n', ...toSource(node, 'break') }];
        default:
            throw new Draft2FinalError('normalize', inputPath, `Unsupported inline node: ${node.type}`, 3);
    }
}

function mapInlines(nodes: MdNode[], inputPath: string, definitions: DefinitionMap): SemanticNode[] {
    return nodes.flatMap((node) => mapInline(node, inputPath, definitions));
}

function flattenInlineTextForDefinition(nodes: MdNode[]): string {
    let value = '';
    for (const node of nodes) {
        if (node.type === 'text' || node.type === 'inlineCode') {
            value += node.value || '';
            continue;
        }
        if (node.type === 'break') {
            value += '\n';
            continue;
        }
        if (node.children && node.children.length > 0) {
            value += flattenInlineTextForDefinition(node.children);
        }
    }
    return value;
}

function tryDefinitionListFallback(node: MdNode): SemanticNode | null {
    if (node.type !== 'paragraph') return null;
    const raw = flattenInlineTextForDefinition(node.children || []);
    const match = raw.match(/^([^\n]+)\n:\s+([\s\S]+)$/);
    if (!match) return null;

    const term = match[1].trim();
    const definition = match[2].trim();
    if (!term || !definition) return null;

    return {
        kind: 'dl',
        children: [
            {
                kind: 'dt',
                children: [{ kind: 'text', value: term }],
            },
            {
                kind: 'dd',
                children: [{ kind: 'text', value: definition }],
            },
        ],
        ...toSource(node, 'definitionListFallback'),
    };
}

function mapListItem(node: MdNode, inputPath: string, definitions: DefinitionMap): SemanticNode {
    return {
        kind: 'li',
        children: mapBlocks(node.children || [], inputPath, definitions),
        checked: node.checked,
        spread: node.spread,
        ...toSource(node, 'listItem'),
    };
}

function mapTableCell(node: MdNode, inputPath: string, definitions: DefinitionMap): SemanticNode {
    if (node.type !== 'tableCell') {
        throw new Draft2FinalError('normalize', inputPath, `Unsupported table cell node: ${node.type}`, 3);
    }
    return {
        kind: 'tableCell',
        children: mapInlines(node.children || [], inputPath, definitions),
        ...toSource(node, 'tableCell'),
    };
}

function mapTableRow(node: MdNode, inputPath: string, definitions: DefinitionMap): SemanticNode {
    if (node.type !== 'tableRow') {
        throw new Draft2FinalError('normalize', inputPath, `Unsupported table row node: ${node.type}`, 3);
    }
    return {
        kind: 'tableRow',
        children: (node.children || []).map((cell) => mapTableCell(cell, inputPath, definitions)),
        ...toSource(node, 'tableRow'),
    };
}

function mapTable(node: MdNode, inputPath: string, definitions: DefinitionMap): SemanticNode {
    if (node.type !== 'table') {
        throw new Draft2FinalError('normalize', inputPath, `Unsupported table node: ${node.type}`, 3);
    }
    const align = Array.isArray(node.align)
        ? node.align.map((value) => (value === 'left' || value === 'right' || value === 'center' ? value : null))
        : undefined;
    return {
        kind: 'table',
        align,
        children: (node.children || []).map((row) => mapTableRow(row, inputPath, definitions)),
        ...toSource(node, 'table'),
    };
}

function mapBlock(node: MdNode, inputPath: string, definitions: DefinitionMap): SemanticNode[] {
    switch (node.type) {
        case 'heading': {
            const level = Math.min(6, Math.max(1, node.depth || 1));
            return [
                {
                    kind: `h${level}` as SemanticNodeKind,
                    children: mapInlines(node.children || [], inputPath, definitions),
                    ...toSource(node, `h${level}`),
                },
            ];
        }
        case 'paragraph':
            {
                const fallback = tryDefinitionListFallback(node);
                if (fallback) return [fallback];
            }
            return [
                {
                    kind: 'p',
                    children: mapInlines(node.children || [], inputPath, definitions),
                    ...toSource(node, 'paragraph'),
                },
            ];
        case 'list':
            return [
                {
                    kind: node.ordered ? 'ol' : 'ul',
                    children: (node.children || []).map((item) => mapListItem(item, inputPath, definitions)),
                    start: node.ordered ? node.start || 1 : undefined,
                    spread: node.spread,
                    listTight: node.spread === false,
                    ...toSource(node, node.ordered ? 'orderedList' : 'unorderedList'),
                },
            ];
        case 'code':
            return [
                {
                    kind: 'code',
                    value: node.value || '',
                    language: node.lang || undefined,
                    ...toSource(node, 'codeFence'),
                },
            ];
        case 'blockquote':
            return [
                {
                    kind: 'blockquote',
                    children: mapBlocks(node.children || [], inputPath, definitions),
                    ...toSource(node, 'blockquote'),
                },
            ];
        case 'thematicBreak':
            return [
                {
                    kind: 'hr',
                    ...toSource(node, 'thematicBreak'),
                },
            ];
        case 'definition':
            return [];
        case 'table':
            return [mapTable(node, inputPath, definitions)];
        default:
            throw new Draft2FinalError('normalize', inputPath, `Unsupported block node: ${node.type}`, 3);
    }
}

function mapBlocks(nodes: MdNode[], inputPath: string, definitions: DefinitionMap): SemanticNode[] {
    const out: SemanticNode[] = [];
    let pendingKeepWithNext = false;
    for (const node of nodes) {
        if (node.type === 'html') {
            if (KEEP_WITH_NEXT_PATTERN.test(node.value || '')) {
                pendingKeepWithNext = true;
            }
            continue;
        }

        const mapped = mapBlock(node, inputPath, definitions);
        if (pendingKeepWithNext && mapped.length > 0) {
            mapped[0] = { ...mapped[0], keepWithNext: true };
            pendingKeepWithNext = false;
        }
        if (mapped.length > 0) out.push(...mapped);
    }
    return out;
}

export function normalizeToSemantic(ast: MdNode, inputPath: string): SemanticDocument {
    if (ast.type !== 'root') {
        throw new Draft2FinalError('normalize', inputPath, `Expected root AST node, received: ${ast.type}`, 3);
    }

    const definitions = collectDefinitions(ast.children || []);

    return {
        type: 'Document',
        children: mapBlocks(ast.children || [], inputPath, definitions),
        ...toSource(ast, 'root'),
    };
}
