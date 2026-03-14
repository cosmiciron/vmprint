import type { LayoutCollaborator } from './layout-session-types';
import { LayoutSession } from './layout-session';
import { simulationArtifactKeys } from './simulation-report';

export type PageSpatialConstraintSummary = {
    pageIndex: number;
    reservationCount: number;
    exclusionCount: number;
    totalReservedHeight: number;
    totalExcludedHeight: number;
    reservationIds: string[];
    exclusionIds: string[];
};

export class PageSpatialConstraintArtifactCollaborator implements LayoutCollaborator {
    onSimulationComplete(session: LayoutSession): void {
        const summary = session.getSpatialConstraintPageIndices().map((pageIndex) => {
            const reservations = session.getPageReservations(pageIndex);
            const exclusions = session.getPageExclusions(pageIndex);

            return {
                pageIndex,
                reservationCount: reservations.length,
                exclusionCount: exclusions.length,
                totalReservedHeight: reservations.reduce((sum, reservation) => sum + reservation.height, 0),
                totalExcludedHeight: exclusions.reduce((sum, exclusion) => sum + exclusion.h, 0),
                reservationIds: reservations.map((reservation) => reservation.id),
                exclusionIds: exclusions.map((exclusion) => exclusion.id)
            };
        });

        session.publishArtifact(simulationArtifactKeys.pageSpatialConstraintSummary, summary);
    }
}
