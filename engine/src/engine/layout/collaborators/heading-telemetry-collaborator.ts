import type { CollaboratorHost } from '../layout-session-types';
import type { Box } from '../../types';
import type { Collaborator, PageSurface } from '../layout-session-types';

import { simulationArtifactKeys } from '../simulation-report';
import type { PackagerUnit } from '../packagers/packager-types';

export type HeadingTelemetrySummary = {
    sourceId: string;
    heading: string;
    pageIndex: number;
    y: number;
    actorKind?: string;
    sourceType?: string;
    semanticRole?: string;
    level?: number;
};

function normalizeHeadingSignal(value: unknown): string {
    return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function isHeadingSignal(sourceType: unknown, semanticRole: unknown, actorKind: unknown): boolean {
    const normalizedSemanticRole = normalizeHeadingSignal(semanticRole);
    const normalizedSourceType = normalizeHeadingSignal(sourceType);
    const normalizedActorKind = normalizeHeadingSignal(actorKind);

    if (normalizedSemanticRole === 'heading') return true;
    if (/^h[1-6]$/.test(normalizedSemanticRole)) return true;
    if (/^h[1-6]$/.test(normalizedSourceType)) return true;
    if (/^h[1-6]$/.test(normalizedActorKind)) return true;
    return false;
}

function resolveHeadingLevel(sourceType: unknown, semanticRole: unknown, actorKind: unknown): number | undefined {
    const headingSignals = [
        normalizeHeadingSignal(semanticRole),
        normalizeHeadingSignal(sourceType),
        normalizeHeadingSignal(actorKind)
    ];

    for (const signal of headingSignals) {
        const levelMatch = signal.match(/^h([1-6])$/);
        if (levelMatch) {
            return Number(levelMatch[1]);
        }
        const semanticMatch = signal.match(/^heading[-_ ]?([1-6])$/);
        if (semanticMatch) {
            return Number(semanticMatch[1]);
        }
    }

    return undefined;
}

function extractBoxText(box: Box): string {
    if (typeof box.content === 'string' && box.content.trim().length > 0) {
        return box.content;
    }
    if (Array.isArray(box.lines)) {
        return box.lines
            .map((line) => line.map((segment) => segment.text || '').join(''))
            .join(' ');
    }
    return '';
}

function normalizeHeadingText(text: string): string {
    return text.replace(/\s+/g, ' ').trim();
}

export class HeadingTelemetryCollaborator implements Collaborator {
    private readonly headings = new Map<string, HeadingTelemetrySummary>();

    onSimulationStart(): void {
        this.headings.clear();
    }

    onActorCommitted(
        actor: PackagerUnit,
        committed: Box[],
        surface: PageSurface,
        _host: CollaboratorHost
    ): void {
        if (actor.fragmentIndex > 0 || actor.continuationOf) return;
        if (!committed.length) return;

        const firstBox = committed.find((box) => box.meta?.generated !== true) ?? committed[0];
        const sourceType = firstBox?.meta?.sourceType ?? actor.actorKind;
        const semanticRole = firstBox?.meta?.semanticRole;
        if (!isHeadingSignal(sourceType, semanticRole, actor.actorKind)) return;

        const heading = normalizeHeadingText(committed.map(extractBoxText).join(' '));
        if (!heading) return;

        const y = committed.reduce((best, box) => {
            const candidate = Number.isFinite(box.y) ? Number(box.y) : Number.POSITIVE_INFINITY;
            return Math.min(best, candidate);
        }, Number.POSITIVE_INFINITY);
        const summary: HeadingTelemetrySummary = {
            sourceId: actor.sourceId,
            heading,
            pageIndex: surface.pageIndex,
            y: Number.isFinite(y) ? y : 0,
            actorKind: typeof actor.actorKind === 'string' ? actor.actorKind : undefined,
            sourceType: typeof sourceType === 'string' ? sourceType : undefined,
            semanticRole: typeof semanticRole === 'string' ? semanticRole : undefined,
            level: resolveHeadingLevel(sourceType, semanticRole, actor.actorKind)
        };

        const existing = this.headings.get(actor.sourceId);
        if (
            !existing ||
            summary.pageIndex < existing.pageIndex ||
            (summary.pageIndex === existing.pageIndex && summary.y < existing.y)
        ) {
            this.headings.set(actor.sourceId, summary);
        }
    }

    onSimulationComplete(host: CollaboratorHost): void {
        host.publishArtifact(
            simulationArtifactKeys.headingTelemetry,
            Array.from(this.headings.values()).sort((a, b) =>
                a.pageIndex - b.pageIndex ||
                a.y - b.y ||
                a.sourceId.localeCompare(b.sourceId)
            )
        );
    }
}
