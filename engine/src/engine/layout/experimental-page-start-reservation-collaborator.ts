import { LayoutConfig, PageReservationSelector } from '../types';
import { LayoutCollaborator, LayoutSession } from './layout-session';

function resolvePageStartReservationHeight(config: LayoutConfig): number {
    const value = config.layout._experimentalPageReservationOnFirstPageStart;
    return Number.isFinite(value) ? Math.max(0, Number(value)) : 0;
}

function resolvePageStartReservationSelector(config: LayoutConfig): PageReservationSelector {
    const value = config.layout._experimentalPageStartReservationSelector;
    return value === 'all' || value === 'odd' || value === 'even' ? value : 'first';
}

export class ExperimentalPageStartReservationCollaborator implements LayoutCollaborator {
    private readonly reservationHeight: number;
    private readonly selector: PageReservationSelector;

    constructor(config: LayoutConfig) {
        this.reservationHeight = resolvePageStartReservationHeight(config);
        this.selector = resolvePageStartReservationSelector(config);
    }

    onPageStart(pageIndex: number, _surface: unknown, session: LayoutSession): void {
        if (!(this.reservationHeight > 0)) return;

        session.reservePageSpace({
            id: `layout:page-start-reservation:${this.selector}:${pageIndex}`,
            height: this.reservationHeight,
            source: 'layout',
            selector: this.selector
        }, pageIndex);
    }
}
