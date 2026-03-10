import { LayoutConfig, PageReservationSelector } from '../types';
import { LayoutCollaborator, LayoutSession } from './layout-session';

function resolvePageStartExclusionTop(config: LayoutConfig): number {
    const value = config.layout._experimentalPageStartExclusionTop;
    return Number.isFinite(value) ? Math.max(0, Number(value)) : 0;
}

function resolvePageStartExclusionHeight(config: LayoutConfig): number {
    const value = config.layout._experimentalPageStartExclusionHeight;
    return Number.isFinite(value) ? Math.max(0, Number(value)) : 0;
}

function resolvePageStartExclusionSelector(config: LayoutConfig): PageReservationSelector {
    const value = config.layout._experimentalPageStartExclusionSelector;
    return value === 'all' || value === 'odd' || value === 'even' ? value : 'first';
}

export class ExperimentalPageStartExclusionCollaborator implements LayoutCollaborator {
    private readonly top: number;
    private readonly height: number;
    private readonly selector: PageReservationSelector;

    constructor(config: LayoutConfig) {
        this.top = resolvePageStartExclusionTop(config);
        this.height = resolvePageStartExclusionHeight(config);
        this.selector = resolvePageStartExclusionSelector(config);
    }

    onPageStart(pageIndex: number, surface: { width: number }, session: LayoutSession): void {
        if (!(this.height > 0)) return;
        if (!(surface.width > 0)) return;
        if (!session.matchesPageReservationSelector(pageIndex, this.selector)) return;

        session.excludePageSpace({
            id: `layout:page-start-exclusion:${this.selector}:${pageIndex}`,
            x: 0,
            y: this.top,
            w: surface.width,
            h: this.height,
            source: 'layout'
        }, pageIndex);
    }
}
