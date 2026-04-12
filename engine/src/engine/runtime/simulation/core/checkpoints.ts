import type { PackagerUnit, LayoutBox } from '../../../layout/packagers/packager-types';

export type RestoredCheckpointState = {
    currentPageBoxes: LayoutBox[];
    currentY: number;
    lastSpacingAfter: number;
};

export type CheckpointBoundaryKind = 'page' | 'actor';

export type ResolvedCheckpoint = {
    kind: CheckpointBoundaryKind;
    pageIndex: number;
    actorIndex: number;
};

export type ApplyCheckpointState = (state: {
    currentPageIndex: number;
    currentPageBoxes: LayoutBox[];
    currentY: number;
    lastSpacingAfter: number;
}) => void;

export type ReapplyCheckpointOptions<TPage> = {
    checkpoint: ResolvedCheckpoint;
    restored: RestoredCheckpointState;
    packagers: PackagerUnit[];
    pages: TPage[];
    pageWidth: number;
    pageHeight: number;
    applyState: ApplyCheckpointState;
    notifyPageStart: (pageIndex: number, pageWidth: number, pageHeight: number, currentPageBoxes: LayoutBox[]) => void;
    recordSafeCheckpoint: (
        packagers: PackagerUnit[],
        actorIndex: number,
        pages: TPage[],
        currentPageBoxes: LayoutBox[],
        currentPageIndex: number,
        currentY: number,
        pageHeight: number,
        lastSpacingAfter: number,
        kind: CheckpointBoundaryKind
    ) => void;
};

export function reapplyCheckpointState<TPage>(options: ReapplyCheckpointOptions<TPage>): number {
    const {
        checkpoint,
        restored,
        packagers,
        pages,
        pageWidth,
        pageHeight,
        applyState,
        notifyPageStart,
        recordSafeCheckpoint
    } = options;

    applyState({
        currentPageIndex: checkpoint.pageIndex,
        currentPageBoxes: restored.currentPageBoxes,
        currentY: restored.currentY,
        lastSpacingAfter: restored.lastSpacingAfter
    });

    notifyPageStart(checkpoint.pageIndex, pageWidth, pageHeight, restored.currentPageBoxes);
    recordSafeCheckpoint(
        packagers,
        checkpoint.actorIndex,
        pages,
        restored.currentPageBoxes,
        checkpoint.pageIndex,
        restored.currentY,
        pageHeight,
        restored.lastSpacingAfter,
        checkpoint.kind
    );

    return checkpoint.actorIndex;
}
