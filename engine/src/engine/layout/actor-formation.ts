import type { PackagerUnit } from './packagers/packager-types';

export type ActorFormationPolicy = 'keep-with-next';

export type ActorFormationMemberRole = 'leader' | 'member' | 'tail-split-candidate';

export type ActorFormationMember = {
    actor: PackagerUnit;
    role: ActorFormationMemberRole;
    measuredHeight: number;
    nextSpacingAfter: number;
};

export type ActorFormation = {
    formationId: string;
    policy: ActorFormationPolicy;
    availableWidth: number;
    availableHeight: number;
    members: ActorFormationMember[];
};

export type ActorFormationAssessment = {
    wholeFits: boolean;
    prefixFits: boolean;
    memberCount: number;
    prefixCount: number;
    tailSplitCandidateActorId: string | null;
    tailSplitViable: boolean;
    tailSplitAllowedAtCurrentPosition: boolean;
    tailSplitBreakableInCurrentTerrain: boolean;
    tailSplitViableWithMarkerReserve: boolean;
    requiresPageAdvance: boolean;
};

export type ActorFormationResolution =
    | { action: 'commit-whole' }
    | { action: 'defer-whole' }
    | { action: 'split-tail'; prefixCount: number; splitCandidateActorId: string }
    | { action: 'single-actor' };

export type TailSplitFailureOutcome = 'advance-page' | 'fallthrough-local-handling';
export type FormationOverflowFallbackOutcome = 'advance-page' | 'fallthrough-local-overflow';
export type TailSplitSuccessOutcome = 'page-turn-and-continue';
export type TailSplitPostAttemptOutcome = TailSplitSuccessOutcome | TailSplitFailureOutcome;
type WholeFormationOverflowEntryOutcome = 'attempt-tail-split' | FormationOverflowFallbackOutcome;
export type WholeFormationOverflowHandling = {
    tailSplitExecution: ReturnType<typeof getTailSplitExecution>;
    fallbackHandling: FormationOverflowFallbackOutcome | null;
};

export type KeepWithNextFormationPlan = {
    formation: ActorFormation;
    assessment: ActorFormationAssessment;
    resolution: ActorFormationResolution;
    splitMarkerReserve?: number;
};

export function formationOverflowsCurrentPlacement(plan: KeepWithNextFormationPlan): boolean {
    return !plan.assessment.wholeFits;
}

export function formationRequiresPageAdvance(plan: KeepWithNextFormationPlan): boolean {
    return plan.assessment.requiresPageAdvance;
}

export function formationMustAdvancePage(plan: KeepWithNextFormationPlan, isAtPageTop: boolean): boolean {
    return !isAtPageTop && formationRequiresPageAdvance(plan);
}

export function formationMustAdvanceAfterFailedTailSplit(
    plan: KeepWithNextFormationPlan,
    isAtPageTop: boolean
): boolean {
    return formationMustAdvancePage(plan, isAtPageTop);
}

export function getTailSplitFailureOutcome(
    plan: KeepWithNextFormationPlan,
    isAtPageTop: boolean
): TailSplitFailureOutcome {
    return formationMustAdvanceAfterFailedTailSplit(plan, isAtPageTop)
        ? 'advance-page'
        : 'fallthrough-local-handling';
}

export function getFormationOverflowFallbackOutcome(
    plan: KeepWithNextFormationPlan,
    isAtPageTop: boolean
): FormationOverflowFallbackOutcome {
    return formationMustAdvancePage(plan, isAtPageTop)
        ? 'advance-page'
        : 'fallthrough-local-overflow';
}

function getWholeFormationOverflowEntryOutcome(
    plan: KeepWithNextFormationPlan,
    isAtPageTop: boolean
): WholeFormationOverflowEntryOutcome {
    if (formationCanExecuteTailSplit(plan)) {
        return 'attempt-tail-split';
    }

    return getFormationOverflowFallbackOutcome(plan, isAtPageTop);
}

function getWholeFormationOverflowState(
    plan: KeepWithNextFormationPlan,
    isAtPageTop: boolean
): WholeFormationOverflowEntryOutcome | null {
    return formationOverflowsCurrentPlacement(plan)
        ? getWholeFormationOverflowEntryOutcome(plan, isAtPageTop)
        : null;
}

export function getWholeFormationOverflowHandling(
    plan: KeepWithNextFormationPlan,
    isAtPageTop: boolean
): WholeFormationOverflowHandling | null {
    const overflowState = getWholeFormationOverflowState(plan, isAtPageTop);
    if (overflowState === null) {
        return null;
    }

    return {
        tailSplitExecution: overflowState === 'attempt-tail-split'
            ? getTailSplitExecution(plan)
            : null,
        fallbackHandling: overflowState === 'attempt-tail-split'
            ? null
            : overflowState
    };
}

export function getTailSplitSuccessOutcome(plan: KeepWithNextFormationPlan): TailSplitSuccessOutcome | null {
    return plan.resolution.action === 'split-tail'
        ? 'page-turn-and-continue'
        : null;
}

export function getTailSplitPostAttemptOutcome(
    plan: KeepWithNextFormationPlan,
    attemptSucceeded: boolean,
    isAtPageTop: boolean
): TailSplitPostAttemptOutcome | null {
    if (attemptSucceeded) {
        return getTailSplitSuccessOutcome(plan);
    }

    return getTailSplitFailureOutcome(plan, isAtPageTop);
}

export function formationCanExecuteTailSplit(plan: KeepWithNextFormationPlan): boolean {
    return (
        plan.resolution.action === 'split-tail' &&
        plan.assessment.tailSplitAllowedAtCurrentPosition &&
        plan.assessment.tailSplitViableWithMarkerReserve
    );
}

export function getTailSplitExecution(plan: KeepWithNextFormationPlan): {
    prefix: PackagerUnit[];
    splitCandidate: PackagerUnit;
    replaceCount: number;
    splitMarkerReserve: number;
} | null {
    if (plan.resolution.action !== 'split-tail') {
        return null;
    }

    const members = plan.formation.members;
    const prefixMembers = members.slice(0, plan.resolution.prefixCount);
    const prefix = prefixMembers.map(member => member.actor);
    const splitCandidate = members[plan.resolution.prefixCount]?.actor ?? null;
    if (!splitCandidate) return null;

    return {
        prefix,
        splitCandidate,
        replaceCount: members.length,
        splitMarkerReserve: plan.splitMarkerReserve ?? 0
    };
}
