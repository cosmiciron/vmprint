import type { FormatContext, SemanticNode, Element } from '@vmprint/markdown-core';
import { inlinePlainText, collapseTextSoftBreaks } from '@vmprint/markdown-core';

const roles = {
  title: 'title',
  titleMeta: 'title-meta',
  titleContact: 'title-contact',
  character: 'character',
  parenthetical: 'parenthetical',
  dialogue: 'dialogue',
  characterDualLeft: 'character-dual-left',
  parentheticalDualLeft: 'parenthetical-dual-left',
  dialogueDualLeft: 'dialogue-dual-left',
  characterDualRight: 'character-dual-right',
  parentheticalDualRight: 'parenthetical-dual-right',
  dialogueDualRight: 'dialogue-dual-right',
  more: 'more'
} as const;

const SPEAKER_CUE_PATTERN = /^@([^\n()]{1,48})(?:\s+\(([^)]+)\))?$/i;
const SCENE_HEADING_PATTERN = /^(INT\.|EXT\.|INT\/EXT\.|EST\.)/i;
const CONTACT_FIELD_PATTERN = /^(email|address|phone|tel|fax|contact)\s*:/i;

type SpeakerCue = {
  name: string;
  qualifier?: string;
  hasContd: boolean;
  dual: boolean;
};

type DialogueTurn = {
  cue: SpeakerCue;
  characterText: string;
  parentheticalText?: string;
  dialogueParas: SemanticNode[][];
  isDual: boolean;
};

type State = {
  hasTitlePage: boolean;
};

function parseSpeakerCue(line: string): SpeakerCue | null {
  const normalized = line.trim().replace(/\s+/g, ' ');
  const dual = normalized.endsWith('^');
  const withoutDual = dual ? normalized.slice(0, -1).trimEnd() : normalized;
  const match = withoutDual.match(SPEAKER_CUE_PATTERN);
  if (!match) return null;
  const name = (match[1] || '').trim().toUpperCase();
  const qualifier = (match[2] || '').trim().toUpperCase();
  return { name, qualifier: qualifier || undefined, hasContd: /CONT'?D/i.test(qualifier), dual };
}

function formatSpeakerCue(cue: SpeakerCue, forceContd: boolean): string {
  const chunks: string[] = [];
  if (cue.qualifier) chunks.push(cue.qualifier);
  if (forceContd && !cue.hasContd) chunks.push("CONT'D");
  return chunks.length > 0 ? `${cue.name} (${chunks.join(') (')})` : cue.name;
}

function stripFirstLines(children: SemanticNode[], skipLines: number): SemanticNode[] {
  if (skipLines === 0) return children;

  let linesRemaining = skipLines;
  const result: SemanticNode[] = [];

  for (const child of children) {
    if (linesRemaining === 0) {
      result.push(child);
      continue;
    }

    if (child.kind === 'text' && child.value) {
      const value = child.value;
      let pos = 0;
      let linesFound = 0;
      let exhausted = false;

      while (linesFound < linesRemaining) {
        const nextNL = value.indexOf('\n', pos);
        if (nextNL === -1) {
          linesRemaining -= linesFound;
          exhausted = true;
          break;
        }
        pos = nextNL + 1;
        linesFound++;
      }

      if (!exhausted) {
        linesRemaining = 0;
        const remaining = value.slice(pos);
        if (remaining) result.push({ ...child, value: remaining });
      }
    } else {
      result.push(child);
    }
  }

  return result;
}

function buildDialogueTurn(node: SemanticNode): DialogueTurn | null {
  const paragraphs = (node.children || []).filter((c) => c.kind === 'p');
  if (paragraphs.length === 0) return null;

  const firstPara = paragraphs[0];
  const firstText = inlinePlainText(firstPara.children || []);
  const firstLines = firstText.split('\n');
  const cue = parseSpeakerCue(firstLines[0]);
  if (!cue) return null;

  let parentheticalText: string | undefined;
  let skipLines: number;
  if (firstLines.length > 1 && firstLines[1].trim().startsWith('(')) {
    parentheticalText = firstLines[1].trim();
    skipLines = 2;
  } else {
    skipLines = 1;
  }

  const dialogueParas: SemanticNode[][] = [];
  const firstRemainder = collapseTextSoftBreaks(stripFirstLines(firstPara.children || [], skipLines));
  if (firstRemainder.length > 0 && inlinePlainText(firstRemainder).trim()) {
    dialogueParas.push(firstRemainder);
  }

  for (let i = 1; i < paragraphs.length; i++) {
    const paraChildren = collapseTextSoftBreaks(paragraphs[i].children || []);
    if (paraChildren.length > 0) dialogueParas.push(paraChildren);
  }

  return {
    cue,
    characterText: formatSpeakerCue(cue, false),
    parentheticalText,
    dialogueParas,
    isDual: cue.dual
  };
}

function emitTurn(turn: DialogueTurn, side: 'mono' | 'left' | 'right', ctx: FormatContext): void {
  const r = side === 'left'
    ? { c: roles.characterDualLeft, p: roles.parentheticalDualLeft, d: roles.dialogueDualLeft }
    : side === 'right'
    ? { c: roles.characterDualRight, p: roles.parentheticalDualRight, d: roles.dialogueDualRight }
    : { c: roles.character, p: roles.parenthetical, d: roles.dialogue };

  ctx.emit(r.c, turn.characterText, { keepWithNext: true });
  if (turn.parentheticalText) ctx.emit(r.p, turn.parentheticalText, { keepWithNext: true });

  const allChildren: Element[] = [];
  for (let i = 0; i < turn.dialogueParas.length; i++) {
    if (i > 0) allChildren.push({ type: 'text', content: '\n\n' });
    allChildren.push(...ctx.processInline(turn.dialogueParas[i]));
  }

  const charContdCue = formatSpeakerCue(turn.cue, true);
  const charMarker = { type: r.c, content: charContdCue, properties: { keepWithNext: true } };
  const markersBeforeContinuation: Array<{ type: string; content: string; properties?: Record<string, unknown> }> = [charMarker];
  if (turn.parentheticalText) {
    markersBeforeContinuation.push({ type: r.p, content: turn.parentheticalText });
  }

  ctx.emitRaw({
    type: r.d,
    content: '',
    children: allChildren,
    properties: {
      paginationContinuation: {
        enabled: true,
        markerAfterSplit: { type: roles.more, content: '(MORE)' },
        markerBeforeContinuation: charMarker,
        markersBeforeContinuation
      }
    }
  });
}

export class ScreenplayFormat {
  private readonly buffer: SemanticNode[] = [];
  private state: State = { hasTitlePage: false };

  constructor(_config: Record<string, unknown>) {}

  handleBlock(node: SemanticNode, _ctx: FormatContext): void {
    this.buffer.push(node);
  }

  flush(ctx: FormatContext): void {
    for (let i = 0; i < this.buffer.length; i++) {
      const node = this.buffer[i];

      if (node.kind === 'h1') {
        ctx.emit(roles.title, node.children || [], {
          sourceRange: node.sourceRange,
          sourceSyntax: node.sourceSyntax,
          pageOverrides: { header: null, footer: null }
        });

        if (i < this.buffer.length - 1 && this.buffer[i + 1].kind === 'ul') {
          const next = this.buffer[i + 1];
          i += 1;

          const metaItems: { item: SemanticNode; para: SemanticNode }[] = [];
          const contactItems: { item: SemanticNode; para: SemanticNode }[] = [];
          for (const item of (next.children || []).filter((n) => n.kind === 'li')) {
            const firstPara = (item.children || []).find((c) => c.kind === 'p');
            if (!firstPara) continue;
            const text = inlinePlainText(firstPara.children || []);
            if (CONTACT_FIELD_PATTERN.test(text)) contactItems.push({ item, para: firstPara });
            else metaItems.push({ item, para: firstPara });
          }

          const CONTENT_HEIGHT = 648;
          const TITLE_BLOCK_HEIGHT = 205.5;
          const LINE_BOX = 13.5;
          const BOTTOM_CLEARANCE = 72;

          const contactBlockHeight = contactItems.length * LINE_BOX;
          const metaBlockHeight = metaItems.length * LINE_BOX;
          const targetContactY = CONTENT_HEIGHT - BOTTOM_CLEARANCE - contactBlockHeight;
          const contactAnchorMarginTop = Math.max(24, targetContactY - TITLE_BLOCK_HEIGHT - metaBlockHeight);

          for (const { item, para } of metaItems) {
            ctx.emit(roles.titleMeta, para.children || [], {
              sourceRange: item.sourceRange,
              sourceSyntax: item.sourceSyntax
            });
          }

          for (let ci = 0; ci < contactItems.length; ci++) {
            const { item, para } = contactItems[ci];
            const props: Record<string, unknown> = {
              sourceRange: item.sourceRange,
              sourceSyntax: item.sourceSyntax
            };
            if (ci === 0) props.style = { marginTop: contactAnchorMarginTop };
            ctx.emit(roles.titleContact, para.children || [], props);
          }
        }

        this.state.hasTitlePage = true;
        continue;
      }

      if (node.kind === 'h2' || (node.kind === 'p' && SCENE_HEADING_PATTERN.test(inlinePlainText(node.children || [])))) {
        const props: Record<string, unknown> = {
          sourceRange: node.sourceRange,
          sourceSyntax: node.sourceSyntax
        };
        if (this.state.hasTitlePage) {
          props.style = { pageBreakBefore: true };
          this.state.hasTitlePage = false;
        }
        ctx.emit('scene-heading', node.children || [], props);
        continue;
      }

      if ((node.kind === 'h3' && /:$/.test(inlinePlainText(node.children || []))) ||
          (node.kind === 'p' && /^[A-Z0-9 .'"()/-]+:$/.test(inlinePlainText(node.children || [])))) {
        ctx.emit('transition', node.children || []);
        continue;
      }

      if (node.kind === 'blockquote') {
        const turn = buildDialogueTurn(node);
        if (!turn) {
          ctx.emit('action', collapseTextSoftBreaks(node.children || []), {
            sourceRange: node.sourceRange,
            sourceSyntax: node.sourceSyntax
          });
          continue;
        }

        if (turn.isDual && i < this.buffer.length - 1 && this.buffer[i + 1].kind === 'blockquote') {
          const nextTurn = buildDialogueTurn(this.buffer[i + 1]);
          if (nextTurn?.isDual) {
            emitTurn(turn, 'left', ctx);
            emitTurn(nextTurn, 'right', ctx);
            i += 1;
            continue;
          }
        }

        emitTurn(turn, 'mono', ctx);
        continue;
      }

      if (node.kind === 'p') {
        ctx.emit('action', collapseTextSoftBreaks(node.children || []), {
          sourceRange: node.sourceRange,
          sourceSyntax: node.sourceSyntax
        });
        continue;
      }

      if (node.kind === 'hr') {
        ctx.emit('beat', '');
      }
    }
  }
}
