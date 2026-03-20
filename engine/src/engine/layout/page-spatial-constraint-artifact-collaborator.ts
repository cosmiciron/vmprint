import type { Collaborator } from './layout-session-types';
import { LayoutSession } from './layout-session';
import { simulationArtifactKeys } from './simulation-report';

export type PageSpatialConstraintSummary = {
    pageIndex: number;
    worldX?: number;
    worldY?: number;
    viewportWidth?: number;
    viewportHeight?: number;
    reservationCount: number;
    exclusionCount: number;
    totalReservedHeight: number;
    totalExcludedHeight: number;
    reservationIds: string[];
    exclusionIds: string[];
};

export class PageSpatialConstraintArtifactCollaborator implements Collaborator {
    onSimulationComplete(session: LayoutSession): void {
        const summary = session.getSpatialConstraintPageIndices().map((pageIndex) => {
            const reservations = session.getPageReservations(pageIndex);
            const exclusions = session.getPageExclusions(pageIndex);
            const finalization = session.getPageFinalizationState(pageIndex);

            return {
                pageIndex,
                worldX: finalization?.viewport.worldX,
                worldY: finalization?.viewport.worldY,
                viewportWidth: finalization?.viewport.width,
                viewportHeight: finalization?.viewport.height,
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
