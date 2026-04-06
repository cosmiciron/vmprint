import { LayoutConfig, PageReservationSelector } from '../../../types';
import type { Collaborator, CollaboratorHost } from '../session/session-runtime-types';


function resolvePageStartExclusionTop(config: LayoutConfig): number {
    const value = config.layout.pageStartExclusionTop;
    return Number.isFinite(value) ? Math.max(0, Number(value)) : 0;
}

function resolvePageStartExclusionHeight(config: LayoutConfig): number {
    const value = config.layout.pageStartExclusionHeight;
    return Number.isFinite(value) ? Math.max(0, Number(value)) : 0;
}

function resolvePageStartExclusionSelector(config: LayoutConfig): PageReservationSelector {
    const value = config.layout.pageStartExclusionSelector;
    return value === 'all' || value === 'odd' || value === 'even' ? value : 'first';
}

export class PageStartExclusionCollaborator implements Collaborator {
    private readonly top: number;
    private readonly height: number;
    private readonly explicitRectangles: Array<{ x: number; width: number }>;
    private readonly leftWidth: number;
    private readonly rightWidth: number;
    private readonly selector: PageReservationSelector;

    constructor(config: LayoutConfig) {
        this.top = resolvePageStartExclusionTop(config);
        this.height = resolvePageStartExclusionHeight(config);
        this.explicitRectangles = [
            Number.isFinite(config.layout.pageStartExclusionX)
            && Number.isFinite(config.layout.pageStartExclusionWidth)
                ? {
                    x: Number(config.layout.pageStartExclusionX),
                    width: Math.max(0, Number(config.layout.pageStartExclusionWidth))
                }
                : null,
            Number.isFinite(config.layout.pageStartExclusionX2)
            && Number.isFinite(config.layout.pageStartExclusionWidth2)
                ? {
                    x: Number(config.layout.pageStartExclusionX2),
                    width: Math.max(0, Number(config.layout.pageStartExclusionWidth2))
                }
                : null
        ].filter((value): value is { x: number; width: number } => value !== null && value.width > 0);
        this.leftWidth = Number.isFinite(config.layout.pageStartExclusionLeftWidth)
            ? Math.max(0, Number(config.layout.pageStartExclusionLeftWidth))
            : 0;
        this.rightWidth = Number.isFinite(config.layout.pageStartExclusionRightWidth)
            ? Math.max(0, Number(config.layout.pageStartExclusionRightWidth))
            : 0;
        this.selector = resolvePageStartExclusionSelector(config);
    }

    onPageStart(pageIndex: number, surface: { width: number }, host: CollaboratorHost): void {
        if (!(this.height > 0)) return;
        if (!(surface.width > 0)) return;

        if (this.explicitRectangles.length > 0) {
            this.explicitRectangles.forEach((rectangle, index) => {
                const x = Math.max(0, Math.min(surface.width, rectangle.x));
                const width = Math.max(0, Math.min(rectangle.width, surface.width - x));
                if (!(width > 0)) return;
                host.excludePageSpace({
                    id: `layout:page-start-exclusion:explicit:${index}:${this.selector}:${pageIndex}`,
                    x,
                    y: this.top,
                    w: width,
                    h: this.height,
                    source: 'layout',
                    selector: this.selector
                }, pageIndex);
            });
            return;
        }

        const leftWidth = this.leftWidth > 0 ? Math.min(surface.width, this.leftWidth) : 0;
        const rightWidth = this.rightWidth > 0 ? Math.min(surface.width, this.rightWidth) : 0;

        if (leftWidth > 0 || rightWidth > 0) {
            if (leftWidth > 0) {
                host.excludePageSpace({
                    id: `layout:page-start-exclusion:left:${this.selector}:${pageIndex}`,
                    x: 0,
                    y: this.top,
                    w: leftWidth,
                    h: this.height,
                    source: 'layout',
                    selector: this.selector
                }, pageIndex);
            }
            if (rightWidth > 0) {
                host.excludePageSpace({
                    id: `layout:page-start-exclusion:right:${this.selector}:${pageIndex}`,
                    x: Math.max(0, surface.width - rightWidth),
                    y: this.top,
                    w: rightWidth,
                    h: this.height,
                    source: 'layout',
                    selector: this.selector
                }, pageIndex);
            }
            return;
        }

        host.excludePageSpace({
            id: `layout:page-start-exclusion:${this.selector}:${pageIndex}`,
            x: 0,
            y: this.top,
            w: surface.width,
            h: this.height,
            source: 'layout',
            selector: this.selector
        }, pageIndex);
    }
}
