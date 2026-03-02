import { Box } from '../../types';

export interface LayoutBox extends Box {}

export interface PackagerContext {
    processor: any; // We'll cast to LayoutProcessor
    pageIndex: number;
    cursorY: number;
    margins: { top: number; right: number; bottom: number; left: number };
    pageWidth: number;
    pageHeight: number;
}

export interface PackagerUnit {
    /**
     * Emit boxes for the given available space.
     * Returns null if it absolutely cannot even start to fit.
     * Must be deterministic for the same availableWidth/context; avoid height-dependent layout.
     */
    emitBoxes(availableWidth: number, availableHeight: number, context: PackagerContext): LayoutBox[] | null;

    /**
     * Splits this unit.
     */
    split(availableHeight: number, context: PackagerContext): [PackagerUnit | null, PackagerUnit | null];

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
