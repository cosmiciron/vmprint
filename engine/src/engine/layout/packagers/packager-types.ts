import { Box } from '../../types';
import { LayoutProcessor } from '../layout-core';
import { FlowBox } from '../layout-core-types';

export interface LayoutBox extends Box { }

export interface PackagerContext {
    processor: any; // We'll cast to LayoutProcessor
    pageIndex: number;
    cursorY: number;
    margins: { top: number; right: number; bottom: number; left: number };
    pageWidth: number;
    pageHeight: number;
}

export type PackagerSplitResult = {
    currentFragment: PackagerUnit | null;
    continuationFragment: PackagerUnit | null;
};

export type PackagerPreparationPhase = 'commit' | 'lookahead';

export interface PackagerUnit {
    readonly actorId: string;
    readonly sourceId: string;
    readonly actorKind: string;
    readonly fragmentIndex: number;
    readonly continuationOf?: string;

    /**
     * Prepare internal measurement/materialization state for the given space
     * without emitting boxes. Must update getRequiredHeight().
     */
    prepare(availableWidth: number, availableHeight: number, context: PackagerContext): void;

    /**
     * Prepare speculative measurement state for planning phases such as keepWithNext.
     * Implementations may use a cheaper conservative probe than commit-time prepare().
     */
    prepareLookahead?(availableWidth: number, availableHeight: number, context: PackagerContext): void;

    /**
     * The minimum width at which this actor considers a placement frame worth
     * attempting. Returning null/undefined means "no opinion".
     */
    getMinimumPlacementWidth?(fullAvailableWidth: number, context: PackagerContext): number | null | undefined;

    /**
     * Allows width-sensitive actors to reject a narrowed spatial placement frame
     * before emitBoxes() is attempted. Returning false tells the paginator to
     * defer below the constrained band instead of forcing the actor through it.
     */
    acceptsPlacementFrame?(frameAvailableWidth: number, fullAvailableWidth: number, context: PackagerContext): boolean;

    /** 
     * Emit boxes for the given available space.
     * Returns null if it absolutely cannot even start to fit.
     * Must be deterministic for the same availableWidth/context; avoid height-dependent layout.
     */
    emitBoxes(availableWidth: number, availableHeight: number, context: PackagerContext): LayoutBox[] | null;

    /**
     * Splits this unit.
     */
    split(availableHeight: number, context: PackagerContext): PackagerSplitResult;

    /**
     * Required height for the last materialized state (after emitBoxes).
     */
    getRequiredHeight(): number;

    isUnbreakable(availableHeight: number): boolean;

    getMarginTop(): number;
    getMarginBottom(): number;

    readonly pageBreakBefore?: boolean;
    readonly keepWithNext?: boolean;
}

export function preparePackagerForPhase(
    unit: PackagerUnit,
    phase: PackagerPreparationPhase,
    availableWidth: number,
    availableHeight: number,
    context: PackagerContext
): void {
    if (phase === 'lookahead' && unit.prepareLookahead) {
        unit.prepareLookahead(availableWidth, availableHeight, context);
        return;
    }

    unit.prepare(availableWidth, availableHeight, context);
}
