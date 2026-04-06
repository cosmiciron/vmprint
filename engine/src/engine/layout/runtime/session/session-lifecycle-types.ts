import type { Box, DebugRegion, Page } from '../../../types';
import type { PackagerContext } from '../../packagers/packager-types';
import type { PackagerUnit } from '../../packagers/packager-types';

export type PaginationState = {
    currentPageIndex: number;
    currentPageBoxes: Box[];
    currentY: number;
    lastSpacingAfter: number;
};

export class PageSurface {
    constructor(
        public readonly pageIndex: number,
        public readonly width: number,
        public readonly height: number,
        public readonly boxes: Box[],
        public readonly debugRegions: DebugRegion[] = []
    ) { }

    finalize(): Page {
        return {
            index: this.pageIndex,
            width: this.width,
            height: this.height,
            boxes: this.boxes,
            ...(this.debugRegions.length > 0 ? { debugRegions: this.debugRegions.map((region) => ({ ...region })) } : {})
        };
    }
}

export type SplitAttempt = {
    actor: PackagerUnit;
    availableWidth: number;
    availableHeight: number;
    context: PackagerContext;
};

export type PaginationLoopState = {
    actorQueue: PackagerUnit[];
    actorIndex: number;
    paginationState: PaginationState;
    availableWidth: number;
    availableHeight: number;
    lastSpacingAfter: number;
    isAtPageTop: boolean;
    context: PackagerContext;
};
