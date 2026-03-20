import type { Collaborator } from './layout-session-types';
import { LayoutSession } from './layout-session';
import { simulationArtifactKeys } from './simulation-report';

export type PageReservationSummary = {
    pageIndex: number;
    reservationCount: number;
    totalReservedHeight: number;
    reservationIds: string[];
    reservationSources: string[];
};

export class PageReservationArtifactCollaborator implements Collaborator {
    onSimulationComplete(session: LayoutSession): void {
        const startedAt = performance.now();
        const summaries = session.getReservationPageIndices().map((pageIndex) => {
            const reservations = session.getPageReservations(pageIndex);
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

        session.publishArtifact(simulationArtifactKeys.pageReservationSummary, summaries);
        session.recordProfile('reservationArtifactMs', performance.now() - startedAt);
    }
}
