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
        // Only emit for the first fragment — continuations don't change the heading's page position
        if (actor.fragmentIndex > 0 || actor.continuationOf) return;
        if (!committed.length) return;

        const firstBox = committed.find((box) => box.meta?.generated !== true) ?? committed[0];
        const sourceType = firstBox?.meta?.sourceType ?? actor.actorKind;
        const semanticRole = firstBox?.meta?.semanticRole;
        if (!isHeadingSignal(sourceType, semanticRole, actor.actorKind)) return;

        const heading = committed.map(extractBoxText).join(' ').replace(/\s+/g, ' ').trim();
        if (!heading) return;

        const y = committed.reduce((best, box) => {
            const v = Number.isFinite(box.y) ? Number(box.y) : Number.POSITIVE_INFINITY;
            return Math.min(best, v);
        }, Number.POSITIVE_INFINITY);

        host.publishActorSignal({
            topic: HEADING_SIGNAL_TOPIC,
            publisherActorId: actor.actorId,
            publisherSourceId: actor.sourceId,
            publisherActorKind: typeof actor.actorKind === 'string' ? actor.actorKind : 'heading',
            fragmentIndex: actor.fragmentIndex,
            pageIndex: surface.pageIndex,
            cursorY: Number.isFinite(y) ? y : 0,
            signalKey: `heading:${actor.sourceId}`,
            payload: {
                heading,
                level: resolveHeadingLevel(sourceType, semanticRole, actor.actorKind),
                y: Number.isFinite(y) ? y : 0,
                sourceType: typeof sourceType === 'string' ? sourceType : undefined,
                semanticRole: typeof semanticRole === 'string' ? semanticRole : undefined
            }
        });
    }
}
