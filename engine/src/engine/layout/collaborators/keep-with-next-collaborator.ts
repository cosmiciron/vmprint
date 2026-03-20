import { performance } from 'node:perf_hooks';
import type { ActorFormationMember, KeepWithNextFormationPlan } from '../actor-formation';
import { LAYOUT_DEFAULTS } from '../defaults';
import type { Collaborator, PaginationLoopState } from '../layout-session-types';
import { LayoutSession } from '../layout-session';
import { PackagerUnit, preparePackagerForPhase } from '../packagers/packager-types';

export type KeepWithNextPlan = KeepWithNextFormationPlan;

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

export function computeKeepWithNextPlan(state: PaginationLoopState, session?: LayoutSession): KeepWithNextPlan {
    const { actorQueue, actorIndex, availableWidth, lastSpacingAfter, context } = state;
    const packager = actorQueue[actorIndex];
    const sequence: PackagerUnit[] = [packager];
    const members: ActorFormationMember[] = [];
    const cumulativeHeights: number[] = [];
    let tempLastSpacing = lastSpacingAfter;
    let sequenceHeight = 0;
    const initialMeasured = computeUnitHeight(packager, tempLastSpacing);
    sequenceHeight += initialMeasured.height;
    tempLastSpacing = initialMeasured.nextSpacingAfter;
    cumulativeHeights.push(sequenceHeight);
    members.push({
        actor: packager,
        role: packager.keepWithNext && actorIndex + 1 < actorQueue.length ? 'leader' : 'member',
        measuredHeight: initialMeasured.height,
        nextSpacingAfter: initialMeasured.nextSpacingAfter
    });

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
        preparePackagerForPhase(nextPackager, 'lookahead', availableWidth, remainingHeight, context);
        const prepareMs = performance.now() - prepareStart;
        session?.recordProfile('keepWithNextPreparedActors', 1);
        session?.recordKeepWithNextPrepare(nextPackager.actorKind, prepareMs);
        sequence.push(nextPackager);
        const measured = computeUnitHeight(nextPackager, tempLastSpacing);
        sequenceHeight += measured.height;
        tempLastSpacing = measured.nextSpacingAfter;
        cumulativeHeights.push(sequenceHeight);
        members.push({
            actor: nextPackager,
            role: 'member',
            measuredHeight: measured.height,
            nextSpacingAfter: measured.nextSpacingAfter
        });
        j++;
    }

    const prefix = sequence.slice(0, -1);
    const prefixHeight = prefix.length > 0 ? cumulativeHeights[prefix.length - 1] : 0;
    const prefixFits = prefixHeight <= state.availableHeight;
    const splitCandidate = sequence.length > 1 ? sequence[sequence.length - 1] : null;
    const tailSplitBreakableInCurrentTerrain =
        splitCandidate !== null && !splitCandidate.isUnbreakable(state.availableHeight - prefixHeight);
    const splitMarkerReserve = splitCandidate && session ? session.getSplitMarkerReserve(splitCandidate) : 0;
    const tailSplitViableWithMarkerReserve =
        splitCandidate !== null &&
        !splitCandidate.isUnbreakable(state.availableHeight - prefixHeight - splitMarkerReserve);
    if (members.length > 1) {
        members[members.length - 1] = {
            ...members[members.length - 1],
            role: 'tail-split-candidate'
        };
    }

    const fitsOnCurrent = sequenceHeight <= state.availableHeight;
    const assessment = {
        wholeFits: fitsOnCurrent,
        prefixFits,
        memberCount: sequence.length,
        prefixCount: prefix.length,
        tailSplitCandidateActorId: splitCandidate?.actorId ?? null,
        tailSplitViable: sequence.length > 1 && prefixFits && splitCandidate !== null,
        tailSplitAllowedAtCurrentPosition: !state.isAtPageTop && sequence.length > 1 && prefixFits && splitCandidate !== null,
        tailSplitBreakableInCurrentTerrain,
        tailSplitViableWithMarkerReserve,
        requiresPageAdvance: sequence.length > 1 && !fitsOnCurrent
    };
    const resolution =
        sequence.length <= 1
            ? { action: 'single-actor' as const }
            : fitsOnCurrent
                ? { action: 'commit-whole' as const }
                : prefixFits && splitCandidate
                    ? {
                        action: 'split-tail' as const,
                        prefixCount: prefix.length,
                        splitCandidateActorId: splitCandidate.actorId
                    }
                    : { action: 'defer-whole' as const };

    return {
        formation: {
            formationId: `keep-with-next:${packager.actorId}`,
            policy: 'keep-with-next',
            availableWidth,
            availableHeight: state.availableHeight,
            members
        },
        assessment,
        resolution,
        splitMarkerReserve
    };
}

export class KeepWithNextCollaborator implements Collaborator {
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
