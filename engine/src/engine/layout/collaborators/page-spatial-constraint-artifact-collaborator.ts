import type { Collaborator, CollaboratorHost } from '../runtime/session/session-runtime-types';

import { simulationArtifactKeys } from '../simulation-report';

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
    readonly mutationMode = 'observer' as const;

    onSimulationComplete(host: CollaboratorHost): void {
        const summary = host.getSpatialConstraintPageIndices().map((pageIndex) => {
            const reservations = host.getPageReservations(pageIndex);
            const exclusions = host.getPageExclusions(pageIndex);
            const finalization = host.getPageFinalizationState(pageIndex);

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

        host.publishArtifact(simulationArtifactKeys.pageSpatialConstraintSummary, summary);
    }
}
