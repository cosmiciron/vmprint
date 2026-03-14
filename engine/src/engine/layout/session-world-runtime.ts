import type { PageReservationSelector } from '../types';
import { Kernel } from './kernel';
import type {
    PageExclusionIntent,
    PageReservationIntent,
    RegionReservation,
    SpatialExclusion
} from './layout-session-types';

export type SessionWorldRuntimeHost = {
    getCurrentPageIndex(): number;
    recordReservationWrite(): void;
};

export class SessionWorldRuntime {
    constructor(
        private readonly kernel: Kernel,
        private readonly host: SessionWorldRuntimeHost
    ) { }

    publishArtifact(key: string, value: unknown): void {
        this.kernel.publishArtifact(key, value);
    }

    reservePageSpace(reservation: PageReservationIntent, pageIndex: number = this.host.getCurrentPageIndex()): void {
        const selector = reservation.selector ?? 'current';
        if (selector !== 'current' && !this.matchesPageSelector(pageIndex, selector)) {
            return;
        }

        const normalizedHeight = Number.isFinite(reservation.height) ? Math.max(0, Number(reservation.height)) : 0;
        if (!(normalizedHeight > 0)) return;

        const normalized: RegionReservation = {
            ...reservation,
            height: normalizedHeight
        };
        this.kernel.storePageReservation(pageIndex, this.host.getCurrentPageIndex(), normalized);
        this.host.recordReservationWrite();
    }

    getCurrentPageReservations(): readonly RegionReservation[] {
        return this.kernel.getCurrentPageReservations();
    }

    getPageReservations(pageIndex: number): readonly RegionReservation[] {
        return this.kernel.getPageReservations(pageIndex);
    }

    getReservationPageIndices(): readonly number[] {
        return this.kernel.getReservationPageIndices();
    }

    excludePageSpace(exclusion: PageExclusionIntent, pageIndex: number = this.host.getCurrentPageIndex()): void {
        const selector = exclusion.selector ?? 'current';
        if (selector !== 'current' && !this.matchesPageSelector(pageIndex, selector)) {
            return;
        }

        const normalized: SpatialExclusion = {
            ...exclusion,
            x: Number.isFinite(exclusion.x) ? Number(exclusion.x) : 0,
            y: Number.isFinite(exclusion.y) ? Math.max(0, Number(exclusion.y)) : 0,
            w: Number.isFinite(exclusion.w) ? Math.max(0, Number(exclusion.w)) : 0,
            h: Number.isFinite(exclusion.h) ? Math.max(0, Number(exclusion.h)) : 0
        };
        if (!(normalized.w > 0) || !(normalized.h > 0)) return;

        this.kernel.storePageExclusion(pageIndex, this.host.getCurrentPageIndex(), normalized);
    }

    getPageExclusions(pageIndex: number): readonly SpatialExclusion[] {
        return this.kernel.getPageExclusions(pageIndex);
    }

    getExclusionPageIndices(): readonly number[] {
        return this.kernel.getExclusionPageIndices();
    }

    getSpatialConstraintPageIndices(): readonly number[] {
        return this.kernel.getSpatialConstraintPageIndices();
    }

    matchesPageSelector(pageIndex: number, selector: PageReservationSelector = 'first'): boolean {
        if (!Number.isFinite(pageIndex) || pageIndex < 0) return false;

        switch (selector) {
            case 'all':
                return true;
            case 'odd':
                return pageIndex % 2 === 0;
            case 'even':
                return pageIndex % 2 === 1;
            case 'first':
            default:
                return pageIndex === 0;
        }
    }
}
