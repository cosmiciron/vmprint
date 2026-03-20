import type { Collaborator } from './layout-session-types';
import { LayoutSession } from './layout-session';
import { PackagerUnit } from './packagers/packager-types';

function resolveReservationHeight(actor: PackagerUnit): number {
    const flowBox = (actor as any).flowBox;
    const value =
        flowBox?.properties?.pageReservationAfter ??
        flowBox?._sourceElement?.properties?.pageReservationAfter;
    return Number.isFinite(value) ? Math.max(0, Number(value)) : 0;
}

export class PageReservationCollaborator implements Collaborator {
    onActorCommitted(actor: PackagerUnit, _committed: unknown, _surface: unknown, session: LayoutSession): void {
        const startedAt = performance.now();
        session.recordProfile('reservationCommitProbeCalls', 1);
        const height = resolveReservationHeight(actor);
        session.recordProfile('reservationCommitProbeMs', performance.now() - startedAt);
        if (!(height > 0)) return;

        session.reserveCurrentPageSpace({
            id: `${actor.actorId}:page-reserve-after`,
            height,
            source: actor.sourceId
        });
    }
}
