import type { RegionReservation, SpatialExclusion } from './session-spatial-types';

export interface CollaboratorConstraintField {
    availableWidth: number;
    availableHeight: number;
    readonly effectiveAvailableHeight: number;
    readonly reservations: RegionReservation[];
    readonly exclusions: SpatialExclusion[];
}
