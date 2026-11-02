import type { Box } from '../../../types';
import type { PageSurface } from '../session/session-lifecycle-types';
import type { Collaborator, CollaboratorHost } from '../session/session-runtime-types';

import type { PackagerUnit } from '../../packagers/packager-types';

export const HEADING_SIGNAL_TOPIC = 'heading:committed';

function normalizeHeadingSignal(value: unknown): string {
    return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function isHeadingSignal(sourceType: unknown, semanticRole: unknown, actorKind: unknown): boolean {
    const role = normalizeHeadingSignal(semanticRole);
    const src = normalizeHeadingSignal(sourceType);
    const kind = normalizeHeadingSignal(actorKind);
    if (role === 'heading') return true;
    if (/^h[1-6]$/.test(role)) return true;
    if (/^h[1-6]$/.test(src)) return true;
    if (/^h[1-6]$/.test(kind)) return true;
    return false;
}

function resolveHeadingLevel(sourceType: unknown, semanticRole: unknown, actorKind: unknown): number | undefined {
    const signals = [
        normalizeHeadingSignal(semanticRole),
        normalizeHeadingSignal(sourceType),
        normalizeHeadingSignal(actorKind)
    ];
    for (const s of signals) {
        const m = s.match(/^h([1-6])$/) ?? s.match(/^heading[-_ ]?([1-6])$/);
        if (m) return Number(m[1]);
    }
    return undefined;
}

function extractBoxText(box: Box): string {
    if (typeof box.content === 'string' && box.content.trim().length > 0) return box.content;
    if (Array.isArray(box.lines)) {
        return box.lines.map((line) => line.map((seg) => seg.text || '').join('')).join(' ');
    }
    return '';
}

/**
 * Emits committed heading signals into the actor event bus during layout.
 * This makes heading positions available to in-flow reactive actors (e.g. TocPackager)
 * at checkpoint sweeps, before simulation completes.
 *
 * Runs alongside HeadingTelemetryCollaborator, which continues to produce its
 * post-simulation artifact unchanged.
 */
export class HeadingSignalCollaborator implements Collaborator {
    onActorCommitted(
        actor: PackagerUnit,
        committed: Box[],
        surface: PageSurface,
        host: CollaboratorHost
    ): void {
        // Aggregate actors (stories, zones) flatten child boxes. Classify and group
        // by each child's metadata rather than by the containing actor or first box.
        const groups = new Map<string, Box[]>();
        for (const box of committed) {
            const meta = box.meta;
            if (meta?.generated || meta?.isContinuation || Number(meta?.fragmentIndex ?? actor.fragmentIndex) > 0) continue;
            const sourceType = meta?.sourceType ?? actor.actorKind;
            if (!isHeadingSignal(sourceType, meta?.semanticRole, meta?.hostedSourceType ?? actor.actorKind)) continue;
            const sourceId = meta?.sourceId ?? actor.sourceId;
            const group = groups.get(sourceId) ?? [];
            group.push(box);
            groups.set(sourceId, group);
        }
        for (const [sourceId, boxes] of groups) {
            const firstBox = boxes[0];
            const sourceType = firstBox.meta?.sourceType ?? actor.actorKind;
            const semanticRole = firstBox.meta?.semanticRole;
            // A split changes the visible prefix, not the heading's identity or
            // title. Hosted headings still use their own boxes, never host text.
            const sourceText = sourceId === actor.sourceId ? actor.getSourceText?.() : undefined;
            const heading = (sourceText ?? boxes.map(extractBoxText).join(' ')).replace(/\s+/g, ' ').trim();
            if (!heading) continue;
            const y = Math.min(...boxes.map(box => Number.isFinite(box.y) ? Number(box.y) : 0));
            host.publishActorSignal({
                topic: HEADING_SIGNAL_TOPIC,
                publisherActorId: actor.actorId,
                publisherSourceId: sourceId,
                publisherActorKind: String(sourceType),
                fragmentIndex: 0,
                pageIndex: surface.pageIndex,
                cursorY: y,
                signalKey: `heading:${sourceId}`,
                payload: {
                    heading,
                    level: resolveHeadingLevel(sourceType, semanticRole, actor.actorKind),
                    y,
                    sourceType,
                    semanticRole
                }
            });
        }
    }
}
