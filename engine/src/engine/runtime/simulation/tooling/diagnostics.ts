import type { PackagerUnit } from '../../../layout/packagers/packager-types';
import type { SimulationDiagnosticSourceSnapshot } from '../types';

type LiveContentActor = PackagerUnit & {
    getLiveContent(): string;
};

function isLiveContentActor(actor: PackagerUnit): actor is LiveContentActor {
    return typeof (actor as { getLiveContent?: unknown }).getLiveContent === 'function';
}

export function collectDiagnosticSources(actors: readonly PackagerUnit[]): SimulationDiagnosticSourceSnapshot[] {
    const grouped = new Map<string, SimulationDiagnosticSourceSnapshot>();
    for (const actor of actors) {
        if (!isLiveContentActor(actor)) continue;
        const sourceId = String(actor.sourceId || '').trim();
        if (!sourceId || sourceId === 'system:script-document') continue;
        const content = String(actor.getLiveContent() || '');
        const existing = grouped.get(sourceId);
        if (existing && existing.content.length >= content.length) {
            continue;
        }
        grouped.set(sourceId, {
            actorId: actor.actorId,
            sourceId,
            actorKind: actor.actorKind,
            content
        });
    }

    return Array.from(grouped.values()).sort((a, b) => a.sourceId.localeCompare(b.sourceId));
}
