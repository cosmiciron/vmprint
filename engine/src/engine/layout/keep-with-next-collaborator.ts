import { performance } from 'node:perf_hooks';
import { LAYOUT_DEFAULTS } from './defaults';
import { LayoutCollaborator, LayoutSession, PaginationLoopState } from './layout-session';
import { PackagerUnit } from './packagers/packager-types';

export type KeepWithNextPlan = {
    sequence: PackagerUnit[];
    sequenceHeight: number;
    fitsOnCurrent: boolean;
    prefix: PackagerUnit[];
    prefixHeight: number;
    prefixFits: boolean;
    splitCandidate: PackagerUnit | null;
};

const resolveLayoutBefore = (prevAfter: number, marginTop: number): number =>
    prevAfter + marginTop;

function computeUnitHeight(unit: PackagerUnit, prevSpacingAfter: number): { height: number; nextSpacingAfter: number } {
    const unitMarginTop = unit.getMarginTop();
    const unitMarginBottom = unit.getMarginBottom();
    const unitLayoutBefore = resolveLayoutBefore(prevSpacingAfter, unitMarginTop);
    const unitContentHeight = Math.max(0, unit.getRequiredHeight() - unitMarginTop - unitMarginBottom);
    const unitRequiredHeight = unitContentHeight + unitLayoutBefore + unitMarginBottom;
    const unitEffectiveHeight = Math.max(unitRequiredHeight, LAYOUT_DEFAULTS.minEffectiveHeight);
    return {
        height: unitEffectiveHeight - unitMarginBottom,
        nextSpacingAfter: unitMarginBottom
    };
}

function prepareLookaheadUnit(unit: PackagerUnit, availableWidth: number, availableHeight: number, context: PaginationLoopState['context']): void {
    if (unit.prepareLookahead) {
        unit.prepareLookahead(availableWidth, availableHeight, context);
        return;
    }
    unit.prepare(availableWidth, availableHeight, context);
}

export function computeKeepWithNextPlan(state: PaginationLoopState, session?: LayoutSession): KeepWithNextPlan {
    const { actorQueue, actorIndex, availableWidth, lastSpacingAfter, context } = state;
    const packager = actorQueue[actorIndex];
    const sequence: PackagerUnit[] = [packager];
    const cumulativeHeights: number[] = [];
    let tempLastSpacing = lastSpacingAfter;
    let sequenceHeight = 0;
    const initialMeasured = computeUnitHeight(packager, tempLastSpacing);
    sequenceHeight += initialMeasured.height;
    tempLastSpacing = initialMeasured.nextSpacingAfter;
    cumulativeHeights.push(sequenceHeight);

    let j = actorIndex;
    while (j < actorQueue.length && actorQueue[j].keepWithNext && j + 1 < actorQueue.length) {
        const nextPackager = actorQueue[j + 1];
        // Once the measured prefix fills or exceeds the page, any longer chain cannot fit.
        // The split fallback only needs to know that a downstream actor exists.
        if (sequenceHeight >= state.availableHeight) {
            session?.recordProfile('keepWithNextEarlyExitCalls', 1);
            sequence.push(nextPackager);
            cumulativeHeights.push(sequenceHeight);
            break;
        }
        const remainingHeight = Math.max(0, state.availableHeight - sequenceHeight);
        const prepareStart = performance.now();
        prepareLookaheadUnit(nextPackager, availableWidth, remainingHeight, context);
        const prepareMs = performance.now() - prepareStart;
        session?.recordProfile('keepWithNextPreparedActors', 1);
        session?.recordKeepWithNextPrepare(nextPackager.actorKind, prepareMs);
        sequence.push(nextPackager);
        const measured = computeUnitHeight(nextPackager, tempLastSpacing);
        sequenceHeight += measured.height;
        tempLastSpacing = measured.nextSpacingAfter;
        cumulativeHeights.push(sequenceHeight);
        j++;
    }

    const prefix = sequence.slice(0, -1);
    const prefixHeight = prefix.length > 0 ? cumulativeHeights[prefix.length - 1] : 0;
    const prefixFits = prefixHeight <= state.availableHeight;

    return {
        sequence,
        sequenceHeight,
        fitsOnCurrent: sequenceHeight <= state.availableHeight,
        prefix,
        prefixHeight,
        prefixFits,
        splitCandidate: sequence.length > 1 ? sequence[sequence.length - 1] : null
    };
}

export class KeepWithNextCollaborator implements LayoutCollaborator {
    onActorPrepared(actor: PackagerUnit, session: LayoutSession): void {
        if (!actor.keepWithNext) return;
        const state = session.getPaginationLoopState();
        if (!state) return;
        if (state.actorQueue[state.actorIndex] !== actor) return;
        const t0 = performance.now();
        const plan = computeKeepWithNextPlan(state, session);
        const t1 = performance.now();
        session.recordProfile('keepWithNextPlanCalls', 1);
        session.recordProfile('keepWithNextPlanMs', t1 - t0);
        session.setKeepWithNextPlan(actor.actorId, plan);
    }
}
