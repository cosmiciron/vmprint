import type { CollaboratorHost } from '../layout-session-types';
import type { Collaborator } from '../layout-session-types';

import { PackagerUnit } from '../packagers/packager-types';

function resolveReservationHeight(actor: PackagerUnit): number {
    const flowBox = (actor as any).flowBox;
    const value =
        flowBox?.properties?.pageReservationAfter ??
        flowBox?._sourceElement?.properties?.pageReservationAfter;
    return Number.isFinite(value) ? Math.max(0, Number(value)) : 0;
}

export class PageReservationCollaborator implements Collaborator {
    onActorCommitted(actor: PackagerUnit, _committed: unknown, _surface: unknown, host: CollaboratorHost): void {
        const startedAt = performance.now();
        host.recordProfile('reservationCommitProbeCalls', 1);
        const height = resolveReservationHeight(actor);
        host.recordProfile('reservationCommitProbeMs', performance.now() - startedAt);
        if (!(height > 0)) return;

        host.reserveCurrentPageSpace({
            id: `${actor.actorId}:page-reserve-after`,
            height,
            source: actor.sourceId
        });
    }
}
