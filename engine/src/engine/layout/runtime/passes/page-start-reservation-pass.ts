import type { CollaboratorHost } from '../../layout-session-types';
import { LayoutConfig, PageReservationSelector } from '../../../types';
import type { Collaborator } from '../../layout-session-types';


function resolvePageStartReservationHeight(config: LayoutConfig): number {
    const value = config.layout.pageReservationOnFirstPageStart;
    return Number.isFinite(value) ? Math.max(0, Number(value)) : 0;
}

function resolvePageStartReservationSelector(config: LayoutConfig): PageReservationSelector {
    const value = config.layout.pageStartReservationSelector;
    return value === 'all' || value === 'odd' || value === 'even' ? value : 'first';
}

export class PageStartReservationCollaborator implements Collaborator {
    private readonly reservationHeight: number;
    private readonly selector: PageReservationSelector;

    constructor(config: LayoutConfig) {
        this.reservationHeight = resolvePageStartReservationHeight(config);
        this.selector = resolvePageStartReservationSelector(config);
    }

    onPageStart(pageIndex: number, _surface: unknown, host: CollaboratorHost): void {
        if (!(this.reservationHeight > 0)) return;

        host.reservePageSpace({
            id: `layout:page-start-reservation:${this.selector}:${pageIndex}`,
            height: this.reservationHeight,
            source: 'layout',
            selector: this.selector
        }, pageIndex);
    }
}
