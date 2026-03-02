import type { Element } from '@vmprint/engine';
import type { SemanticNode } from '../../semantic';
import { inlinePlainText, type FormatHandler, type FormatContext } from '../compiler';

// ─── Role names ───────────────────────────────────────────────────────────────

const roles = {
    title: 'title',
    titleMeta: 'title-meta',
    titleContact: 'title-contact',
    sceneHeading: 'scene-heading',
    action: 'action',
    character: 'character',
    parenthetical: 'parenthetical',
    dialogue: 'dialogue',
    characterDualLeft: 'character-dual-left',
    parentheticalDualLeft: 'parenthetical-dual-left',
    dialogueDualLeft: 'dialogue-dual-left',
    characterDualRight: 'character-dual-right',
    parentheticalDualRight: 'parenthetical-dual-right',
    dialogueDualRight: 'dialogue-dual-right',
    transition: 'transition',
    intertitle: 'intertitle',
    insert: 'insert',
    more: 'more',
    beat: 'beat',
} as const;

// ─── Production config ────────────────────────────────────────────────────────

type ScreenplayProductionConfig = {
    sceneNumbersEnabled: boolean;
    sceneNumberStart: number;
    sceneNumberPad: number;
    sceneNumberStyle: 'decimal' | 'alpha';
    lockedPagesEnabled: boolean;
    lockedPagesRevisionLabel: string;
    lockedPagesPlacement: 'suffix' | 'prefix';
};

type Cfg = Record<string, unknown>;

// cfg is intentionally a local helper here: screenplay uses only the generic
// path-traversal form; the full cfgStr/cfgBool/cfgNum/cfgArr set in
// markdown/format.ts is not shared to keep the two formats independently legible.
function cfg<T>(config: Cfg, ...path: string[]): T | undefined {
    let cur: unknown = config;
    for (const key of path) {
        if (!cur || typeof cur !== 'object') return undefined;
        cur = (cur as Cfg)[key];
    }
    return cur as T;
}

function resolveProduction(config: Cfg): ScreenplayProductionConfig {
    const sceneCfg = cfg<Cfg>(config, 'production', 'sceneNumbers') || {};
    const lockedCfg = cfg<Cfg>(config, 'production', 'lockedPages') || {};
    return {
        sceneNumbersEnabled: sceneCfg.enabled === true,
        sceneNumberStart: Math.max(1, Math.floor(Number(sceneCfg.start ?? 1))),
        sceneNumberPad: Math.max(0, Math.floor(Number(sceneCfg.pad ?? 0))),
        sceneNumberStyle: sceneCfg.style === 'alpha' ? 'alpha' : 'decimal',
        lockedPagesEnabled: lockedCfg.enabled === true,
        lockedPagesRevisionLabel: String(lockedCfg.revisionLabel ?? 'A').trim() || 'A',
        lockedPagesPlacement: lockedCfg.placement === 'prefix' ? 'prefix' : 'suffix',
    };
}

// ─── SemanticNode helpers ─────────────────────────────────────────────────────

// inlinePlainText (from compiler/inline.ts) is used instead of a local copy.

function uppercaseNodes(nodes: SemanticNode[]): SemanticNode[] {
    return nodes.map((n) => {
        if (n.kind === 'text') return { ...n, value: (n.value || '').toUpperCase() };
        if (n.children) return { ...n, children: uppercaseNodes(n.children) };
        return n;
    });
}

/** Returns the inline content of a list item, unwrapping a tight paragraph if present. */
function listItemContent(item: SemanticNode): SemanticNode[] {
    const children = item.children || [];
    if (children.length === 1 && children[0].kind === 'p') return children[0].children || [];
    return children;
}

// ─── InlinePart infrastructure (dialogue line parsing) ────────────────────────
//
// InlinePart is a format-level intermediate used exclusively for parsing the
// cue/parenthetical/dialogue line structure within a blockquote. It is NOT the
// visual element pipeline — that runs through ctx.emit() → compiler/inline.ts.

type InlinePart = {
    text: string;
    style?: Record<string, unknown>;
};

function stylesEqual(a?: Record<string, unknown>, b?: Record<string, unknown>): boolean {
    if (!a && !b) return true;
    if (!a || !b) return false;
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    if (aKeys.length !== bKeys.length) return false;
    for (const key of aKeys) {
        if (a[key] !== b[key]) return false;
    }
    return true;
}

function mergeInlineStyle(
    base?: Record<string, unknown>,
    next?: Record<string, unknown>,
): Record<string, unknown> | undefined {
    const merged = { ...(base || {}), ...(next || {}) };
    return Object.keys(merged).length > 0 ? merged : undefined;
}

function pushInlinePart(parts: InlinePart[], text: string, style?: Record<string, unknown>): void {
    if (!text) return;
    const normalizedStyle = style && Object.keys(style).length > 0 ? style : undefined;
    const last = parts[parts.length - 1];
    if (last && stylesEqual(last.style, normalizedStyle)) {
        last.text += text;
        return;
    }
    parts.push(normalizedStyle ? { text, style: normalizedStyle } : { text });
}

function inlinePartsToPlainText(parts: InlinePart[]): string {
    return parts.map((p) => p.text).join('');
}

function hasInlineContent(parts: InlinePart[]): boolean {
    return inlinePartsToPlainText(parts).trim().length > 0;
}

function normalizeInlineParts(parts: InlinePart[]): InlinePart[] {
    const out: InlinePart[] = [];
    let pendingSpace = false;

    for (const part of parts) {
        for (const char of part.text) {
            if (/\s/.test(char)) {
                pendingSpace = true;
                continue;
            }
            if (pendingSpace && out.length > 0) pushInlinePart(out, ' ');
            pendingSpace = false;
            pushInlinePart(out, char, part.style);
        }
    }

    return out;
}

/**
 * Convert InlinePart[] → Element[]. Used ONLY to build dialogue children,
 * since dialogue needs multi-paragraph structure + paginationContinuation
 * metadata passed through ctx.emitRaw().
 */
function inlinePartsToElements(parts: InlinePart[]): Element[] {
    const elements: Element[] = [];
    for (const part of parts) {
        if (!part.text) continue;
        elements.push(
            part.style
                ? { type: 'text', content: part.text, properties: { style: { ...part.style } } }
                : { type: 'text', content: part.text },
        );
    }
    return elements;
}

function inlineNodesToParts(nodes: SemanticNode[], inheritedStyle?: Record<string, unknown>): InlinePart[] {
    const parts: InlinePart[] = [];
    for (const node of nodes) {
        switch (node.kind) {
            case 'text':
            case 'inlineCode':
                pushInlinePart(parts, node.value || '', inheritedStyle);
                break;
            case 'em':
                parts.push(
                    ...inlineNodesToParts(
                        node.children || [],
                        mergeInlineStyle(inheritedStyle, { fontStyle: 'italic' }),
                    ),
                );
                break;
            case 'strong':
                parts.push(
                    ...inlineNodesToParts(node.children || [], mergeInlineStyle(inheritedStyle, { fontWeight: 700 })),
                );
                break;
            case 'link':
                parts.push(...inlineNodesToParts(node.children || [], inheritedStyle));
                break;
            default:
                break;
        }
    }
    return parts;
}

// ─── Dialogue line structure ───────────────────────────────────────────────────

type DialogueBreakKind = 'soft' | 'hard';

type DialogueLine = {
    parts: InlinePart[];
    breakAfter?: DialogueBreakKind;
};

type DialogueParagraph = {
    lines: DialogueLine[];
};

type DialogueToken = { kind: 'text'; value: string; style?: Record<string, unknown> } | { kind: 'hardBreak' };

function collectDialogueTokens(nodes: SemanticNode[], inheritedStyle?: Record<string, unknown>): DialogueToken[] {
    const tokens: DialogueToken[] = [];
    for (const node of nodes) {
        switch (node.kind) {
            case 'text': {
                const value = node.value || '';
                if (node.sourceSyntax === 'break' && value === '\n') {
                    tokens.push({ kind: 'hardBreak' });
                } else {
                    tokens.push({ kind: 'text', value, style: inheritedStyle });
                }
                break;
            }
            case 'inlineCode':
                tokens.push({ kind: 'text', value: node.value || '', style: inheritedStyle });
                break;
            case 'em':
                tokens.push(
                    ...collectDialogueTokens(
                        node.children || [],
                        mergeInlineStyle(inheritedStyle, { fontStyle: 'italic' }),
                    ),
                );
                break;
            case 'strong':
                tokens.push(
                    ...collectDialogueTokens(
                        node.children || [],
                        mergeInlineStyle(inheritedStyle, { fontWeight: 700 }),
                    ),
                );
                break;
            case 'link':
                tokens.push(...collectDialogueTokens(node.children || [], inheritedStyle));
                break;
            default:
                break;
        }
    }
    return tokens;
}

function paragraphNodeToDialogueLines(paragraph: SemanticNode): DialogueLine[] {
    const tokens = collectDialogueTokens(paragraph.children || []);
    const lines: DialogueLine[] = [{ parts: [] }];

    const pushBreak = (kind: DialogueBreakKind) => {
        lines[lines.length - 1].breakAfter = kind;
        lines.push({ parts: [] });
    };

    for (const token of tokens) {
        if (token.kind === 'hardBreak') {
            pushBreak('hard');
            continue;
        }
        const parts = token.value.split(/\r?\n/);
        pushInlinePart(lines[lines.length - 1].parts, parts[0] || '', token.style);
        for (let idx = 1; idx < parts.length; idx += 1) {
            pushBreak('soft');
            pushInlinePart(lines[lines.length - 1].parts, parts[idx] || '', token.style);
        }
    }

    return lines;
}

function dialogueLineText(line: DialogueLine): string {
    return inlinePartsToPlainText(normalizeInlineParts(line.parts));
}

function findNextNonEmptyLineIndex(lines: DialogueLine[], startIndex: number): number {
    for (let idx = Math.max(0, startIndex); idx < lines.length; idx += 1) {
        if (dialogueLineText(lines[idx]).length > 0) return idx;
    }
    return -1;
}

function buildDialogueParagraphParts(lines: DialogueLine[], startIndex: number = 0): InlinePart[] {
    const sliced = lines.slice(startIndex);
    if (sliced.length === 0) return [];

    const normalizedSegments = sliced.map((line) => normalizeInlineParts(line.parts));
    if (normalizedSegments.every((seg) => seg.length === 0)) return [];

    let firstNonEmpty = -1;
    let lastNonEmpty = -1;
    for (let idx = 0; idx < normalizedSegments.length; idx += 1) {
        if (normalizedSegments[idx].length > 0) {
            if (firstNonEmpty < 0) firstNonEmpty = idx;
            lastNonEmpty = idx;
        }
    }
    if (firstNonEmpty < 0) return [];

    const textParts: InlinePart[] = [];
    for (let idx = firstNonEmpty; idx <= lastNonEmpty; idx += 1) {
        if (idx > firstNonEmpty) {
            const separator = sliced[idx - 1].breakAfter === 'hard' ? '\n' : ' ';
            pushInlinePart(textParts, separator);
        }
        for (const part of normalizedSegments[idx]) {
            pushInlinePart(textParts, part.text, part.style);
        }
    }
    return textParts;
}

function buildDialogueChildren(paragraphs: InlinePart[][]): Element[] {
    const children: Element[] = [];
    for (let idx = 0; idx < paragraphs.length; idx += 1) {
        if (idx > 0) children.push({ type: 'text', content: '\n\n' });
        children.push(...inlinePartsToElements(paragraphs[idx]));
    }
    return children;
}

// ─── Block helpers ────────────────────────────────────────────────────────────

function blockToInlineParts(block: SemanticNode): InlinePart[] {
    switch (block.kind) {
        case 'h1':
        case 'h2':
        case 'h3':
        case 'h4':
        case 'h5':
        case 'h6':
        case 'p':
            return normalizeInlineParts(inlineNodesToParts(block.children || []));
        case 'code':
            return normalizeInlineParts([{ text: block.value || '' }]);
        case 'blockquote':
        case 'ul':
        case 'ol':
        case 'li': {
            const out: InlinePart[] = [];
            for (const child of block.children || []) {
                const childParts = blockToInlineParts(child);
                if (childParts.length === 0) continue;
                if (out.length > 0) pushInlinePart(out, ' ');
                for (const part of childParts) pushInlinePart(out, part.text, part.style);
            }
            return out;
        }
        default:
            return [];
    }
}

function blockquoteDialogueParagraphs(block: SemanticNode): DialogueParagraph[] {
    const paragraphs: DialogueParagraph[] = [];
    for (const child of block.children || []) {
        if (child.kind === 'p') {
            paragraphs.push({ lines: paragraphNodeToDialogueLines(child) });
        } else if (child.kind === 'code') {
            const codeParts = normalizeInlineParts([{ text: child.value || '' }]);
            if (codeParts.length > 0) paragraphs.push({ lines: [{ parts: codeParts }] });
        } else {
            const fallbackParts = blockToInlineParts(child);
            if (fallbackParts.length > 0) paragraphs.push({ lines: [{ parts: fallbackParts }] });
        }
    }
    return paragraphs;
}

// ─── Speaker cue parsing ──────────────────────────────────────────────────────

type SpeakerCue = {
    name: string;
    qualifier?: string;
    hasContd: boolean;
    dual: boolean;
};

const SPEAKER_CUE_PATTERN = /^@([^\n()]{1,48})(?:\s+\(([^)]+)\))?$/i;

function parseSpeakerCue(line: string): SpeakerCue | null {
    const normalized = line.trim().replace(/\s+/g, ' ');
    const dual = normalized.endsWith('^');
    const withoutDual = dual ? normalized.slice(0, -1).trimEnd() : normalized;
    const match = withoutDual.match(SPEAKER_CUE_PATTERN);
    if (!match) return null;
    const name = (match[1] || '').trim().replace(/\s+/g, ' ');
    if (!name) return null;
    const qualifier = (match[2] || '').trim().replace(/\s+/g, ' ');
    const hasContd = /CONT'?D/i.test(qualifier);
    return { name, qualifier: qualifier || undefined, hasContd, dual };
}

function formatSpeakerCue(cue: SpeakerCue, forceContd: boolean): string {
    const chunks: string[] = [];
    if (cue.qualifier) chunks.push(cue.qualifier.toUpperCase());
    if (forceContd && !cue.hasContd) chunks.push("CONT'D");
    const base = cue.name.toUpperCase();
    if (chunks.length === 0) return base;
    return `${base} (${chunks.join(') (')})`;
}

function ensureParenthetical(value: string): string {
    const trimmed = value.trim();
    if (!trimmed) return '(...)';
    if (trimmed.startsWith('(') && trimmed.endsWith(')')) return trimmed;
    return `(${trimmed})`;
}

function isTransitionParagraph(value: string): boolean {
    const normalized = value.trim().replace(/\s+/g, ' ');
    if (!normalized.endsWith(':')) return false;
    if (normalized !== normalized.toUpperCase()) return false;
    return /^[A-Z0-9 .'"()/-]+:$/.test(normalized);
}

function isSceneHeadingLine(value: string): boolean {
    return /^(INT\.|EXT\.|INT\/EXT\.|EST\.)/i.test(value.trim().replace(/\s+/g, ' '));
}

// ─── Title meta parsing ───────────────────────────────────────────────────────

type TitleMetaKind = 'meta' | 'contact' | 'unknown';

function parseTitleMeta(raw: string): { key?: string; value: string; kind: TitleMetaKind } {
    const line = raw.trim().replace(/\s+/g, ' ');
    const match = line.match(/^([^:]{1,48}):\s*(.+)$/);
    if (!match) return { value: line, kind: 'unknown' };
    const key = (match[1] || '').trim().toLowerCase().replace(/\s+/g, ' ');
    const value = (match[2] || '').trim().replace(/\s+/g, ' ');
    if (!value) return { key, value: line, kind: 'unknown' };
    const contactKeys = new Set([
        'contact',
        'email',
        'phone',
        'address',
        'agent',
        'manager',
        'representation',
        'website',
    ]);
    if (contactKeys.has(key)) return { key, value: `${match[1].trim()}: ${value}`, kind: 'contact' };
    return { key, value: `${match[1].trim()}: ${value}`, kind: 'meta' };
}

// ─── Scene number formatting ──────────────────────────────────────────────────

function formatSceneNumber(value: number, config: ScreenplayProductionConfig, ctx: FormatContext): string {
    const raw = config.sceneNumberStyle === 'alpha' ? ctx.formatNumber(value, 'upper-alpha') : String(value);
    if (config.sceneNumberPad <= 0) return raw;
    return raw.padStart(config.sceneNumberPad, '0');
}

// ─── Dialogue turn emission ───────────────────────────────────────────────────

type DialogueTurnEmission = {
    cue: SpeakerCue;
    characterText: string;
    parentheticalText?: string;
    dialogueParagraphs: InlinePart[][];
    isDual: boolean;
    sourceNode: SemanticNode;
} | null;

function buildDialogueTurn(block: SemanticNode): DialogueTurnEmission {
    const paragraphs = blockquoteDialogueParagraphs(block);
    if (paragraphs.length === 0) return null;

    const firstParagraph = paragraphs[0];
    const cueLineIndex = findNextNonEmptyLineIndex(firstParagraph.lines, 0);
    if (cueLineIndex < 0) return null;

    const cue = parseSpeakerCue(dialogueLineText(firstParagraph.lines[cueLineIndex]));
    if (!cue) return null;

    let consumedThroughLine = cueLineIndex;
    let parentheticalText: string | undefined;
    const parentheticalLineIndex = findNextNonEmptyLineIndex(firstParagraph.lines, cueLineIndex + 1);
    if (parentheticalLineIndex >= 0) {
        const candidate = dialogueLineText(firstParagraph.lines[parentheticalLineIndex]).trim();
        if (/^\(.*\)$/.test(candidate)) {
            parentheticalText = ensureParenthetical(candidate);
            consumedThroughLine = parentheticalLineIndex;
        }
    }

    const dialogueParagraphs: InlinePart[][] = [];
    for (let pIdx = 0; pIdx < paragraphs.length; pIdx += 1) {
        const paragraph = paragraphs[pIdx];
        const startIndex = pIdx === 0 ? consumedThroughLine + 1 : 0;
        const parts = buildDialogueParagraphParts(paragraph.lines, startIndex);
        if (parts.length > 0) dialogueParagraphs.push(parts);
    }

    return {
        cue,
        characterText: formatSpeakerCue(cue, false),
        parentheticalText,
        dialogueParagraphs,
        isDual: cue.dual,
        sourceNode: block,
    };
}

type DialogueSide = 'mono' | 'left' | 'right';

function dialogueRoles(side: DialogueSide) {
    if (side === 'left')
        return {
            character: roles.characterDualLeft,
            parenthetical: roles.parentheticalDualLeft,
            dialogue: roles.dialogueDualLeft,
        };
    if (side === 'right')
        return {
            character: roles.characterDualRight,
            parenthetical: roles.parentheticalDualRight,
            dialogue: roles.dialogueDualRight,
        };
    return { character: roles.character, parenthetical: roles.parenthetical, dialogue: roles.dialogue };
}

function emitTurn(
    turn: NonNullable<DialogueTurnEmission>,
    side: DialogueSide,
    ctx: FormatContext,
    extraFirstProps?: Record<string, unknown>,
): void {
    const r = dialogueRoles(side);
    const src = turn.sourceNode;

    ctx.emit(r.character, formatSpeakerCue(turn.cue, false), {
        sourceRange: src.sourceRange,
        sourceSyntax: src.sourceSyntax,
        ...(extraFirstProps || {}),
    });

    if (turn.parentheticalText) {
        ctx.emit(r.parenthetical, turn.parentheticalText, {
            sourceRange: src.sourceRange,
            sourceSyntax: src.sourceSyntax,
        });
    }

    if (turn.dialogueParagraphs.length === 0) return;

    const continuationMarkersBeforeContinuation: Array<Record<string, unknown>> = [
        {
            type: r.character,
            content: formatSpeakerCue(turn.cue, true),
            properties: { keepWithNext: true },
        },
    ];
    if (turn.parentheticalText) {
        continuationMarkersBeforeContinuation.push({
            type: r.parenthetical,
            content: turn.parentheticalText,
            properties: { keepWithNext: true },
        });
    }

    const dialogueElement: Element = {
        type: r.dialogue,
        content: '',
        children: buildDialogueChildren(turn.dialogueParagraphs),
        properties: {
            sourceRange: src.sourceRange,
            sourceSyntax: src.sourceSyntax,
            paginationContinuation: {
                enabled: true,
                markerAfterSplit: {
                    type: roles.more,
                    content: '(MORE)',
                },
                markersBeforeContinuation: continuationMarkersBeforeContinuation,
                markerBeforeContinuation: {
                    type: r.character,
                    content: formatSpeakerCue(turn.cue, true),
                    properties: { keepWithNext: true },
                },
            },
        },
    };

    ctx.emitRaw(dialogueElement);
}

// ─── Main block dispatcher ────────────────────────────────────────────────────

function processBlocks(blocks: SemanticNode[], production: ScreenplayProductionConfig, ctx: FormatContext): void {
    let seenSceneHeading = false;
    let emittedTitleContact = false;
    let hasTitle = false;
    let coverBreakPending = false;
    let insertedCoverBreak = false;
    let sceneNumber = production.sceneNumberStart;

    const consumeCoverBreak = (): Record<string, unknown> | undefined => {
        if (!coverBreakPending || insertedCoverBreak) return undefined;
        insertedCoverBreak = true;
        return { style: { pageBreakBefore: true } };
    };

    const coverPageMeta = (): Record<string, unknown> => ({
        layoutDirectives: { suppressPageNumber: true },
    });

    for (let blockIndex = 0; blockIndex < blocks.length; blockIndex += 1) {
        const block = blocks[blockIndex];
        const nextBlock = blocks[blockIndex + 1];

        switch (block.kind) {
            case 'h1': {
                const contentParts = normalizeInlineParts(inlineNodesToParts(block.children || []));
                if (!hasInlineContent(contentParts)) break;
                hasTitle = true;
                coverBreakPending = true;
                ctx.emit(roles.title, block.children || [], {
                    sourceRange: block.sourceRange,
                    sourceSyntax: block.sourceSyntax,
                    ...coverPageMeta(),
                });
                break;
            }

            case 'h2': {
                const children = block.children || [];
                let sceneChildren: SemanticNode[] = uppercaseNodes(children);
                if (production.sceneNumbersEnabled) {
                    const num = formatSceneNumber(sceneNumber, production, ctx);
                    sceneNumber += 1;
                    sceneChildren = [
                        { kind: 'text', value: `${num} ` },
                        ...sceneChildren,
                        { kind: 'text', value: ` ${num}` },
                    ];
                }
                if (!inlinePlainText(sceneChildren).trim()) break;
                seenSceneHeading = true;
                ctx.emit(roles.sceneHeading, sceneChildren, {
                    sourceRange: block.sourceRange,
                    sourceSyntax: block.sourceSyntax,
                    ...consumeCoverBreak(),
                });
                break;
            }

            case 'h3': {
                const contentParts = normalizeInlineParts(inlineNodesToParts(block.children || []));
                const content = inlinePartsToPlainText(contentParts);
                if (!content) break;
                if (content.endsWith(':')) {
                    ctx.emit(roles.transition, uppercaseNodes(block.children || []), {
                        sourceRange: block.sourceRange,
                        sourceSyntax: block.sourceSyntax,
                        ...consumeCoverBreak(),
                    });
                } else {
                    ctx.emit(roles.action, block.children || [], {
                        sourceRange: block.sourceRange,
                        sourceSyntax: block.sourceSyntax,
                        ...consumeCoverBreak(),
                    });
                }
                break;
            }

            case 'h4':
            case 'h5':
            case 'h6': {
                const content = inlinePlainText(block.children || []);
                if (!content.trim()) break;
                ctx.emit(roles.intertitle, uppercaseNodes(block.children || []), {
                    sourceRange: block.sourceRange,
                    sourceSyntax: block.sourceSyntax,
                    ...consumeCoverBreak(),
                });
                break;
            }

            case 'p': {
                const contentParts = normalizeInlineParts(inlineNodesToParts(block.children || []));
                const content = inlinePartsToPlainText(contentParts);
                if (!content) break;
                if (isSceneHeadingLine(content)) {
                    seenSceneHeading = true;
                    let sceneChildren = uppercaseNodes(block.children || []);
                    if (production.sceneNumbersEnabled) {
                        const num = formatSceneNumber(sceneNumber, production, ctx);
                        sceneNumber += 1;
                        sceneChildren = [
                            { kind: 'text', value: `${num} ` },
                            ...sceneChildren,
                            { kind: 'text', value: ` ${num}` },
                        ];
                    }
                    ctx.emit(roles.sceneHeading, sceneChildren, {
                        sourceRange: block.sourceRange,
                        sourceSyntax: block.sourceSyntax,
                        ...consumeCoverBreak(),
                    });
                    break;
                }
                if (isTransitionParagraph(content)) {
                    ctx.emit(roles.transition, uppercaseNodes(block.children || []), {
                        sourceRange: block.sourceRange,
                        sourceSyntax: block.sourceSyntax,
                        ...consumeCoverBreak(),
                    });
                    break;
                }
                ctx.emit(roles.action, block.children || [], {
                    sourceRange: block.sourceRange,
                    sourceSyntax: block.sourceSyntax,
                    ...consumeCoverBreak(),
                });
                break;
            }

            case 'code': {
                const breakProps = consumeCoverBreak();
                ctx.emit(roles.insert, block.value || '', {
                    sourceRange: block.sourceRange,
                    sourceSyntax: block.sourceSyntax,
                    ...(breakProps || {}),
                });
                break;
            }

            case 'blockquote': {
                const turn = buildDialogueTurn(block);

                // No valid cue — emit as action fallback
                if (!turn) {
                    const parts = blockToInlineParts(block);
                    if (parts.length > 0) {
                        const fallbackChildren: SemanticNode[] = parts.map((p) =>
                            p.style
                                ? { kind: 'text' as const, value: p.text }
                                : { kind: 'text' as const, value: p.text },
                        );
                        ctx.emit(roles.action, block.children || [fallbackChildren[0]], {
                            sourceRange: block.sourceRange,
                            sourceSyntax: block.sourceSyntax,
                            ...consumeCoverBreak(),
                        });
                    }
                    break;
                }

                // Dual dialogue: two consecutive cue-prefixed blockquotes with ^
                if (turn.isDual && nextBlock?.kind === 'blockquote') {
                    const nextTurn = buildDialogueTurn(nextBlock);
                    if (nextTurn?.isDual) {
                        const breakProps = consumeCoverBreak();
                        emitTurn(turn, 'left', ctx, breakProps);
                        // Right turn: marginTop: 0 on first element (character row)
                        emitTurn(nextTurn, 'right', ctx, { style: { marginTop: 0 } });
                        blockIndex += 1;
                        break;
                    }
                }

                const breakProps = consumeCoverBreak();
                emitTurn(turn, 'mono', ctx, breakProps);
                break;
            }

            case 'ul':
            case 'ol': {
                const orderedStart = block.start || 1;
                const items = (block.children || []).filter((item) => item.kind === 'li');

                for (let idx = 0; idx < items.length; idx += 1) {
                    const item = items[idx];
                    const itemContent = listItemContent(item);
                    const raw = inlinePlainText(itemContent).trim();
                    if (!raw) continue;

                    if (!seenSceneHeading) {
                        // Title page list: classify as meta/contact
                        const parsed = parseTitleMeta(raw);
                        const extraStyle: Record<string, unknown> | undefined =
                            parsed.kind === 'contact' && !emittedTitleContact ? { marginTop: 256 } : undefined;

                        if (parsed.kind === 'contact') {
                            ctx.emit(roles.titleContact, itemContent, {
                                sourceRange: item.sourceRange,
                                sourceSyntax: item.sourceSyntax,
                                ...(hasTitle ? coverPageMeta() : {}),
                                ...(extraStyle ? { style: extraStyle } : {}),
                            });
                            emittedTitleContact = true;
                        } else {
                            ctx.emit(roles.titleMeta, itemContent, {
                                sourceRange: item.sourceRange,
                                sourceSyntax: item.sourceSyntax,
                                ...(hasTitle ? coverPageMeta() : {}),
                            });
                        }
                    } else {
                        // In-script list → action with marker prefix
                        const marker = block.kind === 'ul' ? '- ' : `${orderedStart + idx}. `;
                        const prefixedContent: SemanticNode[] = [{ kind: 'text', value: marker }, ...itemContent];
                        ctx.emit(roles.action, prefixedContent, {
                            sourceRange: item.sourceRange,
                            sourceSyntax: item.sourceSyntax,
                            ...consumeCoverBreak(),
                        });
                    }
                }
                break;
            }

            case 'hr': {
                ctx.emit(roles.beat, '', {
                    sourceRange: block.sourceRange,
                    sourceSyntax: block.sourceSyntax,
                    ...consumeCoverBreak(),
                });
                break;
            }

            default:
                break;
        }
    }
}

// ─── ScreenplayFormat ─────────────────────────────────────────────────────────

export class ScreenplayFormat implements FormatHandler {
    private readonly blocks: SemanticNode[] = [];
    private readonly production: ScreenplayProductionConfig;

    constructor(config: Record<string, unknown>) {
        this.production = resolveProduction(config);
    }

    handleBlock(node: SemanticNode, _ctx: FormatContext): void {
        this.blocks.push(node);
    }

    flush(ctx: FormatContext): void {
        processBlocks(this.blocks, this.production, ctx);
    }

    roles(): string[] {
        return Object.values(roles);
    }
}
