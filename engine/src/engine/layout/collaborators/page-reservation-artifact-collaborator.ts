import type { CollaboratorHost } from '../layout-session-types';
import type { Collaborator } from '../layout-session-types';

import { simulationArtifactKeys } from '../simulation-report';

export type PageReservationSummary = {
    pageIndex: number;
    reservationCount: number;
    totalReservedHeight: number;
    reservationIds: string[];
    reservationSources: string[];
};

export class PageReservationArtifactCollaborator implements Collaborator {
    readonly mutationMode = 'observer' as const;

    onSimulationComplete(host: CollaboratorHost): void {
        const startedAt = performance.now();
        const summaries = host.getReservationPageIndices().map((pageIndex) => {
            const reservations = host.getPageReservations(pageIndex);
            const reservationSources = Array.from(new Set(
                reservations
                    .map((reservation) => reservation.source || '')
                    .filter((value) => value.length > 0)
            ));

            return {
                pageIndex,
                reservationCount: reservations.length,
                totalReservedHeight: reservations.reduce((sum, reservation) => sum + reservation.height, 0),
                reservationIds: reservations.map((reservation) => reservation.id),
                reservationSources
            };
        });

        host.publishArtifact(simulationArtifactKeys.pageReservationSummary, summaries);
        host.recordProfile('reservationArtifactMs', performance.now() - startedAt);
    }
}
